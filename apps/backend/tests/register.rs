#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode};
use backend::security::policy::business_today;
use chrono::{Days, Months, Utc};
use common::{
    PASSWORD, TestApp, deliver_mail, post_from, register, registration, seeded, seeded_with,
    seeded_with_cuttable_redis,
};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

const REGISTER: &str = "/api/v1/auth/register";

async fn count(app: &TestApp, table: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {table}")))
        .fetch_one(&app.db)
        .await
        .unwrap()
}

/// `registration` with some fields replaced.
async fn body_with(app: &TestApp, name: &str, changes: Value) -> Value {
    let mut body = registration(app, name).await;
    for (key, value) in changes.as_object().unwrap() {
        body[key] = value.clone();
    }
    body
}

fn codes(reply: &common::Reply) -> Vec<(String, String)> {
    reply.json["errors"]
        .as_array()
        .unwrap_or_else(|| panic!("no field errors in {} {}", reply.status, reply.json))
        .iter()
        .map(|e| {
            (
                e["field"].as_str().unwrap().to_owned(),
                e["code"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

#[sqlx::test]
async fn a_registration_opens_a_session_and_creates_every_row(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let body = body_with(
        &app,
        "ahmed",
        json!({"email": "  Ahmed@Example.COM ", "fullName": "  Ahmed Ben Salah ", "consents": {"terms": true, "privacy": true, "healthData": true, "documentVersion": "2026-09"}}),
    )
    .await;
    let reply = app.post(REGISTER, body).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(reply.json.as_object().unwrap().len(), 4);
    let user = reply.json["userId"].as_str().unwrap().to_owned();

    let (email, role, status, verified, hash): (String, String, String, bool, String) =
        sqlx::query_as(
            "SELECT email, role, status, email_verified_at IS NOT NULL, password_hash FROM users",
        )
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(
        (email.as_str(), role.as_str(), status.as_str(), verified),
        ("ahmed@example.com", "USER", "ACTIVE", false)
    );
    assert!(hash.starts_with("$argon2id$"), "{hash}");
    assert!(!hash.contains(PASSWORD));

    let (name, country, locale, level, division): (String, String, String, i32, Option<String>) = sqlx::query_as(
        "SELECT p.full_name, p.country_code, s.locale, t.level, t.division_code \
         FROM profiles p JOIN user_settings s USING (user_id) JOIN user_stats t USING (user_id) JOIN user_streaks k USING (user_id)",
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(
        (
            name.as_str(),
            country.as_str(),
            locale.as_str(),
            level,
            division
        ),
        ("Ahmed Ben Salah", "TN", "fr", 1, None)
    );

    let consents: Vec<(String, bool, String)> =
        sqlx::query_as("SELECT type, granted, document_version FROM consents ORDER BY type")
            .fetch_all(&app.db)
            .await
            .unwrap();
    let granted: Vec<(&str, bool)> = consents.iter().map(|(t, g, _)| (t.as_str(), *g)).collect();
    assert_eq!(
        granted,
        [
            ("TERMS", true),
            ("PRIVACY", true),
            ("HEALTH_DATA", true),
            ("MARKETING", false)
        ]
    );
    assert!(consents.iter().all(|(_, _, version)| version == "2026-09"));

    let audited: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'USER_REGISTERED' AND HEX(entity_id) = REPLACE(UPPER(?), '-', '')")
        .bind(&user)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(audited, 1);

    // The verification mail is the worker's business.
    let mails = deliver_mail(&app).await;
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].to, "ahmed@example.com");

    // The session works at once.
    let logout = app
        .call(
            Method::POST,
            "/api/v1/auth/logout",
            reply.json["accessToken"].as_str(),
            Some(json!({"refreshToken": reply.json["refreshToken"]})),
        )
        .await;
    assert_eq!(logout.status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn a_taken_email_or_username_is_named(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    register(&app, "ahmed").await;

    let same_email = body_with(&app, "other", json!({"email": "AHMED@example.com"})).await;
    let reply = app.post(REGISTER, same_email).await;
    assert_eq!(
        (reply.status, reply.json["code"].as_str()),
        (StatusCode::CONFLICT, Some("EMAIL_TAKEN"))
    );

    let same_username =
        body_with(&app, "ahmed", json!({"email": "someone.else@example.com"})).await;
    let reply = app.post(REGISTER, same_username).await;
    assert_eq!(
        (reply.status, reply.json["code"].as_str()),
        (StatusCode::CONFLICT, Some("USERNAME_TAKEN"))
    );

    // Both taken: the email is named.
    let reply = app.post(REGISTER, registration(&app, "ahmed").await).await;
    assert_eq!(reply.json["code"], "EMAIL_TAKEN");

    let with_phone = body_with(&app, "leila", json!({"phone": "+21620123456"})).await;
    assert_eq!(
        app.post(REGISTER, with_phone).await.status,
        StatusCode::CREATED
    );
    let same_phone = body_with(&app, "sami", json!({"phone": "+21620123456"})).await;
    assert_eq!(
        app.post(REGISTER, same_phone).await.json["code"],
        "PHONE_TAKEN"
    );

    assert_eq!(count(&app, "users").await, 2);
    assert_eq!(count(&app, "profiles").await, 2);
}

#[sqlx::test]
async fn someone_under_the_minimum_age_is_refused_and_nothing_is_stored(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    // Today in Tunisia, which is where the age is counted.
    let today = business_today(Utc::now(), 60);
    let eighteen_tomorrow = (today + Days::new(1)) - Months::new(18 * 12);
    let eighteen_today = today - Months::new(18 * 12);

    let too_young = body_with(
        &app,
        "young",
        json!({"dateOfBirth": eighteen_tomorrow.to_string()}),
    )
    .await;
    let reply = app.post(REGISTER, too_young).await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(reply.json["code"], "UNDER_AGE");
    assert_eq!(reply.json["minAgeYears"], 18);
    for table in [
        "users",
        "profiles",
        "consents",
        "audit_log",
        "refresh_tokens",
    ] {
        assert_eq!(count(&app, table).await, 0, "{table}");
    }
    assert!(deliver_mail(&app).await.is_empty());

    let born_tomorrow = body_with(
        &app,
        "unborn",
        json!({"dateOfBirth": (today + Days::new(1)).to_string()}),
    )
    .await;
    assert_eq!(
        app.post(REGISTER, born_tomorrow).await.json["code"],
        "UNDER_AGE"
    );

    let just_old_enough = body_with(
        &app,
        "adult",
        json!({"dateOfBirth": eighteen_today.to_string()}),
    )
    .await;
    assert_eq!(
        app.post(REGISTER, just_old_enough).await.status,
        StatusCode::CREATED
    );
}

#[sqlx::test]
async fn every_field_is_checked_and_all_the_problems_come_at_once(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let bad = body_with(
        &app,
        "ahmed",
        json!({
            "username": "Ahmed!",
            "fullName": " A ",
            "email": "ren\u{00E9}@example.com",
            "password": "short",
            "dateOfBirth": "12/04/1998",
            "countryCode": "tn",
            "phone": "0620123456",
            "consents": {"terms": false, "privacy": false, "healthData": false, "documentVersion": ""}
        }),
    )
    .await;
    let reply = app.post(REGISTER, bad).await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    let expected = [
        ("username", "MATCHES"),
        ("fullName", "MINLENGTH"),
        ("email", "ISEMAIL"),
        ("password", "MINLENGTH"),
        ("dateOfBirth", "ISISO8601"),
        ("countryCode", "MATCHES"),
        ("phone", "MATCHES"),
        ("consents.terms", "EQUALS"),
        ("consents.privacy", "EQUALS"),
        ("consents.documentVersion", "MINLENGTH"),
    ];
    let got = codes(&reply);
    let got: Vec<(&str, &str)> = got.iter().map(|(f, c)| (f.as_str(), c.as_str())).collect();
    assert_eq!(got, expected);

    // One problem at a time, for the rules the list above does not reach.
    let one = |changes: Value| {
        let app = &app;
        async move {
            let reply = app
                .post(REGISTER, body_with(app, "ahmed", changes).await)
                .await;
            assert_eq!(
                reply.status,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{}",
                reply.json
            );
            codes(&reply)
        }
    };
    let single = |field: &str, code: &str| vec![(field.to_owned(), code.to_owned())];
    assert_eq!(
        one(json!({"role": "ADMIN"})).await,
        single("role", "UNKNOWN_FIELD")
    );
    assert_eq!(
        one(json!({"password": "1234567890"})).await,
        single("password", "TOO_COMMON")
    );
    assert_eq!(
        one(json!({"password": "Ahmed@Example.com"})).await,
        single("password", "TOO_COMMON")
    );
    assert_eq!(
        one(json!({"password": "x".repeat(129)})).await,
        single("password", "MAXLENGTH")
    );
    assert_eq!(
        one(json!({"gender": "ROBOT"})).await,
        single("gender", "INVALID")
    );
    assert_eq!(
        one(json!({"governorateId": "not-an-id"})).await,
        single("governorateId", "INVALID")
    );
    assert_eq!(
        one(json!({"dateOfBirth": "2001-02-30"})).await,
        single("dateOfBirth", "ISISO8601")
    );
    assert_eq!(
        one(json!({"dateOfBirth": "1899-12-31"})).await,
        single("dateOfBirth", "ISISO8601")
    );
    assert_eq!(
        one(json!({"fullName": "Ahmed\u{0007}Bell"})).await,
        single("fullName", "MATCHES")
    );
    // Characters nobody sees: a name made of nothing, or one that reads backwards on screen.
    assert_eq!(
        one(json!({"fullName": "\u{200B}\u{200B}\u{200B}"})).await,
        single("fullName", "MATCHES")
    );
    assert_eq!(
        one(json!({"fullName": "Ahmed\u{202E}demhA"})).await,
        single("fullName", "MATCHES")
    );
    // No list of invisible characters is ever complete, so a name must also hold two letters or
    // digits: a filler nobody sees, a blank braille pattern, punctuation alone.
    for hollow in [
        "\u{3164}\u{3164}\u{3164}",
        "\u{2800}\u{2800}",
        "-- --",
        "\u{061C}Ahmed",
    ] {
        assert_eq!(
            one(json!({"fullName": hollow})).await,
            single("fullName", "MATCHES"),
            "{hollow:?}"
        );
    }

    // A city of another governorate.
    let (_, elsewhere): (uuid::Uuid, uuid::Uuid) = sqlx::query_as(
        "SELECT g.id, c.id FROM cities c JOIN governorates g ON g.id = c.governorate_id ORDER BY g.code DESC, c.code LIMIT 1",
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(
        one(json!({"cityId": elsewhere.to_string()})).await,
        single("cityId", "NOT_IN_GOVERNORATE")
    );
    assert_eq!(
        one(json!({"countryCode": "FR"})).await,
        single("cityId", "NOT_IN_GOVERNORATE")
    );

    assert_eq!(count(&app, "users").await, 0);
}

#[sqlx::test]
async fn text_is_stored_exactly_as_it_was_sent(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let names = [
        "Robert'); DROP TABLE users;-- ",
        "\" OR \"1\"=\"1",
        "أحمد بن صالح",
        "Zoë 💪 \\ %_",
    ];
    for (i, name) in names.iter().enumerate() {
        let body = body_with(&app, &format!("user{i}"), json!({"fullName": name})).await;
        assert_eq!(
            app.post(REGISTER, body).await.status,
            StatusCode::CREATED,
            "{name}"
        );
    }
    let stored: Vec<String> =
        sqlx::query_scalar("SELECT full_name FROM profiles ORDER BY created_at, user_id")
            .fetch_all(&app.db)
            .await
            .unwrap();
    let expected: Vec<&str> = names.iter().map(|name| name.trim()).collect();
    assert_eq!(stored, expected);
    assert_eq!(count(&app, "users").await, 4);
}

#[sqlx::test]
async fn registration_is_limited_per_address(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let mut statuses = Vec::new();
    for i in 0..8 {
        let body = registration(&app, &format!("user{i}")).await;
        statuses.push(post_from(&app, [5, 5, 5, 5], REGISTER, body).await.status);
    }
    assert_eq!(statuses[..5], [StatusCode::CREATED; 5]);
    // The count is a sliding estimate: the refusal comes with the sixth or just after.
    assert!(
        statuses[5..].contains(&StatusCode::TOO_MANY_REQUESTS),
        "{statuses:?}"
    );
    // Another address is not affected.
    let body = registration(&app, "elsewhere").await;
    assert_eq!(
        post_from(&app, [6, 6, 6, 6], REGISTER, body).await.status,
        StatusCode::CREATED
    );
}

#[sqlx::test]
async fn a_queue_that_is_down_does_not_undo_a_registration(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    // With the limits off, the queue is the only thing that needs Redis.
    let (app, redis) = seeded_with_cuttable_redis(opts, conn, |_| {}).await;
    redis.abort();
    let _ = redis.await;

    let reply = app.post(REGISTER, registration(&app, "ahmed").await).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(count(&app, "users").await, 1);
}
