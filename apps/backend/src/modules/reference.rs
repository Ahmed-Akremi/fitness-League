//! The public catalog: places, sports and exercises. New entries are rows, not code.
//! Public and cacheable, because the app keeps these lists for its whole lifetime.

use axum::{
    Json,
    extract::State,
    http::header,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, NaiveDateTime, SecondsFormat};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use uuid::Uuid;

use crate::{
    error::AppError,
    http::Api,
    state::AppState,
    validate::{ValidQuery, uuid_param},
};

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/ref/governorates", governorates)
        .get("/api/v1/ref/cities", cities)
        .get("/api/v1/ref/sports", sports)
        .get("/api/v1/ref/exercises", exercises)
}

const ONE_HOUR: &str = "public, max-age=3600";
const TEN_MINUTES: &str = "public, max-age=600";

fn cached(max_age: &'static str, list: Vec<Value>) -> Response {
    ([(header::CACHE_CONTROL, max_age)], Json(list)).into_response()
}

fn name(fr: &str, en: &str, ar: &str) -> Value {
    json!({"fr": fr, "en": en, "ar": ar})
}

/// Timestamps leave the API as UTC with milliseconds, like `2026-10-06T09:30:00.000Z`.
fn iso(at: NaiveDateTime) -> String {
    at.and_utc().to_rfc3339_opts(SecondsFormat::Millis, true)
}

async fn governorates(State(state): State<AppState>) -> Result<Response, AppError> {
    let rows = sqlx::query!(
        r#"SELECT g.id AS "id: Uuid", g.code, g.country_code, g.name_fr, g.name_en, g.name_ar
           FROM governorates g JOIN countries c ON c.code = g.country_code
           WHERE c.enabled
           ORDER BY g.code"#
    )
    .fetch_all(&state.db)
    .await?;
    let list = rows
        .iter()
        .map(|r| json!({"id": r.id.to_string(), "code": r.code, "countryCode": r.country_code, "name": name(&r.name_fr, &r.name_en, &r.name_ar)}))
        .collect();
    Ok(cached(ONE_HOUR, list))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CitiesQuery {
    governorate_id: Option<String>,
}

async fn cities(
    State(state): State<AppState>,
    ValidQuery(query): ValidQuery<CitiesQuery>,
) -> Result<Response, AppError> {
    let governorate_id = uuid_param("governorateId", query.governorate_id.as_deref())?
        .ok_or_else(|| AppError::field("governorateId", "ISUUID"))?;
    let rows = sqlx::query!(
        r#"SELECT id AS "id: Uuid", code, name_fr, name_en, name_ar FROM cities WHERE governorate_id = ? ORDER BY code"#,
        governorate_id
    )
    .fetch_all(&state.db)
    .await?;
    let list = rows
        .iter()
        .map(|r| json!({"id": r.id.to_string(), "code": r.code, "governorateId": governorate_id.to_string(), "name": name(&r.name_fr, &r.name_en, &r.name_ar)}))
        .collect();
    Ok(cached(ONE_HOUR, list))
}

async fn sports(State(state): State<AppState>) -> Result<Response, AppError> {
    let rows = sqlx::query!(
        r#"SELECT id AS "id: Uuid", code, category, logging_mode, icon, name_fr, name_en, name_ar
           FROM sports WHERE enabled ORDER BY code"#
    )
    .fetch_all(&state.db)
    .await?;
    let list = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.id.to_string(),
                "code": r.code,
                "category": r.category,
                "loggingMode": r.logging_mode,
                "icon": r.icon,
                "name": name(&r.name_fr, &r.name_en, &r.name_ar),
            })
        })
        .collect();
    Ok(cached(ONE_HOUR, list))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExercisesQuery {
    /// The exercises of this sport, plus the shared ones when the sport is not a cardio sport.
    sport_id: Option<String>,
    /// Delta sync for the app's offline catalog: only rows changed after this instant, disabled ones included.
    updated_since: Option<String>,
}

async fn exercises(
    State(state): State<AppState>,
    ValidQuery(query): ValidQuery<ExercisesQuery>,
) -> Result<Response, AppError> {
    let sport_id = uuid_param("sportId", query.sport_id.as_deref())?;
    let updated_since = query
        .updated_since
        .as_deref()
        .map(|raw| {
            DateTime::parse_from_rfc3339(raw)
                .map(|at| at.naive_utc())
                .map_err(|_| AppError::field("updatedSince", "ISISO8601"))
        })
        .transpose()?;

    // Shared exercises (no sport) only make sense for strength and functional sports, not for e.g. swimming.
    let include_shared = match sport_id {
        None => true,
        Some(id) => {
            let category = sqlx::query_scalar!("SELECT category FROM sports WHERE id = ?", id)
                .fetch_optional(&state.db)
                .await?;
            category.ok_or_else(|| AppError::not_found("Sport"))? != "CARDIO"
        }
    };

    let rows = sqlx::query!(
        r#"SELECT e.id AS "id: Uuid", e.sport_id AS "sport_id: Uuid", e.code, e.name_fr, e.name_en, e.name_ar,
                  e.equipment, e.is_bodyweight AS "is_bodyweight: bool", e.exercise_group,
                  e.description_fr, e.description_en, e.description_ar, e.enabled AS "enabled: bool", e.updated_at,
                  (SELECT GROUP_CONCAT(m.code ORDER BY em.position SEPARATOR ',')
                     FROM exercise_metrics em JOIN metric_types m ON m.id = em.metric_type_id
                    WHERE em.exercise_id = e.id) AS "tracked?: String"
           FROM exercises e
           WHERE (? IS NULL OR e.sport_id = ? OR (? AND e.sport_id IS NULL))
             AND (CASE WHEN ? IS NULL THEN e.enabled ELSE e.updated_at > ? END)
           ORDER BY e.code"#,
        sport_id,
        sport_id,
        include_shared,
        updated_since,
        updated_since
    )
    .fetch_all(&state.db)
    .await?;

    let list = rows
        .iter()
        .map(|r| {
            let mut description = Map::new();
            for (language, text) in [("fr", &r.description_fr), ("en", &r.description_en), ("ar", &r.description_ar)] {
                if let Some(text) = text {
                    description.insert(language.to_owned(), json!(text));
                }
            }
            json!({
                "id": r.id.to_string(),
                "code": r.code,
                "sportId": r.sport_id.map(|id| id.to_string()),
                "name": name(&r.name_fr, &r.name_en, &r.name_ar),
                "equipment": r.equipment,
                "isBodyweight": r.is_bodyweight,
                "trackedMetrics": r.tracked.as_deref().map(|codes| codes.split(',').collect::<Vec<_>>()).unwrap_or_default(),
                "group": r.exercise_group,
                "description": description,
                "enabled": r.enabled,
                "updatedAt": iso(r.updated_at),
            })
        })
        .collect();
    Ok(cached(TEN_MINUTES, list))
}
