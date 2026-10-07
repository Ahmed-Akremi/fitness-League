//! The links sent by email: confirming an address, choosing a new password.
//! The worker creates a link and sends it; the API consumes it. Only the hash of a token is stored,
//! and the token is never written to Redis or to a log.

use chrono::{Duration, Utc};
use uuid::Uuid;

use crate::{
    db,
    jobs::{Job, JobKind},
    mail::{self, Mailer},
    security::tokens,
    state::AppState,
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
