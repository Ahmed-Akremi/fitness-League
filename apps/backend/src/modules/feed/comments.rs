//! Comments on feed items (the old `comments`, `comment` and `deleteComment`). A deleted comment
//! stays, hidden.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use super::{PageQuery, activity_param, after, next, viewable};
use crate::{
    error::AppError,
    http::{auth::AppUser, page, rate_limit},
    modules::notifications::{self, Kind},
    state::AppState,
    types::iso,
    validate::{Check, ValidJson, ValidQuery, Validate},
};

/// `GET /activities/:id/comments`: oldest first, never from an account blocked either way.
pub async fn list(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
    ValidQuery(query): ValidQuery<PageQuery>,
) -> Result<Json<Value>, AppError> {
    let activity = activity_param(&id)?;
    let limit = page::limit(query.limit.as_deref())? as usize;
    let after = after(&state, query.cursor.as_deref())?;
    let mut conn = state.db.acquire().await?;
    viewable(&mut conn, user.id, activity).await?;
    let mut rows = sqlx::query!(
        r#"SELECT c.id AS "id: Uuid", c.body, c.created_at, c.user_id AS "user_id: Uuid", u.username, p.full_name
           FROM activity_comments c JOIN users u ON u.id = c.user_id JOIN profiles p ON p.user_id = c.user_id
           WHERE c.activity_event_id = ? AND c.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = c.user_id)
                                                     OR (b.blocker_id = c.user_id AND b.blocked_id = ?))
             AND (? IS NULL OR c.id > ?)
           ORDER BY c.id
           LIMIT ?"#,
        activity,
        user.id,
        user.id,
        after,
        after,
        limit as i64 + 1
    )
    .fetch_all(&mut *conn)
    .await?;
    let more = rows.len() > limit;
    rows.truncate(limit);
    let next = next(&state, more.then(|| rows.last().map(|r| r.id)).flatten())?;
    let data = rows
        .iter()
        .map(|c| {
            json!({
                "id": c.id, "body": c.body, "createdAt": iso(c.created_at),
                "user": {"id": c.user_id, "username": c.username, "fullName": c.full_name},
                "isMine": c.user_id == user.id,
            })
        })
        .collect();
    Ok(Json(page::page(data, next)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Comment {
    body: String,
}

impl Validate for Comment {
    fn validate(&self, check: &mut Check) {
        check.length("body", &self.body, 1, 500);
    }
}

/// `POST /activities/:id/comments`: 30 an hour; the item's owner hears of it.
pub async fn create(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
    ValidJson(body): ValidJson<Comment>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    user.require_verified()?;
    rate_limit::check(&state, &rate_limit::COMMENTS_USER, &user.id.to_string()).await?;
    let activity = activity_param(&id)?;
    let mut tx = state.db.begin().await?;
    let owner = viewable(&mut tx, user.id, activity).await?;
    let text = body.body.trim();
    if text.is_empty() {
        return Err(AppError::field("body", "EMPTY"));
    }
    let comment = Uuid::now_v7();
    let now = Utc::now().naive_utc();
    sqlx::query!(
        "INSERT INTO activity_comments (id, activity_event_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
        comment,
        activity,
        user.id,
        text,
        now
    )
    .execute(&mut *tx)
    .await?;
    if owner != user.id {
        let payload = json!({"activityId": activity, "commentId": comment, "byUserId": user.id});
        notifications::notify(&mut tx, owner, Kind::ActivityComment, payload).await?;
    }
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id": comment, "body": text, "createdAt": iso(now), "isMine": true})),
    ))
}

/// `DELETE /activities/:id/comments/:commentId`: by the comment's author or the item's owner.
pub async fn delete(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path((id, comment)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    let activity = activity_param(&id)?;
    let missing = || AppError::not_found("Comment");
    let comment = Uuid::parse_str(&comment).map_err(|_| missing())?;
    let row = sqlx::query!(
        r#"SELECT c.user_id AS "author: Uuid", e.user_id AS "owner: Uuid"
           FROM activity_comments c JOIN activity_events e ON e.id = c.activity_event_id
           WHERE c.id = ? AND c.activity_event_id = ? AND c.deleted_at IS NULL"#,
        comment,
        activity
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(missing)?;
    if row.author != user.id && row.owner != user.id {
        return Err(AppError::forbidden()
            .detail("You can only delete your comments or comments on your activity."));
    }
    sqlx::query!(
        "UPDATE activity_comments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
        Utc::now().naive_utc(),
        comment
    )
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
