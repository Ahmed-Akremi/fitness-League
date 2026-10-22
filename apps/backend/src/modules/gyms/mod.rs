//! Gyms (docs §3.11): the directory, submissions, memberships, coaches and the gym admin's
//! dashboard. A port of the old API's `GymsService` and `GymDashboardService`; the verification
//! queue and logos come with part 5 (spec ruling 3).

pub mod directory;
pub mod members;

use sqlx::MySqlPool;
use uuid::Uuid;

use crate::{
    error::AppError,
    http::{Api, auth::AuthUser},
    types::Role,
};

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/gyms", directory::list)
        .post("/api/v1/gyms", directory::create)
        .get("/api/v1/gyms/mine", directory::mine)
        .get("/api/v1/gyms/{id}", directory::profile)
        .post("/api/v1/gyms/{id}/membership", members::join)
        .delete("/api/v1/gyms/me/membership", members::leave)
        .get("/api/v1/gyms/{id}/members", members::list)
        .get(
            "/api/v1/gyms/{id}/membership-requests",
            members::requests,
        )
        .post(
            "/api/v1/gyms/{id}/members/{user_id}/approve",
            members::approve,
        )
        .post(
            "/api/v1/gyms/{id}/members/{user_id}/reject",
            members::reject,
        )
        .post(
            "/api/v1/gyms/{id}/members/{user_id}/remove",
            members::remove,
        )
        .post(
            "/api/v1/gyms/{id}/members/{user_id}/coach",
            members::appoint,
        )
        .delete(
            "/api/v1/gyms/{id}/members/{user_id}/coach",
            members::dismiss,
        )
}

/// A gym id from a path; a malformed one names no gym.
pub fn gym_param(raw: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(raw).map_err(|_| AppError::not_found("Gym"))
}

/// Who manages a gym: its owner while they are a gym admin and the gym is verified, or staff.
pub fn can_manage(user: &AuthUser, owner: Option<Uuid>, verified: bool) -> bool {
    (owner == Some(user.id) && user.role == Role::GymAdmin && verified)
        || matches!(user.role, Role::Admin | Role::SuperAdmin)
}

/// 404 for an unknown gym, 403 unless `user` manages it.
pub async fn manageable(db: &MySqlPool, user: &AuthUser, gym: Uuid) -> Result<(), AppError> {
    let row = sqlx::query!(
        r#"SELECT owner_user_id AS "owner: Uuid", status FROM gyms WHERE id = ?"#,
        gym
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::not_found("Gym"))?;
    if can_manage(user, row.owner, row.status == "VERIFIED") {
        Ok(())
    } else {
        Err(AppError::forbidden().detail("Only this gym's admin can do that."))
    }
}
