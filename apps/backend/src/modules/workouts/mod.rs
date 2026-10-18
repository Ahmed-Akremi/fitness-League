//! Workouts: what an athlete logs, online or through the offline outbox, and the anti-cheat verdict
//! stored with each one.

pub mod anticheat;
pub mod intake;
pub mod metrics;

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use self::intake::{Created, Filter, WorkoutBody};
use crate::{
    error::AppError,
    http::{Api, auth::AppUser, page, rate_limit},
    state::AppState,
    validate::{Check, ValidJson, ValidQuery, Validate, rfc3339, uuid_param, valid},
};

pub fn routes(api: Api) -> Api {
    api.post("/api/v1/workouts", post_workout)
        .get("/api/v1/workouts", list)
        .post("/api/v1/workouts/sync", sync)
        .get("/api/v1/workouts/{id}", get_workout)
}

fn rejected(workout: Value) -> AppError {
    AppError::new(
        StatusCode::UNPROCESSABLE_ENTITY,
        "WORKOUT_REJECTED",
        "Workout rejected",
    )
    .detail("This workout exceeds physiological limits or duplicates another one.")
    .with("workout", workout)
}

/// The workout with its version as `ETag`, as the old API answered.
fn tagged(status: StatusCode, workout: Value) -> Response {
    let etag = format!("\"{}\"", workout["version"]);
    (status, [(header::ETAG, etag)], Json(workout)).into_response()
}

/// `Idempotency-Key` must name the workout's own `clientId`: the app sends both.
fn idempotency_key(headers: &HeaderMap) -> Option<Uuid> {
    headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| Uuid::parse_str(value.trim()).ok())
}

async fn post_workout(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    headers: HeaderMap,
    ValidJson(body): ValidJson<WorkoutBody>,
) -> Result<Response, AppError> {
    rate_limit::check(&state, &rate_limit::WORKOUTS_USER, &user.id.to_string()).await?;
    if idempotency_key(&headers) != Some(body.client_id) {
        return Err(AppError::field("Idempotency-Key", "MUST_EQUAL_CLIENT_ID"));
    }
    let (status, workout) = match intake::create(&state, user.id, body).await? {
        Created::New(workout) => (StatusCode::CREATED, workout),
        Created::Replayed(workout) => (StatusCode::OK, workout),
    };
    if workout["status"] == "REJECTED" {
        return Err(rejected(workout));
    }
    Ok(tagged(status, workout))
}

async fn get_workout(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    // A malformed id names no workout, like an unknown one.
    let id = Uuid::parse_str(&id).map_err(|_| AppError::not_found("Workout"))?;
    let workout = intake::one(&state.db, user.id, id).await?;
    Ok(tagged(StatusCode::OK, workout))
}

/// The offline outbox, sent in one go. Each item is read, checked and saved on its own, so one bad
/// item never holds the others back in the app's queue.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SyncBody {
    items: Vec<Value>,
}

impl Validate for SyncBody {
    fn validate(&self, check: &mut Check) {
        if self.items.is_empty() {
            check.fail("items", "ARRAYMINSIZE");
        } else if self.items.len() > 50 {
            check.fail("items", "ARRAYMAXSIZE");
        }
    }
}

async fn sync(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<SyncBody>,
) -> Result<Json<Value>, AppError> {
    rate_limit::check(&state, &rate_limit::WORKOUTS_SYNC_USER, &user.id.to_string()).await?;
    let mut results = Vec::with_capacity(body.items.len());
    for item in body.items {
        let client_id = item.get("clientId").cloned().unwrap_or(Value::Null);
        let saved = match serde_json::to_vec(&item)
            .map_err(AppError::internal)
            .and_then(|bytes| valid::<WorkoutBody>(&bytes))
        {
            Ok(workout) => intake::create(&state, user.id, workout).await,
            Err(e) => Err(e),
        };
        results.push(match saved {
            Ok(Created::New(w) | Created::Replayed(w)) if w["status"] == "REJECTED" => {
                json!({"clientId": client_id, "result": "REJECTED", "workout": w})
            }
            Ok(Created::New(w)) => json!({"clientId": client_id, "result": "CREATED", "workout": w}),
            Ok(Created::Replayed(w)) => {
                json!({"clientId": client_id, "result": "REPLAYED", "workout": w})
            }
            Err(e) if e.code == "IDEMPOTENCY_CONFLICT" => {
                json!({"clientId": client_id, "result": "CONFLICT", "error": e.summary()})
            }
            Err(e) if e.status.is_client_error() => {
                json!({"clientId": client_id, "result": "INVALID", "error": e.summary()})
            }
            // A server fault fails the batch; the items already saved replay on the retry.
            Err(e) => return Err(e),
        });
    }
    Ok(Json(json!({ "results": results })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    limit: Option<String>,
    cursor: Option<String>,
    from: Option<String>,
    to: Option<String>,
    sport_id: Option<String>,
}

/// Where a page of workouts stops: the last one's time and id.
#[derive(Serialize, Deserialize)]
struct Position {
    p: String,
    id: Uuid,
}

fn instant(field: &str, raw: Option<&str>) -> Result<Option<chrono::NaiveDateTime>, AppError> {
    raw.map(|raw| {
        rfc3339(raw)
            .map(|at| at.naive_utc())
            .ok_or_else(|| AppError::field(field, "ISISO8601"))
    })
    .transpose()
}

/// The athlete's own workouts, newest first, every status included.
async fn list(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidQuery(query): ValidQuery<ListQuery>,
) -> Result<Json<Value>, AppError> {
    let limit = page::limit(query.limit.as_deref())?;
    let secret = &state.cfg.app_hmac_secret;
    let before = match query.cursor.as_deref() {
        Some(raw) => {
            let at: Position = page::decode(secret, raw)?;
            let p = rfc3339(&at.p).ok_or_else(|| AppError::field("cursor", "INVALID_CURSOR"))?;
            Some((p.naive_utc(), at.id))
        }
        None => None,
    };
    let filter = Filter {
        id: None,
        before,
        from: instant("from", query.from.as_deref())?,
        to: instant("to", query.to.as_deref())?,
        sport: uuid_param("sportId", query.sport_id.as_deref())?,
        // One more than asked: it only tells whether another page exists.
        limit: Some(limit + 1),
    };
    let mut workouts = intake::load(&state.db, user.id, &filter).await?;
    let next = if workouts.len() > limit as usize {
        workouts.truncate(limit as usize);
        match workouts.last() {
            Some(last) => {
                let position = Position {
                    p: last["performedAt"].as_str().unwrap_or_default().to_owned(),
                    id: serde_json::from_value(last["id"].clone()).map_err(AppError::internal)?,
                };
                Some(page::encode(secret, &position)?)
            }
            None => None,
        }
    } else {
        None
    };
    Ok(Json(page::page(workouts, next)))
}
