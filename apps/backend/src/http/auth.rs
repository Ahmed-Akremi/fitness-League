//! Who is calling. A handler obtains the signed-in user only through one of these extractors, and
//! the type it asks for names who may pass. There is no way to read the user without choosing one.

use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts},
};
use chrono::Utc;
use uuid::Uuid;

use super::rate_limit;
use crate::{
    error::AppError,
    modules::auth::accounts,
    security::tokens::{Audience, TokenError},
    state::AppState,
    types::Role,
};

pub struct AuthUser {
    pub id: Uuid,
    pub role: Role,
    pub email_verified: bool,
}

/// A signed-in account of the app: every role except the judge roles, which only exist in the panel.
pub struct AppUser(pub AuthUser);

/// Someone signed in to the admin panel: staff, and judges.
pub struct PanelUser(pub AuthUser);

impl FromRequestParts<AppState> for AppUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        authenticate(parts, state, Audience::App, |role| !role.is_judge())
            .await
            .map(Self)
    }
}

impl FromRequestParts<AppState> for PanelUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        authenticate(parts, state, Audience::Admin, Role::can_open_panel)
            .await
            .map(Self)
    }
}

/// The token proves who signed in; the row read here says what they are today. A ban, a role change
/// or a password reset therefore applies on the very next request, without waiting for the token to
/// expire.
async fn authenticate(
    parts: &Parts,
    state: &AppState,
    audience: Audience,
    allowed: fn(Role) -> bool,
) -> Result<AuthUser, AppError> {
    let invalid = || AppError::unauthenticated("TOKEN_INVALID", "Invalid access token");
    let token = parts
        .headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::unauthenticated("UNAUTHENTICATED", "Authentication required"))?;
    let claims = state
        .tokens
        .verify_access(token, audience)
        .map_err(|e| match e {
            TokenError::Expired => {
                AppError::unauthenticated("TOKEN_EXPIRED", "Invalid access token")
            }
            TokenError::Invalid => invalid(),
        })?;
    let user = sqlx::query!(
        r#"SELECT role AS "role: Role", status, session_version, email_verified_at, suspended_until
           FROM users WHERE id = ?"#,
        claims.user_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(invalid)?;
    if user.status == "DELETED" || user.session_version != claims.session_version {
        return Err(invalid());
    }
    accounts::refuse_if_barred(&user.status, user.suspended_until, Utc::now().naive_utc())?;
    // The role of the row, not of the token.
    if !allowed(user.role) {
        return Err(AppError::forbidden());
    }
    rate_limit::check(state, &rate_limit::GLOBAL_USER, &claims.user_id.to_string()).await?;
    tracing::Span::current().record("user_id", tracing::field::display(claims.user_id));
    Ok(AuthUser {
        id: claims.user_id,
        role: user.role,
        email_verified: user.email_verified_at.is_some(),
    })
}
