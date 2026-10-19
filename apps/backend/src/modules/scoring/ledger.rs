//! The XP ledger (docs §5.8): the only writer of `xp_transactions` and of the XP columns of
//! `user_stats`. Entries are append-only, and `user_stats` is their cache, updated in the same
//! transaction.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::MySqlConnection;
use uuid::Uuid;

use super::engine;
use crate::{error::AppError, rules::Rules};

pub struct XpEntry {
    pub user: Uuid,
    pub amount: i64,
    pub reason: &'static str,
    pub source_type: &'static str,
    pub source_id: String,
    pub workout_id: Option<Uuid>,
    pub explanation: Value,
    pub effective_at: DateTime<Utc>,
}

/// Appends the entry, then moves the balance and the level. The same `(reason, source)` twice is
/// refused by the database.
pub async fn append_xp(
    tx: &mut MySqlConnection,
    rules: &Rules,
    e: XpEntry,
) -> Result<Uuid, AppError> {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO xp_transactions (id, user_id, amount, reason, source_type, source_id, workout_id, \
           rule_set_version, explanation, effective_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        e.user,
        e.amount,
        e.reason,
        e.source_type,
        e.source_id,
        e.workout_id,
        rules.version,
        e.explanation.to_string(),
        e.effective_at.naive_utc()
    )
    .execute(&mut *tx)
    .await?;
    // Concurrent grants of one athlete wait here; the workout's transaction already holds the row.
    let balance = sqlx::query_scalar!(
        "SELECT xp_total FROM user_stats WHERE user_id = ? FOR UPDATE",
        e.user
    )
    .fetch_one(&mut *tx)
    .await?;
    let total = balance + e.amount;
    let level = engine::level_from_xp(total, rules);
    sqlx::query!(
        "UPDATE user_stats SET xp_total = ?, level = ?, xp_into_level = ?, xp_for_next_level = ? \
         WHERE user_id = ?",
        total,
        level.level,
        level.into,
        level.next,
        e.user
    )
    .execute(&mut *tx)
    .await?;
    Ok(id)
}
