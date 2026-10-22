#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Badges as the app reads them, and what awards them.
mod common;

use axum::http::{Method, StatusCode};
use chrono::{Duration, Utc};
use common::{TestApp, seeded, set_consent, workouts::*};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const CATEGORIES: [&str; 6] = [
    "PROGRESS",
    "CONSISTENCY",
    "COMPETITION",
    "SOCIAL",
    "GYM",
    "ELITE",
];

async fn badges(app: &TestApp, token: &str) -> Vec<Value> {
    let reply = get(app, token, "/api/v1/badges").await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    reply.json.as_array().unwrap().clone()
}

fn badge<'a>(all: &'a [Value], code: &str) -> &'a Value {
    all.iter()
        .find(|b| b["code"] == code)
        .unwrap_or_else(|| panic!("no {code}"))
}

async fn logged(app: &TestApp, token: &str, body: &Value) -> Value {
    let reply = post(app, token, body).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    reply.json
}

fn ago(hours: i64) -> chrono::DateTime<Utc> {
    Utc::now() - Duration::hours(hours)
}

async fn awards(app: &TestApp, user: Uuid, code: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ? AND b.code = ?",
    )
    .bind(user)
    .bind(code)
    .fetch_one(&app.db)
    .await
    .unwrap()
}

#[sqlx::test]
async fn the_catalogue_shows_progress(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token) = athlete(&app, "newbie").await;
    let all = badges(&app, &token).await;
    assert_eq!(all.len(), 22);
    let ranks: Vec<usize> = all
        .iter()
        .map(|b| CATEGORIES.iter().position(|c| b["category"] == *c).unwrap())
        .collect();
    assert!(ranks.windows(2).all(|w| w[0] <= w[1]), "{ranks:?}");
    assert_eq!((ranks[0], ranks[21]), (0, 5));
    let first = badge(&all, "FIRST_STEP");
    assert!(first["awardedAt"].is_null());
    assert_eq!(
        first["progress"],
        json!({"current": 0, "target": 1, "met": false})
    );
    assert_eq!(first["name"]["fr"], "Premier pas");
    assert!(first["description"]["ar"].is_string());
    assert_eq!(first["icon"], "first-step");
    assert_eq!(first["rarity"], "COMMON");
    assert_eq!(
        badge(&all, "GOLD_DIVISION")["progress"],
        json!({"current": 0, "target": 3, "met": false})
    );
}

#[sqlx::test]
async fn a_first_workout_earns_first_step(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "first").await;
    let workout = logged(&app, &token, &strength(&c, Uuid::now_v7(), ago(2))).await;
    let all = badges(&app, &token).await;
    let first = badge(&all, "FIRST_STEP");
    assert!(first["awardedAt"].is_string(), "{first}");
    assert_eq!(
        first["progress"],
        json!({"current": 1, "target": 1, "met": true})
    );
    assert_eq!(
        badge(&all, "TEN_WORKOUTS")["progress"],
        json!({"current": 1, "target": 10, "met": false})
    );
    // A record made during calibration is not an awarded one.
    assert!(badge(&all, "FIRST_PR")["awardedAt"].is_null());
    let source: Option<String> = sqlx::query_scalar(
        "SELECT ub.source_ref FROM user_badges ub JOIN badges b ON b.id = ub.badge_id \
         WHERE ub.user_id = ? AND b.code = 'FIRST_STEP'",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(source.as_deref(), workout["id"].as_str());
    assert_eq!(badge_notes(&app, user, "FIRST_STEP").await.len(), 1);
}

/// The `BADGE_AWARDED` payloads `user` received for `code`.
async fn badge_notes(app: &TestApp, user: Uuid, code: &str) -> Vec<Value> {
    let payloads: Vec<String> = sqlx::query_scalar(
        "SELECT payload FROM notifications WHERE user_id = ? AND type = 'BADGE_AWARDED'",
    )
    .bind(user)
    .fetch_all(&app.db)
    .await
    .unwrap();
    payloads
        .iter()
        .map(|p| serde_json::from_str::<Value>(p).unwrap())
        .filter(|p| p["badge"] == code)
        .collect()
}

#[sqlx::test]
async fn a_friend_badge_and_its_notification(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (a, token) = athlete(&app, "amine").await;
    let (b, _) = athlete(&app, "bilel").await;
    let (low, high) = if a < b { (a, b) } else { (b, a) };
    sqlx::query(
        "INSERT INTO friendships (user_low_id, user_high_id, status, requested_by, accepted_at)          VALUES (?, ?, 'ACCEPTED', ?, UTC_TIMESTAMP(6))",
    )
    .bind(low)
    .bind(high)
    .bind(a)
    .execute(&app.db)
    .await
    .unwrap();
    backend::modules::league::jobs::run_due(&app.state, Utc::now())
        .await
        .unwrap();
    for user in [a, b] {
        assert_eq!(awards(&app, user, "FIRST_FRIEND").await, 1);
        let notes = badge_notes(&app, user, "FIRST_FRIEND").await;
        assert_eq!(notes.len(), 1, "{notes:?}");
        let name = &notes[0]["name"];
        assert!(
            ["fr", "en", "ar"].iter().all(|l| name[l].is_string()),
            "{name}"
        );
    }
    assert_eq!(
        badge(&badges(&app, &token).await, "FIRST_FRIEND")["progress"],
        json!({"current": 1, "target": 1, "met": true})
    );
}

#[sqlx::test]
async fn a_gym_badge_and_its_notification(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (owner, _) = athlete(&app, "owner").await;
    let gym = common::a_gym(&app, owner, "Sahel Iron").await;
    let (member, token) = athlete(&app, "member").await;
    assert!(badge(&badges(&app, &token).await, "GYM_MEMBER")["awardedAt"].is_null());
    common::member_of(&app, member, gym).await;
    backend::modules::league::jobs::run_due(&app.state, Utc::now())
        .await
        .unwrap();
    for user in [owner, member] {
        assert_eq!(awards(&app, user, "GYM_MEMBER").await, 1);
        assert_eq!(badge_notes(&app, user, "GYM_MEMBER").await.len(), 1);
    }
    assert_eq!(
        badge(&badges(&app, &token).await, "GYM_MEMBER")["progress"],
        json!({"current": 1, "target": 1, "met": true})
    );
}

#[sqlx::test]
async fn completing_a_goal_earns_goal_getter(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "getter").await;
    logged(&app, &token, &strength(&c, Uuid::now_v7(), ago(48))).await;
    let goal = app
        .call(
            Method::POST,
            "/api/v1/goals",
            Some(&token),
            Some(json!({"type": "STRENGTH", "exerciseId": c.squat, "metricCode": "E1RM", "targetValue": 125})),
        )
        .await;
    assert_eq!(goal.status, StatusCode::CREATED, "{}", goal.json);
    let before = badges(&app, &token).await;
    assert!(badge(&before, "GOAL_GETTER")["awardedAt"].is_null());
    // E1RM 128.33 passes every milestone at once.
    logged(&app, &token, &lifting(&c, Uuid::now_v7(), ago(2), 110.0, 5)).await;
    let after = badges(&app, &token).await;
    assert!(badge(&after, "GOAL_GETTER")["awardedAt"].is_string());
}

#[sqlx::test]
async fn a_weigh_in_can_award_a_badge(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, token) = athlete(&app, "scale").await;
    set_consent(&app, user, "HEALTH_DATA", true).await;
    let weigh = |kg: f64| {
        let token = token.clone();
        let app = &app;
        async move {
            let path = "/api/v1/me/body-measurements";
            let reply = app
                .call(
                    Method::POST,
                    path,
                    Some(&token),
                    Some(json!({"weightKg": kg})),
                )
                .await;
            assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
        }
    };
    weigh(80.0).await;
    let goal = app
        .call(
            Method::POST,
            "/api/v1/goals",
            Some(&token),
            Some(json!({"type": "WEIGHT", "metricCode": "BODY_WEIGHT", "targetValue": 76})),
        )
        .await;
    assert_eq!(goal.status, StatusCode::CREATED, "{}", goal.json);
    // Six weeks ago: at 1 % a week the whole 4 kg count.
    sqlx::query("UPDATE goals SET start_date = start_date - INTERVAL 42 DAY WHERE user_id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    weigh(76.0).await;
    let all = badges(&app, &token).await;
    assert!(badge(&all, "GOAL_GETTER")["awardedAt"].is_string());
    assert!(badge(&all, "FIRST_STEP")["awardedAt"].is_null());
}

#[sqlx::test]
async fn simultaneous_workouts_award_once(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "both").await;
    let (first, second) = (
        strength(&c, Uuid::now_v7(), ago(3)),
        lifting(&c, Uuid::now_v7(), ago(7), 105.0, 5),
    );
    let (a, b) = tokio::join!(post(&app, &token, &first), post(&app, &token, &second));
    assert_eq!(
        (a.status, b.status),
        (StatusCode::CREATED, StatusCode::CREATED),
        "{} {}",
        a.json,
        b.json
    );
    assert_eq!(awards(&app, user, "FIRST_STEP").await, 1);
}

#[sqlx::test]
async fn a_revoked_or_disabled_badge(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "revoked").await;
    sqlx::query("UPDATE badges SET enabled = FALSE WHERE code = 'CENTURY'")
        .execute(&app.db)
        .await
        .unwrap();
    sqlx::query("UPDATE badges SET rule = '{}' WHERE code = 'LEVEL_25'")
        .execute(&app.db)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO user_badges (id, user_id, badge_id, awarded_at, revoked_at) \
         SELECT ?, ?, id, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) FROM badges WHERE code = 'FIRST_STEP'",
    )
    .bind(Uuid::now_v7())
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
    logged(&app, &token, &strength(&c, Uuid::now_v7(), ago(2))).await;
    let all = badges(&app, &token).await;
    assert_eq!(all.len(), 21);
    assert!(all.iter().all(|b| b["code"] != "CENTURY"));
    assert!(badge(&all, "FIRST_STEP")["awardedAt"].is_null());
    assert_eq!(awards(&app, user, "FIRST_STEP").await, 1);
    assert!(badge(&all, "LEVEL_25")["progress"].is_null());
}
