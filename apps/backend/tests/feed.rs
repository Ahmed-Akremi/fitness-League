#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The activity feed: the events part 2's code paths write, the feed, reactions and comments.
mod common;

use axum::http::{Method, StatusCode};
use backend::{modules::goals::milestones, rules::Rules};
use chrono::{DateTime, Duration, Utc};
use common::{
    TestApp, calibrated, seeded,
    workouts::{Catalog, athlete, catalog, lifting, post},
};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

fn hours_ago(hours: i64) -> DateTime<Utc> {
    Utc::now() - Duration::hours(hours)
}

/// A squat session the anti-cheat accepts, with the visibility given; its id.
async fn logged(
    app: &TestApp,
    token: &str,
    c: &Catalog,
    at: DateTime<Utc>,
    kg: f64,
    visibility: &str,
) -> Uuid {
    let mut body = lifting(c, Uuid::now_v7(), at, kg, 5);
    body["visibility"] = json!(visibility);
    let reply = post(app, token, &body).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(reply.json["status"], "ACCEPTED", "{}", reply.json);
    reply.json["id"].as_str().unwrap().parse().unwrap()
}

/// An athlete's events of one type, oldest first: `(ref_id, visibility, payload)`.
async fn events(app: &TestApp, user: Uuid, kind: &str) -> Vec<(Uuid, String, Value)> {
    let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT ref_id, visibility, payload FROM activity_events WHERE user_id = ? AND type = ? ORDER BY id",
    )
    .bind(user)
    .bind(kind)
    .fetch_all(&app.db)
    .await
    .unwrap();
    rows.into_iter()
        .map(|(id, visibility, payload)| (id, visibility, serde_json::from_str(&payload).unwrap()))
        .collect()
}

async fn column(app: &TestApp, column: &'static str, kind: &str, ref_id: Uuid) -> Option<Uuid> {
    let query = match column {
        "sport_id" => "SELECT sport_id FROM activity_events WHERE type = ? AND ref_id = ?",
        "exercise_id" => "SELECT exercise_id FROM activity_events WHERE type = ? AND ref_id = ?",
        _ => "SELECT badge_id FROM activity_events WHERE type = ? AND ref_id = ?",
    };
    sqlx::query_scalar(query)
        .bind(kind)
        .bind(ref_id)
        .fetch_one(&app.db)
        .await
        .unwrap()
}

#[sqlx::test]
async fn a_workout_writes_its_events(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "lifter").await;
    calibrated(&app, user).await;

    let first = logged(&app, &token, &c, hours_ago(60), 100.0, "FRIENDS").await;
    let workouts = events(&app, user, "WORKOUT").await;
    assert_eq!(
        workouts,
        [(
            first,
            "FRIENDS".to_owned(),
            json!({"sportId": c.strength, "durationS": 3600})
        )]
    );
    assert_eq!(
        column(&app, "sport_id", "WORKOUT", first).await,
        Some(c.strength)
    );
    // A calibration record is no record of the feed.
    assert!(events(&app, user, "PR").await.is_empty());

    // 116.67 → 119.58: a record.
    let second = logged(&app, &token, &c, hours_ago(36), 102.5, "FRIENDS").await;
    let awarded: Vec<Uuid> = sqlx::query_scalar(
        "SELECT r.id FROM personal_records r JOIN metric_types m ON m.id = r.metric_type_id \
         WHERE r.workout_id = ? AND r.status = 'AWARDED' AND m.code <> 'REPS_AT_WEIGHT' ORDER BY r.id",
    )
    .bind(second)
    .fetch_all(&app.db)
    .await
    .unwrap();
    let prs = events(&app, user, "PR").await;
    assert_eq!(
        prs.iter().map(|(id, _, _)| *id).collect::<Vec<_>>(),
        awarded
    );
    let e1rm = prs
        .iter()
        .find(|(_, _, p)| p["metric"] == "E1RM")
        .expect("the E1RM record");
    assert_eq!(e1rm.1, "FRIENDS");
    assert_eq!(e1rm.2["exerciseId"], json!(c.squat));
    assert_eq!(e1rm.2["value"].as_f64(), Some(119.58));
    assert_eq!(e1rm.2["previous"].as_f64(), Some(116.67));
    assert_eq!(
        column(&app, "exercise_id", "PR", e1rm.0).await,
        Some(c.squat)
    );

    let private = logged(&app, &token, &c, hours_ago(12), 60.0, "PRIVATE").await;
    let last = events(&app, user, "WORKOUT").await.pop().unwrap();
    assert_eq!((last.0, last.1.as_str()), (private, "PRIVATE"));

    // Logged more than 72 hours late: its event, and no XP, so no level.
    let levels = events(&app, user, "LEVEL_UP").await.len();
    let late = logged(&app, &token, &c, hours_ago(100), 60.0, "FRIENDS").await;
    assert!(
        events(&app, user, "WORKOUT")
            .await
            .iter()
            .any(|(id, _, _)| *id == late)
    );
    assert_eq!(events(&app, user, "LEVEL_UP").await.len(), levels);
}

#[sqlx::test]
async fn level_ups_and_badges(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = athlete(&app, "rookie").await;

    // The first workout earns 30 + 10 + the first quest's 100 XP: level 2 costs 100.
    logged(&app, &token, &c, hours_ago(2), 100.0, "PUBLIC").await;
    let levels = events(&app, user, "LEVEL_UP").await;
    assert_eq!(levels.len(), 1, "{levels:?}");
    let (xp, visibility, payload) = &levels[0];
    assert_eq!(visibility, "FRIENDS");
    assert_eq!(payload, &json!({"from": 1, "to": 2}));
    let reason: String =
        sqlx::query_scalar("SELECT reason FROM xp_transactions WHERE id = ? AND user_id = ?")
            .bind(xp)
            .bind(user)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(reason, "QUEST");

    let badges = events(&app, user, "BADGE").await;
    assert_eq!(badges.len(), 1, "{badges:?}");
    let (award, visibility, payload) = &badges[0];
    assert_eq!(visibility, "FRIENDS");
    assert_eq!(payload, &json!({"badge": "FIRST_STEP"}));
    let badge: Uuid = sqlx::query_scalar(
        "SELECT ub.badge_id FROM user_badges ub JOIN badges b ON b.id = ub.badge_id \
         WHERE ub.id = ? AND ub.user_id = ? AND b.code = 'FIRST_STEP'",
    )
    .bind(award)
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(column(&app, "badge_id", "BADGE", *award).await, Some(badge));
}

#[sqlx::test]
async fn a_completed_goal(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, token) = athlete(&app, "habit").await;
    calibrated(&app, user).await;
    let body = json!({"type": "HABIT", "metricCode": "WORKOUTS_PER_WEEK", "targetValue": 1,
                      "visibility": "PUBLIC"});
    let reply = app
        .call(Method::POST, "/api/v1/goals", Some(&token), Some(body))
        .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    let goal: Uuid = reply.json["id"].as_str().unwrap().parse().unwrap();
    // Every milestone is a number of weeks met: this close reaches them all.
    sqlx::query("UPDATE goals SET habit_weeks_met = 1000 WHERE id = ?")
        .bind(goal)
        .execute(&app.db)
        .await
        .unwrap();
    let rules = Rules::active(&app.db).await.unwrap();
    for _ in 0..2 {
        let mut tx = app.db.begin().await.unwrap();
        milestones::on_week_closed(&mut tx, &app.state, &rules, user, 5, Utc::now())
            .await
            .unwrap();
        tx.commit().await.unwrap();
    }
    assert_eq!(
        events(&app, user, "GOAL_COMPLETED").await,
        [(goal, "PUBLIC".to_owned(), json!({"type": "HABIT"}))]
    );
}
