#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::StatusCode;
use backend::types::Role;
use common::{
    PASSWORD, Reply, TestApp, create_user, deliver_mail, post_from, register, seeded, seeded_with,
};
use serde_json::json;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const LOGIN: &str = "/api/v1/auth/login";

async fn login(app: &TestApp, email: &str, password: &str) -> Reply {
    app.post(LOGIN, json!({"email": email, "password": password}))
        .await
}

async fn set(app: &TestApp, user: Uuid, assignment: &str) {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE users SET {assignment} WHERE id = ?"
    )))
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
}

fn retry_after(reply: &Reply) -> u64 {
    reply.headers["retry-after"]
        .to_str()
        .unwrap()
        .parse()
        .unwrap()
}

#[sqlx::test]
async fn the_right_password_opens_a_session(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let registered = register(&app, "ahmed").await;

    let reply = login(&app, "  Ahmed@Example.com ", PASSWORD).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    assert_eq!(reply.json["userId"], registered["userId"]);
    assert_eq!(reply.json["expiresIn"], 900);
    assert_ne!(reply.json["refreshToken"], registered["refreshToken"]);

    let seen: bool = sqlx::query_scalar("SELECT last_login_at IS NOT NULL FROM users")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert!(seen);
}

#[sqlx::test]
async fn an_unknown_email_and_a_wrong_password_get_the_same_answer(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    register(&app, "ahmed").await;

    let mut wrong = login(&app, "ahmed@example.com", "not the password").await;
    let mut unknown = login(&app, "nobody@example.com", "not the password").await;
    assert_eq!(wrong.status, StatusCode::UNAUTHORIZED);
    assert_eq!(wrong.json["code"], "INVALID_CREDENTIALS");
    // The trace id is the only thing that may differ.
    for reply in [&mut wrong, &mut unknown] {
        reply.json.as_object_mut().unwrap().remove("traceId");
    }
    assert_eq!(wrong.status, unknown.status);
    assert_eq!(wrong.json, unknown.json);
    assert_eq!(
        wrong.headers.contains_key("retry-after"),
        unknown.headers.contains_key("retry-after")
    );
}

#[sqlx::test]
async fn the_fifth_failure_locks_and_the_lock_doubles(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let user: Uuid = register(&app, "ahmed").await["userId"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    deliver_mail(&app).await; // the verification mail, out of the way

    for _ in 0..5 {
        let reply = login(&app, "ahmed@example.com", "wrong").await;
        assert_eq!(reply.json["code"], "INVALID_CREDENTIALS");
    }
    // Locked: even the right password is refused, and the answer says until when.
    let locked = login(&app, "ahmed@example.com", PASSWORD).await;
    assert_eq!(locked.status, StatusCode::LOCKED);
    assert_eq!(locked.json["code"], "ACCOUNT_LOCKED");
    assert!(locked.json["lockedUntil"].is_string());
    assert!(
        (880..=900).contains(&retry_after(&locked)),
        "{}",
        retry_after(&locked)
    );

    let (minutes,): (String,) = sqlx::query_as(
        "SELECT JSON_VALUE(after_json, '$.minutes') FROM audit_log WHERE action = 'ACCOUNT_LOCKED' AND entity_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(minutes, "15");
    let mails = deliver_mail(&app).await;
    assert_eq!(mails.len(), 1);
    assert!(mails[0].subject.contains("bloquée"), "{}", mails[0].subject);

    // The lock ends; five more failures lock for twice as long.
    set(
        &app,
        user,
        "locked_until = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND",
    )
    .await;
    for _ in 0..5 {
        assert_eq!(
            login(&app, "ahmed@example.com", "wrong").await.status,
            StatusCode::UNAUTHORIZED
        );
    }
    let longer = login(&app, "ahmed@example.com", PASSWORD).await;
    assert_eq!(longer.status, StatusCode::LOCKED);
    assert!(
        (1780..=1800).contains(&retry_after(&longer)),
        "{}",
        retry_after(&longer)
    );

    // Once it is over, the right password signs in and the count starts again from zero.
    set(
        &app,
        user,
        "locked_until = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND",
    )
    .await;
    assert_eq!(
        login(&app, "ahmed@example.com", PASSWORD).await.status,
        StatusCode::OK
    );
    let (failures, locked): (i32, bool) = sqlx::query_as(
        "SELECT failed_login_count, locked_until IS NOT NULL FROM users WHERE id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!((failures, locked), (0, false));
}

#[sqlx::test]
async fn the_state_of_an_account_is_only_told_to_its_owner(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let banned = create_user(&app, "banned", Role::User).await;
    let suspended = create_user(&app, "suspended", Role::User).await;
    let deleted = create_user(&app, "deleted", Role::User).await;
    let judge = create_user(&app, "judge", Role::HeadJudge).await;
    set(&app, banned, "status = 'BANNED'").await;
    set(
        &app,
        suspended,
        "status = 'SUSPENDED', suspended_until = UTC_TIMESTAMP(6) + INTERVAL 7 DAY",
    )
    .await;
    set(&app, deleted, "status = 'DELETED'").await;
    let _ = judge;

    // Without the password, all four look like any other account.
    for name in ["banned", "suspended", "deleted", "judge"] {
        let reply = login(&app, &format!("{name}@example.com"), "not the password").await;
        assert_eq!(
            (reply.status, reply.json["code"].as_str()),
            (StatusCode::UNAUTHORIZED, Some("INVALID_CREDENTIALS")),
            "{name}"
        );
    }

    let reply = login(&app, "banned@example.com", PASSWORD).await;
    assert_eq!(
        (reply.status, reply.json["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("ACCOUNT_BANNED"))
    );
    let reply = login(&app, "suspended@example.com", PASSWORD).await;
    assert_eq!(
        (reply.status, reply.json["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("ACCOUNT_SUSPENDED"))
    );
    assert!(reply.json["suspendedUntil"].is_string());
    // A deleted account does not exist any more, even for its former owner.
    let reply = login(&app, "deleted@example.com", PASSWORD).await;
    assert_eq!(
        (reply.status, reply.json["code"].as_str()),
        (StatusCode::UNAUTHORIZED, Some("INVALID_CREDENTIALS"))
    );

    let reply = login(&app, "judge@example.com", PASSWORD).await;
    assert_eq!(
        (reply.status, reply.json["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("JUDGE_ACCOUNT"))
    );
    assert_eq!(
        reply.json["detail"],
        "Judge accounts sign in to the admin panel."
    );
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(sessions, 0, "none of these sign-ins opened a session");
}

#[sqlx::test]
async fn signing_in_cancels_a_deletion_that_was_waiting(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let user = create_user(&app, "ahmed", Role::User).await;
    sqlx::query("INSERT INTO deletion_requests (id, user_id, scheduled_for) VALUES (?, ?, UTC_TIMESTAMP(6) + INTERVAL 30 DAY)")
        .bind(Uuid::now_v7())
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();

    assert_eq!(
        login(&app, "ahmed@example.com", PASSWORD).await.status,
        StatusCode::OK
    );
    let status: String =
        sqlx::query_scalar("SELECT status FROM deletion_requests WHERE user_id = ?")
            .bind(user)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(status, "CANCELLED");
}

#[sqlx::test]
async fn the_body_of_a_sign_in_is_checked(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let errors = |body| {
        let app = &app;
        async move {
            let reply = app.post(LOGIN, body).await;
            assert_eq!(
                reply.status,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{}",
                reply.json
            );
            reply.json["errors"].clone()
        }
    };
    assert_eq!(
        errors(json!({"email": "nope", "password": "x"})).await,
        json!([{"field": "email", "code": "ISEMAIL"}])
    );
    assert_eq!(
        errors(json!({"email": "a@example.com"})).await,
        json!([{"field": "password", "code": "REQUIRED"}])
    );
    assert_eq!(
        errors(json!({"email": "a@example.com", "password": "x".repeat(129)})).await,
        json!([{"field": "password", "code": "MAXLENGTH"}])
    );
    assert_eq!(
        errors(json!({"email": "a@example.com", "password": "x", "admin": true})).await,
        json!([{"field": "admin", "code": "UNKNOWN_FIELD"}])
    );
}

#[sqlx::test]
async fn sign_in_is_limited_per_account_and_per_address(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    create_user(&app, "ahmed", Role::User).await;

    // One account, a new address every time: 5 in 15 minutes.
    let mut statuses = Vec::new();
    for i in 0..8u8 {
        let body = json!({"email": "ahmed@example.com", "password": "wrong"});
        statuses.push(post_from(&app, [20, 0, 0, i], LOGIN, body).await.status);
    }
    assert_eq!(statuses[..5], [StatusCode::UNAUTHORIZED; 5]);
    assert!(
        statuses[5..].contains(&StatusCode::TOO_MANY_REQUESTS),
        "{statuses:?}"
    );

    // One address, a new account every time: 10 a minute.
    let mut statuses = Vec::new();
    for i in 0..14 {
        let body = json!({"email": format!("nobody{i}@example.com"), "password": "wrong"});
        let reply = post_from(&app, [30, 0, 0, 1], LOGIN, body).await;
        if reply.status == StatusCode::TOO_MANY_REQUESTS {
            assert!(reply.headers.contains_key("retry-after"));
        }
        statuses.push(reply.status);
    }
    assert_eq!(statuses[..10], [StatusCode::UNAUTHORIZED; 10]);
    assert!(
        statuses[10..].contains(&StatusCode::TOO_MANY_REQUESTS),
        "{statuses:?}"
    );
}
