//! Push preferences (the old `PushService`): six categories, on unless switched off, and quiet hours
//! in local time. Stored and served now; they decide pushes once the app registers devices (spec
//! ruling 2). The in-app list always keeps everything.

use axum::{Json, extract::State};
use chrono::NaiveTime;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::MySqlPool;
use uuid::Uuid;

use crate::{
    error::AppError,
    http::auth::AppUser,
    state::AppState,
    validate::{Check, ValidJson, Validate, nullable},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Body {
    categories: Option<Categories>,
    /// `null` removes the quiet hours; absent keeps them.
    #[serde(default, deserialize_with = "nullable")]
    quiet_hours: Option<Option<QuietHours>>,
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "SCREAMING_SNAKE_CASE")]
struct Categories {
    social: Option<bool>,
    battles: Option<bool>,
    competition: Option<bool>,
    challenges: Option<bool>,
    badges: Option<bool>,
    gym: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QuietHours {
    start: String,
    end: String,
}

impl Validate for Body {
    fn validate(&self, check: &mut Check) {
        if let Some(Some(quiet)) = &self.quiet_hours {
            check.ensure("quietHours.start", hhmm(&quiet.start).is_some(), "MATCHES");
            check.ensure("quietHours.end", hhmm(&quiet.end).is_some(), "MATCHES");
        }
    }
}

/// `HH:MM` from 00:00 to 23:59, two digits each, as the old API's pattern.
fn hhmm(raw: &str) -> Option<NaiveTime> {
    let two_digits = |part: &str| part.len() == 2 && part.bytes().all(|b| b.is_ascii_digit());
    let (hours, minutes) = raw.split_once(':')?;
    if !two_digits(hours) || !two_digits(minutes) {
        return None;
    }
    NaiveTime::from_hms_opt(hours.parse().ok()?, minutes.parse().ok()?, 0)
}

async fn load(db: &MySqlPool, user: Uuid) -> Result<Value, AppError> {
    let s = sqlx::query!(
        r#"SELECT push_social AS "social: bool", push_battles AS "battles: bool",
                  push_competition AS "competition: bool", push_challenges AS "challenges: bool",
                  push_badges AS "badges: bool", push_gym AS "gym: bool",
                  quiet_hours_start AS "start: NaiveTime", quiet_hours_end AS "end: NaiveTime"
           FROM user_settings WHERE user_id = ?"#,
        user
    )
    .fetch_one(db)
    .await?;
    let time = |t: NaiveTime| t.format("%H:%M").to_string();
    Ok(json!({
        "categories": {
            "SOCIAL": s.social, "BATTLES": s.battles, "COMPETITION": s.competition,
            "CHALLENGES": s.challenges, "BADGES": s.badges, "GYM": s.gym,
        },
        "quietHours": s.start.zip(s.end).map(|(start, end)| json!({"start": time(start), "end": time(end)})),
    }))
}

pub async fn get(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
    Ok(Json(load(&state.db, user.id).await?))
}

/// Merges what is sent into what is stored, and answers the result.
pub async fn put(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<Body>,
) -> Result<Json<Value>, AppError> {
    let c = body.categories.unwrap_or_default();
    let (replace_hours, start, end) = match body.quiet_hours {
        None => (false, None, None),
        Some(None) => (true, None, None),
        Some(Some(quiet)) => (true, hhmm(&quiet.start), hhmm(&quiet.end)),
    };
    sqlx::query!(
        "UPDATE user_settings SET push_social = COALESCE(?, push_social), push_battles = COALESCE(?, push_battles), \
           push_competition = COALESCE(?, push_competition), push_challenges = COALESCE(?, push_challenges), \
           push_badges = COALESCE(?, push_badges), push_gym = COALESCE(?, push_gym), \
           quiet_hours_start = IF(?, ?, quiet_hours_start), quiet_hours_end = IF(?, ?, quiet_hours_end) \
         WHERE user_id = ?",
        c.social,
        c.battles,
        c.competition,
        c.challenges,
        c.badges,
        c.gym,
        replace_hours,
        start,
        replace_hours,
        end,
        user.id
    )
    .execute(&state.db)
    .await?;
    Ok(Json(load(&state.db, user.id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quiet_hour_times() {
        assert_eq!(hhmm("07:00"), NaiveTime::from_hms_opt(7, 0, 0));
        assert_eq!(hhmm("23:59"), NaiveTime::from_hms_opt(23, 59, 0));
        for bad in ["7:00", "24:00", "12:60", "12:00:00", "", "ab:cd", "+1:00"] {
            assert_eq!(hhmm(bad), None, "{bad}");
        }
    }
}
