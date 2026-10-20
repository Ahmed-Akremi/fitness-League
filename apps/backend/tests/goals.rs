#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Goals as the app sets and reads them: milestones, suggestions, safety, and what reaches them.
mod common;

use axum::http::{Method, StatusCode};
use chrono::{Duration, NaiveDate, Utc};
use common::{Reply, TestApp, seeded, set_consent, workouts::*};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const GOALS: &str = "/api/v1/goals";

fn today(app: &TestApp) -> NaiveDate {
    backend::security::policy::business_today(Utc::now(), app.state.cfg.business_utc_offset_minutes)
}

fn day(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or_else(|| panic!("not a number: {v}"))
}

async fn create(app: &TestApp, token: &str, body: Value) -> Reply {
    app.call(Method::POST, GOALS, Some(token), Some(body)).await
}

async fn list(app: &TestApp, token: &str) -> Vec<Value> {
    let reply = get(app, token, GOALS).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    reply.json.as_array().unwrap().clone()
}

/// The first field error of a 422.
fn error(reply: &Reply) -> (String, String) {
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY, "{}", reply.json);
    let e = &reply.json["errors"][0];
    (
        e["field"].as_str().unwrap().to_owned(),
        e["code"].as_str().unwrap().to_owned(),
    )
}

fn milestone_values(goal: &Value) -> Vec<Value> {
    goal["milestones"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["targetValue"].clone())
        .collect()
}

/// An athlete with one squat session 48 h ago (3 × 5 × 100: E1RM 116.67), still in calibration.
async fn trained(app: &TestApp, name: &str) -> (Uuid, String, Catalog) {
    let c = catalog(app).await;
    let (user, token) = athlete(app, name).await;
    let reply = post(app, &token, &strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(48))).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    (user, token, c)
}

fn squat_goal(c: &Catalog, target: f64) -> Value {
    json!({"type": "STRENGTH", "exerciseId": c.squat, "metricCode": "E1RM", "targetValue": target})
}

async fn weigh(app: &TestApp, token: &str, kg: f64) {
    let reply = app
        .call(Method::POST, "/api/v1/me/body-measurements", Some(token), Some(json!({"weightKg": kg})))
        .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
}

fn weight_goal(target: f64) -> Value {
    json!({"type": "WEIGHT", "metricCode": "BODY_WEIGHT", "targetValue": target})
}

#[sqlx::test]
async fn suggestions_rank_three_targets(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token, c) = trained(&app, "sugg").await;
    let ask = |kind: &str| json!({"type": kind, "exerciseId": c.squat, "metricCode": "E1RM"});
    let path = "/api/v1/goals/suggestions";
    let reply = app.call(Method::POST, path, Some(&token), Some(ask("STRENGTH"))).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    let s = &reply.json;
    assert_eq!(num(&s["current"]), 116.67);
    assert_eq!(
        s["metric"],
        json!({"code": "E1RM", "unit": "kg", "direction": "HIGHER_IS_BETTER"})
    );
    assert_eq!(num(&s["expectedPctPer28Days"]), 3.0);
    assert_eq!(
        s["suggestions"],
        json!([
            {"horizon": "SHORT", "targetValue": 120.0, "etaWeeks": {"min": 3, "max": 4}},
            {"horizon": "MEDIUM", "targetValue": 125.0, "etaWeeks": {"min": 7, "max": 10}},
            {"horizon": "LONG", "targetValue": 135.0, "etaWeeks": {"min": 14, "max": 20}},
        ])
    );
    assert_eq!(s["disclaimerKey"], "goals.disclaimer");

    let (_, newcomer) = athlete(&app, "sugg_new").await;
    let none = app.call(Method::POST, path, Some(&newcomer), Some(ask("STRENGTH"))).await;
    assert_eq!(error(&none), ("targetValue".into(), "NO_CURRENT_VALUE".into()));
    let weight = app.call(Method::POST, path, Some(&token), Some(ask("WEIGHT"))).await;
    assert_eq!(error(&weight), ("type".into(), "INVALID".into()));
}

#[sqlx::test]
async fn a_strength_goal_plans_its_milestones(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token, c) = trained(&app, "plan").await;
    let reply = create(&app, &token, squat_goal(&c, 125.0)).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    let g = &reply.json;
    assert_eq!(g["type"], "STRENGTH");
    assert_eq!(g["exerciseId"], json!(c.squat));
    assert_eq!(g["metric"], json!({"code": "E1RM", "unit": "kg"}));
    assert_eq!(g["direction"], "INCREASE");
    assert_eq!(num(&g["startValue"]), 116.67);
    assert_eq!(num(&g["targetValue"]), 125.0);
    assert_eq!(milestone_values(g), [json!(120.0), json!(122.5), json!(125.0)]);
    for (i, m) in g["milestones"].as_array().unwrap().iter().enumerate() {
        assert_eq!(m["index"], i);
        assert!(m["reachedAt"].is_null());
    }
    assert_eq!(g["milestonesReached"], 0);
    assert_eq!(g["status"], "ACTIVE");
    assert_eq!(g["visibility"], "PRIVATE");
    assert_eq!(g["wasSuggested"], false);
    assert_eq!(g["startDate"], day(today(&app)));
    assert!(g["targetDate"].is_null());
    assert!(g["safetyAdjustment"].is_null());
    assert!(g.get("habitWeeksMet").is_none(), "{g}");
    assert_eq!(g["disclaimerKey"], "goals.disclaimer");

    let goals = list(&app, &token).await;
    assert_eq!(goals.len(), 1);
    assert_eq!(goals[0]["id"], g["id"]);
    assert!(goals[0].get("disclaimerKey").is_none());
}

#[sqlx::test]
async fn a_too_early_date_is_moved(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token, c) = trained(&app, "early").await;
    let tomorrow = day(today(&app) + Duration::days(1));
    let mut body = squat_goal(&c, 125.0);
    body["targetDate"] = json!(tomorrow);
    let reply = create(&app, &token, body).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(reply.json["targetDate"], day(today(&app) + Duration::days(49)));
    assert_eq!(
        reply.json["safetyAdjustment"],
        json!({"reason": "TOO_FAST", "requestedTargetDate": tomorrow, "earliestRealisticWeeks": 7})
    );
}

#[sqlx::test]
async fn targets_must_be_better_and_reachable(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token, c) = trained(&app, "reach").await;
    let lower = create(&app, &token, squat_goal(&c, 115.0)).await;
    assert_eq!(error(&lower), ("targetValue".into(), "TARGET_NOT_BETTER".into()));
    assert_eq!(num(&lower.json["current"]), 116.67);
    let far = create(&app, &token, squat_goal(&c, 1000.0)).await;
    assert_eq!(error(&far), ("targetValue".into(), "UNREALISTIC_TARGET".into()));
    assert_eq!(far.json["suggestions"].as_array().unwrap().len(), 3);
}

#[sqlx::test]
async fn goal_bodies_are_checked(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token, c) = trained(&app, "bodies").await;
    let habit = |target: Value| json!({"type": "HABIT", "metricCode": "WORKOUTS_PER_WEEK", "targetValue": target});
    let with = |mut body: Value, key: &str, value: Value| {
        body[key] = value;
        body
    };
    let today = day(today(&app));
    let cases = [
        (json!({"type": "STRENGTH", "metricCode": "E1RM", "targetValue": 125}), "exerciseId", "REQUIRED"),
        (with(squat_goal(&c, 125.0), "metricCode", json!("TIME_5K")), "metricCode", "NOT_ALLOWED_FOR_TYPE"),
        (with(squat_goal(&c, 125.0), "exerciseId", json!(c.run)), "exerciseId", "METRIC_NOT_TRACKED"),
        (with(habit(json!(3)), "exerciseId", json!(c.squat)), "exerciseId", "NOT_ALLOWED_FOR_TYPE"),
        (habit(json!(7)), "targetValue", "REST_DAY_REQUIRED"),
        (habit(json!(3.5)), "targetValue", "REST_DAY_REQUIRED"),
        (squat_goal(&c, 0.0), "targetValue", "ISPOSITIVE"),
        (with(squat_goal(&c, 125.0), "targetDate", json!("soon")), "targetDate", "ISISO8601"),
        (with(squat_goal(&c, 125.0), "targetDate", json!(today)), "targetDate", "MUST_BE_IN_FUTURE"),
        (with(squat_goal(&c, 125.0), "xp", json!(10)), "xp", "UNKNOWN_FIELD"),
    ];
    for (body, field, code) in cases {
        let reply = create(&app, &token, body.clone()).await;
        assert_eq!(error(&reply), (field.to_owned(), code.to_owned()), "{body}");
    }
    assert!(list(&app, &token).await.is_empty());
}

#[sqlx::test]
async fn a_habit_goal_counts_weeks(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token) = athlete(&app, "habit").await;
    let reply = create(
        &app,
        &token,
        json!({"type": "HABIT", "metricCode": "WORKOUTS_PER_WEEK", "targetValue": 3}),
    )
    .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    let g = &reply.json;
    assert_eq!(num(&g["startValue"]), 0.0);
    assert_eq!(num(&g["targetValue"]), 3.0);
    assert_eq!(g["direction"], "INCREASE");
    assert!(g["exerciseId"].is_null());
    assert_eq!(
        milestone_values(g),
        [json!(2.0), json!(4.0), json!(8.0), json!(12.0)]
    );
    assert_eq!(g["habitWeeksMet"], 0);
}

#[sqlx::test]
async fn a_weight_goal_is_paced_safely(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, token) = athlete(&app, "weight").await;
    set_consent(&app, user, "HEALTH_DATA", true).await;
    weigh(&app, &token, 80.0).await;
    let requested = day(today(&app) + Duration::days(7));
    let mut body = weight_goal(76.0);
    body["targetDate"] = json!(requested);
    body["visibility"] = json!("PUBLIC");
    let reply = create(&app, &token, body).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    let g = &reply.json;
    assert_eq!(g["direction"], "DECREASE");
    assert_eq!(g["visibility"], "PRIVATE");
    assert_eq!(num(&g["startValue"]), 80.0);
    assert_eq!(num(&g["targetValue"]), 76.0);
    assert_eq!(milestone_values(g), [json!(78.0), json!(76.0)]);
    assert_eq!(g["targetDate"], day(today(&app) + Duration::days(35)));
    assert_eq!(
        g["safetyAdjustment"],
        json!({"reason": "WEIGHT_RATE_LIMIT", "requestedTargetDate": requested, "maxPctPerWeek": 1.0})
    );
    let id = Uuid::parse_str(g["id"].as_str().unwrap()).unwrap();
    let (clear, sealed): (bool, bool) = sqlx::query_as(
        "SELECT start_value IS NULL AND target_value IS NULL, start_value_enc IS NOT NULL FROM goals WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert!(clear && sealed);
    let clear_milestones: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM goal_milestones WHERE goal_id = ? AND target_value IS NOT NULL",
    )
    .bind(id)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(clear_milestones, 0);
}

#[sqlx::test]
async fn weight_targets_stay_safe(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, token) = athlete(&app, "safe").await;
    set_consent(&app, user, "HEALTH_DATA", true).await;
    weigh(&app, &token, 80.0).await;
    for (target, code) in [(55.0, "UNSAFE_TARGET"), (35.0, "UNSAFE_TARGET"), (80.2, "TARGET_NOT_BETTER")] {
        let reply = create(&app, &token, weight_goal(target)).await;
        assert_eq!(error(&reply), ("targetValue".into(), code.into()), "{target}");
    }
    let (_, other) = athlete(&app, "safe_other").await;
    let reply = create(&app, &other, weight_goal(76.0)).await;
    assert_eq!(error(&reply), ("targetValue".into(), "NO_CURRENT_VALUE".into()));
}

#[sqlx::test]
async fn weight_values_need_the_consent(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, token, c) = trained(&app, "consent").await;
    set_consent(&app, user, "HEALTH_DATA", true).await;
    weigh(&app, &token, 80.0).await;
    assert_eq!(create(&app, &token, weight_goal(76.0)).await.status, StatusCode::CREATED);
    assert_eq!(create(&app, &token, squat_goal(&c, 125.0)).await.status, StatusCode::CREATED);
    set_consent(&app, user, "HEALTH_DATA", false).await;
    let goals = list(&app, &token).await;
    let weight = goals.iter().find(|g| g["type"] == "WEIGHT").unwrap();
    assert!(weight["startValue"].is_null() && weight["targetValue"].is_null(), "{weight}");
    assert!(milestone_values(weight).iter().all(Value::is_null), "{weight}");
    let strength = goals.iter().find(|g| g["type"] == "STRENGTH").unwrap();
    assert_eq!(num(&strength["targetValue"]), 125.0);
}

#[sqlx::test]
async fn one_active_goal_per_metric(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token, c) = trained(&app, "dupe").await;
    let first = create(&app, &token, squat_goal(&c, 125.0)).await;
    assert_eq!(first.status, StatusCode::CREATED, "{}", first.json);
    let first_id = first.json["id"].as_str().unwrap().to_owned();
    let again = create(&app, &token, squat_goal(&c, 130.0)).await;
    assert_eq!(again.status, StatusCode::CONFLICT, "{}", again.json);
    assert_eq!(again.json["code"], "CONFLICT");
    assert_eq!(again.json["goalId"], first_id);

    let path = format!("{GOALS}/{first_id}");
    let abandoned = app.call(Method::DELETE, &path, Some(&token), None).await;
    assert_eq!(abandoned.status, StatusCode::NO_CONTENT);
    let second = create(&app, &token, squat_goal(&c, 130.0)).await;
    assert_eq!(second.status, StatusCode::CREATED, "{}", second.json);
    let goals = list(&app, &token).await;
    assert_eq!(goals[0]["id"], second.json["id"]);
    assert_eq!(goals[0]["status"], "ACTIVE");
    assert_eq!(goals[1]["id"], first_id);
    assert_eq!(goals[1]["status"], "ABANDONED");
    let again = app.call(Method::DELETE, &path, Some(&token), None).await;
    assert_eq!(again.status, StatusCode::NO_CONTENT);
    assert_eq!(list(&app, &token).await[1]["status"], "ABANDONED");
}

#[sqlx::test]
async fn ten_active_goals_at_most(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, token, c) = trained(&app, "ten").await;
    let exercises: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM exercises WHERE id <> ? LIMIT 10")
        .bind(c.squat)
        .fetch_all(&app.db)
        .await
        .unwrap();
    assert_eq!(exercises.len(), 10);
    for exercise in exercises {
        sqlx::query(
            "INSERT INTO goals (id, user_id, type, exercise_id, metric_type_id, direction, start_value, \
               target_value, start_date) \
             SELECT ?, ?, 'STRENGTH', ?, id, 'INCREASE', 1, 2, CURRENT_DATE FROM metric_types WHERE code = 'E1RM'",
        )
        .bind(Uuid::now_v7())
        .bind(user)
        .bind(exercise)
        .execute(&app.db)
        .await
        .unwrap();
    }
    let reply = create(&app, &token, squat_goal(&c, 125.0)).await;
    assert_eq!(reply.status, StatusCode::CONFLICT, "{}", reply.json);
    assert_eq!(reply.json["code"], "CONFLICT");
}

#[sqlx::test]
async fn simultaneous_goals_make_one(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, token, c) = trained(&app, "twice").await;
    let (a, b) = tokio::join!(
        create(&app, &token, squat_goal(&c, 125.0)),
        create(&app, &token, squat_goal(&c, 125.0))
    );
    let mut statuses = [a.status, b.status];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::CREATED, StatusCode::CONFLICT], "{} {}", a.json, b.json);
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM goals WHERE user_id = ?")
        .bind(user)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(rows, 1);
}

#[sqlx::test]
async fn goals_belong_to_their_owner(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token, c) = trained(&app, "owner").await;
    let goal = create(&app, &token, squat_goal(&c, 125.0)).await;
    let id = goal.json["id"].as_str().unwrap();
    let (_, other) = athlete(&app, "owner_other").await;
    let theirs = app.call(Method::DELETE, &format!("{GOALS}/{id}"), Some(&other), None).await;
    assert_eq!(theirs.status, StatusCode::NOT_FOUND);
    assert!(list(&app, &other).await.is_empty());
    let malformed = app.call(Method::DELETE, &format!("{GOALS}/not-a-uuid"), Some(&token), None).await;
    assert_eq!(malformed.status, StatusCode::NOT_FOUND);
    assert_eq!(list(&app, &token).await[0]["status"], "ACTIVE");
}

/// Saves a workout the anti-cheat accepts and returns it.
async fn logged(app: &TestApp, token: &str, body: &Value) -> Value {
    let reply = post(app, token, body).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(reply.json["status"], "ACCEPTED", "{}", reply.json);
    reply.json
}

fn squat(c: &Catalog, kg: f64, hours_ago: i64) -> Value {
    lifting(c, Uuid::now_v7(), Utc::now() - Duration::hours(hours_ago), kg, 5)
}

/// The XP entries a workout earned.
async fn earned(app: &TestApp, token: &str, workout: &Value) -> Vec<Value> {
    let id = workout["id"].as_str().unwrap();
    let reply = get(app, token, &format!("{WORKOUTS}/{id}/points")).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    reply.json["entries"].as_array().unwrap().clone()
}

fn reasons(entries: &[Value]) -> Vec<(String, i64)> {
    entries
        .iter()
        .map(|e| (e["reason"].as_str().unwrap().to_owned(), e["amount"].as_i64().unwrap()))
        .collect()
}

fn milestone_entries(entries: &[Value]) -> usize {
    entries.iter().filter(|e| e["reason"] == "GOAL_MILESTONE").count()
}

async fn goal(app: &TestApp, token: &str, id: &Value) -> Value {
    list(app, token).await.into_iter().find(|g| g["id"] == *id).unwrap()
}

#[sqlx::test]
async fn workouts_reach_milestones_once(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, token, c) = trained(&app, "steps").await;
    let id = create(&app, &token, squat_goal(&c, 125.0)).await.json["id"].clone();

    // E1RM 122.5 passes 120 and 122.5 at once.
    let second = logged(&app, &token, &squat(&c, 105.0, 4)).await;
    let entries = earned(&app, &token, &second).await;
    assert_eq!(
        reasons(&entries),
        [("WORKOUT".to_owned(), 30), ("GOAL_MILESTONE".to_owned(), 150), ("GOAL_MILESTONE".to_owned(), 150)]
    );
    assert_eq!(
        entries[1]["explanation"],
        json!({"formula": "goal_milestone_xp", "inputs": {"goalId": id, "milestone": 1, "of": 3},
               "workoutId": second["id"], "result": 150})
    );
    let g = goal(&app, &token, &id).await;
    assert_eq!(g["milestonesReached"], 2);
    let reached: Vec<bool> = g["milestones"].as_array().unwrap().iter().map(|m| !m["reachedAt"].is_null()).collect();
    assert_eq!(reached, [true, true, false]);

    let third = logged(&app, &token, &squat(&c, 110.0, 2)).await;
    assert_eq!(milestone_entries(&earned(&app, &token, &third).await), 1);
    assert_eq!(goal(&app, &token, &id).await["status"], "COMPLETED");

    // A completed goal earns nothing more.
    let fourth = logged(&app, &token, &lifting(&c, Uuid::now_v7(), Utc::now() - Duration::minutes(30), 112.5, 5)).await;
    assert_eq!(milestone_entries(&earned(&app, &token, &fourth).await), 0);
    let (cached, sum): (i64, i64) = sqlx::query_as(
        "SELECT s.xp_total, CAST(COALESCE((SELECT SUM(amount) FROM xp_transactions WHERE user_id = s.user_id), 0) AS SIGNED) \
         FROM user_stats s WHERE s.user_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(cached, sum);
}

#[sqlx::test]
async fn an_abandoned_goal_is_not_credited(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token, c) = trained(&app, "quit").await;
    let id = create(&app, &token, squat_goal(&c, 125.0)).await.json["id"].clone();
    let path = format!("{GOALS}/{}", id.as_str().unwrap());
    assert_eq!(app.call(Method::DELETE, &path, Some(&token), None).await.status, StatusCode::NO_CONTENT);
    let workout = logged(&app, &token, &squat(&c, 110.0, 1)).await;
    assert_eq!(milestone_entries(&earned(&app, &token, &workout).await), 0);
    assert_eq!(goal(&app, &token, &id).await["milestonesReached"], 0);
}

#[sqlx::test]
async fn a_held_record_reaches_no_milestone(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "held").await;
    sqlx::query("UPDATE profiles SET calibration_ends_at = UTC_TIMESTAMP(6) - INTERVAL 30 DAY WHERE user_id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    logged(&app, &token, &squat(&c, 100.0, 60)).await;
    let id = create(&app, &token, squat_goal(&c, 125.0)).await.json["id"].clone();
    // E1RM 163.33: far beyond the expected progress, held for review.
    let jump = logged(&app, &token, &squat(&c, 140.0, 1)).await;
    let status: String = sqlx::query_scalar(
        "SELECT p.status FROM personal_records p JOIN metric_types m ON m.id = p.metric_type_id \
         WHERE p.workout_id = ? AND m.code = 'E1RM'",
    )
    .bind(Uuid::parse_str(jump["id"].as_str().unwrap()).unwrap())
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(status, "HELD");
    assert_eq!(goal(&app, &token, &id).await["milestonesReached"], 0);
}

#[sqlx::test]
async fn a_late_workout_reaches_no_milestone(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token, c) = trained(&app, "late").await;
    let id = create(&app, &token, squat_goal(&c, 125.0)).await.json["id"].clone();
    logged(&app, &token, &squat(&c, 110.0, 80)).await;
    assert_eq!(goal(&app, &token, &id).await["milestonesReached"], 0);
}

#[sqlx::test]
async fn only_the_safe_rate_counts_toward_a_weight_goal(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, token) = athlete(&app, "slim").await;
    set_consent(&app, user, "HEALTH_DATA", true).await;
    weigh(&app, &token, 80.0).await;
    let id = create(&app, &token, weight_goal(76.0)).await.json["id"].clone();
    sqlx::query("UPDATE goals SET start_date = start_date - INTERVAL 28 DAY WHERE id = ?")
        .bind(Uuid::parse_str(id.as_str().unwrap()).unwrap())
        .execute(&app.db)
        .await
        .unwrap();
    // 4 kg in four weeks: only 3.2 kg count at 1 % a week, so 76.8 reaches 78, not 76.
    weigh(&app, &token, 76.0).await;
    let entries: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM xp_transactions WHERE user_id = ? AND reason = 'GOAL_MILESTONE' AND workout_id IS NULL",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(entries, 1);
    let g = goal(&app, &token, &id).await;
    assert_eq!(g["milestonesReached"], 1);
    assert_eq!(g["status"], "ACTIVE");
}
