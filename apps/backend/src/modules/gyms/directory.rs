//! The gym directory, submissions, my gyms and the gym profile (the old `GymsService.list`,
//! `create`, `mine` and `get`).

use std::collections::HashSet;

use axum::{
    Json,
    extract::{Path, State},
    http::{StatusCode, Uri},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sqlx::MySqlPool;
use uuid::Uuid;

use super::{can_manage, gym_param};
use crate::{
    audit,
    db::duplicate_key,
    error::AppError,
    http::{auth::AppUser, page},
    seed::slugify,
    state::AppState,
    validate::{Check, ValidJson, ValidQuery, Validate, contains, normalise_email},
};

/// The social links a gym may show, in the order of their columns.
const LINK_KEYS: [&str; 4] = ["instagram", "facebook", "website", "tiktok"];

/// A gym as the directory shows it, with what its profile adds. Never the contact phone, the
/// contact email or the proof of ownership.
struct Card {
    id: Uuid,
    name: String,
    slug: String,
    owner: Option<Uuid>,
    address_line: Option<String>,
    instagram_url: Option<String>,
    facebook_url: Option<String>,
    website_url: Option<String>,
    tiktok_url: Option<String>,
    city_fr: String,
    city_en: String,
    city_ar: String,
    governorate_id: Uuid,
    governorate_code: String,
    governorate_fr: String,
    governorate_en: String,
    governorate_ar: String,
    members: i64,
    /// The sports as a JSON array, by code; `None` when the gym lists none.
    sports: Option<String>,
}

impl Card {
    fn view(&self) -> Result<Value, AppError> {
        let sports: Value = match &self.sports {
            Some(text) => serde_json::from_str(text).map_err(AppError::internal)?,
            None => json!([]),
        };
        Ok(json!({
            "id": self.id,
            "name": self.name,
            "slug": self.slug,
            // The directory and the profile only ever show verified gyms.
            "verified": true,
            "city": {"fr": self.city_fr, "en": self.city_en, "ar": self.city_ar},
            "governorate": {
                "id": self.governorate_id,
                "code": self.governorate_code,
                "name": {"fr": self.governorate_fr, "en": self.governorate_en, "ar": self.governorate_ar},
            },
            // Logos come with part 5, levels with gym wars (plan 3b rulings 2 and 3).
            "logoUrl": null,
            "sports": sports,
            "membersCount": self.members,
            "level": 1,
        }))
    }

    fn links(&self) -> Map<String, Value> {
        let columns = [
            &self.instagram_url,
            &self.facebook_url,
            &self.website_url,
            &self.tiktok_url,
        ];
        LINK_KEYS
            .iter()
            .zip(columns)
            .filter_map(|(key, url)| url.as_ref().map(|url| ((*key).to_owned(), json!(url))))
            .collect()
    }
}

/// Which verified gyms to read, in which order, from where.
#[derive(Default)]
struct Filter {
    only: Option<Uuid>,
    governorate: Option<Uuid>,
    sport: Option<Uuid>,
    pattern: Option<String>,
    by_members: bool,
    after: Option<After>,
}

/// Verified gyms, by name or by members (most first), at most `limit`.
async fn cards(db: &MySqlPool, filter: &Filter, limit: usize) -> Result<Vec<Card>, AppError> {
    let after = filter.after.as_ref();
    let (after_n, after_m) = (after.and_then(|a| a.n.clone()), after.and_then(|a| a.m));
    let after_id = after.and_then(|a| a.id);
    Ok(sqlx::query_as!(
        Card,
        r#"SELECT c.id AS "id!: Uuid", c.name AS "name!", c.slug AS "slug!", c.owner_user_id AS "owner: Uuid",
                  c.address_line, c.instagram_url, c.facebook_url, c.website_url, c.tiktok_url,
                  c.city_fr AS "city_fr!", c.city_en AS "city_en!", c.city_ar AS "city_ar!",
                  c.governorate_id AS "governorate_id!: Uuid", c.governorate_code AS "governorate_code!",
                  c.governorate_fr AS "governorate_fr!", c.governorate_en AS "governorate_en!",
                  c.governorate_ar AS "governorate_ar!", c.members AS "members!: i64", c.sports AS "sports: String"
           FROM (SELECT g.id, g.name, g.slug, g.owner_user_id, g.address_line, g.instagram_url, g.facebook_url,
                        g.website_url, g.tiktok_url, ci.name_fr AS city_fr, ci.name_en AS city_en,
                        ci.name_ar AS city_ar, gv.id AS governorate_id, gv.code AS governorate_code,
                        gv.name_fr AS governorate_fr, gv.name_en AS governorate_en, gv.name_ar AS governorate_ar,
                        (SELECT COUNT(*) FROM gym_members m WHERE m.gym_id = g.id AND m.status = 'APPROVED') AS members,
                        (SELECT JSON_ARRAYAGG(JSON_OBJECT('code', s.code,
                                  'name', JSON_OBJECT('fr', s.name_fr, 'en', s.name_en, 'ar', s.name_ar),
                                  'icon', s.icon) ORDER BY s.code)
                         FROM gym_sports gs JOIN sports s ON s.id = gs.sport_id WHERE gs.gym_id = g.id) AS sports
                 FROM gyms g JOIN cities ci ON ci.id = g.city_id JOIN governorates gv ON gv.id = g.governorate_id
                 WHERE g.status = 'VERIFIED' AND (? IS NULL OR g.id = ?)
                   AND (? IS NULL OR g.governorate_id = ?)
                   AND (? IS NULL OR EXISTS (SELECT 1 FROM gym_sports x WHERE x.gym_id = g.id AND x.sport_id = ?))
                   AND (? IS NULL OR g.name LIKE ? ESCAPE '|')) c
           WHERE (? IS NULL OR c.name > ? OR (c.name = ? AND c.id > ?))
             AND (? IS NULL OR c.members < ? OR (c.members = ? AND c.id < ?))
           ORDER BY IF(?, c.members, NULL) DESC, IF(?, c.id, NULL) DESC, c.name, c.id
           LIMIT ?"#,
        filter.only,
        filter.only,
        filter.governorate,
        filter.governorate,
        filter.sport,
        filter.sport,
        filter.pattern,
        filter.pattern,
        after_n,
        after_n,
        after_n,
        after_id,
        after_m,
        after_m,
        after_m,
        after_id,
        filter.by_members,
        filter.by_members,
        limit as i64
    )
    .fetch_all(db)
    .await?)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListQuery {
    limit: Option<String>,
    cursor: Option<String>,
    q: Option<String>,
    sport: Option<String>,
    governorate_id: Option<String>,
    sort: Option<String>,
}

/// Where a directory page stops: the last gym's name (`n`) or members count (`m`), and its id. A
/// cursor only fits the sort it was issued for.
#[derive(Serialize, Deserialize)]
struct After {
    #[serde(skip_serializing_if = "Option::is_none")]
    n: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    m: Option<i64>,
    id: Option<Uuid>,
}

/// A sport code as the catalog writes them (`CROSSFIT`).
fn is_sport_code(code: &str) -> bool {
    (2..=40).contains(&code.len())
        && code.starts_with(|c: char| c.is_ascii_uppercase())
        && code
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

/// `GET /gyms`: verified gyms, by name or by members, filtered by name, sport and governorate.
pub async fn list(
    State(state): State<AppState>,
    AppUser(_user): AppUser,
    ValidQuery(query): ValidQuery<ListQuery>,
) -> Result<Json<Value>, AppError> {
    let mut check = Check::default();
    if let Some(q) = &query.q {
        check.length("q", q, 0, 80);
    }
    if let Some(code) = &query.sport {
        check.ensure("sport", is_sport_code(code), "MATCHES");
    }
    let governorate = match query.governorate_id.as_deref().map(Uuid::parse_str) {
        Some(Err(_)) => {
            check.fail("governorateId", "ISUUID");
            None
        }
        parsed => parsed.and_then(Result::ok),
    };
    let by_members = match query.sort.as_deref() {
        None | Some("name") => false,
        Some("members") => true,
        Some(_) => {
            check.fail("sort", "ISIN");
            false
        }
    };
    check.finish()?;
    let limit = page::limit(query.limit.as_deref())? as usize;
    let sport = match &query.sport {
        None => None,
        Some(code) => Some(
            sqlx::query_scalar!(r#"SELECT id AS "id: Uuid" FROM sports WHERE code = ?"#, code)
                .fetch_optional(&state.db)
                .await?
                .ok_or_else(|| AppError::field("sport", "UNKNOWN_SPORT"))?,
        ),
    };
    let secret = &state.cfg.app_hmac_secret;
    let after = query
        .cursor
        .as_deref()
        .map(|raw| page::decode::<After>(secret, raw))
        .transpose()?;
    if let Some(after) = &after {
        let fits = after.id.is_some()
            && if by_members {
                after.m.is_some()
            } else {
                after.n.is_some()
            };
        if !fits {
            return Err(AppError::field("cursor", "CURSOR_SORT_MISMATCH"));
        }
    }
    let filter = Filter {
        governorate,
        sport,
        pattern: query
            .q
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .map(contains),
        by_members,
        after,
        ..Filter::default()
    };
    let mut rows = cards(&state.db, &filter, limit + 1).await?;
    let next = if rows.len() > limit {
        rows.truncate(limit);
        rows.last()
            .map(|last| {
                let after = if by_members {
                    After {
                        n: None,
                        m: Some(last.members),
                        id: Some(last.id),
                    }
                } else {
                    After {
                        n: Some(last.name.clone()),
                        m: None,
                        id: Some(last.id),
                    }
                };
                page::encode(secret, &after)
            })
            .transpose()?
    } else {
        None
    };
    let data = rows.iter().map(Card::view).collect::<Result<_, _>>()?;
    Ok(Json(page::page(data, next)))
}

/// `GET /gyms/:id`: a verified gym's public page, with its season rank, its top athletes and my
/// membership.
pub async fn profile(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let id = gym_param(&id)?;
    let only = Filter {
        only: Some(id),
        ..Filter::default()
    };
    let gym = cards(&state.db, &only, 1)
        .await?
        .pop()
        .ok_or_else(|| AppError::not_found("Gym"))?;
    // The gyms ranked by their members' season LP in the active season; a gym at 0 is unranked.
    let rank = sqlx::query_scalar!(
        r#"SELECT r.ranked AS "ranked!: i64"
           FROM (SELECT p.primary_gym_id AS gym_id,
                        CAST(RANK() OVER (ORDER BY SUM(us.season_lp) DESC) AS SIGNED) AS ranked
                 FROM user_stats us JOIN profiles p ON p.user_id = us.user_id
                   JOIN seasons se ON se.id = us.current_season_id AND se.status = 'ACTIVE'
                   JOIN gyms g ON g.id = p.primary_gym_id AND g.status = 'VERIFIED'
                 GROUP BY p.primary_gym_id
                 HAVING SUM(us.season_lp) > 0) r
           WHERE r.gym_id = ?"#,
        id
    )
    .fetch_optional(&state.db)
    .await?;
    let top = sqlx::query!(
        r#"SELECT u.id AS "id: Uuid", u.username, p.full_name, us.season_lp, us.level
           FROM user_stats us JOIN users u ON u.id = us.user_id JOIN profiles p ON p.user_id = us.user_id
             JOIN user_settings s ON s.user_id = us.user_id
             JOIN seasons se ON se.id = us.current_season_id AND se.status = 'ACTIVE'
           WHERE p.primary_gym_id = ? AND u.status = 'ACTIVE' AND s.show_on_leaderboards
           ORDER BY us.season_lp DESC, us.user_id
           LIMIT 5"#,
        id
    )
    .fetch_all(&state.db)
    .await?;
    let mine = sqlx::query!(
        "SELECT status, role FROM gym_members \
         WHERE gym_id = ? AND user_id = ? AND status IN ('PENDING', 'APPROVED')",
        id,
        user.id
    )
    .fetch_optional(&state.db)
    .await?;
    let manages = can_manage(&user, gym.owner, true);
    let role = match &mine {
        Some(m) if m.status == "APPROVED" => Some(if m.role == "COACH" || manages {
            "COACH"
        } else {
            "MEMBER"
        }),
        _ => None,
    };
    let mut answer = gym.view()?;
    answer["addressLine"] = json!(gym.address_line);
    answer["socialLinks"] = Value::Object(gym.links());
    answer["rank"] = json!(rank);
    answer["topAthletes"] = top
        .iter()
        .map(|a| {
            json!({
                "id": a.id, "username": a.username, "fullName": a.full_name,
                "lp": a.season_lp, "level": a.level,
            })
        })
        .collect();
    answer["myMembership"] = json!({
        "status": mine.as_ref().map_or("NONE", |m| m.status.as_str()),
        "role": role,
    });
    answer["canManage"] = json!(manages);
    // Gym wars come with plan 3d.
    answer["warRecord"] = Value::Null;
    Ok(Json(answer))
}

/// `GET /gyms/mine`: the gyms I submitted, whatever their status, newest first.
pub async fn mine(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT id AS "id: Uuid", name, slug, status FROM gyms
           WHERE owner_user_id = ? ORDER BY created_at DESC, id DESC"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.iter()
            .map(|g| {
                json!({"id": g.id, "name": g.name, "slug": g.slug, "status": g.status, "logoUrl": null})
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Create {
    name: String,
    governorate_id: String,
    city_id: String,
    address_line: Option<String>,
    contact_phone: Option<String>,
    contact_email: Option<String>,
    social_links: Option<Map<String, Value>>,
    sport_ids: Option<Vec<String>>,
    proof_of_ownership: String,
}

/// An international phone number: `+`, then 8 to 15 digits, the first not 0.
fn is_phone(text: &str) -> bool {
    text.strip_prefix('+').is_some_and(|digits| {
        (8..=15).contains(&digits.len())
            && !digits.starts_with('0')
            && digits.bytes().all(|b| b.is_ascii_digit())
    })
}

/// A web address a gym may link to: `http` or `https`, with a host, at most 300 characters.
fn is_link(text: &str) -> bool {
    text.chars().count() <= 300
        && text.parse::<Uri>().is_ok_and(|uri| {
            matches!(uri.scheme_str(), Some("http" | "https")) && uri.authority().is_some()
        })
}

/// The slug a name starts from: at most 50 characters, `gym` when nothing is left.
fn base_slug(name: &str) -> String {
    let mut slug = slugify(name);
    slug.truncate(50);
    let slug = slug.trim_end_matches('-');
    if slug.is_empty() {
        "gym".to_owned()
    } else {
        slug.to_owned()
    }
}

impl Validate for Create {
    fn validate(&self, check: &mut Check) {
        check.length("name", self.name.trim(), 3, 80);
        check.ensure(
            "governorateId",
            Uuid::parse_str(&self.governorate_id).is_ok(),
            "ISUUID",
        );
        check.ensure("cityId", Uuid::parse_str(&self.city_id).is_ok(), "ISUUID");
        if let Some(address) = &self.address_line {
            check.length("addressLine", address, 0, 200);
        }
        if let Some(phone) = &self.contact_phone {
            check.ensure("contactPhone", is_phone(phone), "MATCHES");
        }
        if let Some(email) = &self.contact_email {
            check.ensure("contactEmail", normalise_email(email).is_some(), "ISEMAIL");
        }
        for (key, value) in self.social_links.iter().flatten() {
            let ok = LINK_KEYS.contains(&key.as_str()) && value.as_str().is_some_and(is_link);
            check.ensure(&format!("socialLinks.{key}"), ok, "INVALID_LINK");
        }
        if let Some(ids) = &self.sport_ids {
            let parsed: Vec<Uuid> = ids.iter().filter_map(|id| Uuid::parse_str(id).ok()).collect();
            if ids.len() > 10 {
                check.fail("sportIds", "ARRAYMAXSIZE");
            } else if parsed.iter().collect::<HashSet<_>>().len() < parsed.len() {
                check.fail("sportIds", "ARRAYUNIQUE");
            }
            check.ensure("sportIds", parsed.len() == ids.len(), "ISUUID");
        }
        check.length("proofOfOwnership", &self.proof_of_ownership, 10, 1000);
    }
}

/// `POST /gyms`: submits a gym. It stays `PENDING` until an admin verifies it (part 5); one
/// pending submission per athlete.
pub async fn create(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<Create>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    user.require_verified()?;
    let governorate = Uuid::parse_str(&body.governorate_id)
        .map_err(|_| AppError::field("governorateId", "ISUUID"))?;
    let city =
        Uuid::parse_str(&body.city_id).map_err(|_| AppError::field("cityId", "ISUUID"))?;
    let sports: Vec<Uuid> = body
        .sport_ids
        .iter()
        .flatten()
        .filter_map(|id| Uuid::parse_str(id).ok())
        .collect();
    let mut check = Check::default();
    let city_governorate = sqlx::query_scalar!(
        r#"SELECT governorate_id AS "id: Uuid" FROM cities WHERE id = ?"#,
        city
    )
    .fetch_optional(&state.db)
    .await?;
    check.ensure(
        "cityId",
        city_governorate == Some(governorate),
        "NOT_IN_GOVERNORATE",
    );
    for sport in &sports {
        let enabled = sqlx::query_scalar!(
            r#"SELECT enabled AS "enabled: bool" FROM sports WHERE id = ?"#,
            sport
        )
        .fetch_optional(&state.db)
        .await?;
        if enabled != Some(true) {
            check.fail("sportIds", "UNKNOWN_SPORT");
            break;
        }
    }
    check.finish()?;

    let id = Uuid::now_v7();
    let name = body.name.trim();
    let email = body.contact_email.as_deref().and_then(normalise_email);
    let links = LINK_KEYS.map(|key| {
        body.social_links
            .as_ref()
            .and_then(|links| links.get(key))
            .and_then(Value::as_str)
    });
    let base = base_slug(name);
    let mut tx = state.db.begin().await?;
    let mut n = 1;
    // The first free slug; a twin inserted at the same moment is caught by the unique index.
    let slug = loop {
        let slug = if n == 1 {
            base.clone()
        } else {
            format!("{base}-{n}")
        };
        let inserted = sqlx::query!(
            "INSERT INTO gyms (id, name, slug, governorate_id, city_id, address_line, contact_phone, contact_email, \
               instagram_url, facebook_url, website_url, tiktok_url, owner_user_id) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            id,
            name,
            slug,
            governorate,
            city,
            body.address_line,
            body.contact_phone,
            email,
            links[0],
            links[1],
            links[2],
            links[3],
            user.id
        )
        .execute(&mut *tx)
        .await;
        match inserted {
            Ok(_) => break slug,
            Err(e) if duplicate_key(&e) == Some("uq_gyms_slug") => n += 1,
            Err(e) => return Err(e.into()),
        }
    };
    for sport in &sports {
        sqlx::query!(
            "INSERT INTO gym_sports (gym_id, sport_id) VALUES (?, ?)",
            id,
            sport
        )
        .execute(&mut *tx)
        .await?;
    }
    let request = sqlx::query!(
        "INSERT INTO gym_verification_requests (id, gym_id, submitted_by, proof_text) VALUES (?, ?, ?, ?)",
        Uuid::now_v7(),
        id,
        user.id,
        body.proof_of_ownership
    )
    .execute(&mut *tx)
    .await;
    if let Err(e) = request {
        return Err(
            if duplicate_key(&e) == Some("uq_gym_verification_requests_pending") {
                AppError::conflict("CONFLICT")
                    .detail("You already have a gym waiting for verification.")
            } else {
                e.into()
            },
        );
    }
    audit::record(
        &mut *tx,
        audit::Event {
            actor: Some((user.id, user.role)),
            action: "GYM_SUBMITTED",
            user_id: user.id,
            after: Some(json!({"gymId": id})),
        },
    )
    .await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id": id, "slug": slug, "status": "PENDING"})),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs() {
        assert_eq!(base_slug("Sahel Iron Club"), "sahel-iron-club");
        assert_eq!(base_slug("  Énergie & Forme!  "), "energie-forme");
        assert_eq!(base_slug("نادي"), "gym");
        let long = base_slug(&format!("{} b", "a".repeat(49)));
        assert_eq!(long, "a".repeat(49));
        assert_eq!(base_slug(&"word ".repeat(20)).len(), 49);
    }

    #[test]
    fn links() {
        for good in ["https://instagram.com/sahel", "http://sahel.tn", "https://x.tn/a?b=c"] {
            assert!(is_link(good), "{good}");
        }
        let long = format!("https://x.tn/{}", "a".repeat(290));
        for bad in [
            "ftp://x.tn",
            "javascript:alert(1)",
            "instagram.com/sahel",
            "https://",
            "",
            long.as_str(),
        ] {
            assert!(!is_link(bad), "{bad}");
        }
    }

    #[test]
    fn phones() {
        for good in ["+21673000000", "+12345678", "+123456789012345"] {
            assert!(is_phone(good), "{good}");
        }
        for bad in [
            "21673000000",
            "+0123456789",
            "+1234567",
            "+1234567890123456",
            "+2167300000a",
            "",
        ] {
            assert!(!is_phone(bad), "{bad}");
        }
    }

    #[test]
    fn sport_codes() {
        assert!(is_sport_code("CROSSFIT"));
        assert!(is_sport_code("WEIGHT_TRAINING"));
        for bad in ["x", "X", "crossfit", "1RM", "CROSS-FIT", &"A".repeat(41)] {
            assert!(!is_sport_code(bad), "{bad}");
        }
    }
}
