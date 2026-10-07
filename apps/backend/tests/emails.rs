#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode};
use backend::{
    jobs::{self, Job, JobKind},
    mail::Mailer,
    modules::auth::emails::handle,
    security::tokens::hash_opaque,
    types::Role,
};
use common::{
    PASSWORD, TestApp, create_user, deliver_mail, post_from, register, seeded, seeded_with,
    token_in,
};
use serde_json::json;
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

#[sqlx::test]
async fn two_workers_at_once_still_leave_one_working_link(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let user = create_user(&app, "ahmed", Role::User).await;
    let job = || Job {
        kind: JobKind::PasswordReset,
        user_id: user,
        attempt: 1,
    };
    let (first, second) = (Mailer::memory(), Mailer::memory());
    // The dangerous moment is when no link is alive: nothing yet makes one worker wait for the
    // other. Each round starts from there; several rounds, because the overlap is a matter of timing
    // (in the first one a worker is still opening its connection).
    for round in 0..8 {
        sqlx::query("UPDATE email_tokens SET consumed_at = UTC_TIMESTAMP(6) WHERE user_id = ? AND consumed_at IS NULL")
            .bind(user)
            .execute(&app.db)
            .await
            .unwrap();
        let (a, b) = tokio::join!(
            handle(&app.state, &first, job()),
            handle(&app.state, &second, job())
        );
        a.unwrap();
        b.unwrap();
        let live = links(&app, user, "PASSWORD_RESET")
            .await
            .iter()
            .filter(|link| !link.2)
            .count();
        assert_eq!(live, 1, "round {round}: a new link cancels the older ones");
    }
}

const VERIFY: &str = "/api/v1/auth/email/verify";
const RESEND: &str = "/api/v1/auth/email/resend";
const FORGOT: &str = "/api/v1/auth/password/forgot";
const RESET: &str = "/api/v1/auth/password/reset";
const LOGIN: &str = "/api/v1/auth/login";

fn user_id(session: &serde_json::Value) -> Uuid {
    session["userId"].as_str().unwrap().parse().unwrap()
}

async fn verified(app: &TestApp, user: Uuid) -> bool {
    sqlx::query_scalar("SELECT email_verified_at IS NOT NULL FROM users WHERE id = ?")
        .bind(user)
        .fetch_one(&app.db)
        .await
        .unwrap()
}

#[sqlx::test]
async fn the_link_of_the_mail_verifies_the_address_once(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let user = user_id(&register(&app, "ahmed").await);
    let token = token_in(&deliver_mail(&app).await[0]);
    assert!(!verified(&app, user).await);

    assert_eq!(
        app.post(VERIFY, json!({"token": token})).await.status,
        StatusCode::NO_CONTENT
    );
    assert!(verified(&app, user).await);

    let again = app.post(VERIFY, json!({"token": token})).await;
    assert_eq!(again.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(again.json["code"], "TOKEN_INVALID");
    let unknown = app.post(VERIFY, json!({"token": "x".repeat(43)})).await;
    assert_eq!(unknown.json["code"], "TOKEN_INVALID");
    let short = app.post(VERIFY, json!({"token": "short"})).await;
    assert_eq!(
        short.json["errors"],
        json!([{"field": "token", "code": "MINLENGTH"}])
    );
}

#[sqlx::test]
async fn an_expired_link_or_one_of_the_other_kind_is_refused(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let user = user_id(&register(&app, "ahmed").await);
    let verify_token = token_in(&deliver_mail(&app).await[0]);
    assert_eq!(
        app.post(FORGOT, json!({"email": "ahmed@example.com"}))
            .await
            .status,
        StatusCode::ACCEPTED
    );
    let reset_token = token_in(&deliver_mail(&app).await[0]);

    // A reset link does not verify an address, and trying does not use it up.
    assert_eq!(
        app.post(VERIFY, json!({"token": reset_token})).await.json["code"],
        "TOKEN_INVALID"
    );
    // A verification link does not reset a password.
    let wrong_kind = app
        .post(
            RESET,
            json!({"token": verify_token, "newPassword": "another long passphrase"}),
        )
        .await;
    assert_eq!(wrong_kind.json["code"], "TOKEN_INVALID");

    sqlx::query("UPDATE email_tokens SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE user_id = ? AND purpose = 'EMAIL_VERIFY'")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    assert_eq!(
        app.post(VERIFY, json!({"token": verify_token})).await.json["code"],
        "TOKEN_INVALID"
    );
    assert!(!verified(&app, user).await);

    let reset = app
        .post(
            RESET,
            json!({"token": reset_token, "newPassword": "another long passphrase"}),
        )
        .await;
    assert_eq!(reset.status, StatusCode::NO_CONTENT);

    // A reset link expires as well.
    app.post(FORGOT, json!({"email": "ahmed@example.com"}))
        .await;
    let late = token_in(&deliver_mail(&app).await[0]);
    sqlx::query("UPDATE email_tokens SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE user_id = ? AND purpose = 'PASSWORD_RESET'")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    let expired = app
        .post(
            RESET,
            json!({"token": late, "newPassword": "yet another passphrase"}),
        )
        .await;
    assert_eq!(expired.json["code"], "TOKEN_INVALID");
}

#[sqlx::test]
async fn resending_sends_a_new_link_and_cancels_the_old_one(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let access = session["accessToken"].as_str().unwrap();
    let first = token_in(&deliver_mail(&app).await[0]);

    // The app sends no body and no content type with this request.
    let resend = || app.call(Method::POST, RESEND, Some(access), None);
    assert_eq!(resend().await.status, StatusCode::NO_CONTENT);
    let second = token_in(&deliver_mail(&app).await[0]);
    assert_ne!(first, second);
    assert_eq!(
        app.post(VERIFY, json!({"token": first})).await.json["code"],
        "TOKEN_INVALID"
    );
    assert_eq!(
        app.post(VERIFY, json!({"token": second})).await.status,
        StatusCode::NO_CONTENT
    );

    // Once verified there is nothing to send, and the answer is the same.
    assert_eq!(resend().await.status, StatusCode::NO_CONTENT);
    assert!(deliver_mail(&app).await.is_empty());

    let anonymous = app.call(Method::POST, RESEND, None, None).await;
    assert_eq!(anonymous.json["code"], "UNAUTHENTICATED");
}

#[sqlx::test]
async fn forgot_always_answers_the_same_and_only_real_accounts_get_a_mail(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    register(&app, "ahmed").await;
    let banned = create_user(&app, "banned", Role::User).await;
    sqlx::query("UPDATE users SET status = 'BANNED' WHERE id = ?")
        .bind(banned)
        .execute(&app.db)
        .await
        .unwrap();
    deliver_mail(&app).await;

    for email in [
        "Ahmed@Example.com",
        "nobody@example.com",
        "banned@example.com",
    ] {
        let reply = app.post(FORGOT, json!({"email": email})).await;
        assert_eq!(reply.status, StatusCode::ACCEPTED, "{email}");
        assert!(reply.json.is_null(), "{email}: the answer has no body");
    }
    let mails = deliver_mail(&app).await;
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].to, "ahmed@example.com");
    assert!(mails[0].text.contains("/reset-password?token="));

    let bad = app.post(FORGOT, json!({"email": "not an email"})).await;
    assert_eq!(
        bad.json["errors"],
        json!([{"field": "email", "code": "ISEMAIL"}])
    );
}

#[sqlx::test]
async fn a_reset_changes_the_password_and_ends_every_session(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let user = user_id(&session);
    deliver_mail(&app).await;
    // The account is locked: a reset is how its owner gets back in.
    sqlx::query("UPDATE users SET failed_login_count = 5, locked_until = UTC_TIMESTAMP(6) + INTERVAL 15 MINUTE WHERE id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    app.post(FORGOT, json!({"email": "ahmed@example.com"}))
        .await;
    let token = token_in(&deliver_mail(&app).await[0]);

    // A password the policy refuses does not use the link up.
    for (weak, code) in [
        ("1234567890", "TOO_COMMON"),
        ("ahmed@example.com", "TOO_COMMON"),
        ("short", "MINLENGTH"),
    ] {
        let reply = app
            .post(RESET, json!({"token": token, "newPassword": weak}))
            .await;
        assert_eq!(
            reply.json["errors"],
            json!([{"field": "newPassword", "code": code}]),
            "{weak}"
        );
    }

    let new_password = "a brand new passphrase";
    let reset = app
        .post(RESET, json!({"token": token, "newPassword": new_password}))
        .await;
    assert_eq!(reset.status, StatusCode::NO_CONTENT);

    let old = app
        .post(
            LOGIN,
            json!({"email": "ahmed@example.com", "password": PASSWORD}),
        )
        .await;
    assert_eq!(old.json["code"], "INVALID_CREDENTIALS");
    let new = app
        .post(
            LOGIN,
            json!({"email": "ahmed@example.com", "password": new_password}),
        )
        .await;
    assert_eq!(
        new.status,
        StatusCode::OK,
        "the lock is lifted and the new password works"
    );

    // Everything handed out before the reset is dead.
    let stale = app
        .call(Method::POST, RESEND, session["accessToken"].as_str(), None)
        .await;
    assert_eq!(
        (stale.status, stale.json["code"].as_str()),
        (StatusCode::UNAUTHORIZED, Some("TOKEN_INVALID"))
    );
    let refresh = app
        .post(
            "/api/v1/auth/refresh",
            json!({"refreshToken": session["refreshToken"]}),
        )
        .await;
    assert_eq!(refresh.json["code"], "TOKEN_INVALID");

    assert_eq!(
        app.post(RESET, json!({"token": token, "newPassword": new_password}))
            .await
            .json["code"],
        "TOKEN_INVALID"
    );
    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'PASSWORD_RESET' AND entity_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(audited, 1);
}

#[sqlx::test]
async fn the_email_routes_are_limited(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let session = register(&app, "ahmed").await;
    let refused_after = |statuses: &[StatusCode], allowed: usize, ok: StatusCode| {
        assert_eq!(statuses[..allowed], vec![ok; allowed][..], "{statuses:?}");
        assert!(
            statuses[allowed..].contains(&StatusCode::TOO_MANY_REQUESTS),
            "{statuses:?}"
        );
    };

    // Forgot: 3 an hour for one account, wherever the requests come from.
    let mut statuses = Vec::new();
    for i in 0..6u8 {
        statuses.push(
            post_from(
                &app,
                [40, 0, 0, i],
                FORGOT,
                json!({"email": "ahmed@example.com"}),
            )
            .await
            .status,
        );
    }
    refused_after(&statuses, 3, StatusCode::ACCEPTED);

    // Resend: 3 an hour for one user.
    let mut statuses = Vec::new();
    for _ in 0..6 {
        statuses.push(
            app.call(Method::POST, RESEND, session["accessToken"].as_str(), None)
                .await
                .status,
        );
    }
    refused_after(&statuses, 3, StatusCode::NO_CONTENT);

    // Verify: 20 an hour from one address, whatever the tokens were.
    let mut statuses = Vec::new();
    for _ in 0..25 {
        statuses.push(
            post_from(
                &app,
                [41, 0, 0, 1],
                VERIFY,
                json!({"token": "x".repeat(43)}),
            )
            .await
            .status,
        );
    }
    refused_after(&statuses, 20, StatusCode::UNPROCESSABLE_ENTITY);

    // Reset: 10 an hour from one address.
    let mut statuses = Vec::new();
    for _ in 0..14 {
        let body = json!({"token": "x".repeat(43), "newPassword": "a brand new passphrase"});
        statuses.push(post_from(&app, [42, 0, 0, 1], RESET, body).await.status);
    }
    refused_after(&statuses, 10, StatusCode::UNPROCESSABLE_ENTITY);

    // Forgot: 10 an hour from one address, whatever the accounts were.
    let mut statuses = Vec::new();
    for i in 0..14 {
        let body = json!({"email": format!("nobody{i}@example.com")});
        statuses.push(post_from(&app, [43, 0, 0, 1], FORGOT, body).await.status);
    }
    refused_after(&statuses, 10, StatusCode::ACCEPTED);
}
