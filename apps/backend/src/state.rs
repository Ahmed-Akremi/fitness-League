use std::sync::Arc;

use redis::aio::ConnectionManager;
use secrecy::ExposeSecret;
use sqlx::MySqlPool;

use crate::{config::Config, db};

/// Everything a request handler can reach. Cheap to clone.
#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub db: MySqlPool,
    pub redis: ConnectionManager,
    /// Prefix of every Redis key: `fl:` in a deployment, unique per test.
    pub redis_prefix: Arc<str>,
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
        })
    }

    /// Connects to MariaDB and Redis, failing at start rather than on the first request.
    pub async fn connect(cfg: Config) -> Result<Self, String> {
        let db = db::connect(cfg.database_url.expose_secret(), 10)
            .await
            .map_err(|e| format!("database: {e}"))?;
        Self::new(cfg, db, "fl:").await
    }
}
