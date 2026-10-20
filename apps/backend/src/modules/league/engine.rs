//! The league rules as pure functions (docs/ARCHITECTURE.md §5.4, §5.5, §5.10): the weekly score's
//! components, divisions, the season soft reset, the baseline audit and the weekly streak. A port of
//! the old API's `fairness.ts`, `divisionFor`, `softReset` and `currentStreak`.

use std::collections::HashMap;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::Serialize;

use crate::{
    modules::{
        badges::Division,
        scoring::engine::{Direction, improvement_pct},
    },
    rules::LpWeights,
    security::policy,
    validate::round_to,
};

/// A metric's progress score, 0 to 100; a ratio beyond the reward cap earns nothing more.
pub fn metric_progress_score(ratio: f64, reward_cap: f64) -> f64 {
    ratio.max(0.0).min(reward_cap) / reward_cap * 100.0
}

/// The mean of the `n` best values; 0 when there are none.
pub fn top_n_mean(values: &[f64], n: usize) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| b.total_cmp(a));
    let top = &sorted[..n.min(sorted.len())];
    if top.is_empty() {
        0.0
    } else {
        top.iter().sum::<f64>() / top.len() as f64
    }
}

/// Training beyond the plan earns nothing more: rest days are part of it (docs §5).
pub fn consistency(training_days: i64, planned_days: i64) -> f64 {
    if planned_days <= 0 {
        return 0.0;
    }
    (training_days as f64 / planned_days as f64).min(1.0) * 100.0
}

/// How close the week's best is to the all-time best: 1 at or beyond it.
pub fn performance_ratio(week_best: f64, all_time: f64, d: Direction) -> f64 {
    if !(week_best > 0.0 && all_time > 0.0) {
        return 0.0;
    }
    let ratio = match d {
        Direction::Higher => week_best / all_time,
        Direction::Lower => all_time / week_best,
    };
    ratio.min(1.0)
}

/// The weekly score's components, 0 to 100 each. `challenge` is `None` while challenges do not
/// count, and the other weights are then renormalised.
#[derive(Debug, Serialize)]
pub struct Components {
    pub progress: f64,
    pub consistency: f64,
    pub performance: f64,
    pub challenge: Option<f64>,
}

pub fn weighted_total(c: &Components, w: &LpWeights) -> f64 {
    let mut parts = vec![
        (c.progress, w.progress),
        (c.consistency, w.consistency),
        (c.performance, w.performance),
    ];
    if let Some(challenge) = c.challenge {
        parts.push((challenge, w.challenge));
    }
    let weights: f64 = parts.iter().map(|(_, w)| w).sum();
    if weights <= 0.0 {
        return 0.0;
    }
    parts.iter().map(|(v, w)| v * w).sum::<f64>() / weights
}

/// The live division of an LP total: the highest whose threshold it reaches.
pub fn division_for(lp: i64, t: &HashMap<Division, i64>) -> Division {
    Division::ALL
        .into_iter()
        .rev()
        .find(|d| t.get(d).is_some_and(|floor| lp >= *floor))
        .unwrap_or(Division::Bronze)
}

/// The next division up and the LP still missing to reach it; `None` at the top.
pub fn next_division(lp: i64, t: &HashMap<Division, i64>) -> Option<(Division, i64)> {
    Division::ALL
        .into_iter()
        .find_map(|d| t.get(&d).filter(|floor| **floor > lp).map(|floor| (d, floor - lp)))
}

pub fn division_floor(lp: i64, t: &HashMap<Division, i64>) -> i64 {
    t.get(&division_for(lp, t)).copied().unwrap_or(0)
}

/// A new season's LP: `floor + (lp − floor) × ratio`, so nobody drops a division (docs §5.10.4).
pub fn soft_reset(lp: i64, t: &HashMap<Division, i64>, ratio: f64) -> i64 {
    let floor = division_floor(lp, t);
    (floor as f64 + (lp - floor) as f64 * ratio).round() as i64
}

/// Anti-sandbagging (docs §5.4): a best performance more than `ceiling` times the expected
/// progress above a final baseline shows the baseline was understated. The raised baseline, rounded
/// to 3 decimals, or `None` when the progress is plausible.
pub fn audited_baseline(
    baseline: f64,
    best: f64,
    elapsed_days: f64,
    pct: f64,
    d: Direction,
    ceiling: f64,
    window_days: f64,
) -> Option<f64> {
    let allowed = ceiling * pct * (elapsed_days.max(1.0) / window_days);
    if improvement_pct(baseline, best, d) <= allowed {
        return None;
    }
    let factor = 1.0 + allowed / 100.0;
    let raised = match d {
        Direction::Higher => best / factor,
        Direction::Lower => best * factor,
    };
    Some(round_to(raised, 3))
}

/// Consecutive weeks met, counted back from the latest; a missed week or a gap stops it.
pub fn current_streak(weeks: &[(NaiveDate, bool)]) -> i64 {
    let mut sorted = weeks.to_vec();
    sorted.sort_by(|a, b| b.0.cmp(&a.0));
    let mut streak = 0;
    let mut expected: Option<NaiveDate> = None;
    for (week, met) in sorted {
        if !met || expected.is_some_and(|e| e != week) {
            break;
        }
        streak += 1;
        expected = Some(week - Duration::days(7));
    }
    streak
}

/// The start of the latest week whose grace period is over.
pub fn last_closable_week(now: DateTime<Utc>, grace_hours: i64, offset: i32) -> DateTime<Utc> {
    let candidate = policy::week_start(now, offset) - Duration::days(7);
    if now >= candidate + Duration::days(7) + Duration::hours(grace_hours) {
        candidate
    } else {
        candidate - Duration::days(7)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use chrono::{NaiveDate, TimeZone, Utc};

    use super::*;
    use crate::{
        modules::{
            badges::Division,
            scoring::engine::{Direction, improvement_pct, progress_ratio},
        },
        rules::tests::seeded,
    };

    fn near(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 0.05,
            "{actual} is not about {expected}"
        );
    }

    #[test]
    fn the_worked_example_of_5_10_1() {
        let rules = seeded();
        let w = &rules.lp_weights;
        let sami = metric_progress_score(
            progress_ratio(improvement_pct(60.0, 65.0, Direction::Higher), 8.0),
            1.5,
        );
        let karim = metric_progress_score(
            progress_ratio(improvement_pct(200.0, 202.0, Direction::Higher), 1.0),
            1.5,
        );
        near(sami, 69.4);
        near(karim, 66.7);
        let karim_perf = top_n_mean(
            &[
                performance_ratio(202.0, 202.0, Direction::Higher),
                performance_ratio(140.0, 145.0, Direction::Higher),
            ],
            3,
        ) * 100.0;
        let total = |progress, consistency, performance, challenge| {
            weighted_total(
                &Components {
                    progress,
                    consistency,
                    performance,
                    challenge,
                },
                w,
            )
        };
        near(total(sami, consistency(3, 3), 100.0, Some(100.0)), 87.8);
        near(total(karim, consistency(4, 5), karim_perf, Some(0.0)), 66.3);
        near(total(sami, 100.0, 100.0, None), 85.6);
        near(total(karim, 80.0, karim_perf, None), 78.0);
    }

    #[test]
    fn rewards_are_capped() {
        assert_eq!(metric_progress_score(3.0, 1.5), 100.0);
        let regress = progress_ratio(improvement_pct(100.0, 95.0, Direction::Higher), 3.0);
        assert_eq!(metric_progress_score(regress, 1.5), 0.0);
        assert_eq!(consistency(6, 3), 100.0);
        near(consistency(1, 3), 33.33);
        near(performance_ratio(1500.0, 1440.0, Direction::Lower), 0.96);
        assert_eq!(top_n_mean(&[], 3), 0.0);
        near(top_n_mean(&[10.0, 50.0, 30.0, 20.0], 3), 33.33);
    }

    #[test]
    fn divisions_follow_lp() {
        let t = seeded().division_thresholds;
        let got = [0, 399, 400, 1240, 2599, 5000].map(|lp| division_for(lp, &t));
        use Division::*;
        assert_eq!(got, [Bronze, Bronze, Silver, Gold, Diamond, Elite]);
        assert_eq!(next_division(1240, &t), Some((Platinum, 160)));
        assert_eq!(next_division(2600, &t), None);
    }

    #[test]
    fn the_soft_reset() {
        let t = seeded().division_thresholds;
        assert_eq!(
            [1240, 900, 86, 0].map(|lp| soft_reset(lp, &t, 0.5)),
            [1070, 900, 43, 0]
        );
        assert_eq!(division_floor(3000, &t), 2600);
    }

    #[test]
    fn nours_baseline_is_corrected() {
        let audit =
            |best, days| audited_baseline(50.0, best, days, 8.0, Direction::Higher, 2.0, 28.0);
        assert_eq!(audit(64.0, 28.0), Some(55.172));
        assert_eq!(audit(58.0, 28.0), None);
        assert_eq!(audit(52.5, 7.0), Some(50.481));
    }

    #[test]
    fn the_weekly_streak() {
        let w = |d: &str, met: bool| (d.parse::<NaiveDate>().unwrap(), met);
        assert_eq!(
            current_streak(&[
                w("2026-10-19", true),
                w("2026-10-12", true),
                w("2026-10-05", true),
                w("2026-09-21", true)
            ]),
            3
        );
        assert_eq!(
            current_streak(&[w("2026-10-19", false), w("2026-10-12", true)]),
            0
        );
        assert_eq!(
            current_streak(&[
                w("2026-10-12", true),
                w("2026-10-19", true),
                w("2026-10-05", false)
            ]),
            2
        );
        assert_eq!(current_streak(&[]), 0);
    }

    #[test]
    fn the_last_closable_week() {
        let at = |d, h| Utc.with_ymd_and_hms(2026, 10, d, h, 0, 0).unwrap();
        assert_eq!(last_closable_week(at(20, 10), 24, 60), at(11, 23));
        assert_eq!(last_closable_week(at(19, 10), 24, 60), at(4, 23));
    }
}
