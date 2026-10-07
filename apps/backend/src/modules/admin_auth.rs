//! `/admin/auth/*` and `/admin/me`: the session of the admin panel.
//! Email and password, no second factor (the owner's decision); every sign-in is audited.

use axum::{Json, extract::State, http::StatusCode};
use serde_json::{Value, json};

use super::auth::{
    self, LoginBody, RefreshBody,
    sessions::{self, Session},
};
use crate::{
    audit,
    error::AppError,
    http::{
        Api,
        auth::PanelUser,
        rate_limit::{self, ClientIp},
    },
    security::tokens::Audience,
    state::AppState,
    validate::ValidJson,
};

pub fn routes(api: Api) -> Api {
    api.post("/api/v1/admin/auth/login", login)
        .post("/api/v1/admin/auth/refresh", refresh)
        .post("/api/v1/admin/auth/logout", logout)
        .get("/api/v1/admin/me", me)
}

async fn login(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<LoginBody>,
) -> Result<Json<Value>, AppError> {
    let holder = auth::sign_in(&state, &client, body).await?;
    if !holder.role.can_open_panel() {
        return Err(AppError::forbidden().detail("Staff accounts only."));
    }
    let session = sessions::start(&state, holder, Audience::Admin).await?;
    let event = audit::Event {
        actor: Some((holder.id, holder.role)),
        action: "ADMIN_LOGIN",
        user_id: holder.id,
        after: None,
    };
    audit::record(&state.db, event).await?;
    Ok(Json(json!({"session": session})))
}

async fn refresh(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<RefreshBody>,
) -> Result<Json<Session>, AppError> {
    rate_limit::check(&state, &rate_limit::REFRESH_IP, &client.subject()).await?;
    Ok(Json(
        sessions::refresh(&state, &body.refresh_token, Audience::Admin).await?,
    ))
}

async fn logout(
    State(state): State<AppState>,
    PanelUser(user): PanelUser,
    ValidJson(body): ValidJson<RefreshBody>,
) -> Result<StatusCode, AppError> {
    sessions::logout(&state, user.id, &body.refresh_token).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// What the panel needs to draw itself: who is signed in, and with which role.
async fn me(
    State(state): State<AppState>,
    PanelUser(user): PanelUser,
) -> Result<Json<Value>, AppError> {
    let row = sqlx::query!("SELECT email, username FROM users WHERE id = ?", user.id)
        .fetch_one(&state.db)
        .await?;
    Ok(Json(json!({
        "id": user.id.to_string(),
        "email": row.email,
        "username": row.username,
        "role": user.role.as_str(),
    })))
}
