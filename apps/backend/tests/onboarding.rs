#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode};
use chrono::{DateTime, Duration, Utc};
use common::{Reply, TestApp, register, seeded};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

async fn post(app: &TestApp, session: &Value, step: &str, body: Option<Value>) -> Reply {
    app.call(
        Method::POST,
        &format!("/api/v1/me/onboarding/{step}"),
        session["accessToken"].as_str(),
        body,
    )
    .await
}

async fn id_of(app: &TestApp, table: &str, code: &str) -> Uuid {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT id FROM {table} WHERE code = ?"
    )))
    .bind(code)
    .fetch_one(&app.db)
    .await
    .unwrap()
}

async fn sports(app: &TestApp, n: usize) -> Vec<Uuid> {
    sqlx::query_scalar("SELECT id FROM sports WHERE enabled ORDER BY code LIMIT ?")
        .bind(n as i64)
        .fetch_all(&app.db)
        .await
        .unwrap()
}

#[sqlx::test]
async fn onboarding_as_the_app_does_it(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let ids = sports(&app, 2).await;

    let reply = post(
        &app,
        &session,
        "sports",
        Some(json!({"sportIds": ids, "primarySportId": ids[1]})),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    assert_eq!(
        reply.json,
        json!({"steps": {"sports": true, "baselines": false, "goals": false, "gym": false},
               "completed": false, "calibrationEndsAt": null})
    );

    let squat = id_of(&app, "exercises", "BACK_SQUAT").await;
    let run = id_of(&app, "exercises", "RUN").await;
    let reply = post(
        &app,
        &session,
        "baselines",
        Some(json!({"entries": [
            {"exerciseId": squat, "metricCode": "E1RM", "value": 100},
            // 22.37 minutes, as the app sends it: times 60, with the float's noise.
            {"exerciseId": run, "metricCode": "TIME_5K", "value": 1342.1999999999998_f64}
        ]})),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    assert_eq!(reply.json["steps"]["baselines"], true);
    let stored: Vec<(String, String)> = sqlx::query_as(
        "SELECT CAST(declared_value AS CHAR), status FROM baselines ORDER BY declared_value",
    )
    .fetch_all(&app.db)
    .await
    .unwrap();
    assert_eq!(
        stored,
        [
            ("100.000".to_owned(), "PROVISIONAL".to_owned()),
            ("1342.200".to_owned(), "PROVISIONAL".to_owned())
        ]
    );

    let reply = post(&app, &session, "complete", None).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    assert_eq!(reply.json["completed"], true);
    let ends: DateTime<Utc> = reply.json["calibrationEndsAt"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    // 14 days in the seeded rule set.
    assert!(
        (ends - (Utc::now() + Duration::days(14)))
            .num_seconds()
            .abs()
            < 60
    );

    // Once more: the first dates stay.
    let again = post(&app, &session, "complete", None).await;
    assert_eq!(
        again.json["calibrationEndsAt"],
        reply.json["calibrationEndsAt"]
    );

    // `GET /me` sees it all; the primary sport first.
    let me = app
        .call(
            Method::GET,
            "/api/v1/me",
            session["accessToken"].as_str(),
            None,
        )
        .await
        .json;
    assert_eq!(me["profile"]["onboardingCompleted"], true);
    assert_eq!(me["profile"]["sports"][0]["id"], ids[1].to_string());
    assert_eq!(me["profile"]["sports"][0]["isPrimary"], true);
    assert_eq!(me["profile"]["sports"][1]["isPrimary"], false);
}

#[sqlx::test]
async fn onboarding_cannot_end_without_a_sport(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let reply = post(&app, &session, "complete", None).await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(reply.json["code"], "PRECONDITION_FAILED");
    assert_eq!(reply.json["missingStep"], "sports");
    let completed: Option<chrono::NaiveDateTime> =
        sqlx::query_scalar("SELECT onboarding_completed_at FROM profiles")
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(completed, None);
}

#[sqlx::test]
async fn the_list_of_sports_is_replaced_whole_or_not_at_all(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let ids = sports(&app, 3).await;
    let set =
        |list: Vec<Uuid>, primary: Uuid| Some(json!({"sportIds": list, "primarySportId": primary}));

    post(&app, &session, "sports", set(ids[..2].to_vec(), ids[0])).await;
    // A new list replaces the old one.
    post(&app, &session, "sports", set(vec![ids[2]], ids[2])).await;
    let held: Vec<Uuid> = sqlx::query_scalar("SELECT sport_id FROM user_sports")
        .fetch_all(&app.db)
        .await
        .unwrap();
    assert_eq!(held, [ids[2]]);

    let unknown = Uuid::now_v7();
    let many: Vec<Uuid> = (0..10).map(|_| Uuid::now_v7()).collect();
    for (body, errors) in [
        (
            set(vec![ids[0], unknown], ids[0]),
            json!([{"field": "sportIds", "code": "UNKNOWN_SPORT"}]),
        ),
        (
            set(vec![ids[0]], ids[1]),
            json!([{"field": "primarySportId", "code": "NOT_IN_SPORT_IDS"}]),
        ),
        (
            set(vec![ids[0], ids[0]], ids[0]),
            json!([{"field": "sportIds", "code": "ARRAYUNIQUE"}]),
        ),
        (
            set(many.clone(), many[0]),
            json!([{"field": "sportIds", "code": "ARRAYMAXSIZE"}]),
        ),
        (
            set(vec![], ids[0]),
            json!([{"field": "sportIds", "code": "ARRAYMINSIZE"},
                   {"field": "primarySportId", "code": "NOT_IN_SPORT_IDS"}]),
        ),
        (
            Some(json!({"sportIds": ["running"], "primarySportId": ids[0]})),
            json!([{"field": "sportIds[0]", "code": "INVALID"}]),
        ),
    ] {
        let reply = post(&app, &session, "sports", body.clone()).await;
        assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY, "{body:?}");
        assert_eq!(reply.json["errors"], errors, "{body:?}");
    }
    // None of the refused lists touched the one held.
    let held: Vec<Uuid> = sqlx::query_scalar("SELECT sport_id FROM user_sports")
        .fetch_all(&app.db)
        .await
        .unwrap();
    assert_eq!(held, [ids[2]]);
}

#[sqlx::test]
async fn declared_values_name_a_real_exercise_and_metric(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let squat = id_of(&app, "exercises", "BACK_SQUAT").await;

    let reply = post(
        &app,
        &session,
        "baselines",
        Some(json!({"entries": [
            {"exerciseId": squat, "metricCode": "E1RM", "value": 100},
            {"exerciseId": Uuid::now_v7(), "metricCode": "E1RM", "value": 100},
            {"exerciseId": squat, "metricCode": "TIME_5K", "value": 100},
        ]})),
    )
    .await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    // Every wrong entry at once, and nothing written for the right one.
    assert_eq!(
        reply.json["errors"],
        json!([{"field": "entries[1].exerciseId", "code": "UNKNOWN_EXERCISE"},
               {"field": "entries[2].metricCode", "code": "METRIC_NOT_TRACKED"}])
    );

    let reply = post(
        &app,
        &session,
        "baselines",
        Some(json!({"entries": [
            {"exerciseId": squat, "metricCode": "e1rm", "value": 0},
            {"exerciseId": squat, "metricCode": "E1RM", "value": 1_000_001},
        ]})),
    )
    .await;
    assert_eq!(
        reply.json["errors"],
        json!([{"field": "entries[0].metricCode", "code": "MATCHES"},
               {"field": "entries[0].value", "code": "ISPOSITIVE"},
               {"field": "entries[1].value", "code": "MAX"}])
    );
    let entries: Vec<Value> = (0..31)
        .map(|_| json!({"exerciseId": squat, "metricCode": "E1RM", "value": 1}))
        .collect();
    let reply = post(
        &app,
        &session,
        "baselines",
        Some(json!({"entries": entries})),
    )
    .await;
    assert_eq!(
        reply.json["errors"],
        json!([{"field": "entries", "code": "ARRAYMAXSIZE"}])
    );
    let written: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM baselines")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(written, 0);
}

#[sqlx::test]
async fn a_declaration_does_not_change_a_baseline_that_calibration_fixed(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let squat = id_of(&app, "exercises", "BACK_SQUAT").await;
    let declare = |value: i64| {
        Some(json!({"entries": [{"exerciseId": squat, "metricCode": "E1RM", "value": value}]}))
    };

    post(&app, &session, "baselines", declare(100)).await;
    // A provisional value follows the latest declaration.
    post(&app, &session, "baselines", declare(110)).await;
    let value = || async {
        sqlx::query_scalar::<_, String>("SELECT CAST(effective_value AS CHAR) FROM baselines")
            .fetch_one(&app.db)
            .await
            .unwrap()
    };
    assert_eq!(value().await, "110.000");

    sqlx::query("UPDATE baselines SET status = 'FINAL', effective_value = 120")
        .execute(&app.db)
        .await
        .unwrap();
    let reply = post(&app, &session, "baselines", declare(90)).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(value().await, "120.000");
}

#[sqlx::test]
async fn the_goals_step_follows_the_first_goal(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "goalie").await;
    // An empty declaration changes nothing and answers the progress.
    let steps = |reply: Reply| reply.json["steps"]["goals"].clone();
    let before = post(&app, &session, "baselines", Some(json!({"entries": []}))).await;
    assert_eq!(steps(before), false);
    let goal = app
        .call(
            Method::POST,
            "/api/v1/goals",
            session["accessToken"].as_str(),
            Some(json!({"type": "HABIT", "metricCode": "WORKOUTS_PER_WEEK", "targetValue": 3})),
        )
        .await;
    assert_eq!(goal.status, StatusCode::CREATED, "{}", goal.json);
    let after = post(&app, &session, "baselines", Some(json!({"entries": []}))).await;
    assert_eq!(steps(after), true);
}
