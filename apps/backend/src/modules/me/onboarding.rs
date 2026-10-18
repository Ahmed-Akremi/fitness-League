//! Onboarding: the sports an athlete practises, the starting values they declare, and the start of
//! the calibration period. Goals and the gym are steps of their own, in parts 2 and 3.

use std::collections::HashSet;

use axum::{Json, extract::State, http::StatusCode};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::MySqlPool;
use uuid::Uuid;

use crate::{
    error::AppError,
    http::{Api, auth::AppUser},
    rules::Rules,
    state::AppState,
    types::iso,
    validate::{Check, ValidJson, Validate},
};

pub fn routes(api: Api) -> Api {
    api.post("/api/v1/me/onboarding/sports", set_sports)
        .post("/api/v1/me/onboarding/baselines", declare_baselines)
        .post("/api/v1/me/onboarding/complete", complete)
}

/// Where the athlete stands. Every onboarding route answers with it.
async fn progress(db: &MySqlPool, user: Uuid) -> Result<Value, AppError> {
    let row = sqlx::query!(
        r#"SELECT onboarding_completed_at, calibration_ends_at,
                  EXISTS (SELECT 1 FROM user_sports WHERE user_id = p.user_id) AS "sports!",
                  EXISTS (SELECT 1 FROM baselines WHERE user_id = p.user_id) AS "baselines!"
           FROM profiles p WHERE p.user_id = ?"#,
        user
    )
    .fetch_one(db)
    .await?;
    Ok(json!({
        // Goals and the gym arrive with parts 2 and 3.
        "steps": {"sports": row.sports != 0, "baselines": row.baselines != 0, "goals": false, "gym": false},
        "completed": row.onboarding_completed_at.is_some(),
        "calibrationEndsAt": row.calibration_ends_at.map(iso),
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SportsBody {
    sport_ids: Vec<Uuid>,
    primary_sport_id: Uuid,
}

impl Validate for SportsBody {
    fn validate(&self, check: &mut Check) {
        let n = self.sport_ids.len();
        if n == 0 {
            check.fail("sportIds", "ARRAYMINSIZE");
        } else if n > 9 {
            check.fail("sportIds", "ARRAYMAXSIZE");
        }
        let distinct: HashSet<&Uuid> = self.sport_ids.iter().collect();
        check.ensure("sportIds", distinct.len() == n, "ARRAYUNIQUE");
        check.ensure(
            "primarySportId",
            self.sport_ids.contains(&self.primary_sport_id),
            "NOT_IN_SPORT_IDS",
        );
    }
}

/// Replaces the list of sports. Unknown or disabled sports refuse the whole list.
async fn set_sports(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<SportsBody>,
) -> Result<Json<Value>, AppError> {
    let mut tx = state.db.begin().await?;
    // Holds the account until the commit: two lists sent at the same instant are not mixed.
    sqlx::query!("SELECT id FROM users WHERE id = ? FOR UPDATE", user.id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query!("DELETE FROM user_sports WHERE user_id = ?", user.id)
        .execute(&mut *tx)
        .await?;
    for sport in &body.sport_ids {
        let added = sqlx::query!(
            "INSERT INTO user_sports (user_id, sport_id, is_primary) \
             SELECT ?, id, ? FROM sports WHERE id = ? AND enabled",
            user.id,
            *sport == body.primary_sport_id,
            sport
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if added != 1 {
            // Dropping the transaction rolls it back: the previous list stays.
            return Err(AppError::field("sportIds", "UNKNOWN_SPORT"));
        }
    }
    tx.commit().await?;
    Ok(Json(progress(&state.db, user.id).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Declared {
    exercise_id: Uuid,
    metric_code: String,
    /// In the unit of the metric (kg, m, s, count).
    value: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BaselinesBody {
    entries: Vec<Declared>,
}

impl Validate for BaselinesBody {
    fn validate(&self, check: &mut Check) {
        if self.entries.len() > 30 {
            check.fail("entries", "ARRAYMAXSIZE");
        }
        for (i, entry) in self.entries.iter().enumerate() {
            let code = &entry.metric_code;
            let code_ok = (2..=40).contains(&code.len())
                && code
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_');
            check.ensure(&format!("entries[{i}].metricCode"), code_ok, "MATCHES");
            // JSON has no NaN or infinity: the value is a finite number.
            let field = format!("entries[{i}].value");
            if entry.value <= 0.0 {
                check.fail(&field, "ISPOSITIVE");
            } else if entry.value > 1_000_000.0 {
                check.fail(&field, "MAX");
            }
        }
    }
}

/// Declared values are a hint: they create PROVISIONAL baselines, which calibration replaces. A
/// baseline that is no longer provisional is not changed by a declaration.
async fn declare_baselines(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<BaselinesBody>,
) -> Result<Json<Value>, AppError> {
    // Each entry names an enabled exercise and a metric it tracks. Every wrong one is told at once.
    let mut check = Check::default();
    let mut rows = Vec::with_capacity(body.entries.len());
    for (i, entry) in body.entries.iter().enumerate() {
        let metric = sqlx::query_scalar!(
            r#"SELECT (SELECT m.id FROM exercise_metrics em JOIN metric_types m ON m.id = em.metric_type_id
                       WHERE em.exercise_id = e.id AND m.code = ?) AS "metric?: Uuid"
               FROM exercises e WHERE e.id = ? AND e.enabled"#,
            entry.metric_code,
            entry.exercise_id
        )
        .fetch_optional(&state.db)
        .await?;
        match metric {
            None => check.fail(&format!("entries[{i}].exerciseId"), "UNKNOWN_EXERCISE"),
            Some(None) => check.fail(&format!("entries[{i}].metricCode"), "METRIC_NOT_TRACKED"),
            // Rounded to the 3 decimals the column keeps: the app sends minutes times 60, which a
            // float can turn into 1342.1999999999998.
            Some(Some(metric)) => {
                rows.push((entry.exercise_id, metric, format!("{:.3}", entry.value)))
            }
        }
    }
    check.finish()?;

    let mut tx = state.db.begin().await?;
    for (exercise, metric, value) in rows {
        sqlx::query!(
            "INSERT INTO baselines (id, user_id, exercise_id, metric_type_id, declared_value, effective_value) \
             VALUES (?, ?, ?, ?, ?, ?) \
             ON DUPLICATE KEY UPDATE \
               declared_value = IF(status = 'PROVISIONAL', VALUES(declared_value), declared_value), \
               effective_value = IF(status = 'PROVISIONAL', VALUES(effective_value), effective_value)",
            Uuid::now_v7(),
            user.id,
            exercise,
            metric,
            value,
            value
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(progress(&state.db, user.id).await?))
}

/// Starts the calibration period. Completing twice keeps the dates of the first time.
async fn complete(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
    let rules = Rules::active(&state.db).await?;
    let now = Utc::now().naive_utc();
    // One statement decides: of two calls at the same instant, one starts the calibration.
    sqlx::query!(
        "UPDATE profiles SET onboarding_completed_at = ?, calibration_started_at = ?, calibration_ends_at = ? \
         WHERE user_id = ? AND onboarding_completed_at IS NULL \
           AND EXISTS (SELECT 1 FROM user_sports WHERE user_id = ?)",
        now,
        now,
        now + Duration::days(rules.calibration_days),
        user.id,
        user.id
    )
    .execute(&state.db)
    .await?;
    let progress = progress(&state.db, user.id).await?;
    if progress["completed"] != true {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "PRECONDITION_FAILED",
            "Select at least one sport first",
        )
        .with("missingStep", "sports"));
    }
    Ok(Json(progress))
}
