#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The league as the app and the worker see it: the weekly score, the weekly close, seasons and jobs.
mod common;

use axum::http::{Method, StatusCode};
use backend::{modules::league::weekly, rules::Rules, security::policy, types::iso};
use chrono::{DateTime, Duration, Utc};
use common::{TestApp, assert_same_shape, calibrated, seeded, workouts::*};
use serde_json::{Value, json};
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

/// The active season's start moved 90 days back, so every week a test closes lies in it.
async fn stretch_season(app: &TestApp) -> Uuid {
    sqlx::query(
        "UPDATE seasons SET starts_at = starts_at - INTERVAL 90 DAY WHERE status = 'ACTIVE'",
    )
    .execute(&app.db)
    .await
    .unwrap();
    sqlx::query_scalar("SELECT id FROM seasons WHERE status = 'ACTIVE'")
        .fetch_one(&app.db)
        .await
        .unwrap()
}

async fn close(app: &TestApp, week: DateTime<Utc>) {
    let rules = Rules::active(&app.db).await.unwrap();
    weekly::close_week(&app.state, &rules, week).await.unwrap();
}

/// The local date of the week's Monday: the week's LP source id.
fn monday(week: DateTime<Utc>) -> String {
    policy::business_today(week, OFFSET).to_string()
}

type LpRow = (Uuid, i32, String, String, Option<Uuid>);

/// `(id, amount, reason, source_id, reverses_id)` of the athlete's LP entries, oldest first.
async fn lp_entries(app: &TestApp, user: Uuid) -> Vec<LpRow> {
    sqlx::query_as(
        "SELECT id, amount, reason, source_id, reverses_id FROM league_point_transactions \
         WHERE user_id = ? ORDER BY created_at, id",
    )
    .bind(user)
    .fetch_all(&app.db)
    .await
    .unwrap()
}

/// `(season_lp, current_season_id, division_code)`.
async fn stats(app: &TestApp, user: Uuid) -> (i32, Option<Uuid>, Option<String>) {
    sqlx::query_as(
        "SELECT season_lp, current_season_id, division_code FROM user_stats WHERE user_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap()
}

#[sqlx::test]
async fn closing_a_week_pays_its_lp_once(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let season = stretch_season(&app).await;
    let c = catalog(&app).await;
    let (user, token) = league_athlete(&app, "weekly").await;
    sqlx::query("UPDATE profiles SET planned_training_days_per_week = 1 WHERE user_id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    let at = this_week();
    logged(&app, &token, &strength(&c, Uuid::now_v7(), at)).await;
    let week = policy::week_start(at, OFFSET);
    let expected = score_of(&app, user, week).await;
    assert!(expected.lp > 0);

    close(&app, week).await;
    close(&app, week).await;

    let entries = lp_entries(&app, user).await;
    assert_eq!(entries.len(), 1, "{entries:?}");
    let (id, amount, reason, source, _) = &entries[0];
    assert_eq!(
        (reason.as_str(), source.as_str()),
        ("WEEKLY_SCORE", monday(week).as_str())
    );
    assert_eq!(i64::from(*amount), expected.lp);
    let (effective, explanation): (chrono::NaiveDateTime, String) = sqlx::query_as(
        "SELECT effective_at, explanation FROM league_point_transactions WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(effective, (week + Duration::days(7)).naive_utc());
    let explanation: Value = serde_json::from_str(&explanation).unwrap();
    assert_eq!(explanation["total"], expected.total);
    assert_eq!(explanation["components"]["consistency"], 100.0);
    let (total, paid): (f64, Option<Uuid>) = sqlx::query_as(
        "SELECT CAST(total AS DOUBLE), lp_transaction_id FROM weekly_scores WHERE user_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!((total, paid), (expected.total, Some(*id)));
    assert_eq!(
        stats(&app, user).await,
        (*amount, Some(season), Some("BRONZE".to_owned()))
    );
    let streak: (i32, i32) =
        sqlx::query_as("SELECT current_weeks, longest_weeks FROM user_streaks WHERE user_id = ?")
            .bind(user)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(streak, (1, 1));
    let me = get(&app, &token, "/api/v1/me").await;
    assert_eq!(me.json["stats"]["seasonLp"], *amount);
}

#[sqlx::test]
async fn a_week_without_a_season_pays_nothing(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = league_athlete(&app, "seasonless").await;
    let at = this_week();
    logged(&app, &token, &strength(&c, Uuid::now_v7(), at)).await;
    sqlx::query(
        "UPDATE seasons SET starts_at = starts_at + INTERVAL 2 YEAR, ends_at = ends_at + INTERVAL 2 YEAR",
    )
    .execute(&app.db)
    .await
    .unwrap();
    close(&app, policy::week_start(at, OFFSET)).await;
    let season: Option<Option<Uuid>> =
        sqlx::query_scalar("SELECT season_id FROM weekly_scores WHERE user_id = ?")
            .bind(user)
            .fetch_optional(&app.db)
            .await
            .unwrap();
    assert_eq!(season, Some(None));
    assert!(lp_entries(&app, user).await.is_empty());
    assert_eq!(stats(&app, user).await.0, 0);
}

#[sqlx::test]
async fn a_habit_goal_counts_its_weeks(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    stretch_season(&app).await;
    let c = catalog(&app).await;
    let (keen, keen_token) = league_athlete(&app, "keen").await;
    let (_, idle_token) = league_athlete(&app, "idle").await;
    for token in [&keen_token, &idle_token] {
        let body = json!({"type": "HABIT", "metricCode": "WORKOUTS_PER_WEEK", "targetValue": 1});
        let reply = app
            .call(Method::POST, "/api/v1/goals", Some(token), Some(body))
            .await;
        assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    }
    sqlx::query("UPDATE goals SET habit_weeks_met = 1")
        .execute(&app.db)
        .await
        .unwrap();
    let at = this_week();
    logged(&app, &keen_token, &strength(&c, Uuid::now_v7(), at)).await;

    close(&app, policy::week_start(at, OFFSET)).await;

    let goal = |token: String| {
        let app = &app;
        async move { get(app, &token, "/api/v1/goals").await.json[0].clone() }
    };
    let kept = goal(keen_token.clone()).await;
    assert_eq!(kept["habitWeeksMet"], 2, "{kept}");
    assert!(kept["milestones"][0]["reachedAt"].is_string(), "{kept}");
    let milestones: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM xp_transactions WHERE user_id = ? AND reason = 'GOAL_MILESTONE'",
    )
    .bind(keen)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(milestones, 1);
    assert_eq!(goal(idle_token).await["habitWeeksMet"], 0);
}

#[sqlx::test]
async fn a_corrected_baseline_rescores_the_paid_weeks(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    stretch_season(&app).await;
    let c = catalog(&app).await;
    let (user, token) = league_athlete(&app, "nour").await;
    let first = logged(&app, &token, &strength(&c, Uuid::now_v7(), this_week())).await;
    let first = Uuid::parse_str(first["id"].as_str().unwrap()).unwrap();
    // Eight days back: an earlier week.
    for sql in [
        "UPDATE workouts SET performed_at = performed_at - INTERVAL 8 DAY WHERE id = ?",
        "UPDATE metric_observations SET observed_at = observed_at - INTERVAL 8 DAY WHERE workout_id = ?",
    ] {
        sqlx::query(sql).bind(first).execute(&app.db).await.unwrap();
    }
    let first_at: chrono::NaiveDateTime =
        sqlx::query_scalar("SELECT performed_at FROM workouts WHERE id = ?")
            .bind(first)
            .fetch_one(&app.db)
            .await
            .unwrap();
    // The baseline became final at 50 just after that workout, so its own close audits nothing.
    sqlx::query(
        "UPDATE baselines b JOIN metric_types m ON m.id = b.metric_type_id \
         SET b.status = 'FINAL', b.effective_value = 50, b.experience_level = 'INTERMEDIATE', \
           b.finalized_at = ? + INTERVAL 1 MINUTE \
         WHERE b.user_id = ? AND m.code = 'E1RM'",
    )
    .bind(first_at)
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
    let paid_week = policy::week_start(first_at.and_utc(), OFFSET);
    close(&app, paid_week).await;
    let paid = lp_entries(&app, user).await;
    assert_eq!(paid.len(), 1, "{paid:?}");
    let (original, original_amount) = (paid[0].0, paid[0].1);

    let at = this_week();
    logged(&app, &token, &lifting(&c, Uuid::now_v7(), at, 105.0, 5)).await;
    close(&app, policy::week_start(at, OFFSET)).await;

    let corrected: (String, Option<f64>, Option<i32>) = sqlx::query_as(
        "SELECT b.status, CAST(b.corrected_from AS DOUBLE), b.rule_set_version FROM baselines b \
         JOIN metric_types m ON m.id = b.metric_type_id WHERE b.user_id = ? AND m.code = 'E1RM'",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(corrected, ("CORRECTED".to_owned(), Some(50.0), Some(2)));
    let entries = lp_entries(&app, user).await;
    assert!(
        entries
            .iter()
            .any(|e| e.2 == "REVERSAL" && e.4 == Some(original)),
        "{entries:?}"
    );
    let again = entries
        .iter()
        .find(|e| e.2 == "WEEKLY_SCORE" && e.3.starts_with(&format!("{}#c", monday(paid_week))))
        .expect("a corrected entry");
    assert!(again.1 < original_amount, "{entries:?}");
    let points_at: Option<Uuid> = sqlx::query_scalar(
        "SELECT lp_transaction_id FROM weekly_scores WHERE user_id = ? AND week_start = ?",
    )
    .bind(user)
    .bind(monday(paid_week))
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(points_at, Some(again.0));
    let sum: i32 = entries.iter().map(|e| e.1).sum();
    assert_eq!(stats(&app, user).await.0, sum);
}
