//! Shared by every integration test file: the real router on a throw-away database and a private Redis prefix.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::{collections::HashMap, net::SocketAddr, sync::OnceLock};

use axum::{
    Router,
    body::Body,
    extract::ConnectInfo,
    http::{HeaderMap, Method, Request, StatusCode, request::Builder},
};
use backend::{config::Config, state::AppState};
use http_body_util::BodyExt;
use serde_json::Value;
use sqlx::{
    MySqlPool,
    mysql::{MySqlConnectOptions, MySqlPoolOptions},
};
use tower::ServiceExt;

pub struct TestApp {
    pub state: AppState,
    pub db: MySqlPool,
    router: Router,
}

pub struct Reply {
    pub status: StatusCode,
    pub headers: HeaderMap,
    /// `Value::Null` when the body is empty or not JSON.
    pub json: Value,
}

/// One key pair for the whole test binary: generating it shells out to openssl.
fn keys() -> &'static (String, String) {
    static KEYS: OnceLock<(String, String)> = OnceLock::new();
    KEYS.get_or_init(|| backend::devkeys::generate().expect("the tests need the openssl command"))
}

/// The environment of a test. Rate limiting is off unless a test switches it on.
pub fn env() -> HashMap<String, String> {
    let (private, public) = keys().clone();
    [
        ("APP_ENV", "test".to_owned()),
        ("DATABASE_URL", "mysql://unused/the-harness-supplies-the-pool".to_owned()),
        ("REDIS_URL", std::env::var("TEST_REDIS_URL").expect("TEST_REDIS_URL (see .cargo/config.toml)")),
        ("JWT_PRIVATE_KEY_B64", private),
        ("JWT_PUBLIC_KEY_B64", public),
        ("APP_HMAC_SECRET", "test-hmac-secret-0123456789abcdef".to_owned()),
        ("RATE_LIMIT_ENABLED", "false".to_owned()),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v))
    .collect()
}

impl TestApp {
    pub async fn new(opts: MySqlPoolOptions, conn: MySqlConnectOptions) -> Self {
        Self::with(opts, conn, |_| {}).await
    }

    /// `tweak` edits the environment before the configuration is built.
    pub async fn with(opts: MySqlPoolOptions, conn: MySqlConnectOptions, tweak: impl FnOnce(&mut HashMap<String, String>)) -> Self {
        let mut vars = env();
        tweak(&mut vars);
        let cfg = Config::from_map(&vars).expect("test configuration");
        let db = backend::db::pool(opts, conn);
        // A unique prefix keeps the Redis keys of parallel tests apart.
        let prefix = format!("test:{}:", uuid::Uuid::now_v7().simple());
        let state = AppState::new(cfg, db.clone(), &prefix).await.expect("redis (is the compose stack up?)");
        Self { router: backend::http::app(state.clone()), state, db }
    }

    pub async fn send(&self, mut req: Request<Body>) -> Reply {
        // `oneshot` has no socket: give the request the peer address the server would attach.
        if req.extensions().get::<ConnectInfo<SocketAddr>>().is_none() {
            req.extensions_mut().insert(from_ip([127, 0, 0, 1]));
        }
        let res = self.router.clone().oneshot(req).await.expect("the router is infallible");
        let (parts, body) = res.into_parts();
        let bytes = body.collect().await.expect("body").to_bytes();
        Reply { status: parts.status, headers: parts.headers, json: serde_json::from_slice(&bytes).unwrap_or(Value::Null) }
    }

    pub async fn get(&self, path: &str) -> Reply {
        self.send(request(Method::GET, path).body(Body::empty()).unwrap()).await
    }
}

pub fn request(method: Method, path: &str) -> Builder {
    Request::builder().method(method).uri(path)
}

/// The peer address of a request, as the server sees it. Add it with `.extension(from_ip([…]))`.
pub fn from_ip(ip: [u8; 4]) -> ConnectInfo<SocketAddr> {
    ConnectInfo(SocketAddr::from((ip, 40000)))
}
