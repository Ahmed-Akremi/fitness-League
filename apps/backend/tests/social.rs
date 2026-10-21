#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Friends, follows, blocks, the athlete search and public profiles.
mod common;

use axum::http::{Method, StatusCode};
use common::{Reply, TestApp, assert_same_shape, recorded, seeded, workouts::athlete};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const REQUESTS: &str = "/api/v1/friends/requests";

/// An athlete whose email is verified, as asking someone to be a friend needs.
async fn friend(app: &TestApp, name: &str) -> (Uuid, String) {
    let (user, token) = athlete(app, name).await;
    sqlx::query("UPDATE users SET email_verified_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    (user, token)
}

async fn call(app: &TestApp, method: Method, path: &str, token: &str, body: Option<Value>) -> Reply {
    app.call(method, path, Some(token), body).await
}

async fn ask(app: &TestApp, token: &str, to: Uuid) -> Reply {
    call(app, Method::POST, REQUESTS, token, Some(json!({"userId": to}))).await
}

async fn answer(app: &TestApp, token: &str, from: Uuid, verb: &str) -> Reply {
    let path = format!("{REQUESTS}/{from}/{verb}");
    call(app, Method::POST, &path, token, None).await
}

/// The friendship row between two athletes, if any: its status and who asked.
async fn friendship(app: &TestApp, a: Uuid, b: Uuid) -> Option<(String, Uuid)> {
    let (low, high) = if a < b { (a, b) } else { (b, a) };
    sqlx::query_as("SELECT status, requested_by FROM friendships WHERE user_low_id = ? AND user_high_id = ?")
        .bind(low)
        .bind(high)
        .fetch_optional(&app.db)
        .await
        .unwrap()
}

async fn count(app: &TestApp, sql: &'static str, a: Uuid, b: Uuid) -> i64 {
    sqlx::query_scalar(sql).bind(a).bind(b).fetch_one(&app.db).await.unwrap()
}

async fn follows(app: &TestApp, follower: Uuid, followee: Uuid) -> i64 {
    count(
        app,
        "SELECT COUNT(*) FROM follows WHERE follower_id = ? AND followee_id = ?",
        follower,
        followee,
    )
    .await
}

/// `(type, payload)` of every notification `user` received, oldest first.
async fn notes(app: &TestApp, user: Uuid) -> Vec<(String, Value)> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT type, payload FROM notifications WHERE user_id = ? ORDER BY id")
            .bind(user)
            .fetch_all(&app.db)
            .await
            .unwrap();
    rows.into_iter()
        .map(|(kind, payload)| (kind, serde_json::from_str(&payload).unwrap()))
        .collect()
}

fn usernames(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|a| a["username"].as_str().unwrap().to_owned())
        .collect()
}

fn error(reply: &Reply) -> (StatusCode, Value, Value) {
    (
        reply.status,
        reply.json["errors"][0]["field"].clone(),
        reply.json["errors"][0]["code"].clone(),
    )
}

#[sqlx::test]
async fn a_friend_request_is_accepted(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (a, ta) = friend(&app, "amine").await;
    let (b, tb) = friend(&app, "bilel").await;

    let asked = ask(&app, &ta, b).await;
    assert_eq!((asked.status, asked.json.clone()), (StatusCode::CREATED, json!({"status": "PENDING"})));
    assert_eq!(notes(&app, b).await, [("FRIEND_REQUEST".to_owned(), json!({"userId": a}))]);
    let again = ask(&app, &ta, b).await;
    assert_eq!((again.status, again.json["code"].clone()), (StatusCode::CONFLICT, json!("CONFLICT")));

    let incoming = call(&app, Method::GET, &format!("{REQUESTS}?direction=in"), &tb, None).await;
    assert_same_shape("in", &recorded("GET /friends/requests?direction=in"), &incoming.json);
    assert_eq!(usernames(&incoming.json), ["amine"]);
    let outgoing = call(&app, Method::GET, &format!("{REQUESTS}?direction=out"), &ta, None).await;
    assert_same_shape("out", &recorded("GET /friends/requests?direction=in"), &outgoing.json);
    assert_eq!(usernames(&outgoing.json), ["bilel"]);
    let mine_in = call(&app, Method::GET, REQUESTS, &ta, None).await;
    assert_eq!(usernames(&mine_in.json), Vec::<String>::new());
    let wrong = call(&app, Method::GET, &format!("{REQUESTS}?direction=up"), &ta, None).await;
    assert_eq!(error(&wrong), (StatusCode::UNPROCESSABLE_ENTITY, json!("direction"), json!("ISIN")));

    let accepted = answer(&app, &tb, a, "accept").await;
    assert_eq!((accepted.status, accepted.json.clone()), (StatusCode::OK, json!({"status": "ACCEPTED"})));
    assert_eq!(notes(&app, a).await, [("FRIEND_ACCEPTED".to_owned(), json!({"userId": b}))]);
    for (token, other) in [(&ta, "bilel"), (&tb, "amine")] {
        let friends = call(&app, Method::GET, "/api/v1/friends", token, None).await;
        assert_eq!(friends.status, StatusCode::OK);
        assert_same_shape("GET /friends", &recorded("GET /friends"), &friends.json);
        assert_eq!(usernames(&friends.json), [other]);
    }
    let after = ask(&app, &ta, b).await;
    assert_eq!(after.status, StatusCode::CONFLICT);
}

#[sqlx::test]
async fn asking_back_accepts(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (a, ta) = friend(&app, "amine").await;
    let (b, tb) = friend(&app, "bilel").await;
    assert_eq!(ask(&app, &ta, b).await.json, json!({"status": "PENDING"}));
    let back = ask(&app, &tb, a).await;
    assert_eq!((back.status, back.json.clone()), (StatusCode::CREATED, json!({"status": "ACCEPTED"})));
    assert_eq!(friendship(&app, a, b).await, Some(("ACCEPTED".to_owned(), a)));
    assert_eq!(notes(&app, a).await, [("FRIEND_ACCEPTED".to_owned(), json!({"userId": b}))]);
}

#[sqlx::test]
async fn crossed_requests_make_one_friendship(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (a, ta) = friend(&app, "amine").await;
    let (b, tb) = friend(&app, "bilel").await;
    let (one, two) = tokio::join!(ask(&app, &ta, b), ask(&app, &tb, a));
    assert_eq!((one.status, two.status), (StatusCode::CREATED, StatusCode::CREATED));
    let mut statuses = [one.json["status"].clone(), two.json["status"].clone()];
    statuses.sort_by_key(|s| s.to_string());
    assert_eq!(statuses, [json!("ACCEPTED"), json!("PENDING")]);
    assert_eq!(friendship(&app, a, b).await.unwrap().0, "ACCEPTED");
}

#[sqlx::test]
async fn declining_and_unfriending(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (a, ta) = friend(&app, "amine").await;
    let (b, tb) = friend(&app, "bilel").await;
    ask(&app, &ta, b).await;
    assert_eq!(answer(&app, &ta, b, "accept").await.status, StatusCode::NOT_FOUND, "the asker accepted");
    let declined = answer(&app, &tb, a, "decline").await;
    assert_eq!((declined.status, declined.json.clone()), (StatusCode::OK, json!({"status": "DECLINED"})));
    assert_eq!(friendship(&app, a, b).await, None);
    let late = answer(&app, &tb, a, "accept").await;
    assert_eq!((late.status, late.json["code"].clone()), (StatusCode::NOT_FOUND, json!("NOT_FOUND")));
    let bad = call(&app, Method::POST, &format!("{REQUESTS}/not-an-id/accept"), &tb, None).await;
    assert_eq!(bad.status, StatusCode::NOT_FOUND);

    ask(&app, &ta, b).await;
    answer(&app, &tb, a, "accept").await;
    let ended = call(&app, Method::DELETE, &format!("/api/v1/friends/{a}"), &tb, None).await;
    assert_eq!(ended.status, StatusCode::NO_CONTENT);
    assert_eq!(friendship(&app, a, b).await, None);
    let again = call(&app, Method::DELETE, &format!("/api/v1/friends/{a}"), &tb, None).await;
    assert_eq!(again.status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn who_can_be_asked(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (a, ta) = friend(&app, "amine").await;
    let (b, _) = friend(&app, "bilel").await;
    let (_, unverified) = athlete(&app, "nadia").await;

    assert_eq!(error(&ask(&app, &ta, a).await), (StatusCode::UNPROCESSABLE_ENTITY, json!("userId"), json!("SELF")));
    let unknown = ask(&app, &ta, Uuid::now_v7()).await;
    assert_eq!((unknown.status, unknown.json["code"].clone()), (StatusCode::NOT_FOUND, json!("NOT_FOUND")));
    let empty = call(&app, Method::POST, REQUESTS, &ta, Some(json!({}))).await;
    assert_eq!(error(&empty), (StatusCode::UNPROCESSABLE_ENTITY, json!("userId"), json!("REQUIRED")));
    let bad = call(&app, Method::POST, REQUESTS, &ta, Some(json!({"userId": "x"}))).await;
    assert_eq!(error(&bad), (StatusCode::UNPROCESSABLE_ENTITY, json!("userId"), json!("ISUUID")));
    let shy = ask(&app, &unverified, b).await;
    assert_eq!((shy.status, shy.json["code"].clone()), (StatusCode::FORBIDDEN, json!("EMAIL_NOT_VERIFIED")));

    sqlx::query("UPDATE users SET status = 'SUSPENDED', suspended_until = UTC_TIMESTAMP(6) + INTERVAL 1 DAY WHERE id = ?")
        .bind(b)
        .execute(&app.db)
        .await
        .unwrap();
    assert_eq!(ask(&app, &ta, b).await.status, StatusCode::NOT_FOUND);
    assert_eq!(friendship(&app, a, b).await, None);
}

#[sqlx::test]
async fn follows_are_silent(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (a, ta) = friend(&app, "amine").await;
    let (b, _) = friend(&app, "bilel").await;
    let path = format!("/api/v1/follows/{b}");
    for _ in 0..2 {
        assert_eq!(call(&app, Method::POST, &path, &ta, None).await.status, StatusCode::NO_CONTENT);
    }
    assert_eq!(follows(&app, a, b).await, 1);
    assert!(notes(&app, b).await.is_empty(), "a follow notified");
    assert_eq!(call(&app, Method::DELETE, &path, &ta, None).await.status, StatusCode::NO_CONTENT);
    assert_eq!(follows(&app, a, b).await, 0);
    let me = call(&app, Method::POST, &format!("/api/v1/follows/{a}"), &ta, None).await;
    assert_eq!(error(&me), (StatusCode::UNPROCESSABLE_ENTITY, json!("userId"), json!("SELF")));
    let nobody = call(&app, Method::POST, &format!("/api/v1/follows/{}", Uuid::now_v7()), &ta, None).await;
    assert_eq!(nobody.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn a_block_cuts_every_link(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (a, ta) = friend(&app, "amine").await;
    let (b, tb) = friend(&app, "bilel").await;
    ask(&app, &ta, b).await;
    answer(&app, &tb, a, "accept").await;
    call(&app, Method::POST, &format!("/api/v1/follows/{b}"), &ta, None).await;
    call(&app, Method::POST, &format!("/api/v1/follows/{a}"), &tb, None).await;

    for _ in 0..2 {
        let blocked = call(&app, Method::POST, &format!("/api/v1/blocks/{b}"), &ta, None).await;
        assert_eq!(blocked.status, StatusCode::NO_CONTENT, "{}", blocked.json);
    }
    assert_eq!(friendship(&app, a, b).await, None);
    assert_eq!((follows(&app, a, b).await, follows(&app, b, a).await), (0, 0));
    assert_eq!(ask(&app, &tb, a).await.status, StatusCode::NOT_FOUND);
    assert_eq!(ask(&app, &ta, b).await.status, StatusCode::NOT_FOUND);
    let follow = call(&app, Method::POST, &format!("/api/v1/follows/{b}"), &ta, None).await;
    assert_eq!(follow.status, StatusCode::NOT_FOUND);
    let me = call(&app, Method::POST, &format!("/api/v1/blocks/{a}"), &ta, None).await;
    assert_eq!(error(&me), (StatusCode::UNPROCESSABLE_ENTITY, json!("userId"), json!("SELF")));
    let nobody = call(&app, Method::POST, &format!("/api/v1/blocks/{}", Uuid::now_v7()), &ta, None).await;
    assert_eq!(nobody.status, StatusCode::NOT_FOUND);
}
