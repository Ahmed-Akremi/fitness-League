//! The gym admin's dashboard (the old `GymDashboardService`): who trains, the weekly trend, who is
//! progressing and who needs a nudge, over the gym's approved members. No health data, no email.

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{Duration, NaiveDate, Utc};
use serde_json::{Value, json};
use uuid::Uuid;

use super::{gym_param, manageable};
use crate::{
    error::AppError,
    http::auth::AppUser,
    security::policy,
    state::AppState,
    types::iso,
};

const TREND_WEEKS: i64 = 8;
const INACTIVE_DAYS: i64 = 14;
const TOP_PROGRESS: usize = 5;
const NUDGES: usize = 20;

/// `GET /gyms/:id/dashboard`.
pub async fn dashboard(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let gym = gym_param(&id)?;
    manageable(&state.db, &user, gym).await?;
    let name = sqlx::query_scalar!("SELECT name FROM gyms WHERE id = ?", gym)
        .fetch_one(&state.db)
        .await?;
    let members = sqlx::query!(
        r#"SELECT m.user_id AS "user_id: Uuid", p.full_name,
                  (SELECT MAX(w.performed_at) FROM workouts w
                   WHERE w.user_id = m.user_id AND w.status = 'ACCEPTED') AS last_workout
           FROM gym_members m JOIN profiles p ON p.user_id = m.user_id
           WHERE m.gym_id = ? AND m.status = 'APPROVED'
           ORDER BY m.id"#,
        gym
    )
    .fetch_all(&state.db)
    .await?;
    let pending = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM gym_members WHERE gym_id = ? AND status = 'PENDING'",
        gym
    )
    .fetch_one(&state.db)
    .await?;
    let now = Utc::now();
    let offset = state.cfg.business_utc_offset_minutes;
    let monday = policy::business_today(policy::week_start(now, offset), offset);
    let first = monday - Duration::weeks(TREND_WEEKS);
    let weeks = sqlx::query!(
        r#"SELECT ws.user_id AS "user_id: Uuid", ws.week_start, CAST(ws.total AS DOUBLE) AS "total!: f64",
                  CAST(ws.progress_c AS DOUBLE) AS "progress!: f64"
           FROM weekly_scores ws
             JOIN gym_members m ON m.user_id = ws.user_id AND m.gym_id = ? AND m.status = 'APPROVED'
           WHERE ws.week_start >= ? AND ws.week_start < ?"#,
        gym,
        first,
        monday
    )
    .fetch_all(&state.db)
    .await?;

    let now = now.naive_utc();
    let active_since = |days: i64| {
        members
            .iter()
            .filter(|m| m.last_workout.is_some_and(|at| at >= now - Duration::days(days)))
            .count()
    };
    let trend: Vec<Value> = (0..TREND_WEEKS)
        .map(|i| {
            let start = first + Duration::weeks(i);
            let totals: Vec<f64> = weeks
                .iter()
                .filter(|w| w.week_start == start)
                .map(|w| w.total)
                .collect();
            let mean = (!totals.is_empty()).then(|| {
                (totals.iter().sum::<f64>() / totals.len() as f64 * 10.0).round() / 10.0
            });
            json!({"weekStart": start.to_string(), "activeMembers": totals.len(), "meanScore": mean})
        })
        .collect();
    let name_of = |user: Uuid| {
        members
            .iter()
            .find(|m| m.user_id == user)
            .map(|m| m.full_name.clone())
    };
    let last_week: NaiveDate = monday - Duration::weeks(1);
    let mut progressing: Vec<_> = weeks.iter().filter(|w| w.week_start == last_week).collect();
    progressing.sort_by(|a, b| b.progress.total_cmp(&a.progress));
    let top_progress: Vec<Value> = progressing
        .iter()
        .take(TOP_PROGRESS)
        .map(|w| {
            json!({"userId": w.user_id, "name": name_of(w.user_id), "progress": w.progress, "total": w.total})
        })
        .collect();
    let to_nudge: Vec<Value> = members
        .iter()
        .filter(|m| {
            m.last_workout
                .is_none_or(|at| at < now - Duration::days(INACTIVE_DAYS))
        })
        .take(NUDGES)
        .map(|m| {
            json!({"userId": m.user_id, "name": m.full_name, "lastWorkoutAt": m.last_workout.map(iso)})
        })
        .collect();
    Ok(Json(json!({
        // Ratings, WODs and wars come with plan 3d (plan 3b ruling 2): Glicko-2's start until then.
        "gym": {"id": gym, "name": name, "rating": 1500},
        "members": {
            "approved": members.len(),
            "pending": pending,
            "activeLast7Days": active_since(7),
            "activeLast28Days": active_since(28),
        },
        "trend": trend,
        "topProgress": top_progress,
        "toNudge": to_nudge,
        "wods": [],
        "wars": {"wins": 0, "losses": 0, "draws": 0, "enrolled": true},
    })))
}
