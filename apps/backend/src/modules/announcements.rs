//! Home news (the owner's decision: admins post, athletes only like). The app's side of the old
//! `AnnouncementsService`; publishing, the photo and the bell fan-out come with part 5 (spec ruling 3).

use axum::{
    Json,
    extract::{Path, State},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    error::AppError,
    http::{Api, auth::AppUser, page},
    state::AppState,
    types::iso,
    validate::ValidQuery,
};

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/announcements", list)
        .put("/api/v1/announcements/{id}/like", like)
        .delete("/api/v1/announcements/{id}/like", unlike)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageQuery {
    limit: Option<String>,
    cursor: Option<String>,
}

/// Where a page stops: the last post's id.
#[derive(Serialize, Deserialize)]
struct After {
    id: Uuid,
}

/// `GET /announcements`: the live posts, newest first, with my like.
async fn list(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidQuery(query): ValidQuery<PageQuery>,
) -> Result<Json<Value>, AppError> {
    let limit = page::limit(query.limit.as_deref())? as usize;
    let secret = &state.cfg.app_hmac_secret;
    let after = query
        .cursor
        .as_deref()
        .map(|raw| page::decode::<After>(secret, raw))
        .transpose()?
        .map(|a| a.id);
    let mut rows = sqlx::query!(
        r#"SELECT a.id AS "id: Uuid", a.body, a.created_at,
                  (SELECT COUNT(*) FROM announcement_likes l WHERE l.announcement_id = a.id) AS "likes!: i64",
                  EXISTS (SELECT 1 FROM announcement_likes l
                          WHERE l.announcement_id = a.id AND l.user_id = ?) AS "mine!: i64"
           FROM announcements a
           WHERE a.deleted_at IS NULL AND (? IS NULL OR a.id < ?)
           ORDER BY a.id DESC
           LIMIT ?"#,
        user.id,
        after,
        after,
        limit as i64 + 1
    )
    .fetch_all(&state.db)
    .await?;
    let next = if rows.len() > limit {
        rows.truncate(limit);
        rows.last()
            .map(|last| page::encode(secret, &After { id: last.id }))
            .transpose()?
    } else {
        None
    };
    let data = rows
        .iter()
        .map(|a| {
            json!({
                "id": a.id, "body": a.body,
                // The photo comes with part 5's file storage (plan 3c ruling 6).
                "imageUrl": null, "imageWidth": null, "imageHeight": null,
                "createdAt": iso(a.created_at), "likeCount": a.likes, "likedByMe": a.mine != 0,
            })
        })
        .collect();
    Ok(Json(page::page(data, next)))
}

/// A live post's id from a path: 404 for a malformed, unknown or deleted one.
async fn live(state: &AppState, raw: &str) -> Result<Uuid, AppError> {
    let missing = || AppError::not_found("Announcement");
    let id = Uuid::parse_str(raw).map_err(|_| missing())?;
    sqlx::query_scalar!(
        r#"SELECT id AS "id: Uuid" FROM announcements WHERE id = ? AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(missing)
}

async fn likes(state: &AppState, id: Uuid, mine: bool) -> Result<Json<Value>, AppError> {
    let count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM announcement_likes WHERE announcement_id = ?",
        id
    )
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({"likeCount": count, "likedByMe": mine})))
}

/// `PUT /announcements/:id/like`: once per athlete, however often it is sent.
async fn like(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let id = live(&state, &id).await?;
    sqlx::query!(
        "INSERT IGNORE INTO announcement_likes (announcement_id, user_id) VALUES (?, ?)",
        id,
        user.id
    )
    .execute(&state.db)
    .await?;
    likes(&state, id, true).await
}

/// `DELETE /announcements/:id/like`.
async fn unlike(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let id = live(&state, &id).await?;
    sqlx::query!(
        "DELETE FROM announcement_likes WHERE announcement_id = ? AND user_id = ?",
        id,
        user.id
    )
    .execute(&state.db)
    .await?;
    likes(&state, id, false).await
}
