//! The weekly score (docs §5.5): 0 to 100 from progress, consistency and performance, turned into
//! League Points when the week closes. A port of the old API's `WeeklyScoreService`.

use std::collections::HashSet;

use axum::{Json, extract::State};
use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use serde_json::{Value, json};
use sqlx::MySqlConnection;
use uuid::Uuid;

use super::engine::{self, Components};
use crate::{
    error::AppError,
    http::auth::AppUser,
    modules::{
        goals::milestones,
        scoring::{
            self,
            engine::{Direction, harder_level, improvement_pct, is_better, progress_ratio},
            ledger::{self, LpEntry},
        },
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

/// What a week's LP entry explains: the breakdown, the components, the total and the result.
fn explanation(s: &WeeklyScore, correction: Option<&str>) -> Value {
    let mut e = s.breakdown.clone();
    e["components"] = json!(s.components);
    e["total"] = json!(s.total);
    e["result"] = json!(s.lp);
    if let Some(correction) = correction {
        e["correction"] = json!(correction);
    }
    e
}

/// The local Monday of a week as its `DATE`, and back.
fn week_date(week_start: DateTime<Utc>, offset: i32) -> NaiveDate {
    policy::business_today(week_start, offset)
}

fn week_of(date: NaiveDate, offset: i32) -> DateTime<Utc> {
    date.and_time(NaiveTime::MIN).and_utc() - Duration::minutes(i64::from(offset))
}

/// The season of the athlete's country holding `at`.
async fn season_at(
    tx: &mut MySqlConnection,
    user: Uuid,
    at: DateTime<Utc>,
) -> Result<Option<Uuid>, AppError> {
    Ok(sqlx::query_scalar!(
        r#"SELECT s.id AS "id: Uuid" FROM seasons s JOIN profiles p ON p.country_code = s.country_code
           WHERE p.user_id = ? AND s.starts_at <= ? AND s.ends_at > ?
           ORDER BY s.starts_at DESC LIMIT 1"#,
        user,
        at.naive_utc(),
        at.naive_utc()
    )
    .fetch_optional(&mut *tx)
    .await?)
}

/// The week's row, created or replaced.
async fn save(
    tx: &mut MySqlConnection,
    rules: &Rules,
    user: Uuid,
    week: NaiveDate,
    season: Option<Uuid>,
    s: &WeeklyScore,
    lp_entry: Option<Uuid>,
) -> Result<(), AppError> {
    let c = &s.components;
    sqlx::query!(
        "INSERT INTO weekly_scores (id, user_id, week_start, season_id, rule_set_version, progress_c, consistency_c, \
           performance_c, challenge_c, total, breakdown, lp_transaction_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON DUPLICATE KEY UPDATE season_id = VALUES(season_id), rule_set_version = VALUES(rule_set_version), \
           progress_c = VALUES(progress_c), consistency_c = VALUES(consistency_c), \
           performance_c = VALUES(performance_c), challenge_c = VALUES(challenge_c), total = VALUES(total), \
           breakdown = VALUES(breakdown), lp_transaction_id = VALUES(lp_transaction_id)",
        Uuid::now_v7(),
        user,
        week,
        season,
        rules.version,
        format!("{:.2}", c.progress),
        format!("{:.2}", c.consistency),
        format!("{:.2}", c.performance),
        c.challenge.map(|v| format!("{v:.2}")),
        format!("{:.2}", s.total),
        s.breakdown.to_string(),
        lp_entry
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Anti-sandbagging (docs §5.4): each final baseline against its best competition performance in
/// the audit window after it became final, up to `until`. Corrects the implausible ones and
/// returns the earliest `finalized_at` among them.
async fn audit(
    tx: &mut MySqlConnection,
    rules: &Rules,
    user: Uuid,
    until: DateTime<Utc>,
) -> Result<Option<NaiveDateTime>, AppError> {
    let expected = scoring::expected(tx, rules.version).await?;
    let declared = sqlx::query_scalar!(
        r#"SELECT experience_level_declared AS "level?: ExperienceLevel" FROM profiles WHERE user_id = ?"#,
        user
    )
    .fetch_one(&mut *tx)
    .await?;
    let baselines = sqlx::query!(
        r#"SELECT b.id AS "id: Uuid", b.exercise_id AS "exercise: Uuid", b.metric_type_id AS "metric: Uuid",
                  m.direction, CAST(b.effective_value AS DOUBLE) AS "effective!: f64",
                  b.experience_level AS "level?: ExperienceLevel", b.finalized_at AS "finalized!"
           FROM baselines b JOIN metric_types m ON m.id = b.metric_type_id
           WHERE b.user_id = ? AND b.status = 'FINAL' AND b.finalized_at IS NOT NULL AND b.finalized_at < ?"#,
        user,
        until.naive_utc()
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut earliest: Option<NaiveDateTime> = None;
    for b in baselines {
        let d = Direction::parse(&b.direction).unwrap_or(Direction::Higher);
        let end = until
            .naive_utc()
            .min(b.finalized + Duration::days(rules.baseline_audit_days));
        let observed = sqlx::query!(
            r#"SELECT CAST(value AS DOUBLE) AS "value!: f64", observed_at FROM metric_observations
               WHERE user_id = ? AND exercise_id = ? AND metric_type_id = ? AND qualifier = 0
                 AND counts_for_competition AND observed_at > ? AND observed_at < ?
               ORDER BY observed_at"#,
            user,
            b.exercise,
            b.metric,
            b.finalized,
            end
        )
        .fetch_all(&mut *tx)
        .await?;
        let Some(best) = observed
            .iter()
            .reduce(|a, o| if is_better(o.value, a.value, d) { o } else { a })
        else {
            continue;
        };
        let lookup = |level| expected.get(level, b.exercise, b.metric);
        let Some(pct) = lookup(harder_level(&[declared, b.level], lookup)) else {
            continue;
        };
        let elapsed = (best.observed_at - b.finalized).num_seconds() as f64 / 86_400.0;
        let Some(raised) = engine::audited_baseline(
            b.effective,
            best.value,
            elapsed,
            pct,
            d,
            rules.progress_ceiling_ratio,
            rules.progress_window_days as f64,
        ) else {
            continue;
        };
        sqlx::query!(
            "UPDATE baselines SET status = 'CORRECTED', corrected_from = effective_value, effective_value = ?, \
               rule_set_version = ? WHERE id = ? AND user_id = ?",
            format!("{raised:.3}"),
            rules.version,
            b.id,
            user
        )
        .execute(&mut *tx)
        .await?;
        earliest = Some(earliest.map_or(b.finalized, |e| e.min(b.finalized)));
    }
    Ok(earliest)
}

/// Scores again the closed weeks from `from` up to `before` after a baseline correction: each
/// paid entry is reversed, and the new score paid under a new source (docs §5.10.3).
async fn rescore(
    tx: &mut MySqlConnection,
    rules: &Rules,
    user: Uuid,
    from: NaiveDate,
    before: NaiveDate,
    offset: i32,
) -> Result<(), AppError> {
    let weeks = sqlx::query!(
        r#"SELECT week_start, season_id AS "season?: Uuid", lp_transaction_id AS "paid?: Uuid"
           FROM weekly_scores WHERE user_id = ? AND week_start >= ? AND week_start < ? ORDER BY week_start"#,
        user,
        from,
        before
    )
    .fetch_all(&mut *tx)
    .await?;
    for w in weeks {
        if let Some(paid) = w.paid {
            ledger::reverse_lp(
                tx,
                rules,
                user,
                paid,
                "baseline corrected (anti-sandbagging)",
            )
            .await?;
        }
        let start = week_of(w.week_start, offset);
        let score = compute(tx, rules, user, start, offset).await?;
        let mut entry = None;
        if let Some(season) = w.season.filter(|_| score.lp > 0) {
            let date = w.week_start.to_string();
            let n = sqlx::query_scalar!(
                "SELECT COUNT(*) FROM league_point_transactions \
                 WHERE user_id = ? AND source_type = 'week' AND source_id LIKE CONCAT(?, '%')",
                user,
                date
            )
            .fetch_one(&mut *tx)
            .await?;
            let e = LpEntry {
                user,
                season,
                amount: score.lp,
                reason: "WEEKLY_SCORE",
                source_type: "week",
                source_id: format!("{date}#c{n}"),
                explanation: explanation(&score, Some("baseline corrected")),
                effective_at: start + Duration::days(7),
            };
            entry = Some(ledger::append_lp(tx, rules, e).await?);
        }
        save(tx, rules, user, w.week_start, w.season, &score, entry).await?;
    }
    Ok(())
}

/// One athlete's share of a week's close; nothing when the week is already closed for them.
async fn close_athlete(
    tx: &mut MySqlConnection,
    state: &AppState,
    rules: &Rules,
    user: Uuid,
    week_start: DateTime<Utc>,
) -> Result<i64, AppError> {
    let offset = state.cfg.business_utc_offset_minutes;
    // A workout of the athlete being scored waits, and so does another worker closing this week.
    sqlx::query!(
        "SELECT user_id FROM user_stats WHERE user_id = ? FOR UPDATE",
        user
    )
    .fetch_one(&mut *tx)
    .await?;
    let date = week_date(week_start, offset);
    let closed = sqlx::query_scalar!(
        "SELECT EXISTS (SELECT 1 FROM weekly_scores WHERE user_id = ? AND week_start = ?)",
        user,
        date
    )
    .fetch_one(&mut *tx)
    .await?;
    if closed != 0 {
        return Ok(0);
    }
    let week_end = week_start + Duration::days(7);
    if let Some(since) = audit(tx, rules, user, week_end).await? {
        let from = week_date(policy::week_start(since.and_utc(), offset), offset);
        rescore(tx, rules, user, from, date, offset).await?;
    }

    let score = compute(tx, rules, user, week_start, offset).await?;
    let season = season_at(tx, user, week_start).await?;
    let mut entry = None;
    if let Some(season) = season.filter(|_| score.lp > 0) {
        let e = LpEntry {
            user,
            season,
            amount: score.lp,
            reason: "WEEKLY_SCORE",
            source_type: "week",
            source_id: date.to_string(),
            explanation: explanation(&score, None),
            effective_at: week_end,
        };
        entry = Some(ledger::append_lp(tx, rules, e).await?);
    }
    save(tx, rules, user, date, season, &score, entry).await?;

    // The headline streak: weeks with the plan met; planned rest never breaks it.
    let met = score.training_days >= score.planned_days;
    sqlx::query!(
        "UPDATE user_streaks SET longest_weeks = GREATEST(longest_weeks, IF(?, current_weeks + 1, 0)), \
           current_weeks = IF(?, current_weeks + 1, 0) WHERE user_id = ?",
        met,
        met,
        user
    )
    .execute(&mut *tx)
    .await?;
    milestones::on_week_closed(tx, state, rules, user, score.training_days, week_end).await?;
    Ok(entry.map_or(0, |_| score.lp))
}

/// Closes the week starting at `week_start` (docs §8 `weekly-close`): its final scores and LP, the
/// baseline audit, the weekly streaks and the habit goals, each athlete in their own transaction.
pub async fn close_week(
    state: &AppState,
    rules: &Rules,
    week_start: DateTime<Utc>,
) -> Result<Value, AppError> {
    let week_end = week_start + Duration::days(7);
    let athletes = sqlx::query_scalar!(
        r#"SELECT user_id AS "user: Uuid" FROM workouts
           WHERE status = 'ACCEPTED' AND performed_at >= ? AND performed_at < ?
           UNION SELECT user_id FROM goals WHERE type = 'HABIT' AND status = 'ACTIVE'"#,
        week_start.naive_utc(),
        week_end.naive_utc()
    )
    .fetch_all(&state.db)
    .await?;
    let mut lp = 0;
    for user in &athletes {
        let mut tx = state.db.begin().await?;
        lp += close_athlete(&mut tx, state, rules, *user, week_start).await?;
        tx.commit().await?;
    }
    Ok(json!({"users": athletes.len(), "lpPosted": lp}))
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
