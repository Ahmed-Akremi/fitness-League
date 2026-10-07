use std::{sync::Arc, time::Duration};

use redis::aio::{ConnectionManager, ConnectionManagerConfig};
use secrecy::ExposeSecret;
use sqlx::MySqlPool;

use crate::{config::Config, db};

/// The longest Redis is given to accept a connection, and to answer a command.
const REDIS_DEADLINE: Duration = Duration::from_secs(1);

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
        // No retry inside a request. The crate's default is six attempts with a growing delay, and
        // every caller waits for all of them: during an outage each request then took 6 to 13 s.
        // Without retries a request fails at once and is itself the next attempt to reconnect, so
        // Redis is used again from the first request after it is back.
        let settings = ConnectionManagerConfig::new()
            .set_number_of_retries(0)
            .set_connection_timeout(Some(REDIS_DEADLINE))
            .set_response_timeout(Some(REDIS_DEADLINE));
        let redis = ConnectionManager::new_with_config(client, settings)
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
