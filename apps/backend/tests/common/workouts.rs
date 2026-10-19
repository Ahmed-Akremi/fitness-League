//! Workout bodies built from the seeded catalog, and the calls the app makes with them.

use axum::{body::Body, http::Method};
use backend::{security::tokens::Audience, types::Role};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{Value, json};
use uuid::Uuid;

use super::{Reply, TestApp, create_user, open_session, request};

pub const WORKOUTS: &str = "/api/v1/workouts";

pub struct Catalog {
    pub strength: Uuid,
    pub running: Uuid,
    pub squat: Uuid,
    pub run: Uuid,
}

pub async fn id_of(app: &TestApp, table: &str, code: &str) -> Uuid {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT id FROM {table} WHERE code = ?"
    )))
    .bind(code)
    .fetch_one(&app.db)
    .await
    .unwrap()
}

pub async fn catalog(app: &TestApp) -> Catalog {
    Catalog {
        strength: id_of(app, "sports", "WEIGHT_TRAINING").await,
        running: id_of(app, "sports", "RUNNING").await,
        squat: id_of(app, "exercises", "BACK_SQUAT").await,
        run: id_of(app, "exercises", "RUN").await,
    }
}

pub async fn athlete(app: &TestApp, name: &str) -> (Uuid, String) {
    let user = create_user(app, name, Role::User).await;
    let session = open_session(app, user, Role::User, Audience::App).await;
    (user, session["accessToken"].as_str().unwrap().to_owned())
}

pub fn rfc(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// A squat session: one warm-up set of 10 × 60 kg, then three sets of `reps` × `kg`.
pub fn lifting(c: &Catalog, client: Uuid, at: DateTime<Utc>, kg: f64, reps: i32) -> Value {
    json!({
        "clientId": client, "sportId": c.strength, "workoutType": "STRENGTH",
        "performedAt": rfc(at), "durationS": 3600,
        "exercises": [{"exerciseId": c.squat, "sets": [
            {"reps": 10, "weightKg": 60, "isWarmup": true},
            {"reps": reps, "weightKg": kg}, {"reps": reps, "weightKg": kg}, {"reps": reps, "weightKg": kg}
        ]}]
    })
}

pub fn strength(c: &Catalog, client: Uuid, at: DateTime<Utc>) -> Value {
    lifting(c, client, at, 100.0, 5)
}

/// A single heavy squat.
pub fn single(c: &Catalog, client: Uuid, at: DateTime<Utc>, kg: f64) -> Value {
    json!({
        "clientId": client, "sportId": c.strength, "workoutType": "STRENGTH",
        "performedAt": rfc(at), "durationS": 1800,
        "exercises": [{"exerciseId": c.squat, "sets": [{"reps": 1, "weightKg": kg}]}]
    })
}

pub fn run(c: &Catalog, client: Uuid, km: f64, minutes: i32, at: DateTime<Utc>) -> Value {
    json!({
        "clientId": client, "sportId": c.running, "workoutType": "RUN",
        "performedAt": rfc(at), "durationS": (minutes * 60).max(60),
        "exercises": [{"exerciseId": c.run, "sets": [
            {"distanceM": (km * 1000.0) as i32, "durationS": minutes * 60}
        ]}]
    })
}

/// A POST with the `Idempotency-Key` the app sends: the body's `clientId`, unless `key` says otherwise.
pub async fn send(app: &TestApp, token: &str, body: &Value, key: Option<&str>) -> Reply {
    let mut req = request(Method::POST, WORKOUTS)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json");
    if let Some(key) = key {
        req = req.header("idempotency-key", key);
    }
    app.send(req.body(Body::from(body.to_string())).unwrap())
        .await
}

pub async fn post(app: &TestApp, token: &str, body: &Value) -> Reply {
    send(app, token, body, body["clientId"].as_str()).await
}

pub async fn get(app: &TestApp, token: &str, path: &str) -> Reply {
    app.call(Method::GET, path, Some(token), None).await
}
