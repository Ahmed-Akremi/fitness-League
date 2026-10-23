#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Home news: the admins' posts, read and liked in the app.
mod common;

use axum::http::{Method, StatusCode};
use common::{TestApp, assert_same_shape, recorded, seeded, workouts::athlete};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const NEWS: &str = "/api/v1/announcements";

async fn post(app: &TestApp, body: &str, deleted: bool) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO announcements (id, body, deleted_at) VALUES (?, ?, IF(?, UTC_TIMESTAMP(6), NULL))",
    )
    .bind(id)
    .bind(body)
    .bind(deleted)
    .execute(&app.db)
    .await
    .unwrap();
    id
}

async fn read(app: &TestApp, token: &str, query: &str) -> Value {
    let reply = app
        .call(Method::GET, &format!("{NEWS}{query}"), Some(token), None)
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    reply.json
}

fn ids(page: &Value) -> Vec<Uuid> {
    page["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["id"].as_str().unwrap().parse().unwrap())
        .collect()
}

#[sqlx::test]
async fn the_news(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token) = athlete(&app, "reader").await;
    let (_, other) = athlete(&app, "other").await;
    let welcome = post(&app, "Welcome to Fitness League!", false).await;
    let gone = post(&app, "A mistake", true).await;
    let final_ = post(&app, "Registrations close on October 11.", false).await;

    let page = read(&app, &token, "?limit=5").await;
    assert_same_shape("", &recorded("GET /announcements?limit=5"), &page);
    assert_eq!(ids(&page), [final_, welcome]);
    let first = &page["data"][0];
    assert_eq!(first["body"], "Registrations close on October 11.");
    assert_eq!(
        (&first["imageUrl"], &first["imageWidth"], &first["imageHeight"]),
        (&Value::Null, &Value::Null, &Value::Null)
    );
    assert_eq!((&first["likeCount"], &first["likedByMe"]), (&json!(0), &json!(false)));

    let one = read(&app, &token, "?limit=1").await;
    assert_eq!(ids(&one), [final_]);
    let cursor = one["page"]["nextCursor"].as_str().unwrap();
    let two = read(&app, &token, &format!("?limit=1&cursor={cursor}")).await;
    assert_eq!(ids(&two), [welcome]);
    assert_eq!(two["page"]["hasMore"], false);

    let like = |method: Method, token: String, id: String| {
        let app = &app;
        async move {
            app.call(method, &format!("{NEWS}/{id}/like"), Some(&token), None)
                .await
        }
    };
    for _ in 0..2 {
        let reply = like(Method::PUT, token.clone(), welcome.to_string()).await;
        assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
        assert_eq!(reply.json, json!({"likeCount": 1, "likedByMe": true}));
    }
    let reply = like(Method::PUT, other.clone(), welcome.to_string()).await;
    assert_eq!(reply.json, json!({"likeCount": 2, "likedByMe": true}));
    let mine = read(&app, &token, "").await;
    assert_eq!(mine["data"][1]["likedByMe"], true);
    assert_eq!(mine["data"][1]["likeCount"], 2);
    assert_eq!(mine["data"][0]["likedByMe"], false);
    for _ in 0..2 {
        let reply = like(Method::DELETE, token.clone(), welcome.to_string()).await;
        assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
        assert_eq!(reply.json, json!({"likeCount": 1, "likedByMe": false}));
    }

    for id in [gone.to_string(), Uuid::now_v7().to_string(), "x".to_owned()] {
        for method in [Method::PUT, Method::DELETE] {
            let reply = like(method, token.clone(), id.clone()).await;
            assert_eq!(reply.status, StatusCode::NOT_FOUND, "{id}");
            assert_eq!(reply.json["title"], "Announcement not found");
        }
    }
}
