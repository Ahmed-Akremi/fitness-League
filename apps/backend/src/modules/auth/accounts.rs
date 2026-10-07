//! Accounts: who may sign in, and what the answer is when they may not.

use axum::http::StatusCode;
use chrono::{Duration, NaiveDate, NaiveDateTime, Utc};
use serde_json::json;
use uuid::Uuid;

use super::sessions::{self, Holder, Session};
use crate::{
    audit, db,
    error::AppError,
    jobs::{self, JobKind},
    rules::Rules,
    security::{password::password_problem, policy, tokens::Audience},
    state::AppState,
    types::{Gender, Locale, Role, iso},
};

/// A banned account, or one suspended for now, is refused wherever it proves who it is: at sign-in,
/// at refresh, and on every request.
pub fn refuse_if_barred(
    status: &str,
    suspended_until: Option<NaiveDateTime>,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    match status {
        "BANNED" => Err(AppError::new(
            StatusCode::FORBIDDEN,
            "ACCOUNT_BANNED",
            "Account banned",
        )),
        // No end date means until a moderator lifts it.
        "SUSPENDED" if suspended_until.is_none_or(|until| until > now) => Err(AppError::new(
            StatusCode::FORBIDDEN,
            "ACCOUNT_SUSPENDED",
            "Account suspended",
        )
        .with("suspendedUntil", suspended_until.map(iso))),
        _ => Ok(()),
    }
}

/// A registration whose every field passed its own rule.
pub struct Registration {
    pub username: String,
    pub full_name: String,
    /// Normalised: see `validate::normalise_email`.
    pub email: String,
    pub password: String,
    pub date_of_birth: NaiveDate,
    pub country_code: String,
    pub governorate_id: Uuid,
    pub city_id: Uuid,
    pub phone: Option<String>,
    pub gender: Option<Gender>,
    pub locale: Locale,
    pub health_data: bool,
    pub marketing: bool,
    pub document_version: String,
}

pub async fn register(state: &AppState, r: Registration) -> Result<Session, AppError> {
    if let Some(code) = password_problem(&r.password, &r.email, &r.username) {
        return Err(AppError::field("password", code));
    }
    // The age gate comes before anything is stored about the person.
    let rules = Rules::active(&state.db).await?;
    let today = policy::business_today(Utc::now(), state.cfg.business_utc_offset_minutes);
    if policy::age_in_years(r.date_of_birth, today) < rules.min_age_years {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "UNDER_AGE",
            "Minimum age not reached",
        )
        .with("minAgeYears", rules.min_age_years));
    }
    let places = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "n!: i64"
           FROM cities c
           JOIN governorates g ON g.id = c.governorate_id
           JOIN countries k ON k.code = g.country_code
           WHERE c.id = ? AND g.id = ? AND g.country_code = ? AND k.enabled"#,
        r.city_id,
        r.governorate_id,
        r.country_code
    )
    .fetch_one(&state.db)
    .await?;
    if places != 1 {
        return Err(AppError::field("cityId", "NOT_IN_GOVERNORATE"));
    }

    let password_hash = state.passwords.hash(r.password).await?;
    let id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    let inserted = sqlx::query!(
        "INSERT INTO users (id, email, username, password_hash, date_of_birth, phone_e164) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        r.email,
        r.username,
        password_hash,
        r.date_of_birth,
        r.phone
    )
    .execute(&mut *tx)
    .await;
    if let Err(e) = inserted {
        // Which one is taken is what the database says: its idea of "the same email" is the one
        // that counts, and two registrations at the same instant are settled by its index.
        let taken = db::duplicate_key(&e).map(str::to_owned);
        return Err(match taken.as_deref() {
            Some("uq_users_email") => AppError::conflict("EMAIL_TAKEN"),
            Some("uq_users_username") => AppError::conflict("USERNAME_TAKEN"),
            Some("uq_users_phone") => AppError::conflict("PHONE_TAKEN"),
            _ => e.into(),
        });
    }
    sqlx::query!(
        "INSERT INTO profiles (user_id, full_name, gender, country_code, governorate_id, city_id) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        r.full_name,
        r.gender.map(Gender::as_str),
        r.country_code,
        r.governorate_id,
        r.city_id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "INSERT INTO user_settings (user_id, locale) VALUES (?, ?)",
        id,
        r.locale.as_str()
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!("INSERT INTO user_stats (user_id) VALUES (?)", id)
        .execute(&mut *tx)
        .await?;
    sqlx::query!("INSERT INTO user_streaks (user_id) VALUES (?)", id)
        .execute(&mut *tx)
        .await?;
    for (kind, granted) in [
        ("TERMS", true),
        ("PRIVACY", true),
        ("HEALTH_DATA", r.health_data),
        ("MARKETING", r.marketing),
    ] {
        sqlx::query!(
            "INSERT INTO consents (id, user_id, type, document_version, granted) VALUES (?, ?, ?, ?, ?)",
            Uuid::now_v7(),
            id,
            kind,
            r.document_version,
            granted
        )
        .execute(&mut *tx)
        .await?;
    }
    let event = audit::Event {
        actor: Some((id, Role::User)),
        action: "USER_REGISTERED",
        user_id: id,
        after: Some(json!({"via": "PASSWORD"})),
    };
    audit::record(&mut *tx, event).await?;
    let holder = Holder {
        id,
        role: Role::User,
        session_version: 1,
    };
    let session = sessions::issue(
        state,
        &mut tx,
        holder,
        Uuid::now_v7(),
        Uuid::now_v7(),
        Audience::App,
    )
    .await?;
    tx.commit().await?;

    // The mail is the worker's business. A queue that is down must not undo a registration: the
    // person can ask for another link once signed in.
    if jobs::enqueue(state, JobKind::EmailVerify, id)
        .await
        .is_err()
    {
        tracing::warn!(user_id = %id, "the verification email could not be queued");
    }
    Ok(session)
}

/// Checks an email and a password, with the lockout. Shared by the app and the admin panel.
/// `email` is already normalised. What the account is (banned, suspended) is only told to someone
/// who gave the right password.
pub async fn check_credentials(
    state: &AppState,
    email: &str,
    password: String,
) -> Result<Holder, AppError> {
    let wrong = || AppError::unauthenticated("INVALID_CREDENTIALS", "Invalid email or password");
    let user = sqlx::query!(
        r#"SELECT id AS "id: Uuid", password_hash, role AS "role: Role", status, session_version,
                  locked_until, suspended_until
           FROM users WHERE email = ?"#,
        email
    )
    .fetch_optional(&state.db)
    .await?;
    let Some(user) = user.filter(|user| user.status != "DELETED") else {
        // The same work as for a real account: the time taken must not tell which emails exist.
        state.passwords.verify(None, password).await;
        return Err(wrong());
    };
    let now = Utc::now().naive_utc();
    if let Some(until) = user.locked_until.filter(|until| *until > now) {
        let seconds = u64::try_from((until - now).num_seconds()).unwrap_or(0) + 1;
        return Err(AppError::new(
            StatusCode::LOCKED,
            "ACCOUNT_LOCKED",
            "Account temporarily locked",
        )
        .with("lockedUntil", iso(until))
        .retry_after(seconds));
    }
    if !state.passwords.verify(user.password_hash, password).await {
        record_failure(state, user.id).await?;
        return Err(wrong());
    }
    refuse_if_barred(&user.status, user.suspended_until, now)?;
    Ok(Holder {
        id: user.id,
        role: user.role,
        session_version: user.session_version,
    })
}

/// Counts a wrong password. Every fifth in a row locks the account, for longer each time.
async fn record_failure(state: &AppState, user: Uuid) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    // The update holds the row until the commit: two failures at the same instant count as two.
    sqlx::query!(
        "UPDATE users SET failed_login_count = failed_login_count + 1 WHERE id = ?",
        user
    )
    .execute(&mut *tx)
    .await?;
    let failures = sqlx::query_scalar!("SELECT failed_login_count FROM users WHERE id = ?", user)
        .fetch_one(&mut *tx)
        .await?;
    let lock = policy::lock_minutes(u32::try_from(failures).unwrap_or(u32::MAX));
    if let Some(minutes) = lock {
        let until = Utc::now().naive_utc() + Duration::minutes(i64::from(minutes));
        sqlx::query!(
            "UPDATE users SET locked_until = ? WHERE id = ?",
            until,
            user
        )
        .execute(&mut *tx)
        .await?;
        let event = audit::Event {
            actor: None,
            action: "ACCOUNT_LOCKED",
            user_id: user,
            after: Some(json!({"minutes": minutes, "failedLoginCount": failures})),
        };
        audit::record(&mut *tx, event).await?;
    }
    tx.commit().await?;
    // The owner is told by mail. If the queue is down the lock still holds.
    if lock.is_some()
        && jobs::enqueue(state, JobKind::AccountLocked, user)
            .await
            .is_err()
    {
        tracing::warn!(user_id = %user, "the lock notice could not be queued");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use chrono::{Duration, Utc};

    use super::*;

    #[test]
    fn only_a_ban_or_a_running_suspension_refuses() {
        let now = Utc::now().naive_utc();
        let code = |status, until| refuse_if_barred(status, until, now).err().map(|e| e.code);
        assert_eq!(code("ACTIVE", None), None);
        assert_eq!(code("BANNED", None), Some("ACCOUNT_BANNED"));
        assert_eq!(code("SUSPENDED", None), Some("ACCOUNT_SUSPENDED"));
        assert_eq!(
            code("SUSPENDED", Some(now + Duration::minutes(1))),
            Some("ACCOUNT_SUSPENDED")
        );
        assert_eq!(code("SUSPENDED", Some(now - Duration::minutes(1))), None);
    }
}
