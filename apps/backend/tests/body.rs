#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode};
use backend::{modules::me::body, security::tokens::Audience, types::Role};
use chrono::{Duration, SecondsFormat, Utc};
use common::{TestApp, create_user, open_session, seeded, set_consent};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const BODY: &str = "/api/v1/me/body-measurements";

async fn athlete(app: &TestApp, name: &str) -> (Uuid, String) {
    let user = create_user(app, name, Role::User).await;
    let session = open_session(app, user, Role::User, Audience::App).await;
    (user, session["accessToken"].as_str().unwrap().to_owned())
}

async fn add(app: &TestApp, token: &str, body: Value) -> common::Reply {
    app.call(Method::POST, BODY, Some(token), Some(body)).await
}

fn at(offset: Duration) -> String {
    (Utc::now() + offset).to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[sqlx::test]
async fn measurements_need_the_health_consent(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token) = athlete(&app, "nour").await;
    for reply in [
        app.call(Method::GET, BODY, Some(&token), None).await,
        add(&app, &token, json!({"weightKg": 70})).await,
    ] {
        assert_eq!(reply.status, StatusCode::FORBIDDEN, "{}", reply.json);
        assert_eq!(reply.json["code"], "CONSENT_REQUIRED");
        assert_eq!(reply.json["consent"], "HEALTH_DATA");
    }
}

#[sqlx::test]
async fn a_measurement_is_kept_encrypted(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, token) = athlete(&app, "nour").await;
    set_consent(&app, user, "HEALTH_DATA", true).await;

    let reply = add(&app, &token, json!({"weightKg": 78.4, "bodyFatPct": 18.5})).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(reply.json["weightKg"], 78.4);
    assert_eq!(reply.json["bodyFatPct"], 18.5);
    assert_eq!(reply.json["source"], "MANUAL");
    assert!(reply.json["id"].is_string() && reply.json["measuredAt"].is_string());

    let older = add(
        &app,
        &token,
        json!({"weightKg": 79, "measuredAt": at(-Duration::days(1)), "source": "HEALTH_CONNECT"}),
    )
    .await;
    assert_eq!(older.status, StatusCode::CREATED, "{}", older.json);

    let list = app.call(Method::GET, BODY, Some(&token), None).await;
    assert_eq!(list.status, StatusCode::OK, "{}", list.json);
    assert_eq!(list.json[0]["id"], reply.json["id"]);
    assert_eq!(list.json[1]["weightKg"], 79.0);
    assert_eq!(list.json[1]["bodyFatPct"], Value::Null);
    assert_eq!(list.json[1]["source"], "HEALTH_CONNECT");

    let stored: Vec<Vec<u8>> =
        sqlx::query_scalar("SELECT weight_kg_enc FROM body_measurements WHERE user_id = ?")
            .bind(user)
            .fetch_all(&app.db)
            .await
            .unwrap();
    assert_eq!(stored.len(), 2);
    for blob in stored {
        assert!(!blob.windows(4).any(|w| w == b"78.4"), "a weight is stored in clear");
    }
}

#[sqlx::test]
async fn withdrawing_the_consent_closes_both_routes(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (user, token) = athlete(&app, "nour").await;
    set_consent(&app, user, "HEALTH_DATA", true).await;
    assert_eq!(
        add(&app, &token, json!({"weightKg": 78.4})).await.status,
        StatusCode::CREATED
    );
    assert_eq!(
        body::latest_weight_kg(&app.state, user).await.unwrap(),
        Some(78.4)
    );

    set_consent(&app, user, "HEALTH_DATA", false).await;
    assert_eq!(
        app.call(Method::GET, BODY, Some(&token), None).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        add(&app, &token, json!({"weightKg": 78.4})).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(body::latest_weight_kg(&app.state, user).await.unwrap(), None);
}

#[sqlx::test]
async fn measurement_limits(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, token) = athlete(&app, "nour").await;
    set_consent(&app, user, "HEALTH_DATA", true).await;

    for (body, field, code) in [
        (json!({"weightKg": 24}), "weightKg", "MIN"),
        (json!({"weightKg": 351}), "weightKg", "MAX"),
        (json!({"weightKg": 70, "bodyFatPct": 71}), "bodyFatPct", "MAX"),
        (json!({"weightKg": 70, "bodyFatPct": 1}), "bodyFatPct", "MIN"),
        (
            json!({"weightKg": 70, "measuredAt": at(Duration::minutes(20))}),
            "measuredAt",
            "IN_FUTURE",
        ),
        (json!({"weightKg": 70, "measuredAt": "yesterday"}), "measuredAt", "ISISO8601"),
        (json!({"weightKg": 70, "source": "FITBIT"}), "source", "INVALID"),
        (json!({"weightKg": 70, "bmi": 22}), "bmi", "UNKNOWN_FIELD"),
    ] {
        let reply = add(&app, &token, body.clone()).await;
        assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY, "{body}: {}", reply.json);
        assert_eq!(reply.json["errors"][0]["field"], field, "{body}: {}", reply.json);
        assert_eq!(reply.json["errors"][0]["code"], code, "{body}: {}", reply.json);
    }

    // A float with more decimals than the app shows is rounded, not refused.
    let reply = add(&app, &token, json!({"weightKg": 78.456, "bodyFatPct": 18.44})).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(reply.json["weightKg"], 78.46);
    assert_eq!(reply.json["bodyFatPct"], 18.4);
}
