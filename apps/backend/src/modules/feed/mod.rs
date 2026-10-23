//! The activity feed (docs §3.9): what athletes did, written in the transaction of its cause, then read
//! by their friends with reactions and comments. A port of the old API's `FeedService`.

pub mod comments;
pub mod reactions;

use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::MySqlConnection;
use uuid::Uuid;

use crate::{
    error::AppError,
    http::{Api, auth::AppUser, page},
    state::AppState,
    types::iso,
    validate::ValidQuery,
};

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/feed", list)
        .put("/api/v1/activities/{id}/reactions", reactions::react)
        .delete("/api/v1/activities/{id}/reactions", reactions::unreact)
        .get("/api/v1/activities/{id}/comments", comments::list)
        .post("/api/v1/activities/{id}/comments", comments::create)
        .delete(
            "/api/v1/activities/{id}/comments/{comment_id}",
            comments::delete,
        )
}

/// An activity id from a path; a malformed one names no activity.
pub fn activity_param(raw: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(raw).map_err(|_| AppError::not_found("Activity"))
}

/// The old API's `canView`: my own items; else not private, no block either way, and public or a
/// friend's. Gives the item's owner; 404 for anything else.
pub async fn viewable(
    conn: &mut MySqlConnection,
    me: Uuid,
    activity: Uuid,
) -> Result<Uuid, AppError> {
    let row = sqlx::query!(
        r#"SELECT e.user_id AS "owner: Uuid", e.visibility,
                  EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = e.user_id)
                                                  OR (b.blocker_id = e.user_id AND b.blocked_id = ?)) AS "blocked!: i64",
                  EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'ACCEPTED'
                            AND ((f.user_low_id = ? AND f.user_high_id = e.user_id)
                              OR (f.user_low_id = e.user_id AND f.user_high_id = ?))) AS "friends!: i64"
           FROM activity_events e WHERE e.id = ?"#,
        me,
        me,
        me,
        me,
        activity
    )
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| AppError::not_found("Activity"))?;
    let seen = row.owner == me
        || (row.visibility != "PRIVATE"
            && row.blocked == 0
            && (row.visibility == "PUBLIC" || row.friends != 0));
    if seen {
        Ok(row.owner)
    } else {
        Err(AppError::not_found("Activity"))
    }
}

/// The reaction counts of an item, in the app's order.
fn counts(like: i64, fire: i64, strong: i64) -> Value {
    json!({"LIKE": like, "FIRE": fire, "STRONG": strong})
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageQuery {
    limit: Option<String>,
    cursor: Option<String>,
}

/// Where a page stops: the last item's or comment's id.
#[derive(Serialize, Deserialize)]
struct After {
    id: Uuid,
}

fn after(state: &AppState, cursor: Option<&str>) -> Result<Option<Uuid>, AppError> {
    Ok(cursor
        .map(|raw| page::decode::<After>(&state.cfg.app_hmac_secret, raw))
        .transpose()?
        .map(|a| a.id))
}

fn next(state: &AppState, last: Option<Uuid>) -> Result<Option<String>, AppError> {
    last.map(|id| page::encode(&state.cfg.app_hmac_secret, &After { id }))
        .transpose()
}

/// `GET /feed`: my items and my friends' shared ones, newest first. An item whose workout was
/// refused afterwards, or whose record was revoked, is left out (plan 3c ruling 3). A block ends the
/// friendship, so a blocked athlete is never in it.
async fn list(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidQuery(query): ValidQuery<PageQuery>,
) -> Result<Json<Value>, AppError> {
    let limit = page::limit(query.limit.as_deref())? as usize;
    let after = after(&state, query.cursor.as_deref())?;
    let me = user.id;
    let mut rows = sqlx::query!(
        r#"SELECT e.id AS "id: Uuid", e.user_id AS "user_id: Uuid", e.type AS kind, e.created_at, e.payload,
                  u.username, p.full_name, s.code AS "sport_code?", s.name_fr AS "sport_fr?",
                  s.name_en AS "sport_en?", s.name_ar AS "sport_ar?", x.name_fr AS "exercise_fr?",
                  x.name_en AS "exercise_en?", x.name_ar AS "exercise_ar?", b.name_fr AS "badge_fr?",
                  b.name_en AS "badge_en?", b.name_ar AS "badge_ar?", b.icon AS "badge_icon?",
                  (SELECT COUNT(*) FROM activity_reactions r WHERE r.activity_event_id = e.id AND r.type = 'LIKE') AS "like!: i64",
                  (SELECT COUNT(*) FROM activity_reactions r WHERE r.activity_event_id = e.id AND r.type = 'FIRE') AS "fire!: i64",
                  (SELECT COUNT(*) FROM activity_reactions r WHERE r.activity_event_id = e.id AND r.type = 'STRONG') AS "strong!: i64",
                  (SELECT r.type FROM activity_reactions r WHERE r.activity_event_id = e.id AND r.user_id = ?) AS "mine?: String",
                  (SELECT COUNT(*) FROM activity_comments c
                   WHERE c.activity_event_id = e.id AND c.deleted_at IS NULL) AS "comments!: i64"
           FROM activity_events e JOIN users u ON u.id = e.user_id JOIN profiles p ON p.user_id = e.user_id
             LEFT JOIN sports s ON s.id = e.sport_id LEFT JOIN exercises x ON x.id = e.exercise_id
             LEFT JOIN badges b ON b.id = e.badge_id
           WHERE u.status = 'ACTIVE'
             AND (e.user_id = ? OR (e.visibility IN ('FRIENDS', 'PUBLIC') AND e.user_id IN (
                   SELECT IF(f.user_low_id = ?, f.user_high_id, f.user_low_id) FROM friendships f
                   WHERE f.status = 'ACCEPTED' AND (f.user_low_id = ? OR f.user_high_id = ?))))
             AND NOT EXISTS (SELECT 1 FROM workouts w
                             WHERE e.ref_type = 'workout' AND w.id = e.ref_id AND w.status <> 'ACCEPTED')
             AND NOT EXISTS (SELECT 1 FROM personal_records r
                             WHERE e.ref_type = 'personal_record' AND r.id = e.ref_id AND r.status = 'REVOKED')
             AND (? IS NULL OR e.id < ?)
           ORDER BY e.id DESC
           LIMIT ?"#,
        me,
        me,
        me,
        me,
        me,
        after,
        after,
        limit as i64 + 1
    )
    .fetch_all(&state.db)
    .await?;
    let more = rows.len() > limit;
    rows.truncate(limit);
    let next = next(&state, more.then(|| rows.last().map(|r| r.id)).flatten())?;
    let data = rows
        .into_iter()
        .map(|r| {
            let mut details: Value = serde_json::from_str(&r.payload).map_err(AppError::internal)?;
            // What the app prints, next to the ids the payload holds (the old `render`).
            if details["sportId"].is_string() {
                details["sport"] = r.sport_code.map_or(Value::Null, |code| {
                    json!({"code": code, "name": {"fr": r.sport_fr, "en": r.sport_en, "ar": r.sport_ar}})
                });
            }
            if details["exerciseId"].is_string() {
                details["exercise"] = r.exercise_fr.map_or(Value::Null, |fr| {
                    json!({"fr": fr, "en": r.exercise_en, "ar": r.exercise_ar})
                });
            }
            if let Some(fr) = r.badge_fr {
                details["badgeName"] = json!({"fr": fr, "en": r.badge_en, "ar": r.badge_ar});
                details["badgeIcon"] = json!(r.badge_icon);
            }
            Ok(json!({
                "id": r.id, "type": r.kind, "createdAt": iso(r.created_at),
                "user": {"id": r.user_id, "username": r.username, "fullName": r.full_name},
                "isMine": r.user_id == me, "details": details,
                "reactions": counts(r.like, r.fire, r.strong), "myReaction": r.mine,
                "comments": r.comments,
            }))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(Json(page::page(data, next)))
}

/// What happened. Plans 3d and 3e add the gym-war and battle wins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Workout,
    Pr,
    Badge,
    LevelUp,
    GoalCompleted,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Workout => "WORKOUT",
            Kind::Pr => "PR",
            Kind::Badge => "BADGE",
            Kind::LevelUp => "LEVEL_UP",
            Kind::GoalCompleted => "GOAL_COMPLETED",
        }
    }

    /// The table `ref_id` names a row of.
    pub fn ref_type(self) -> &'static str {
        match self {
            Kind::Workout => "workout",
            Kind::Pr => "personal_record",
            Kind::Badge => "user_badge",
            Kind::LevelUp => "xp_transaction",
            Kind::GoalCompleted => "goal",
        }
    }
}

/// One event: the old API's payload, and the rows the feed prints from.
pub struct Activity<'a> {
    pub user: Uuid,
    pub kind: Kind,
    pub ref_id: Uuid,
    pub visibility: &'a str,
    pub payload: Value,
    pub sport: Option<Uuid>,
    pub exercise: Option<Uuid>,
    pub badge: Option<Uuid>,
}

/// Writes an event in the caller's transaction, and gives its id: a cause rolled back leaves none.
pub async fn record(conn: &mut MySqlConnection, a: Activity<'_>) -> Result<Uuid, AppError> {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO activity_events (id, user_id, type, ref_type, ref_id, visibility, payload, sport_id, \
           exercise_id, badge_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        a.user,
        a.kind.as_str(),
        a.kind.ref_type(),
        a.ref_id,
        a.visibility,
        a.payload.to_string(),
        a.sport,
        a.exercise,
        a.badge
    )
    .execute(conn)
    .await?;
    Ok(id)
}
