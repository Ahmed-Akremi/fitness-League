//! Badges (docs §3.10): data-driven rules, each reading one fact about the athlete against a
//! threshold. A port of the old API's `badge-rules.ts` and `badges.service.ts`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

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
