#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::{
    body::Body,
    http::{Method, StatusCode},
};
use backend::{http::route_table, security::tokens::Audience, types::Role};
use common::{
    PASSWORD, create_user, open_session, register, registration, request, seeded,
    seeded_with_cuttable_redis,
};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

/// Every route that answers without a session. Adding a line here is a security decision: it is
/// reviewed as one.
const PUBLIC: [(&str, &str); 14] = [
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/ready"),
    ("GET", "/api/v1/ref/governorates"),
    ("GET", "/api/v1/ref/cities"),
    ("GET", "/api/v1/ref/sports"),
    ("GET", "/api/v1/ref/exercises"),
    ("POST", "/api/v1/auth/register"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/refresh"),
    ("POST", "/api/v1/auth/email/verify"),
    ("POST", "/api/v1/auth/password/forgot"),
    ("POST", "/api/v1/auth/password/reset"),
    ("POST", "/api/v1/admin/auth/login"),
    ("POST", "/api/v1/admin/auth/refresh"),
];

fn is_public(method: &Method, path: &str) -> bool {
    PUBLIC.contains(&(method.as_str(), path))
}

fn protected() -> Vec<(Method, &'static str)> {
    route_table()
        .into_iter()
        .filter(|(method, path)| !is_public(method, path))
        .collect()
}

#[sqlx::test]
async fn every_route_wants_a_session_unless_it_is_on_the_public_list(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let table = route_table();
    for (method, path) in &table {
        let reply = app.call(method.clone(), path, None, None).await;
        if is_public(method, path) {
            // It may dislike the empty request, but never for want of a session.
            assert_ne!(reply.json["code"], "UNAUTHENTICATED", "{method} {path}");
        } else {
            assert_eq!(
                (reply.status, reply.json["code"].as_str()),
                (StatusCode::UNAUTHORIZED, Some("UNAUTHENTICATED")),
                "{method} {path} answered without a session"
            );
        }
    }
    for (method, path) in PUBLIC {
        assert!(
            table
                .iter()
                .any(|(m, p)| m.as_str() == method && *p == path),
            "{method} {path} is on the public list but is not a route"
        );
    }
    assert!(!protected().is_empty());
}

/// Who may use a protected route. Routes under `/admin/` belong to the panel, the others to the
/// app. A later plan that adds a route with a narrower rule (administrators only, say) extends this.
fn allowed(role: Role, path: &str) -> bool {
    if path.starts_with("/api/v1/admin/") {
        role.can_open_panel()
    } else {
        !role.is_judge()
    }
}

#[sqlx::test]
async fn every_role_is_tried_against_every_protected_route(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    for (i, role) in Role::ALL.into_iter().enumerate() {
        let user = create_user(&app, &format!("role{i}"), role).await;
        let app_token = open_session(&app, user, role, Audience::App).await["accessToken"]
            .as_str()
            .unwrap()
            .to_owned();
        let panel_token = open_session(&app, user, role, Audience::Admin).await["accessToken"]
            .as_str()
            .unwrap()
            .to_owned();
        for (method, path) in protected() {
            let (own, other) = if path.starts_with("/api/v1/admin/") {
                (&panel_token, &app_token)
            } else {
                (&app_token, &panel_token)
            };
            // No body: an allowed caller is then refused for the missing body, which is neither 401
            // nor 403. What is tested here is who gets past the door.
            let reply = app
                .call(method.clone(), path, Some(own.as_str()), None)
                .await;
            let passed = !matches!(
                reply.status,
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
            );
            assert_eq!(
                passed,
                allowed(role, path),
                "{role:?} on {method} {path}: {} {}",
                reply.status,
                reply.json
            );
            if !passed {
                assert_eq!(
                    reply.json["code"], "FORBIDDEN",
                    "{role:?} on {method} {path}"
                );
            }
            // A token of the other audience is not a token at all here.
            let wrong = app
                .call(method.clone(), path, Some(other.as_str()), None)
                .await;
            assert_eq!(
                (wrong.status, wrong.json["code"].as_str()),
                (StatusCode::UNAUTHORIZED, Some("TOKEN_INVALID")),
                "{role:?} with the other audience on {method} {path}"
            );
        }
    }
}

#[sqlx::test]
async fn identity_routes_refuse_when_redis_is_down_and_the_rest_keeps_working(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let (app, redis) = seeded_with_cuttable_redis(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let session = register(&app, "ahmed").await;
    let access = session["accessToken"].as_str();
    create_user(&app, "admin", Role::Admin).await;
    let fresh = registration(&app, "leila").await;

    redis.abort();
    let _ = redis.await;

    let token = json!({"token": "x".repeat(43)});
    let refresh = json!({"refreshToken": "x".repeat(43)});
    let closed: [(&str, Value); 8] = [
        ("/api/v1/auth/register", fresh),
        (
            "/api/v1/auth/login",
            json!({"email": "ahmed@example.com", "password": PASSWORD}),
        ),
        ("/api/v1/auth/refresh", refresh.clone()),
        ("/api/v1/auth/email/verify", token.clone()),
        (
            "/api/v1/auth/password/forgot",
            json!({"email": "ahmed@example.com"}),
        ),
        (
            "/api/v1/auth/password/reset",
            json!({"token": "x".repeat(43), "newPassword": "a brand new passphrase"}),
        ),
        (
            "/api/v1/admin/auth/login",
            json!({"email": "admin@example.com", "password": PASSWORD}),
        ),
        ("/api/v1/admin/auth/refresh", refresh),
    ];
    for (path, body) in closed {
        let reply = app.post(path, body).await;
        assert_eq!(
            (reply.status, reply.json["code"].as_str()),
            (StatusCode::SERVICE_UNAVAILABLE, Some("SERVICE_UNAVAILABLE")),
            "{path}"
        );
        assert!(
            !reply.json.to_string().to_lowercase().contains("redis"),
            "{path}: the answer says why"
        );
    }
    // Costly for each use, so it refuses as well.
    let resend = app
        .call(Method::POST, "/api/v1/auth/email/resend", access, None)
        .await;
    assert_eq!(resend.status, StatusCode::SERVICE_UNAVAILABLE);

    // What does not create or prove an identity keeps working: a signed-in athlete still reads
    // their profile, and the catalog is still served.
    assert_eq!(
        app.call(Method::GET, "/api/v1/me", access, None)
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(app.get("/api/v1/ref/sports").await.status, StatusCode::OK);
    // The lockout does not depend on Redis: it lives in MariaDB.
    let locked: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE failed_login_count > 0")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(
        locked, 0,
        "a refused request did not reach the password check"
    );
}

#[sqlx::test]
async fn account_routes_refuse_bodies_that_are_too_large_or_not_json(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    for path in [
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/admin/auth/login",
    ] {
        let huge = json!({"email": "a@example.com", "password": "x".repeat(300 * 1024)});
        let reply = app.post(path, huge).await;
        assert_eq!(reply.status, StatusCode::PAYLOAD_TOO_LARGE, "{path}");

        let form = request(Method::POST, path)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(Body::from("email=a%40example.com&password=x"))
            .unwrap();
        assert_eq!(
            app.send(form).await.status,
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "{path}"
        );

        let array = request(Method::POST, path)
            .header("content-type", "application/json")
            .body(Body::from(r#"["a@example.com", "x"]"#))
            .unwrap();
        assert_eq!(
            app.send(array).await.status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{path}"
        );
    }
}

#[sqlx::test]
async fn sql_in_a_credential_is_only_a_wrong_credential(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    register(&app, "ahmed").await;
    for password in [
        "' OR '1'='1",
        "\" OR 1=1 -- ",
        "x'; DROP TABLE users; --",
        "\\",
    ] {
        let reply = app
            .post(
                "/api/v1/auth/login",
                json!({"email": "ahmed@example.com", "password": password}),
            )
            .await;
        assert_eq!(
            (reply.status, reply.json["code"].as_str()),
            (StatusCode::UNAUTHORIZED, Some("INVALID_CREDENTIALS")),
            "{password}"
        );
    }
    // A quote is a legal character of an address: it finds nobody, and breaks nothing.
    let reply = app
        .post(
            "/api/v1/auth/login",
            json!({"email": "o'brien@example.com", "password": PASSWORD}),
        )
        .await;
    assert_eq!(reply.json["code"], "INVALID_CREDENTIALS");
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(users, 1);
}

#[sqlx::test]
async fn nothing_secret_is_written_to_redis(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = common::seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let session = register(&app, "ahmed").await;
    app.post(
        "/api/v1/auth/password/forgot",
        json!({"email": "ahmed@example.com"}),
    )
    .await;
    app.post(
        "/api/v1/auth/login",
        json!({"email": "ahmed@example.com", "password": PASSWORD}),
    )
    .await;

    // Everything this application wrote: the rate-limit counters and the two queued jobs.
    let mut redis = app.state.redis.clone();
    let keys: Vec<String> = redis::cmd("KEYS")
        .arg(format!("{}*", app.state.redis_prefix))
        .query_async(&mut redis)
        .await
        .unwrap();
    let jobs: redis::Value = redis::cmd("XRANGE")
        .arg(format!("{}jobs", app.state.redis_prefix))
        .arg("-")
        .arg("+")
        .query_async(&mut redis)
        .await
        .unwrap();
    let written = format!("{keys:?} {jobs:?}");
    assert!(
        written.contains("EMAIL_VERIFY") && written.contains("PASSWORD_RESET"),
        "{written}"
    );
    for secret in [
        "ahmed@example.com",
        "example.com",
        PASSWORD,
        session["refreshToken"].as_str().unwrap(),
        session["accessToken"].as_str().unwrap(),
        "127.0.0.1",
    ] {
        assert!(!written.contains(secret), "{secret} is in Redis: {written}");
    }
}
