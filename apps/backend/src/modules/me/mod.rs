//! `/me`: what the signed-in athlete sees of their own account.
//! Every query here carries the user id of the session: there is no way to ask for someone else.

use axum::{Json, extract::State};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    error::AppError,
    http::{Api, auth::AppUser},
    rules::Rules,
    security::policy,
    state::AppState,
    types::{ExperienceLevel, Gender, Locale, Role, Theme, Visibility, iso},
    validate::{Check, ValidJson, Validate, nullable, readable_name},
};

pub mod onboarding;
pub mod privacy;

pub fn routes(api: Api) -> Api {
    let api = api
        .get("/api/v1/me", me)
        .patch("/api/v1/me/profile", update_profile)
        .patch("/api/v1/me/settings", update_settings);
    privacy::routes(onboarding::routes(api))
}

async fn me(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
    Ok(Json(payload(&state, user.id).await?))
}

/// Every field is optional: what is absent stays as it is. `bio` and `gender` can also be cleared
/// with `null`.
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProfileBody {
    full_name: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    bio: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    gender: Option<Option<Gender>>,
    governorate_id: Option<Uuid>,
    city_id: Option<Uuid>,
    experience_level_declared: Option<ExperienceLevel>,
    planned_training_days_per_week: Option<i64>,
}

impl Validate for ProfileBody {
    fn validate(&self, check: &mut Check) {
        if let Some(name) = &self.full_name {
            let name = name.trim();
            check.length("fullName", name, 2, 80);
            check.ensure("fullName", readable_name(name), "MATCHES");
        }
        if let Some(Some(bio)) = &self.bio {
            check.length("bio", bio, 0, 280);
        }
        // A city only makes sense with its governorate: both or neither.
        if self.governorate_id.is_some() != self.city_id.is_some() {
            let missing = if self.city_id.is_some() {
                "governorateId"
            } else {
                "cityId"
            };
            check.fail(missing, "REQUIRED_TOGETHER");
        }
        if let Some(days) = self.planned_training_days_per_week {
            check.range("plannedTrainingDaysPerWeek", days, 1, 7);
        }
    }
}

async fn update_profile(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<ProfileBody>,
) -> Result<Json<Value>, AppError> {
    if let (Some(governorate), Some(city)) = (body.governorate_id, body.city_id) {
        // In the country of the account, as at registration.
        let places = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "n!: i64"
               FROM cities c
               JOIN governorates g ON g.id = c.governorate_id
               JOIN profiles p ON p.country_code = g.country_code
               WHERE c.id = ? AND g.id = ? AND p.user_id = ?"#,
            city,
            governorate,
            user.id
        )
        .fetch_one(&state.db)
        .await?;
        if places != 1 {
            return Err(AppError::field("cityId", "NOT_IN_GOVERNORATE"));
        }
    }
    sqlx::query!(
        "UPDATE profiles SET full_name = COALESCE(?, full_name), bio = IF(?, ?, bio), \
         gender = IF(?, ?, gender), governorate_id = COALESCE(?, governorate_id), \
         city_id = COALESCE(?, city_id), \
         experience_level_declared = COALESCE(?, experience_level_declared), \
         planned_training_days_per_week = COALESCE(?, planned_training_days_per_week) \
         WHERE user_id = ?",
        body.full_name.as_deref().map(str::trim),
        body.bio.is_some(),
        body.bio.flatten(),
        body.gender.is_some(),
        body.gender.flatten().map(Gender::as_str),
        body.governorate_id,
        body.city_id,
        body.experience_level_declared.map(ExperienceLevel::as_str),
        body.planned_training_days_per_week,
        user.id
    )
    .execute(&state.db)
    .await?;
    Ok(Json(payload(&state, user.id).await?))
}

/// Every field is optional; `reducedMotion: null` means "follow the device".
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SettingsBody {
    locale: Option<Locale>,
    theme: Option<Theme>,
    #[serde(default, deserialize_with = "nullable")]
    reduced_motion: Option<Option<bool>>,
    default_visibility: Option<Visibility>,
    show_age_bracket: Option<bool>,
    show_on_leaderboards: Option<bool>,
    streak_freeze_days_per_week: Option<i64>,
}

impl Validate for SettingsBody {
    fn validate(&self, check: &mut Check) {
        if let Some(days) = self.streak_freeze_days_per_week {
            check.range("streakFreezeDaysPerWeek", days, 0, 4);
        }
    }
}

async fn update_settings(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<SettingsBody>,
) -> Result<Json<Value>, AppError> {
    sqlx::query!(
        "UPDATE user_settings SET locale = COALESCE(?, locale), theme = COALESCE(?, theme), \
         reduced_motion = IF(?, ?, reduced_motion), \
         default_visibility = COALESCE(?, default_visibility), \
         show_age_bracket = COALESCE(?, show_age_bracket), \
         show_on_leaderboards = COALESCE(?, show_on_leaderboards), \
         streak_freeze_days_per_week = COALESCE(?, streak_freeze_days_per_week) \
         WHERE user_id = ?",
        body.locale.map(Locale::as_str),
        body.theme.map(Theme::as_str),
        body.reduced_motion.is_some(),
        body.reduced_motion.flatten(),
        body.default_visibility.map(Visibility::as_str),
        body.show_age_bracket,
        body.show_on_leaderboards,
        body.streak_freeze_days_per_week,
        user.id
    )
    .execute(&state.db)
    .await?;
    Ok(Json(payload(&state, user.id).await?))
}

/// Everything the home screen needs about the signed-in user, in one answer.
pub async fn payload(state: &AppState, user: Uuid) -> Result<Value, AppError> {
    let row = sqlx::query!(
        r#"SELECT u.username, u.email, u.email_verified_at, u.role AS "role: Role", u.date_of_birth,
                  p.full_name, p.bio, p.gender, p.country_code, p.experience_level_declared,
                  p.planned_training_days_per_week, p.calibration_ends_at, p.onboarding_completed_at,
                  g.id AS "governorate_id: Uuid", g.code AS governorate_code,
                  g.name_fr AS governorate_fr, g.name_en AS governorate_en, g.name_ar AS governorate_ar,
                  c.id AS "city_id: Uuid", c.name_fr AS city_fr, c.name_en AS city_en, c.name_ar AS city_ar,
                  s.locale, s.theme, s.reduced_motion AS "reduced_motion: bool", s.default_visibility,
                  s.show_age_bracket AS "show_age_bracket: bool",
                  s.show_on_leaderboards AS "show_on_leaderboards: bool", s.streak_freeze_days_per_week,
                  t.xp_total, t.level, t.xp_into_level, t.xp_for_next_level, t.season_lp, t.division_code,
                  t.leaderboard_eligible AS "leaderboard_eligible: bool",
                  k.current_weeks, k.longest_weeks, k.current_days
           FROM users u
           JOIN profiles p ON p.user_id = u.id
           JOIN governorates g ON g.id = p.governorate_id
           JOIN cities c ON c.id = p.city_id
           JOIN user_settings s ON s.user_id = u.id
           JOIN user_stats t ON t.user_id = u.id
           JOIN user_streaks k ON k.user_id = u.id
           WHERE u.id = ?"#,
        user
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Profile"))?;
    let sports = sqlx::query!(
        r#"SELECT sp.id AS "id: Uuid", sp.code, us.is_primary AS "is_primary: bool"
           FROM user_sports us JOIN sports sp ON sp.id = us.sport_id
           WHERE us.user_id = ?
           ORDER BY us.is_primary DESC, sp.code"#,
        user
    )
    .fetch_all(&state.db)
    .await?;
    let rules = Rules::active(&state.db).await?;

    let today = policy::business_today(Utc::now(), state.cfg.business_utc_offset_minutes);
    let name = |fr: &str, en: &str, ar: &str| json!({"fr": fr, "en": en, "ar": ar});
    let sports: Vec<Value> = sports
        .iter()
        .map(|sport| json!({"id": sport.id.to_string(), "code": sport.code, "isPrimary": sport.is_primary}))
        .collect();
    Ok(json!({
        "id": user.to_string(),
        "username": row.username,
        "email": row.email,
        "emailVerified": row.email_verified_at.is_some(),
        "role": row.role.as_str(),
        // The owner sees their bracket. The date itself never leaves the API.
        "ageBracket": policy::age_bracket(policy::age_in_years(row.date_of_birth, today)),
        "profile": {
            "fullName": row.full_name,
            "bio": row.bio,
            "gender": row.gender,
            "countryCode": row.country_code,
            "governorate": {
                "id": row.governorate_id.to_string(),
                "code": row.governorate_code,
                "name": name(&row.governorate_fr, &row.governorate_en, &row.governorate_ar),
            },
            "city": {
                "id": row.city_id.to_string(),
                "name": name(&row.city_fr, &row.city_en, &row.city_ar),
            },
            // Gyms arrive with part 3.
            "gym": null,
            "experienceLevelDeclared": row.experience_level_declared,
            "plannedTrainingDaysPerWeek": row.planned_training_days_per_week,
            "calibrationEndsAt": row.calibration_ends_at.map(iso),
            "onboardingCompleted": row.onboarding_completed_at.is_some(),
            "sports": sports,
        },
        "settings": {
            "locale": row.locale,
            "theme": row.theme,
            "reducedMotion": row.reduced_motion,
            "defaultVisibility": row.default_visibility,
            "showAgeBracket": row.show_age_bracket,
            "showOnLeaderboards": row.show_on_leaderboards,
            "streakFreezeDaysPerWeek": row.streak_freeze_days_per_week,
        },
        // Created with their defaults at registration; the scoring engine of part 2 fills them.
        "stats": {
            "xpTotal": row.xp_total,
            "level": row.level,
            "levelTitleKey": rules.level_title_key(row.level),
            "xpIntoLevel": row.xp_into_level,
            "xpForNextLevel": row.xp_for_next_level,
            "seasonLp": row.season_lp,
            "division": row.division_code,
            "leaderboardEligible": row.leaderboard_eligible,
        },
        "streak": {
            "currentWeeks": row.current_weeks,
            "longestWeeks": row.longest_weeks,
            "currentDays": row.current_days,
        },
    }))
}
