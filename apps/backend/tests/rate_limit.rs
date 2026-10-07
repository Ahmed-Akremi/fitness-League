#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use std::net::{Ipv6Addr, SocketAddr};

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{HeaderValue, Method, Request, StatusCode},
};
use common::{TestApp, from_ip, request};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

async fn limited(opts: MySqlPoolOptions, conn: MySqlConnectOptions) -> TestApp {
    TestApp::with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await
}

fn health_from(ip: [u8; 4]) -> Request<Body> {
    request(Method::GET, "/api/v1/health")
        .extension(from_ip(ip))
        .body(Body::empty())
        .unwrap()
}

/// The window is a sliding estimate: when a minute boundary falls inside the test, the refusal can come
/// a few requests after the 301st. It must come within the next ten.
async fn first_refusal(app: &TestApp, mut next: impl FnMut() -> Request<Body>) -> common::Reply {
    for i in 1..=300 {
        assert_eq!(
            app.send(next()).await.status,
            StatusCode::OK,
            "request {i} should pass"
        );
    }
    for _ in 301..=310 {
        let reply = app.send(next()).await;
        if reply.status != StatusCode::OK {
            return reply;
        }
    }
    panic!("310 requests in a row were all allowed");
}

#[sqlx::test]
async fn an_address_is_refused_after_300_requests_in_a_minute(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = limited(opts, conn).await;
    let refused = first_refusal(&app, || health_from([9, 9, 9, 9])).await;

    assert_eq!(refused.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(refused.json["code"], "RATE_LIMITED");
    let retry_after: u64 = refused.headers["retry-after"]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!((1..=60).contains(&retry_after), "{retry_after}");

    // Another address is not affected.
    assert_eq!(
        app.send(health_from([8, 8, 8, 8])).await.status,
        StatusCode::OK
    );
}

#[sqlx::test]
async fn a_forged_forwarded_for_does_not_reset_the_count(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = limited(opts, conn).await;
    let mut n = 0u32;
    // Same peer, a different claimed address on every request. No proxy is trusted, so the claim is ignored.
    let refused = first_refusal(&app, || {
        n += 1;
        request(Method::GET, "/api/v1/health")
            .extension(from_ip([7, 7, 7, 7]))
            .header(
                "x-forwarded-for",
                format!("1.{}.{}.{}", n >> 16 & 255, n >> 8 & 255, n & 255),
            )
            .body(Body::empty())
            .unwrap()
    })
    .await;
    assert_eq!(refused.status, StatusCode::TOO_MANY_REQUESTS);
}

#[sqlx::test]
async fn a_client_behind_the_proxy_cannot_hide_the_address_the_proxy_saw(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = TestApp::with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
        vars.insert("TRUSTED_PROXIES".into(), "10.0.0.0/8".into());
    })
    .await;
    let mut n = 0u32;
    // The client sends two header lines: an invented address, new every time, then a byte that is not
    // text. The proxy appends the address it really saw to the last line.
    let refused = first_refusal(&app, || {
        n += 1;
        request(Method::GET, "/api/v1/health")
            .extension(from_ip([10, 0, 0, 1]))
            .header(
                "x-forwarded-for",
                format!("6.6.{}.{}", n >> 8 & 255, n & 255),
            )
            .header(
                "x-forwarded-for",
                HeaderValue::from_bytes(b"caf\xe9, 203.0.113.7").unwrap(),
            )
            .body(Body::empty())
            .unwrap()
    })
    .await;
    assert_eq!(refused.status, StatusCode::TOO_MANY_REQUESTS);
}

#[sqlx::test]
async fn no_address_is_written_to_redis(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = limited(opts, conn).await;
    app.send(health_from([9, 9, 9, 9])).await;

    let mut connection = app.state.redis.clone();
    let keys: Vec<String> = redis::cmd("KEYS")
        .arg(format!("{}*", app.state.redis_prefix))
        .query_async(&mut connection)
        .await
        .unwrap();
    assert_eq!(keys.len(), 1, "{keys:?}");
    assert!(
        keys[0].contains("rl:global-ip:") && !keys[0].contains("9.9.9.9"),
        "{keys:?}"
    );
}

#[sqlx::test]
async fn a_client_rotating_inside_its_ipv6_network_is_still_counted(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = limited(opts, conn).await;
    let mut host = 0u16;
    // One customer usually holds a whole /64 and can use a new address for every request.
    let refused = first_refusal(&app, || {
        host += 1;
        let address = Ipv6Addr::new(0x2001, 0xdb8, 1, 2, 0, 0, 0, host);
        request(Method::GET, "/api/v1/health")
            .extension(ConnectInfo(SocketAddr::from((address, 40000))))
            .body(Body::empty())
            .unwrap()
    })
    .await;
    assert_eq!(refused.status, StatusCode::TOO_MANY_REQUESTS);
}
