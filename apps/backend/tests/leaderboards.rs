#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The national and governorate leaderboards, my ranks, and the movement arrows.
mod common;

use std::collections::BTreeSet;

use axum::http::StatusCode;
use backend::{modules::league::boards, rules::Rules};
use chrono::{Duration, Utc};
use common::{TestApp, assert_same_shape, calibrated, seeded, workouts::*};
use serde_json::Value;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const NATIONAL: &str = "/api/v1/leaderboards/national";

fn recorded(key: &str) -> Value {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../mobile-rn/assets/demo/api.json");
    let all: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    all[key].clone()
}

/// The first recorded answer whose key starts with `prefix` and ends with `suffix`.
fn recorded_like(prefix: &str, suffix: &str) -> Value {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../mobile-rn/assets/demo/api.json");
    let all: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let key = all
        .as_object()
        .unwrap()
        .keys()
        .find(|k| k.starts_with(prefix) && k.ends_with(suffix))
        .unwrap()
        .clone();
    all[&key].clone()
}

async fn active_season(app: &TestApp) -> Uuid {
    sqlx::query_scalar("SELECT id FROM seasons WHERE status = 'ACTIVE'")
        .fetch_one(&app.db)
        .await
        .unwrap()
}

async fn set_lp(app: &TestApp, user: Uuid, lp: i64) {
    let rules = Rules::active(&app.db).await.unwrap();
    let division = backend::modules::league::engine::division_for(lp, &rules.division_thresholds);
    sqlx::query(
        "UPDATE user_stats SET current_season_id = (SELECT id FROM seasons WHERE status = 'ACTIVE'), \
           season_lp = ?, division_code = ? WHERE user_id = ?",
    )
    .bind(lp)
    .bind(division.as_str())
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
}

/// An eligible athlete of the active season with `lp`.
async fn ranked(app: &TestApp, name: &str, lp: i64) -> (Uuid, String) {
    let (user, token) = athlete(app, name).await;
    calibrated(app, user).await;
    set_lp(app, user, lp).await;
    (user, token)
}

/// The second governorate of the catalog, and one of its cities.
async fn elsewhere(app: &TestApp) -> (Uuid, Uuid) {
    sqlx::query_as(
        "SELECT g.id, c.id FROM cities c JOIN governorates g ON g.id = c.governorate_id \
         ORDER BY g.code DESC, c.code LIMIT 1",
    )
    .fetch_one(&app.db)
    .await
    .unwrap()
}

async fn move_to(app: &TestApp, user: Uuid, (governorate, city): (Uuid, Uuid)) {
    sqlx::query("UPDATE profiles SET governorate_id = ?, city_id = ? WHERE user_id = ?")
        .bind(governorate)
        .bind(city)
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
}

async fn ok(app: &TestApp, token: &str, path: &str) -> Value {
    let reply = get(app, token, path).await;
    assert_eq!(reply.status, StatusCode::OK, "{path}: {}", reply.json);
    reply.json
}

fn ranks(page: &Value) -> Vec<i64> {
    page["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["rank"].as_i64().unwrap())
        .collect()
}

fn athletes(page: &Value) -> Vec<String> {
    page["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["athlete"]["id"].as_str().unwrap().to_owned())
        .collect()
}

#[sqlx::test]
async fn the_national_board(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let mut ids = Vec::new();
    let mut token = String::new();
    for (name, lp) in [
        ("karim", 1520),
        ("ahmed", 1240),
        ("yassine", 1240),
        ("sami", 900),
        ("nour", 10),
    ] {
        let (id, t) = ranked(&app, name, lp).await;
        ids.push(id.to_string());
        token = t;
    }
    let page = ok(&app, &token, NATIONAL).await;
    assert_eq!(page["seasonId"], active_season(&app).await.to_string());
    assert_eq!(ranks(&page), [1, 2, 2, 4, 5]);
    // The tie keeps the order of the ids.
    assert_eq!(athletes(&page), ids);
    let rows = page["data"].as_array().unwrap();
    let first = &rows[0];
    assert_eq!(first["lp"], 1520);
    assert_eq!(first["level"], 1);
    assert_eq!(first["division"], "PLATINUM");
    assert_eq!(first["athlete"]["username"], "karim");
    assert_eq!(first["athlete"]["fullName"], "Athlete karim");
    assert!(first["gym"].is_null());
    assert_eq!(first["movement"], "NEW");
    assert!(first["governorate"]["name"]["fr"].is_string());
    let keys: BTreeSet<&str> = first
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        BTreeSet::from([
            "rank",
            "athlete",
            "gym",
            "governorate",
            "lp",
            "level",
            "division",
            "movement"
        ])
    );
    let athlete: BTreeSet<&str> = first["athlete"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(athlete, BTreeSet::from(["id", "username", "fullName"]));
    assert_same_shape("page", &recorded("GET /leaderboards/national"), &page);
}

#[sqlx::test]
async fn pages_hold_under_inserts(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let mut expected = Vec::new();
    let mut token = String::new();
    for (i, lp) in [500, 400, 300, 200, 100].into_iter().enumerate() {
        let (id, t) = ranked(&app, &format!("page{i}"), lp).await;
        expected.push(id.to_string());
        token = t;
    }
    let first = ok(&app, &token, &format!("{NATIONAL}?limit=2")).await;
    assert_eq!(first["page"]["hasMore"], true);
    let mut seen = athletes(&first);
    ranked(&app, "latecomer", 2000).await;
    let mut cursor = first["page"]["nextCursor"].as_str().unwrap().to_owned();
    loop {
        let page = ok(&app, &token, &format!("{NATIONAL}?limit=2&cursor={cursor}")).await;
        seen.extend(athletes(&page));
        match page["page"]["nextCursor"].as_str() {
            Some(next) => cursor = next.to_owned(),
            None => break,
        }
    }
    assert_eq!(seen, expected);
}

#[sqlx::test]
async fn only_eligible_athletes_rank(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (good, token) = ranked(&app, "eligible", 100).await;
    let mut outsiders = Vec::new();
    for (name, sql) in [
        (
            "unverified",
            "UPDATE users SET email_verified_at = NULL WHERE id = ?",
        ),
        (
            "calibrating",
            "UPDATE profiles SET calibration_ends_at = UTC_TIMESTAMP(6) + INTERVAL 1 DAY WHERE user_id = ?",
        ),
        (
            "hidden",
            "UPDATE user_settings SET show_on_leaderboards = FALSE WHERE user_id = ?",
        ),
        (
            "seasonless",
            "UPDATE user_stats SET current_season_id = NULL WHERE user_id = ?",
        ),
        (
            "deleted",
            "UPDATE users SET status = 'DELETED' WHERE id = ?",
        ),
    ] {
        let (user, t) = ranked(&app, name, 500).await;
        sqlx::query(sql).bind(user).execute(&app.db).await.unwrap();
        outsiders.push((name, t));
    }
    let page = ok(&app, &token, NATIONAL).await;
    assert_eq!(athletes(&page), [good.to_string()]);
    for (name, t) in outsiders.into_iter().filter(|(n, _)| *n != "deleted") {
        let mine = ok(&app, &t, &format!("{NATIONAL}/me")).await;
        assert!(mine["me"].is_null(), "{name}: {mine}");
        assert_eq!(mine["data"].as_array().unwrap().len(), 0, "{name}");
        assert_eq!(mine["page"]["hasMore"], false, "{name}");
    }
}

#[sqlx::test]
async fn my_page_is_centred_on_me(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let mut mine = String::new();
    for i in 0..9 {
        let (_, token) = ranked(&app, &format!("centre{i}"), 900 - i * 100).await;
        if i == 4 {
            mine = token;
        }
    }
    let page = ok(&app, &mine, &format!("{NATIONAL}/me?limit=4")).await;
    assert_eq!(page["me"]["rank"], 5);
    assert_eq!(ranks(&page), [3, 4, 5, 6]);
    assert_eq!(page["page"]["hasMore"], true);
    assert_same_shape("page", &recorded("GET /leaderboards/national/me"), &page);
}

#[sqlx::test]
async fn the_governorate_board(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (here, token) = ranked(&app, "here", 300).await;
    ranked(&app, "neighbour", 100).await;
    let (there, _) = ranked(&app, "there", 200).await;
    let other = elsewhere(&app).await;
    move_to(&app, there, other).await;
    let home: Uuid = sqlx::query_scalar("SELECT governorate_id FROM profiles WHERE user_id = ?")
        .bind(here)
        .fetch_one(&app.db)
        .await
        .unwrap();

    let path = format!("/api/v1/leaderboards/governorates/{home}");
    let page = ok(&app, &token, &path).await;
    assert_eq!(ranks(&page), [1, 2]);
    assert_same_shape(
        "page",
        &recorded_like("GET /leaderboards/governorates/", "-8244c1544884"),
        &page,
    );
    let mine = ok(&app, &token, &format!("{path}/me")).await;
    assert_eq!(mine["me"]["rank"], 1);
    let far = ok(
        &app,
        &token,
        &format!("/api/v1/leaderboards/governorates/{}", other.0),
    )
    .await;
    assert_eq!(athletes(&far), [there.to_string()]);
    assert_eq!(ranks(&far), [1]);
    let away = ok(
        &app,
        &token,
        &format!("/api/v1/leaderboards/governorates/{}/me", other.0),
    )
    .await;
    assert!(away["me"].is_null());
    let bad = get(&app, &token, "/api/v1/leaderboards/governorates/not-a-uuid").await;
    assert_eq!(bad.status, StatusCode::NOT_FOUND, "{}", bad.json);
}

#[sqlx::test]
async fn my_ranks(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (leader, _) = ranked(&app, "leader", 1520).await;
    move_to(&app, leader, elsewhere(&app).await).await;
    let (_, token) = ranked(&app, "second", 1240).await;
    ranked(&app, "third", 900).await;
    let mine = ok(&app, &token, "/api/v1/me/ranks").await;
    assert_eq!(mine["seasonId"], active_season(&app).await.to_string());
    assert_eq!(mine["national"], 2);
    assert_eq!(mine["governorate"], 1);
    assert!(mine["gym"].is_null());
    // Alone among no friends, first of them.
    assert_eq!(mine["friends"], 1);
    assert_same_shape("ranks", &recorded("GET /me/ranks"), &mine);

    let (_, calibrating) = athlete(&app, "newcomer").await;
    let theirs = ok(&app, &calibrating, "/api/v1/me/ranks").await;
    assert!(theirs["national"].is_null() && theirs["governorate"].is_null());
    assert!(theirs["friends"].is_null());
}

/// `a` and `b` friends (or `a` asking `b`, while `PENDING`).
async fn befriend(app: &TestApp, a: Uuid, b: Uuid, status: &str) {
    let (low, high) = if a < b { (a, b) } else { (b, a) };
    sqlx::query(
        "INSERT INTO friendships (user_low_id, user_high_id, status, requested_by) VALUES (?, ?, ?, ?)",
    )
    .bind(low)
    .bind(high)
    .bind(status)
    .bind(a)
    .execute(&app.db)
    .await
    .unwrap();
}

#[sqlx::test]
async fn the_friends_board(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (me, token) = ranked(&app, "me", 500).await;
    let (top, _) = ranked(&app, "top", 900).await;
    let (low, _) = ranked(&app, "low", 100).await;
    ranked(&app, "stranger", 2000).await;
    let (pending, _) = ranked(&app, "pending", 700).await;
    let (newcomer, _) = athlete(&app, "newcomer").await;
    for friend in [top, low, newcomer] {
        befriend(&app, me, friend, "ACCEPTED").await;
    }
    befriend(&app, pending, me, "PENDING").await;
    boards::snapshot(&app.db, Utc::now() - Duration::days(1), 60)
        .await
        .unwrap();

    let board = ok(&app, &token, "/api/v1/leaderboards/friends").await;
    assert_same_shape("friends", &recorded("GET /leaderboards/friends"), &board);
    assert_eq!(athletes(&board), [top, me, low].map(|u| u.to_string()));
    assert_eq!(ranks(&board), [1, 2, 3]);
    assert!(
        board["data"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["movement"].is_null()),
        "{board}"
    );
    let around = ok(&app, &token, "/api/v1/leaderboards/friends/me").await;
    assert_same_shape(
        "friends/me",
        &recorded("GET /leaderboards/friends/me"),
        &around,
    );
    assert_eq!(around["me"]["rank"], 2);
    assert_eq!(athletes(&around), [top, me, low].map(|u| u.to_string()));
    assert_eq!(ok(&app, &token, "/api/v1/me/ranks").await["friends"], 2);
}

#[sqlx::test]
async fn movement_follows_the_last_snapshot(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (a, token) = ranked(&app, "alpha", 300).await;
    let (b, _) = ranked(&app, "beta", 200).await;
    let yesterday = Utc::now() - Duration::days(1);
    let first = boards::snapshot(&app.db, yesterday, 60).await.unwrap();
    // Two athletes, nationally and in their governorate; the same day again adds nothing.
    assert_eq!(first["rows"], 4);
    let again = boards::snapshot(&app.db, yesterday, 60).await.unwrap();
    assert_eq!(again["rows"], 0);
    set_lp(&app, a, 200).await;
    set_lp(&app, b, 300).await;
    let (c, _) = ranked(&app, "gamma", 50).await;

    let page = ok(&app, &token, NATIONAL).await;
    let movement: Vec<(String, Value)> = page["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["athlete"]["id"].as_str().unwrap().to_owned(),
                r["movement"].clone(),
            )
        })
        .collect();
    assert_eq!(
        movement,
        [
            (b.to_string(), Value::from(1)),
            (a.to_string(), Value::from(-1)),
            (c.to_string(), Value::from("NEW"))
        ]
    );
}

/// `(athlete id, movement)` of every row of a page.
fn movements(page: &Value) -> Vec<(String, Value)> {
    page["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["athlete"]["id"].as_str().unwrap().to_owned(),
                r["movement"].clone(),
            )
        })
        .collect()
}

#[sqlx::test]
async fn the_gym_board(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    // The owner is a member, but calibrating: not on any board.
    let (owner, _) = athlete(&app, "owner").await;
    let gym = common::a_gym(&app, owner, "Bodynade").await;
    let (strong, _) = ranked(&app, "strong", 900).await;
    let (middle, middle_token) = ranked(&app, "middle", 500).await;
    let (light, _) = ranked(&app, "light", 100).await;
    for user in [strong, middle, light] {
        common::member_of(&app, user, gym).await;
    }
    let (stranger, stranger_token) = ranked(&app, "stranger", 2000).await;
    let board = format!("/api/v1/leaderboards/gyms/{gym}");
    let gym_view = serde_json::json!({"id": gym, "name": "Bodynade"});

    let page = ok(&app, &middle_token, &board).await;
    assert_eq!(ranks(&page), [1, 2, 3]);
    assert_eq!(
        athletes(&page),
        [strong.to_string(), middle.to_string(), light.to_string()]
    );
    assert!(page["data"].as_array().unwrap().iter().all(|r| r["gym"] == gym_view));
    assert_same_shape(
        "gym board",
        &recorded("GET /leaderboards/gyms/01a0e9e3-45e7-78b3-adf7-00d0f6fb6ab2"),
        &page,
    );
    let mine = ok(&app, &middle_token, &format!("{board}/me")).await;
    assert_eq!(mine["me"]["rank"], 2);
    assert_same_shape(
        "gym board, me",
        &recorded("GET /leaderboards/gyms/01a0e9e3-45e7-78b3-adf7-00d0f6fb6ab2/me"),
        &mine,
    );
    let ranks_of_middle = ok(&app, &middle_token, "/api/v1/me/ranks").await;
    assert_eq!(ranks_of_middle["gym"], 2);
    assert_same_shape("ranks", &recorded("GET /me/ranks"), &ranks_of_middle);
    let national = ok(&app, &stranger_token, NATIONAL).await;
    let rows = national["data"].as_array().unwrap();
    assert_eq!(rows[0]["athlete"]["id"], stranger.to_string());
    assert!(rows[0]["gym"].is_null());
    assert_eq!(rows[1]["gym"], gym_view);
    assert!(ok(&app, &stranger_token, "/api/v1/me/ranks").await["gym"].is_null());

    boards::snapshot(&app.db, Utc::now() - Duration::days(1), 60)
        .await
        .unwrap();
    set_lp(&app, light, 600).await;
    let page = ok(&app, &middle_token, &board).await;
    assert_eq!(
        movements(&page),
        [
            (strong.to_string(), Value::from(0)),
            (light.to_string(), Value::from(1)),
            (middle.to_string(), Value::from(-1))
        ]
    );

    let left = app
        .call(
            axum::http::Method::DELETE,
            "/api/v1/gyms/me/membership",
            Some(&middle_token),
            None,
        )
        .await;
    assert_eq!(left.status, StatusCode::NO_CONTENT);
    let page = ok(&app, &middle_token, &board).await;
    assert_eq!(athletes(&page), [strong.to_string(), light.to_string()]);
    assert!(ok(&app, &middle_token, "/api/v1/me/ranks").await["gym"].is_null());
    assert!(ok(&app, &middle_token, &format!("{board}/me")).await["me"].is_null());

    let malformed = get(&app, &middle_token, "/api/v1/leaderboards/gyms/nope").await;
    assert_eq!(malformed.status, StatusCode::NOT_FOUND);
    let empty = ok(
        &app,
        &middle_token,
        &format!("/api/v1/leaderboards/gyms/{}", Uuid::now_v7()),
    )
    .await;
    assert!(empty["data"].as_array().unwrap().is_empty());
}

#[sqlx::test]
async fn a_forged_cursor_is_refused(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (_, token) = ranked(&app, "forger", 100).await;
    let reply = get(&app, &token, &format!("{NATIONAL}?cursor=abc.def")).await;
    assert_eq!(
        reply.status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{}",
        reply.json
    );
    assert_eq!(reply.json["errors"][0]["field"], "cursor");
    assert_eq!(reply.json["errors"][0]["code"], "INVALID_CURSOR");
}

#[sqlx::test]
async fn no_active_season(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, token) = ranked(&app, "offseason", 100).await;
    let home: Uuid = sqlx::query_scalar("SELECT governorate_id FROM profiles WHERE user_id = ?")
        .bind(user)
        .fetch_one(&app.db)
        .await
        .unwrap();
    sqlx::query("UPDATE seasons SET status = 'CLOSED' WHERE status = 'ACTIVE'")
        .execute(&app.db)
        .await
        .unwrap();
    for path in [
        NATIONAL.to_owned(),
        format!("{NATIONAL}/me"),
        format!("/api/v1/leaderboards/governorates/{home}"),
        format!("/api/v1/leaderboards/governorates/{home}/me"),
        "/api/v1/me/ranks".to_owned(),
        "/api/v1/me/lp".to_owned(),
    ] {
        let reply = get(&app, &token, &path).await;
        assert_eq!(
            reply.status,
            StatusCode::NOT_FOUND,
            "{path}: {}",
            reply.json
        );
    }
}
