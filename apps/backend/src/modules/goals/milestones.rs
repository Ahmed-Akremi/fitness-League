//! Crediting goal milestones (docs §10): a workout or a weigh-in reaches the next steps of a goal,
//! each earning its XP once, in the caller's transaction. A port of the old API's
//! `creditMilestones`. Callers hold the athlete's `user_stats` row.

use std::collections::HashSet;

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde_json::json;
use sqlx::MySqlConnection;
use uuid::Uuid;

use super::planning;
use crate::{
    error::AppError,
    modules::scoring::{
        engine::{Direction, Observation},
        ledger::{self, XpEntry},
    },
    rules::Rules,
    state::AppState,
};

struct Goal {
    id: Uuid,
    exercise: Option<Uuid>,
    metric: String,
    direction: Direction,
    start_date: NaiveDate,
    /// Weight goals only: the decrypted start.
    start_kg: Option<f64>,
    milestones: Vec<Milestone>,
}

struct Milestone {
    id: Uuid,
    position: i16,
    target: f64,
    reached: bool,
}

/// The active goals of the account with their milestones in order: weight goals, or the
/// strength and running ones. Habit goals move with the week (plan 2d).
async fn active(
    tx: &mut MySqlConnection,
    state: &AppState,
    user: Uuid,
    weight: bool,
) -> Result<Vec<Goal>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT g.id AS "id: Uuid", g.exercise_id AS "exercise_id?: Uuid", m.code AS metric, g.direction,
                  g.start_date, g.start_value_enc, mi.id AS "milestone_id: Uuid", mi.position,
                  CAST(mi.target_value AS DOUBLE) AS "target_value?: f64", mi.target_value_enc,
                  mi.reached_at IS NOT NULL AS "reached!: i64"
           FROM goals g JOIN metric_types m ON m.id = g.metric_type_id
             JOIN goal_milestones mi ON mi.goal_id = g.id
           WHERE g.user_id = ? AND g.status = 'ACTIVE' AND g.type <> 'HABIT' AND (g.type = 'WEIGHT') = ?
           ORDER BY g.id, mi.position"#,
        user,
        weight
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut goals: Vec<Goal> = Vec::new();
    for row in rows {
        let target = match row.target_value_enc {
            Some(blob) => state.health.decrypt_number(&blob)?,
            None => row.target_value.unwrap_or_default(),
        };
        if goals.last().is_none_or(|g| g.id != row.id) {
            goals.push(Goal {
                id: row.id,
                exercise: row.exercise_id,
                metric: row.metric,
                direction: if row.direction == "DECREASE" {
                    Direction::Lower
                } else {
                    Direction::Higher
                },
                start_date: row.start_date,
                start_kg: row
                    .start_value_enc
                    .map(|blob| state.health.decrypt_number(&blob))
                    .transpose()?,
                milestones: Vec::new(),
            });
        }
        if let Some(goal) = goals.last_mut() {
            goal.milestones.push(Milestone {
                id: row.milestone_id,
                position: row.position,
                target,
                reached: row.reached != 0,
            });
        }
    }
    Ok(goals)
}

/// Milestones in order: each one `value` reaches earns its XP, the first one it misses stops the
/// walk. A goal with every milestone reached is complete.
async fn credit(
    tx: &mut MySqlConnection,
    rules: &Rules,
    user: Uuid,
    goal: &Goal,
    value: f64,
    workout: Option<Uuid>,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let n = goal.milestones.len();
    let mut missing = false;
    for m in goal.milestones.iter().filter(|m| !m.reached) {
        if !planning::reached(value, m.target, goal.direction) {
            missing = true;
            break;
        }
        let mut explanation = json!({
            "formula": "goal_milestone_xp",
            "inputs": {"goalId": goal.id, "milestone": m.position + 1, "of": n},
            "result": rules.goal_milestone_xp,
        });
        if let Some(workout) = workout {
            explanation["workoutId"] = json!(workout);
        }
        // Outside the caps, as in the old API.
        let entry = XpEntry {
            user,
            amount: rules.goal_milestone_xp,
            reason: "GOAL_MILESTONE",
            source_type: "goal_milestone",
            source_id: m.id.to_string(),
            workout_id: workout,
            explanation,
            effective_at: at,
        };
        let xp = ledger::append_xp(tx, rules, entry).await?;
        sqlx::query!(
            "UPDATE goal_milestones SET reached_at = ?, workout_id = ?, xp_transaction_id = ? WHERE id = ?",
            at.naive_utc(),
            workout,
            xp,
            m.id
        )
        .execute(&mut *tx)
        .await?;
    }
    if !missing {
        sqlx::query!(
            "UPDATE goals SET status = 'COMPLETED' WHERE id = ? AND user_id = ? AND status = 'ACTIVE'",
            goal.id,
            user
        )
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

/// The strength and running goals a workout's best values reach. An exercise with a record held
/// for review reaches nothing until it is reviewed.
#[allow(clippy::too_many_arguments)]
pub async fn on_workout(
    tx: &mut MySqlConnection,
    state: &AppState,
    rules: &Rules,
    user: Uuid,
    workout_id: Uuid,
    at: DateTime<Utc>,
    observations: &[Observation],
    held: &HashSet<Uuid>,
) -> Result<(), AppError> {
    for goal in active(tx, state, user, false).await? {
        let Some(exercise) = goal.exercise.filter(|e| !held.contains(e)) else {
            continue;
        };
        let Some(o) = observations
            .iter()
            .find(|o| o.exercise_id == exercise && o.metric == goal.metric)
        else {
            continue;
        };
        credit(tx, rules, user, &goal, o.value, Some(workout_id), at).await?;
    }
    Ok(())
}

/// The weight goals a weigh-in reaches. Only the part of the change within the safe rate counts:
/// losing faster earns nothing more (docs §5).
pub async fn on_weigh_in(
    tx: &mut MySqlConnection,
    state: &AppState,
    rules: &Rules,
    user: Uuid,
    latest_kg: f64,
) -> Result<(), AppError> {
    let now = Utc::now();
    for goal in active(tx, state, user, true).await? {
        let Some(start) = goal.start_kg else {
            continue;
        };
        let since = goal.start_date.and_time(NaiveTime::MIN).and_utc();
        let weeks = (now - since).num_seconds() as f64 / (7.0 * 86_400.0);
        let credited = start
            + planning::credited_weight_change(
                latest_kg - start,
                start,
                weeks,
                rules.weight_change_max_pct_per_week,
            );
        credit(tx, rules, user, &goal, credited, None, now).await?;
    }
    Ok(())
}
