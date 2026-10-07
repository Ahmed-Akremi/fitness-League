#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use std::path::{Path, PathBuf};

use axum::http::StatusCode;
use common::{Reply, TestApp};
use serde_json::{Value, json};
use sqlx::{
    AssertSqlSafe,
    mysql::{MySqlConnectOptions, MySqlPoolOptions},
};

fn seed_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../infra/seed-data")
}

async fn seeded(opts: MySqlPoolOptions, conn: MySqlConnectOptions) -> TestApp {
    let app = TestApp::new(opts, conn).await;
    backend::seed::run(&app.db, &seed_dir()).await.unwrap();
    app
}

fn items(reply: &Reply) -> &Vec<Value> {
    reply
        .json
        .as_array()
        .unwrap_or_else(|| panic!("expected a list, got {} {}", reply.status, reply.json))
}

fn by_code<'a>(list: &'a [Value], code: &str) -> &'a Value {
    list.iter()
        .find(|v| v["code"] == code)
        .unwrap_or_else(|| panic!("{code} not in the list"))
}

async fn id_of(app: &TestApp, path: &str, code: &str) -> String {
    by_code(items(&app.get(path).await), code)["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

async fn count(app: &TestApp, table: &str) -> i64 {
    sqlx::query_scalar(AssertSqlSafe(format!("SELECT COUNT(*) FROM {table}")))
        .fetch_one(&app.db)
        .await
        .unwrap()
}

/// Every key of `expected` exists in `actual` with the same JSON type. `null` on either side matches
/// anything; lists are compared by their first element.
fn assert_same_shape(path: &str, expected: &Value, actual: &Value) {
    match (expected, actual) {
        (Value::Null, _) | (_, Value::Null) => {}
        (Value::Object(e), Value::Object(a)) => {
            for (key, value) in e {
                let got = a
                    .get(key)
                    .unwrap_or_else(|| panic!("{path}.{key} is missing"));
                assert_same_shape(&format!("{path}.{key}"), value, got);
            }
        }
        (Value::Array(e), Value::Array(a)) => {
            if let (Some(first_expected), Some(first_actual)) = (e.first(), a.first()) {
                assert_same_shape(&format!("{path}[0]"), first_expected, first_actual);
            }
        }
        (e, a) => assert_eq!(
            std::mem::discriminant(e),
            std::mem::discriminant(a),
            "{path}: recorded {e}, answered {a}"
        ),
    }
}

#[sqlx::test]
async fn the_seed_can_run_twice_without_duplicates(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = TestApp::new(opts, conn).await;
    let first = backend::seed::run(&app.db, &seed_dir()).await.unwrap();
    let second = backend::seed::run(&app.db, &seed_dir()).await.unwrap();
    assert_eq!(first, second);
    assert_eq!(
        (
            first.governorates,
            first.cities,
            first.sports,
            first.metric_types,
            first.exercises
        ),
        (24, 92, 10, 13, 47)
    );

    for (table, rows) in [
        ("countries", 1),
        ("governorates", 24),
        ("cities", 92),
        ("sports", 10),
        ("metric_types", 13),
        ("exercises", 47),
        ("rule_sets", 1),
    ] {
        assert_eq!(count(&app, table).await, rows, "{table}");
    }
    let (version, status): (i32, String) = sqlx::query_as("SELECT version, status FROM rule_sets")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!((version, status.as_str()), (2, "ACTIVE"));
}

#[sqlx::test]
async fn running_the_seed_again_repairs_a_damaged_catalog(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    // As after a seed that stopped half-way, or a manual edit.
    sqlx::query("UPDATE sports SET name_fr = 'cassé' WHERE code = 'RUNNING'")
        .execute(&app.db)
        .await
        .unwrap();
    sqlx::query("DELETE FROM exercise_metrics")
        .execute(&app.db)
        .await
        .unwrap();
    sqlx::query("DELETE FROM cities WHERE code LIKE 'TN-11-%'")
        .execute(&app.db)
        .await
        .unwrap();

    backend::seed::run(&app.db, &seed_dir()).await.unwrap();

    let sports = app.get("/api/v1/ref/sports").await;
    assert_eq!(
        by_code(items(&sports), "RUNNING")["name"]["fr"],
        "Course à pied"
    );
    assert_eq!(count(&app, "cities").await, 92);
    let exercises = app.get("/api/v1/ref/exercises").await;
    assert_eq!(
        by_code(items(&exercises), "BACK_SQUAT")["trackedMetrics"],
        json!(["MAX_WEIGHT", "E1RM", "REPS_AT_WEIGHT"])
    );
}

#[sqlx::test]
async fn governorates_are_listed_in_code_order_and_cacheable(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let r = app.get("/api/v1/ref/governorates").await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.headers["cache-control"], "public, max-age=3600");

    let list = items(&r);
    assert_eq!(list.len(), 24);
    let codes: Vec<&str> = list.iter().map(|g| g["code"].as_str().unwrap()).collect();
    assert!(codes.windows(2).all(|pair| pair[0] < pair[1]), "{codes:?}");
    let tunis = &list[0];
    assert_eq!(tunis["code"], "TN-11");
    assert_eq!(tunis["countryCode"], "TN");
    assert_eq!(
        tunis["name"],
        json!({"fr": "Tunis", "en": "Tunis", "ar": "تونس"})
    );
    assert_eq!(
        tunis["id"].as_str().unwrap().len(),
        36,
        "ids are hyphenated UUID strings"
    );
}

#[sqlx::test]
async fn cities_belong_to_the_governorate_asked_for(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let tunis = id_of(&app, "/api/v1/ref/governorates", "TN-11").await;

    let r = app
        .get(&format!("/api/v1/ref/cities?governorateId={tunis}"))
        .await;
    let codes: Vec<&str> = items(&r)
        .iter()
        .map(|c| c["code"].as_str().unwrap())
        .collect();
    assert_eq!(
        codes,
        [
            "TN-11-carthage",
            "TN-11-la-goulette",
            "TN-11-la-marsa",
            "TN-11-le-bardo",
            "TN-11-tunis"
        ]
    );
    assert!(
        items(&r)
            .iter()
            .all(|c| c["governorateId"] == tunis.as_str())
    );
    assert_eq!(
        by_code(items(&r), "TN-11-la-marsa")["name"],
        json!({"fr": "La Marsa", "en": "La Marsa", "ar": "المرسى"})
    );

    // A well-formed id that matches nothing is an empty list, not an error.
    let unknown = app
        .get("/api/v1/ref/cities?governorateId=018f0000-0000-7000-8000-000000000000")
        .await;
    assert_eq!((unknown.status, unknown.json), (StatusCode::OK, json!([])));
}

#[sqlx::test]
async fn a_missing_or_hostile_id_is_a_validation_error(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let invalid = json!([{"field": "governorateId", "code": "ISUUID"}]);
    for path in [
        "/api/v1/ref/cities",
        "/api/v1/ref/cities?governorateId=",
        "/api/v1/ref/cities?governorateId=42",
        // ' OR 1=1 --
        "/api/v1/ref/cities?governorateId=%27%20OR%201%3D1%20--",
    ] {
        let r = app.get(path).await;
        assert_eq!(
            (r.status, &r.json["errors"]),
            (StatusCode::UNPROCESSABLE_ENTITY, &invalid),
            "{path}"
        );
    }
    let r = app
        .get("/api/v1/ref/exercises?sportId=%27%3B%20DROP%20TABLE%20users%3B%20--")
        .await;
    assert_eq!(
        r.json["errors"],
        json!([{"field": "sportId", "code": "ISUUID"}])
    );
    assert_eq!(
        count(&app, "users").await,
        0,
        "and the table is still there"
    );
}

#[sqlx::test]
async fn only_enabled_sports_are_listed(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let r = app.get("/api/v1/ref/sports").await;
    assert_eq!(items(&r).len(), 10);
    let mut keys: Vec<&str> = by_code(items(&r), "BODYBUILDING")
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        ["category", "code", "icon", "id", "loggingMode", "name"]
    );
    assert_eq!(by_code(items(&r), "BODYBUILDING")["category"], "STRENGTH");

    sqlx::query("UPDATE sports SET enabled = FALSE WHERE code = 'WALKING'")
        .execute(&app.db)
        .await
        .unwrap();
    let after = app.get("/api/v1/ref/sports").await;
    assert_eq!(items(&after).len(), 9);
    assert!(items(&after).iter().all(|s| s["code"] != "WALKING"));
}

#[sqlx::test]
async fn exercises_follow_the_sport_and_the_delta_rules(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let bodybuilding = id_of(&app, "/api/v1/ref/sports", "BODYBUILDING").await;
    let running = id_of(&app, "/api/v1/ref/sports", "RUNNING").await;

    let all = app.get("/api/v1/ref/exercises").await;
    assert_eq!(items(&all).len(), 47);
    assert_eq!(all.headers["cache-control"], "public, max-age=600");

    // A strength sport also gets the shared exercises (those with no sport), in the order of their metrics.
    let strength = app
        .get(&format!("/api/v1/ref/exercises?sportId={bodybuilding}"))
        .await;
    let squat = by_code(items(&strength), "BACK_SQUAT");
    assert_eq!(squat["sportId"], Value::Null);
    assert_eq!(
        squat["trackedMetrics"],
        json!(["MAX_WEIGHT", "E1RM", "REPS_AT_WEIGHT"])
    );
    assert_eq!(squat["isBodyweight"], false);
    assert_eq!(squat["enabled"], true);
    assert!(squat["updatedAt"].as_str().unwrap().ends_with('Z'));

    // A cardio sport does not: a squat makes no sense for a swimmer.
    let cardio = app
        .get(&format!("/api/v1/ref/exercises?sportId={running}"))
        .await;
    assert!(!items(&cardio).is_empty());
    assert!(
        items(&cardio)
            .iter()
            .all(|e| e["sportId"] == running.as_str()),
        "{}",
        cardio.json
    );

    // Descriptions carry the languages that exist; none gives an empty object.
    assert_eq!(squat["description"], json!({}));
    let described = items(&all)
        .iter()
        .find(|e| e["description"] != json!({}))
        .unwrap();
    assert_eq!(described["description"].as_object().unwrap().len(), 3);

    let missing = app
        .get("/api/v1/ref/exercises?sportId=018f0000-0000-7000-8000-000000000000")
        .await;
    assert_eq!(
        (missing.status, missing.json["code"].as_str()),
        (StatusCode::NOT_FOUND, Some("NOT_FOUND"))
    );

    // A disabled exercise disappears from the catalog, but a delta sync still sees it, to remove it locally.
    sqlx::query("UPDATE exercises SET enabled = FALSE WHERE code = 'BACK_SQUAT'")
        .execute(&app.db)
        .await
        .unwrap();
    assert_eq!(items(&app.get("/api/v1/ref/exercises").await).len(), 46);
    let delta = app
        .get("/api/v1/ref/exercises?updatedSince=2000-01-01T00:00:00Z")
        .await;
    assert_eq!(by_code(items(&delta), "BACK_SQUAT")["enabled"], false);
    assert_eq!(
        app.get("/api/v1/ref/exercises?updatedSince=2999-01-01T00:00:00Z")
            .await
            .json,
        json!([])
    );
    let bad = app
        .get("/api/v1/ref/exercises?updatedSince=yesterday")
        .await;
    assert_eq!(
        bad.json["errors"],
        json!([{"field": "updatedSince", "code": "ISISO8601"}])
    );
}

/// The contract: what the mobile app recorded from the old API is what the new one answers.
#[sqlx::test]
async fn answers_have_the_shape_the_mobile_app_recorded(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let file = Path::new(env!("CARGO_MANIFEST_DIR")).join("../mobile-rn/assets/demo/api.json");
    let demo: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    let recorded = |prefix: &str| {
        demo.as_object()
            .unwrap()
            .iter()
            .find(|(route, _)| route.starts_with(prefix))
            .map(|(_, answer)| answer.clone())
            .unwrap_or_else(|| panic!("{prefix} not recorded"))
    };

    let tunis = id_of(&app, "/api/v1/ref/governorates", "TN-11").await;
    let bodybuilding = id_of(&app, "/api/v1/ref/sports", "BODYBUILDING").await;
    for (recorded_route, path) in [
        (
            "GET /ref/governorates",
            "/api/v1/ref/governorates".to_owned(),
        ),
        (
            "GET /ref/cities?",
            format!("/api/v1/ref/cities?governorateId={tunis}"),
        ),
        ("GET /ref/sports", "/api/v1/ref/sports".to_owned()),
        (
            "GET /ref/exercises?",
            format!("/api/v1/ref/exercises?sportId={bodybuilding}"),
        ),
    ] {
        let answer = app.get(&path).await;
        assert!(!items(&answer).is_empty(), "{path}");
        assert_same_shape(recorded_route, &recorded(recorded_route), &answer.json);
    }
}
