//! Seasons (docs §5.10.4): a calendar quarter per country, opened when due and closed into the next
//! one with a soft reset. A port of the old API's `SeasonsService`.

use axum::{Json, extract::State};
use chrono::{DateTime, Datelike, Duration, NaiveDateTime, Utc};
use serde_json::{Value, json};
use sqlx::{MySqlConnection, MySqlPool};
use uuid::Uuid;

use super::engine;
use crate::{
    db,
    error::AppError,
    http::auth::AppUser,
    modules::scoring::ledger::{self, LpEntry},
    rules::Rules,
    security::policy,
    state::AppState,
    types::iso,
};

pub struct Season {
    pub id: Uuid,
    pub name: String,
    pub starts_at: NaiveDateTime,
    pub ends_at: NaiveDateTime,
    pub status: String,
}

impl Season {
    pub fn view(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "startsAt": iso(self.starts_at),
            "endsAt": iso(self.ends_at),
            "status": self.status,
        })
    }
}

/// The country's active season.
pub async fn active(db: &MySqlPool, country: &str) -> Result<Option<Season>, AppError> {
    Ok(sqlx::query_as!(
        Season,
        r#"SELECT id AS "id: Uuid", name, starts_at, ends_at, status FROM seasons
           WHERE country_code = ? AND status = 'ACTIVE'"#,
        country
    )
    .fetch_optional(db)
    .await?)
}

/// Opens the scheduled seasons whose start has passed, unless their country has an active one.
pub async fn open_due(db: &MySqlPool, now: DateTime<Utc>) -> Result<Value, AppError> {
    let due = sqlx::query_scalar!(
        r#"SELECT id AS "id: Uuid" FROM seasons WHERE status = 'SCHEDULED' AND starts_at <= ? ORDER BY starts_at"#,
        now.naive_utc()
    )
    .fetch_all(db)
    .await?;
    let mut opened = 0;
    for id in due {
        // The one-active-season index refuses it while the country has an active season.
        match sqlx::query!("UPDATE seasons SET status = 'ACTIVE' WHERE id = ? AND status = 'SCHEDULED'", id)
            .execute(db)
            .await
        {
            Ok(done) => opened += done.rows_affected(),
            Err(e) if db::duplicate_key(&e) == Some("uq_seasons_one_active") => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(json!({"opened": opened}))
}

/// The season that follows one ending at `ends_at`: the country's next scheduled one, else a new
/// quarter. Its id and start.
async fn successor(
    tx: &mut MySqlConnection,
    country: &str,
    ends_at: NaiveDateTime,
    offset: i32,
) -> Result<(Uuid, NaiveDateTime), AppError> {
    let scheduled = sqlx::query!(
        r#"SELECT id AS "id: Uuid", starts_at FROM seasons
           WHERE country_code = ? AND status = 'SCHEDULED' AND starts_at >= ? ORDER BY starts_at LIMIT 1"#,
        country,
        ends_at
    )
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(s) = scheduled {
        return Ok((s.id, s.starts_at));
    }
    let (quarter, end) = policy::quarter_bounds(ends_at.and_utc() + Duration::days(1), offset);
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO seasons (id, name, country_code, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?, 'SCHEDULED')",
        id,
        name(quarter, offset),
        country,
        ends_at,
        end.naive_utc()
    )
    .execute(&mut *tx)
    .await?;
    Ok((id, ends_at))
}

/// Closes a season (docs §5.10.4), in one transaction: the standings and champions, then every
/// athlete carried into the next season with the soft reset, which then opens.
/// shortcut: one transaction for the whole close, split it per athlete once a season holds many
/// thousand athletes.
pub async fn close(
    state: &AppState,
    rules: &Rules,
    season: Uuid,
    now: DateTime<Utc>,
) -> Result<Value, AppError> {
    let mut tx = state.db.begin().await?;
    let Some(s) = sqlx::query!(
        "SELECT country_code, ends_at, status FROM seasons WHERE id = ? FOR UPDATE",
        season
    )
    .fetch_optional(&mut *tx)
    .await?
    .filter(|s| s.status != "CLOSED") else {
        return Ok(json!({"standings": 0, "nextSeasonId": null}));
    };
    let (next, next_start) = successor(
        &mut tx,
        &s.country_code,
        s.ends_at,
        state.cfg.business_utc_offset_minutes,
    )
    .await?;

    let standings = sqlx::query!(
        "INSERT IGNORE INTO season_standings (season_id, user_id, final_lp, division, rank_national, \
           rank_governorate, rank_gym, is_champion, champion_scope) \
         SELECT ?, r.user_id, r.lp, r.division, r.national, r.governorate, r.gym, \
                r.national = 1 OR r.governorate = 1, \
                CASE WHEN r.national = 1 THEN 'NATIONAL' WHEN r.governorate = 1 THEN 'GOVERNORATE' END \
         FROM (SELECT us.user_id, us.season_lp AS lp, COALESCE(us.division_code, 'BRONZE') AS division, \
                      RANK() OVER (ORDER BY us.season_lp DESC) AS national, \
                      RANK() OVER (PARTITION BY p.governorate_id ORDER BY us.season_lp DESC) AS governorate, \
                      IF(p.primary_gym_id IS NULL, NULL, \
                         RANK() OVER (PARTITION BY p.primary_gym_id ORDER BY us.season_lp DESC)) AS gym \
               FROM user_stats us JOIN users u ON u.id = us.user_id JOIN profiles p ON p.user_id = us.user_id \
               WHERE us.current_season_id = ? AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL \
                 AND us.season_lp > 0) r",
        season,
        season
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();

    let athletes = sqlx::query!(
        r#"SELECT user_id AS "user: Uuid", season_lp FROM user_stats WHERE current_season_id = ? FOR UPDATE"#,
        season
    )
    .fetch_all(&mut *tx)
    .await?;
    let t = &rules.division_thresholds;
    for a in athletes {
        let lp = i64::from(a.season_lp);
        let carried = engine::soft_reset(lp, t, rules.season_soft_reset_ratio);
        sqlx::query!(
            "UPDATE user_stats SET current_season_id = ?, season_lp = 0, division_code = 'BRONZE' WHERE user_id = ?",
            next,
            a.user
        )
        .execute(&mut *tx)
        .await?;
        if carried > 0 {
            let e = LpEntry {
                user: a.user,
                season: next,
                amount: carried,
                reason: "SEASON_SOFT_RESET",
                source_type: "season",
                source_id: season.to_string(),
                explanation: json!({
                    "formula": "floor + (lp − floor) × ratio",
                    "inputs": {"lp": lp, "floor": engine::division_floor(lp, t), "ratio": rules.season_soft_reset_ratio},
                    "result": carried,
                }),
                effective_at: next_start.and_utc(),
            };
            ledger::append_lp(&mut tx, rules, e).await?;
        }
    }
    sqlx::query!(
        "UPDATE seasons SET status = 'CLOSED', closed_at = ?, rule_set_version_at_close = ? WHERE id = ?",
        now.naive_utc(),
        rules.version,
        season
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!("UPDATE seasons SET status = 'ACTIVE' WHERE id = ?", next)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(json!({"standings": standings, "nextSeasonId": next}))
}

/// `GET /me/lp`: my LP and division in the active season, and what the next division needs.
pub async fn my_lp(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
    let rules = Rules::active(&state.db).await?;
    let me = sqlx::query!(
        r#"SELECT p.country_code, s.season_lp, s.current_season_id AS "current: Uuid", s.division_code
           FROM profiles p JOIN user_stats s ON s.user_id = p.user_id WHERE p.user_id = ?"#,
        user.id
    )
    .fetch_one(&state.db)
    .await?;
    let season = active(&state.db, &me.country_code)
        .await?
        .ok_or_else(|| AppError::not_found("Season"))?;
    let live = me.current == Some(season.id);
    let lp = if live { i64::from(me.season_lp) } else { 0 };
    let t = &rules.division_thresholds;
    let division = me
        .division_code
        .filter(|_| live)
        .unwrap_or_else(|| engine::division_for(lp, t).as_str().to_owned());
    let next = engine::next_division(lp, t);
    Ok(Json(json!({
        "season": season.view(),
        "lp": lp,
        "division": division,
        "nextDivision": next.map(|(d, _)| d.as_str()),
        "lpToNextDivision": next.map(|(_, missing)| missing),
    })))
}

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
