//! Weigh-ins. They are health data: encrypted at rest, shown to their owner only, and only while the
//! `HEALTH_DATA` consent is granted. The server reads the latest weight under the same condition.

use axum::{Json, extract::State, http::StatusCode};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::MySqlPool;
use uuid::Uuid;

use crate::{
    error::AppError,
    http::{Api, auth::AppUser},
    modules::goals::milestones,
    rules::Rules,
    state::AppState,
    types::iso,
    validate::{Check, ValidJson, Validate, rfc3339, round_to},
};

const BODY_MEASUREMENTS: &str = "/api/v1/me/body-measurements";
pub const HEALTH_DATA: &str = "HEALTH_DATA";

pub fn routes(api: Api) -> Api {
    api.get(BODY_MEASUREMENTS, list)
        .post(BODY_MEASUREMENTS, add)
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum Source {
    Manual,
    HealthConnect,
    AppleHealth,
    Strava,
    Garmin,
    Import,
}

impl Source {
    fn as_str(self) -> &'static str {
        match self {
            Source::Manual => "MANUAL",
            Source::HealthConnect => "HEALTH_CONNECT",
            Source::AppleHealth => "APPLE_HEALTH",
            Source::Strava => "STRAVA",
            Source::Garmin => "GARMIN",
            Source::Import => "IMPORT",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MeasurementBody {
    weight_kg: f64,
    body_fat_pct: Option<f64>,
    measured_at: Option<String>,
    source: Option<Source>,
}

impl Validate for MeasurementBody {
    fn validate(&self, check: &mut Check) {
        check.within("weightKg", self.weight_kg, 25.0, 350.0);
        if let Some(fat) = self.body_fat_pct {
            check.within("bodyFatPct", fat, 2.0, 70.0);
        }
        if let Some(at) = &self.measured_at {
            check.ensure("measuredAt", rfc3339(at).is_some(), "ISISO8601");
        }
    }
}

/// The latest decision on a consent: the table is a history, never updated.
pub async fn has_consent(db: &MySqlPool, user: Uuid, kind: &str) -> Result<bool, AppError> {
    let granted = sqlx::query_scalar!(
        r#"SELECT granted AS "granted: bool" FROM consents
           WHERE user_id = ? AND type = ? ORDER BY created_at DESC, id DESC LIMIT 1"#,
        user,
        kind
    )
    .fetch_optional(db)
    .await?;
    Ok(granted == Some(true))
}

async fn require_consent(db: &MySqlPool, user: Uuid) -> Result<(), AppError> {
    if has_consent(db, user, HEALTH_DATA).await? {
        Ok(())
    } else {
        Err(AppError::new(
            StatusCode::FORBIDDEN,
            "CONSENT_REQUIRED",
            "Health data consent required",
        )
        .with("consent", HEALTH_DATA))
    }
}

/// The athlete's weigh-ins, newest first and decrypted. `None` lists them all (the export).
pub async fn all(state: &AppState, user: Uuid, limit: Option<u32>) -> Result<Vec<Value>, AppError> {
    let limit = limit.map_or(i64::MAX, i64::from);
    let rows = sqlx::query!(
        r#"SELECT id AS "id: Uuid", measured_at, weight_kg_enc, body_fat_pct_enc, source
           FROM body_measurements WHERE user_id = ?
           ORDER BY measured_at DESC, id DESC LIMIT ?"#,
        user,
        limit
    )
    .fetch_all(&state.db)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(json!({
                "id": row.id,
                "measuredAt": iso(row.measured_at),
                "weightKg": state.health.decrypt_number(&row.weight_kg_enc)?,
                "bodyFatPct": row.body_fat_pct_enc.map(|blob| state.health.decrypt_number(&blob)).transpose()?,
                "source": row.source,
            }))
        })
        .collect()
}

/// The latest weight, for the checks that depend on body weight. `None` without the consent: data
/// the athlete stopped sharing is no longer used.
pub async fn latest_weight_kg(state: &AppState, user: Uuid) -> Result<Option<f64>, AppError> {
    if !has_consent(&state.db, user, HEALTH_DATA).await? {
        return Ok(None);
    }
    let blob = sqlx::query_scalar!(
        "SELECT weight_kg_enc FROM body_measurements WHERE user_id = ? \
         ORDER BY measured_at DESC, id DESC LIMIT 1",
        user
    )
    .fetch_optional(&state.db)
    .await?;
    blob.map(|blob| state.health.decrypt_number(&blob))
        .transpose()
}

async fn list(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
    require_consent(&state.db, user.id).await?;
    Ok(Json(Value::Array(all(&state, user.id, Some(100)).await?)))
}

async fn add(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<MeasurementBody>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    require_consent(&state.db, user.id).await?;
    let now = Utc::now();
    let measured_at = body.measured_at.as_deref().and_then(rfc3339).unwrap_or(now);
    if measured_at > now + Duration::minutes(10) {
        return Err(AppError::field("measuredAt", "IN_FUTURE"));
    }
    let weight = round_to(body.weight_kg, 2);
    let fat = body.body_fat_pct.map(|fat| round_to(fat, 1));
    let source = body.source.unwrap_or(Source::Manual);
    let id = Uuid::now_v7();
    let rules = Rules::active(&state.db).await?;
    let mut tx = state.db.begin().await?;
    // A weigh-in can pay goal milestones: it waits for the athlete's workouts being scored.
    sqlx::query!(
        "SELECT user_id FROM user_stats WHERE user_id = ? FOR UPDATE",
        user.id
    )
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query!(
        "INSERT INTO body_measurements (id, user_id, measured_at, weight_kg_enc, body_fat_pct_enc, source) \
         VALUES (?, ?, ?, ?, ?, ?)",
        id,
        user.id,
        measured_at.naive_utc(),
        state.health.encrypt_number(weight)?,
        fat.map(|fat| state.health.encrypt_number(fat)).transpose()?,
        source.as_str()
    )
    .execute(&mut *tx)
    .await?;
    // The latest weigh-in, which is not this one when it was dated in the past.
    let latest = sqlx::query_scalar!(
        "SELECT weight_kg_enc FROM body_measurements WHERE user_id = ? \
         ORDER BY measured_at DESC, id DESC LIMIT 1",
        user.id
    )
    .fetch_one(&mut *tx)
    .await?;
    let latest_kg = state.health.decrypt_number(&latest)?;
    milestones::on_weigh_in(&mut tx, &state, &rules, user.id, latest_kg).await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "id": id,
            "measuredAt": iso(measured_at.naive_utc()),
            "weightKg": weight,
            "bodyFatPct": fat,
            "source": source.as_str(),
        })),
    ))
}
