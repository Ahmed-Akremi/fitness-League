#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The league as the app and the worker see it: the weekly score, the weekly close, seasons and jobs.
mod common;

use axum::http::StatusCode;
use backend::{modules::league::weekly, rules::Rules, security::policy, types::iso};
use chrono::{DateTime, Duration, Utc};
use common::{TestApp, assert_same_shape, calibrated, seeded, workouts::*};
use serde_json::Value;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const OFFSET: i32 = 60;

fn recorded(key: &str) -> Value {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../mobile-rn/assets/demo/api.json");
    let all: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    all[key].clone()
}

/// A moment of the current week, at least 2 hours ago when the week allows it.
fn this_week() -> DateTime<Utc> {
    let start = policy::week_start(Utc::now(), OFFSET);
    (Utc::now() - Duration::hours(2)).max(start + Duration::minutes(1))
}

async fn logged(app: &TestApp, token: &str, body: &Value) -> Value {
    let reply = post(app, token, body).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    reply.json
}

async fn league_athlete(app: &TestApp, name: &str) -> (Uuid, String) {
    let (user, token) = athlete(app, name).await;
    calibrated(app, user).await;
    (user, token)
}

/// A final squat `E1RM` baseline at `kg`, at the intermediate level.
async fn final_baseline(app: &TestApp, user: Uuid, kg: f64) {
    sqlx::query(
        "INSERT INTO baselines (id, user_id, exercise_id, metric_type_id, calibrated_value, effective_value, status, \
           experience_level, logs_counted, finalized_at) \
         SELECT ?, ?, e.id, m.id, ?, ?, 'FINAL', 'INTERMEDIATE', 2, UTC_TIMESTAMP(6) - INTERVAL 20 DAY \
         FROM exercises e, metric_types m WHERE e.code = 'BACK_SQUAT' AND m.code = 'E1RM'",
    )
    .bind(Uuid::now_v7())
    .bind(user)
    .bind(kg)
    .bind(kg)
    .execute(&app.db)
    .await
    .unwrap();
}

async fn current_week(app: &TestApp, token: &str) -> Value {
    let reply = get(app, token, "/api/v1/me/weekly-scores/current").await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    reply.json
}

async fn score_of(app: &TestApp, user: Uuid, week: DateTime<Utc>) -> weekly::WeeklyScore {
    let rules = Rules::active(&app.db).await.unwrap();
    let mut conn = app.db.acquire().await.unwrap();
    weekly::compute(&mut conn, &rules, user, week, OFFSET)
        .await
        .unwrap()
}

#[sqlx::test]
async fn the_running_week_is_provisional(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = league_athlete(&app, "provisional").await;
    logged(&app, &token, &strength(&c, Uuid::now_v7(), this_week())).await;

    let week = current_week(&app, &token).await;
    let start = policy::week_start(Utc::now(), OFFSET);
    assert_eq!(week["weekStart"], iso(start.naive_utc()));
    assert_eq!(week["status"], "PROVISIONAL");
    assert_eq!(week["trainingDays"], 1);
    assert_eq!(week["plannedDays"], 3);
    assert_eq!(week["components"]["consistency"], 33.33);
    assert!(week["components"]["challenge"].is_null());
    assert_eq!(week["eligible"], true);
    assert_eq!(
        week["projectedLp"].as_i64().unwrap(),
        week["total"].as_f64().unwrap().round() as i64
    );
    assert_eq!(week["breakdown"]["formula"], "weekly_score");
    assert_eq!(week["breakdown"]["topN"], 3);
    assert_eq!(week["breakdown"]["weights"]["progress"], 0.4);
    assert_same_shape(
        "week",
        &recorded("GET /me/weekly-scores/current"),
        &week,
    );
}

#[sqlx::test]
async fn a_calibrating_athlete_projects_no_lp(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "calibrating").await;
    logged(&app, &token, &strength(&c, Uuid::now_v7(), this_week())).await;
    let week = current_week(&app, &token).await;
    assert_eq!(week["eligible"], false);
    assert_eq!(week["projectedLp"], 0);
}

#[sqlx::test]
async fn a_late_log_counts_for_nothing(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = league_athlete(&app, "late").await;
    final_baseline(&app, user, 112.5).await;
    let at = Utc::now() - Duration::hours(80);
    logged(&app, &token, &strength(&c, Uuid::now_v7(), at)).await;
    let score = score_of(&app, user, policy::week_start(at, OFFSET)).await;
    assert_eq!(score.training_days, 0);
    assert_eq!(score.breakdown["metrics"].as_array().unwrap().len(), 0);
}

#[sqlx::test]
async fn progress_is_measured_against_the_expected_rate(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = league_athlete(&app, "progress").await;
    final_baseline(&app, user, 112.5).await;
    logged(&app, &token, &strength(&c, Uuid::now_v7(), this_week())).await;

    let week = current_week(&app, &token).await;
    let metrics = week["breakdown"]["metrics"].as_array().unwrap();
    assert_eq!(metrics.len(), 1, "{week}");
    let m = &metrics[0];
    assert_eq!(m["exerciseId"], c.squat.to_string());
    assert_eq!(m["metric"], "E1RM");
    assert_eq!(m["reference"], 112.5);
    assert_eq!(m["current"], 116.67);
    // (116.67 − 112.5) / 112.5 = 3.707 %, against 3 % expected.
    assert_eq!(m["ratio"], 1.236);
    assert_eq!(m["progressScore"], 82.4);
    assert_eq!(m["cappedForPlausibility"], false);
    assert_eq!(m["weekBest"], 116.67);
    assert_eq!(m["performanceRatio"], 1.0);
    assert_eq!(week["components"]["progress"], 82.37);
    assert_eq!(week["components"]["performance"], 100.0);
}
