//! The activity feed (docs §3.9): what athletes did, written in the transaction of its cause, then read
//! by their friends with reactions and comments. A port of the old API's `FeedService`.

use serde_json::Value;
use sqlx::MySqlConnection;
use uuid::Uuid;

use crate::error::AppError;

/// What happened. Plans 3d and 3e add the gym-war and battle wins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Workout,
    Pr,
    Badge,
    LevelUp,
    GoalCompleted,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Workout => "WORKOUT",
            Kind::Pr => "PR",
            Kind::Badge => "BADGE",
            Kind::LevelUp => "LEVEL_UP",
            Kind::GoalCompleted => "GOAL_COMPLETED",
        }
    }

    /// The table `ref_id` names a row of.
    pub fn ref_type(self) -> &'static str {
        match self {
            Kind::Workout => "workout",
            Kind::Pr => "personal_record",
            Kind::Badge => "user_badge",
            Kind::LevelUp => "xp_transaction",
            Kind::GoalCompleted => "goal",
        }
    }
}

/// One event: the old API's payload, and the rows the feed prints from.
pub struct Activity<'a> {
    pub user: Uuid,
    pub kind: Kind,
    pub ref_id: Uuid,
    pub visibility: &'a str,
    pub payload: Value,
    pub sport: Option<Uuid>,
    pub exercise: Option<Uuid>,
    pub badge: Option<Uuid>,
}

/// Writes an event in the caller's transaction: a cause rolled back leaves none.
pub async fn record(conn: &mut MySqlConnection, a: Activity<'_>) -> Result<(), AppError> {
    sqlx::query!(
        "INSERT INTO activity_events (id, user_id, type, ref_type, ref_id, visibility, payload, sport_id, \
           exercise_id, badge_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        Uuid::now_v7(),
        a.user,
        a.kind.as_str(),
        a.kind.ref_type(),
        a.ref_id,
        a.visibility,
        a.payload.to_string(),
        a.sport,
        a.exercise,
        a.badge
    )
    .execute(conn)
    .await?;
    Ok(())
}
