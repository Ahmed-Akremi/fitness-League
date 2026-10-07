#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use std::time::{Duration, Instant};

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

/// Far more than the deadlines add up to, far less than a request that waits for the outage to end.
const PROMPT: Duration = Duration::from_secs(4);

/// `host:port` of a `scheme://[credentials@]host:port[/path]` URL.
fn host_port(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let rest = rest.rsplit_once('@').map_or(rest, |(_, rest)| rest);
    rest.split('/').next().unwrap_or(rest)
}

#[sqlx::test]
async fn a_redis_outage_does_not_stall_requests(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let real = std::env::var("TEST_REDIS_URL").unwrap();
    let (address, relay) = common::relay("127.0.0.1:0", host_port(&real).to_owned()).await;
    let app = TestApp::with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
        vars.insert(
            "REDIS_URL".into(),
            real.replacen(host_port(&real), &address.to_string(), 1),
        );
    })
    .await;
    assert_eq!(app.get("/api/v1/ready").await.status, StatusCode::OK);

    relay.abort();
    let _ = relay.await;
    let started = Instant::now();
    // The per-address rule lets requests through during an outage. It must not make them wait either.
    assert_eq!(app.get("/api/v1/health").await.status, StatusCode::OK);
    let ready = app.get("/api/v1/ready").await;
    assert_eq!(ready.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        ready.json["checks"],
        serde_json::json!({"database": "up", "redis": "down"})
    );
    assert!(started.elapsed() < PROMPT, "took {:?}", started.elapsed());

    // The limit itself still holds, counted by this process while Redis is away. Twice the limit and
    // a few more: the local window is a fixed minute, and one may end during the loop.
    let mut refused = false;
    for _ in 0..620 {
        refused = app.get("/api/v1/health").await.status == StatusCode::TOO_MANY_REQUESTS;
        if refused {
            break;
        }
    }
    assert!(refused, "620 requests were all allowed during the outage");

    // Redis is back: it is used again without a restart. The request that finds it back may itself
    // still fail, so a few are allowed.
    let (_, _relay) = common::relay(&address.to_string(), host_port(&real).to_owned()).await;
    let mut ready = StatusCode::SERVICE_UNAVAILABLE;
    for _ in 0..5 {
        ready = app.get("/api/v1/ready").await.status;
        if ready == StatusCode::OK {
            break;
        }
    }
    assert_eq!(ready, StatusCode::OK, "Redis was not used again once back");
}

#[sqlx::test]
async fn a_database_outage_does_not_stall_the_readiness_check(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let target = format!("{}:{}", conn.get_host(), conn.get_port());
    let (address, relay) = common::relay("127.0.0.1:0", target).await;
    let app = TestApp::new(opts, conn.host("127.0.0.1").port(address.port())).await;
    assert_eq!(app.get("/api/v1/ready").await.status, StatusCode::OK);

    relay.abort();
    let _ = relay.await;
    let started = Instant::now();
    let ready = app.get("/api/v1/ready").await;
    assert_eq!(ready.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        ready.json["checks"],
        serde_json::json!({"database": "down", "redis": "up"})
    );
    assert!(started.elapsed() < PROMPT, "took {:?}", started.elapsed());
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
