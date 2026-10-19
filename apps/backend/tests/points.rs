#![allow(clippy::unwrap_used, clippy::expect_used)]
//! What an accepted workout earns, read back as the app reads it.
mod common;

use axum::http::{Method, StatusCode};
use chrono::{DateTime, Duration, Utc};
use common::{Reply, TestApp, seeded, workouts::*};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

fn hours_ago(hours: i64) -> DateTime<Utc> {
    Utc::now() - Duration::hours(hours)
}

/// Saves a workout the anti-cheat accepts and returns it.
async fn created(app: &TestApp, token: &str, body: &Value) -> Value {
    let reply = post(app, token, body).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(reply.json["status"], "ACCEPTED", "{}", reply.json);
    reply.json
}

async fn points(app: &TestApp, token: &str, workout: &Value) -> Reply {
    let id = workout["id"].as_str().unwrap();
    get(app, token, &format!("{WORKOUTS}/{id}/points")).await
}

fn entries(reply: &Reply) -> Vec<(String, i64)> {
    reply.json["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["reason"].as_str().unwrap().to_owned(),
                e["amount"].as_i64().unwrap(),
            )
        })
        .collect()
}

fn pairs(expected: &[(&str, i64)]) -> Vec<(String, i64)> {
    expected
        .iter()
        .map(|(r, n)| ((*r).to_owned(), *n))
        .collect()
}

/// Calibration ended a month ago: records are now judged against the expected progress.
async fn end_calibration(app: &TestApp, user: Uuid) {
    sqlx::query(
        "UPDATE profiles SET calibration_ends_at = UTC_TIMESTAMP(6) - INTERVAL 30 DAY WHERE user_id = ?",
    )
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
}

/// The cached balance equals the ledger.
async fn assert_balanced(app: &TestApp, user: Uuid) {
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

/// `(value, status, is_current)` of the records of `metric` a workout made.
async fn records_of(app: &TestApp, workout: &Value, metric: &str) -> Vec<(f64, String, bool)> {
    sqlx::query_as(
        "SELECT CAST(p.value AS DOUBLE), p.status, p.is_current FROM personal_records p \
         JOIN metric_types m ON m.id = p.metric_type_id WHERE p.workout_id = ? AND m.code = ?",
    )
    .bind(Uuid::parse_str(workout["id"].as_str().unwrap()).unwrap())
    .bind(metric)
    .fetch_all(&app.db)
    .await
    .unwrap()
}

async fn current_record(app: &TestApp, user: Uuid, metric: &str) -> f64 {
    sqlx::query_scalar(
        "SELECT CAST(p.value AS DOUBLE) FROM personal_records p \
         JOIN metric_types m ON m.id = p.metric_type_id \
         WHERE p.user_id = ? AND m.code = ? AND p.is_current",
    )
    .bind(user)
    .bind(metric)
    .fetch_one(&app.db)
    .await
    .unwrap()
}

#[sqlx::test]
async fn a_first_workout_earns_its_points_and_the_quest(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "first").await;
    let workout = created(&app, &token, &strength(&c, Uuid::now_v7(), hours_ago(2))).await;

    let reply = points(&app, &token, &workout).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.json["workoutId"], workout["id"]);
    assert_eq!(reply.json["status"], "ACCEPTED");
    assert_eq!(reply.json["totalXp"], 140);
    assert_eq!(
        entries(&reply),
        pairs(&[("WORKOUT", 30), ("CALIBRATION_PR", 10), ("QUEST", 100)])
    );
    let explanation = &reply.json["entries"][0]["explanation"];
    assert_eq!(explanation["formula"], "workout_xp");
    assert_eq!(explanation["requested"], 30);
    assert_eq!(explanation["result"], 30);
    let steps: Vec<(&str, f64)> = explanation["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (s["label"].as_str().unwrap(), s["value"].as_f64().unwrap()))
        .collect();
    assert_eq!(&steps[..2], [("base", 10.0), ("duration_bonus", 20.0)]);

    let me = app
        .call(Method::GET, "/api/v1/me", Some(&token), None)
        .await;
    let stats = &me.json["stats"];
    assert_eq!(
        [
            &stats["xpTotal"],
            &stats["level"],
            &stats["xpIntoLevel"],
            &stats["xpForNextLevel"]
        ],
        [&json!(140), &json!(2), &json!(40), &json!(283)]
    );
    assert_eq!(me.json["streak"]["currentDays"], 1);
    assert_balanced(&app, user).await;
}

/// Three squat sessions after calibration, a day apart: 100, 102.5 and 105 kg × 5.
async fn three_squats(app: &TestApp, c: &Catalog, token: &str) -> [Value; 3] {
    [
        created(
            app,
            token,
            &lifting(c, Uuid::now_v7(), hours_ago(60), 100.0, 5),
        )
        .await,
        created(
            app,
            token,
            &lifting(c, Uuid::now_v7(), hours_ago(36), 102.5, 5),
        )
        .await,
        created(
            app,
            token,
            &lifting(c, Uuid::now_v7(), hours_ago(12), 105.0, 5),
        )
        .await,
    ]
}

#[sqlx::test]
async fn records_after_calibration_follow_the_expected_progress(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "progress").await;
    end_calibration(&app, user).await;
    let [first, second, third] = three_squats(&app, &c, &token).await;

    // No earlier record: the first is a calibration record.
    assert_eq!(
        entries(&points(&app, &token, &first).await),
        pairs(&[("WORKOUT", 30), ("CALIBRATION_PR", 10), ("QUEST", 100)])
    );
    // 116.67 → 119.58 is +2.49 %, against the 3 % an intermediate is expected to make.
    let reply = points(&app, &token, &second).await;
    assert_eq!(entries(&reply), pairs(&[("WORKOUT", 30), ("PR", 237)]));
    let inputs = &reply.json["entries"][1]["explanation"]["inputs"];
    assert_eq!(inputs["metric"], "E1RM");
    assert_eq!(inputs["previous"].as_f64(), Some(116.67));
    assert!((inputs["ratio"].as_f64().unwrap() - 0.831).abs() < 0.001);
    // Within the cooldown: the record stands, without XP.
    assert_eq!(
        entries(&points(&app, &token, &third).await),
        pairs(&[("WORKOUT", 30)])
    );
    assert_eq!(
        records_of(&app, &third, "E1RM").await,
        [(122.5, "AWARDED".to_owned(), true)]
    );
    assert_balanced(&app, user).await;
}

#[sqlx::test]
async fn an_implausible_jump_is_held(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "jump").await;
    end_calibration(&app, user).await;
    three_squats(&app, &c, &token).await;

    let jump = created(
        &app,
        &token,
        &lifting(&c, Uuid::now_v7(), hours_ago(6), 140.0, 5),
    )
    .await;
    assert_eq!(
        entries(&points(&app, &token, &jump).await),
        pairs(&[("WORKOUT", 30)])
    );
    assert_eq!(
        records_of(&app, &jump, "E1RM").await,
        [(163.33, "HELD".to_owned(), false)]
    );
    assert_eq!(current_record(&app, user, "E1RM").await, 122.5);
}

#[sqlx::test]
async fn the_same_value_again_is_no_record(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "same").await;
    created(&app, &token, &strength(&c, Uuid::now_v7(), hours_ago(30))).await;
    let set = json!({"reps": 5, "weightKg": 100});
    let again = json!({
        "clientId": Uuid::now_v7(), "sportId": c.strength, "workoutType": "STRENGTH",
        "performedAt": rfc(hours_ago(6)), "durationS": 3600,
        "exercises": [{"exerciseId": c.squat, "sets": [set, set, set, set]}]
    });
    let again = created(&app, &token, &again).await;
    assert!(records_of(&app, &again, "E1RM").await.is_empty());
    assert_eq!(
        entries(&points(&app, &token, &again).await),
        pairs(&[("WORKOUT", 30)])
    );
}

#[sqlx::test]
async fn a_faster_run_is_a_record(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "runner").await;
    created(
        &app,
        &token,
        &run(&c, Uuid::now_v7(), 5.0, 30, hours_ago(50)),
    )
    .await;
    let faster = created(
        &app,
        &token,
        &run(&c, Uuid::now_v7(), 5.0, 28, hours_ago(26)),
    )
    .await;
    let slower = created(
        &app,
        &token,
        &run(&c, Uuid::now_v7(), 5.0, 29, hours_ago(2)),
    )
    .await;
    assert_eq!(records_of(&app, &faster, "TIME_5K").await.len(), 1);
    assert!(records_of(&app, &slower, "TIME_5K").await.is_empty());
    assert_eq!(current_record(&app, user, "TIME_5K").await, 1680.0);
}

#[sqlx::test]
async fn caps_follow_the_day_of_the_workout(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "capped").await;
    end_calibration(&app, user).await;
    created(
        &app,
        &token,
        &lifting(&c, Uuid::now_v7(), hours_ago(60), 100.0, 5),
    )
    .await;
    // 116.67 → 123.32 is 1.9 times the expected progress: 477 XP asked, 370 left that day.
    let big = created(
        &app,
        &token,
        &lifting(&c, Uuid::now_v7(), hours_ago(36), 105.7, 5),
    )
    .await;
    let reply = points(&app, &token, &big).await;
    assert_eq!(entries(&reply), pairs(&[("WORKOUT", 30), ("PR", 370)]));
    let explanation = &reply.json["entries"][1]["explanation"];
    assert_eq!(explanation["requested"], 477);
    assert_eq!(explanation["result"], 370);
    assert_eq!(explanation["caps"][0]["label"], "daily_cap_remaining");
    assert_eq!(explanation["caps"][0]["applied"], true);

    // Another business day: its own room, so the 30-minute run earns its full 10 + 30/3.
    let next = created(
        &app,
        &token,
        &run(&c, Uuid::now_v7(), 5.0, 30, hours_ago(12)),
    )
    .await;
    assert_eq!(
        entries(&points(&app, &token, &next).await)[0],
        ("WORKOUT".to_owned(), 20)
    );
    assert_balanced(&app, user).await;
}

#[sqlx::test]
async fn a_late_workout_earns_no_xp(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "late").await;
    let late = created(&app, &token, &strength(&c, Uuid::now_v7(), hours_ago(80))).await;

    let reply = points(&app, &token, &late).await;
    assert_eq!(reply.json["totalXp"], 0);
    assert!(entries(&reply).is_empty());
    assert_eq!(records_of(&app, &late, "E1RM").await.len(), 1);
    let me = app
        .call(Method::GET, "/api/v1/me", Some(&token), None)
        .await;
    assert_eq!(me.json["streak"]["currentDays"], 1);
    assert_eq!(me.json["stats"]["xpTotal"], 0);
}

#[sqlx::test]
async fn held_and_rejected_workouts_earn_nothing(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "nothing").await;
    let held = post(
        &app,
        &token,
        &single(&c, Uuid::now_v7(), hours_ago(3), 320.0),
    )
    .await;
    assert_eq!(held.json["status"], "HELD_FOR_REVIEW");
    let rejected = post(
        &app,
        &token,
        &run(&c, Uuid::now_v7(), 5.0, 10, hours_ago(8)),
    )
    .await;
    assert_eq!(rejected.status, StatusCode::UNPROCESSABLE_ENTITY);

    for workout in [&held.json, &rejected.json["workout"]] {
        let reply = points(&app, &token, workout).await;
        assert_eq!(reply.status, StatusCode::OK);
        assert_eq!(reply.json["totalXp"], 0);
        assert!(entries(&reply).is_empty());
    }
    let observed: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM metric_observations WHERE user_id = ?")
            .bind(user)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(observed, 0);
}

#[sqlx::test]
async fn simultaneous_workouts_are_scored_in_turn(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "twophones").await;
    let one = strength(&c, Uuid::now_v7(), hours_ago(5));
    let two = lifting(&c, Uuid::now_v7(), hours_ago(2), 105.0, 5);
    let (a, b) = tokio::join!(post(&app, &token, &one), post(&app, &token, &two));
    assert_eq!(
        (a.status, b.status),
        (StatusCode::CREATED, StatusCode::CREATED)
    );

    let quests: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM xp_transactions WHERE user_id = ? AND reason = 'QUEST'",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(quests, 1);
    assert_balanced(&app, user).await;
}

fn recorded() -> Value {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../mobile-rn/assets/demo/api.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// The first recorded answer whose key starts with `GET <prefix>` and ends with `suffix`.
fn recorded_answer(prefix: &str, suffix: &str) -> (String, Value) {
    let recorded = recorded();
    let key = recorded
        .as_object()
        .unwrap()
        .keys()
        .find(|k| k.starts_with(&format!("GET {prefix}")) && k.ends_with(suffix))
        .unwrap()
        .clone();
    let answer = recorded[&key].clone();
    (key, answer)
}

#[sqlx::test]
async fn points_belong_to_their_owner(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "owner").await;
    let (_, other) = athlete(&app, "other").await;
    let workout = created(&app, &token, &strength(&c, Uuid::now_v7(), hours_ago(2))).await;

    assert_eq!(
        points(&app, &other, &workout).await.status,
        StatusCode::NOT_FOUND
    );
    let malformed = get(&app, &token, &format!("{WORKOUTS}/not-a-uuid/points")).await;
    assert_eq!(malformed.status, StatusCode::NOT_FOUND);

    let (key, answer) = recorded_answer("/workouts/", "/points");
    common::assert_same_shape(&key, &answer, &points(&app, &token, &workout).await.json);
}

/// The entry of `metric` in a list of records or progress metrics.
fn of<'a>(list: &'a Value, metric: &str) -> &'a Value {
    list.as_array()
        .unwrap()
        .iter()
        .find(|m| m["metric"]["code"] == metric)
        .unwrap_or_else(|| panic!("no {metric} in {list}"))
}

/// Squats at 100 then 110 kg × 5: E1RM 116.67 then 128.33.
async fn squat_twice(app: &TestApp, c: &Catalog, token: &str, first_hours_ago: i64) {
    created(
        app,
        token,
        &lifting(c, Uuid::now_v7(), hours_ago(first_hours_ago), 100.0, 5),
    )
    .await;
    created(
        app,
        token,
        &lifting(c, Uuid::now_v7(), hours_ago(48), 110.0, 5),
    )
    .await;
}

#[sqlx::test]
async fn records_list_the_current_bests(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "records").await;
    squat_twice(&app, &c, &token, 72).await;

    let records = get(&app, &token, "/api/v1/me/records").await;
    assert_eq!(records.status, StatusCode::OK);
    assert_eq!(
        records.json.as_array().unwrap().len(),
        2,
        "{}",
        records.json
    );
    for (metric, value, previous) in [("E1RM", 128.33, 116.67), ("MAX_WEIGHT", 110.0, 100.0)] {
        let record = of(&records.json, metric);
        assert_eq!(record["value"].as_f64(), Some(value));
        assert_eq!(record["previousValue"].as_f64(), Some(previous));
        assert_eq!(record["status"], "CALIBRATION");
        assert_eq!(record["exercise"]["code"], "BACK_SQUAT");
        assert!(record["exercise"]["name"]["fr"].is_string());
        assert_eq!(record["metric"]["unit"], "kg");
        assert!(record["workoutId"].is_string() && record["achievedAt"].is_string());
    }
}

async fn progress(app: &TestApp, token: &str, period: &str) -> Reply {
    get(app, token, &format!("/api/v1/me/progress?period={period}")).await
}

#[sqlx::test]
async fn progress_compares_the_period_with_before(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "compare").await;
    squat_twice(&app, &c, &token, 40 * 24).await;

    let month = progress(&app, &token, "30d").await;
    assert_eq!(month.status, StatusCode::OK);
    assert_eq!(month.json["period"], "30d");
    let e1rm = of(&month.json["metrics"], "E1RM");
    assert_eq!(e1rm["exercise"]["code"], "BACK_SQUAT");
    assert_eq!(e1rm["metric"]["direction"], "HIGHER_IS_BETTER");
    assert_eq!(e1rm["before"].as_f64(), Some(116.67));
    assert_eq!(e1rm["now"].as_f64(), Some(128.33));
    assert_eq!(e1rm["changePct"].as_f64(), Some(10.0));
    assert_eq!(e1rm["sessions"], 1);
    // The 40-day-old workout was a late log: only the recent one earned its record XP.
    assert_eq!(e1rm["xpFromRecords"], 10);

    // Nothing before a year: the baseline, which calibration raised to the best logged.
    let year = progress(&app, &token, "1y").await;
    let e1rm = of(&year.json["metrics"], "E1RM");
    assert_eq!(e1rm["before"].as_f64(), Some(128.33));
    assert_eq!(e1rm["changePct"].as_f64(), Some(0.0));
    assert_eq!(e1rm["sessions"], 2);
}

#[sqlx::test]
async fn the_series_reads_oldest_first(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "series").await;
    squat_twice(&app, &c, &token, 72).await;

    let path = format!("/api/v1/me/progress/metrics/{}/E1RM?period=1y", c.squat);
    let series = get(&app, &token, &path).await;
    assert_eq!(series.status, StatusCode::OK);
    assert_eq!(series.json["metric"]["direction"], "HIGHER_IS_BETTER");
    let points = series.json["points"].as_array().unwrap();
    let values: Vec<f64> = points
        .iter()
        .map(|p| p["value"].as_f64().unwrap())
        .collect();
    assert_eq!(values, [116.67, 128.33]);
    assert!(
        points
            .iter()
            .all(|p| p["workoutId"].is_string() && p["at"].is_string())
    );

    let unknown = format!("/api/v1/me/progress/metrics/{}/NOPE", c.squat);
    assert_eq!(
        get(&app, &token, &unknown).await.status,
        StatusCode::NOT_FOUND
    );
    let malformed = "/api/v1/me/progress/metrics/not-a-uuid/E1RM";
    assert_eq!(
        get(&app, &token, malformed).await.status,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test]
async fn body_weight_shows_only_with_the_consent(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (user, token) = athlete(&app, "weighed").await;
    common::set_consent(&app, user, "HEALTH_DATA", true).await;
    for (kg, at) in [(80.0, hours_ago(72)), (79.0, hours_ago(1))] {
        let reply = app
            .call(
                Method::POST,
                "/api/v1/me/body-measurements",
                Some(&token),
                Some(json!({"weightKg": kg, "measuredAt": rfc(at)})),
            )
            .await;
        assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    }
    assert_eq!(
        progress(&app, &token, "30d").await.json["bodyWeight"],
        json!({"first": 80.0, "last": 79.0, "points": 2})
    );

    common::set_consent(&app, user, "HEALTH_DATA", false).await;
    assert!(progress(&app, &token, "30d").await.json["bodyWeight"].is_null());
}

#[sqlx::test]
async fn progress_periods(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token) = athlete(&app, "periods").await;
    let wrong = progress(&app, &token, "2w").await;
    assert_eq!(wrong.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        wrong.json["errors"],
        json!([{"field": "period", "code": "ISIN"}])
    );
    let default = get(&app, &token, "/api/v1/me/progress").await;
    assert_eq!(default.json["period"], "30d");
    assert_eq!(default.json["metrics"], json!([]));
}

#[sqlx::test]
async fn progress_has_the_shape_recorded_from_the_old_api(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "shape").await;
    squat_twice(&app, &c, &token, 72).await;
    let recorded = recorded();
    for (key, path) in [
        (
            "GET /me/progress?period=30d",
            "/api/v1/me/progress?period=30d",
        ),
        ("GET /me/records", "/api/v1/me/records"),
    ] {
        common::assert_same_shape(key, &recorded[key], &get(&app, &token, path).await.json);
    }
}
