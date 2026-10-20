#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode};
use common::{Reply, TestApp, register, seeded};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

async fn patch(app: &TestApp, session: &Value, path: &str, body: Value) -> Reply {
    app.call(
        Method::PATCH,
        path,
        session["accessToken"].as_str(),
        Some(body),
    )
    .await
}

const PROFILE: &str = "/api/v1/me/profile";
const SETTINGS: &str = "/api/v1/me/settings";

/// Two governorates, each with one of its cities.
async fn two_places(app: &TestApp) -> [(Uuid, Uuid); 2] {
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT g.id, MIN(c.id) FROM governorates g JOIN cities c ON c.governorate_id = g.id \
         GROUP BY g.id ORDER BY g.code DESC LIMIT 2",
    )
    .fetch_all(&app.db)
    .await
    .unwrap();
    [rows[0], rows[1]]
}

#[sqlx::test]
async fn the_profile_changes_what_is_sent_and_keeps_the_rest(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let [(governorate, city), _] = two_places(&app).await;

    let reply = patch(
        &app,
        &session,
        PROFILE,
        json!({
            "fullName": "  Ahmed Ben Salah ", "bio": "Rx athlete", "gender": "MALE",
            "governorateId": governorate, "cityId": city,
            "experienceLevelDeclared": "ADVANCED", "plannedTrainingDaysPerWeek": 5
        }),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    // The answer is the whole `GET /me` payload.
    assert_eq!(reply.json["username"], "ahmed");
    let profile = &reply.json["profile"];
    assert_eq!(profile["fullName"], "Ahmed Ben Salah");
    assert_eq!(profile["bio"], "Rx athlete");
    assert_eq!(profile["gender"], "MALE");
    assert_eq!(profile["governorate"]["id"], governorate.to_string());
    assert_eq!(profile["city"]["id"], city.to_string());
    assert_eq!(profile["experienceLevelDeclared"], "ADVANCED");
    assert_eq!(profile["plannedTrainingDaysPerWeek"], 5);

    // What the onboarding screen sends: one field, the others stay.
    let reply = patch(
        &app,
        &session,
        PROFILE,
        json!({"plannedTrainingDaysPerWeek": 4}),
    )
    .await;
    let profile = &reply.json["profile"];
    assert_eq!(profile["plannedTrainingDaysPerWeek"], 4);
    assert_eq!(profile["bio"], "Rx athlete");
    assert_eq!(profile["gender"], "MALE");

    // `null` clears what may be cleared, and means "unchanged" elsewhere.
    let reply = patch(
        &app,
        &session,
        PROFILE,
        json!({"bio": null, "gender": null, "fullName": null}),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    let profile = &reply.json["profile"];
    assert!(profile["bio"].is_null() && profile["gender"].is_null());
    assert_eq!(profile["fullName"], "Ahmed Ben Salah");

    // An empty change is no change.
    assert_eq!(
        patch(&app, &session, PROFILE, json!({})).await.json["profile"],
        *profile
    );
}

#[sqlx::test]
async fn a_profile_change_is_checked_before_anything_is_written(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;
    let [(governorate, city), (other_governorate, other_city)] = two_places(&app).await;

    let cases = [
        (
            json!({"cityId": city}),
            "governorateId",
            "REQUIRED_TOGETHER",
        ),
        (
            json!({"governorateId": governorate}),
            "cityId",
            "REQUIRED_TOGETHER",
        ),
        (
            json!({"governorateId": governorate, "cityId": other_city}),
            "cityId",
            "NOT_IN_GOVERNORATE",
        ),
        (json!({"fullName": "A"}), "fullName", "MINLENGTH"),
        (
            json!({"fullName": "Ahmed\u{202E}nimda"}),
            "fullName",
            "MATCHES",
        ),
        (json!({"bio": "x".repeat(281)}), "bio", "MAXLENGTH"),
        (json!({"gender": "OTHER"}), "gender", "INVALID"),
        (
            json!({"plannedTrainingDaysPerWeek": 8}),
            "plannedTrainingDaysPerWeek",
            "MAX",
        ),
        (
            json!({"plannedTrainingDaysPerWeek": 2.5}),
            "plannedTrainingDaysPerWeek",
            "INVALID",
        ),
        (
            json!({"experienceLevelDeclared": null, "username": "root"}),
            "username",
            "UNKNOWN_FIELD",
        ),
        (json!({"countryCode": "FR"}), "countryCode", "UNKNOWN_FIELD"),
    ];
    for (body, field, code) in cases {
        let reply = patch(&app, &session, PROFILE, body.clone()).await;
        assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(
            reply.json["errors"],
            json!([{"field": field, "code": code}]),
            "{body}"
        );
    }
    // Nothing of the refused changes was kept.
    let me = app
        .call(
            Method::GET,
            "/api/v1/me",
            session["accessToken"].as_str(),
            None,
        )
        .await
        .json;
    assert_eq!(me["profile"]["fullName"], "Athlete ahmed");
    assert_ne!(
        me["profile"]["governorate"]["id"],
        other_governorate.to_string()
    );
}

#[sqlx::test]
async fn a_profile_change_touches_only_ones_own(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let ahmed = register(&app, "ahmed").await;
    let leila = register(&app, "leila").await;
    patch(&app, &ahmed, PROFILE, json!({"bio": "mine"})).await;
    patch(&app, &ahmed, SETTINGS, json!({"theme": "LIGHT"})).await;
    let me = app
        .call(
            Method::GET,
            "/api/v1/me",
            leila["accessToken"].as_str(),
            None,
        )
        .await
        .json;
    assert!(me["profile"]["bio"].is_null());
    assert_eq!(me["settings"]["theme"], "DARK");
}

#[sqlx::test]
async fn the_settings_change_what_is_sent(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let session = register(&app, "ahmed").await;

    let reply = patch(
        &app,
        &session,
        SETTINGS,
        json!({
            "locale": "ar", "theme": "SYSTEM", "reducedMotion": true, "defaultVisibility": "PRIVATE",
            "showAgeBracket": true, "showOnLeaderboards": false, "streakFreezeDaysPerWeek": 0
        }),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    assert_eq!(
        reply.json["settings"],
        json!({"locale": "ar", "theme": "SYSTEM", "reducedMotion": true, "defaultVisibility": "PRIVATE",
               "showAgeBracket": true, "showOnLeaderboards": false, "streakFreezeDaysPerWeek": 0})
    );

    // One switch at a time, as the settings screen sends them.
    let settings = patch(
        &app,
        &session,
        SETTINGS,
        json!({"showOnLeaderboards": true}),
    )
    .await
    .json["settings"]
        .clone();
    assert_eq!(settings["showOnLeaderboards"], true);
    assert_eq!(settings["reducedMotion"], true);
    assert_eq!(settings["locale"], "ar");

    // `reducedMotion: null` is "follow the device"; leaving it out changes nothing.
    let settings = patch(&app, &session, SETTINGS, json!({"reducedMotion": null}))
        .await
        .json["settings"]
        .clone();
    assert!(settings["reducedMotion"].is_null());
    assert_eq!(settings["theme"], "SYSTEM");

    for (body, field, code) in [
        (
            json!({"streakFreezeDaysPerWeek": 5}),
            "streakFreezeDaysPerWeek",
            "MAX",
        ),
        (
            json!({"streakFreezeDaysPerWeek": -1}),
            "streakFreezeDaysPerWeek",
            "MIN",
        ),
        (json!({"theme": "PINK"}), "theme", "INVALID"),
        (json!({"locale": "de"}), "locale", "INVALID"),
        (
            json!({"showAgeBracket": "yes"}),
            "showAgeBracket",
            "INVALID",
        ),
        (json!({"role": "ADMIN"}), "role", "UNKNOWN_FIELD"),
    ] {
        let reply = patch(&app, &session, SETTINGS, body.clone()).await;
        assert_eq!(
            reply.json["errors"],
            json!([{"field": field, "code": code}]),
            "{body}"
        );
    }
}
