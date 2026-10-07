#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use std::path::Path;

use axum::http::{Method, StatusCode};
use backend::{security::tokens::Audience, types::Role};
use common::{TestApp, a_place, assert_same_shape, create_user, open_session, register, seeded};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const ME: &str = "/api/v1/me";

async fn me(app: &TestApp, session: &Value) -> common::Reply {
    app.call(Method::GET, ME, session["accessToken"].as_str(), None)
        .await
}

#[sqlx::test]
async fn me_is_the_payload_the_app_reads(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let (governorate, city) = a_place(&app).await;

    let reply = me(&app, &session).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    let body = &reply.json;
    // Born on 1995-05-05: between 25 and 34 for the life of this test.
    let top = json!({
        "id": session["userId"], "username": "ahmed", "email": "ahmed@example.com",
        "emailVerified": false, "role": "USER", "ageBracket": "25-34"
    });
    for (key, value) in top.as_object().unwrap() {
        assert_eq!(&body[key], value, "{key}");
    }
    assert_eq!(body.as_object().unwrap().len(), 10, "{body}");

    let profile = &body["profile"];
    assert_eq!(profile["fullName"], "Athlete ahmed");
    assert_eq!(profile["countryCode"], "TN");
    assert_eq!(profile["governorate"]["id"], governorate.to_string());
    assert!(profile["governorate"]["code"].is_string());
    for language in ["fr", "en", "ar"] {
        assert!(
            profile["governorate"]["name"][language].is_string(),
            "{language}"
        );
        assert!(profile["city"]["name"][language].is_string(), "{language}");
    }
    assert_eq!(profile["city"]["id"], city.to_string());
    for absent in [
        "bio",
        "gender",
        "gym",
        "experienceLevelDeclared",
        "calibrationEndsAt",
    ] {
        assert!(profile[absent].is_null(), "{absent}");
        assert!(
            profile.as_object().unwrap().contains_key(absent),
            "{absent} must be present, as null"
        );
    }
    assert_eq!(profile["plannedTrainingDaysPerWeek"], 3);
    assert_eq!(profile["onboardingCompleted"], false);
    assert_eq!(profile["sports"], json!([]));

    assert_eq!(
        body["settings"],
        json!({"locale": "fr", "theme": "DARK", "reducedMotion": null, "defaultVisibility": "FRIENDS",
               "showAgeBracket": false, "showOnLeaderboards": true, "streakFreezeDaysPerWeek": 2})
    );
    assert_eq!(
        body["stats"],
        json!({"xpTotal": 0, "level": 1, "levelTitleKey": "level.title.beginner", "xpIntoLevel": 0,
               "xpForNextLevel": 100, "seasonLp": 0, "division": null, "leaderboardEligible": false})
    );
    assert_eq!(
        body["streak"],
        json!({"currentWeeks": 0, "longestWeeks": 0, "currentDays": 0})
    );

    // Neither the date of birth nor anything about the password leaves the API.
    let text = body.to_string();
    assert!(
        !text.contains("1995")
            && !text.contains("argon")
            && !text.to_lowercase().contains("password"),
        "{text}"
    );
}

#[sqlx::test]
async fn me_has_the_shape_recorded_from_the_old_api(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let recorded: Value = serde_json::from_str(
        &std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../mobile-rn/assets/demo/api.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_same_shape(
        "GET /me",
        &recorded["GET /me"],
        &me(&app, &session).await.json,
    );
    // The session too: the app's offline demo holds one.
    assert_same_shape("POST /auth/login", &recorded["POST /auth/login"], &session);
}

#[sqlx::test]
async fn me_follows_the_account(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let user: Uuid = session["userId"].as_str().unwrap().parse().unwrap();
    let sports: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, code FROM sports ORDER BY code LIMIT 2")
            .fetch_all(&app.db)
            .await
            .unwrap();
    for (i, (sport, _)) in sports.iter().enumerate() {
        sqlx::query("INSERT INTO user_sports (user_id, sport_id, is_primary) VALUES (?, ?, ?)")
            .bind(user)
            .bind(sport)
            .bind(i == 1)
            .execute(&app.db)
            .await
            .unwrap();
    }
    sqlx::query("UPDATE users SET email_verified_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE profiles SET onboarding_completed_at = UTC_TIMESTAMP(6), calibration_ends_at = '2026-11-01 08:00:00.000000', \
         bio = 'Rx athlete', gender = 'MALE' WHERE user_id = ?",
    )
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
    sqlx::query("UPDATE user_stats SET level = 7, xp_total = 5000000000 WHERE user_id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();

    let body = me(&app, &session).await.json;
    assert_eq!(body["emailVerified"], true);
    // The primary sport first.
    assert_eq!(
        body["profile"]["sports"],
        json!([
            {"id": sports[1].0.to_string(), "code": sports[1].1, "isPrimary": true},
            {"id": sports[0].0.to_string(), "code": sports[0].1, "isPrimary": false}
        ])
    );
    assert_eq!(body["profile"]["onboardingCompleted"], true);
    assert_eq!(
        body["profile"]["calibrationEndsAt"],
        "2026-11-01T08:00:00.000Z"
    );
    assert_eq!(body["profile"]["bio"], "Rx athlete");
    assert_eq!(body["profile"]["gender"], "MALE");
    assert_eq!(body["stats"]["level"], 7);
    assert_eq!(body["stats"]["levelTitleKey"], "level.title.rookie");
    assert_eq!(body["stats"]["xpTotal"], 5_000_000_000_i64);
}

#[sqlx::test]
async fn me_is_ones_own_and_needs_an_app_session(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let ahmed = register(&app, "ahmed").await;
    let leila = register(&app, "leila").await;
    assert_eq!(me(&app, &ahmed).await.json["username"], "ahmed");
    assert_eq!(me(&app, &leila).await.json["username"], "leila");

    assert_eq!(
        app.call(Method::GET, ME, None, None).await.json["code"],
        "UNAUTHENTICATED"
    );
    let admin = create_user(&app, "admin", Role::Admin).await;
    let panel = open_session(&app, admin, Role::Admin, Audience::Admin).await;
    assert_eq!(me(&app, &panel).await.json["code"], "TOKEN_INVALID");
    // The same administrator, signed in to the app, has a profile like anyone.
    let in_app = open_session(&app, admin, Role::Admin, Audience::App).await;
    assert_eq!(me(&app, &in_app).await.json["role"], "ADMIN");
}
