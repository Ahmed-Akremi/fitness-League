use std::{
    sync::{
        Arc, LazyLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use redis::aio::ConnectionManager;
use secrecy::ExposeSecret;
use sqlx::MySqlPool;

use crate::{config::Config, db};

/// The longest a request waits for one Redis answer. Left alone, the connection manager holds the
/// caller for several seconds while it retries. A second is long enough for a slow answer to still
/// count as an answer: only a Redis that is really away is treated as away.
pub const REDIS_DEADLINE: Duration = Duration::from_secs(1);

/// After a call that got no answer, Redis is left alone for about this long, so that an outage costs
/// one wait and not one per request.
const REDIS_PAUSE_S: u64 = 2;

/// Seconds since this process first asked: a clock that never goes backwards.
fn uptime_s() -> u64 {
    static START: LazyLock<Instant> = LazyLock::new(Instant::now);
    START.elapsed().as_secs()
}

/// Everything a request handler can reach. Cheap to clone.
#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub db: MySqlPool,
    pub redis: ConnectionManager,
    /// Prefix of every Redis key: `fl:` in a deployment, unique per test.
    pub redis_prefix: Arc<str>,
    /// `uptime_s` until which Redis calls fail at once. See `redis_call`.
    redis_paused_until_s: Arc<AtomicU64>,
}

impl AppState {
    pub async fn new(cfg: Config, db: MySqlPool, redis_prefix: &str) -> Result<Self, String> {
        let client = redis::Client::open(cfg.redis_url.expose_secret())
            .map_err(|e| format!("REDIS_URL: {e}"))?;
        let redis = ConnectionManager::new(client)
            .await
            .map_err(|e| format!("redis: {e}"))?;
        Ok(Self {
            cfg: Arc::new(cfg),
            db,
            redis,
            redis_prefix: redis_prefix.into(),
            redis_paused_until_s: Arc::default(),
        })
    }

    /// Awaits one Redis call, for `REDIS_DEADLINE` at most. A call that fails pauses Redis for this
    /// process: the calls of the next two seconds fail at once instead of each waiting in turn.
    /// Every request-time call goes through here.
    pub async fn redis_call<T>(
        &self,
        call: impl Future<Output = redis::RedisResult<T>>,
    ) -> Result<T, String> {
        let now = uptime_s();
        if now < self.redis_paused_until_s.load(Ordering::Relaxed) {
            return Err("Redis gave no answer a moment ago".to_owned());
        }
        let failure = match tokio::time::timeout(REDIS_DEADLINE, call).await {
            Ok(Ok(value)) => return Ok(value),
            Ok(Err(e)) => e.to_string(),
            Err(_) => "no answer within the deadline".to_owned(),
        };
        self.redis_paused_until_s
            .store(now + REDIS_PAUSE_S, Ordering::Relaxed);
        Err(failure)
    }

    /// Connects to MariaDB and Redis, failing at start rather than on the first request.
    pub async fn connect(cfg: Config) -> Result<Self, String> {
        let db = db::connect(cfg.database_url.expose_secret(), 10)
            .await
            .map_err(|e| format!("database: {e}"))?;
        Self::new(cfg, db, "fl:").await
    }
}
