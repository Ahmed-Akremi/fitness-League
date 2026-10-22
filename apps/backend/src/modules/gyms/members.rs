//! Joining and leaving a gym, its member list, and the gym admin's decisions on requests, members
//! and coaches (the old `GymsService` memberships). Every change is one conditional `UPDATE` in the
//! transaction that also moves the athlete's primary gym; a change that touches no row is the 404.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use super::{gym_param, manageable};
use crate::{
    audit,
    db::duplicate_key,
    error::AppError,
    http::{
        auth::{AppUser, AuthUser},
        page,
    },
    state::AppState,
    types::iso,
    validate::ValidQuery,
};

/// A member id from a path; a malformed one names no membership.
fn member_param(raw: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(raw).map_err(|_| AppError::not_found("Membership"))
}

/// `POST /gyms/:id/membership`: asks to join a verified gym. One gym per athlete: the unique index
/// on the live membership refuses a second one, even at the same moment.
pub async fn join(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let gym = gym_param(&id)?;
    let status = sqlx::query_scalar!("SELECT status FROM gyms WHERE id = ?", gym)
        .fetch_optional(&state.db)
        .await?;
    if status.as_deref() != Some("VERIFIED") {
        return Err(AppError::not_found("Gym"));
    }
    let inserted = sqlx::query!(
        "INSERT INTO gym_members (id, gym_id, user_id) VALUES (?, ?, ?)",
        Uuid::now_v7(),
        gym,
        user.id
    )
    .execute(&state.db)
    .await;
    match inserted {
        Ok(_) => Ok((
            StatusCode::CREATED,
            Json(json!({"gymId": gym, "status": "PENDING"})),
        )),
        Err(e) if duplicate_key(&e) == Some("uq_gym_members_live") => {
            let mut conflict = AppError::conflict("CONFLICT")
                .detail("Leave your current gym first (one gym per athlete).");
            let live = sqlx::query!(
                r#"SELECT gym_id AS "gym_id: Uuid", status FROM gym_members WHERE live_user = ?"#,
                user.id
            )
            .fetch_optional(&state.db)
            .await?;
            if let Some(live) = live {
                conflict = conflict
                    .with("gymId", live.gym_id.to_string())
                    .with("membershipStatus", live.status);
            }
            Err(conflict)
        }
        Err(e) => Err(e.into()),
    }
}

/// `DELETE /gyms/me/membership`: leaves my gym, or withdraws my request; nothing to leave is fine.
pub async fn leave(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<StatusCode, AppError> {
    let mut tx = state.db.begin().await?;
    sqlx::query!(
        "UPDATE gym_members SET status = 'LEFT', left_at = ? \
         WHERE user_id = ? AND status IN ('PENDING', 'APPROVED')",
        Utc::now().naive_utc(),
        user.id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE profiles SET primary_gym_id = NULL WHERE user_id = ?",
        user.id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageQuery {
    limit: Option<String>,
    cursor: Option<String>,
}

/// Where a member page stops: the last membership's id.
#[derive(Serialize, Deserialize)]
struct After {
    id: Uuid,
}

/// `GET /gyms/:id/members`: the approved members with an active account, by membership. An unknown
/// gym has none.
pub async fn list(
    State(state): State<AppState>,
    AppUser(_user): AppUser,
    Path(id): Path<String>,
    ValidQuery(query): ValidQuery<PageQuery>,
) -> Result<Json<Value>, AppError> {
    let gym = gym_param(&id)?;
    let limit = page::limit(query.limit.as_deref())? as usize;
    let secret = &state.cfg.app_hmac_secret;
    let after = query
        .cursor
        .as_deref()
        .map(|raw| page::decode::<After>(secret, raw))
        .transpose()?
        .map(|a| a.id);
    let mut rows = sqlx::query!(
        r#"SELECT m.id AS "id: Uuid", u.id AS "user_id: Uuid", u.username, p.full_name, m.role, m.approved_at
           FROM gym_members m JOIN users u ON u.id = m.user_id JOIN profiles p ON p.user_id = u.id
           WHERE m.gym_id = ? AND m.status = 'APPROVED' AND u.status = 'ACTIVE' AND (? IS NULL OR m.id > ?)
           ORDER BY m.id
           LIMIT ?"#,
        gym,
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
        .map(|m| {
            json!({
                "id": m.user_id, "username": m.username, "fullName": m.full_name, "role": m.role,
                "since": m.approved_at.map(iso),
            })
        })
        .collect();
    Ok(Json(page::page(data, next)))
}

/// `GET /gyms/:id/membership-requests`: the pending requests, oldest first.
pub async fn requests(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let gym = gym_param(&id)?;
    manageable(&state.db, &user, gym).await?;
    let rows = sqlx::query!(
        r#"SELECT u.id AS "id: Uuid", u.username, p.full_name, m.requested_at
           FROM gym_members m JOIN users u ON u.id = m.user_id JOIN profiles p ON p.user_id = u.id
           WHERE m.gym_id = ? AND m.status = 'PENDING'
           ORDER BY m.requested_at, m.id"#,
        gym
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.iter()
            .map(|r| {
                json!({
                    "userId": r.id, "username": r.username, "fullName": r.full_name,
                    "requestedAt": iso(r.requested_at),
                })
            })
            .collect(),
    ))
}

#[derive(Clone, Copy)]
enum Decision {
    Approve,
    Reject,
    Remove,
}

/// Approves or rejects a pending request, or removes an approved member, with its audit entry.
async fn decide(
    state: &AppState,
    user: &AuthUser,
    (gym, member): (String, String),
    decision: Decision,
) -> Result<Json<Value>, AppError> {
    let gym = gym_param(&gym)?;
    manageable(&state.db, user, gym).await?;
    let member = member_param(&member)?;
    let now = Utc::now().naive_utc();
    let mut tx = state.db.begin().await?;
    let (status, action, changed) = match decision {
        Decision::Approve => (
            "APPROVED",
            "GYM_MEMBER_APPROVE",
            sqlx::query!(
                "UPDATE gym_members SET status = 'APPROVED', approved_at = ?, approved_by = ? \
                 WHERE gym_id = ? AND user_id = ? AND status = 'PENDING'",
                now,
                user.id,
                gym,
                member
            )
            .execute(&mut *tx)
            .await?,
        ),
        Decision::Reject => (
            "REJECTED",
            "GYM_MEMBER_REJECT",
            sqlx::query!(
                "UPDATE gym_members SET status = 'REJECTED', left_at = ? \
                 WHERE gym_id = ? AND user_id = ? AND status = 'PENDING'",
                now,
                gym,
                member
            )
            .execute(&mut *tx)
            .await?,
        ),
        Decision::Remove => (
            "REMOVED",
            "GYM_MEMBER_REMOVE",
            sqlx::query!(
                "UPDATE gym_members SET status = 'REMOVED', left_at = ? \
                 WHERE gym_id = ? AND user_id = ? AND status = 'APPROVED'",
                now,
                gym,
                member
            )
            .execute(&mut *tx)
            .await?,
        ),
    };
    if changed.rows_affected() == 0 {
        return Err(AppError::not_found("Membership"));
    }
    match decision {
        Decision::Approve => {
            sqlx::query!(
                "UPDATE profiles SET primary_gym_id = ? WHERE user_id = ?",
                gym,
                member
            )
            .execute(&mut *tx)
            .await?;
        }
        Decision::Remove => {
            sqlx::query!(
                "UPDATE profiles SET primary_gym_id = NULL WHERE user_id = ? AND primary_gym_id = ?",
                member,
                gym
            )
            .execute(&mut *tx)
            .await?;
        }
        Decision::Reject => {}
    }
    audit::record(
        &mut *tx,
        audit::Event {
            actor: Some((user.id, user.role)),
            action,
            user_id: member,
            after: Some(json!({"gymId": gym})),
        },
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"userId": member, "status": status})))
}

pub async fn approve(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(ids): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    decide(&state, &user, ids, Decision::Approve).await
}

pub async fn reject(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(ids): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    decide(&state, &user, ids, Decision::Reject).await
}

pub async fn remove(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(ids): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    decide(&state, &user, ids, Decision::Remove).await
}

/// Makes an approved member a coach, or a member again, with its audit entry. The row is read
/// first: MariaDB counts an `UPDATE` that changes nothing as no row.
async fn set_coach(
    state: &AppState,
    user: &AuthUser,
    (gym, member): (String, String),
    coach: bool,
) -> Result<Uuid, AppError> {
    let gym = gym_param(&gym)?;
    manageable(&state.db, user, gym).await?;
    let member = member_param(&member)?;
    let mut tx = state.db.begin().await?;
    let row = sqlx::query_scalar!(
        r#"SELECT id AS "id: Uuid" FROM gym_members
           WHERE gym_id = ? AND user_id = ? AND status = 'APPROVED' FOR UPDATE"#,
        gym,
        member
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::not_found("Membership"))?;
    sqlx::query!(
        "UPDATE gym_members SET role = ? WHERE id = ?",
        if coach { "COACH" } else { "MEMBER" },
        row
    )
    .execute(&mut *tx)
    .await?;
    audit::record(
        &mut *tx,
        audit::Event {
            actor: Some((user.id, user.role)),
            action: if coach {
                "GYM_COACH_APPOINTED"
            } else {
                "GYM_COACH_REMOVED"
            },
            user_id: member,
            after: Some(json!({"gymId": gym})),
        },
    )
    .await?;
    tx.commit().await?;
    Ok(member)
}

pub async fn appoint(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(ids): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    let member = set_coach(&state, &user, ids, true).await?;
    Ok(Json(json!({"userId": member, "role": "COACH"})))
}

pub async fn dismiss(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(ids): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    set_coach(&state, &user, ids, false).await?;
    Ok(StatusCode::NO_CONTENT)
}
