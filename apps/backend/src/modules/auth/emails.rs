//! The links sent by email: confirming an address, choosing a new password.
//! The worker creates a link and sends it; the API consumes it. Only the hash of a token is stored,
//! and the token is never written to Redis or to a log.

use axum::http::StatusCode;
use chrono::{Duration, Utc};
use sqlx::MySqlConnection;
use uuid::Uuid;

use super::sessions;
use crate::{
    audit, db,
    error::AppError,
    jobs::{self, Job, JobKind},
    mail::{self, Mailer},
    security::{password::password_problem, tokens},
    state::AppState,
    types::Role,
};

const VERIFY_HOURS: i64 = 24;
const RESET_HOURS: i64 = 1;

/// Runs one email job. Safe to run twice: the second run sends a second mail, whose link replaces
/// the first.
pub async fn handle(state: &AppState, mailer: &Mailer, job: Job) -> Result<(), String> {
    let describe = |e: sqlx::Error| db::describe(&e);
    let user = sqlx::query!(
        "SELECT u.email, u.status, u.email_verified_at, s.locale \
         FROM users u JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?",
        job.user_id
    )
    .fetch_optional(&state.db)
    .await
    .map_err(describe)?;
    // The account may have gone since the job was queued.
    let Some(user) = user.filter(|user| user.status != "DELETED") else {
        return Ok(());
    };
    let (purpose, path, hours) = match job.kind {
        JobKind::EmailVerify if user.email_verified_at.is_some() => return Ok(()),
        JobKind::EmailVerify => (Some("EMAIL_VERIFY"), "/verify-email", VERIFY_HOURS),
        JobKind::PasswordReset if user.status == "BANNED" => return Ok(()),
        JobKind::PasswordReset => (Some("PASSWORD_RESET"), "/reset-password", RESET_HOURS),
        JobKind::AccountLocked => (None, "/forgot-password", 0),
    };

    let mut link = format!("{}{path}", state.cfg.app_link_base_url);
    if let Some(purpose) = purpose {
        let (token, hash) = tokens::new_opaque().map_err(|_| "no random bytes".to_owned())?;
        let now = Utc::now().naive_utc();
        let mut tx = state.db.begin().await.map_err(describe)?;
        // One link at a time per account. The row is held until the commit, so a second worker
        // running the same job waits, then cancels this link like any older one. Without it, two
        // workers starting when no link is alive would each leave one.
        sqlx::query!("SELECT id FROM users WHERE id = ? FOR UPDATE", job.user_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(describe)?;
        // A new link cancels the older ones. A link belongs to the account, not to the address it
        // was sent to: nothing in this part changes an address, and whatever does later must cancel
        // the links still alive.
        sqlx::query!(
            "UPDATE email_tokens SET consumed_at = ? WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL",
            now,
            job.user_id,
            purpose
        )
        .execute(&mut *tx)
        .await
        .map_err(describe)?;
        sqlx::query!(
            "INSERT INTO email_tokens (id, user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
            Uuid::now_v7(),
            job.user_id,
            purpose,
            &hash[..],
            now + Duration::hours(hours)
        )
        .execute(&mut *tx)
        .await
        .map_err(describe)?;
        tx.commit().await.map_err(describe)?;
        link = format!("{link}?token={token}");
    }

    let (subject, text) = mail::render(job.kind, &user.locale, &state.cfg.app_name, &link);
    mailer.send(&user.email, &subject, &text).await
}

fn bad_link() -> AppError {
    AppError::new(
        StatusCode::UNPROCESSABLE_ENTITY,
        "TOKEN_INVALID",
        "Invalid or expired link",
    )
}

/// Uses a link up and returns whose it was. One statement decides, so of two requests with the same
/// link exactly one changes the row.
async fn consume(tx: &mut MySqlConnection, token: &str, purpose: &str) -> Result<Uuid, AppError> {
    let hash = tokens::hash_opaque(token);
    let used = sqlx::query!(
        "UPDATE email_tokens SET consumed_at = UTC_TIMESTAMP(6) \
         WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP(6)",
        &hash[..],
        purpose
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if used != 1 {
        return Err(bad_link());
    }
    Ok(sqlx::query_scalar!(
        r#"SELECT user_id AS "user_id: Uuid" FROM email_tokens WHERE token_hash = ?"#,
        &hash[..]
    )
    .fetch_one(&mut *tx)
    .await?)
}

pub async fn verify_email(state: &AppState, token: &str) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    let user = consume(&mut tx, token, "EMAIL_VERIFY").await?;
    sqlx::query!(
        "UPDATE users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP(6)) WHERE id = ?",
        user
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Queues a reset mail when the address belongs to an account that may reset. Nothing here tells
/// the caller which case it was: the route answers 202 in all of them.
pub async fn request_reset(state: &AppState, email: &str) -> Result<(), AppError> {
    let user = sqlx::query_scalar!(
        r#"SELECT id AS "id: Uuid" FROM users WHERE email = ? AND status NOT IN ('DELETED', 'BANNED')"#,
        email
    )
    .fetch_optional(&state.db)
    .await?;
    if let Some(user) = user
        && jobs::enqueue(state, JobKind::PasswordReset, user)
            .await
            .is_err()
    {
        // An error here would answer differently for an address that exists.
        tracing::error!(user_id = %user, "the reset email could not be queued");
    }
    Ok(())
}

/// Sets a new password and signs the account out everywhere.
pub async fn reset_password(
    state: &AppState,
    token: &str,
    new_password: String,
) -> Result<(), AppError> {
    let hash = tokens::hash_opaque(token);
    // Looked at first, used up later: a password the policy refuses must leave the link usable.
    let owner = sqlx::query!(
        r#"SELECT u.id AS "id: Uuid", u.email, u.username, u.role AS "role: Role"
           FROM email_tokens t JOIN users u ON u.id = t.user_id
           WHERE t.token_hash = ? AND t.purpose = 'PASSWORD_RESET' AND t.consumed_at IS NULL
             AND t.expires_at > UTC_TIMESTAMP(6) AND u.status NOT IN ('DELETED', 'BANNED')"#,
        &hash[..]
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(bad_link)?;
    if let Some(code) = password_problem(&new_password, &owner.email, &owner.username) {
        return Err(AppError::field("newPassword", code));
    }
    let password_hash = state.passwords.hash(new_password).await?;

    let mut tx = state.db.begin().await?;
    consume(&mut tx, token, "PASSWORD_RESET").await?;
    sqlx::query!(
        "UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?",
        password_hash,
        owner.id
    )
    .execute(&mut *tx)
    .await?;
    // Every session ends: the old password may be why the reset was asked for.
    sessions::end_all(&mut tx, owner.id).await?;
    let event = audit::Event {
        actor: Some((owner.id, owner.role)),
        action: "PASSWORD_RESET",
        user_id: owner.id,
        after: None,
    };
    audit::record(&mut *tx, event).await?;
    tx.commit().await?;
    Ok(())
}
