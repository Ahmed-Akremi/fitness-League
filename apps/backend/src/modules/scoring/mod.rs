//! Points: what an accepted workout earns, and how the athlete reads it back.

pub mod engine;
pub mod ledger;
pub mod records;

use std::collections::{HashMap, HashSet};

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::MySqlConnection;
use uuid::Uuid;

use self::{
    engine::{Direction, Step},
    ledger::XpEntry,
    records::{Expected, Metric, PrOutcome, RecordContext},
};
use crate::{
    error::AppError,
    http::{Api, auth::AppUser},
    modules::workouts::metrics::WorkoutInput,
    rules::Rules,
    security::policy,
    state::AppState,
    types::ExperienceLevel,
};

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/workouts/{id}/points", workout_points)
}

/// Metrics whose records earn XP; `REPS_AT_WEIGHT` records are kept for history only.
const XP_METRICS: [&str; 10] = [
    "E1RM",
    "FINISH_TIME",
    "MAX_WEIGHT",
    "MAX_REPS",
    "DISTANCE",
    "PACE",
    "TIME_1K",
    "TIME_5K",
    "TIME_10K",
    "TIME_21K",
];

/// When one workout beats several metrics of an exercise, only the most meaningful one is paid.
const PR_PRIORITY: [&str; 10] = [
    "E1RM",
    "FINISH_TIME",
    "TIME_21K",
    "TIME_10K",
    "TIME_5K",
    "TIME_1K",
    "MAX_WEIGHT",
    "PACE",
    "MAX_REPS",
    "DISTANCE",
];

/// An accepted workout, as scoring needs it.
pub struct Scoring<'a> {
    pub user: Uuid,
    pub workout_id: Uuid,
    pub workout: &'a WorkoutInput,
    /// The metric codes each exercise tracks.
    pub tracked: &'a HashMap<Uuid, Vec<String>>,
    /// False for a late log: history and progress only.
    pub counts_for_competition: bool,
    pub body_weight_kg: Option<f64>,
}

/// Turns an accepted workout into records and XP, in the caller's transaction (docs §5.3). A
/// port of the old API's `WorkoutScoringService.onAccepted`.
pub async fn score(
    tx: &mut MySqlConnection,
    state: &AppState,
    rules: &Rules,
    s: Scoring<'_>,
) -> Result<(), AppError> {
    let now = Utc::now();
    let metrics = metric_types(tx).await?;
    let expected = expected(tx, rules.version).await?;
    let profile = sqlx::query!(
        r#"SELECT p.calibration_ends_at, p.experience_level_declared AS "declared?: ExperienceLevel",
                  st.streak_freeze_days_per_week
           FROM profiles p JOIN user_settings st ON st.user_id = p.user_id WHERE p.user_id = ?"#,
        s.user
    )
    .fetch_one(&mut *tx)
    .await?;
    let performed = s.workout.performed_at;
    let calibration_ends = profile.calibration_ends_at.map(|at| at.and_utc());
    let ctx = RecordContext {
        user: s.user,
        workout_id: s.workout_id,
        workout: s.workout,
        tracked: s.tracked,
        rules,
        metrics: &metrics,
        expected: &expected,
        in_calibration: calibration_ends.is_none_or(|end| performed < end),
        calibration_over: calibration_ends.is_some_and(|end| now >= end),
        declared_level: profile.declared,
        body_weight_kg: s.body_weight_kg,
        counts_for_competition: s.counts_for_competition,
    };
    let (_observations, prs) = records::record(tx, &ctx).await?;

    let day = policy::business_today(performed, state.cfg.business_utc_offset_minutes);
    daily_streak(tx, s.user, day, profile.streak_freeze_days_per_week).await?;
    // Logged more than late_log_max_hours late: history and progress only (docs §7.1).
    if !s.counts_for_competition {
        return Ok(());
    }

    let at = Grant {
        rules,
        user: s.user,
        workout_id: s.workout_id,
        performed,
        day,
    };
    // 1. The workout, with diminishing returns by its rank in the day.
    let nth = add_to_day(tx, s.user, day, 0, 1).await?;
    let (base, mut steps) = engine::workout_xp(s.workout.duration_s, rules);
    let multiplier = engine::diminishing_multiplier(nth, rules);
    steps.push(engine::step("diminishing_multiplier", multiplier));
    let ask = Ask {
        reason: "WORKOUT",
        source_type: "workout",
        // The version: an edited workout would be scored again under a new source.
        source_id: format!("{}#v1", s.workout_id),
        requested: (base as f64 * multiplier).floor() as i64,
        formula: "workout_xp",
        inputs: Some(json!({"durationMin": s.workout.duration_s / 60, "workoutOfDay": nth})),
        steps: Some(steps),
        capped: true,
    };
    grant(tx, &at, ask).await?;

    // 2. One record reward per exercise, with a cooldown per metric.
    for pr in rewardable(tx, &at, &prs, &metrics).await? {
        let calibration = pr.status == "CALIBRATION";
        let ask = Ask {
            reason: if calibration { "CALIBRATION_PR" } else { "PR" },
            source_type: "pr",
            source_id: pr.id.to_string(),
            requested: if calibration {
                rules.calibration_pr_xp
            } else {
                engine::pr_xp(pr.ratio.unwrap_or(0.0), rules)
            },
            formula: if calibration {
                "calibration_pr_xp"
            } else {
                "pr_xp"
            },
            inputs: Some(json!({
                "exerciseId": pr.exercise_id, "metric": pr.metric, "value": pr.value,
                "previous": pr.previous, "ratio": pr.ratio,
            })),
            steps: None,
            capped: true,
        };
        if let Some(xp) = grant(tx, &at, ask).await? {
            sqlx::query!(
                "UPDATE personal_records SET xp_transaction_id = ? WHERE id = ? AND user_id = ?",
                xp,
                pr.id,
                s.user
            )
            .execute(&mut *tx)
            .await?;
        }
    }

    // plan 2c: goal milestones here.

    // 3. The first quest, once per account; quests are onboarding rewards, outside the caps.
    let quest_done = sqlx::query_scalar!(
        "SELECT EXISTS (SELECT 1 FROM xp_transactions \
           WHERE user_id = ? AND reason = 'QUEST' AND source_type = 'quest' AND source_id = 'FIRST_WORKOUT')",
        s.user
    )
    .fetch_one(&mut *tx)
    .await?;
    if quest_done == 0 {
        let ask = Ask {
            reason: "QUEST",
            source_type: "quest",
            source_id: "FIRST_WORKOUT".to_owned(),
            requested: rules.first_workout_quest_xp,
            formula: "first_workout_quest_xp",
            inputs: None,
            steps: None,
            capped: false,
        };
        grant(tx, &at, ask).await?;
    }

    // plan 2c: badges here.
    Ok(())
}

async fn metric_types(tx: &mut MySqlConnection) -> Result<HashMap<String, Metric>, AppError> {
    let rows = sqlx::query!(r#"SELECT id AS "id: Uuid", code, direction FROM metric_types"#)
        .fetch_all(&mut *tx)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let metric = Metric {
                id: row.id,
                direction: Direction::parse(&row.direction).unwrap_or(Direction::Higher),
                code: row.code,
            };
            (metric.code.clone(), metric)
        })
        .collect())
}

async fn expected(tx: &mut MySqlConnection, version: i32) -> Result<Expected, AppError> {
    let rows = sqlx::query!(
        r#"SELECT p.experience_level AS "level: ExperienceLevel", p.exercise_id AS "exercise?: Uuid",
                  p.metric_type_id AS "metric: Uuid", CAST(p.expected_pct AS DOUBLE) AS "pct!: f64"
           FROM expected_progression p JOIN rule_sets r ON r.id = p.rule_set_id WHERE r.version = ?"#,
        version
    )
    .fetch_all(&mut *tx)
    .await?;
    Ok(Expected(
        rows.into_iter()
            .map(|row| ((row.level, row.exercise, row.metric), row.pct))
            .collect(),
    ))
}

/// Planned rest keeps the streak; a workout dated before the last one leaves it as it is.
async fn daily_streak(
    tx: &mut MySqlConnection,
    user: Uuid,
    day: NaiveDate,
    freeze_days: i8,
) -> Result<(), AppError> {
    let row = sqlx::query!(
        "SELECT current_days, longest_days, last_training_date FROM user_streaks WHERE user_id = ? FOR UPDATE",
        user
    )
    .fetch_optional(&mut *tx)
    .await?;
    let (current, longest, last) = row.map_or((0, 0, None), |r| {
        (r.current_days, r.longest_days, r.last_training_date)
    });
    let Some(next) = engine::next_daily_streak(last, current, day, i32::from(freeze_days)) else {
        return Ok(());
    };
    sqlx::query!(
        "INSERT INTO user_streaks (user_id, current_days, longest_days, last_training_date) VALUES (?, ?, ?, ?) \
         ON DUPLICATE KEY UPDATE current_days = VALUES(current_days), longest_days = VALUES(longest_days), \
           last_training_date = VALUES(last_training_date)",
        user,
        next,
        next.max(longest),
        day
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Adds to the day's counters and gives the day's workout count.
async fn add_to_day(
    tx: &mut MySqlConnection,
    user: Uuid,
    day: NaiveDate,
    xp: i64,
    workouts: i64,
) -> Result<i64, AppError> {
    sqlx::query!(
        "INSERT INTO xp_daily_counters (user_id, day, xp_granted, workouts_counted) VALUES (?, ?, ?, ?) \
         ON DUPLICATE KEY UPDATE xp_granted = xp_granted + VALUES(xp_granted), \
           workouts_counted = workouts_counted + VALUES(workouts_counted)",
        user,
        day,
        xp,
        workouts
    )
    .execute(&mut *tx)
    .await?;
    let count = sqlx::query_scalar!(
        "SELECT workouts_counted FROM xp_daily_counters WHERE user_id = ? AND day = ?",
        user,
        day
    )
    .fetch_one(&mut *tx)
    .await?;
    Ok(i64::from(count))
}

/// The XP already granted on the workout's business day, and in its Monday-to-Sunday week.
async fn granted(
    tx: &mut MySqlConnection,
    user: Uuid,
    day: NaiveDate,
) -> Result<(i64, i64), AppError> {
    let monday = day - Duration::days(i64::from(day.weekday().num_days_from_monday()));
    let row = sqlx::query!(
        r#"SELECT CAST(COALESCE(SUM(IF(day = ?, xp_granted, 0)), 0) AS SIGNED) AS "today!: i64",
                  CAST(COALESCE(SUM(xp_granted), 0) AS SIGNED) AS "week!: i64"
           FROM xp_daily_counters WHERE user_id = ? AND day >= ? AND day < ?"#,
        day,
        user,
        monday,
        monday + Duration::days(7)
    )
    .fetch_one(&mut *tx)
    .await?;
    Ok((row.today, row.week))
}

/// Who earns, for which workout, and on which business day.
struct Grant<'a> {
    rules: &'a Rules,
    user: Uuid,
    workout_id: Uuid,
    performed: DateTime<Utc>,
    day: NaiveDate,
}

/// One reward asked for, before the caps.
struct Ask {
    reason: &'static str,
    source_type: &'static str,
    source_id: String,
    requested: i64,
    formula: &'static str,
    inputs: Option<Value>,
    steps: Option<Vec<Step>>,
    /// Workout and record XP count toward the daily and weekly caps.
    capped: bool,
}

/// The explanation the app renders under « Why these points ».
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Explanation {
    formula: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    inputs: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    steps: Option<Vec<Step>>,
    workout_id: Uuid,
    requested: i64,
    caps: Vec<Step>,
    result: i64,
}

/// Grants what fits under the caps. Nothing is written when nothing fits.
async fn grant(tx: &mut MySqlConnection, at: &Grant<'_>, ask: Ask) -> Result<Option<Uuid>, AppError> {
    let (result, caps) = if ask.capped {
        let (today, week) = granted(tx, at.user, at.day).await?;
        engine::apply_caps(ask.requested, today, week, at.rules)
    } else {
        (ask.requested, Vec::new())
    };
    if result <= 0 {
        return Ok(None);
    }
    let explanation = Explanation {
        formula: ask.formula,
        inputs: ask.inputs,
        steps: ask.steps,
        workout_id: at.workout_id,
        requested: ask.requested,
        caps,
        result,
    };
    let entry = XpEntry {
        user: at.user,
        amount: result,
        reason: ask.reason,
        source_type: ask.source_type,
        source_id: ask.source_id,
        workout_id: Some(at.workout_id),
        explanation: serde_json::to_value(explanation).map_err(AppError::internal)?,
        effective_at: at.performed,
    };
    let id = ledger::append_xp(tx, at.rules, entry).await?;
    if ask.capped {
        add_to_day(tx, at.user, at.day, result, 0).await?;
    }
    Ok(Some(id))
}

/// The records to pay: none on an exercise with a held record in this workout; else the most
/// meaningful one per exercise, unless the same metric was paid within the cooldown.
async fn rewardable<'p>(
    tx: &mut MySqlConnection,
    at: &Grant<'_>,
    prs: &'p [PrOutcome],
    metrics: &HashMap<String, Metric>,
) -> Result<Vec<&'p PrOutcome>, AppError> {
    let held: HashSet<Uuid> = prs
        .iter()
        .filter(|p| p.status == "HELD")
        .map(|p| p.exercise_id)
        .collect();
    let rank = |p: &PrOutcome| PR_PRIORITY.iter().position(|m| *m == p.metric);
    let mut best: Vec<&PrOutcome> = Vec::new();
    for pr in prs {
        if held.contains(&pr.exercise_id)
            || !matches!(pr.status, "AWARDED" | "CALIBRATION")
            || !XP_METRICS.contains(&pr.metric)
        {
            continue;
        }
        match best.iter_mut().find(|b| b.exercise_id == pr.exercise_id) {
            Some(kept) if rank(pr) < rank(kept) => *kept = pr,
            Some(_) => {}
            None => best.push(pr),
        }
    }

    let since = at.performed - Duration::days(at.rules.pr_same_metric_cooldown_days);
    let mut paid = Vec::with_capacity(best.len());
    for pr in best {
        let Some(metric) = metrics.get(pr.metric) else {
            continue;
        };
        let recent = sqlx::query_scalar!(
            "SELECT EXISTS (SELECT 1 FROM personal_records \
               WHERE user_id = ? AND exercise_id = ? AND metric_type_id = ? AND status = ? \
                 AND xp_transaction_id IS NOT NULL AND achieved_at >= ? AND id <> ?)",
            at.user,
            pr.exercise_id,
            metric.id,
            pr.status,
            since.naive_utc(),
            pr.id
        )
        .fetch_one(&mut *tx)
        .await?;
        if recent == 0 {
            paid.push(pr);
        }
    }
    Ok(paid)
}

/// « Why these points »: every entry a workout earned, oldest first.
async fn workout_points(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    // A malformed id names no workout, like an unknown one.
    let id = Uuid::parse_str(&id).map_err(|_| AppError::not_found("Workout"))?;
    let status = sqlx::query_scalar!(
        "SELECT status FROM workouts WHERE id = ? AND user_id = ?",
        id,
        user.id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Workout"))?;
    let rows = sqlx::query!(
        r#"SELECT id AS "id: Uuid", amount, reason, reverses_id AS "reverses_id?: Uuid", explanation,
                  rule_set_version
           FROM xp_transactions WHERE user_id = ? AND workout_id = ? ORDER BY id"#,
        user.id,
        id
    )
    .fetch_all(&state.db)
    .await?;
    // A reversal carries its original's workout, so the sum is what the workout still earns.
    let total: i64 = rows.iter().map(|row| i64::from(row.amount)).sum();
    let entries = rows
        .into_iter()
        .map(|row| {
            let explanation: Value =
                serde_json::from_str(&row.explanation).map_err(AppError::internal)?;
            Ok(json!({
                "id": row.id, "amount": row.amount, "reason": row.reason,
                "reversesId": row.reverses_id, "explanation": explanation,
                "ruleSetVersion": row.rule_set_version,
            }))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(Json(
        json!({"workoutId": id, "status": status, "totalXp": total, "entries": entries}),
    ))
}
