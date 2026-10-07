#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use axum::http::{Method, StatusCode};
use backend::{modules::auth::sessions, security::tokens::Audience, types::Role};
use common::{Reply, TestApp, create_user, open_session, seeded, seeded_with};
use secrecy::ExposeSecret;
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

async fn refresh(app: &TestApp, token: &str) -> Reply {
    app.post("/api/v1/auth/refresh", json!({"refreshToken": token}))
        .await
}

async fn logout(app: &TestApp, access: &str, refresh: &str) -> Reply {
    app.call(
        Method::POST,
        "/api/v1/auth/logout",
        Some(access),
        Some(json!({"refreshToken": refresh})),
    )
    .await
}

fn text(session: &Value, key: &str) -> String {
    session[key].as_str().unwrap().to_owned()
}

/// A user and an app session of theirs.
async fn signed_in(app: &TestApp, name: &str) -> (Uuid, Value) {
    let user = create_user(app, name, Role::User).await;
    (
        user,
        open_session(app, user, Role::User, Audience::App).await,
    )
}

async fn set(app: &TestApp, user: Uuid, assignment: &str) {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE users SET {assignment} WHERE id = ?"
    )))
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
}

#[sqlx::test]
async fn a_session_has_the_four_fields_the_apps_read(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (user, session) = signed_in(&app, "ahmed").await;
    assert_eq!(session.as_object().unwrap().len(), 4);
    assert_eq!(text(&session, "accessToken").split('.').count(), 3);
    assert_eq!(session["expiresIn"], 900);
    assert_eq!(text(&session, "refreshToken").len(), 43);
    assert_eq!(session["userId"], user.to_string());
    // Only the hash of the refresh token is stored.
    let stored: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens WHERE token_hash = ?")
            .bind(&backend::security::tokens::hash_opaque(&text(&session, "refreshToken"))[..])
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(stored, 1);
}

#[sqlx::test]
async fn a_refresh_replaces_the_token_and_a_second_use_revokes_the_family(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (user, first) = signed_in(&app, "ahmed").await;

    let second = refresh(&app, &text(&first, "refreshToken")).await;
    assert_eq!(second.status, StatusCode::OK);
    assert_ne!(second.json["refreshToken"], first["refreshToken"]);
    assert_eq!(second.json["userId"], user.to_string());

    // The first token again: it was copied. Everything descended from that sign-in ends.
    let replay = refresh(&app, &text(&first, "refreshToken")).await;
    assert_eq!(replay.status, StatusCode::UNAUTHORIZED);
    assert_eq!(replay.json["code"], "TOKEN_REUSED");
    let after = refresh(&app, &text(&second.json, "refreshToken")).await;
    assert_eq!(after.status, StatusCode::UNAUTHORIZED);
    assert_eq!(after.json["code"], "TOKEN_INVALID");

    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'REFRESH_TOKEN_REUSE_DETECTED' AND entity_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(audited, 1);
}

#[sqlx::test]
async fn of_two_refreshes_at_the_same_instant_one_wins(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (_, session) = signed_in(&app, "ahmed").await;
    let token = text(&session, "refreshToken");

    let (a, b) = tokio::join!(refresh(&app, &token), refresh(&app, &token));
    let (winner, loser) = if a.status == StatusCode::OK {
        (a, b)
    } else {
        (b, a)
    };
    assert_eq!(winner.status, StatusCode::OK);
    assert_eq!(loser.status, StatusCode::UNAUTHORIZED);
    assert_eq!(loser.json["code"], "TOKEN_REUSED");
    // The copy was noticed: the winner's new token is revoked with the rest of the family.
    let next = refresh(&app, &text(&winner.json, "refreshToken")).await;
    assert_eq!(next.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn a_refresh_token_only_works_for_its_own_audience(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (_, session) = signed_in(&app, "ahmed").await;
    let token = text(&session, "refreshToken");

    let err = sessions::refresh(&app.state, &token, Audience::Admin)
        .await
        .unwrap_err();
    assert_eq!(
        (err.status, err.code),
        (StatusCode::UNAUTHORIZED, "TOKEN_INVALID")
    );
    // The mistake did not use the token up.
    assert_eq!(refresh(&app, &token).await.status, StatusCode::OK);
}

#[sqlx::test]
async fn an_expired_or_unknown_refresh_token_is_refused(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (user, session) = signed_in(&app, "ahmed").await;
    sqlx::query("UPDATE refresh_tokens SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE user_id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    let expired = refresh(&app, &text(&session, "refreshToken")).await;
    assert_eq!(expired.status, StatusCode::UNAUTHORIZED);
    assert_eq!(expired.json["code"], "TOKEN_EXPIRED");

    let unknown = refresh(&app, &"x".repeat(43)).await;
    assert_eq!(unknown.json["code"], "TOKEN_INVALID");
    let short = refresh(&app, "too-short").await;
    assert_eq!(short.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        short.json["errors"],
        json!([{"field": "refreshToken", "code": "MINLENGTH"}])
    );
}

#[sqlx::test]
async fn a_banned_account_cannot_refresh_and_loses_the_session(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (user, session) = signed_in(&app, "ahmed").await;
    set(&app, user, "status = 'BANNED'").await;
    let banned = refresh(&app, &text(&session, "refreshToken")).await;
    assert_eq!(banned.status, StatusCode::FORBIDDEN);
    assert_eq!(banned.json["code"], "ACCOUNT_BANNED");

    // Lifting the ban does not bring the old session back.
    set(&app, user, "status = 'ACTIVE'").await;
    let after = refresh(&app, &text(&session, "refreshToken")).await;
    assert_eq!(after.json["code"], "TOKEN_INVALID");
}

#[sqlx::test]
async fn logout_ends_ones_own_session_and_no_one_elses(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (_, mine) = signed_in(&app, "ahmed").await;
    let (_, theirs) = signed_in(&app, "leila").await;

    // Someone else's refresh token: the same quiet answer, and nothing happens to it.
    let quiet = logout(
        &app,
        &text(&mine, "accessToken"),
        &text(&theirs, "refreshToken"),
    )
    .await;
    assert_eq!(quiet.status, StatusCode::NO_CONTENT);
    assert_eq!(
        refresh(&app, &text(&theirs, "refreshToken")).await.status,
        StatusCode::OK
    );

    let done = logout(
        &app,
        &text(&mine, "accessToken"),
        &text(&mine, "refreshToken"),
    )
    .await;
    assert_eq!(done.status, StatusCode::NO_CONTENT);
    let after = refresh(&app, &text(&mine, "refreshToken")).await;
    assert_eq!(after.status, StatusCode::UNAUTHORIZED);
    assert_eq!(after.json["code"], "TOKEN_INVALID");
}

/// A token signed with the application's key whose life ended a minute ago.
fn expired_token(app: &TestApp, user: Uuid) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::EdDSA);
    header.kid = Some("k1".to_owned());
    let claims = json!({"sub": user.to_string(), "role": "USER", "sv": 1, "aud": "app", "iss": "fitness-league", "iat": now - 960, "exp": now - 60});
    let key = jsonwebtoken::EncodingKey::from_ed_pem(
        app.state.cfg.jwt_private_key_pem.expose_secret().as_bytes(),
    )
    .unwrap();
    jsonwebtoken::encode(&header, &claims, &key).unwrap()
}

#[sqlx::test]
async fn a_protected_route_wants_a_valid_token_of_its_own_audience(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (user, session) = signed_in(&app, "ahmed").await;
    let body = || Some(json!({"refreshToken": "x".repeat(43)}));
    let with = |token: Option<String>| {
        let app = &app;
        async move {
            app.call(
                Method::POST,
                "/api/v1/auth/logout",
                token.as_deref(),
                body(),
            )
            .await
        }
    };

    let none = with(None).await;
    assert_eq!(
        (none.status, none.json["code"].as_str()),
        (StatusCode::UNAUTHORIZED, Some("UNAUTHENTICATED"))
    );
    let garbage = with(Some("not.a.token".into())).await;
    assert_eq!(
        (garbage.status, garbage.json["code"].as_str()),
        (StatusCode::UNAUTHORIZED, Some("TOKEN_INVALID"))
    );
    let expired = with(Some(expired_token(&app, user))).await;
    assert_eq!(
        (expired.status, expired.json["code"].as_str()),
        (StatusCode::UNAUTHORIZED, Some("TOKEN_EXPIRED"))
    );

    // A token of the admin panel is not a token of the app.
    let panel = open_session(&app, user, Role::User, Audience::Admin).await;
    let wrong = with(Some(text(&panel, "accessToken"))).await;
    assert_eq!(
        (wrong.status, wrong.json["code"].as_str()),
        (StatusCode::UNAUTHORIZED, Some("TOKEN_INVALID"))
    );

    assert_eq!(
        with(Some(text(&session, "accessToken"))).await.status,
        StatusCode::NO_CONTENT
    );
}

#[sqlx::test]
async fn a_change_to_the_account_applies_on_the_very_next_request(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (user, session) = signed_in(&app, "ahmed").await;
    let access = text(&session, "accessToken");
    let unknown = "x".repeat(43);
    let call = || logout(&app, &access, &unknown);
    assert_eq!(call().await.status, StatusCode::NO_CONTENT);

    set(
        &app,
        user,
        "status = 'SUSPENDED', suspended_until = UTC_TIMESTAMP(6) + INTERVAL 1 DAY",
    )
    .await;
    let suspended = call().await;
    assert_eq!(suspended.status, StatusCode::FORBIDDEN);
    assert_eq!(suspended.json["code"], "ACCOUNT_SUSPENDED");
    assert!(suspended.json["suspendedUntil"].is_string());

    // A suspension that is over no longer refuses anyone.
    set(
        &app,
        user,
        "suspended_until = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND",
    )
    .await;
    assert_eq!(call().await.status, StatusCode::NO_CONTENT);

    set(&app, user, "status = 'BANNED'").await;
    assert_eq!(call().await.json["code"], "ACCOUNT_BANNED");

    // What a password reset or a role change does: every token signed before it is dead.
    set(
        &app,
        user,
        "status = 'ACTIVE', session_version = session_version + 1",
    )
    .await;
    let stale = call().await;
    assert_eq!(
        (stale.status, stale.json["code"].as_str()),
        (StatusCode::UNAUTHORIZED, Some("TOKEN_INVALID"))
    );

    set(&app, user, "session_version = 1, status = 'DELETED'").await;
    assert_eq!(call().await.json["code"], "TOKEN_INVALID");
}

#[sqlx::test]
async fn a_judge_cannot_use_an_app_route_even_with_an_app_token(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let judge = create_user(&app, "judge", Role::Judge).await;
    // The sign-in refuses judges (Task 6); a token minted some other way is refused here too.
    let session = open_session(&app, judge, Role::Judge, Audience::App).await;
    let refused = logout(&app, &text(&session, "accessToken"), &"x".repeat(43)).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.json["code"], "FORBIDDEN");
}

#[sqlx::test]
async fn the_limits_of_a_user_and_of_the_refresh_route(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded_with(opts, conn, |vars| {
        vars.insert("RATE_LIMIT_ENABLED".into(), "true".into());
    })
    .await;
    let (_, session) = signed_in(&app, "ahmed").await;
    let access = text(&session, "accessToken");

    // 120 a minute per signed-in user. The count is a sliding estimate: allow a few more.
    let mut refused = None;
    for _ in 0..130 {
        let reply = logout(&app, &access, &"x".repeat(43)).await;
        if reply.status != StatusCode::NO_CONTENT {
            refused = Some(reply);
            break;
        }
    }
    let refused = refused.expect("130 requests of one user were all allowed");
    assert_eq!(refused.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(refused.headers.contains_key("retry-after"));

    // 30 a minute per address on the refresh route, whatever the answers were.
    let mut statuses = Vec::new();
    for _ in 0..36 {
        statuses.push(
            app.send(
                common::request(Method::POST, "/api/v1/auth/refresh")
                    .extension(common::from_ip([8, 8, 4, 4]))
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(
                        json!({"refreshToken": "x".repeat(43)}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .status,
        );
    }
    assert_eq!(statuses[..30], [StatusCode::UNAUTHORIZED; 30]);
    assert!(
        statuses[30..].contains(&StatusCode::TOO_MANY_REQUESTS),
        "{statuses:?}"
    );
}
