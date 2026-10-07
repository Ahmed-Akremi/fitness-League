//! Shared by every integration test file: the real router on a throw-away database and a private Redis prefix.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::{
    collections::HashMap,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::OnceLock,
};

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
    AssertSqlSafe, MySqlPool,
    mysql::{MySqlConnectOptions, MySqlPoolOptions},
};
use tower::ServiceExt;
use uuid::Uuid;

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
        (
            "DATABASE_URL",
            "mysql://unused/the-harness-supplies-the-pool".to_owned(),
        ),
        (
            "REDIS_URL",
            std::env::var("TEST_REDIS_URL").expect("TEST_REDIS_URL (see .cargo/config.toml)"),
        ),
        ("JWT_PRIVATE_KEY_B64", private),
        ("JWT_PUBLIC_KEY_B64", public),
        (
            "APP_HMAC_SECRET",
            "test-hmac-secret-0123456789abcdef".to_owned(),
        ),
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
    pub async fn with(
        opts: MySqlPoolOptions,
        conn: MySqlConnectOptions,
        tweak: impl FnOnce(&mut HashMap<String, String>),
    ) -> Self {
        let mut vars = env();
        tweak(&mut vars);
        let cfg = Config::from_map(&vars).expect("test configuration");
        let db = backend::db::pool(opts, conn);
        // A unique prefix keeps the Redis keys of parallel tests apart.
        let prefix = format!("test:{}:", uuid::Uuid::now_v7().simple());
        let state = AppState::new(cfg, db.clone(), &prefix)
            .await
            .expect("redis (is the compose stack up?)");
        Self {
            router: backend::http::app(state.clone()),
            state,
            db,
        }
    }

    pub async fn send(&self, mut req: Request<Body>) -> Reply {
        // `oneshot` has no socket: give the request the peer address the server would attach.
        if req.extensions().get::<ConnectInfo<SocketAddr>>().is_none() {
            req.extensions_mut().insert(from_ip([127, 0, 0, 1]));
        }
        let res = self
            .router
            .clone()
            .oneshot(req)
            .await
            .expect("the router is infallible");
        let (parts, body) = res.into_parts();
        let bytes = body.collect().await.expect("body").to_bytes();
        Reply {
            status: parts.status,
            headers: parts.headers,
            json: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        }
    }

    pub async fn get(&self, path: &str) -> Reply {
        self.send(request(Method::GET, path).body(Body::empty()).unwrap())
            .await
    }

    /// One request. `token` goes in the `Authorization` header; `body` is sent as JSON.
    pub async fn call(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> Reply {
        let mut req = request(method, path);
        if let Some(token) = token {
            req = req.header("authorization", format!("Bearer {token}"));
        }
        let body = match body {
            Some(json) => {
                req = req.header("content-type", "application/json");
                Body::from(json.to_string())
            }
            None => Body::empty(),
        };
        self.send(req.body(body).unwrap()).await
    }

    pub async fn post(&self, path: &str, body: Value) -> Reply {
        self.call(Method::POST, path, None, Some(body)).await
    }
}

pub fn request(method: Method, path: &str) -> Builder {
    Request::builder().method(method).uri(path)
}

/// A TCP relay listening on `listen` in front of `target` (`host:port`). Aborting the returned task
/// closes every connection and refuses new ones: an outage that starts after the application is up.
/// Starting a relay again on the same address ends the outage.
pub async fn relay(listen: &str, target: String) -> (SocketAddr, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind(listen)
        .await
        .expect("the relay's port");
    let address = listener.local_addr().expect("the relay's address");
    let task = tokio::spawn(async move {
        let mut links = tokio::task::JoinSet::new();
        while let Ok((mut client, _)) = listener.accept().await {
            let target = target.clone();
            links.spawn(async move {
                if let Ok(mut server) = tokio::net::TcpStream::connect(target).await {
                    let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
                }
            });
        }
    });
    (address, task)
}

/// The peer address of a request, as the server sees it. Add it with `.extension(from_ip([…]))`.
pub fn from_ip(ip: [u8; 4]) -> ConnectInfo<SocketAddr> {
    ConnectInfo(SocketAddr::from((ip, 40000)))
}

pub fn seed_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../infra/seed-data")
}

/// A `TestApp` whose database holds the reference catalog and the active rule set.
pub async fn seeded(opts: MySqlPoolOptions, conn: MySqlConnectOptions) -> TestApp {
    seeded_with(opts, conn, |_| {}).await
}

pub async fn seeded_with(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
    tweak: impl FnOnce(&mut HashMap<String, String>),
) -> TestApp {
    let app = TestApp::with(opts, conn, tweak).await;
    backend::seed::run(&app.db, &seed_dir())
        .await
        .expect("the seed data loads");
    app
}

/// The password of every account the tests create.
pub const PASSWORD: &str = "correct horse battery staple";

/// One governorate and one of its cities, from the seeded catalog.
pub async fn a_place(app: &TestApp) -> (Uuid, Uuid) {
    sqlx::query_as(
        "SELECT g.id, c.id FROM cities c JOIN governorates g ON g.id = c.governorate_id \
         ORDER BY g.code, c.code LIMIT 1",
    )
    .fetch_one(&app.db)
    .await
    .expect("the catalog is seeded")
}

/// An account written straight into the database, as a registration leaves it. Its email is
/// `<name>@example.com`, its username `name` and its password `PASSWORD`.
pub async fn create_user(app: &TestApp, name: &str, role: backend::types::Role) -> Uuid {
    let id = Uuid::now_v7();
    let (governorate, city) = a_place(app).await;
    let hash = app
        .state
        .passwords
        .hash(PASSWORD.to_owned())
        .await
        .expect("a password hash");
    sqlx::query(
        "INSERT INTO users (id, email, username, password_hash, role, date_of_birth) \
         VALUES (?, ?, ?, ?, ?, '1995-05-05')",
    )
    .bind(id)
    .bind(format!("{name}@example.com"))
    .bind(name)
    .bind(hash)
    .bind(role.as_str())
    .execute(&app.db)
    .await
    .expect("the user row");
    sqlx::query(
        "INSERT INTO profiles (user_id, full_name, governorate_id, city_id) VALUES (?, ?, ?, ?)",
    )
    .bind(id)
    .bind(format!("Athlete {name}"))
    .bind(governorate)
    .bind(city)
    .execute(&app.db)
    .await
    .expect("the profile row");
    for table in ["user_settings", "user_stats", "user_streaks"] {
        sqlx::query(AssertSqlSafe(format!(
            "INSERT INTO {table} (user_id) VALUES (?)"
        )))
        .bind(id)
        .execute(&app.db)
        .await
        .expect("the defaults row");
    }
    id
}

/// Every key of `expected` exists in `actual` with the same JSON type. `null` on either side matches
/// anything; lists are compared by their first element.
pub fn assert_same_shape(path: &str, expected: &Value, actual: &Value) {
    match (expected, actual) {
        (Value::Null, _) | (_, Value::Null) => {}
        (Value::Object(e), Value::Object(a)) => {
            for (key, value) in e {
                let got = a
                    .get(key)
                    .unwrap_or_else(|| panic!("{path}.{key} is missing"));
                assert_same_shape(&format!("{path}.{key}"), value, got);
            }
        }
        (Value::Array(e), Value::Array(a)) => {
            if let (Some(first_expected), Some(first_actual)) = (e.first(), a.first()) {
                assert_same_shape(&format!("{path}[0]"), first_expected, first_actual);
            }
        }
        (e, a) => assert_eq!(
            std::mem::discriminant(e),
            std::mem::discriminant(a),
            "{path}: expected {e}, got {a}"
        ),
    }
}

/// Runs the worker until its queue is empty and returns the mails it sent.
pub async fn deliver_mail(app: &TestApp) -> Vec<backend::mail::Sent> {
    let mailer = backend::mail::Mailer::memory();
    let worker = backend::jobs::Worker::new(app.state.clone(), "test");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    while worker
        .tick(now, false, async |job| {
            backend::modules::auth::emails::handle(&app.state, &mailer, job).await
        })
        .await
        .expect("the queue answers")
        > 0
    {}
    mailer.sent()
}

/// The token carried by the link of a mail.
pub fn token_in(mail: &backend::mail::Sent) -> String {
    mail.text
        .split("token=")
        .nth(1)
        .expect("a link with a token")
        .split_whitespace()
        .next()
        .unwrap()
        .to_owned()
}

/// A session opened for an existing account, as a sign-in would open it.
pub async fn open_session(
    app: &TestApp,
    user: Uuid,
    role: backend::types::Role,
    audience: backend::security::tokens::Audience,
) -> Value {
    let holder = backend::modules::auth::sessions::Holder {
        id: user,
        role,
        session_version: 1,
    };
    let session = backend::modules::auth::sessions::start(&app.state, holder, audience)
        .await
        .expect("a session");
    serde_json::to_value(session).unwrap()
}
