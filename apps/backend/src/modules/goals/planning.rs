//! Goal maths (docs §10): milestones, ETAs and the safety limits. A port of the old API's
//! `goal-planning.ts`. Suggestions are estimates from the expected progression, not medical or
//! coaching advice.

use serde::Serialize;

use crate::modules::scoring::engine::Direction;

/// The most milestones a goal is split into.
const MAX_MILESTONES: f64 = 6.0;
/// The fast bound of an ETA: the reward cap allows 1.5 times the expected progress.
pub const FAST_RATE: f64 = 1.5;

/// Rounding the way athletes think: 2.5 kg plates, 5-second steps, 0.5 kg of body weight, whole
/// reps and days.
pub fn round_for(unit: &str, metric: &str, v: f64) -> f64 {
    if metric == "BODY_WEIGHT" {
        (v * 2.0).round() / 2.0
    } else if unit == "kg" {
        (v / 2.5).round() * 2.5
    } else if unit == "s" || unit == "s_per_km" {
        (v / 5.0).round() * 5.0
    } else {
        v.round()
    }
}

/// Splits start → target into steps of about one expected month of progress each, 1 to 6 of them:
/// squat 100 → 120 at 5 kg a month gives 105, 110, 115, 120.
pub fn plan_milestones(
    start: f64,
    target: f64,
    monthly_step: f64,
    round: impl Fn(f64) -> f64,
) -> Vec<f64> {
    let range = target - start;
    let step = if monthly_step.abs() > 0.0 {
        monthly_step.abs()
    } else {
        range.abs()
    };
    let n = (range.abs() / step - 1e-9)
        .ceil()
        .clamp(1.0, MAX_MILESTONES) as i64;
    let mut out: Vec<f64> = Vec::new();
    for i in 1..=n {
        let value = if i == n {
            target
        } else {
            round(start + range * i as f64 / n as f64)
        };
        if out.last() != Some(&value) {
            out.push(value);
        }
    }
    out
}

pub fn reached(value: f64, milestone: f64, d: Direction) -> bool {
    match d {
        Direction::Higher => value >= milestone,
        Direction::Lower => value <= milestone,
    }
}

/// Weeks from start to target at a percent per 28 days, compounded weekly. `None` at no progress.
pub fn weeks_at_rate(start: f64, target: f64, pct_per_28_days: f64, d: Direction) -> Option<i64> {
    if !(pct_per_28_days > 0.0 && start > 0.0 && target > 0.0) {
        return None;
    }
    let weekly = pct_per_28_days / 100.0 / 4.0;
    let ratio = match d {
        Direction::Higher => target / start,
        Direction::Lower => start / target,
    };
    if ratio <= 1.0 {
        return Some(0);
    }
    Some((ratio.ln() / (1.0 + weekly).ln()).ceil() as i64)
}

#[derive(Debug, Serialize)]
pub struct Eta {
    pub min: i64,
    pub max: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub horizon: &'static str,
    pub target_value: f64,
    pub eta_weeks: Eta,
}

/// Three realistic targets. The slow bound of each ETA is the expected rate for the athlete's
/// level, the fast one 1.5 times that rate.
pub fn suggest_targets(
    current: f64,
    expected_pct: f64,
    d: Direction,
    round: impl Fn(f64) -> f64,
) -> Vec<Suggestion> {
    let mut out: Vec<Suggestion> = Vec::new();
    for (horizon, weeks) in [("SHORT", 4), ("MEDIUM", 10), ("LONG", 20)] {
        let factor = (1.0 + expected_pct / 100.0 / 4.0).powi(weeks);
        let raw = match d {
            Direction::Higher => current * factor,
            Direction::Lower => current / factor,
        };
        let target_value = round(raw);
        if target_value == round(current) || out.iter().any(|s| s.target_value == target_value) {
            continue;
        }
        let at = |pct| weeks_at_rate(current, target_value, pct, d).unwrap_or(i64::from(weeks));
        out.push(Suggestion {
            horizon,
            target_value,
            eta_weeks: Eta {
                min: at(expected_pct * FAST_RATE).max(1),
                max: at(expected_pct).max(1),
            },
        });
    }
    out
}

/// The earliest safe date for a body-weight change, at `max_pct_per_week` of the start weight.
pub fn safe_weight_weeks(start_kg: f64, target_kg: f64, max_pct_per_week: f64) -> i64 {
    ((target_kg - start_kg).abs() / (start_kg * max_pct_per_week / 100.0)).ceil() as i64
}

/// The body-weight change credited toward a goal: a faster change than the safe rate earns nothing
/// more.
pub fn credited_weight_change(
    actual_kg: f64,
    start_kg: f64,
    weeks: f64,
    max_pct_per_week: f64,
) -> f64 {
    let cap = start_kg * max_pct_per_week / 100.0 * weeks.max(0.0);
    actual_kg.signum() * actual_kg.abs().min(cap)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::scoring::engine::Direction::{Higher, Lower};

    fn kg(v: f64) -> f64 {
        round_for("kg", "E1RM", v)
    }

    #[test]
    fn milestones_split_the_way() {
        assert_eq!(
            plan_milestones(100.0, 120.0, 5.0, kg),
            [105.0, 110.0, 115.0, 120.0]
        );
        assert_eq!(plan_milestones(100.0, 200.0, 5.0, kg).len(), 6);
        let seconds = |v| round_for("s", "TIME_5K", v);
        assert_eq!(
            plan_milestones(1800.0, 1650.0, 60.0, seconds),
            [1750.0, 1700.0, 1650.0]
        );
    }

    #[test]
    fn milestones_are_reached_both_ways() {
        assert!(reached(110.0, 110.0, Higher));
        assert!(reached(1649.0, 1650.0, Lower));
        assert!(!reached(1651.0, 1650.0, Lower));
    }

    #[test]
    fn suggestions_for_a_beginner_squat() {
        let s = suggest_targets(80.0, 8.0, Higher, kg);
        let targets: Vec<(&str, f64)> = s.iter().map(|x| (x.horizon, x.target_value)).collect();
        assert_eq!(
            targets,
            [("SHORT", 87.5), ("MEDIUM", 97.5), ("LONG", 120.0)]
        );
        assert_eq!((s[0].eta_weeks.min, s[0].eta_weeks.max), (4, 5));
        assert_eq!(weeks_at_rate(80.0, 90.0, 8.0, Higher), Some(6));
        assert_eq!(weeks_at_rate(80.0, 90.0, 3.0, Higher), Some(16));
        assert!(suggest_targets(200.0, 1.0, Higher, kg)[0].target_value <= 205.0);
    }

    #[test]
    fn weeks_at_a_rate() {
        assert_eq!(weeks_at_rate(100.0, 100.0, 8.0, Higher), Some(0));
        assert_eq!(weeks_at_rate(100.0, 110.0, 8.0, Higher), Some(5));
        assert_eq!(weeks_at_rate(100.0, 110.0, 0.0, Higher), None);
    }

    #[test]
    fn weight_change_is_paced() {
        assert_eq!(safe_weight_weeks(90.0, 80.0, 1.0), 12);
        assert!((credited_weight_change(-6.0, 90.0, 4.0, 1.0) + 3.6).abs() < 1e-9);
        assert_eq!(credited_weight_change(2.0, 60.0, 4.0, 1.0), 2.0);
    }

    #[test]
    fn rounding() {
        assert_eq!(round_for("kg", "BODY_WEIGHT", 77.3), 77.5);
        assert_eq!(round_for("kg", "E1RM", 121.2), 120.0);
        assert_eq!(round_for("s", "TIME_5K", 1712.0), 1710.0);
        assert_eq!(round_for("count", "MAX_REPS", 12.4), 12.0);
    }
}
