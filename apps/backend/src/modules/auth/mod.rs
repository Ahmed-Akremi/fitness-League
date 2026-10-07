//! `/auth/*`: registration, sign-in, sessions and the links sent by email.

pub mod accounts;
pub mod emails;
pub mod sessions;

use axum::{Json, extract::State, http::StatusCode};
use chrono::{Datelike, NaiveDate};
use serde::Deserialize;
use uuid::Uuid;

use self::{
    accounts::Registration,
    sessions::{Holder, Session},
};
use crate::{
    error::AppError,
    http::{
        Api,
        auth::AppUser,
        rate_limit::{self, ClientIp},
    },
    jobs::{self, JobKind},
    security::{password, tokens::Audience},
    state::AppState,
    types::{Gender, Locale},
    validate::{Check, ValidJson, Validate, normalise_email},
};

pub fn routes(api: Api) -> Api {
    api.post("/api/v1/auth/register", register)
        .post("/api/v1/auth/login", login)
        .post("/api/v1/auth/refresh", refresh)
        .post("/api/v1/auth/logout", logout)
        .post("/api/v1/auth/email/verify", verify_email)
        .post("/api/v1/auth/email/resend", resend_verification)
        .post("/api/v1/auth/password/forgot", forgot_password)
        .post("/api/v1/auth/password/reset", reset_password)
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConsentsBody {
    terms: bool,
    privacy: bool,
    health_data: bool,
    marketing: Option<bool>,
    document_version: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RegisterBody {
    username: String,
    full_name: String,
    email: String,
    password: String,
    date_of_birth: String,
    country_code: String,
    governorate_id: Uuid,
    city_id: Uuid,
    phone: Option<String>,
    gender: Option<Gender>,
    locale: Option<Locale>,
    consents: ConsentsBody,
}

/// A calendar date written `YYYY-MM-DD`, in 1900 or later.
fn parse_date(raw: &str) -> Option<NaiveDate> {
    let shaped = raw.len() == 10
        && raw.bytes().enumerate().all(|(i, b)| match i {
            4 | 7 => b == b'-',
            _ => b.is_ascii_digit(),
        });
    if !shaped {
        return None;
    }
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .ok()
        .filter(|date| date.year() >= 1900)
}

/// `+` and 8 to 15 digits, the first of which is not 0 (E.164).
fn is_phone(raw: &str) -> bool {
    raw.strip_prefix('+').is_some_and(|digits| {
        (8..=15).contains(&digits.len())
            && !digits.starts_with('0')
            && digits.bytes().all(|b| b.is_ascii_digit())
    })
}

impl Validate for RegisterBody {
    fn validate(&self, check: &mut Check) {
        let username_ok = (3..=20).contains(&self.username.len())
            && self
                .username
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'.');
        check.ensure("username", username_ok, "MATCHES");
        check.length("fullName", self.full_name.trim(), 2, 80);
        check.ensure(
            "fullName",
            !self.full_name.chars().any(char::is_control),
            "MATCHES",
        );
        check.ensure("email", normalise_email(&self.email).is_some(), "ISEMAIL");
        check.length(
            "password",
            &self.password,
            password::MIN_LENGTH,
            password::MAX_LENGTH,
        );
        check.ensure(
            "dateOfBirth",
            parse_date(&self.date_of_birth).is_some(),
            "ISISO8601",
        );
        let country_ok = self.country_code.len() == 2
            && self.country_code.bytes().all(|b| b.is_ascii_uppercase());
        check.ensure("countryCode", country_ok, "MATCHES");
        if let Some(phone) = &self.phone {
            check.ensure("phone", is_phone(phone), "MATCHES");
        }
        check.ensure("consents.terms", self.consents.terms, "EQUALS");
        check.ensure("consents.privacy", self.consents.privacy, "EQUALS");
        check.length(
            "consents.documentVersion",
            &self.consents.document_version,
            1,
            20,
        );
    }
}

impl RegisterBody {
    /// The validated body in the form the account module works with.
    fn into_registration(self) -> Result<Registration, AppError> {
        Ok(Registration {
            email: normalise_email(&self.email)
                .ok_or_else(|| AppError::field("email", "ISEMAIL"))?,
            date_of_birth: parse_date(&self.date_of_birth)
                .ok_or_else(|| AppError::field("dateOfBirth", "ISISO8601"))?,
            username: self.username,
            full_name: self.full_name.trim().to_owned(),
            password: self.password,
            country_code: self.country_code,
            governorate_id: self.governorate_id,
            city_id: self.city_id,
            phone: self.phone,
            gender: self.gender,
            locale: self.locale.unwrap_or(Locale::Fr),
            health_data: self.consents.health_data,
            marketing: self.consents.marketing.unwrap_or(false),
            document_version: self.consents.document_version,
        })
    }
}

async fn register(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<RegisterBody>,
) -> Result<(StatusCode, Json<Session>), AppError> {
    rate_limit::check(&state, &rate_limit::REGISTER_IP, &client.subject()).await?;
    let session = accounts::register(&state, body.into_registration()?).await?;
    Ok((StatusCode::CREATED, Json(session)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginBody {
    pub email: String,
    pub password: String,
}

impl Validate for LoginBody {
    fn validate(&self, check: &mut Check) {
        check.ensure("email", normalise_email(&self.email).is_some(), "ISEMAIL");
        // No minimum: a short password is simply a wrong one.
        check.length("password", &self.password, 0, password::MAX_LENGTH);
    }
}

/// What the app's sign-in and the panel's share: both limits, then the credentials.
pub async fn sign_in(
    state: &AppState,
    client: &ClientIp,
    body: LoginBody,
) -> Result<Holder, AppError> {
    let email = normalise_email(&body.email).ok_or_else(|| AppError::field("email", "ISEMAIL"))?;
    rate_limit::check(state, &rate_limit::LOGIN_IP, &client.subject()).await?;
    rate_limit::check(state, &rate_limit::LOGIN_ACCOUNT, &email).await?;
    accounts::check_credentials(state, &email, body.password).await
}

async fn login(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<LoginBody>,
) -> Result<Json<Session>, AppError> {
    let holder = sign_in(&state, &client, body).await?;
    // Judges only judge, in the admin panel. Said after the password was checked, like every other
    // fact about an account.
    if holder.role.is_judge() {
        return Err(
            AppError::new(StatusCode::FORBIDDEN, "JUDGE_ACCOUNT", "Forbidden")
                .detail("Judge accounts sign in to the admin panel."),
        );
    }
    Ok(Json(sessions::start(&state, holder, Audience::App).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TokenBody {
    token: String,
}

impl Validate for TokenBody {
    fn validate(&self, check: &mut Check) {
        check.length("token", &self.token, 20, 200);
    }
}

async fn verify_email(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<TokenBody>,
) -> Result<StatusCode, AppError> {
    rate_limit::check(&state, &rate_limit::VERIFY_IP, &client.subject()).await?;
    emails::verify_email(&state, &body.token).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// No body: the app sends none. Whether a mail was really queued is not said.
async fn resend_verification(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<StatusCode, AppError> {
    rate_limit::check(&state, &rate_limit::RESEND_USER, &user.id.to_string()).await?;
    if !user.email_verified {
        jobs::enqueue(&state, JobKind::EmailVerify, user.id).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ForgotBody {
    email: String,
}

impl Validate for ForgotBody {
    fn validate(&self, check: &mut Check) {
        check.ensure("email", normalise_email(&self.email).is_some(), "ISEMAIL");
    }
}

async fn forgot_password(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<ForgotBody>,
) -> Result<StatusCode, AppError> {
    let email = normalise_email(&body.email).ok_or_else(|| AppError::field("email", "ISEMAIL"))?;
    rate_limit::check(&state, &rate_limit::FORGOT_IP, &client.subject()).await?;
    // Counted by the address that was typed, whether or not an account has it.
    rate_limit::check(&state, &rate_limit::FORGOT_ACCOUNT, &email).await?;
    emails::request_reset(&state, &email).await?;
    Ok(StatusCode::ACCEPTED)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ResetBody {
    token: String,
    new_password: String,
}

impl Validate for ResetBody {
    fn validate(&self, check: &mut Check) {
        check.length("token", &self.token, 20, 200);
        check.length(
            "newPassword",
            &self.new_password,
            password::MIN_LENGTH,
            password::MAX_LENGTH,
        );
    }
}

async fn reset_password(
    State(state): State<AppState>,
    client: ClientIp,
    ValidJson(body): ValidJson<ResetBody>,
) -> Result<StatusCode, AppError> {
    rate_limit::check(&state, &rate_limit::RESET_IP, &client.subject()).await?;
    emails::reset_password(&state, &body.token, body.new_password).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    #[test]
    fn a_date_is_ten_characters_and_a_real_day() {
        assert_eq!(
            parse_date("1998-04-12"),
            NaiveDate::from_ymd_opt(1998, 4, 12)
        );
        for bad in [
            "1998-4-12",
            "98-04-12",
            "1998/04/12",
            "1998-04-12T00:00:00Z",
            "1998-13-01",
            "2001-02-29",
            "1899-12-31",
            "",
        ] {
            assert_eq!(parse_date(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_phone_number_is_international() {
        assert!(is_phone("+21620123456"));
        for bad in [
            "21620123456",
            "+0620123456",
            "+2162012",
            "+21620123456789012",
            "+2162012345a",
            "+",
        ] {
            assert!(!is_phone(bad), "{bad}");
        }
    }
}
