//! The bell (docs §3.12): one row for each thing that happened to an athlete, written by the code
//! that has the news, in its transaction. A port of the old API's `NotificationsService`.

pub mod preferences;

use axum::{Json, extract::State, http::StatusCode};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::MySqlConnection;
use uuid::Uuid;

use crate::{
    error::AppError,
    http::{Api, auth::AppUser, page},
    state::AppState,
    types::iso,
    validate::{Check, ValidJson, ValidQuery, Validate},
};

/// At most this many ids in one « mark read ».
const MAX_IDS: usize = 200;

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/notifications", list)
        .post("/api/v1/notifications/read", mark_read)
        .get("/api/v1/me/notification-preferences", preferences::get)
        .put("/api/v1/me/notification-preferences", preferences::put)
}

/// What happened. The column knows every type the app shows; each plan adds the ones it writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    FriendRequest,
    FriendAccepted,
    BadgeAwarded,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::FriendRequest => "FRIEND_REQUEST",
            Kind::FriendAccepted => "FRIEND_ACCEPTED",
            Kind::BadgeAwarded => "BADGE_AWARDED",
        }
    }
}

/// Tells `user` that `kind` happened, in the caller's transaction: a cause rolled back leaves no
/// notification. The payload holds ids and the few words the app prints, never another account's
/// private data.
pub async fn notify(
    conn: &mut MySqlConnection,
    user: Uuid,
    kind: Kind,
    payload: Value,
) -> Result<(), AppError> {
    sqlx::query!(
        "INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)",
        Uuid::now_v7(),
        user,
        kind.as_str(),
        payload.to_string()
    )
    .execute(conn)
    .await?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageQuery {
    limit: Option<String>,
    cursor: Option<String>,
}

/// Where a page stops: the last notification shown (ids are UUID v7, so they sort by time).
#[derive(Serialize, Deserialize)]
struct Position {
    id: Uuid,
}

/// My notifications, newest first, with how many are still unread.
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
        .map(|raw| page::decode::<Position>(secret, raw))
        .transpose()?
        .map(|p| p.id);
    let mut rows = sqlx::query!(
        r#"SELECT id AS "id: Uuid", type AS kind, payload, read_at, created_at FROM notifications
           WHERE user_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?"#,
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
            .map(|last| page::encode(secret, &Position { id: last.id }))
            .transpose()?
    } else {
        None
    };
    let unread = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL",
        user.id
    )
    .fetch_one(&state.db)
    .await?;
    let data = rows
        .into_iter()
        .map(|n| {
            Ok(json!({
                "id": n.id,
                "type": n.kind,
                "payload": serde_json::from_str::<Value>(&n.payload).map_err(AppError::internal)?,
                "read": n.read_at.is_some(),
                "createdAt": iso(n.created_at),
            }))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let mut answer = page::page(data, next);
    answer["unread"] = json!(unread);
    Ok(Json(answer))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadBody {
    ids: Option<Vec<String>>,
}

impl Validate for ReadBody {
    fn validate(&self, check: &mut Check) {
        if let Some(ids) = &self.ids {
            check.ensure("ids", ids.len() <= MAX_IDS, "ARRAYMAXSIZE");
            check.ensure(
                "ids",
                ids.iter().all(|id| Uuid::parse_str(id).is_ok()),
                "ISUUID",
            );
        }
    }
}

/// Marks my unread notifications read: those named, or all of them. Another athlete's id matches
/// nothing.
async fn mark_read(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<ReadBody>,
) -> Result<StatusCode, AppError> {
    let now = Utc::now().naive_utc();
    match body.ids {
        None => {
            sqlx::query!(
                "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
                now,
                user.id
            )
            .execute(&state.db)
            .await?;
        }
        Some(ids) => {
            // Written back in one form, so the database can turn each into its 16 bytes.
            let ids: Vec<Uuid> = ids.iter().filter_map(|id| Uuid::parse_str(id).ok()).collect();
            let ids = serde_json::to_string(&ids).map_err(AppError::internal)?;
            sqlx::query!(
                "UPDATE notifications n \
                   JOIN JSON_TABLE(?, '$[*]' COLUMNS (id CHAR(36) PATH '$')) j ON n.id = UNHEX(REPLACE(j.id, '-', '')) \
                 SET n.read_at = ? WHERE n.user_id = ? AND n.read_at IS NULL",
                ids,
                now,
                user.id
            )
            .execute(&state.db)
            .await?;
        }
    }
    Ok(StatusCode::NO_CONTENT)
}
