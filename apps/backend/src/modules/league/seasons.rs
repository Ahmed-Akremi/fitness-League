//! Seasons (docs §5.10.4): a calendar quarter per country, opened when due and closed into the next
//! one with a soft reset. A port of the old API's `SeasonsService`.

use chrono::{DateTime, Datelike, NaiveDateTime, Utc};
use sqlx::MySqlConnection;
use uuid::Uuid;

use crate::security::policy;

/// `Season 2026 Q4`: the name of the season starting at `start`.
pub fn name(start: DateTime<Utc>, offset: i32) -> String {
    let local = policy::business_today(start, offset);
    format!("Season {} Q{}", local.year(), local.month0() / 3 + 1)
}

/// Creates the country's current season (active, unless one already is) and the next one, each
/// unless it overlaps a season already there. Returns how many it created.
pub async fn plan(
    tx: &mut MySqlConnection,
    country: &str,
    now: DateTime<Utc>,
    offset: i32,
) -> Result<usize, sqlx::Error> {
    // Locked until the commit: the overlap check holds against another seed.
    let existing = sqlx::query!(
        "SELECT starts_at, ends_at, status FROM seasons WHERE country_code = ? FOR UPDATE",
        country
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut active = existing.iter().any(|s| s.status == "ACTIVE");
    let mut spans: Vec<(NaiveDateTime, NaiveDateTime)> =
        existing.iter().map(|s| (s.starts_at, s.ends_at)).collect();
    let (start, end) = policy::quarter_bounds(now, offset);
    let (_, after) = policy::quarter_bounds(end, offset);
    let mut created = 0;
    for (from, to, current) in [(start, end, true), (end, after, false)] {
        let (from_at, to_at) = (from.naive_utc(), to.naive_utc());
        if spans.iter().any(|(s, e)| *s < to_at && *e > from_at) {
            continue;
        }
        let status = if current && !active {
            active = true;
            "ACTIVE"
        } else {
            "SCHEDULED"
        };
        sqlx::query!(
            "INSERT INTO seasons (id, name, country_code, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?, ?)",
            Uuid::now_v7(),
            name(from, offset),
            country,
            from_at,
            to_at,
            status
        )
        .execute(&mut *tx)
        .await?;
        spans.push((from_at, to_at));
        created += 1;
    }
    Ok(created)
}
