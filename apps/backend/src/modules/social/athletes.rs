//! The athlete search and public profiles (the old `SocialService.search` and `publicProfile`).

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use super::{Summary, pair};
use crate::{
    error::AppError,
    http::{auth::AppUser, page, rate_limit},
    security::policy,
    state::AppState,
    validate::{Check, ValidQuery, contains},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchQuery {
    q: Option<String>,
    limit: Option<String>,
    cursor: Option<String>,
}

/// Where a page of the search stops: the last username shown.
#[derive(Serialize, Deserialize)]
struct After {
    u: String,
}

/// Active athletes whose username or full name holds the text, accent- and case-insensitive (the
/// columns' collation), never me and never anyone blocked either way; by username.
pub async fn search(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidQuery(query): ValidQuery<SearchQuery>,
) -> Result<Json<Value>, AppError> {
    rate_limit::check(&state, &rate_limit::SEARCH_USER, &user.id.to_string()).await?;
    let mut check = Check::default();
    match &query.q {
        None => check.fail("q", "REQUIRED"),
        Some(q) => check.length("q", q, 2, 40),
    }
    check.finish()?;
    let pattern = contains(query.q.as_deref().unwrap_or_default());
    let limit = page::limit(query.limit.as_deref())? as usize;
    let secret = &state.cfg.app_hmac_secret;
    let after = query
        .cursor
        .as_deref()
        .map(|raw| page::decode::<After>(secret, raw))
        .transpose()?
        .map(|a| a.u);
    let mut rows = sqlx::query_as!(
        Summary,
        r#"SELECT u.id AS "id: Uuid", u.username, p.full_name, g.code AS governorate, us.level
           FROM users u JOIN profiles p ON p.user_id = u.id JOIN governorates g ON g.id = p.governorate_id
             JOIN user_stats us ON us.user_id = u.id
           WHERE u.status = 'ACTIVE' AND u.id <> ?
             AND (u.username LIKE ? ESCAPE '|' OR p.full_name LIKE ? ESCAPE '|')
             AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
                                                     OR (b.blocker_id = u.id AND b.blocked_id = ?))
             AND (? IS NULL OR u.username > ?)
           ORDER BY u.username
           LIMIT ?"#,
        user.id,
        pattern,
        pattern,
        user.id,
        user.id,
        after,
        after,
        limit as i64 + 1
    )
    .fetch_all(&state.db)
    .await?;
    let next = if rows.len() > limit {
        rows.truncate(limit);
        rows.last()
            .map(|last| {
                page::encode(
                    secret,
                    &After {
                        u: last.username.clone(),
                    },
                )
            })
            .transpose()?
    } else {
        None
    };
    let data = rows
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::internal)?;
    Ok(Json(page::page(data, next)))
}

/// An athlete's public page: never the email, the birth date or body data; the age bracket only
/// when the athlete opted in. A blocked account, either way, is not found.
pub async fn profile(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(username): Path<String>,
) -> Result<Json<Value>, AppError> {
    let row = sqlx::query!(
        r#"SELECT u.id AS "id: Uuid", u.username, u.status, u.date_of_birth, p.full_name, p.bio,
                  g.code, g.name_fr, g.name_en, g.name_ar, s.show_age_bracket AS "show_age_bracket: bool",
                  us.level, us.division_code, us.season_lp,
                  (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS "followers!: i64",
                  (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS "following!: i64",
                  EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
                                                  OR (b.blocker_id = u.id AND b.blocked_id = ?)) AS "blocked!: i64"
           FROM users u JOIN profiles p ON p.user_id = u.id JOIN governorates g ON g.id = p.governorate_id
             JOIN user_settings s ON s.user_id = u.id JOIN user_stats us ON us.user_id = u.id
           WHERE u.username = ?"#,
        user.id,
        user.id,
        username
    )
    .fetch_optional(&state.db)
    .await?
    .filter(|r| r.status == "ACTIVE" && (r.id == user.id || r.blocked == 0))
    .ok_or_else(|| AppError::not_found("Athlete"))?;
    let friendship = if row.id == user.id {
        None
    } else {
        let (low, high) = pair(user.id, row.id);
        sqlx::query!(
            r#"SELECT status, requested_by AS "requested_by: Uuid" FROM friendships
               WHERE user_low_id = ? AND user_high_id = ?"#,
            low,
            high
        )
        .fetch_optional(&state.db)
        .await?
        .map(|f| match (f.status.as_str(), f.requested_by == user.id) {
            ("ACCEPTED", _) => "FRIENDS",
            (_, true) => "REQUEST_SENT",
            (_, false) => "REQUEST_RECEIVED",
        })
    };
    let today = policy::business_today(Utc::now(), state.cfg.business_utc_offset_minutes);
    let age_bracket = row
        .show_age_bracket
        .then(|| policy::age_bracket(policy::age_in_years(row.date_of_birth, today)))
        .flatten();
    Ok(Json(json!({
        "id": row.id,
        "username": row.username,
        "fullName": row.full_name,
        "bio": row.bio,
        "ageBracket": age_bracket,
        "governorate": {"code": row.code, "name": {"fr": row.name_fr, "en": row.name_en, "ar": row.name_ar}},
        // Gyms come with plan 3b.
        "gym": null,
        "level": row.level,
        "division": row.division_code,
        "seasonLp": row.season_lp,
        "followers": row.followers,
        "following": row.following,
        "friendship": friendship,
    })))
}
