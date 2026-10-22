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

async fn join(app: &TestApp, token: &str, gym: impl std::fmt::Display) -> Reply {
    call(
        app,
        Method::POST,
        &format!("{GYMS}/{gym}/membership"),
        token,
        None,
    )
    .await
}

async fn decide(app: &TestApp, token: &str, gym: Uuid, user: Uuid, verb: &str) -> Reply {
    call(
        app,
        Method::POST,
        &format!("{GYMS}/{gym}/members/{user}/{verb}"),
        token,
        None,
    )
    .await
}

async fn coach(app: &TestApp, method: Method, token: &str, gym: Uuid, user: Uuid) -> Reply {
    call(
        app,
        method,
        &format!("{GYMS}/{gym}/members/{user}/coach"),
        token,
        None,
    )
    .await
}

/// The onboarding steps, as every onboarding route answers them.
async fn steps(app: &TestApp, token: &str) -> Value {
    let reply = call(
        app,
        Method::POST,
        "/api/v1/me/onboarding/baselines",
        token,
        Some(json!({"entries": []})),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    reply.json["steps"].clone()
}

/// A member page's `(username, role)` pairs.
fn roster(page: &Value) -> Vec<(String, String)> {
    page["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            (
                m["username"].as_str().unwrap().to_owned(),
                m["role"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

async fn audited(app: &TestApp, action: &str, user: Uuid, gym: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = ? AND entity_id = ? \
           AND JSON_VALUE(after_json, '$.gymId') = ?",
    )
    .bind(action)
    .bind(user)
    .bind(gym.to_string())
    .fetch_one(&app.db)
    .await
    .unwrap()
}

async fn primary_gym(app: &TestApp, user: Uuid) -> Option<Uuid> {
    sqlx::query_scalar("SELECT primary_gym_id FROM profiles WHERE user_id = ?")
        .bind(user)
        .fetch_one(&app.db)
        .await
        .unwrap()
}

#[sqlx::test]
async fn joining_and_leaving(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (owner, owner_token) = athlete(&app, "owner").await;
    let gym = a_gym(&app, owner, "Sahel Iron").await;
    let (other_owner, _) = athlete(&app, "rival").await;
    let other = a_gym(&app, other_owner, "Ariana Fit").await;
    let (a, token) = athlete(&app, "a").await;
    let profile_path = format!("{GYMS}/{gym}");

    let joined = join(&app, &token, gym).await;
    assert_eq!(joined.status, StatusCode::CREATED, "{}", joined.json);
    assert_eq!(joined.json, json!({"gymId": gym, "status": "PENDING"}));
    assert_eq!(
        ok(&app, &token, &profile_path).await["myMembership"],
        json!({"status": "PENDING", "role": null})
    );
    assert_eq!(steps(&app, &token).await["gym"], true);
    assert_eq!(
        ok(&app, &token, "/api/v1/me").await["profile"]["gym"],
        Value::Null
    );

    let twice = join(&app, &token, other).await;
    assert_eq!(twice.status, StatusCode::CONFLICT, "{}", twice.json);
    assert_eq!(twice.json["code"], "CONFLICT");
    assert_eq!(twice.json["gymId"], gym.to_string());
    assert_eq!(twice.json["membershipStatus"], "PENDING");

    let requests = ok(
        &app,
        &owner_token,
        &format!("{GYMS}/{gym}/membership-requests"),
    )
    .await;
    assert_eq!(requests.as_array().unwrap().len(), 1);
    assert_eq!(requests[0]["userId"], a.to_string());
    assert_eq!(requests[0]["username"], "a");
    assert_eq!(requests[0]["fullName"], "Athlete a");
    assert!(requests[0]["requestedAt"].is_string());

    let approved = decide(&app, &owner_token, gym, a, "approve").await;
    assert_eq!(approved.status, StatusCode::OK, "{}", approved.json);
    assert_eq!(approved.json, json!({"userId": a, "status": "APPROVED"}));
    let me = ok(&app, &token, "/api/v1/me").await;
    assert_same_shape("GET /me", &recorded("GET /me"), &me);
    assert_eq!(
        me["profile"]["gym"],
        json!({"id": gym, "name": "Sahel Iron", "slug": "sahel-iron"})
    );
    assert_eq!(
        ok(&app, &owner_token, "/api/v1/users/a").await["gym"],
        json!({"id": gym, "name": "Sahel Iron"})
    );
    let members = ok(&app, &token, &format!("{GYMS}/{gym}/members")).await;
    let recorded_members = "GET /gyms/01a0e9e3-45e7-78b3-adf7-00d0f6fb6ab2/members";
    assert_same_shape(recorded_members, &recorded(recorded_members), &members);
    assert_eq!(
        roster(&members),
        [("owner".into(), "MEMBER".into()), ("a".into(), "MEMBER".into())]
    );
    assert!(members["data"][1]["since"].is_string());
    assert_eq!(
        ok(&app, &token, &profile_path).await["myMembership"],
        json!({"status": "APPROVED", "role": "MEMBER"})
    );

    let left = call(
        &app,
        Method::DELETE,
        &format!("{GYMS}/me/membership"),
        &token,
        None,
    )
    .await;
    assert_eq!(left.status, StatusCode::NO_CONTENT);
    assert_eq!(
        ok(&app, &token, "/api/v1/me").await["profile"]["gym"],
        Value::Null
    );
    assert_eq!(
        ok(&app, &owner_token, "/api/v1/users/a").await["gym"],
        Value::Null
    );
    assert_eq!(
        ok(&app, &token, &profile_path).await["myMembership"],
        json!({"status": "NONE", "role": null})
    );
    assert_eq!(roster(&ok(&app, &token, &format!("{GYMS}/{gym}/members")).await).len(), 1);
    let again = call(
        &app,
        Method::DELETE,
        &format!("{GYMS}/me/membership"),
        &token,
        None,
    )
    .await;
    assert_eq!(again.status, StatusCode::NO_CONTENT);

    sqlx::query("UPDATE gyms SET status = 'PENDING' WHERE id = ?")
        .bind(other)
        .execute(&app.db)
        .await
        .unwrap();
    for target in [other.to_string(), Uuid::now_v7().to_string(), "nope".to_owned()] {
        let refused = join(&app, &token, &target).await;
        assert_eq!(refused.status, StatusCode::NOT_FOUND, "{target}");
        assert_eq!(refused.json["title"], "Gym not found", "{target}");
    }
}

#[sqlx::test]
async fn two_joins_at_once(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (first_owner, _) = athlete(&app, "first").await;
    let first = a_gym(&app, first_owner, "First Gym").await;
    let (second_owner, _) = athlete(&app, "second").await;
    let second = a_gym(&app, second_owner, "Second Gym").await;
    let (a, token) = athlete(&app, "a").await;
    let (one, two) = tokio::join!(join(&app, &token, first), join(&app, &token, second));
    let mut statuses = [one.status, two.status];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::CREATED, StatusCode::CONFLICT]);
    let live: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM gym_members WHERE user_id = ? AND status IN ('PENDING', 'APPROVED')",
    )
    .bind(a)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(live, 1);
}

#[sqlx::test]
async fn the_admin_decides(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (owner, owner_token) = athlete(&app, "owner").await;
    let gym = a_gym(&app, owner, "Sahel Iron").await;
    let (a, token) = athlete(&app, "a").await;
    let (b, _) = athlete(&app, "b").await;

    assert_eq!(join(&app, &token, gym).await.status, StatusCode::CREATED);
    let rejected = decide(&app, &owner_token, gym, a, "reject").await;
    assert_eq!(rejected.status, StatusCode::OK, "{}", rejected.json);
    assert_eq!(rejected.json, json!({"userId": a, "status": "REJECTED"}));
    assert_eq!(audited(&app, "GYM_MEMBER_REJECT", a, gym).await, 1);
    let not_pending = decide(&app, &owner_token, gym, a, "approve").await;
    assert_eq!(not_pending.status, StatusCode::NOT_FOUND);
    assert_eq!(not_pending.json["title"], "Membership not found");
    assert_eq!(join(&app, &token, gym).await.status, StatusCode::CREATED);
    assert_eq!(
        decide(&app, &owner_token, gym, b, "approve").await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        decide(&app, &owner_token, gym, a, "approve").await.status,
        StatusCode::OK
    );
    assert_eq!(audited(&app, "GYM_MEMBER_APPROVE", a, gym).await, 1);
    assert_eq!(primary_gym(&app, a).await, Some(gym));

    for _ in 0..2 {
        let appointed = coach(&app, Method::POST, &owner_token, gym, a).await;
        assert_eq!(appointed.status, StatusCode::OK, "{}", appointed.json);
        assert_eq!(appointed.json, json!({"userId": a, "role": "COACH"}));
    }
    assert!(audited(&app, "GYM_COACH_APPOINTED", a, gym).await >= 1);
    let members = ok(&app, &token, &format!("{GYMS}/{gym}/members")).await;
    assert_eq!(roster(&members)[1], ("a".into(), "COACH".into()));
    assert_eq!(
        ok(&app, &token, &format!("{GYMS}/{gym}")).await["myMembership"],
        json!({"status": "APPROVED", "role": "COACH"})
    );
    let dismissed = coach(&app, Method::DELETE, &owner_token, gym, a).await;
    assert_eq!(dismissed.status, StatusCode::NO_CONTENT);
    assert_eq!(audited(&app, "GYM_COACH_REMOVED", a, gym).await, 1);
    let members = ok(&app, &token, &format!("{GYMS}/{gym}/members")).await;
    assert_eq!(roster(&members)[1], ("a".into(), "MEMBER".into()));
    for method in [Method::POST, Method::DELETE] {
        let stranger = coach(&app, method.clone(), &owner_token, gym, b).await;
        assert_eq!(stranger.status, StatusCode::NOT_FOUND, "{method}");
        assert_eq!(stranger.json["title"], "Membership not found");
    }

    let removed = decide(&app, &owner_token, gym, a, "remove").await;
    assert_eq!(removed.status, StatusCode::OK, "{}", removed.json);
    assert_eq!(removed.json, json!({"userId": a, "status": "REMOVED"}));
    assert_eq!(audited(&app, "GYM_MEMBER_REMOVE", a, gym).await, 1);
    assert_eq!(primary_gym(&app, a).await, None);
    assert_eq!(
        decide(&app, &owner_token, gym, a, "remove").await.status,
        StatusCode::NOT_FOUND
    );
    let malformed = call(
        &app,
        Method::POST,
        &format!("{GYMS}/{gym}/members/nope/approve"),
        &owner_token,
        None,
    )
    .await;
    assert_eq!(malformed.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn who_manages(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (owner, _) = athlete(&app, "owner").await;
    let gym = a_gym(&app, owner, "Sahel Iron").await;
    let (member, member_token) = athlete(&app, "member").await;
    member_of(&app, member, gym).await;
    let (coach_id, coach_token) = athlete(&app, "coach").await;
    member_of(&app, coach_id, gym).await;
    sqlx::query("UPDATE gym_members SET role = 'COACH' WHERE user_id = ?")
        .bind(coach_id)
        .execute(&app.db)
        .await
        .unwrap();
    let (demoted, demoted_token) = athlete(&app, "demoted").await;
    let demoted_gym = a_gym(&app, demoted, "Demoted Gym").await;
    sqlx::query("UPDATE users SET role = 'USER' WHERE id = ?")
        .bind(demoted)
        .execute(&app.db)
        .await
        .unwrap();
    let (submitter, submitter_token) = verified(&app, "submitter").await;
    let pending = call(
        &app,
        Method::POST,
        GYMS,
        &submitter_token,
        Some(submission(&app, "Pending Gym").await),
    )
    .await
    .json["id"]
        .as_str()
        .unwrap()
        .parse::<Uuid>()
        .unwrap();
    // A gym admin of another gym: the role alone does not make them this one's admin.
    sqlx::query("UPDATE users SET role = 'GYM_ADMIN' WHERE id = ?")
        .bind(submitter)
        .execute(&app.db)
        .await
        .unwrap();
    let (asker, asker_token) = athlete(&app, "asker").await;
    assert_eq!(join(&app, &asker_token, gym).await.status, StatusCode::CREATED);

    let cases = [
        (&member_token, gym),
        (&coach_token, gym),
        (&demoted_token, demoted_gym),
        (&submitter_token, pending),
        (&submitter_token, gym),
    ];
    for (token, target) in cases {
        let requests = get(
            &app,
            token,
            &format!("{GYMS}/{target}/membership-requests"),
        )
        .await;
        let approve = decide(&app, token, target, asker, "approve").await;
        let appoint = coach(&app, Method::POST, token, target, member).await;
        for reply in [requests, approve, appoint] {
            assert_eq!(reply.status, StatusCode::FORBIDDEN, "{target}: {}", reply.json);
            assert_eq!(reply.json["code"], "FORBIDDEN");
            assert_eq!(reply.json["detail"], "Only this gym's admin can do that.");
        }
    }
    let unknown = get(
        &app,
        &member_token,
        &format!("{GYMS}/{}/membership-requests", Uuid::now_v7()),
    )
    .await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    assert_eq!(unknown.json["title"], "Gym not found");

    let admin = create_user(&app, "admin", Role::Admin).await;
    let session = open_session(&app, admin, Role::Admin, Audience::App).await;
    let admin_token = session["accessToken"].as_str().unwrap();
    let approved = decide(&app, admin_token, gym, asker, "approve").await;
    assert_eq!(approved.status, StatusCode::OK, "{}", approved.json);
}

/// A workout written straight into the database, `days_ago` days back.
async fn worked_out(app: &TestApp, user: Uuid, days_ago: i64, status: &str) {
    sqlx::query(
        "INSERT INTO workouts (id, user_id, client_id, payload_hash, fingerprint, sport_id, workout_type, \
           performed_at, duration_s, visibility, status, received_at, total_volume_kg, total_distance_m) \
         SELECT ?, ?, ?, REPEAT('a', 32), REPEAT('b', 32), id, 'STRENGTH', \
           UTC_TIMESTAMP(6) - INTERVAL ? DAY, 3600, 'PRIVATE', ?, UTC_TIMESTAMP(6), 0, 0 \
         FROM sports ORDER BY code LIMIT 1",
    )
    .bind(Uuid::now_v7())
    .bind(user)
    .bind(Uuid::now_v7())
    .bind(days_ago)
    .bind(status)
    .execute(&app.db)
    .await
    .unwrap();
}

async fn weekly(app: &TestApp, user: Uuid, week: chrono::NaiveDate, total: f64, progress: f64) {
    sqlx::query(
        "INSERT INTO weekly_scores (id, user_id, week_start, rule_set_version, progress_c, consistency_c, \
           performance_c, total, breakdown) VALUES (?, ?, ?, 2, ?, 0, 0, ?, '{}')",
    )
    .bind(Uuid::now_v7())
    .bind(user)
    .bind(week)
    .bind(progress)
    .bind(total)
    .execute(&app.db)
    .await
    .unwrap();
}

#[sqlx::test]
async fn the_dashboard(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (owner, owner_token) = athlete(&app, "owner").await;
    let gym = a_gym(&app, owner, "Sahel Iron").await;
    let mut members = Vec::new();
    for name in ["b", "c", "d"] {
        let (user, token) = athlete(&app, name).await;
        member_of(&app, user, gym).await;
        members.push((user, token));
    }
    let (b, c, d) = (members[0].0, members[1].0, members[2].0);
    let (_, asker) = athlete(&app, "asker").await;
    assert_eq!(join(&app, &asker, gym).await.status, StatusCode::CREATED);
    let (stranger, _) = athlete(&app, "stranger").await;
    worked_out(&app, b, 3, "ACCEPTED").await;
    worked_out(&app, c, 20, "ACCEPTED").await;
    worked_out(&app, d, 1, "REJECTED").await;
    worked_out(&app, stranger, 1, "ACCEPTED").await;
    let offset = app.state.cfg.business_utc_offset_minutes;
    let monday = backend::security::policy::business_today(
        backend::security::policy::week_start(chrono::Utc::now(), offset),
        offset,
    );
    let last_week = monday - chrono::Duration::days(7);
    weekly(&app, b, last_week, 60.0, 30.0).await;
    weekly(&app, c, last_week, 70.0, 50.0).await;
    weekly(&app, stranger, last_week, 10.0, 90.0).await;
    weekly(&app, b, last_week - chrono::Duration::days(7), 40.0, 10.0).await;

    let path = format!("{GYMS}/{gym}/dashboard");
    let dashboard = ok(&app, &owner_token, &path).await;
    assert_eq!(
        dashboard["gym"],
        json!({"id": gym, "name": "Sahel Iron", "rating": 1500})
    );
    assert_eq!(
        dashboard["members"],
        json!({"approved": 4, "pending": 1, "activeLast7Days": 1, "activeLast28Days": 2})
    );
    let trend = dashboard["trend"].as_array().unwrap();
    assert_eq!(trend.len(), 8);
    assert_eq!(trend[7]["weekStart"], last_week.to_string());
    assert_eq!(trend[7]["activeMembers"], 2);
    assert_eq!(trend[7]["meanScore"].as_f64(), Some(65.0));
    assert_eq!(trend[6]["activeMembers"], 1);
    assert_eq!(trend[6]["meanScore"].as_f64(), Some(40.0));
    assert_eq!(
        trend[0],
        json!({"weekStart": (monday - chrono::Duration::days(56)).to_string(), "activeMembers": 0, "meanScore": null})
    );
    let top = dashboard["topProgress"].as_array().unwrap();
    assert_eq!(top.len(), 2);
    assert_eq!(top[0]["userId"], c.to_string());
    assert_eq!(top[0]["name"], "Athlete c");
    assert_eq!(top[0]["progress"].as_f64(), Some(50.0));
    assert_eq!(top[0]["total"].as_f64(), Some(70.0));
    assert_eq!(top[1]["userId"], b.to_string());
    let mut nudged: Vec<String> = dashboard["toNudge"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["userId"].as_str().unwrap().to_owned())
        .collect();
    nudged.sort();
    let mut expected = vec![owner.to_string(), c.to_string(), d.to_string()];
    expected.sort();
    assert_eq!(nudged, expected);
    let nudge_of = |user: Uuid| {
        dashboard["toNudge"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["userId"] == user.to_string())
            .unwrap()
            .clone()
    };
    assert_eq!(nudge_of(d)["lastWorkoutAt"], Value::Null);
    assert_eq!(nudge_of(d)["name"], "Athlete d");
    assert!(nudge_of(c)["lastWorkoutAt"].is_string());
    assert_eq!(dashboard["wods"], json!([]));
    assert_eq!(
        dashboard["wars"],
        json!({"wins": 0, "losses": 0, "draws": 0, "enrolled": true})
    );
    let text = dashboard.to_string();
    assert!(!text.contains("@example.com") && !text.contains("1995-05-05"));

    let member = get(&app, &members[0].1, &path).await;
    assert_eq!(member.status, StatusCode::FORBIDDEN);
    let unknown = get(
        &app,
        &owner_token,
        &format!("{GYMS}/{}/dashboard", Uuid::now_v7()),
    )
    .await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
}
