//! The XP and League Points ledgers (docs §5.8): the only writer of `xp_transactions`,
//! `league_point_transactions` and of the balances in `user_stats`. Entries are append-only, and
//! `user_stats` is their cache, updated in the same transaction.

use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::MySqlConnection;
use uuid::Uuid;

use super::engine;
use crate::{
    error::AppError,
    modules::{
        feed::{self, Activity},
        league,
    },
    rules::Rules,
    types::Visibility,
};

pub struct LpEntry {
    pub user: Uuid,
    pub season: Uuid,
    pub amount: i64,
    pub reason: &'static str,
    pub source_type: &'static str,
    pub source_id: String,
    pub explanation: Value,
    pub effective_at: DateTime<Utc>,
}

/// Appends the entry, then moves the season's balance and the division. The same `(reason, source)`
/// twice is refused by the database.
pub async fn append_lp(
    tx: &mut MySqlConnection,
    rules: &Rules,
    e: LpEntry,
) -> Result<Uuid, AppError> {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO league_point_transactions (id, user_id, season_id, amount, reason, source_type, source_id, \
           rule_set_version, explanation, effective_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        e.user,
        e.season,
        e.amount,
        e.reason,
        e.source_type,
        e.source_id,
        rules.version,
        e.explanation.to_string(),
        e.effective_at.naive_utc()
    )
    .execute(&mut *tx)
    .await?;
    apply_lp(tx, rules, e.user, e.season, e.amount).await?;
    Ok(id)
}

/// Appends the opposite of the athlete's entry `original`. `None` when it is a reversal, is
/// already reversed, or is not theirs.
pub async fn reverse_lp(
    tx: &mut MySqlConnection,
    rules: &Rules,
    user: Uuid,
    original: Uuid,
    why: &str,
) -> Result<Option<Uuid>, AppError> {
    let entry = sqlx::query!(
        r#"SELECT season_id AS "season: Uuid", amount, reason, source_type, source_id, effective_at,
                  EXISTS (SELECT 1 FROM league_point_transactions r WHERE r.reverses_id = l.id) AS "reversed!: bool"
           FROM league_point_transactions l WHERE id = ? AND user_id = ?"#,
        original,
        user
    )
    .fetch_optional(&mut *tx)
    .await?;
    let Some(o) = entry.filter(|o| !o.reversed && o.reason != "REVERSAL") else {
        return Ok(None);
    };
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO league_point_transactions (id, user_id, season_id, amount, reason, source_type, source_id, \
           reverses_id, rule_set_version, explanation, effective_at) \
         VALUES (?, ?, ?, ?, 'REVERSAL', ?, ?, ?, ?, ?, ?)",
        id,
        user,
        o.season,
        -o.amount,
        o.source_type,
        o.source_id,
        original,
        rules.version,
        json!({"reverses": original, "why": why}).to_string(),
        o.effective_at
    )
    .execute(&mut *tx)
    .await?;
    apply_lp(tx, rules, user, o.season, -i64::from(o.amount)).await?;
    Ok(Some(id))
}

/// Only the athlete's current season moves the live balance: a correction to a past season stays
/// in its history.
async fn apply_lp(
    tx: &mut MySqlConnection,
    rules: &Rules,
    user: Uuid,
    season: Uuid,
    delta: i64,
) -> Result<(), AppError> {
    let stats = sqlx::query!(
        r#"SELECT season_lp, current_season_id AS "current: Uuid" FROM user_stats WHERE user_id = ? FOR UPDATE"#,
        user
    )
    .fetch_one(&mut *tx)
    .await?;
    if stats.current.is_some_and(|current| current != season) {
        return Ok(());
    }
    // An athlete without a season joins only an active one: a late entry of a closed season would
    // otherwise hold their balance there for the whole next season.
    if stats.current.is_none() {
        let active = sqlx::query_scalar!(
            "SELECT EXISTS (SELECT 1 FROM seasons WHERE id = ? AND status = 'ACTIVE')",
            season
        )
        .fetch_one(&mut *tx)
        .await?;
        if active == 0 {
            return Ok(());
        }
    }
    let lp = (i64::from(stats.season_lp) + delta).max(0);
    let division = league::engine::division_for(lp, &rules.division_thresholds);
    sqlx::query!(
        "UPDATE user_stats SET season_lp = ?, current_season_id = ?, division_code = ? WHERE user_id = ?",
        lp,
        season,
        division.as_str(),
        user
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

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
    let before = sqlx::query!(
        "SELECT xp_total, level FROM user_stats WHERE user_id = ? FOR UPDATE",
        e.user
    )
    .fetch_one(&mut *tx)
    .await?;
    let total = before.xp_total + e.amount;
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
    // Every grant that raises the level reaches the feed, whatever earned it (plan 3c ruling 2).
    if level.level > before.level {
        let up = Activity {
            user: e.user,
            kind: feed::Kind::LevelUp,
            ref_id: id,
            visibility: Visibility::Friends.as_str(),
            payload: json!({"from": before.level, "to": level.level}),
            sport: None,
            exercise: None,
            badge: None,
        };
        feed::record(tx, up).await?;
    }
    Ok(id)
}
