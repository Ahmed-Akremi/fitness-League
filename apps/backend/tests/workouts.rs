#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode, header};
use backend::security::policy;
use chrono::{Duration, Utc};
use common::{Reply, TestApp, seeded, seeded_with, set_consent, workouts::*};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

async fn rows(app: &TestApp, user: Uuid) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM workouts WHERE user_id = ?")
        .bind(user)
        .fetch_one(&app.db)
        .await
        .unwrap()
}

fn rules_hit(reply: &Reply) -> Vec<(String, String)> {
    let workout = if reply.json["workout"].is_object() {
        &reply.json["workout"]
    } else {
        &reply.json
    };
    workout["evaluation"]["ruleHits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| {
            (
                h["rule"].as_str().unwrap().to_owned(),
                h["severity"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

fn has(reply: &Reply, rule: &str, severity: &str) -> bool {
    rules_hit(reply).contains(&(rule.to_owned(), severity.to_owned()))
}

#[sqlx::test]
async fn a_workout_is_stored_as_the_app_reads_it(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;

    let reply = post(
        &app,
        &token,
        &strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2)),
    )
    .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(reply.headers[header::ETAG], "\"1\"");
    let w = &reply.json;
    assert_eq!(w["status"], "ACCEPTED");
    assert_eq!(w["visibility"], "FRIENDS");
    assert_eq!(w["version"], 1);
    assert_eq!(w["isVerified"], false);
    assert_eq!(w["totalVolumeKg"], 1500.0);
    assert_eq!(w["totalDistanceM"], 0);
    let sets = &w["exercises"][0]["sets"];
    assert_eq!(sets.as_array().unwrap().len(), 4);
    assert_eq!(sets[0]["isWarmup"], true);
    assert_eq!(sets[0]["e1rmKg"], Value::Null);
    assert_eq!(sets[1]["e1rmKg"], 116.67);
    assert_eq!(sets[1]["weightKg"], 100.0);
    assert_eq!(sets[1]["setIndex"], 1);
    assert_eq!(
        w["evaluation"],
        json!({"outcome": "ACCEPTED", "ruleHits": [], "countsForCompetition": true, "reviewedAt": null})
    );

    let detail = get(
        &app,
        &token,
        &format!("{WORKOUTS}/{}", w["id"].as_str().unwrap()),
    )
    .await;
    assert_eq!(detail.status, StatusCode::OK, "{}", detail.json);
    assert_eq!(detail.headers[header::ETAG], "\"1\"");
    assert_eq!(&detail.json, w);
}

#[sqlx::test]
async fn a_resent_workout_is_replayed(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "sami").await;
    let body = strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2));
    let first = post(&app, &token, &body).await;
    assert_eq!(first.status, StatusCode::CREATED, "{}", first.json);

    // The retry of a lost answer: another device clock, and a weight with float noise.
    let mut again = body.clone();
    again["deviceSubmittedAt"] = json!(rfc(Utc::now()));
    again["exercises"][0]["sets"][1]["weightKg"] = json!(100.0 + 1e-12);
    let replay = post(&app, &token, &again).await;
    assert_eq!(replay.status, StatusCode::OK, "{}", replay.json);
    assert_eq!(replay.json["id"], first.json["id"]);
    assert_eq!(rows(&app, user).await, 1);
}

#[sqlx::test]
async fn other_data_under_the_same_client_id_is_a_conflict(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "sami").await;
    let body = strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2));
    let first = post(&app, &token, &body).await;

    let mut changed = body.clone();
    changed["durationS"] = json!(4200);
    let reply = post(&app, &token, &changed).await;
    assert_eq!(reply.status, StatusCode::CONFLICT, "{}", reply.json);
    assert_eq!(reply.json["code"], "IDEMPOTENCY_CONFLICT");
    assert_eq!(reply.json["workout"]["id"], first.json["id"]);
    assert_eq!(reply.json["workout"]["durationS"], 3600);
    assert_eq!(rows(&app, user).await, 1);
}

#[sqlx::test]
async fn two_simultaneous_sends_make_one_workout(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "sami").await;
    let body = strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2));
    let (a, b) = tokio::join!(post(&app, &token, &body), post(&app, &token, &body));
    let mut statuses = [a.status.as_u16(), b.status.as_u16()];
    statuses.sort_unstable();
    assert_eq!(statuses, [200, 201], "{} / {}", a.json, b.json);
    assert_eq!(a.json["id"], b.json["id"]);
    assert_eq!(rows(&app, user).await, 1);
}

#[sqlx::test]
async fn the_idempotency_key_must_be_the_client_id(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;
    let client = Uuid::now_v7();
    let body = strength(&c, client, Utc::now() - Duration::hours(2));
    for key in [None, Some(Uuid::now_v7().to_string())] {
        let reply = send(&app, &token, &body, key.as_deref()).await;
        assert_eq!(
            reply.status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{}",
            reply.json
        );
        assert_eq!(
            reply.json["errors"][0],
            json!({"field": "Idempotency-Key", "code": "MUST_EQUAL_CLIENT_ID"})
        );
    }
    let upper = client.to_string().to_uppercase();
    let reply = send(&app, &token, &body, Some(&upper)).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
}

#[sqlx::test]
async fn an_impossible_workout_is_rejected_and_kept(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "sami").await;
    let body = run(&c, Uuid::now_v7(), 5.0, 10, Utc::now() - Duration::hours(2));
    for _ in 0..2 {
        let reply = post(&app, &token, &body).await;
        assert_eq!(
            reply.status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{}",
            reply.json
        );
        assert_eq!(reply.json["code"], "WORKOUT_REJECTED");
        assert_eq!(reply.json["workout"]["status"], "REJECTED");
        assert!(has(&reply, "RUN_PACE", "HARD"), "{}", reply.json);
    }
    assert_eq!(rows(&app, user).await, 1);
}

#[sqlx::test]
async fn an_exceptional_workout_is_held(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;
    let reply = post(
        &app,
        &token,
        &single(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2), 320.0),
    )
    .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(reply.json["status"], "HELD_FOR_REVIEW");
    assert!(has(&reply, "LIFT_ABSOLUTE_KG", "SOFT"), "{}", reply.json);
}

#[sqlx::test]
async fn body_weight_counts_only_with_the_consent(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "nour").await;
    set_consent(&app, user, "HEALTH_DATA", true).await;
    let weigh = app
        .call(
            Method::POST,
            "/api/v1/me/body-measurements",
            Some(&token),
            Some(json!({"weightKg": 70})),
        )
        .await;
    assert_eq!(weigh.status, StatusCode::CREATED, "{}", weigh.json);

    // 220 kg is under the absolute limit, but over three times a 70 kg body weight.
    let held = post(
        &app,
        &token,
        &single(&c, Uuid::now_v7(), Utc::now() - Duration::hours(4), 220.0),
    )
    .await;
    assert_eq!(held.json["status"], "HELD_FOR_REVIEW", "{}", held.json);
    assert!(has(&held, "LIFT_BODYWEIGHT_RATIO", "SOFT"), "{}", held.json);

    set_consent(&app, user, "HEALTH_DATA", false).await;
    let accepted = post(
        &app,
        &token,
        &single(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2), 220.0),
    )
    .await;
    assert_eq!(accepted.json["status"], "ACCEPTED", "{}", accepted.json);
}

#[sqlx::test]
async fn a_late_workout_is_history_only(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;
    let reply = post(
        &app,
        &token,
        &strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(80)),
    )
    .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(reply.json["status"], "ACCEPTED");
    assert_eq!(
        rules_hit(&reply),
        [("LATE_LOG".to_owned(), "INFO".to_owned())]
    );
    assert_eq!(reply.json["evaluation"]["countsForCompetition"], false);
}

#[sqlx::test]
async fn overlapping_and_duplicate_workouts_are_rejected(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;
    let at = Utc::now() - Duration::hours(3);
    let first = post(&app, &token, &strength(&c, Uuid::now_v7(), at)).await;
    assert_eq!(first.status, StatusCode::CREATED, "{}", first.json);

    let later = at + Duration::minutes(10);
    let overlap = post(&app, &token, &run(&c, Uuid::now_v7(), 5.0, 30, later)).await;
    assert_eq!(
        overlap.status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{}",
        overlap.json
    );
    assert!(
        has(&overlap, "OVERLAPPING_WORKOUT", "HARD"),
        "{}",
        overlap.json
    );

    let duplicate = post(&app, &token, &strength(&c, Uuid::now_v7(), later)).await;
    assert_eq!(
        duplicate.status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{}",
        duplicate.json
    );
    assert!(
        has(&duplicate, "DUPLICATE_WORKOUT", "HARD"),
        "{}",
        duplicate.json
    );
}

#[sqlx::test]
async fn the_fifth_workout_of_a_business_day_is_held(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;
    let day = policy::business_day_start(
        Utc::now() - Duration::hours(48),
        app.state.cfg.business_utc_offset_minutes,
    );
    // Different loads, so that no two are the same workout.
    for (i, hour) in [6, 9, 12, 15].into_iter().enumerate() {
        let kg = 80.0 + 2.5 * i as f64;
        let reply = post(
            &app,
            &token,
            &lifting(&c, Uuid::now_v7(), day + Duration::hours(hour), kg, 5),
        )
        .await;
        assert_eq!(
            reply.json["status"], "ACCEPTED",
            "workout {i}: {}",
            reply.json
        );
    }
    let fifth = post(
        &app,
        &token,
        &lifting(&c, Uuid::now_v7(), day + Duration::hours(18), 95.0, 5),
    )
    .await;
    assert_eq!(fifth.json["status"], "HELD_FOR_REVIEW", "{}", fifth.json);
    assert!(has(&fifth, "WORKOUTS_PER_DAY", "SOFT"), "{}", fifth.json);
}

fn errors(reply: &Reply) -> Vec<(String, String)> {
    reply.json["errors"]
        .as_array()
        .unwrap_or_else(|| panic!("no field errors in {}", reply.json))
        .iter()
        .map(|e| {
            (
                e["field"].as_str().unwrap().to_owned(),
                e["code"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

fn pairs(expected: &[(&str, &str)]) -> Vec<(String, String)> {
    expected
        .iter()
        .map(|(f, c)| ((*f).to_owned(), (*c).to_owned()))
        .collect()
}

#[sqlx::test]
async fn the_catalog_must_agree(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "sami").await;
    let at = rfc(Utc::now() - Duration::hours(2));

    let mixed = json!({
        "clientId": Uuid::now_v7(), "sportId": c.strength, "workoutType": "STRENGTH",
        "performedAt": at, "durationS": 3600,
        "exercises": [
            {"exerciseId": Uuid::now_v7(), "sets": [{"reps": 5}]},
            {"exerciseId": c.run, "sets": [{"reps": 5}]},
            {"exerciseId": c.squat, "sets": [{"weightKg": 100}, {"reps": 5}]}
        ]
    });
    let reply = post(&app, &token, &mixed).await;
    assert_eq!(
        reply.status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{}",
        reply.json
    );
    assert_eq!(
        errors(&reply),
        pairs(&[
            ("exercises[0].exerciseId", "UNKNOWN_EXERCISE"),
            ("exercises[1].exerciseId", "EXERCISE_NOT_IN_SPORT"),
            ("exercises[1].sets[0]", "DISTANCE_OR_DURATION_REQUIRED"),
            ("exercises[2].sets[0]", "REPS_OR_DURATION_REQUIRED"),
            ("exercises[2].sets[1].weightKg", "REQUIRED"),
        ])
    );

    // The squat belongs to no sport: every strength sport, but not running.
    let mut squat_run = strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2));
    squat_run["sportId"] = json!(c.running);
    let reply = post(&app, &token, &squat_run).await;
    assert_eq!(
        errors(&reply),
        pairs(&[("exercises[0].exerciseId", "EXERCISE_NOT_IN_SPORT")])
    );

    let mut unknown_sport = strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2));
    unknown_sport["sportId"] = json!(Uuid::now_v7());
    let reply = post(&app, &token, &unknown_sport).await;
    assert!(errors(&reply).contains(&("sportId".to_owned(), "UNKNOWN_SPORT".to_owned())));

    assert_eq!(rows(&app, user).await, 0);
}

#[sqlx::test]
async fn the_body_is_checked_before_anything_is_stored(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "sami").await;
    let base = strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2));
    let with = |key: &str, value: Value| {
        let mut body = base.clone();
        body[key] = value;
        body
    };
    let many_exercises: Vec<Value> = (0..61).map(|_| base["exercises"][0].clone()).collect();
    let many_sets: Vec<Value> = (0..101)
        .map(|_| json!({"reps": 5, "weightKg": 100}))
        .collect();
    let mut too_many_sets = base.clone();
    too_many_sets["exercises"][0]["sets"] = json!(many_sets);

    for (body, field, code) in [
        (with("durationS", json!(59)), "durationS", "MIN"),
        (with("durationS", json!(86_401)), "durationS", "MAX"),
        (
            with("exercises", json!(many_exercises)),
            "exercises",
            "ARRAYMAXSIZE",
        ),
        (with("exercises", json!([])), "exercises", "ARRAYMINSIZE"),
        (too_many_sets, "exercises[0].sets", "ARRAYMAXSIZE"),
        (
            with("workoutType", json!("strength")),
            "workoutType",
            "MATCHES",
        ),
        (
            with("performedAt", json!("yesterday")),
            "performedAt",
            "ISISO8601",
        ),
        (with("notes", json!("x".repeat(2001))), "notes", "MAXLENGTH"),
        (with("xp", json!(500)), "xp", "UNKNOWN_FIELD"),
        (
            with("visibility", json!("EVERYONE")),
            "visibility",
            "INVALID",
        ),
    ] {
        let reply = post(&app, &token, &body).await;
        assert_eq!(
            reply.status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{field}: {}",
            reply.json
        );
        assert!(
            errors(&reply).contains(&(field.to_owned(), code.to_owned())),
            "{field} {code}: {}",
            reply.json
        );
    }
    let mut set_out_of_range = base.clone();
    set_out_of_range["exercises"][0]["sets"][1] =
        json!({"reps": 1001, "weightKg": 1000.5, "rpe": 11});
    let reply = post(&app, &token, &set_out_of_range).await;
    assert_eq!(
        errors(&reply),
        pairs(&[
            ("exercises[0].sets[1].reps", "MAX"),
            ("exercises[0].sets[1].weightKg", "MAX"),
            ("exercises[0].sets[1].rpe", "MAX"),
        ])
    );
    assert_eq!(rows(&app, user).await, 0);
}

#[sqlx::test]
async fn a_workout_belongs_to_its_owner(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, sami) = athlete(&app, "sami").await;
    let (_, karim) = athlete(&app, "karim").await;
    let reply = post(
        &app,
        &sami,
        &strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2)),
    )
    .await;
    let path = format!("{WORKOUTS}/{}", reply.json["id"].as_str().unwrap());

    let other = get(&app, &karim, &path).await;
    assert_eq!(other.status, StatusCode::NOT_FOUND, "{}", other.json);
    assert_eq!(other.json["code"], "NOT_FOUND");
    let malformed = get(&app, &sami, &format!("{WORKOUTS}/not-a-uuid")).await;
    assert_eq!(
        malformed.status,
        StatusCode::NOT_FOUND,
        "{}",
        malformed.json
    );
}

#[sqlx::test]
async fn posting_is_limited_per_user(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;
    let start = Utc::now() - Duration::hours(65);
    for i in 0..30 {
        let at = start + Duration::hours(2 * i);
        let kg = 60.0 + f64::from(i as i32);
        let reply = post(&app, &token, &lifting(&c, Uuid::now_v7(), at, kg, 5)).await;
        assert_eq!(
            reply.status,
            StatusCode::CREATED,
            "post {i}: {}",
            reply.json
        );
    }
    let reply = post(
        &app,
        &token,
        &strength(&c, Uuid::now_v7(), Utc::now() - Duration::minutes(30)),
    )
    .await;
    assert_eq!(
        reply.status,
        StatusCode::TOO_MANY_REQUESTS,
        "{}",
        reply.json
    );
    assert_eq!(reply.json["code"], "RATE_LIMITED");
    assert!(reply.headers.contains_key(header::RETRY_AFTER));
}

async fn sync(app: &TestApp, token: &str, items: Vec<Value>) -> Reply {
    app.call(
        Method::POST,
        "/api/v1/workouts/sync",
        Some(token),
        Some(json!({ "items": items })),
    )
    .await
}

fn results(reply: &Reply) -> Vec<&str> {
    reply.json["results"]
        .as_array()
        .unwrap_or_else(|| panic!("no results in {}", reply.json))
        .iter()
        .map(|r| r["result"].as_str().unwrap())
        .collect()
}

#[sqlx::test]
async fn a_batch_answers_item_by_item(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;
    let now = Utc::now();
    let sent = strength(&c, Uuid::now_v7(), now - Duration::hours(10));
    let first = post(&app, &token, &sent).await;
    assert_eq!(first.status, StatusCode::CREATED, "{}", first.json);

    let fresh = lifting(&c, Uuid::now_v7(), now - Duration::hours(20), 90.0, 5);
    let mut changed = sent.clone();
    changed["durationS"] = json!(4200);
    let impossible = run(&c, Uuid::now_v7(), 5.0, 10, now - Duration::hours(30));
    let mut unknown = lifting(&c, Uuid::now_v7(), now - Duration::hours(40), 80.0, 5);
    unknown["exercises"][0]["exerciseId"] = json!(Uuid::now_v7());
    let mut short = lifting(&c, Uuid::now_v7(), now - Duration::hours(50), 70.0, 5);
    short["durationS"] = json!(10);
    let items = vec![
        fresh.clone(),
        sent.clone(),
        changed,
        impossible,
        unknown.clone(),
        short.clone(),
    ];

    let reply = sync(&app, &token, items).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    assert_eq!(
        results(&reply),
        [
            "CREATED", "REPLAYED", "CONFLICT", "REJECTED", "INVALID", "INVALID"
        ]
    );
    let r = &reply.json["results"];
    assert_eq!(r[0]["clientId"], fresh["clientId"]);
    assert_eq!(r[0]["workout"]["status"], "ACCEPTED");
    assert_eq!(r[1]["workout"]["id"], first.json["id"]);
    assert_eq!(r[2]["error"]["code"], "IDEMPOTENCY_CONFLICT");
    assert_eq!(r[2]["error"]["workout"]["id"], first.json["id"]);
    assert_eq!(r[3]["workout"]["status"], "REJECTED");
    assert_eq!(r[4]["clientId"], unknown["clientId"]);
    assert_eq!(r[4]["error"]["code"], "VALIDATION_FAILED");
    assert_eq!(r[4]["error"]["errors"][0]["code"], "UNKNOWN_EXERCISE");
    assert_eq!(r[5]["clientId"], short["clientId"]);
    assert_eq!(
        r[5]["error"]["errors"][0],
        json!({"field": "durationS", "code": "MIN"})
    );
}

#[sqlx::test]
async fn a_batch_holds_one_to_fifty_items(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token) = athlete(&app, "sami").await;
    for (items, code) in [
        (Vec::new(), "ARRAYMINSIZE"),
        (vec![json!({}); 51], "ARRAYMAXSIZE"),
    ] {
        let reply = sync(&app, &token, items).await;
        assert_eq!(
            reply.status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{}",
            reply.json
        );
        assert_eq!(errors(&reply), pairs(&[("items", code)]));
    }
}

#[sqlx::test]
async fn an_item_without_a_usable_client_id_is_invalid(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;
    let now = Utc::now();
    let mut garbled = strength(&c, Uuid::now_v7(), now - Duration::hours(10));
    garbled["clientId"] = json!("abc");
    let mut missing = strength(&c, Uuid::now_v7(), now - Duration::hours(20));
    missing.as_object_mut().unwrap().remove("clientId");
    let good = strength(&c, Uuid::now_v7(), now - Duration::hours(30));

    let reply = sync(
        &app,
        &token,
        vec![garbled, missing, good, json!("not an object")],
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    assert_eq!(
        results(&reply),
        ["INVALID", "INVALID", "CREATED", "INVALID"]
    );
    let r = &reply.json["results"];
    assert_eq!(r[0]["clientId"], "abc");
    assert_eq!(
        r[0]["error"]["errors"][0],
        json!({"field": "clientId", "code": "INVALID"})
    );
    assert_eq!(r[1]["clientId"], Value::Null);
    assert_eq!(
        r[1]["error"]["errors"][0],
        json!({"field": "clientId", "code": "REQUIRED"})
    );
    assert_eq!(r[3]["clientId"], Value::Null);
}

#[sqlx::test]
async fn syncing_is_limited_per_user(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;
    let item = strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2));
    for i in 0..10 {
        let reply = sync(&app, &token, vec![item.clone()]).await;
        assert_eq!(reply.status, StatusCode::OK, "batch {i}: {}", reply.json);
    }
    let reply = sync(&app, &token, vec![item]).await;
    assert_eq!(
        reply.status,
        StatusCode::TOO_MANY_REQUESTS,
        "{}",
        reply.json
    );
}

fn ids(reply: &Reply) -> Vec<String> {
    reply.json["data"]
        .as_array()
        .unwrap_or_else(|| panic!("no data in {}", reply.json))
        .iter()
        .map(|w| w["id"].as_str().unwrap().to_owned())
        .collect()
}

fn id(reply: &Reply) -> String {
    reply.json["id"].as_str().unwrap().to_owned()
}

#[sqlx::test]
async fn the_list_pages_newest_first(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;
    let now = Utc::now();
    let w1 = id(&post(
        &app,
        &token,
        &lifting(&c, Uuid::now_v7(), now - Duration::hours(40), 80.0, 5),
    )
    .await);
    let w2 = id(&post(
        &app,
        &token,
        &lifting(&c, Uuid::now_v7(), now - Duration::hours(20), 85.0, 5),
    )
    .await);
    let w3 = id(&post(
        &app,
        &token,
        &lifting(&c, Uuid::now_v7(), now - Duration::hours(10), 90.0, 5),
    )
    .await);

    let first = get(&app, &token, &format!("{WORKOUTS}?limit=2")).await;
    assert_eq!(first.status, StatusCode::OK, "{}", first.json);
    assert_eq!(ids(&first), [w3.clone(), w2.clone()]);
    assert_eq!(first.json["page"]["hasMore"], true);
    let cursor = first.json["page"]["nextCursor"]
        .as_str()
        .unwrap()
        .to_owned();

    // Logged after the first page was read, older than its last row: it shows on the next page.
    let w4 = id(&post(
        &app,
        &token,
        &lifting(&c, Uuid::now_v7(), now - Duration::hours(30), 95.0, 5),
    )
    .await);
    let second = get(&app, &token, &format!("{WORKOUTS}?limit=2&cursor={cursor}")).await;
    assert_eq!(second.status, StatusCode::OK, "{}", second.json);
    assert_eq!(ids(&second), [w4, w1]);
    assert_eq!(
        second.json["page"],
        json!({"hasMore": false, "nextCursor": null})
    );

    let all = get(&app, &token, WORKOUTS).await;
    assert_eq!(ids(&all).len(), 4);
}

#[sqlx::test]
async fn the_list_filters(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;
    let now = Utc::now();
    let w1 = id(&post(
        &app,
        &token,
        &strength(&c, Uuid::now_v7(), now - Duration::hours(40)),
    )
    .await);
    let w2 = id(&post(
        &app,
        &token,
        &run(&c, Uuid::now_v7(), 5.0, 30, now - Duration::hours(20)),
    )
    .await);
    let w3 = id(&post(
        &app,
        &token,
        &lifting(&c, Uuid::now_v7(), now - Duration::hours(10), 90.0, 5),
    )
    .await);
    let at = |hours| rfc(now - Duration::hours(hours));

    let since = get(&app, &token, &format!("{WORKOUTS}?from={}", at(30))).await;
    assert_eq!(ids(&since), [w3.clone(), w2.clone()]);
    let until = get(&app, &token, &format!("{WORKOUTS}?to={}", at(15))).await;
    assert_eq!(ids(&until), [w2.clone(), w1.clone()]);
    // `to` is excluded.
    let exact = get(&app, &token, &format!("{WORKOUTS}?to={}", at(40))).await;
    assert_eq!(ids(&exact), Vec::<String>::new());
    let runs = get(&app, &token, &format!("{WORKOUTS}?sportId={}", c.running)).await;
    assert_eq!(ids(&runs), [w2]);

    for (query, field, code) in [
        ("cursor=abc", "cursor", "INVALID_CURSOR"),
        ("from=yesterday", "from", "ISISO8601"),
        ("to=x", "to", "ISISO8601"),
        ("sportId=x", "sportId", "ISUUID"),
        ("limit=0", "limit", "MIN"),
        ("limit=101", "limit", "MAX"),
    ] {
        let reply = get(&app, &token, &format!("{WORKOUTS}?{query}")).await;
        assert_eq!(
            reply.status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{query}: {}",
            reply.json
        );
        assert_eq!(errors(&reply), pairs(&[(field, code)]), "{query}");
    }
}

#[sqlx::test]
async fn the_list_shows_only_mine(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, sami) = athlete(&app, "sami").await;
    let (_, karim) = athlete(&app, "karim").await;
    let mine = id(&post(
        &app,
        &sami,
        &strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2)),
    )
    .await);
    post(
        &app,
        &karim,
        &strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2)),
    )
    .await;
    assert_eq!(ids(&get(&app, &sami, WORKOUTS).await), [mine]);
}

#[sqlx::test]
async fn workouts_have_the_shape_recorded_from_the_old_api(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "sami").await;
    let saved = post(
        &app,
        &token,
        &strength(&c, Uuid::now_v7(), Utc::now() - Duration::hours(2)),
    )
    .await;
    let recorded: Value = serde_json::from_str(
        &std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../mobile-rn/assets/demo/api.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let detail_key = recorded
        .as_object()
        .unwrap()
        .keys()
        .find(|k| k.starts_with("GET /workouts/") && !k.ends_with("/points"))
        .unwrap()
        .clone();
    common::assert_same_shape(
        "GET /workouts",
        &recorded["GET /workouts"],
        &get(&app, &token, WORKOUTS).await.json,
    );
    common::assert_same_shape(
        &detail_key,
        &recorded[&detail_key],
        &get(&app, &token, &format!("{WORKOUTS}/{}", id(&saved)))
            .await
            .json,
    );
}
