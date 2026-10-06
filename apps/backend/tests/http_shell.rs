#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::{
    body::Body,
    http::{Method, StatusCode},
};
use common::{TestApp, request};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

const SECURITY_HEADERS: [(&str, &str); 6] = [
    ("x-content-type-options", "nosniff"),
    ("x-frame-options", "DENY"),
    ("referrer-policy", "no-referrer"),
    (
        "content-security-policy",
        "default-src 'none'; frame-ancestors 'none'",
    ),
    ("cross-origin-resource-policy", "same-origin"),
    ("cache-control", "no-store"),
];

#[sqlx::test]
async fn health_answers_with_every_security_header(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = TestApp::new(opts, conn).await;
    let r = app.get("/api/v1/health").await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json["status"], "ok");
    for (name, value) in SECURITY_HEADERS {
        assert_eq!(
            r.headers.get(name).map(|v| v.to_str().unwrap()),
            Some(value),
            "{name}"
        );
    }
    assert!(r.headers.contains_key("x-request-id"));
    assert!(
        !r.headers.contains_key("strict-transport-security"),
        "HSTS is for production only"
    );
}

#[sqlx::test]
async fn production_adds_hsts(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = TestApp::with(opts, conn, |vars| {
        vars.insert("APP_ENV".into(), "production".into());
        vars.insert("SMTP_URL".into(), "smtp://mail.example".into());
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let r = app.get("/api/v1/health").await;
    assert_eq!(
        r.headers["strict-transport-security"],
        "max-age=63072000; includeSubDomains"
    );
}

#[sqlx::test]
async fn ready_reports_the_database_and_redis(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = TestApp::new(opts, conn).await;
    let r = app.get("/api/v1/ready").await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(
        r.json,
        serde_json::json!({"status": "ready", "checks": {"database": "up", "redis": "up"}})
    );
}

#[sqlx::test]
async fn unknown_routes_and_methods_are_problems_with_a_trace_id(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = TestApp::new(opts, conn).await;

    let missing = app.get("/api/v1/nope").await;
    assert_eq!(missing.status, StatusCode::NOT_FOUND);
    assert_eq!(missing.headers["content-type"], "application/problem+json");
    assert_eq!(missing.json["code"], "NOT_FOUND");
    assert_eq!(
        missing.json["traceId"].as_str().unwrap(),
        missing.headers["x-request-id"].to_str().unwrap()
    );
    // Errors are hardened like any other answer.
    assert_eq!(missing.headers["x-content-type-options"], "nosniff");

    let wrong_method = app
        .send(
            request(Method::DELETE, "/api/v1/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(wrong_method.status, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(wrong_method.json["code"], "METHOD_NOT_ALLOWED");
}

#[sqlx::test]
async fn cors_allows_only_the_configured_origins(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = TestApp::with(opts, conn, |vars| {
        vars.insert("CORS_ORIGINS".into(), "http://localhost:5173".into());
    })
    .await;
    let preflight = |origin: &'static str| {
        request(Method::OPTIONS, "/api/v1/health")
            .header("origin", origin)
            .header("access-control-request-method", "GET")
            .header("access-control-request-headers", "authorization")
            .body(Body::empty())
            .unwrap()
    };

    let allowed = app.send(preflight("http://localhost:5173")).await;
    assert_eq!(
        allowed.headers["access-control-allow-origin"],
        "http://localhost:5173"
    );
    assert!(
        !allowed
            .headers
            .contains_key("access-control-allow-credentials"),
        "no cookies, so no credentials"
    );

    let refused = app.send(preflight("https://evil.example")).await;
    assert!(!refused.headers.contains_key("access-control-allow-origin"));
}

#[test]
fn every_route_lives_under_the_versioned_base_path() {
    let table = backend::http::route_table();
    assert!(table.contains(&(Method::GET, "/api/v1/health")));
    assert!(
        table.iter().all(|(_, path)| path.starts_with("/api/v1/")),
        "{table:?}"
    );
}
