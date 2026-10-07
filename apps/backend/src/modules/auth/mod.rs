//! `/auth/*`: registration, sign-in, sessions and the links sent by email.

pub mod accounts;
pub mod emails;
pub mod sessions;

use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;

use self::sessions::Session;
use crate::{
    error::AppError,
    http::{
        Api,
        auth::AppUser,
        rate_limit::{self, ClientIp},
    },
    security::tokens::Audience,
    state::AppState,
    validate::{Check, ValidJson, Validate},
};

pub fn routes(api: Api) -> Api {
    api.post("/api/v1/auth/refresh", refresh)
        .post("/api/v1/auth/logout", logout)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RefreshBody {
    pub refresh_token: String,
}

impl Validate for RefreshBody {
    fn validate(&self, check: &mut Check) {
        check.length("refreshToken", &self.refresh_token, 20, 200);
    }
}

async fn refresh(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<RefreshBody>,
) -> Result<Json<Session>, AppError> {
    rate_limit::check(&state, &rate_limit::REFRESH_IP, &client.subject()).await?;
    Ok(Json(
        sessions::refresh(&state, &body.refresh_token, Audience::App).await?,
    ))
}

async fn logout(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<RefreshBody>,
) -> Result<StatusCode, AppError> {
    sessions::logout(&state, user.id, &body.refresh_token).await?;
    Ok(StatusCode::NO_CONTENT)
}
