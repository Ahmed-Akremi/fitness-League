#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode};
use backend::{
    modules::{
        feed::{self, Activity},
        me::privacy::{self, Swept},
        notifications::{self, Kind},
    },
    types::Role,
};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use common::{PASSWORD, Reply, TestApp, create_user, register, seeded, seeded_with};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

fn access(session: &Value) -> Option<&str> {
    session["accessToken"].as_str()
}

fn user_of(session: &Value) -> Uuid {
    session["userId"].as_str().unwrap().parse().unwrap()
}

async fn delete(app: &TestApp, session: &Value, password: &str) -> Reply {
    app.call(
        Method::DELETE,
        "/api/v1/me",
        access(session),
        Some(json!({"confirm": "DELETE", "password": password})),
    )
    .await
}

async fn statuses(app: &TestApp, user: Uuid) -> Vec<String> {
    sqlx::query_scalar("SELECT status FROM deletion_requests WHERE user_id = ? ORDER BY id")
        .bind(user)
        .fetch_all(&app.db)
        .await
        .unwrap()
}

#[sqlx::test]
async fn the_export_holds_the_account_and_nothing_secret(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    register(&app, "leila").await;
    let squat: Uuid = sqlx::query_scalar("SELECT id FROM exercises WHERE code = 'BACK_SQUAT'")
        .fetch_one(&app.db)
        .await
        .unwrap();
    app.call(
        Method::POST,
        "/api/v1/me/onboarding/baselines",
        access(&session),
        Some(json!({"entries": [{"exerciseId": squat, "metricCode": "E1RM", "value": 102.5}]})),
    )
    .await;

    let reply = app
        .call(Method::GET, "/api/v1/me/export", access(&session), None)
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    let body = &reply.json;
    let account = &body["account"];
    assert_eq!(account["username"], "ahmed");
    assert_eq!(account["email"], "ahmed@example.com");
    // The one place where the date of birth leaves the API: to its owner.
    assert_eq!(account["dateOfBirth"], "1995-05-05");
    assert!(account["createdAt"].is_string());
    assert_eq!(account["profile"]["fullName"], "Athlete ahmed");
    assert_eq!(account["settings"]["locale"], "fr");
    assert_eq!(
        account["baselines"][0]["exerciseCode"], "BACK_SQUAT",
        "{account}"
    );
    assert_eq!(account["baselines"][0]["declaredValue"], 102.5);
    assert_eq!(account["baselines"][0]["status"], "PROVISIONAL");
    let kinds: Vec<&str> = body["consents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["type"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["TERMS", "PRIVACY", "HEALTH_DATA", "MARKETING"]);
    assert_eq!(body["consents"][0]["granted"], true);
    assert_eq!(body["consents"][0]["documentVersion"], "2026-09");
    // What the app reads, and what later parts will fill.
    for key in [
        "workouts",
        "goals",
        "bodyMeasurements",
        "xpTransactions",
        "leaguePointTransactions",
    ] {
        assert_eq!(body[key], json!([]), "{key}");
    }
    let text = body.to_string();
    assert!(
        !text.contains("argon") && !text.contains("leila") && !text.contains("sessionVersion"),
        "{text}"
    );
}

#[sqlx::test]
async fn three_exports_a_day(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let session = register(&app, "ahmed").await;
    for _ in 0..3 {
        let reply = app
            .call(Method::GET, "/api/v1/me/export", access(&session), None)
            .await;
        assert_eq!(reply.status, StatusCode::OK);
    }
    let reply = app
        .call(Method::GET, "/api/v1/me/export", access(&session), None)
        .await;
    assert_eq!(
        (reply.status, reply.json["code"].as_str()),
        (StatusCode::TOO_MANY_REQUESTS, Some("RATE_LIMITED"))
    );
    assert!(reply.headers.contains_key("retry-after"));
}

#[sqlx::test]
async fn a_deletion_is_scheduled_and_signs_out_everywhere(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let user = user_of(&session);

    let refused = app
        .call(
            Method::DELETE,
            "/api/v1/me",
            access(&session),
            Some(json!({"confirm": "yes", "password": PASSWORD})),
        )
        .await;
    assert_eq!(
        refused.json["errors"],
        json!([{"field": "confirm", "code": "EQUALS"}])
    );
    let wrong = delete(&app, &session, "not the password").await;
    assert_eq!(
        (wrong.status, wrong.json["code"].as_str()),
        (StatusCode::UNAUTHORIZED, Some("INVALID_CREDENTIALS"))
    );
    assert!(statuses(&app, user).await.is_empty());

    let reply = delete(&app, &session, PASSWORD).await;
    assert_eq!(reply.status, StatusCode::ACCEPTED, "{}", reply.json);
    let at: DateTime<Utc> = reply.json["scheduledFor"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!((at - (Utc::now() + Duration::days(30))).num_seconds().abs() < 60);
    assert_eq!(statuses(&app, user).await, ["PENDING"]);

    // Every session ends at once: the access token, and the refresh token.
    let me = app
        .call(Method::GET, "/api/v1/me", access(&session), None)
        .await;
    assert_eq!(me.json["code"], "TOKEN_INVALID");
    let refresh = app
        .post(
            "/api/v1/auth/refresh",
            json!({"refreshToken": session["refreshToken"]}),
        )
        .await;
    assert_eq!(refresh.status, StatusCode::UNAUTHORIZED);
    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'ACCOUNT_DELETION_REQUESTED' AND entity_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // Signing in again is changing one's mind.
    let back = app
        .post(
            "/api/v1/auth/login",
            json!({"email": "ahmed@example.com", "password": PASSWORD}),
        )
        .await;
    assert_eq!(back.status, StatusCode::OK);
    assert_eq!(statuses(&app, user).await, ["CANCELLED"]);

    // A second request, then a third: one pending at a time.
    delete(&app, &back.json, PASSWORD).await;
    let again = app
        .post(
            "/api/v1/auth/login",
            json!({"email": "ahmed@example.com", "password": PASSWORD}),
        )
        .await;
    assert_eq!(
        delete(&app, &again.json, PASSWORD).await.status,
        StatusCode::ACCEPTED
    );
    assert_eq!(
        statuses(&app, user).await,
        ["CANCELLED", "CANCELLED", "PENDING"]
    );
}

#[sqlx::test]
async fn the_database_holds_one_pending_deletion_per_account(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let user = user_of(&register(&app, "ahmed").await);
    let insert = || {
        sqlx::query(
            "INSERT INTO deletion_requests (id, user_id, scheduled_for) VALUES (?, ?, UTC_TIMESTAMP(6))",
        )
        .bind(Uuid::now_v7())
        .bind(user)
        .execute(&app.db)
    };
    insert().await.unwrap();
    let second = insert().await.unwrap_err();
    assert_eq!(
        backend::db::duplicate_key(&second),
        Some("uq_deletion_requests_one_pending")
    );
    // Once it is no longer pending, a new one may be made.
    sqlx::query("UPDATE deletion_requests SET status = 'CANCELLED'")
        .execute(&app.db)
        .await
        .unwrap();
    insert().await.unwrap();
}

#[sqlx::test]
async fn a_wrong_password_on_deletion_counts_toward_the_lock(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    for _ in 0..5 {
        assert_eq!(
            delete(&app, &session, "guess").await.json["code"],
            "INVALID_CREDENTIALS"
        );
    }
    let locked = delete(&app, &session, PASSWORD).await;
    assert_eq!(
        (locked.status, locked.json["code"].as_str()),
        (StatusCode::LOCKED, Some("ACCOUNT_LOCKED"))
    );
    assert!(statuses(&app, user_of(&session)).await.is_empty());
}

#[sqlx::test]
async fn the_sweep_anonymises_what_is_due_and_nothing_else(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let ahmed = register(&app, "ahmed").await;
    let leila = register(&app, "leila").await;
    let sami = register(&app, "sami").await;
    let user = user_of(&ahmed);
    delete(&app, &ahmed, PASSWORD).await;
    // Sami changed their mind: signing in cancelled the request.
    delete(&app, &sami, PASSWORD).await;
    app.post(
        "/api/v1/auth/login",
        json!({"email": "sami@example.com", "password": PASSWORD}),
    )
    .await;

    // Not due yet: nothing happens.
    let early = privacy::sweep(&app.db, (Utc::now() + Duration::days(29)).naive_utc())
        .await
        .unwrap();
    assert_eq!(early.anonymised, 0);

    let later = (Utc::now() + Duration::days(31)).naive_utc();
    let swept = privacy::sweep(&app.db, later).await.unwrap();
    assert_eq!(swept.anonymised, 1);
    // Every session of the three registrations had expired by then.
    assert!(swept.refresh_tokens >= 2, "{swept:?}");

    let row: (String, String, Option<String>, NaiveDate, String, String) = sqlx::query_as(
        "SELECT u.email, u.username, u.password_hash, u.date_of_birth, u.status, p.full_name \
         FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    let hex = user.simple().to_string();
    assert_eq!(row.0, format!("deleted:{user}"));
    assert_eq!(row.1, format!("deleted-{}", &hex[20..]));
    assert_eq!(row.2, None);
    assert_eq!(row.3, NaiveDate::from_ymd_opt(1900, 1, 1).unwrap());
    assert_eq!(row.4, "DELETED");
    assert_eq!(row.5, "Deleted athlete");
    assert_eq!(statuses(&app, user).await, ["COMPLETED"]);
    // The record stays: consents and the trail.
    let consents: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM consents WHERE user_id = ?")
        .bind(user)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(consents, 4);
    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'ACCOUNT_ANONYMISED' AND entity_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // The others are untouched, and the old address opens nothing.
    for name in ["leila", "sami"] {
        let status: String = sqlx::query_scalar("SELECT status FROM users WHERE username = ?")
            .bind(name)
            .fetch_one(&app.db)
            .await
            .unwrap();
        assert_eq!(status, "ACTIVE", "{name}");
    }
    let login = app
        .post(
            "/api/v1/auth/login",
            json!({"email": "ahmed@example.com", "password": PASSWORD}),
        )
        .await;
    assert_eq!(login.json["code"], "INVALID_CREDENTIALS");
    // The placeholder names cannot be registered by anyone.
    let mut taken = common::registration(&app, "x").await;
    taken["username"] = json!(row.1);
    let reply = app.post("/api/v1/auth/register", taken).await;
    assert_eq!(reply.json["errors"][0]["field"], "username");

    // Once is enough.
    assert_eq!(
        privacy::sweep(&app.db, later).await.unwrap(),
        Swept::default()
    );
    assert_eq!(
        app.call(Method::GET, "/api/v1/me", access(&leila), None)
            .await
            .status,
        StatusCode::OK
    );
}

#[sqlx::test]
async fn one_sweep_a_day_whatever_the_number_of_workers(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let now = Utc::now();
    assert!(
        privacy::daily_sweep(&app.state, now)
            .await
            .unwrap()
            .is_some()
    );
    assert!(
        privacy::daily_sweep(&app.state, now)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        privacy::daily_sweep(&app.state, now + Duration::days(1))
            .await
            .unwrap()
            .is_some()
    );
}

/// A weigh-in at 78.4 kg (with the health consent) and a squat session with notes.
async fn weigh_and_train(app: &TestApp, session: &Value) {
    common::set_consent(app, user_of(session), "HEALTH_DATA", true).await;
    let weigh = app
        .call(
            Method::POST,
            "/api/v1/me/body-measurements",
            access(session),
            Some(json!({"weightKg": 78.4})),
        )
        .await;
    assert_eq!(weigh.status, StatusCode::CREATED, "{}", weigh.json);
    let sport: Uuid = sqlx::query_scalar("SELECT id FROM sports WHERE code = 'WEIGHT_TRAINING'")
        .fetch_one(&app.db)
        .await
        .unwrap();
    let squat: Uuid = sqlx::query_scalar("SELECT id FROM exercises WHERE code = 'BACK_SQUAT'")
        .fetch_one(&app.db)
        .await
        .unwrap();
    let client = Uuid::now_v7();
    let body = json!({
        "clientId": client, "sportId": sport, "workoutType": "STRENGTH",
        "performedAt": (Utc::now() - Duration::hours(2)).to_rfc3339(), "durationS": 3600,
        "notes": "felt strong",
        "exercises": [{"exerciseId": squat, "notes": "belt on", "sets": [{"reps": 5, "weightKg": 100}]}]
    });
    let reply = app
        .send(
            common::request(Method::POST, "/api/v1/workouts")
                .header(
                    "authorization",
                    format!("Bearer {}", access(session).unwrap()),
                )
                .header("content-type", "application/json")
                .header("idempotency-key", client.to_string())
                .body(axum::body::Body::from(body.to_string()))
                .unwrap(),
        )
        .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
}

#[sqlx::test]
async fn the_export_holds_workouts_and_weigh_ins(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "nour").await;
    weigh_and_train(&app, &session).await;
    let reply = app
        .call(Method::GET, "/api/v1/me/export", access(&session), None)
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    assert_eq!(reply.json["bodyMeasurements"][0]["weightKg"], 78.4);
    assert_eq!(reply.json["workouts"][0]["notes"], "felt strong");
    assert_eq!(
        reply.json["workouts"][0]["exercises"][0]["sets"][0]["weightKg"],
        100.0
    );
}

#[sqlx::test]
async fn the_export_holds_records_and_xp(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "sami").await;
    weigh_and_train(&app, &session).await;
    let reply = app
        .call(Method::GET, "/api/v1/me/export", access(&session), None)
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);

    let records = reply.json["account"]["personalRecords"].as_array().unwrap();
    let mut metrics: Vec<&str> = records
        .iter()
        .map(|r| r["metricCode"].as_str().unwrap())
        .collect();
    metrics.sort_unstable();
    assert_eq!(metrics, ["E1RM", "MAX_WEIGHT", "REPS_AT_WEIGHT"]);
    assert_eq!(records[0]["exerciseCode"], "BACK_SQUAT");
    assert_eq!(records[0]["isCurrent"], true);

    let xp = reply.json["xpTransactions"].as_array().unwrap();
    let reasons: Vec<&str> = xp.iter().map(|x| x["reason"].as_str().unwrap()).collect();
    assert_eq!(reasons, ["WORKOUT", "CALIBRATION_PR", "QUEST"]);
    let total: i64 = xp.iter().map(|x| x["amount"].as_i64().unwrap()).sum();
    assert_eq!(total, 140);
    assert_eq!(xp[0]["explanation"]["formula"], "workout_xp");
    assert_eq!(xp[0]["workoutId"], reply.json["workouts"][0]["id"]);
}

#[sqlx::test]
async fn the_export_holds_league_points(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    use backend::{
        modules::scoring::ledger::{self, LpEntry},
        rules::Rules,
    };
    let app = seeded(opts, conn).await;
    let session = register(&app, "lena").await;
    let user = user_of(&session);
    let rules = Rules::active(&app.db).await.unwrap();
    let season: Uuid = sqlx::query_scalar("SELECT id FROM seasons WHERE status = 'ACTIVE'")
        .fetch_one(&app.db)
        .await
        .unwrap();
    let mut tx = app.db.begin().await.unwrap();
    let entry = LpEntry {
        user,
        season,
        amount: 42,
        reason: "WEEKLY_SCORE",
        source_type: "week",
        source_id: "2026-10-19".to_owned(),
        explanation: json!({"formula": "weekly_score"}),
        effective_at: Utc::now(),
    };
    ledger::append_lp(&mut tx, &rules, entry).await.unwrap();
    tx.commit().await.unwrap();

    let reply = app
        .call(Method::GET, "/api/v1/me/export", access(&session), None)
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    let lp = &reply.json["leaguePointTransactions"][0];
    assert_eq!(lp["seasonId"], season.to_string());
    assert_eq!(lp["amount"], 42);
    assert_eq!(lp["reason"], "WEEKLY_SCORE");
    assert_eq!(lp["sourceType"], "week");
    assert_eq!(lp["sourceId"], "2026-10-19");
    assert!(lp["reversesId"].is_null());
    assert_eq!(lp["ruleSetVersion"], 2);
    assert_eq!(lp["explanation"]["formula"], "weekly_score");
    for key in ["id", "effectiveAt", "createdAt"] {
        assert!(lp[key].is_string(), "{key}: {lp}");
    }
}

#[sqlx::test]
async fn anonymising_removes_weigh_ins_and_workout_notes(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "nour").await;
    let user = user_of(&session);
    weigh_and_train(&app, &session).await;
    delete(&app, &session, PASSWORD).await;
    let swept = privacy::sweep(&app.db, (Utc::now() + Duration::days(31)).naive_utc())
        .await
        .unwrap();
    assert_eq!(swept.anonymised, 1);

    let weigh_ins: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM body_measurements WHERE user_id = ?")
            .bind(user)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(weigh_ins, 0);
    let (notes, visibility): (Option<String>, String) =
        sqlx::query_as("SELECT notes, visibility FROM workouts WHERE user_id = ?")
            .bind(user)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!((notes, visibility.as_str()), (None, "PRIVATE"));
    let exercise_notes: Option<String> = sqlx::query_scalar(
        "SELECT e.notes FROM workout_exercises e JOIN workouts w ON w.id = e.workout_id WHERE w.user_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(exercise_notes, None);
}

/// After `weigh_and_train`: a weight goal to 76 kg and a squat goal to 125 kg.
async fn set_goals(app: &TestApp, session: &Value) -> (Uuid, Uuid) {
    let squat: Uuid = sqlx::query_scalar("SELECT id FROM exercises WHERE code = 'BACK_SQUAT'")
        .fetch_one(&app.db)
        .await
        .unwrap();
    let mut ids = Vec::new();
    for body in [
        json!({"type": "WEIGHT", "metricCode": "BODY_WEIGHT", "targetValue": 76}),
        json!({"type": "STRENGTH", "exerciseId": squat, "metricCode": "E1RM", "targetValue": 125}),
    ] {
        let reply = app
            .call(Method::POST, "/api/v1/goals", access(session), Some(body))
            .await;
        assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
        ids.push(Uuid::parse_str(reply.json["id"].as_str().unwrap()).unwrap());
    }
    (ids[0], ids[1])
}

#[sqlx::test]
async fn the_export_holds_goals_and_badges(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "karim").await;
    weigh_and_train(&app, &session).await;
    set_goals(&app, &session).await;
    // The athlete's own data, even after they stopped sharing it with the app.
    common::set_consent(&app, user_of(&session), "HEALTH_DATA", false).await;
    let reply = app
        .call(Method::GET, "/api/v1/me/export", access(&session), None)
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    let goals = reply.json["goals"].as_array().unwrap();
    assert_eq!(goals.len(), 2);
    let weight = goals.iter().find(|g| g["type"] == "WEIGHT").unwrap();
    assert_eq!(weight["targetValue"].as_f64(), Some(76.0));
    assert_eq!(weight["milestones"][0]["targetValue"].as_f64(), Some(77.0));
    assert!(goals.iter().any(|g| g["type"] == "STRENGTH"));

    let badges = reply.json["account"]["badges"].as_array().unwrap();
    let first = badges.iter().find(|b| b["code"] == "FIRST_STEP").unwrap();
    assert!(first["awardedAt"].is_string());
    assert!(first["revokedAt"].is_null());
    assert_eq!(first["sourceRef"], reply.json["workouts"][0]["id"]);
}

#[sqlx::test]
async fn anonymisation_deletes_weight_goals(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "hela").await;
    let user = user_of(&session);
    weigh_and_train(&app, &session).await;
    let (weight, _) = set_goals(&app, &session).await;
    delete(&app, &session, PASSWORD).await;
    let swept = privacy::sweep(&app.db, (Utc::now() + Duration::days(31)).naive_utc())
        .await
        .unwrap();
    assert_eq!(swept.anonymised, 1);

    let kinds: Vec<String> = sqlx::query_scalar("SELECT type FROM goals WHERE user_id = ?")
        .bind(user)
        .fetch_all(&app.db)
        .await
        .unwrap();
    assert_eq!(kinds, ["STRENGTH"]);
    let milestones: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM goal_milestones WHERE goal_id = ?")
            .bind(weight)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(milestones, 0);
    let badges: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user_badges WHERE user_id = ?")
        .bind(user)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert!(badges >= 1);
}

/// `me` and `friend` friends (asked by `me`) following each other, `me` and `blocked` blocking each
/// other, and one notification for `me`.
async fn social_links(app: &TestApp, me: Uuid, friend: Uuid, blocked: Uuid) {
    let (low, high) = if me < friend {
        (me, friend)
    } else {
        (friend, me)
    };
    sqlx::query(
        "INSERT INTO friendships (user_low_id, user_high_id, status, requested_by, accepted_at) \
         VALUES (?, ?, 'ACCEPTED', ?, UTC_TIMESTAMP(6))",
    )
    .bind(low)
    .bind(high)
    .bind(me)
    .execute(&app.db)
    .await
    .unwrap();
    for (sql, a, b) in [
        (
            "INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)",
            me,
            friend,
        ),
        (
            "INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)",
            friend,
            me,
        ),
        (
            "INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)",
            me,
            blocked,
        ),
        (
            "INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)",
            blocked,
            me,
        ),
    ] {
        sqlx::query(sql)
            .bind(a)
            .bind(b)
            .execute(&app.db)
            .await
            .unwrap();
    }
    let mut conn = app.db.acquire().await.unwrap();
    notifications::notify(
        &mut conn,
        me,
        Kind::FriendRequest,
        json!({"userId": friend}),
    )
    .await
    .unwrap();
}

#[sqlx::test]
async fn the_export_holds_friends_and_notifications(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "nour").await;
    let me = user_of(&session);
    let friend = create_user(&app, "sami", Role::User).await;
    let blocked = create_user(&app, "karim", Role::User).await;
    social_links(&app, me, friend, blocked).await;
    let quiet = json!({"categories": {"GYM": false}});
    let path = "/api/v1/me/notification-preferences";
    app.call(Method::PUT, path, access(&session), Some(quiet))
        .await;

    let reply = app
        .call(Method::GET, "/api/v1/me/export", access(&session), None)
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    let export = &reply.json;
    let friendship = &export["friendships"][0];
    assert_eq!(friendship["userId"], friend.to_string());
    assert_eq!(friendship["status"], "ACCEPTED");
    assert_eq!(friendship["requestedByMe"], true);
    assert!(friendship["createdAt"].is_string() && friendship["acceptedAt"].is_string());
    assert_eq!(export["following"][0]["userId"], friend.to_string());
    assert_eq!(export["following"].as_array().unwrap().len(), 1);
    assert_eq!(export["blocked"][0]["userId"], blocked.to_string());
    assert_eq!(export["blocked"].as_array().unwrap().len(), 1);
    let note = &export["notifications"][0];
    assert_eq!(note["type"], "FRIEND_REQUEST");
    assert_eq!(note["payload"], json!({"userId": friend}));
    assert_eq!(note["read"], false);
    assert_eq!(
        export["notificationPreferences"]["categories"]["GYM"],
        false
    );
}

/// Verifies the account's email, then submits a gym for it; returns the gym's id.
async fn submit_gym(app: &TestApp, session: &Value, name: &str) -> Uuid {
    sqlx::query("UPDATE users SET email_verified_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(user_of(session))
        .execute(&app.db)
        .await
        .unwrap();
    let (governorate, city) = common::a_place(app).await;
    let body = json!({
        "name": name, "governorateId": governorate, "cityId": city,
        "proofOfOwnership": "Registre de commerce B123456",
    });
    let reply = app
        .call(Method::POST, "/api/v1/gyms", access(session), Some(body))
        .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    reply.json["id"].as_str().unwrap().parse().unwrap()
}

#[sqlx::test]
async fn the_export_holds_gyms(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "nour").await;
    let me = user_of(&session);
    let owner = create_user(&app, "owner", Role::User).await;
    let gym = common::a_gym(&app, owner, "Sahel Iron").await;
    common::member_of(&app, me, gym).await;
    let mine = submit_gym(&app, &session, "Nour Gym").await;

    let reply = app
        .call(Method::GET, "/api/v1/me/export", access(&session), None)
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    let membership = &reply.json["gymMemberships"][0];
    assert_eq!(membership["gymId"], gym.to_string());
    assert_eq!(membership["gymName"], "Sahel Iron");
    assert_eq!(membership["status"], "APPROVED");
    assert_eq!(membership["role"], "MEMBER");
    assert!(membership["requestedAt"].is_string() && membership["approvedAt"].is_string());
    assert!(membership["leftAt"].is_null());
    assert_eq!(reply.json["gymMemberships"].as_array().unwrap().len(), 1);
    let submitted = &reply.json["gyms"][0];
    assert_eq!(submitted["id"], mine.to_string());
    assert_eq!(submitted["name"], "Nour Gym");
    assert_eq!(submitted["slug"], "nour-gym");
    assert_eq!(submitted["status"], "PENDING");
    assert!(submitted["createdAt"].is_string());
    assert_eq!(
        submitted["proofOfOwnership"],
        "Registre de commerce B123456"
    );
    assert_eq!(reply.json["gyms"].as_array().unwrap().len(), 1);
}

#[sqlx::test]
async fn anonymising_ends_gym_ties(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "nour").await;
    let me = user_of(&session);
    let verified = common::a_gym(&app, me, "Nour Verified").await;
    sqlx::query(
        "INSERT INTO gym_verification_requests (id, gym_id, submitted_by, proof_text, status) \
         VALUES (?, ?, ?, 'Registre de commerce A654321', 'APPROVED')",
    )
    .bind(Uuid::now_v7())
    .bind(verified)
    .bind(me)
    .execute(&app.db)
    .await
    .unwrap();
    let member = create_user(&app, "sami", Role::User).await;
    common::member_of(&app, member, verified).await;
    let pending = submit_gym(&app, &session, "Nour Pending").await;
    delete(&app, &session, PASSWORD).await;
    let swept = privacy::sweep(&app.db, (Utc::now() + Duration::days(31)).naive_utc())
        .await
        .unwrap();
    assert_eq!(swept.anonymised, 1);

    let count = |sql: &'static str, id: Uuid| {
        let db = app.db.clone();
        async move {
            sqlx::query_scalar::<_, i64>(sql)
                .bind(id)
                .fetch_one(&db)
                .await
                .unwrap()
        }
    };
    assert_eq!(
        count("SELECT COUNT(*) FROM gym_members WHERE user_id = ?", me).await,
        0
    );
    assert_eq!(
        count(
            "SELECT COUNT(*) FROM profiles WHERE user_id = ? AND primary_gym_id IS NOT NULL",
            me
        )
        .await,
        0
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM gyms WHERE id = ?", pending).await,
        0
    );
    assert_eq!(
        count(
            "SELECT COUNT(*) FROM gym_verification_requests WHERE submitted_by = ?",
            me
        )
        .await,
        0
    );
    let owner: Option<Uuid> =
        sqlx::query_scalar("SELECT owner_user_id FROM gyms WHERE id = ? AND status = 'VERIFIED'")
            .bind(verified)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(owner, None);
    assert_eq!(
        count(
            "SELECT COUNT(*) FROM gym_members WHERE user_id = ? AND status = 'APPROVED'",
            member
        )
        .await,
        1
    );
}

#[sqlx::test]
async fn anonymising_cuts_the_social_links(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "nour").await;
    let me = user_of(&session);
    let friend = create_user(&app, "sami", Role::User).await;
    let blocked = create_user(&app, "karim", Role::User).await;
    social_links(&app, me, friend, blocked).await;
    delete(&app, &session, PASSWORD).await;
    let swept = privacy::sweep(&app.db, (Utc::now() + Duration::days(31)).naive_utc())
        .await
        .unwrap();
    assert_eq!(swept.anonymised, 1);

    for sql in [
        "SELECT COUNT(*) FROM friendships WHERE user_low_id = ? OR user_high_id = ?",
        "SELECT COUNT(*) FROM follows WHERE follower_id = ? OR followee_id = ?",
        "SELECT COUNT(*) FROM blocks WHERE blocker_id = ? OR blocked_id = ?",
        "SELECT COUNT(*) FROM notifications WHERE user_id = ? OR user_id = ?",
    ] {
        let left: i64 = sqlx::query_scalar(sql)
            .bind(me)
            .bind(me)
            .fetch_one(&app.db)
            .await
            .unwrap();
        assert_eq!(left, 0, "{sql}");
    }
}

/// A `LEVEL_UP` of `user`, as the ledger writes them; its id.
async fn level_up(app: &TestApp, user: Uuid, from: i32) -> Uuid {
    let mut conn = app.db.acquire().await.unwrap();
    let activity = Activity {
        user,
        kind: feed::Kind::LevelUp,
        ref_id: Uuid::now_v7(),
        visibility: "FRIENDS",
        payload: json!({"from": from, "to": from + 1}),
        sport: None,
        exercise: None,
        badge: None,
    };
    feed::record(&mut conn, activity).await.unwrap()
}

/// `user` reacts to and comments on `activity`; the comment's id.
async fn engage(app: &TestApp, user: Uuid, activity: Uuid, comment: &str) -> Uuid {
    sqlx::query(
        "INSERT INTO activity_reactions (activity_event_id, user_id, type) VALUES (?, ?, 'FIRE')",
    )
    .bind(activity)
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO activity_comments (id, activity_event_id, user_id, body) VALUES (?, ?, ?, ?)",
    )
    .bind(id)
    .bind(activity)
    .bind(user)
    .bind(comment)
    .execute(&app.db)
    .await
    .unwrap();
    id
}

async fn liked_post(app: &TestApp, user: Uuid) -> Uuid {
    let post = Uuid::now_v7();
    sqlx::query("INSERT INTO announcements (id, body) VALUES (?, 'Welcome')")
        .bind(post)
        .execute(&app.db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO announcement_likes (announcement_id, user_id) VALUES (?, ?)")
        .bind(post)
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    post
}

#[sqlx::test]
async fn the_export_holds_the_feed(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "nour").await;
    let me = user_of(&session);
    let other = create_user(&app, "sami", Role::User).await;
    let mine = level_up(&app, me, 1).await;
    let theirs = level_up(&app, other, 3).await;
    let comment = engage(&app, me, theirs, "Bravo").await;
    let post = liked_post(&app, me).await;

    let reply = app
        .call(Method::GET, "/api/v1/me/export", access(&session), None)
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    let activities = reply.json["activities"].as_array().unwrap();
    assert_eq!(activities.len(), 1, "{activities:?}");
    assert_eq!(activities[0]["id"], json!(mine));
    assert_eq!(activities[0]["type"], "LEVEL_UP");
    assert_eq!(activities[0]["visibility"], "FRIENDS");
    assert_eq!(activities[0]["details"], json!({"from": 1, "to": 2}));
    assert!(activities[0]["createdAt"].is_string());
    let reactions = reply.json["activityReactions"].as_array().unwrap();
    assert_eq!(reactions.len(), 1);
    assert_eq!(reactions[0]["activityId"], json!(theirs));
    assert_eq!(reactions[0]["type"], "FIRE");
    assert!(reactions[0]["createdAt"].is_string());
    let comments = reply.json["activityComments"].as_array().unwrap();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0]["id"], json!(comment));
    assert_eq!(comments[0]["activityId"], json!(theirs));
    assert_eq!(comments[0]["body"], "Bravo");
    assert!(comments[0]["createdAt"].is_string() && comments[0]["deletedAt"].is_null());
    let likes = reply.json["announcementLikes"].as_array().unwrap();
    assert_eq!(likes.len(), 1);
    assert_eq!(likes[0]["announcementId"], json!(post));
    assert!(likes[0]["createdAt"].is_string());
}

#[sqlx::test]
async fn anonymising_ends_feed_ties(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "nour").await;
    let me = user_of(&session);
    let other = create_user(&app, "sami", Role::User).await;
    let mine = level_up(&app, me, 1).await;
    engage(&app, other, mine, "Bravo Nour").await;
    let theirs = level_up(&app, other, 3).await;
    engage(&app, me, theirs, "Bravo Sami").await;
    liked_post(&app, me).await;
    delete(&app, &session, PASSWORD).await;
    let swept = privacy::sweep(&app.db, (Utc::now() + Duration::days(31)).naive_utc())
        .await
        .unwrap();
    assert_eq!(swept.anonymised, 1);

    for sql in [
        "SELECT COUNT(*) FROM activity_events WHERE user_id = ?",
        "SELECT COUNT(*) FROM activity_reactions WHERE user_id = ?",
        "SELECT COUNT(*) FROM activity_comments WHERE user_id = ?",
        "SELECT COUNT(*) FROM announcement_likes WHERE user_id = ?",
    ] {
        let left: i64 = sqlx::query_scalar(sql)
            .bind(me)
            .fetch_one(&app.db)
            .await
            .unwrap();
        assert_eq!(left, 0, "{sql}");
    }
    // Sami's item stays, without what I left on it.
    for (sql, expected) in [
        ("SELECT COUNT(*) FROM activity_events WHERE id = ?", 1),
        (
            "SELECT COUNT(*) FROM activity_reactions WHERE activity_event_id = ?",
            0,
        ),
        (
            "SELECT COUNT(*) FROM activity_comments WHERE activity_event_id = ?",
            0,
        ),
    ] {
        let left: i64 = sqlx::query_scalar(sql)
            .bind(theirs)
            .fetch_one(&app.db)
            .await
            .unwrap();
        assert_eq!(left, expected, "{sql}");
    }
}
