#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use backend::{
    jobs::{self, JobKind},
    security::tokens::hash_opaque,
    types::Role,
};
use common::{TestApp, create_user, deliver_mail, seeded, token_in};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

/// `(hash, minutes until it expires, consumed)` of the user's links, oldest first.
async fn links(app: &TestApp, user: Uuid, purpose: &str) -> Vec<(Vec<u8>, i64, bool)> {
    sqlx::query_as(
        "SELECT token_hash, TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(6), expires_at), consumed_at IS NOT NULL \
         FROM email_tokens WHERE user_id = ? AND purpose = ? ORDER BY created_at, id",
    )
    .bind(user)
    .bind(purpose)
    .fetch_all(&app.db)
    .await
    .unwrap()
}

#[sqlx::test]
async fn the_verification_mail_carries_a_link_whose_hash_is_stored(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let user = create_user(&app, "ahmed", Role::User).await;
    jobs::enqueue(&app.state, JobKind::EmailVerify, user)
        .await
        .unwrap();

    let mails = deliver_mail(&app).await;
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].to, "ahmed@example.com");
    // French is the default language of an account.
    assert_eq!(
        mails[0].subject,
        "Fitness League : confirme ton adresse email"
    );
    assert!(
        mails[0]
            .text
            .contains("https://app.fitnessleague.app/verify-email?token="),
        "{}",
        mails[0].text
    );

    let stored = links(&app, user, "EMAIL_VERIFY").await;
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].0, hash_opaque(&token_in(&mails[0])));
    assert!(
        (23 * 60..=24 * 60).contains(&stored[0].1),
        "{}",
        stored[0].1
    );
    assert!(!stored[0].2);
}

#[sqlx::test]
async fn a_second_link_cancels_the_first(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let user = create_user(&app, "ahmed", Role::User).await;
    for _ in 0..2 {
        jobs::enqueue(&app.state, JobKind::PasswordReset, user)
            .await
            .unwrap();
    }
    let mails = deliver_mail(&app).await;
    assert_eq!(mails.len(), 2);

    let stored = links(&app, user, "PASSWORD_RESET").await;
    assert_eq!(stored.len(), 2);
    assert!(stored[0].2, "the first link no longer works");
    assert!(!stored[1].2);
    assert!((59..=60).contains(&stored[1].1), "{}", stored[1].1);
}

#[sqlx::test]
async fn the_mail_is_written_in_the_language_of_the_account(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let user = create_user(&app, "ahmed", Role::User).await;
    sqlx::query("UPDATE user_settings SET locale = 'en' WHERE user_id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    jobs::enqueue(&app.state, JobKind::AccountLocked, user)
        .await
        .unwrap();

    let mails = deliver_mail(&app).await;
    assert_eq!(
        mails[0].subject,
        "Fitness League: sign-in temporarily locked"
    );
    // This mail points at the screen where a new password is asked for: no token in it.
    assert!(
        mails[0]
            .text
            .contains("https://app.fitnessleague.app/forgot-password")
    );
    assert!(!mails[0].text.contains("token="));
    assert!(links(&app, user, "PASSWORD_RESET").await.is_empty());
}

#[sqlx::test]
async fn nothing_is_sent_when_the_job_no_longer_applies(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let verified = create_user(&app, "verified", Role::User).await;
    let banned = create_user(&app, "banned", Role::User).await;
    sqlx::query("UPDATE users SET email_verified_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(verified)
        .execute(&app.db)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET status = 'BANNED' WHERE id = ?")
        .bind(banned)
        .execute(&app.db)
        .await
        .unwrap();

    jobs::enqueue(&app.state, JobKind::EmailVerify, verified)
        .await
        .unwrap();
    jobs::enqueue(&app.state, JobKind::PasswordReset, banned)
        .await
        .unwrap();
    // An account that was removed after the job was queued.
    jobs::enqueue(&app.state, JobKind::EmailVerify, Uuid::now_v7())
        .await
        .unwrap();

    assert!(deliver_mail(&app).await.is_empty());
    assert!(links(&app, banned, "PASSWORD_RESET").await.is_empty());
}
