#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The activity feed: the events part 2's code paths write, the feed, reactions and comments.
mod common;

use axum::http::{Method, StatusCode};
use backend::{
    modules::{
        feed::{self, Activity, Kind},
        goals::milestones,
    },
    rules::Rules,
};
use chrono::{DateTime, Duration, Utc};
use common::{
    Reply, TestApp, calibrated, seeded, seeded_with,
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

// ───────────── The feed, reactions and comments ─────────────

const FEED: &str = "/api/v1/feed";

async fn friends(app: &TestApp, a: Uuid, b: Uuid) {
    let (low, high) = if a < b { (a, b) } else { (b, a) };
    sqlx::query(
        "INSERT INTO friendships (user_low_id, user_high_id, status, requested_by, accepted_at) \
         VALUES (?, ?, 'ACCEPTED', ?, UTC_TIMESTAMP(6))",
    )
    .bind(low)
    .bind(high)
    .bind(a)
    .execute(&app.db)
    .await
    .unwrap();
}

async fn verify(app: &TestApp, user: Uuid) {
    sqlx::query("UPDATE users SET email_verified_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
}

/// An event written as the code paths write them; its id.
async fn item(app: &TestApp, user: Uuid, kind: Kind, visibility: &str, payload: Value) -> Uuid {
    let id = |key: &str| payload[key].as_str().map(|id| id.parse::<Uuid>().unwrap());
    let badge: Option<Uuid> = match payload["badge"].as_str() {
        Some(code) => Some(
            sqlx::query_scalar("SELECT id FROM badges WHERE code = ?")
                .bind(code)
                .fetch_one(&app.db)
                .await
                .unwrap(),
        ),
        None => None,
    };
    let activity = Activity {
        user,
        kind,
        ref_id: Uuid::now_v7(),
        visibility,
        sport: id("sportId"),
        exercise: id("exerciseId"),
        badge,
        payload: payload.clone(),
    };
    let mut conn = app.db.acquire().await.unwrap();
    feed::record(&mut conn, activity).await.unwrap()
}

async fn workout_item(app: &TestApp, user: Uuid, c: &Catalog, visibility: &str) -> Uuid {
    let payload = json!({"sportId": c.strength, "durationS": 3600});
    item(app, user, Kind::Workout, visibility, payload).await
}

fn ids(page: &Value) -> Vec<Uuid> {
    page["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap().parse().unwrap())
        .collect()
}

async fn call(
    app: &TestApp,
    method: Method,
    path: &str,
    token: &str,
    body: Option<Value>,
) -> Reply {
    app.call(method, path, Some(token), body).await
}

async fn feed_of(app: &TestApp, token: &str, query: &str) -> Value {
    let reply = call(app, Method::GET, &format!("{FEED}{query}"), token, None).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    reply.json
}

/// Someone's notifications of one type: their payloads, oldest first.
async fn notes(app: &TestApp, user: Uuid, kind: &str) -> Vec<Value> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT payload FROM notifications WHERE user_id = ? AND type = ? ORDER BY id",
    )
    .bind(user)
    .bind(kind)
    .fetch_all(&app.db)
    .await
    .unwrap();
    rows.iter()
        .map(|p| serde_json::from_str(p).unwrap())
        .collect()
}

fn field_error(reply: &Reply) -> (String, String) {
    assert_eq!(
        reply.status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{}",
        reply.json
    );
    let e = &reply.json["errors"][0];
    (
        e["field"].as_str().unwrap().to_owned(),
        e["code"].as_str().unwrap().to_owned(),
    )
}

fn count(page: &Value) -> usize {
    page["data"].as_array().unwrap().len()
}

#[sqlx::test]
async fn the_feed(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (a, a_token) = athlete(&app, "anis").await;
    let (b, b_token) = athlete(&app, "bilel").await;
    let (stranger, _) = athlete(&app, "chams").await;
    friends(&app, a, b).await;
    let mine = workout_item(&app, a, &c, "FRIENDS").await;
    let shared = workout_item(&app, b, &c, "FRIENDS").await;
    workout_item(&app, b, &c, "PRIVATE").await;
    workout_item(&app, stranger, &c, "PUBLIC").await;

    let page = feed_of(&app, &a_token, "").await;
    assert_eq!(ids(&page), [shared, mine]);
    let first = &page["data"][0];
    assert_eq!(first["type"], "WORKOUT");
    assert_eq!(first["user"]["id"], json!(b));
    assert_eq!(first["user"]["username"], "bilel");
    assert!(first["user"]["fullName"].is_string(), "{first}");
    assert_eq!(first["isMine"], false);
    assert_eq!(page["data"][1]["isMine"], true);
    assert_eq!(first["details"]["sportId"], json!(c.strength));
    assert_eq!(first["details"]["durationS"], 3600);
    assert!(
        first["details"]["sport"]["name"]["fr"].is_string(),
        "{first}"
    );
    assert_eq!(first["details"]["sport"]["code"], "WEIGHT_TRAINING");
    assert_eq!(
        first["reactions"],
        json!({"LIKE": 0, "FIRE": 0, "STRONG": 0})
    );
    assert_eq!(first["myReaction"], Value::Null);
    assert_eq!(first["comments"], 0);
    assert!(first["createdAt"].is_string());

    let one = feed_of(&app, &a_token, "?limit=1").await;
    assert_eq!(ids(&one), [shared]);
    assert_eq!(one["page"]["hasMore"], true);
    let cursor = one["page"]["nextCursor"].as_str().unwrap();
    let two = feed_of(&app, &a_token, &format!("?limit=1&cursor={cursor}")).await;
    assert_eq!(ids(&two), [mine]);
    assert_eq!(two["page"]["hasMore"], false);

    // What the app prints for a badge and a record.
    let badge = item(
        &app,
        b,
        Kind::Badge,
        "FRIENDS",
        json!({"badge": "FIRST_STEP"}),
    )
    .await;
    let pr = json!({"exerciseId": c.squat, "metric": "E1RM", "value": 119.58, "previous": 116.67});
    let record = item(&app, b, Kind::Pr, "FRIENDS", pr).await;
    let page = feed_of(&app, &a_token, "?limit=2").await;
    assert_eq!(ids(&page), [record, badge]);
    let details = &page["data"][0]["details"];
    assert!(details["exercise"]["fr"].is_string(), "{details}");
    assert_eq!(details["value"].as_f64(), Some(119.58));
    let details = &page["data"][1]["details"];
    assert!(details["badgeName"]["fr"].is_string(), "{details}");
    assert!(details["badgeIcon"].is_string(), "{details}");

    // A workout refused afterwards leaves the feed, and a page is still full.
    let refused = logged(&app, &b_token, &c, hours_ago(3), 100.0, "FRIENDS").await;
    let before = feed_of(&app, &a_token, "?limit=50").await;
    let event: Uuid =
        sqlx::query_scalar("SELECT id FROM activity_events WHERE ref_id = ? AND type = 'WORKOUT'")
            .bind(refused)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert!(ids(&before).contains(&event));
    sqlx::query("UPDATE workouts SET status = 'REJECTED' WHERE id = ?")
        .bind(refused)
        .execute(&app.db)
        .await
        .unwrap();
    let after = feed_of(&app, &a_token, "?limit=50").await;
    assert_eq!(count(&after), count(&before) - 1);
    assert!(!ids(&after).contains(&event));
    let three = feed_of(&app, &a_token, "?limit=3").await;
    assert_eq!(ids(&three), ids(&after)[..3]);

    // A block ends the friendship, and with it the friend's items.
    let blocks = format!("/api/v1/blocks/{b}");
    let reply = call(&app, Method::POST, &blocks, &a_token, None).await;
    assert!(reply.status.is_success(), "{}", reply.json);
    assert_eq!(ids(&feed_of(&app, &a_token, "").await), [mine]);
}

#[sqlx::test]
async fn reactions(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (a, a_token) = athlete(&app, "anis").await;
    let (b, _) = athlete(&app, "bilel").await;
    let (stranger, _) = athlete(&app, "chams").await;
    let (d, d_token) = athlete(&app, "dora").await;
    friends(&app, a, b).await;
    friends(&app, d, b).await;
    let shared = workout_item(&app, b, &c, "FRIENDS").await;
    let private = workout_item(&app, b, &c, "PRIVATE").await;
    let public = workout_item(&app, stranger, &c, "PUBLIC").await;
    let mine = workout_item(&app, a, &c, "FRIENDS").await;
    let path = |id: Uuid| format!("/api/v1/activities/{id}/reactions");
    let react = |id: Uuid, token: String, kind: &'static str| {
        let (app, path) = (&app, path(id));
        async move { call(app, Method::PUT, &path, &token, Some(json!({"type": kind}))).await }
    };

    let fire = react(shared, a_token.clone(), "FIRE").await;
    assert_eq!(fire.status, StatusCode::OK, "{}", fire.json);
    assert_eq!(
        fire.json,
        json!({"reactions": {"LIKE": 0, "FIRE": 1, "STRONG": 0}, "myReaction": "FIRE"})
    );
    assert_eq!(
        notes(&app, b, "ACTIVITY_REACTION").await,
        [json!({"activityId": shared, "type": "FIRE", "byUserId": a})]
    );
    let like = react(shared, a_token.clone(), "LIKE").await;
    assert_eq!(
        like.json,
        json!({"reactions": {"LIKE": 1, "FIRE": 0, "STRONG": 0}, "myReaction": "LIKE"})
    );
    assert_eq!(
        react(shared, a_token.clone(), "LIKE").await.status,
        StatusCode::OK
    );
    assert_eq!(notes(&app, b, "ACTIVITY_REACTION").await.len(), 1);
    let feed = feed_of(&app, &a_token, "").await;
    let row = feed["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == json!(shared))
        .unwrap();
    assert_eq!(row["myReaction"], "LIKE");
    assert_eq!(row["reactions"]["LIKE"], 1);
    for _ in 0..2 {
        let gone = call(&app, Method::DELETE, &path(shared), &a_token, None).await;
        assert_eq!(gone.status, StatusCode::OK, "{}", gone.json);
        assert_eq!(
            gone.json,
            json!({"reactions": {"LIKE": 0, "FIRE": 0, "STRONG": 0}, "myReaction": null})
        );
    }

    // A burst of taps: one row, one notification, and no request lost to a deadlock.
    let (one, two, three) = tokio::join!(
        react(shared, d_token.clone(), "FIRE"),
        react(shared, d_token.clone(), "FIRE"),
        react(shared, d_token.clone(), "LIKE")
    );
    for reply in [&one, &two, &three] {
        assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    }
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM activity_reactions WHERE user_id = ?")
        .bind(d)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(rows, 1);
    let all = notes(&app, b, "ACTIVITY_REACTION").await;
    assert_eq!(all.iter().filter(|n| n["byUserId"] == json!(d)).count(), 1);

    // My own item tells nobody.
    assert_eq!(
        react(mine, a_token.clone(), "STRONG").await.status,
        StatusCode::OK
    );
    assert!(notes(&app, a, "ACTIVITY_REACTION").await.is_empty());
    assert_eq!(
        field_error(&react(shared, a_token.clone(), "LOVE").await),
        ("type".to_owned(), "ISIN".to_owned())
    );
    // A stranger's public item can be reacted to; a friend's private one cannot be seen.
    assert_eq!(
        react(public, a_token.clone(), "LIKE").await.status,
        StatusCode::OK
    );
    let hidden = react(private, a_token.clone(), "LIKE").await;
    assert_eq!(hidden.status, StatusCode::NOT_FOUND);
    assert_eq!(hidden.json["title"], "Activity not found");
    let malformed = call(
        &app,
        Method::PUT,
        "/api/v1/activities/x/reactions",
        &a_token,
        Some(json!({"type": "LIKE"})),
    )
    .await;
    assert_eq!(malformed.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn comments(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (a, a_token) = athlete(&app, "anis").await;
    let (b, b_token) = athlete(&app, "bilel").await;
    let (stranger, c_token) = athlete(&app, "chams").await;
    let (e, e_token) = athlete(&app, "emna").await;
    let (f, f_token) = athlete(&app, "fedi").await;
    for user in [a, b, stranger, f] {
        verify(&app, user).await;
    }
    for user in [a, e, f] {
        friends(&app, user, b).await;
    }
    let shared = workout_item(&app, b, &c, "FRIENDS").await;
    let path = format!("/api/v1/activities/{shared}/comments");
    let comment = |token: String, body: Value| {
        let (app, path) = (&app, path.clone());
        async move {
            call(
                app,
                Method::POST,
                &path,
                &token,
                Some(json!({"body": body})),
            )
            .await
        }
    };
    let list = |token: String| {
        let (app, path) = (&app, path.clone());
        async move {
            let reply = call(app, Method::GET, &path, &token, None).await;
            assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
            reply.json
        }
    };

    let made = comment(a_token.clone(), json!("Beast mode 💪")).await;
    assert_eq!(made.status, StatusCode::CREATED, "{}", made.json);
    assert_eq!(made.json["body"], "Beast mode 💪");
    assert_eq!(made.json["isMine"], true);
    assert!(made.json["createdAt"].is_string());
    let first: Uuid = made.json["id"].as_str().unwrap().parse().unwrap();
    assert_eq!(
        notes(&app, b, "ACTIVITY_COMMENT").await,
        [json!({"activityId": shared, "commentId": first, "byUserId": a})]
    );
    let page = list(a_token.clone()).await;
    let row = &page["data"][0];
    assert_eq!(row["id"], json!(first));
    assert_eq!(row["body"], "Beast mode 💪");
    assert_eq!(row["user"]["id"], json!(a));
    assert_eq!(row["user"]["username"], "anis");
    assert_eq!(row["isMine"], true);
    assert_eq!(list(b_token.clone()).await["data"][0]["isMine"], false);
    assert_eq!(feed_of(&app, &a_token, "").await["data"][0]["comments"], 1);

    for (body, code) in [
        (json!("   "), "EMPTY"),
        (json!(""), "MINLENGTH"),
        (json!("x".repeat(501)), "MAXLENGTH"),
    ] {
        assert_eq!(
            field_error(&comment(a_token.clone(), body).await),
            ("body".to_owned(), code.to_owned())
        );
    }
    let unverified = comment(e_token.clone(), json!("Bravo")).await;
    assert_eq!(unverified.status, StatusCode::FORBIDDEN);
    assert_eq!(unverified.json["code"], "EMAIL_NOT_VERIFIED");
    // Not B's friend: the item does not exist for C.
    assert_eq!(
        comment(c_token.clone(), json!("Hi")).await.status,
        StatusCode::NOT_FOUND
    );

    // Who may delete: the comment's author, or the item's owner.
    let delete = |id: Uuid, token: String| {
        let (app, path) = (&app, format!("{path}/{id}"));
        async move { call(app, Method::DELETE, &path, &token, None).await }
    };
    let refused = delete(first, c_token.clone()).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.json["code"], "FORBIDDEN");
    assert_eq!(
        delete(first, b_token.clone()).await.status,
        StatusCode::NO_CONTENT
    );
    let second: Uuid = comment(a_token.clone(), json!("Encore")).await.json["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(
        delete(second, a_token.clone()).await.status,
        StatusCode::NO_CONTENT
    );
    let again = delete(second, a_token.clone()).await;
    assert_eq!(again.status, StatusCode::NOT_FOUND);
    assert_eq!(again.json["title"], "Comment not found");
    assert_eq!(count(&list(a_token.clone()).await), 0);
    assert_eq!(feed_of(&app, &a_token, "").await["data"][0]["comments"], 0);

    // The comments of someone I blocked are not shown to me.
    assert_eq!(
        comment(f_token.clone(), json!("Yalla")).await.status,
        StatusCode::CREATED
    );
    assert_eq!(count(&list(b_token.clone()).await), 1);
    let blocks = format!("/api/v1/blocks/{f}");
    let block = call(&app, Method::POST, &blocks, &a_token, None).await;
    assert!(block.status.is_success(), "{}", block.json);
    assert_eq!(count(&list(a_token.clone()).await), 0);
}

#[sqlx::test]
async fn comments_are_rate_limited(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let c = catalog(&app).await;
    let (a, token) = athlete(&app, "talker").await;
    verify(&app, a).await;
    let mine = workout_item(&app, a, &c, "FRIENDS").await;
    let path = format!("/api/v1/activities/{mine}/comments");
    for i in 0..30 {
        let body = json!({"body": format!("n{i}")});
        let reply = call(&app, Method::POST, &path, &token, Some(body)).await;
        assert_eq!(reply.status, StatusCode::CREATED, "{i}: {}", reply.json);
    }
    let body = json!({"body": "one more"});
    let reply = call(&app, Method::POST, &path, &token, Some(body)).await;
    assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
}
