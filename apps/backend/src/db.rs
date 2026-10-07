//! MariaDB access. Every connection runs in UTC, in strict SQL mode and at READ COMMITTED.

use std::str::FromStr;

use sqlx::{
    Executor, MySqlPool,
    migrate::Migrator,
    mysql::{MySqlConnectOptions, MySqlDatabaseError, MySqlPoolOptions},
};

pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

const SESSION_SETUP: &str = "SET time_zone = '+00:00', \
     sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY', \
     transaction_isolation = 'READ-COMMITTED'";

/// A lazy pool whose connections all apply the session settings. Tests pass the options sqlx hands them.
pub fn pool(opts: MySqlPoolOptions, conn: MySqlConnectOptions) -> MySqlPool {
    opts.after_connect(|connection, _meta| {
        Box::pin(async move { connection.execute(SESSION_SETUP).await.map(|_| ()) })
    })
    .connect_lazy_with(conn.charset("utf8mb4"))
}

/// Same pool, checked once so a wrong URL or password stops the process at start.
pub async fn connect(url: &str, max_connections: u32) -> Result<MySqlPool, sqlx::Error> {
    let pool = pool(
        MySqlPoolOptions::new().max_connections(max_connections),
        MySqlConnectOptions::from_str(url)?,
    );
    sqlx::query("SELECT 1").execute(&pool).await?;
    Ok(pool)
}

/// The unique index a statement collided with, when that is why it failed (MariaDB error 1062).
/// The server names it only inside its message: `Duplicate entry '…' for key 'uq_users_email'`.
/// The quoted value comes first and may contain anything, so the name is read from the end.
pub fn duplicate_key(e: &sqlx::Error) -> Option<&str> {
    let error = e
        .as_database_error()?
        .try_downcast_ref::<MySqlDatabaseError>()?;
    if error.number() != 1062 {
        return None;
    }
    let (_, key) = error.message().rsplit_once(" for key '")?;
    // MySQL writes `table.index`, MariaDB the index alone.
    key.trim_end_matches('\'').rsplit('.').next()
}

/// What may be logged about a database error. Never its message: the server quotes the values of
/// the statement in it (an email, in a duplicate-key error).
pub fn describe(e: &sqlx::Error) -> String {
    match e
        .as_database_error()
        .and_then(|d| d.try_downcast_ref::<MySqlDatabaseError>())
    {
        Some(error) => format!(
            "database error {} (SQLSTATE {}), key {}",
            error.number(),
            error.code().unwrap_or("?"),
            duplicate_key(e).unwrap_or("-")
        ),
        None => e.to_string(),
    }
}
