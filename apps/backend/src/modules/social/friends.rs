//! Friend requests and their answers, follows and blocks (the old `SocialService`).

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use super::{Summary, athlete_param, lock_pair, pair, target};
use crate::{
    error::AppError,
    http::{auth::AppUser, rate_limit},
    modules::notifications::{Kind, notify},
    state::AppState,
    validate::{Check, ValidJson, ValidQuery, Validate},
};

/// My friends, by username.
pub async fn list(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Vec<Summary>>, AppError> {
    let friends = sqlx::query_as!(
        Summary,
        r#"SELECT u.id AS "id: Uuid", u.username, p.full_name, g.code AS governorate, us.level
           FROM friendships f
             JOIN users u ON u.id = IF(f.user_low_id = ?, f.user_high_id, f.user_low_id)
             JOIN profiles p ON p.user_id = u.id JOIN governorates g ON g.id = p.governorate_id
             JOIN user_stats us ON us.user_id = u.id
           WHERE f.status = 'ACCEPTED' AND (f.user_low_id = ? OR f.user_high_id = ?)
           ORDER BY u.username"#,
        user.id,
        user.id,
        user.id
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(friends))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestsQuery {
    direction: Option<String>,
}

/// Pending requests made to me (`in`, the default) or by me (`out`), newest first.
pub async fn requests(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidQuery(query): ValidQuery<RequestsQuery>,
) -> Result<Json<Vec<Summary>>, AppError> {
    let mine = match query.direction.as_deref() {
        None | Some("in") => false,
        Some("out") => true,
        Some(_) => return Err(AppError::field("direction", "ISIN")),
    };
    let pending = sqlx::query_as!(
        Summary,
        r#"SELECT u.id AS "id: Uuid", u.username, p.full_name, g.code AS governorate, us.level
           FROM friendships f
             JOIN users u ON u.id = IF(f.user_low_id = ?, f.user_high_id, f.user_low_id)
             JOIN profiles p ON p.user_id = u.id JOIN governorates g ON g.id = p.governorate_id
             JOIN user_stats us ON us.user_id = u.id
           WHERE f.status = 'PENDING' AND (f.user_low_id = ? OR f.user_high_id = ?)
             AND (f.requested_by = ?) = ?
           ORDER BY f.created_at DESC"#,
        user.id,
        user.id,
        user.id,
        user.id,
        mine
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(pending))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RequestBody {
    user_id: String,
}

impl Validate for RequestBody {
    fn validate(&self, check: &mut Check) {
        check.ensure("userId", Uuid::parse_str(&self.user_id).is_ok(), "ISUUID");
    }
}

/// Asks an athlete to be my friend. Asking someone who already asked me accepts their request.
pub async fn request(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<RequestBody>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    user.require_verified()?;
    rate_limit::check(
        &state,
        &rate_limit::FRIEND_REQUESTS_USER,
        &user.id.to_string(),
    )
    .await?;
    let them = Uuid::parse_str(&body.user_id).map_err(|_| AppError::field("userId", "ISUUID"))?;
    let mut tx = state.db.begin().await?;
    // A request crossing mine waits here, then finds my row and accepts it.
    lock_pair(&mut tx, user.id, them).await?;
    target(&mut tx, user.id, them).await?;
    let (low, high) = pair(user.id, them);
    let created = sqlx::query!(
        "INSERT IGNORE INTO friendships (user_low_id, user_high_id, requested_by) VALUES (?, ?, ?)",
        low,
        high,
        user.id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    let status = if created {
        notify(&mut tx, them, Kind::FriendRequest, json!({"userId": user.id})).await?;
        "PENDING"
    } else {
        let existing = sqlx::query!(
            r#"SELECT status, requested_by AS "requested_by: Uuid" FROM friendships
               WHERE user_low_id = ? AND user_high_id = ? FOR UPDATE"#,
            low,
            high
        )
        .fetch_optional(&mut *tx)
        .await?
        // Withdrawn between the two statements: the athlete can simply ask again.
        .ok_or_else(|| AppError::conflict("CONFLICT"))?;
        if existing.status == "ACCEPTED" {
            return Err(AppError::conflict("CONFLICT").detail("Already friends."));
        }
        if existing.requested_by == user.id {
            return Err(AppError::conflict("CONFLICT").detail("Request already sent."));
        }
        sqlx::query!(
            "UPDATE friendships SET status = 'ACCEPTED', accepted_at = ? WHERE user_low_id = ? AND user_high_id = ?",
            Utc::now().naive_utc(),
            low,
            high
        )
        .execute(&mut *tx)
        .await?;
        notify(&mut tx, them, Kind::FriendAccepted, json!({"userId": user.id})).await?;
        "ACCEPTED"
    };
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"status": status}))))
}

/// A pending request `them` made to me, or a 404.
fn request_param(raw: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(raw).map_err(|_| AppError::not_found("Friend request"))
}

pub async fn accept(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(raw): Path<String>,
) -> Result<Json<Value>, AppError> {
    let them = request_param(&raw)?;
    let (low, high) = pair(user.id, them);
    let mut tx = state.db.begin().await?;
    lock_pair(&mut tx, user.id, them).await?;
    let accepted = sqlx::query!(
        "UPDATE friendships SET status = 'ACCEPTED', accepted_at = ? \
         WHERE user_low_id = ? AND user_high_id = ? AND status = 'PENDING' AND requested_by = ?",
        Utc::now().naive_utc(),
        low,
        high,
        them
    )
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    if !accepted {
        return Err(AppError::not_found("Friend request"));
    }
    notify(&mut tx, them, Kind::FriendAccepted, json!({"userId": user.id})).await?;
    tx.commit().await?;
    Ok(Json(json!({"status": "ACCEPTED"})))
}

pub async fn decline(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(raw): Path<String>,
) -> Result<Json<Value>, AppError> {
    let them = request_param(&raw)?;
    let (low, high) = pair(user.id, them);
    let declined = sqlx::query!(
        "DELETE FROM friendships \
         WHERE user_low_id = ? AND user_high_id = ? AND status = 'PENDING' AND requested_by = ?",
        low,
        high,
        them
    )
    .execute(&state.db)
    .await?
    .rows_affected()
        == 1;
    if !declined {
        return Err(AppError::not_found("Friend request"));
    }
    Ok(Json(json!({"status": "DECLINED"})))
}

/// Ends a friendship, or withdraws a request either way.
pub async fn unfriend(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(raw): Path<String>,
) -> Result<StatusCode, AppError> {
    let (low, high) = pair(user.id, athlete_param(&raw)?);
    sqlx::query!(
        "DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?",
        low,
        high
    )
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// One-way and silent: no notification, no approval.
pub async fn follow(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(raw): Path<String>,
) -> Result<StatusCode, AppError> {
    let them = athlete_param(&raw)?;
    let mut tx = state.db.begin().await?;
    lock_pair(&mut tx, user.id, them).await?;
    target(&mut tx, user.id, them).await?;
    sqlx::query!(
        "INSERT IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)",
        user.id,
        them
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unfollow(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(raw): Path<String>,
) -> Result<StatusCode, AppError> {
    sqlx::query!(
        "DELETE FROM follows WHERE follower_id = ? AND followee_id = ?",
        user.id,
        athlete_param(&raw)?
    )
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Cuts every link with an athlete: the friendship and both follows (pending battles: plan 3e). From
/// then on each is invisible to the other.
pub async fn block(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(raw): Path<String>,
) -> Result<StatusCode, AppError> {
    let them = athlete_param(&raw)?;
    if them == user.id {
        return Err(AppError::field("userId", "SELF"));
    }
    let mut tx = state.db.begin().await?;
    lock_pair(&mut tx, user.id, them).await?;
    let exists = sqlx::query_scalar!("SELECT EXISTS (SELECT 1 FROM users WHERE id = ?)", them)
        .fetch_one(&mut *tx)
        .await?
        != 0;
    if !exists {
        return Err(AppError::not_found("Athlete"));
    }
    let (low, high) = pair(user.id, them);
    sqlx::query!(
        "INSERT IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)",
        user.id,
        them
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?",
        low,
        high
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)",
        user.id,
        them,
        them,
        user.id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
