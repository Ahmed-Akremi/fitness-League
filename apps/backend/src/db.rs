//! MariaDB access. Every connection runs in UTC, in strict SQL mode and at READ COMMITTED.

use std::str::FromStr;

use sqlx::{
    Executor, MySqlPool,
    migrate::Migrator,
    mysql::{MySqlConnectOptions, MySqlPoolOptions},
};

pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

const SESSION_SETUP: &str = "SET time_zone = '+00:00', \
     sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY', \
     transaction_isolation = 'READ-COMMITTED'";

/// A lazy pool whose connections all apply the session settings. Tests pass the options sqlx hands them.
pub fn pool(opts: MySqlPoolOptions, conn: MySqlConnectOptions) -> MySqlPool {
    opts.after_connect(|connection, _meta| Box::pin(async move { connection.execute(SESSION_SETUP).await.map(|_| ()) }))
        .connect_lazy_with(conn.charset("utf8mb4"))
}

/// Same pool, checked once so a wrong URL or password stops the process at start.
pub async fn connect(url: &str, max_connections: u32) -> Result<MySqlPool, sqlx::Error> {
    let pool = pool(MySqlPoolOptions::new().max_connections(max_connections), MySqlConnectOptions::from_str(url)?);
    sqlx::query("SELECT 1").execute(&pool).await?;
    Ok(pool)
}
