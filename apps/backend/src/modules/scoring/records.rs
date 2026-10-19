//! What a workout records: observations, baselines and personal records (docs §8, §9.2), in the
//! workout's transaction. A port of the old API's `ProgressService.recordWorkout`.

use std::collections::HashMap;

use sqlx::MySqlConnection;
use uuid::Uuid;

use super::engine::{self, Direction, Observation};
use crate::{
    error::AppError, modules::workouts::metrics::WorkoutInput, rules::Rules,
    types::ExperienceLevel,
};

pub struct Metric {
    pub id: Uuid,
    pub code: String,
    pub direction: Direction,
}

/// Expected progress in percent, by level, exercise (`None` for the generic row) and metric.
#[derive(Default)]
pub struct Expected(pub HashMap<(ExperienceLevel, Option<Uuid>, Uuid), f64>);

impl Expected {
    /// The exercise's own row wins over the generic one.
    pub fn get(&self, level: ExperienceLevel, exercise: Uuid, metric: Uuid) -> Option<f64> {
        self.0
            .get(&(level, Some(exercise), metric))
            .or_else(|| self.0.get(&(level, None, metric)))
            .copied()
    }
}

pub struct RecordContext<'a> {
    pub user: Uuid,
    pub workout_id: Uuid,
    pub workout: &'a WorkoutInput,
    pub tracked: &'a HashMap<Uuid, Vec<String>>,
    pub rules: &'a Rules,
    /// By code.
    pub metrics: &'a HashMap<String, Metric>,
    pub expected: &'a Expected,
    /// Performed before calibration ended, or calibration has not started.
    pub in_calibration: bool,
    pub calibration_over: bool,
    pub declared_level: Option<ExperienceLevel>,
    pub body_weight_kg: Option<f64>,
    pub counts_for_competition: bool,
}

pub struct PrOutcome {
    pub id: Uuid,
    pub exercise_id: Uuid,
    pub metric: &'static str,
    pub value: f64,
    pub previous: Option<f64>,
    /// `AWARDED`, `CALIBRATION` or `HELD`.
    pub status: &'static str,
    /// Progress against the expected one; `None` for calibration records.
    pub ratio: Option<f64>,
}

/// What a baseline tells the record detection.
struct Baseline {
    level: Option<ExperienceLevel>,
    /// Still being measured: no record against it is judged yet.
    establishing: bool,
}

fn decimal(value: f64) -> String {
    format!("{value:.3}")
}

pub async fn record(
    tx: &mut MySqlConnection,
    ctx: &RecordContext<'_>,
) -> Result<(Vec<Observation>, Vec<PrOutcome>), AppError> {
    let lower = |code: &str| {
        ctx.metrics
            .get(code)
            .is_some_and(|m| m.direction == Direction::Lower)
    };
    let observations = engine::observations(ctx.workout, ctx.tracked, ctx.rules, lower);
    let code_of: HashMap<Uuid, &str> = ctx
        .workout
        .exercises
        .iter()
        .map(|e| (e.exercise_id, e.code.as_str()))
        .collect();

    let mut outcomes = Vec::new();
    for o in &observations {
        let Some(metric) = ctx.metrics.get(o.metric) else {
            continue;
        };
        sqlx::query!(
            "INSERT INTO metric_observations (id, user_id, exercise_id, metric_type_id, qualifier, value, \
               workout_id, observed_at, counts_for_competition) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            Uuid::now_v7(),
            ctx.user,
            o.exercise_id,
            metric.id,
            decimal(o.qualifier),
            decimal(o.value),
            ctx.workout_id,
            ctx.workout.performed_at.naive_utc(),
            ctx.counts_for_competition
        )
        .execute(&mut *tx)
        .await?;
        let code = code_of.get(&o.exercise_id).copied().unwrap_or_default();
        let baseline = if o.qualifier == 0.0 {
            Some(update_baseline(tx, ctx, o, metric, code).await?)
        } else {
            None
        };
        if let Some(pr) = detect_pr(tx, ctx, o, metric, baseline.as_ref()).await? {
            outcomes.push(pr);
        }
    }
    Ok((observations, outcomes))
}

/// During calibration every log builds the baseline. After it, an exercise seen for the first time
/// needs `baseline_first_logs` sessions before progress on it is judged (docs §5.4).
async fn update_baseline(
    tx: &mut MySqlConnection,
    ctx: &RecordContext<'_>,
    o: &Observation,
    metric: &Metric,
    exercise_code: &str,
) -> Result<Baseline, AppError> {
    let current = sqlx::query!(
        r#"SELECT CAST(declared_value AS DOUBLE) AS "declared?: f64",
                  CAST(calibrated_value AS DOUBLE) AS "calibrated?: f64", status,
                  experience_level AS "level?: ExperienceLevel", logs_counted
           FROM baselines WHERE user_id = ? AND exercise_id = ? AND metric_type_id = ?"#,
        ctx.user,
        o.exercise_id,
        metric.id
    )
    .fetch_optional(&mut *tx)
    .await?;
    let best = |a: Option<f64>, b: Option<f64>| match (a, b) {
        (Some(a), Some(b)) if metric.direction == Direction::Higher => Some(a.max(b)),
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    };
    let derived = engine::derive_experience_level(
        exercise_code,
        &metric.code,
        o.value,
        ctx.body_weight_kg,
        ctx.rules,
    );
    // The level only goes up.
    let level = |previous: Option<ExperienceLevel>| match (derived, previous) {
        (Some(d), Some(p)) => Some(d.max(p)),
        (d, p) => d.or(p),
    };

    if let Some(cur) = &current {
        if cur.status != "PROVISIONAL" {
            let raised = level(cur.level);
            if raised != cur.level {
                sqlx::query!(
                    "UPDATE baselines SET experience_level = ? \
                     WHERE user_id = ? AND exercise_id = ? AND metric_type_id = ?",
                    raised,
                    ctx.user,
                    o.exercise_id,
                    metric.id
                )
                .execute(&mut *tx)
                .await?;
            }
            return Ok(Baseline {
                level: raised,
                establishing: false,
            });
        }
        // Calibration ended before the nightly job finalised this baseline: finalise it from the
        // calibration data only, then judge this workout normally.
        if !ctx.in_calibration && ctx.calibration_over && cur.calibrated.is_some() {
            let raised = level(cur.level);
            sqlx::query!(
                "UPDATE baselines SET status = 'FINAL', finalized_at = UTC_TIMESTAMP(6), effective_value = ?, \
                   experience_level = ? \
                 WHERE user_id = ? AND exercise_id = ? AND metric_type_id = ?",
                best(cur.declared, cur.calibrated).map(decimal),
                raised,
                ctx.user,
                o.exercise_id,
                metric.id
            )
            .execute(&mut *tx)
            .await?;
            return Ok(Baseline {
                level: raised,
                establishing: false,
            });
        }
    }

    let declared = current.as_ref().and_then(|c| c.declared);
    let calibrated = best(current.as_ref().and_then(|c| c.calibrated), Some(o.value));
    let logs = current.as_ref().map_or(0, |c| c.logs_counted) + 1;
    let final_now = !ctx.in_calibration && i64::from(logs) >= ctx.rules.baseline_first_logs;
    let raised = level(current.as_ref().and_then(|c| c.level));
    sqlx::query!(
        "INSERT INTO baselines (id, user_id, exercise_id, metric_type_id, calibrated_value, effective_value, \
           status, experience_level, logs_counted, finalized_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, IF(?, UTC_TIMESTAMP(6), NULL)) \
         ON DUPLICATE KEY UPDATE calibrated_value = VALUES(calibrated_value), \
           effective_value = VALUES(effective_value), status = VALUES(status), \
           experience_level = VALUES(experience_level), logs_counted = VALUES(logs_counted), \
           finalized_at = VALUES(finalized_at)",
        Uuid::now_v7(),
        ctx.user,
        o.exercise_id,
        metric.id,
        calibrated.map(decimal),
        best(declared, calibrated).map(decimal),
        if final_now { "FINAL" } else { "PROVISIONAL" },
        raised,
        logs,
        final_now
    )
    .execute(&mut *tx)
    .await?;
    Ok(Baseline {
        level: raised,
        establishing: true,
    })
}

/// A record is a new best value; an equal value is none. After calibration, progress beyond
/// `progress_ceiling_ratio` times the expected one is held for review, and a held record never
/// raises the bar until then.
async fn detect_pr(
    tx: &mut MySqlConnection,
    ctx: &RecordContext<'_>,
    o: &Observation,
    metric: &Metric,
    baseline: Option<&Baseline>,
) -> Result<Option<PrOutcome>, AppError> {
    let current = sqlx::query!(
        r#"SELECT id AS "id: Uuid", CAST(value AS DOUBLE) AS "value!: f64" FROM personal_records
           WHERE user_id = ? AND exercise_id = ? AND metric_type_id = ? AND qualifier = ? AND is_current"#,
        ctx.user,
        o.exercise_id,
        metric.id,
        decimal(o.qualifier)
    )
    .fetch_optional(&mut *tx)
    .await?;
    if current
        .as_ref()
        .is_some_and(|c| !engine::is_better(o.value, c.value, metric.direction))
    {
        return Ok(None);
    }

    let reference = current.as_ref().map(|c| c.value);
    let establishing = baseline.is_some_and(|b| b.establishing);
    let (mut status, mut ratio) = ("CALIBRATION", None);
    if let Some(reference) = reference.filter(|_| !ctx.in_calibration && !establishing) {
        // Max weight progresses like the estimated 1RM: judge it by that expectation.
        let judged = match ctx.metrics.get("E1RM") {
            Some(e1rm) if metric.code == "MAX_WEIGHT" => e1rm.id,
            _ => metric.id,
        };
        let expected = |level| ctx.expected.get(level, o.exercise_id, judged);
        let level = engine::harder_level(
            &[ctx.declared_level, baseline.and_then(|b| b.level)],
            expected,
        );
        status = "AWARDED";
        if let Some(pct) = expected(level) {
            let r = engine::progress_ratio(
                engine::improvement_pct(reference, o.value, metric.direction),
                pct,
            );
            ratio = Some(r);
            if r > ctx.rules.progress_ceiling_ratio {
                status = "HELD";
            }
        }
    }

    let becomes_current = status != "HELD";
    if let Some(cur) = current.as_ref().filter(|_| becomes_current) {
        sqlx::query!(
            "UPDATE personal_records SET is_current = FALSE WHERE id = ? AND user_id = ?",
            cur.id,
            ctx.user
        )
        .execute(&mut *tx)
        .await?;
    }
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO personal_records (id, user_id, exercise_id, metric_type_id, qualifier, value, \
           previous_value, workout_id, status, is_current, achieved_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        ctx.user,
        o.exercise_id,
        metric.id,
        decimal(o.qualifier),
        decimal(o.value),
        reference.map(decimal),
        ctx.workout_id,
        status,
        becomes_current,
        ctx.workout.performed_at.naive_utc()
    )
    .execute(&mut *tx)
    .await?;
    Ok(Some(PrOutcome {
        id,
        exercise_id: o.exercise_id,
        metric: o.metric,
        value: o.value,
        previous: reference,
        status,
        ratio,
    }))
}
