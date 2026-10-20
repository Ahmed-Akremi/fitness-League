//! The weekly score (docs §5.5): 0 to 100 from progress, consistency and performance, turned into
//! League Points when the week closes. A port of the old API's `WeeklyScoreService`.

use std::collections::HashSet;

use axum::{Json, extract::State};
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use serde_json::{Value, json};
use sqlx::MySqlConnection;
use uuid::Uuid;

use super::engine::{self, Components};
use crate::{
    error::AppError,
    http::auth::AppUser,
    modules::scoring::{
        self,
        engine::{Direction, harder_level, improvement_pct, is_better, progress_ratio},
    },
    rules::Rules,
    security::policy,
    state::AppState,
    types::{ExperienceLevel, iso},
    validate::round_to,
};

/// A metric counts while it was trained in the last 8 weeks.
const ACTIVE_LOOKBACK_DAYS: i64 = 56;

pub struct WeeklyScore {
    pub week_start: DateTime<Utc>,
    pub training_days: i64,
    pub planned_days: i64,
    pub components: Components,
    pub total: f64,
    /// What the week pays: 0 while the athlete is calibrating.
    pub lp: i64,
    pub eligible: bool,
    pub breakdown: Value,
}

struct Obs {
    exercise: Uuid,
    metric: Uuid,
    value: f64,
    at: NaiveDateTime,
}

/// The best value of `series`, by the metric's direction.
fn best<'a>(series: impl Iterator<Item = &'a Obs>, d: Direction) -> Option<f64> {
    series.fold(None, |acc, o| match acc {
        Some(b) if !is_better(o.value, b, d) => Some(b),
        _ => Some(o.value),
    })
}

/// The score of the week starting at `week_start`, from accepted, on-time data only.
pub async fn compute(
    conn: &mut MySqlConnection,
    rules: &Rules,
    user: Uuid,
    week_start: DateTime<Utc>,
    offset: i32,
) -> Result<WeeklyScore, AppError> {
    let week_end = week_start + Duration::days(7);
    let (start_at, end_at) = (week_start.naive_utc(), week_end.naive_utc());
    let window_start = (week_end - Duration::days(rules.progress_window_days)).naive_utc();
    let active_since = (week_end - Duration::days(ACTIVE_LOOKBACK_DAYS)).naive_utc();
    let expected = scoring::expected(conn, rules.version).await?;
    let profile = sqlx::query!(
        r#"SELECT experience_level_declared AS "declared?: ExperienceLevel",
                  planned_training_days_per_week AS planned, calibration_ends_at
           FROM profiles WHERE user_id = ?"#,
        user
    )
    .fetch_one(&mut *conn)
    .await?;

    // Consistency: business days with an accepted, on-time workout, against the athlete's own plan.
    let performed = sqlx::query_scalar!(
        r#"SELECT w.performed_at FROM workouts w JOIN workout_evaluations e ON e.workout_id = w.id
           WHERE w.user_id = ? AND w.status = 'ACCEPTED' AND w.performed_at >= ? AND w.performed_at < ?
             AND w.duration_s >= ? AND NOT JSON_CONTAINS(e.rule_hits, '{"rule": "LATE_LOG"}')"#,
        user,
        start_at,
        end_at,
        rules.workout_min_duration_min * 60
    )
    .fetch_all(&mut *conn)
    .await?;
    let training_days = performed
        .iter()
        .map(|at| policy::business_today(at.and_utc(), offset))
        .collect::<HashSet<_>>()
        .len() as i64;
    let planned_days = i64::from(profile.planned).max(1);

    let baselines = sqlx::query!(
        r#"SELECT b.exercise_id AS "exercise: Uuid", b.metric_type_id AS "metric: Uuid", m.code, m.direction,
                  CAST(b.effective_value AS DOUBLE) AS "effective!: f64",
                  b.experience_level AS "level?: ExperienceLevel"
           FROM baselines b JOIN metric_types m ON m.id = b.metric_type_id
           WHERE b.user_id = ? AND b.status IN ('FINAL', 'CORRECTED') AND m.code <> 'REPS_AT_WEIGHT'
           ORDER BY b.exercise_id, m.code"#,
        user
    )
    .fetch_all(&mut *conn)
    .await?;
    let observations: Vec<Obs> = sqlx::query!(
        r#"SELECT exercise_id AS "exercise: Uuid", metric_type_id AS "metric: Uuid",
                  CAST(value AS DOUBLE) AS "value!: f64", observed_at
           FROM metric_observations
           WHERE user_id = ? AND qualifier = 0 AND counts_for_competition AND observed_at < ?"#,
        user,
        end_at
    )
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .map(|o| Obs {
        exercise: o.exercise,
        metric: o.metric,
        value: o.value,
        at: o.observed_at,
    })
    .collect();

    let mut progress_scores = Vec::new();
    let mut performance_ratios = Vec::new();
    let mut metrics = Vec::new();
    for b in baselines {
        let d = Direction::parse(&b.direction).unwrap_or(Direction::Higher);
        let series: Vec<&Obs> = observations
            .iter()
            .filter(|o| o.exercise == b.exercise && o.metric == b.metric)
            .collect();
        if !series.iter().any(|o| o.at >= active_since) {
            continue;
        }
        // Progress: the best of the window against the best before it, never below the baseline.
        let current = best(series.iter().copied().filter(|o| o.at >= window_start), d);
        let before = best(series.iter().copied().filter(|o| o.at < window_start), d);
        let reference = match before {
            Some(v) if !is_better(b.effective, v, d) => v,
            _ => b.effective,
        };
        let (mut ratio, mut score, mut capped) = (None, None, false);
        if let Some(current) = current {
            let lookup = |level| expected.get(level, b.exercise, b.metric);
            let level = harder_level(&[profile.declared, b.level], lookup);
            if let Some(pct) = lookup(level) {
                let r = progress_ratio(improvement_pct(reference, current, d), pct);
                capped = r > rules.progress_ceiling_ratio;
                let s = engine::metric_progress_score(
                    r.min(rules.progress_ceiling_ratio),
                    rules.progress_reward_cap,
                );
                progress_scores.push(s);
                (ratio, score) = (Some(r), Some(s));
            }
        }
        // Performance: the week's best against the all-time best, which keeps the advanced in the game.
        let week_best = best(series.iter().copied().filter(|o| o.at >= start_at), d);
        let all_time = best(series.iter().copied(), d);
        let performance = week_best
            .zip(all_time)
            .map(|(w, a)| engine::performance_ratio(w, a, d));
        performance_ratios.extend(performance);
        metrics.push(json!({
            "exerciseId": b.exercise,
            "metric": b.code,
            "reference": reference,
            "current": current,
            "ratio": ratio.map(|r| round_to(r, 3)),
            "progressScore": score.map(|s| round_to(s, 1)),
            "cappedForPlausibility": capped,
            "weekBest": week_best,
            "performanceRatio": performance.map(|p| round_to(p, 3)),
        }));
    }

    let n = rules.progress_top_n;
    let components = Components {
        progress: round_to(engine::top_n_mean(&progress_scores, n), 2),
        consistency: round_to(engine::consistency(training_days, planned_days), 2),
        // The verification factor is 1 until part 5's proofs; challenges count from part 4.
        performance: round_to(
            (engine::top_n_mean(&performance_ratios, n) * 100.0).min(100.0),
            2,
        ),
        challenge: None,
    };
    let total = round_to(engine::weighted_total(&components, &rules.lp_weights), 2);
    let eligible = profile
        .calibration_ends_at
        .is_some_and(|end| end <= start_at);
    Ok(WeeklyScore {
        week_start,
        training_days,
        planned_days,
        total,
        lp: if eligible {
            (total * rules.weekly_lp_per_point).round() as i64
        } else {
            0
        },
        eligible,
        breakdown: json!({
            "formula": "weekly_score",
            "weights": rules.lp_weights,
            "trainingDays": training_days,
            "plannedDays": planned_days,
            "metrics": metrics,
            "topN": n,
            "ruleSetVersion": rules.version,
        }),
        components,
    })
}

/// `GET /me/weekly-scores/current`: the running week, computed on read.
pub async fn current(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
    let rules = Rules::active(&state.db).await?;
    let offset = state.cfg.business_utc_offset_minutes;
    let week = policy::week_start(Utc::now(), offset);
    let mut conn = state.db.acquire().await?;
    let s = compute(&mut conn, &rules, user.id, week, offset).await?;
    Ok(Json(json!({
        "weekStart": iso(s.week_start.naive_utc()),
        "status": "PROVISIONAL",
        "trainingDays": s.training_days,
        "plannedDays": s.planned_days,
        "components": s.components,
        "total": s.total,
        "projectedLp": s.lp,
        "eligible": s.eligible,
        "breakdown": s.breakdown,
    })))
}
