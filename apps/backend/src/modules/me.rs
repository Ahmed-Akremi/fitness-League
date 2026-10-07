//! `/me`: what the signed-in athlete sees of their own account.
//! Every query here carries the user id of the session: there is no way to ask for someone else.

use axum::{Json, extract::State};
use chrono::Utc;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    error::AppError,
    http::{Api, auth::AppUser},
    rules::Rules,
    security::policy,
    state::AppState,
    types::{Role, iso},
};

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/me", me)
}

async fn me(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
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
