//! Reactions: one per athlete per item, changed by sending another (the old `react` and `unreact`).

use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::MySqlConnection;
use uuid::Uuid;

use super::{activity_param, counts, viewable};
use crate::{
    error::AppError,
    http::auth::AppUser,
    modules::notifications::{self, Kind},
    state::AppState,
    validate::{Check, ValidJson, Validate},
};

const TYPES: [&str; 3] = ["LIKE", "FIRE", "STRONG"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct React {
    #[serde(rename = "type")]
    kind: String,
}

impl Validate for React {
    fn validate(&self, check: &mut Check) {
        check.ensure("type", TYPES.contains(&self.kind.as_str()), "ISIN");
    }
}

/// The item's reaction counts, and mine.
async fn summary(conn: &mut MySqlConnection, me: Uuid, activity: Uuid) -> Result<Value, AppError> {
    let row = sqlx::query!(
        r#"SELECT CAST(COALESCE(SUM(type = 'LIKE'), 0) AS SIGNED) AS "like!: i64",
                  CAST(COALESCE(SUM(type = 'FIRE'), 0) AS SIGNED) AS "fire!: i64",
                  CAST(COALESCE(SUM(type = 'STRONG'), 0) AS SIGNED) AS "strong!: i64",
                  MAX(IF(user_id = ?, type, NULL)) AS "mine?: String"
           FROM activity_reactions WHERE activity_event_id = ?"#,
        me,
        activity
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(json!({"reactions": counts(row.like, row.fire, row.strong), "myReaction": row.mine}))
}

/// `PUT /activities/:id/reactions`: sets my reaction. The owner hears of my first one only.
pub async fn react(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
    ValidJson(body): ValidJson<React>,
) -> Result<Json<Value>, AppError> {
    let activity = activity_param(&id)?;
    let mut tx = state.db.begin().await?;
    // Reactions to one item take turns: taps waiting on the same new row would each hold its shared
    // lock, then deadlock on the type's update.
    sqlx::query!(
        "SELECT id FROM activity_events WHERE id = ? FOR UPDATE",
        activity
    )
    .fetch_optional(&mut *tx)
    .await?;
    let owner = viewable(&mut tx, user.id, activity).await?;
    // The key decides what is new: a double tap inserts once and notifies once (plan 3c ruling 5).
    // An upsert's row count cannot tell: sqlx asks for found rows, so « the same again » counts 1.
    let inserted = sqlx::query!(
        "INSERT IGNORE INTO activity_reactions (activity_event_id, user_id, type) VALUES (?, ?, ?)",
        activity,
        user.id,
        body.kind
    )
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    if inserted {
        if owner != user.id {
            let payload = json!({"activityId": activity, "type": body.kind, "byUserId": user.id});
            notifications::notify(&mut tx, owner, Kind::ActivityReaction, payload).await?;
        }
    } else {
        sqlx::query!(
            "UPDATE activity_reactions SET type = ? WHERE activity_event_id = ? AND user_id = ?",
            body.kind,
            activity,
            user.id
        )
        .execute(&mut *tx)
        .await?;
    }
    let answer = summary(&mut tx, user.id, activity).await?;
    tx.commit().await?;
    Ok(Json(answer))
}

/// `DELETE /activities/:id/reactions`: takes my reaction back, if I had one.
pub async fn unreact(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let activity = activity_param(&id)?;
    let mut conn = state.db.acquire().await?;
    viewable(&mut conn, user.id, activity).await?;
    sqlx::query!(
        "DELETE FROM activity_reactions WHERE activity_event_id = ? AND user_id = ?",
        activity,
        user.id
    )
    .execute(&mut *conn)
    .await?;
    Ok(Json(summary(&mut conn, user.id, activity).await?))
}
