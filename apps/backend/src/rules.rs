//! The active rule set: the numbers the product owner can change without a release.

use std::collections::HashMap;

use serde::Deserialize;
use sqlx::MySqlPool;

use crate::error::AppError;

#[derive(Deserialize)]
pub struct LevelTitle {
    #[serde(rename = "fromLevel")]
    pub from_level: i32,
    pub key: String,
}

/// Only the fields the built parts read. The configuration holds many more.
#[derive(Deserialize)]
pub struct Rules {
    /// The rule set's own version, recorded next to every verdict and point it produces.
    #[serde(skip)]
    pub version: i32,
    pub min_age_years: i32,
    pub level_titles: Vec<LevelTitle>,
    /// How long the calibration period lasts once onboarding is complete.
    pub calibration_days: i64,
    /// A workout logged later than this counts for history and progress, never for points.
    pub late_log_max_hours: f64,
    pub e1rm_formula: E1rmFormula,
    pub e1rm_max_reps: i32,
    pub anticheat: Anticheat,

    // XP (docs/ARCHITECTURE.md §5.6).
    pub workout_base_xp: i64,
    pub workout_max_xp: i64,
    pub workout_xp_minutes_per_point: i64,
    pub workout_min_duration_min: i64,
    /// Workouts of a business day that earn full XP; the next ones take `diminishing_multipliers`.
    pub diminishing_returns_after: i64,
    pub diminishing_multipliers: Vec<f64>,
    pub daily_xp_cap: i64,
    pub weekly_xp_cap: i64,
    pub pr_xp_min: i64,
    pub pr_xp_max: i64,
    pub calibration_pr_xp: i64,
    pub pr_same_metric_cooldown_days: i64,
    pub first_workout_quest_xp: i64,
    pub level_base_xp: f64,
    pub level_exponent: f64,

    // Fairness (§5.4): baselines, expected progress and the levels that set it.
    /// Sessions of an exercise first seen after calibration before its baseline is final.
    pub baseline_first_logs: i64,
    /// A record beyond this many times the expected progress is held for review.
    pub progress_ceiling_ratio: f64,
    /// By exercise code.
    pub strength_standards: HashMap<String, StrengthStandard>,
    /// By metric code, in seconds: lower is better.
    pub running_standards: HashMap<String, Tiers>,
}

/// The value from which an athlete is intermediate, then advanced.
#[derive(Deserialize)]
pub struct Tiers {
    pub intermediate: f64,
    pub advanced: f64,
}

#[derive(Deserialize)]
pub struct StrengthStandard {
    #[serde(rename = "bwRatio")]
    pub bw_ratio: Tiers,
    #[serde(rename = "absoluteKg")]
    pub absolute_kg: Tiers,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum E1rmFormula {
    Epley,
    Brzycki,
}

/// A value past `hold` is held for review; past `reject` it is refused.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Limits {
    pub hold: f64,
    pub reject: f64,
}

#[derive(Deserialize)]
pub struct Lift {
    #[serde(rename = "bwRatio")]
    pub bw_ratio: Limits,
    #[serde(rename = "absoluteKg")]
    pub absolute_kg: Limits,
}

#[derive(Deserialize)]
pub struct Repeats {
    pub count: i64,
    pub days: i64,
}

/// Layer 1 anti-cheat thresholds (docs/ARCHITECTURE.md §7.2).
#[derive(Deserialize)]
pub struct Anticheat {
    pub future_skew_max_min: f64,
    pub clock_skew_hold_hours: f64,
    pub run_pace_s_per_km: Limits,
    pub run_distance_m: Limits,
    /// By race metric: `TIME_5K`, `TIME_10K`, `TIME_21K`.
    pub run_time_s: HashMap<String, Limits>,
    pub ride_speed_kmh: Limits,
    pub ride_distance_m: Limits,
    pub walk_speed_kmh: Limits,
    pub swim_pace_s_per_100m: Limits,
    /// By exercise code: the lifts judged on their e1RM.
    pub lifts: HashMap<String, Lift>,
    pub reps_weighted: Limits,
    pub reps_bodyweight: Limits,
    pub workout_duration_h: Limits,
    pub sets_per_workout: Limits,
    pub workouts_per_day_hold: i64,
    pub identical_fingerprint_hold: Repeats,
}

impl Rules {
    // ponytail: read from the database on every call (one indexed row). Cache it in the process
    // when a profile shows it, and refresh the cache when a rule set is activated.
    pub async fn active(db: &MySqlPool) -> Result<Self, AppError> {
        let row = sqlx::query!("SELECT version, config FROM rule_sets WHERE status = 'ACTIVE'")
            .fetch_optional(db)
            .await?
            .ok_or_else(|| AppError::internal("no active rule set: run `backend seed`"))?;
        let mut rules: Self = serde_json::from_str(&row.config)
            .map_err(|e| AppError::internal(format!("active rule set: {e}")))?;
        rules.version = row.version;
        Ok(rules)
    }

    /// The translation key of the title held at `level`: the last one whose first level is reached.
    pub fn level_title_key(&self, level: i32) -> &str {
        self.level_titles
            .iter()
            .rfind(|title| level >= title.from_level)
            .or(self.level_titles.first())
            .map_or("", |title| title.key.as_str())
    }
}

#[cfg(test)]
pub mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use std::path::Path;

    use super::*;

    /// The configuration of the seeded rule set, version 2.
    pub fn seeded() -> Rules {
        let path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../infra/seed-data/ruleset-v2.json");
        let file: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        serde_json::from_value(file["config"].clone()).unwrap()
    }

    #[test]
    fn the_seeded_rule_set_reads() {
        let rules = seeded();
        assert_eq!(rules.e1rm_formula, E1rmFormula::Epley);
        assert_eq!(rules.e1rm_max_reps, 12);
        assert_eq!(rules.late_log_max_hours, 72.0);
        assert_eq!(rules.anticheat.lifts["BACK_SQUAT"].absolute_kg.hold, 300.0);
        assert_eq!(rules.anticheat.run_time_s["TIME_5K"].reject, 750.0);
        assert_eq!(rules.anticheat.identical_fingerprint_hold.days, 14);
        assert_eq!(rules.daily_xp_cap, 400);
        assert_eq!(
            rules.strength_standards["BACK_SQUAT"]
                .absolute_kg
                .intermediate,
            100.0
        );
    }
}
