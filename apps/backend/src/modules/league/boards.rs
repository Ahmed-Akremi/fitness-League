//! Leaderboards (docs §15): the active season's eligible athletes ranked by LP, nationally, per
//! governorate and among my friends, with the movement since the last daily snapshot. A port of the
//! old API's `LeaderboardsService`; ranked in SQL (spec ruling 3).

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::MySqlPool;
use uuid::Uuid;

use super::seasons;
use crate::{
    error::AppError,
    http::{auth::AppUser, page},
    security::policy,
    state::AppState,
    validate::ValidQuery,
};

#[derive(Deserialize)]
pub struct PageQuery {
    limit: Option<String>,
    cursor: Option<String>,
}

/// Where a page stops: the last row's LP and athlete.
#[derive(Serialize, Deserialize)]
struct Position {
    lp: i64,
    id: Uuid,
}

struct Row {
    user_id: Uuid,
    lp: i32,
    level: i32,
    division: Option<String>,
    rank: i64,
    username: String,
    full_name: String,
    governorate_id: Uuid,
    governorate_code: String,
    name_fr: String,
    name_en: String,
    name_ar: String,
    /// The rank in the last snapshot before today, if the athlete was in it.
    previous: Option<i32>,
}

impl Row {
    /// `compare`: the board has snapshots, so a row gets its movement (the friends board has none).
    fn view(&self, compare: bool) -> Value {
        json!({
            "rank": self.rank,
            "athlete": {"id": self.user_id, "username": self.username, "fullName": self.full_name},
            // Gyms come with part 3.
            "gym": null,
            "governorate": {
                "id": self.governorate_id,
                "code": self.governorate_code,
                "name": {"fr": self.name_fr, "en": self.name_en, "ar": self.name_ar},
            },
            "lp": self.lp,
            "level": self.level,
            "division": self.division,
            "movement": if compare {
                self.previous.map_or(json!("NEW"), |p| json!(i64::from(p) - self.rank))
            } else {
                Value::Null
            },
        })
    }

    fn position(&self) -> Position {
        Position {
            lp: i64::from(self.lp),
            id: self.user_id,
        }
    }
}

/// Whose athletes a board ranks.
#[derive(Clone, Copy)]
enum Scope {
    National,
    Governorate(Uuid),
    /// This athlete and their accepted friends.
    Friends(Uuid),
}

/// A board: the season, the scope, the clock its eligibility reads, and the snapshot it compares with.
struct Board {
    season: Uuid,
    governorate: Option<Uuid>,
    friends_of: Option<Uuid>,
    scope_type: &'static str,
    scope_id: Uuid,
    now: NaiveDateTime,
    previous: Option<NaiveDate>,
}

impl Board {
    async fn of(state: &AppState, user: Uuid, scope: Scope) -> Result<Self, AppError> {
        let country =
            sqlx::query_scalar!("SELECT country_code FROM profiles WHERE user_id = ?", user)
                .fetch_one(&state.db)
                .await?;
        let season = seasons::active(&state.db, &country)
            .await?
            .ok_or_else(|| AppError::not_found("Season"))?;
        // No snapshot is ever taken of a friends board (as in the old API), so it finds none.
        let (governorate, friends_of, scope_type, scope_id) = match scope {
            Scope::National => (None, None, "NATIONAL", Uuid::nil()),
            Scope::Governorate(id) => (Some(id), None, "GOVERNORATE", id),
            Scope::Friends(of) => (None, Some(of), "FRIENDS", of),
        };
        let now = Utc::now();
        let today = policy::business_today(now, state.cfg.business_utc_offset_minutes);
        let previous = sqlx::query_scalar!(
            "SELECT MAX(snapshot_date) FROM leaderboard_snapshots \
             WHERE season_id = ? AND scope_type = ? AND scope_id = ? AND snapshot_date < ?",
            season.id,
            scope_type,
            scope_id,
            today
        )
        .fetch_one(&state.db)
        .await?;
        Ok(Self {
            season: season.id,
            governorate,
            friends_of,
            scope_type,
            scope_id,
            now: now.naive_utc(),
            previous,
        })
    }

    fn compare(&self) -> bool {
        self.friends_of.is_none()
    }

    /// The ranked rows, best first: one athlete's (`only`), or those after `after`, at most `limit`.
    async fn rows(
        &self,
        db: &MySqlPool,
        only: Option<Uuid>,
        after: Option<&Position>,
        limit: usize,
    ) -> Result<Vec<Row>, AppError> {
        let (after_lp, after_id) = (after.map(|p| p.lp), after.map(|p| p.id));
        Ok(sqlx::query_as!(
            Row,
            r#"SELECT t.user_id AS "user_id!: Uuid", t.lp AS "lp!", t.level AS "level!", t.division, t.ranked AS "rank!: i64",
                      t.username AS "username!", t.full_name AS "full_name!", t.governorate_id AS "governorate_id!: Uuid",
                      t.governorate_code AS "governorate_code!", t.name_fr AS "name_fr!", t.name_en AS "name_en!",
                      t.name_ar AS "name_ar!", ls.`rank` AS "previous?: i32"
               FROM (SELECT us.user_id, us.season_lp AS lp, us.level, us.division_code AS division,
                            CAST(RANK() OVER (ORDER BY us.season_lp DESC) AS SIGNED) AS ranked,
                            u.username, p.full_name, g.id AS governorate_id, g.code AS governorate_code,
                            g.name_fr, g.name_en, g.name_ar
                     FROM user_stats us JOIN users u ON u.id = us.user_id JOIN profiles p ON p.user_id = us.user_id
                       JOIN user_settings s ON s.user_id = us.user_id JOIN governorates g ON g.id = p.governorate_id
                     WHERE us.current_season_id = ? AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL
                       AND p.calibration_ends_at <= ? AND s.show_on_leaderboards
                       AND (? IS NULL OR p.governorate_id = ?)
                       AND (? IS NULL OR us.user_id = ? OR us.user_id IN (
                             SELECT IF(f.user_low_id = ?, f.user_high_id, f.user_low_id) FROM friendships f
                             WHERE f.status = 'ACCEPTED' AND (f.user_low_id = ? OR f.user_high_id = ?)))) t
                 LEFT JOIN leaderboard_snapshots ls ON ls.snapshot_date = ? AND ls.season_id = ?
                   AND ls.scope_type = ? AND ls.scope_id = ? AND ls.user_id = t.user_id
               WHERE (? IS NULL OR t.user_id = ?) AND (? IS NULL OR t.lp < ? OR (t.lp = ? AND t.user_id > ?))
               ORDER BY t.lp DESC, t.user_id
               LIMIT ?"#,
            self.season,
            self.now,
            self.governorate,
            self.governorate,
            self.friends_of,
            self.friends_of,
            self.friends_of,
            self.friends_of,
            self.friends_of,
            self.previous,
            self.season,
            self.scope_type,
            self.scope_id,
            only,
            only,
            after_lp,
            after_lp,
            after_lp,
            after_id,
            limit as i64
        )
        .fetch_all(db)
        .await?)
    }

    /// The `limit` rows just above `me`, nearest first.
    async fn above(&self, db: &MySqlPool, me: &Row, limit: usize) -> Result<Vec<Row>, AppError> {
        Ok(sqlx::query_as!(
            Row,
            r#"SELECT t.user_id AS "user_id!: Uuid", t.lp AS "lp!", t.level AS "level!", t.division, t.ranked AS "rank!: i64",
                      t.username AS "username!", t.full_name AS "full_name!", t.governorate_id AS "governorate_id!: Uuid",
                      t.governorate_code AS "governorate_code!", t.name_fr AS "name_fr!", t.name_en AS "name_en!",
                      t.name_ar AS "name_ar!", ls.`rank` AS "previous?: i32"
               FROM (SELECT us.user_id, us.season_lp AS lp, us.level, us.division_code AS division,
                            CAST(RANK() OVER (ORDER BY us.season_lp DESC) AS SIGNED) AS ranked,
                            u.username, p.full_name, g.id AS governorate_id, g.code AS governorate_code,
                            g.name_fr, g.name_en, g.name_ar
                     FROM user_stats us JOIN users u ON u.id = us.user_id JOIN profiles p ON p.user_id = us.user_id
                       JOIN user_settings s ON s.user_id = us.user_id JOIN governorates g ON g.id = p.governorate_id
                     WHERE us.current_season_id = ? AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL
                       AND p.calibration_ends_at <= ? AND s.show_on_leaderboards
                       AND (? IS NULL OR p.governorate_id = ?)
                       AND (? IS NULL OR us.user_id = ? OR us.user_id IN (
                             SELECT IF(f.user_low_id = ?, f.user_high_id, f.user_low_id) FROM friendships f
                             WHERE f.status = 'ACCEPTED' AND (f.user_low_id = ? OR f.user_high_id = ?)))) t
                 LEFT JOIN leaderboard_snapshots ls ON ls.snapshot_date = ? AND ls.season_id = ?
                   AND ls.scope_type = ? AND ls.scope_id = ? AND ls.user_id = t.user_id
               WHERE t.lp > ? OR (t.lp = ? AND t.user_id < ?)
               ORDER BY t.lp, t.user_id DESC
               LIMIT ?"#,
            self.season,
            self.now,
            self.governorate,
            self.governorate,
            self.friends_of,
            self.friends_of,
            self.friends_of,
            self.friends_of,
            self.friends_of,
            self.previous,
            self.season,
            self.scope_type,
            self.scope_id,
            me.lp,
            me.lp,
            me.user_id,
            limit as i64
        )
        .fetch_all(db)
        .await?)
    }
}

fn governorate_param(raw: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(raw).map_err(|_| AppError::not_found("Governorate"))
}

async fn page_of(
    state: &AppState,
    user: Uuid,
    scope: Scope,
    query: PageQuery,
) -> Result<Json<Value>, AppError> {
    let limit = page::limit(query.limit.as_deref())? as usize;
    let secret = &state.cfg.app_hmac_secret;
    let after: Option<Position> = query
        .cursor
        .as_deref()
        .map(|raw| page::decode(secret, raw))
        .transpose()?;
    let board = Board::of(state, user, scope).await?;
    // One more than asked: it only tells whether another page exists.
    let mut rows = board
        .rows(&state.db, None, after.as_ref(), limit + 1)
        .await?;
    let next = if rows.len() > limit {
        rows.truncate(limit);
        rows.last()
            .map(|last| page::encode(secret, &last.position()))
            .transpose()?
    } else {
        None
    };
    let mut answer = page::page(
        rows.iter().map(|row| row.view(board.compare())).collect(),
        next,
    );
    answer["seasonId"] = json!(board.season);
    Ok(Json(answer))
}

/// « Jump to my rank »: the page holding me, with me near its middle.
async fn around_me(
    state: &AppState,
    user: Uuid,
    scope: Scope,
    query: PageQuery,
) -> Result<Json<Value>, AppError> {
    let limit = page::limit(query.limit.as_deref())? as usize;
    let secret = &state.cfg.app_hmac_secret;
    let board = Board::of(state, user, scope).await?;
    let compare = board.compare();
    let Some(me) = board.rows(&state.db, Some(user), None, 1).await?.pop() else {
        return Ok(Json(json!({
            "seasonId": board.season, "me": null, "data": [],
            "page": {"nextCursor": null, "hasMore": false},
        })));
    };
    let mut head = board.above(&state.db, &me, limit / 2).await?;
    head.reverse();
    let mut data: Vec<Value> = head.iter().map(|row| row.view(compare)).collect();
    let me_view = me.view(compare);
    data.push(me_view.clone());
    let remaining = limit.saturating_sub(data.len());
    let mine = page::encode(secret, &me.position())?;
    let page = if remaining > 0 {
        let mut tail = board
            .rows(&state.db, None, Some(&me.position()), remaining + 1)
            .await?;
        let next = if tail.len() > remaining {
            tail.truncate(remaining);
            tail.last()
                .map(|last| page::encode(secret, &last.position()))
                .transpose()?
        } else {
            None
        };
        data.extend(tail.iter().map(|row| row.view(compare)));
        json!({"nextCursor": next, "hasMore": next.is_some()})
    } else {
        json!({"nextCursor": mine, "hasMore": true})
    };
    Ok(Json(json!({
        "seasonId": board.season, "me": me_view, "data": data, "page": page,
    })))
}

pub async fn national(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidQuery(query): ValidQuery<PageQuery>,
) -> Result<Json<Value>, AppError> {
    page_of(&state, user.id, Scope::National, query).await
}

pub async fn national_me(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidQuery(query): ValidQuery<PageQuery>,
) -> Result<Json<Value>, AppError> {
    around_me(&state, user.id, Scope::National, query).await
}

pub async fn governorate(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
    ValidQuery(query): ValidQuery<PageQuery>,
) -> Result<Json<Value>, AppError> {
    let scope = Scope::Governorate(governorate_param(&id)?);
    page_of(&state, user.id, scope, query).await
}

pub async fn governorate_me(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
    ValidQuery(query): ValidQuery<PageQuery>,
) -> Result<Json<Value>, AppError> {
    let scope = Scope::Governorate(governorate_param(&id)?);
    around_me(&state, user.id, scope, query).await
}

pub async fn friends(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidQuery(query): ValidQuery<PageQuery>,
) -> Result<Json<Value>, AppError> {
    page_of(&state, user.id, Scope::Friends(user.id), query).await
}

pub async fn friends_me(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidQuery(query): ValidQuery<PageQuery>,
) -> Result<Json<Value>, AppError> {
    around_me(&state, user.id, Scope::Friends(user.id), query).await
}

/// `GET /me/ranks`: my national, governorate and friends ranks; the gym's comes with plan 3b.
pub async fn my_ranks(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
    let governorate = sqlx::query_scalar!(
        r#"SELECT governorate_id AS "id: Uuid" FROM profiles WHERE user_id = ?"#,
        user.id
    )
    .fetch_one(&state.db)
    .await?;
    let mut ranks = Vec::new();
    let mut season = None;
    let scopes = [
        Scope::National,
        Scope::Governorate(governorate),
        Scope::Friends(user.id),
    ];
    for scope in scopes {
        let board = Board::of(&state, user.id, scope).await?;
        let mine = board.rows(&state.db, Some(user.id), None, 1).await?;
        ranks.push(mine.first().map(|r| r.rank));
        season = Some(board.season);
    }
    Ok(Json(json!({
        "seasonId": season, "national": ranks[0], "governorate": ranks[1], "gym": null, "friends": ranks[2],
    })))
}

/// Today's ranks of every active season's eligible athletes, nationally and per governorate: the
/// reference of tomorrow's movement arrows. A second run the same day adds nothing.
pub async fn snapshot(db: &MySqlPool, now: DateTime<Utc>, offset: i32) -> Result<Value, AppError> {
    let day = policy::business_today(now, offset);
    let at = now.naive_utc();
    let seasons =
        sqlx::query_scalar!(r#"SELECT id AS "id: Uuid" FROM seasons WHERE status = 'ACTIVE'"#)
            .fetch_all(db)
            .await?;
    let mut rows = 0;
    for season in seasons {
        rows += sqlx::query!(
            "INSERT IGNORE INTO leaderboard_snapshots (snapshot_date, season_id, scope_type, scope_id, user_id, `rank`, lp) \
             SELECT ?, ?, 'NATIONAL', ?, us.user_id, RANK() OVER (ORDER BY us.season_lp DESC), us.season_lp \
             FROM user_stats us JOIN users u ON u.id = us.user_id JOIN profiles p ON p.user_id = us.user_id \
               JOIN user_settings s ON s.user_id = us.user_id \
             WHERE us.current_season_id = ? AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL \
               AND p.calibration_ends_at <= ? AND s.show_on_leaderboards",
            day,
            season,
            Uuid::nil(),
            season,
            at
        )
        .execute(db)
        .await?
        .rows_affected();
        rows += sqlx::query!(
            "INSERT IGNORE INTO leaderboard_snapshots (snapshot_date, season_id, scope_type, scope_id, user_id, `rank`, lp) \
             SELECT ?, ?, 'GOVERNORATE', p.governorate_id, us.user_id, \
                    RANK() OVER (PARTITION BY p.governorate_id ORDER BY us.season_lp DESC), us.season_lp \
             FROM user_stats us JOIN users u ON u.id = us.user_id JOIN profiles p ON p.user_id = us.user_id \
               JOIN user_settings s ON s.user_id = us.user_id \
             WHERE us.current_season_id = ? AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL \
               AND p.calibration_ends_at <= ? AND s.show_on_leaderboards",
            day,
            season,
            season,
            at
        )
        .execute(db)
        .await?
        .rows_affected();
    }
    Ok(json!({"rows": rows}))
}
