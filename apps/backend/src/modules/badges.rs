//! Badges (docs §3.10): data-driven rules, each reading one fact about the athlete against a
//! threshold. A port of the old API's `badge-rules.ts` and `badges.service.ts`.

use std::collections::{HashMap, HashSet};

use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::MySqlConnection;
use uuid::Uuid;

use crate::{
    error::AppError,
    http::{Api, auth::AppUser},
    state::AppState,
    types::iso,
};

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/badges", catalogue)
}

/// What a `COUNT` rule counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Event {
    WorkoutAccepted,
    PrAwarded,
    BattleWin,
    DuelWin,
    GymWarWin,
    GoalCompleted,
    Friend,
    GymJoined,
    ChallengeCompleted,
}

/// In rank order: Bronze is 1, Elite 6.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Division {
    Bronze,
    Silver,
    Gold,
    Platinum,
    Diamond,
    Elite,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Rule {
    Count { event: Event, gte: i64 },
    Level { gte: i64 },
    Division { gte: Division },
    /// Consecutive closed weeks with the training plan fully met.
    StreakWeeks { gte: i64 },
}

/// One fact about the athlete. `Division` is the rank of the best division reached, 0 for none.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Fact {
    Count(Event),
    Level,
    Division,
    StreakWeeks,
}

impl Rule {
    pub fn fact(&self) -> Fact {
        match self {
            Rule::Count { event, .. } => Fact::Count(*event),
            Rule::Level { .. } => Fact::Level,
            Rule::Division { .. } => Fact::Division,
            Rule::StreakWeeks { .. } => Fact::StreakWeeks,
        }
    }

    pub fn target(&self) -> i64 {
        match self {
            Rule::Count { gte, .. } | Rule::Level { gte } | Rule::StreakWeeks { gte } => *gte,
            Rule::Division { gte } => *gte as i64 + 1,
        }
    }
}

/// A stored rule. One that does not parse never awards anything.
pub fn parse_rule(raw: &str) -> Option<Rule> {
    serde_json::from_str::<Rule>(raw)
        .ok()
        .filter(|rule| rule.target() >= 1)
}

#[derive(Debug, Serialize)]
pub struct Progress {
    pub current: i64,
    pub target: i64,
    pub met: bool,
}

/// Progress toward a badge: the fact, capped at the target.
pub fn progress(rule: &Rule, facts: &HashMap<Fact, i64>) -> Progress {
    let target = rule.target();
    let current = facts.get(&rule.fact()).copied().unwrap_or(0);
    Progress {
        current: current.min(target),
        target,
        met: current >= target,
    }
}

/// The facts `needed` reads, and no other.
async fn facts(
    conn: &mut MySqlConnection,
    user: Uuid,
    needed: &HashSet<Fact>,
) -> Result<HashMap<Fact, i64>, AppError> {
    let mut out = HashMap::new();
    for fact in needed {
        let value = match fact {
            Fact::Count(Event::WorkoutAccepted) => {
                sqlx::query_scalar!(
                    "SELECT COUNT(*) FROM workouts WHERE user_id = ? AND status = 'ACCEPTED'",
                    user
                )
                .fetch_one(&mut *conn)
                .await?
            }
            // A record made during calibration is not an awarded one.
            Fact::Count(Event::PrAwarded) => {
                sqlx::query_scalar!(
                    "SELECT COUNT(*) FROM personal_records WHERE user_id = ? AND status IN ('AWARDED', 'SUPERSEDED')",
                    user
                )
                .fetch_one(&mut *conn)
                .await?
            }
            Fact::Count(Event::GoalCompleted) => {
                sqlx::query_scalar!(
                    "SELECT COUNT(*) FROM goals WHERE user_id = ? AND status = 'COMPLETED'",
                    user
                )
                .fetch_one(&mut *conn)
                .await?
            }
            Fact::Level => sqlx::query_scalar!("SELECT level FROM user_stats WHERE user_id = ?", user)
                .fetch_optional(&mut *conn)
                .await?
                .map_or(1, i64::from),
            // plan 2d: DIVISION and STREAK_WEEKS read the league's tables.
            // parts 3 and 4: friends, gyms, battles, duels, gym wars and challenges.
            _ => 0,
        };
        out.insert(*fact, value);
    }
    Ok(out)
}

/// Awards every enabled badge the athlete now meets, in the caller's transaction. A badge once
/// held, even revoked, is never given again; awards are not revoked here (moderation does it).
pub async fn evaluate(
    tx: &mut MySqlConnection,
    user: Uuid,
    source_ref: Option<&str>,
) -> Result<(), AppError> {
    // Two transactions of one athlete award in turn, so a badge is never given twice.
    sqlx::query!(
        "SELECT user_id FROM user_stats WHERE user_id = ? FOR UPDATE",
        user
    )
    .fetch_one(&mut *tx)
    .await?;
    let rows = sqlx::query!(
        r#"SELECT b.id AS "id: Uuid", b.rule FROM badges b
           WHERE b.enabled AND NOT EXISTS (SELECT 1 FROM user_badges ub WHERE ub.user_id = ? AND ub.badge_id = b.id)"#,
        user
    )
    .fetch_all(&mut *tx)
    .await?;
    let pending: Vec<(Uuid, Rule)> = rows
        .into_iter()
        .filter_map(|row| parse_rule(&row.rule).map(|rule| (row.id, rule)))
        .collect();
    if pending.is_empty() {
        return Ok(());
    }
    let needed = pending.iter().map(|(_, rule)| rule.fact()).collect();
    let facts = facts(tx, user, &needed).await?;
    for (badge, rule) in &pending {
        if progress(rule, &facts).met {
            sqlx::query!(
                "INSERT INTO user_badges (id, user_id, badge_id, awarded_at, source_ref) \
                 VALUES (?, ?, ?, UTC_TIMESTAMP(6), ?)",
                Uuid::now_v7(),
                user,
                badge,
                source_ref
            )
            .execute(&mut *tx)
            .await?;
        }
    }
    Ok(())
}

/// The catalogue with my progress and the date I earned each badge.
async fn catalogue(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT b.code, b.category, b.name_fr, b.name_en, b.name_ar, b.description_fr, b.description_en,
                  b.description_ar, b.icon, b.rarity, b.rule, ub.awarded_at AS "awarded_at?"
           FROM badges b
             LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = ? AND ub.revoked_at IS NULL
           WHERE b.enabled ORDER BY b.category, b.code"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;
    let rules: Vec<Option<Rule>> = rows.iter().map(|row| parse_rule(&row.rule)).collect();
    let needed = rules.iter().flatten().map(Rule::fact).collect();
    let mut conn = state.db.acquire().await?;
    let facts = facts(&mut conn, user.id, &needed).await?;
    let cards = rows
        .into_iter()
        .zip(rules)
        .map(|(row, rule)| {
            json!({
                "code": row.code,
                "category": row.category,
                "name": {"fr": row.name_fr, "en": row.name_en, "ar": row.name_ar},
                "description": {"fr": row.description_fr, "en": row.description_en, "ar": row.description_ar},
                "icon": row.icon,
                "rarity": row.rarity,
                "awardedAt": row.awarded_at.map(iso),
                "progress": rule.map(|rule| progress(&rule, &facts)),
            })
        })
        .collect();
    Ok(Json(Value::Array(cards)))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn badge_progress() {
        let facts = HashMap::from([
            (Fact::Count(Event::PrAwarded), 12),
            (Fact::Level, 7),
            (Fact::Division, 3),
            (Fact::StreakWeeks, 2),
        ]);
        let of = |raw: &str| {
            let p = progress(&parse_rule(raw).unwrap(), &facts);
            (p.current, p.target, p.met)
        };
        assert_eq!(
            of(r#"{"type":"COUNT","event":"PR_AWARDED","gte":10}"#),
            (10, 10, true)
        );
        assert_eq!(of(r#"{"type":"LEVEL","gte":10}"#), (7, 10, false));
        assert!(of(r#"{"type":"DIVISION","gte":"GOLD"}"#).2);
        assert_eq!(of(r#"{"type":"DIVISION","gte":"PLATINUM"}"#), (3, 4, false));
        assert_eq!(of(r#"{"type":"STREAK_WEEKS","gte":4}"#), (2, 4, false));
        assert!(!of(r#"{"type":"COUNT","event":"FRIEND","gte":1}"#).2);
    }

    #[test]
    fn bad_badge_rules() {
        assert!(parse_rule(r#"{"type":"COUNT","event":"NOPE","gte":1}"#).is_none());
        assert!(parse_rule(r#"{"type":"LEVEL","gte":0}"#).is_none());
        assert!(parse_rule("{}").is_none());
    }
}
