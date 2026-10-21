#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The bell: notifications newest first, « mark read », and the push preferences.
mod common;

use axum::http::{Method, StatusCode};
use backend::modules::notifications::{self, Kind};
use common::{Reply, TestApp, assert_same_shape, recorded, seeded, workouts::athlete};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

async fn notify(app: &TestApp, user: Uuid, payload: Value) {
    let mut conn = app.db.acquire().await.unwrap();
    notifications::notify(&mut conn, user, Kind::FriendRequest, payload)
        .await
        .unwrap();
}

async fn call(app: &TestApp, method: Method, path: &str, token: &str, body: Option<Value>) -> Reply {
    app.call(method, path, Some(token), body).await
}

async fn unread(app: &TestApp, user: Uuid) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL")
        .bind(user)
        .fetch_one(&app.db)
        .await
        .unwrap()
}

fn error(reply: &Reply) -> (StatusCode, Value, Value) {
    (
        reply.status,
        reply.json["errors"][0]["field"].clone(),
        reply.json["errors"][0]["code"].clone(),
    )
}

#[sqlx::test]
async fn my_notifications_page_newest_first(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (me, token) = athlete(&app, "bell").await;
    let (other, _) = athlete(&app, "other").await;
    for n in 0..3 {
        notify(&app, me, json!({"userId": other, "n": n})).await;
    }
    notify(&app, other, json!({"userId": me})).await;

    let first = call(&app, Method::GET, "/api/v1/notifications?limit=2", &token, None).await;
    assert_eq!(first.status, StatusCode::OK, "{}", first.json);
    // A payload's keys depend on its type: the recorded first one is a battle's.
    let mut expected = recorded("GET /notifications");
    expected["data"][0]["payload"] = Value::Null;
    assert_same_shape("GET /notifications", &expected, &first.json);
    assert_eq!(first.json["unread"], 3);
    let order: Vec<i64> = first.json["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["payload"]["n"].as_i64().unwrap())
        .collect();
    assert_eq!(order, [2, 1]);
    assert_eq!(first.json["data"][0]["type"], "FRIEND_REQUEST");
    assert_eq!(first.json["data"][0]["read"], false);
    assert_eq!(first.json["page"]["hasMore"], true);

    let cursor = first.json["page"]["nextCursor"].as_str().unwrap();
    let path = format!("/api/v1/notifications?limit=2&cursor={cursor}");
    let second = call(&app, Method::GET, &path, &token, None).await;
    assert_eq!(second.json["data"].as_array().unwrap().len(), 1);
    assert_eq!(second.json["data"][0]["payload"]["n"], 0);
    assert_eq!(second.json["page"]["hasMore"], false);
}

#[sqlx::test]
async fn marking_read(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (me, token) = athlete(&app, "reader").await;
    let (other, _) = athlete(&app, "stranger").await;
    for _ in 0..3 {
        notify(&app, me, json!({"userId": other})).await;
    }
    notify(&app, other, json!({"userId": me})).await;
    let page = call(&app, Method::GET, "/api/v1/notifications", &token, None).await;
    let newest = page.json["data"][0]["id"].clone();
    let theirs: Uuid = sqlx::query_scalar("SELECT id FROM notifications WHERE user_id = ?")
        .bind(other)
        .fetch_one(&app.db)
        .await
        .unwrap();
    let read = "/api/v1/notifications/read";

    let one = call(&app, Method::POST, read, &token, Some(json!({"ids": [newest]}))).await;
    assert_eq!(one.status, StatusCode::NO_CONTENT, "{}", one.json);
    let page = call(&app, Method::GET, "/api/v1/notifications", &token, None).await;
    assert_eq!(page.json["unread"], 2);
    assert_eq!(page.json["data"][0]["read"], true);

    let foreign = call(&app, Method::POST, read, &token, Some(json!({"ids": [theirs]}))).await;
    assert_eq!(foreign.status, StatusCode::NO_CONTENT);
    assert_eq!(unread(&app, other).await, 1, "another athlete's notification was read");

    let all = call(&app, Method::POST, read, &token, Some(json!({}))).await;
    assert_eq!(all.status, StatusCode::NO_CONTENT);
    assert_eq!(unread(&app, me).await, 0);
    assert_eq!(unread(&app, other).await, 1);

    let bad = call(&app, Method::POST, read, &token, Some(json!({"ids": ["x"]}))).await;
    assert_eq!(error(&bad), (StatusCode::UNPROCESSABLE_ENTITY, json!("ids"), json!("ISUUID")));
    let many: Vec<Uuid> = (0..201).map(|_| Uuid::now_v7()).collect();
    let big = call(&app, Method::POST, read, &token, Some(json!({"ids": many}))).await;
    assert_eq!(
        error(&big),
        (StatusCode::UNPROCESSABLE_ENTITY, json!("ids"), json!("ARRAYMAXSIZE"))
    );
}

#[sqlx::test]
async fn push_preferences(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token) = athlete(&app, "quiet").await;
    let path = "/api/v1/me/notification-preferences";

    let start = call(&app, Method::GET, path, &token, None).await;
    assert_eq!(start.status, StatusCode::OK, "{}", start.json);
    assert_same_shape(path, &recorded("GET /me/notification-preferences"), &start.json);
    let all_on = json!({"SOCIAL": true, "BATTLES": true, "COMPETITION": true, "CHALLENGES": true, "BADGES": true, "GYM": true});
    assert_eq!(start.json, json!({"categories": all_on, "quietHours": null}));

    let set = json!({"categories": {"SOCIAL": false}, "quietHours": {"start": "22:00", "end": "07:00"}});
    let changed = call(&app, Method::PUT, path, &token, Some(set)).await;
    assert_eq!(changed.status, StatusCode::OK, "{}", changed.json);
    assert_eq!(changed.json["categories"]["SOCIAL"], false);
    assert_eq!(changed.json["categories"]["BADGES"], true);
    assert_eq!(changed.json["quietHours"], json!({"start": "22:00", "end": "07:00"}));

    let kept = call(&app, Method::PUT, path, &token, Some(json!({}))).await;
    assert_eq!(kept.json, changed.json);
    let cleared = call(&app, Method::PUT, path, &token, Some(json!({"quietHours": null}))).await;
    assert_eq!(cleared.json["quietHours"], Value::Null);
    assert_eq!(cleared.json["categories"]["SOCIAL"], false);
    assert_eq!(call(&app, Method::GET, path, &token, None).await.json, cleared.json);

    let late = json!({"quietHours": {"start": "24:00", "end": "07:00"}});
    let late = call(&app, Method::PUT, path, &token, Some(late)).await;
    assert_eq!(
        error(&late),
        (StatusCode::UNPROCESSABLE_ENTITY, json!("quietHours.start"), json!("MATCHES"))
    );
    let party = call(&app, Method::PUT, path, &token, Some(json!({"categories": {"PARTY": true}}))).await;
    assert_eq!(
        error(&party),
        (StatusCode::UNPROCESSABLE_ENTITY, json!("categories.PARTY"), json!("UNKNOWN_FIELD"))
    );
}
