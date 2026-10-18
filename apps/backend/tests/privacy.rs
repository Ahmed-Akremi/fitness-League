#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode};
use backend::modules::me::privacy::{self, Swept};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use common::{PASSWORD, Reply, TestApp, register, seeded, seeded_with};
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
