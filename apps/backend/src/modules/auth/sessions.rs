//! Sessions: a short access token and a single-use refresh token.
//!
//! Every use of a refresh token replaces it. A token presented a second time was copied: the whole
//! family (every token descended from one sign-in) is revoked. Only the hash of a token is stored.

use chrono::{Duration, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::{MySqlConnection, MySqlExecutor};
use uuid::Uuid;

use super::accounts;
use crate::{
    audit,
    error::AppError,
    security::tokens::{self, Audience},
    state::AppState,
    types::Role,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub access_token: String,
    /// Seconds until the access token expires.
    pub expires_in: u64,
    pub refresh_token: String,
    pub user_id: String,
}

/// Who a session is for. The role and the session version are copied into the access token.
#[derive(Debug, Clone, Copy)]
pub struct Holder {
    pub id: Uuid,
    pub role: Role,
    pub session_version: i32,
}

/// Stores a new refresh token under `id` in `family` and signs the access token that goes with it.
pub async fn issue(
    state: &AppState,
    tx: &mut MySqlConnection,
    holder: Holder,
    id: Uuid,
    family: Uuid,
    audience: Audience,
) -> Result<Session, AppError> {
    let (refresh_token, hash) = tokens::new_opaque()?;
    let expires_at = Utc::now().naive_utc() + Duration::days(state.cfg.refresh_token_ttl_days);
    sqlx::query!(
        "INSERT INTO refresh_tokens (id, user_id, family_id, audience, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        holder.id,
        family,
        audience.as_str(),
        &hash[..],
        expires_at
    )
    .execute(&mut *tx)
    .await?;
    let (access_token, expires_in) =
        state
            .tokens
            .sign_access(holder.id, holder.role, holder.session_version, audience)?;
    Ok(Session {
        access_token,
        expires_in,
        refresh_token,
        user_id: holder.id.to_string(),
    })
}

/// Opens a session after a successful sign-in. The failure counter is cleared, and an account
/// deletion that was waiting out its grace period is cancelled: signing in again is how one changes
/// one's mind.
pub async fn start(
    state: &AppState,
    holder: Holder,
    audience: Audience,
) -> Result<Session, AppError> {
    let now = Utc::now().naive_utc();
    let mut tx = state.db.begin().await?;
    sqlx::query!(
        "UPDATE deletion_requests SET status = 'CANCELLED' WHERE user_id = ? AND status = 'PENDING'",
        holder.id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?",
        now,
        holder.id
    )
    .execute(&mut *tx)
    .await?;
    let session = issue(
        state,
        &mut tx,
        holder,
        Uuid::now_v7(),
        Uuid::now_v7(),
        audience,
    )
    .await?;
    tx.commit().await?;
    Ok(session)
}

pub async fn revoke_family<'e>(
    db: impl MySqlExecutor<'e>,
    family: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(6) WHERE family_id = ? AND revoked_at IS NULL",
        family
    )
    .execute(db)
    .await
    .map(|_| ())
}

/// Ends every session of an account at once: the access tokens, through the version they carry,
/// and the refresh tokens. The two are changed here together and nowhere else for a whole account,
/// so a password reset or a role change can never leave a refresh token able to mint new access.
pub async fn end_all(tx: &mut MySqlConnection, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE users SET session_version = session_version + 1 WHERE id = ?",
        user
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(6) WHERE user_id = ? AND revoked_at IS NULL",
        user
    )
    .execute(&mut *tx)
    .await
    .map(|_| ())
}

/// The token was copied: every session descended from that sign-in ends, and the event is recorded.
async fn reused(state: &AppState, user: Uuid, family: Uuid) -> AppError {
    let recorded = async {
        let mut tx = state.db.begin().await?;
        let revoked = sqlx::query!(
            "UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(6) WHERE family_id = ? AND revoked_at IS NULL",
            family
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        // The first time the copy is noticed, the access tokens already handed out die with the
        // family: whoever used the copy is out at once, not when their token expires. The other
        // devices of the owner renew theirs with their own refresh tokens. Not on a later replay of
        // the same dead token: its holder could otherwise disturb the account for ever.
        if revoked > 0 {
            sqlx::query!(
                "UPDATE users SET session_version = session_version + 1 WHERE id = ?",
                user
            )
            .execute(&mut *tx)
            .await?;
        }
        let event = audit::Event {
            actor: None,
            action: "REFRESH_TOKEN_REUSE_DETECTED",
            user_id: user,
            after: Some(json!({"familyId": family.to_string()})),
        };
        audit::record(&mut *tx, event).await?;
        tx.commit().await
    };
    if let Err(e) = recorded.await {
        return e.into();
    }
    tracing::warn!(user_id = %user, "refresh token reuse detected; the session family is revoked");
    AppError::unauthenticated("TOKEN_REUSED", "Invalid refresh token")
}

pub async fn refresh(
    state: &AppState,
    refresh_token: &str,
    audience: Audience,
) -> Result<Session, AppError> {
    let invalid = || AppError::unauthenticated("TOKEN_INVALID", "Invalid refresh token");
    let hash = tokens::hash_opaque(refresh_token);
    let row = sqlx::query!(
        r#"SELECT t.id AS "id: Uuid", t.user_id AS "user_id: Uuid", t.family_id AS "family_id: Uuid",
                  t.audience, t.replaced_by_id AS "replaced_by_id: Uuid", t.expires_at, t.revoked_at,
                  u.role AS "role: Role", u.status, u.session_version, u.suspended_until
           FROM refresh_tokens t JOIN users u ON u.id = t.user_id
           WHERE t.token_hash = ?"#,
        &hash[..]
    )
    .fetch_optional(&state.db)
    .await?;
    // Each refresh endpoint accepts its own kind of session only.
    let Some(row) = row.filter(|row| row.audience == audience.as_str()) else {
        return Err(invalid());
    };
    let now = Utc::now().naive_utc();
    if row.revoked_at.is_some() {
        // Revoked because it was used: someone holds a copy.
        if row.replaced_by_id.is_some() {
            return Err(reused(state, row.user_id, row.family_id).await);
        }
        return Err(invalid());
    }
    if row.expires_at <= now {
        return Err(AppError::unauthenticated(
            "TOKEN_EXPIRED",
            "Refresh token expired",
        ));
    }
    if row.status == "DELETED" {
        return Err(invalid());
    }
    if let Err(barred) = accounts::refuse_if_barred(&row.status, row.suspended_until, now) {
        revoke_family(&state.db, row.family_id).await?;
        return Err(barred);
    }

    let new_id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    // Conditional: of two refreshes with the same token, one changes the row and the other does not.
    let won = sqlx::query!(
        "UPDATE refresh_tokens SET revoked_at = ?, replaced_by_id = ? WHERE id = ? AND revoked_at IS NULL",
        now,
        new_id,
        row.id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    if !won {
        drop(tx);
        return Err(reused(state, row.user_id, row.family_id).await);
    }
    let holder = Holder {
        id: row.user_id,
        role: row.role,
        session_version: row.session_version,
    };
    let session = issue(state, &mut tx, holder, new_id, row.family_id, audience).await?;
    tx.commit().await?;
    Ok(session)
}

/// Ends the session a refresh token belongs to. A token of someone else, or one that does not
/// exist, changes nothing and gets the same answer: the route must not tell whether a token exists.
pub async fn logout(state: &AppState, user: Uuid, refresh_token: &str) -> Result<(), AppError> {
    let hash = tokens::hash_opaque(refresh_token);
    let family = sqlx::query_scalar!(
        r#"SELECT family_id AS "family_id: Uuid" FROM refresh_tokens WHERE token_hash = ? AND user_id = ?"#,
        &hash[..],
        user
    )
    .fetch_optional(&state.db)
    .await?;
    if let Some(family) = family {
        revoke_family(&state.db, family).await?;
    }
    Ok(())
}
