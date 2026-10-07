#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode};
use backend::{modules::auth::accounts, types::Role};
use common::{PASSWORD, Reply, TestApp, create_user, register, seeded};
use serde_json::json;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

const LOGIN: &str = "/api/v1/admin/auth/login";
const REFRESH: &str = "/api/v1/admin/auth/refresh";
const LOGOUT: &str = "/api/v1/admin/auth/logout";
const ME: &str = "/api/v1/admin/me";

async fn login(app: &TestApp, name: &str, password: &str) -> Reply {
    app.post(
        LOGIN,
        json!({"email": format!("{name}@example.com"), "password": password}),
    )
    .await
}

#[sqlx::test]
async fn staff_and_judges_sign_in_to_the_panel(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let panel = [
        Role::Moderator,
        Role::Admin,
        Role::SuperAdmin,
        Role::Judge,
        Role::HeadJudge,
    ];
    for (i, role) in panel.into_iter().enumerate() {
        let name = format!("staff{i}");
        let user = create_user(&app, &name, role).await;
        let reply = login(&app, &name, PASSWORD).await;
        assert_eq!(reply.status, StatusCode::OK, "{role:?}: {}", reply.json);
        let session = &reply.json["session"];
        assert_eq!(session.as_object().unwrap().len(), 4, "{role:?}");
        assert_eq!(session["userId"], user.to_string());

        let me = app
            .call(Method::GET, ME, session["accessToken"].as_str(), None)
            .await;
        assert_eq!(me.status, StatusCode::OK);
        assert_eq!(
            me.json,
            json!({"id": user.to_string(), "email": format!("{name}@example.com"), "username": name, "role": role.as_str()})
        );
    }
    let audited: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'ADMIN_LOGIN'")
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(audited, 5);
}

#[sqlx::test]
async fn an_athlete_cannot_open_the_panel(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    create_user(&app, "athlete", Role::User).await;
    create_user(&app, "owner", Role::GymAdmin).await;

    for name in ["athlete", "owner"] {
        // Without the password the answer is the one everybody gets.
        assert_eq!(
            login(&app, name, "not the password").await.json["code"],
            "INVALID_CREDENTIALS"
        );
        let reply = login(&app, name, PASSWORD).await;
        assert_eq!(
            (reply.status, reply.json["code"].as_str()),
            (StatusCode::FORBIDDEN, Some("FORBIDDEN"))
        );
        assert_eq!(reply.json["detail"], "Staff accounts only.");
    }
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(sessions, 0);
}

#[sqlx::test]
async fn panel_sessions_and_app_sessions_do_not_mix(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    create_user(&app, "admin", Role::Admin).await;
    let panel = login(&app, "admin", PASSWORD).await.json["session"].clone();
    // An administrator may also use the app, with a session of the app.
    let in_app = app
        .post(
            "/api/v1/auth/login",
            json!({"email": "admin@example.com", "password": PASSWORD}),
        )
        .await
        .json;

    let invalid = |reply: Reply| {
        assert_eq!(
            (reply.status, reply.json["code"].as_str()),
            (StatusCode::UNAUTHORIZED, Some("TOKEN_INVALID"))
        );
    };
    // Access tokens.
    invalid(
        app.call(Method::GET, ME, in_app["accessToken"].as_str(), None)
            .await,
    );
    invalid(
        app.call(
            Method::POST,
            "/api/v1/auth/logout",
            panel["accessToken"].as_str(),
            Some(json!({"refreshToken": "x".repeat(43)})),
        )
        .await,
    );
    // Refresh tokens.
    invalid(
        app.post(
            "/api/v1/auth/refresh",
            json!({"refreshToken": panel["refreshToken"]}),
        )
        .await,
    );
    invalid(
        app.post(REFRESH, json!({"refreshToken": in_app["refreshToken"]}))
            .await,
    );

    // Each still works where it belongs.
    let renewed = app
        .post(REFRESH, json!({"refreshToken": panel["refreshToken"]}))
        .await;
    assert_eq!(renewed.status, StatusCode::OK);
    assert_eq!(
        renewed.json.as_object().unwrap().len(),
        4,
        "a bare session, as the panel reads it"
    );
    let me = app
        .call(Method::GET, ME, renewed.json["accessToken"].as_str(), None)
        .await;
    assert_eq!(me.status, StatusCode::OK);

    let out = app
        .call(
            Method::POST,
            LOGOUT,
            renewed.json["accessToken"].as_str(),
            Some(json!({"refreshToken": renewed.json["refreshToken"]})),
        )
        .await;
    assert_eq!(out.status, StatusCode::NO_CONTENT);
    invalid(
        app.post(
            REFRESH,
            json!({"refreshToken": renewed.json["refreshToken"]}),
        )
        .await,
    );
}

#[sqlx::test]
async fn the_lockout_is_the_same_one_as_in_the_app(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    create_user(&app, "admin", Role::Admin).await;
    for _ in 0..3 {
        login(&app, "admin", "wrong").await;
    }
    for _ in 0..2 {
        app.post(
            "/api/v1/auth/login",
            json!({"email": "admin@example.com", "password": "wrong"}),
        )
        .await;
    }
    // Five failures in all, three here and two in the app: the account is locked for both.
    assert_eq!(
        login(&app, "admin", PASSWORD).await.status,
        StatusCode::LOCKED
    );
}

#[sqlx::test]
async fn promote_gives_a_role_and_ends_every_session(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    assert_eq!(
        login(&app, "ahmed", PASSWORD).await.status,
        StatusCode::FORBIDDEN
    );

    accounts::promote(&app.db, " Ahmed@Example.com ", Role::Admin)
        .await
        .unwrap();

    let (role, version): (String, i32) = sqlx::query_as("SELECT role, session_version FROM users")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!((role.as_str(), version), ("ADMIN", 2));
    // What was signed before the change is dead, so the new role is never carried by an old token.
    let stale = app
        .call(
            Method::POST,
            "/api/v1/auth/email/resend",
            session["accessToken"].as_str(),
            None,
        )
        .await;
    assert_eq!(stale.json["code"], "TOKEN_INVALID");
    let refresh = app
        .post(
            "/api/v1/auth/refresh",
            json!({"refreshToken": session["refreshToken"]}),
        )
        .await;
    assert_eq!(refresh.json["code"], "TOKEN_INVALID");

    let (change,): (String,) =
        sqlx::query_as("SELECT after_json FROM audit_log WHERE action = 'ROLE_CHANGED'")
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&change).unwrap(),
        json!({"from": "USER", "to": "ADMIN"})
    );
    assert_eq!(login(&app, "ahmed", PASSWORD).await.status, StatusCode::OK);

    let missing = accounts::promote(&app.db, "nobody@example.com", Role::Admin).await;
    assert!(missing.unwrap_err().contains("no account"));
}
