#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Gyms: the directory, submissions, profiles, memberships, coaches and the dashboard.
mod common;

use axum::http::{Method, StatusCode};
use backend::{rules::Rules, security::tokens::Audience, types::Role};
use common::{
    Reply, TestApp, a_gym, a_place, assert_same_shape, create_user, member_of, open_session,
    recorded, seeded,
    workouts::{athlete, get},
};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const GYMS: &str = "/api/v1/gyms";
/// Bodynade in the recorded answers: a gym with members, top athletes and a social link.
const BODYNADE: &str = "GET /gyms/01a0e9e3-45e7-78b3-adf7-00d0f6fb6ab2";

/// An athlete whose email is verified, as submitting a gym needs.
async fn verified(app: &TestApp, name: &str) -> (Uuid, String) {
    let (user, token) = athlete(app, name).await;
    sqlx::query("UPDATE users SET email_verified_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    (user, token)
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

async fn ok(app: &TestApp, token: &str, path: &str) -> Value {
    let reply = get(app, token, path).await;
    assert_eq!(reply.status, StatusCode::OK, "{path}: {}", reply.json);
    reply.json
}

fn names(page: &Value) -> Vec<&str> {
    page["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["name"].as_str().unwrap())
        .collect()
}

fn errors(reply: &Reply) -> Vec<(String, String)> {
    assert_eq!(
        reply.status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{}",
        reply.json
    );
    reply.json["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["field"].as_str().unwrap().to_owned(),
                e["code"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

fn error(field: &str, code: &str) -> Vec<(String, String)> {
    vec![(field.to_owned(), code.to_owned())]
}

/// The catalog's sports, by code: `(id, code)`.
async fn sports(app: &TestApp) -> Vec<(Uuid, String)> {
    sqlx::query_as("SELECT id, code FROM sports ORDER BY code")
        .fetch_all(&app.db)
        .await
        .unwrap()
}

/// A submission that passes every rule. A test changes the field it is about.
async fn submission(app: &TestApp, name: &str) -> Value {
    let (governorate, city) = a_place(app).await;
    json!({
        "name": name,
        "governorateId": governorate,
        "cityId": city,
        "addressLine": "Route de la Corniche",
        "contactPhone": "+21673000000",
        "contactEmail": "Contact@Sahel.tn",
        "socialLinks": {"instagram": "https://instagram.com/sahel.iron"},
        "sportIds": [sports(app).await[0].0],
        "proofOfOwnership": "Registre de commerce B123456",
    })
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

#[sqlx::test]
async fn the_directory(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (owner, token) = verified(&app, "owner").await;
    let sahel = a_gym(&app, owner, "Sahel Iron").await;
    let (member, _) = athlete(&app, "member").await;
    member_of(&app, member, sahel).await;
    let (other, _) = athlete(&app, "other").await;
    let ariana = a_gym(&app, other, "Ariana Fit").await;
    // Ariana offers no sport, so a sport filter keeps Sahel only.
    sqlx::query("DELETE FROM gym_sports WHERE gym_id = ?")
        .bind(ariana)
        .execute(&app.db)
        .await
        .unwrap();
    let (_, submitter_token) = verified(&app, "submitter").await;
    let created = call(
        &app,
        Method::POST,
        GYMS,
        &submitter_token,
        Some(submission(&app, "Pending Gym").await),
    )
    .await;
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.json);

    let by_name = ok(&app, &token, GYMS).await;
    assert_eq!(names(&by_name), ["Ariana Fit", "Sahel Iron"]);
    assert_same_shape("GET /gyms", &recorded("GET /gyms"), &by_name);
    assert_eq!(by_name["data"][1]["membersCount"], 2);
    assert_eq!(by_name["data"][1]["sports"].as_array().unwrap().len(), 2);
    let by_members = ok(&app, &token, &format!("{GYMS}?sort=members")).await;
    assert_eq!(names(&by_members), ["Sahel Iron", "Ariana Fit"]);
    assert_same_shape(
        "GET /gyms?sort=members",
        &recorded("GET /gyms?sort=members"),
        &by_members,
    );

    for (sort, expected) in [
        ("name", ["Ariana Fit", "Sahel Iron"]),
        ("members", ["Sahel Iron", "Ariana Fit"]),
    ] {
        let first = ok(&app, &token, &format!("{GYMS}?sort={sort}&limit=1")).await;
        assert_eq!(names(&first), [expected[0]], "{sort}");
        assert_eq!(first["page"]["hasMore"], true, "{sort}");
        let cursor = first["page"]["nextCursor"].as_str().unwrap();
        let second = ok(
            &app,
            &token,
            &format!("{GYMS}?sort={sort}&limit=1&cursor={cursor}"),
        )
        .await;
        assert_eq!(names(&second), [expected[1]], "{sort}");
        assert_eq!(second["page"]["hasMore"], false, "{sort}");
    }

    let name_cursor = ok(&app, &token, &format!("{GYMS}?limit=1")).await["page"]["nextCursor"]
        .as_str()
        .unwrap()
        .to_owned();
    let mismatch = get(
        &app,
        &token,
        &format!("{GYMS}?sort=members&cursor={name_cursor}"),
    )
    .await;
    assert_eq!(errors(&mismatch), error("cursor", "CURSOR_SORT_MISMATCH"));

    for q in ["sahel", "S%C3%82HEL", "%20iron%20"] {
        let found = ok(&app, &token, &format!("{GYMS}?q={q}")).await;
        assert_eq!(names(&found), ["Sahel Iron"], "{q}");
    }
    for q in ["%25", "_"] {
        let found = ok(&app, &token, &format!("{GYMS}?q={q}")).await;
        assert!(names(&found).is_empty(), "{q}");
    }
    let code = &sports(&app).await[0].1;
    let filtered = ok(&app, &token, &format!("{GYMS}?sport={code}")).await;
    assert_eq!(names(&filtered), ["Sahel Iron"]);
    let (governorate, _) = a_place(&app).await;
    let local = ok(&app, &token, &format!("{GYMS}?governorateId={governorate}")).await;
    assert_eq!(names(&local), ["Ariana Fit", "Sahel Iron"]);

    for (query, field, code) in [
        ("sport=NOPE", "sport", "UNKNOWN_SPORT"),
        ("sport=x", "sport", "MATCHES"),
        ("governorateId=x", "governorateId", "ISUUID"),
        ("sort=size", "sort", "ISIN"),
    ] {
        let refused = get(&app, &token, &format!("{GYMS}?{query}")).await;
        assert_eq!(errors(&refused), error(field, code), "{query}");
    }
    let long = get(&app, &token, &format!("{GYMS}?q={}", "a".repeat(81))).await;
    assert_eq!(errors(&long), error("q", "MAXLENGTH"));
}

#[sqlx::test]
async fn creating_a_gym(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (owner, token) = verified(&app, "owner").await;
    let body = submission(&app, "Sahel Iron Club").await;
    let created = call(&app, Method::POST, GYMS, &token, Some(body.clone())).await;
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.json);
    assert_eq!(created.json["slug"], "sahel-iron-club");
    assert_eq!(created.json["status"], "PENDING");
    let id = created.json["id"].as_str().unwrap().to_owned();
    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'GYM_SUBMITTED' AND entity_id = ? \
           AND JSON_VALUE(after_json, '$.gymId') = ?",
    )
    .bind(owner)
    .bind(&id)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(audited, 1);
    let stored: (String, Option<String>, Option<String>, String) = sqlx::query_as(
        "SELECT g.name, g.contact_email, g.instagram_url, r.proof_text FROM gyms g \
           JOIN gym_verification_requests r ON r.gym_id = g.id WHERE g.id = ?",
    )
    .bind(Uuid::parse_str(&id).unwrap())
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(
        stored,
        (
            "Sahel Iron Club".to_owned(),
            Some("contact@sahel.tn".to_owned()),
            Some("https://instagram.com/sahel.iron".to_owned()),
            "Registre de commerce B123456".to_owned()
        )
    );

    let mine = ok(&app, &token, &format!("{GYMS}/mine")).await;
    assert_same_shape("GET /gyms/mine", &recorded("GET /gyms/mine"), &mine);
    assert_eq!(mine[0]["id"], id.as_str());
    assert_eq!(mine[0]["status"], "PENDING");
    assert!(names(&ok(&app, &token, GYMS).await).is_empty());
    let hidden = get(&app, &token, &format!("{GYMS}/{id}")).await;
    assert_eq!(hidden.status, StatusCode::NOT_FOUND);

    let again = call(&app, Method::POST, GYMS, &token, Some(body.clone())).await;
    assert_eq!(again.status, StatusCode::CONFLICT, "{}", again.json);
    assert_eq!(again.json["code"], "CONFLICT");
    let (_, other) = verified(&app, "other").await;
    let twin = call(&app, Method::POST, GYMS, &other, Some(body.clone())).await;
    assert_eq!(twin.status, StatusCode::CREATED, "{}", twin.json);
    assert_eq!(twin.json["slug"], "sahel-iron-club-2");
    let (_, unverified) = athlete(&app, "unverified").await;
    let refused = call(&app, Method::POST, GYMS, &unverified, Some(body.clone())).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.json["code"], "EMAIL_NOT_VERIFIED");

    let (_, third) = verified(&app, "third").await;
    let (_, far_city): (Uuid, Uuid) = sqlx::query_as(
        "SELECT g.id, c.id FROM cities c JOIN governorates g ON g.id = c.governorate_id \
         ORDER BY g.code DESC, c.code LIMIT 1",
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    let mut elsewhere = body.clone();
    elsewhere["cityId"] = json!(far_city);
    let reply = call(&app, Method::POST, GYMS, &third, Some(elsewhere)).await;
    assert_eq!(errors(&reply), error("cityId", "NOT_IN_GOVERNORATE"));
    let mut unknown = body.clone();
    unknown["sportIds"] = json!([Uuid::now_v7()]);
    let reply = call(&app, Method::POST, GYMS, &third, Some(unknown)).await;
    assert_eq!(errors(&reply), error("sportIds", "UNKNOWN_SPORT"));

    let mut broken = body.clone();
    broken["socialLinks"] = json!({"myspace": "https://x.tn", "instagram": "ftp://x"});
    broken["name"] = json!("  ab ");
    broken["contactPhone"] = json!("123");
    broken["proofOfOwnership"] = json!("short");
    let reply = call(&app, Method::POST, GYMS, &third, Some(broken)).await;
    let mut found = errors(&reply);
    found.sort();
    let mut expected = vec![
        ("contactPhone", "MATCHES"),
        ("name", "MINLENGTH"),
        ("proofOfOwnership", "MINLENGTH"),
        ("socialLinks.instagram", "INVALID_LINK"),
        ("socialLinks.myspace", "INVALID_LINK"),
    ]
    .into_iter()
    .map(|(f, c)| (f.to_owned(), c.to_owned()))
    .collect::<Vec<_>>();
    expected.sort();
    assert_eq!(found, expected);

    let mut listed = body.clone();
    let first = sports(&app).await[0].0;
    listed["sportIds"] = json!([first, first]);
    let reply = call(&app, Method::POST, GYMS, &third, Some(listed)).await;
    assert_eq!(errors(&reply), error("sportIds", "ARRAYUNIQUE"));
}

#[sqlx::test]
async fn a_gym_profile(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (owner, owner_token) = athlete(&app, "owner").await;
    let gym = a_gym(&app, owner, "Bodynade").await;
    sqlx::query(
        "UPDATE gyms SET instagram_url = 'https://instagram.com/bodynade', address_line = 'Les Berges du Lac', \
           contact_phone = '+21698765432', contact_email = 'secret@bodynade.tn' WHERE id = ?",
    )
    .bind(gym)
    .execute(&app.db)
    .await
    .unwrap();
    let mut tokens = Vec::new();
    for (name, lp) in [("strong", 900), ("hidden", 500), ("light", 100)] {
        let (user, token) = athlete(&app, name).await;
        member_of(&app, user, gym).await;
        set_lp(&app, user, lp).await;
        tokens.push((user, token));
    }
    sqlx::query("UPDATE user_settings SET show_on_leaderboards = FALSE WHERE user_id = ?")
        .bind(tokens[1].0)
        .execute(&app.db)
        .await
        .unwrap();
    let (rival_owner, _) = athlete(&app, "rival").await;
    let rival = a_gym(&app, rival_owner, "Rival Box").await;
    let (rival_member, _) = athlete(&app, "rivalmember").await;
    member_of(&app, rival_member, rival).await;
    set_lp(&app, rival_member, 50).await;

    let path = format!("{GYMS}/{gym}");
    let profile = ok(&app, &owner_token, &path).await;
    assert_same_shape(BODYNADE, &recorded(BODYNADE), &profile);
    assert_eq!(profile["membersCount"], 4);
    assert_eq!(profile["rank"], 1);
    assert_eq!(profile["addressLine"], "Les Berges du Lac");
    assert_eq!(
        profile["socialLinks"],
        json!({"instagram": "https://instagram.com/bodynade"})
    );
    let top: Vec<&str> = profile["topAthletes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["username"].as_str().unwrap())
        .collect();
    assert_eq!(top, ["strong", "light"]);
    assert_eq!(profile["topAthletes"][0]["lp"], 900);
    let text = profile.to_string();
    for secret in [
        "+21698765432",
        "secret@bodynade.tn",
        "contactPhone",
        "contactEmail",
        "proof",
    ] {
        assert!(!text.contains(secret), "{secret} leaked: {text}");
    }
    assert_eq!(
        ok(&app, &owner_token, &format!("{GYMS}/{rival}")).await["rank"],
        2
    );

    assert_eq!(
        profile["myMembership"],
        json!({"status": "APPROVED", "role": "COACH"})
    );
    assert_eq!(profile["canManage"], true);
    let seen_by_member = ok(&app, &tokens[0].1, &path).await;
    assert_eq!(
        seen_by_member["myMembership"],
        json!({"status": "APPROVED", "role": "MEMBER"})
    );
    assert_eq!(seen_by_member["canManage"], false);
    let (_, stranger) = athlete(&app, "stranger").await;
    let seen_by_stranger = ok(&app, &stranger, &path).await;
    assert_eq!(
        seen_by_stranger["myMembership"],
        json!({"status": "NONE", "role": null})
    );
    assert_eq!(seen_by_stranger["canManage"], false);
    let admin = create_user(&app, "admin", Role::Admin).await;
    let session = open_session(&app, admin, Role::Admin, Audience::App).await;
    let admin_token = session["accessToken"].as_str().unwrap();
    assert_eq!(ok(&app, admin_token, &path).await["canManage"], true);

    let malformed = get(&app, &owner_token, &format!("{GYMS}/not-a-gym")).await;
    assert_eq!(malformed.status, StatusCode::NOT_FOUND);
    let unknown = get(&app, &owner_token, &format!("{GYMS}/{}", Uuid::now_v7())).await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
}
