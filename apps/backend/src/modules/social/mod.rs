//! The social graph (docs §3.8): friends, follows, blocks, the athlete search and public profiles. A
//! port of the old API's `SocialService` and `SocialAccess`.

pub mod friends;

use serde::Serialize;
use sqlx::MySqlPool;
use uuid::Uuid;

use crate::{error::AppError, http::Api};

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/friends", friends::list)
        .get("/api/v1/friends/requests", friends::requests)
        .post("/api/v1/friends/requests", friends::request)
        .post(
            "/api/v1/friends/requests/{user_id}/accept",
            friends::accept,
        )
        .post(
            "/api/v1/friends/requests/{user_id}/decline",
            friends::decline,
        )
        .delete("/api/v1/friends/{user_id}", friends::unfriend)
        .post("/api/v1/follows/{user_id}", friends::follow)
        .delete("/api/v1/follows/{user_id}", friends::unfollow)
        .post("/api/v1/blocks/{user_id}", friends::block)
}

/// An athlete's card in a friend list or a search: never an email, a birth date or body data.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: Uuid,
    pub username: String,
    pub full_name: String,
    /// The governorate's code (`TN-51`).
    pub governorate: String,
    pub level: i32,
}

/// A friendship's key: the two ids, lower first (`Uuid` sorts by its bytes, as MariaDB sorts
/// `BINARY(16)`).
pub fn pair(a: Uuid, b: Uuid) -> (Uuid, Uuid) {
    if a < b { (a, b) } else { (b, a) }
}

/// An athlete id from a path; a malformed one names nobody.
pub fn athlete_param(raw: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(raw).map_err(|_| AppError::not_found("Athlete"))
}

/// An athlete `me` may reach: someone else, active, and neither has blocked the other. A blocked
/// account answers like no account.
pub async fn target(db: &MySqlPool, me: Uuid, user: Uuid) -> Result<(), AppError> {
    if user == me {
        return Err(AppError::field("userId", "SELF"));
    }
    let reachable = sqlx::query_scalar!(
        "SELECT EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.status = 'ACTIVE' \
           AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) \
                                                   OR (b.blocker_id = u.id AND b.blocked_id = ?)))",
        user,
        me,
        me
    )
    .fetch_one(db)
    .await?
        != 0;
    if reachable {
        Ok(())
    } else {
        Err(AppError::not_found("Athlete"))
    }
}
