//! The scoring rules as pure functions (docs/ARCHITECTURE.md §5): workout and record XP, the caps,
//! the level curve, progress measured against what the athlete's level expects, the values a
//! workout records, and the daily streak. Every number comes from the rule set.

use std::collections::HashMap;

use chrono::NaiveDate;
use serde::Serialize;
use uuid::Uuid;

use crate::{
    modules::workouts::metrics::{self, WorkoutInput},
    rules::Rules,
    types::ExperienceLevel,
};

/// One line of a points explanation, as the app renders it.
#[derive(Debug, Serialize)]
pub struct Step {
    pub label: &'static str,
    pub value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applied: Option<bool>,
}

fn step(label: &'static str, value: f64) -> Step {
    Step {
        label,
        value,
        expr: None,
        applied: None,
    }
}

/// Workout XP before the caps: a base plus one point per N minutes, up to a maximum; nothing under
/// the minimum duration.
pub fn workout_xp(duration_s: i32, r: &Rules) -> (i64, Vec<Step>) {
    let minutes = i64::from(duration_s) / 60;
    if minutes < r.workout_min_duration_min {
        let below = Step {
            expr: Some(format!("< {} min", r.workout_min_duration_min)),
            ..step("below_min_duration", minutes as f64)
        };
        return (0, vec![below]);
    }
    let per = r.workout_xp_minutes_per_point;
    let bonus = minutes.checked_div(per).unwrap_or(0);
    let raw = r.workout_base_xp + bonus;
    let steps = vec![
        step("base", r.workout_base_xp as f64),
        Step {
            expr: Some(format!("floor({minutes}/{per})")),
            ..step("duration_bonus", bonus as f64)
        },
        Step {
            applied: Some(raw > r.workout_max_xp),
            ..step("workout_max", r.workout_max_xp as f64)
        },
    ];
    (raw.min(r.workout_max_xp), steps)
}

/// The multiplier of the `nth` counted workout of a business day (1-based).
pub fn diminishing_multiplier(nth: i64, r: &Rules) -> f64 {
    if nth <= r.diminishing_returns_after {
        return 1.0;
    }
    let past = usize::try_from(nth - r.diminishing_returns_after - 1).unwrap_or(usize::MAX);
    let last = r.diminishing_multipliers.len().saturating_sub(1);
    r.diminishing_multipliers
        .get(past.min(last))
        .copied()
        .unwrap_or(1.0)
}

/// What fits under the daily and weekly caps, given what was already granted.
pub fn apply_caps(requested: i64, today: i64, week: i64, r: &Rules) -> (i64, Vec<Step>) {
    let daily = (r.daily_xp_cap - today).max(0);
    let weekly = (r.weekly_xp_cap - week).max(0);
    let steps = vec![
        Step {
            applied: Some(requested > daily),
            ..step("daily_cap_remaining", daily as f64)
        },
        Step {
            applied: Some(requested > weekly),
            ..step("weekly_cap_remaining", weekly as f64)
        },
    ];
    (requested.min(daily).min(weekly).max(0), steps)
}

/// Record XP grows with how remarkable the progress is for the athlete's level: from the minimum at
/// no progress to the maximum at twice the expected progress.
pub fn pr_xp(ratio: f64, r: &Rules) -> i64 {
    let share = (ratio.max(0.0) / 2.0).min(1.0);
    (r.pr_xp_min as f64 + (r.pr_xp_max - r.pr_xp_min) as f64 * share).round() as i64
}

pub struct Level {
    pub level: i32,
    /// XP earned since the level was reached.
    pub into: i64,
    /// XP the next level costs.
    pub next: i64,
}

/// Going from level n to n + 1 costs base × n^exponent.
fn level_cost(level: i32, r: &Rules) -> i64 {
    (r.level_base_xp * f64::from(level).powf(r.level_exponent)).round() as i64
}

pub fn level_from_xp(total: i64, r: &Rules) -> Level {
    let mut level = 1;
    let mut into = total.max(0);
    let mut next = level_cost(level, r);
    while next > 0 && into >= next {
        into -= next;
        level += 1;
        next = level_cost(level, r);
    }
    Level { level, into, next }
}

/// Which way a metric improves: weights go up, run times go down.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Higher,
    Lower,
}

impl Direction {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "HIGHER_IS_BETTER" => Some(Direction::Higher),
            "LOWER_IS_BETTER" => Some(Direction::Lower),
            _ => None,
        }
    }
}

/// The relative improvement in percent, positive when better whatever the direction.
pub fn improvement_pct(reference: f64, current: f64, direction: Direction) -> f64 {
    if reference.is_nan() || reference <= 0.0 {
        return 0.0;
    }
    let delta = match direction {
        Direction::Higher => current - reference,
        Direction::Lower => reference - current,
    };
    delta / reference * 100.0
}

pub fn is_better(candidate: f64, record: f64, direction: Direction) -> bool {
    match direction {
        Direction::Higher => candidate > record,
        Direction::Lower => candidate < record,
    }
}

/// Progress as a multiple of what the athlete's level expects; regress counts as none.
pub fn progress_ratio(improvement: f64, expected_pct: f64) -> f64 {
    if expected_pct > 0.0 {
        improvement.max(0.0) / expected_pct
    } else {
        0.0
    }
}

/// The level a performance shows, from the rule set's standards: the body-weight ratio when the
/// weight is known, absolute kilograms otherwise. `None` when no standard covers it.
pub fn derive_experience_level(
    exercise_code: &str,
    metric_code: &str,
    best: f64,
    body_weight_kg: Option<f64>,
    r: &Rules,
) -> Option<ExperienceLevel> {
    use ExperienceLevel::{Advanced, Beginner, Intermediate};
    if metric_code == "E1RM" || metric_code == "MAX_WEIGHT" {
        let standard = r.strength_standards.get(exercise_code)?;
        let (value, tiers) = match body_weight_kg.filter(|kg| *kg > 0.0) {
            Some(kg) => (best / kg, &standard.bw_ratio),
            None => (best, &standard.absolute_kg),
        };
        return Some(if value >= tiers.advanced {
            Advanced
        } else if value >= tiers.intermediate {
            Intermediate
        } else {
            Beginner
        });
    }
    let tiers = r.running_standards.get(metric_code)?;
    Some(if best <= tiers.advanced {
        Advanced
    } else if best <= tiers.intermediate {
        Intermediate
    } else {
        Beginner
    })
}

/// Declaring a higher level would lower the expected progress and inflate the ratio, so the level
/// that expects the most progress wins (docs §5.4).
pub fn harder_level(
    candidates: &[Option<ExperienceLevel>],
    expected: impl Fn(ExperienceLevel) -> Option<f64>,
) -> ExperienceLevel {
    let mut levels = candidates.iter().flatten().copied();
    let Some(first) = levels.next() else {
        return ExperienceLevel::Beginner;
    };
    levels.fold(first, |best, level| {
        if expected(level).unwrap_or(0.0) > expected(best).unwrap_or(0.0) {
            level
        } else {
            best
        }
    })
}

/// The best value of one metric of one exercise in a workout.
#[derive(Debug, Clone)]
pub struct Observation {
    pub exercise_id: Uuid,
    pub metric: &'static str,
    /// The weight of a `REPS_AT_WEIGHT`, 0 otherwise.
    pub qualifier: f64,
    pub value: f64,
}

const STANDARD_DISTANCES: [(&str, i32); 4] = [
    ("TIME_1K", 1000),
    ("TIME_5K", 5000),
    ("TIME_10K", 10_000),
    ("TIME_21K", 21_097),
];

/// The best value per exercise, metric and qualifier, for the metrics each exercise tracks, warm-ups
/// left out. Standard-distance times are projected from the average pace of a run at least that
/// long: there are no splits before wearables (docs §12.2).
pub fn observations(
    w: &WorkoutInput,
    tracked: &HashMap<Uuid, Vec<String>>,
    r: &Rules,
    lower_is_better: impl Fn(&str) -> bool,
) -> Vec<Observation> {
    let mut best: Vec<Observation> = Vec::new();
    let mut offer = |o: Observation| {
        let same = best.iter_mut().find(|b| {
            b.exercise_id == o.exercise_id && b.metric == o.metric && b.qualifier == o.qualifier
        });
        match same {
            Some(b) => {
                let better = if lower_is_better(o.metric) {
                    o.value < b.value
                } else {
                    o.value > b.value
                };
                if better {
                    *b = o;
                }
            }
            None => best.push(o),
        }
    };

    let single = w.exercises.len() == 1;
    for ex in &w.exercises {
        let metrics = tracked.get(&ex.exercise_id).map_or(&[][..], Vec::as_slice);
        let has = |code: &str| metrics.iter().any(|m| m == code);
        let at = |metric: &'static str, qualifier: f64, value: f64| Observation {
            exercise_id: ex.exercise_id,
            metric,
            qualifier,
            value,
        };
        let mut distance = 0_i64;
        for s in ex.sets.iter().filter(|s| !s.is_warmup) {
            let reps = s.reps.unwrap_or(0);
            let weight = s.weight_kg.unwrap_or(0.0);
            if weight > 0.0 && reps >= 1 {
                if has("MAX_WEIGHT") {
                    offer(at("MAX_WEIGHT", 0.0, weight));
                }
                let e1rm = metrics::e1rm(weight, reps, r.e1rm_formula, r.e1rm_max_reps);
                if let Some(e1rm) = e1rm.filter(|_| has("E1RM")) {
                    offer(at("E1RM", 0.0, e1rm));
                }
                if has("REPS_AT_WEIGHT") {
                    offer(at("REPS_AT_WEIGHT", weight, f64::from(reps)));
                }
            }
            if reps >= 1 && has("MAX_REPS") {
                offer(at("MAX_REPS", 0.0, f64::from(reps)));
            }
            // Benchmark WODs, Hyrox races and stations: one timed set is the finish time.
            if let Some(time) = s.duration_s.filter(|t| *t > 0 && has("FINISH_TIME")) {
                offer(at("FINISH_TIME", 0.0, f64::from(time)));
            }
            let Some(meters) = s.distance_m.filter(|m| *m > 0) else {
                continue;
            };
            distance += i64::from(meters);
            // A lone set of a lone exercise without its own time takes the workout's.
            let duration = match s.duration_s {
                Some(time) => Some(time),
                None if single && ex.sets.len() == 1 => Some(w.duration_s),
                None => None,
            };
            let Some(time) = duration.filter(|t| *t > 0) else {
                continue;
            };
            let (time, length) = (f64::from(time), f64::from(meters));
            if meters >= 1000 && has("PACE") {
                offer(at("PACE", 0.0, (time / (length / 1000.0)).round()));
            }
            for (code, standard) in STANDARD_DISTANCES {
                if has(code) && meters >= standard {
                    offer(at(code, 0.0, (time / length * f64::from(standard)).round()));
                }
            }
        }
        if distance > 0 && has("DISTANCE") {
            offer(at("DISTANCE", 0.0, distance as f64));
        }
    }
    best
}

/// The daily streak after training on `day`. Up to `freeze_days` days of planned rest keep it
/// alive and count in it, so it never pushes anyone to train every day. `None` leaves it as it
/// is: the same day again, or a workout dated before the last one.
pub fn next_daily_streak(
    last: Option<NaiveDate>,
    current: i32,
    day: NaiveDate,
    freeze_days: i32,
) -> Option<i32> {
    let Some(last) = last else {
        return Some(1);
    };
    let gap = (day - last).num_days();
    if gap <= 0 {
        return None;
    }
    Some(if gap <= 1 + i64::from(freeze_days) {
        current.saturating_add(i32::try_from(gap).unwrap_or(i32::MAX))
    } else {
        1
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use std::collections::HashMap;

    use chrono::{NaiveDate, Utc};
    use uuid::Uuid;

    use super::*;
    use crate::{
        modules::workouts::metrics::{ExerciseInput, SetInput, WorkoutInput},
        rules::tests::seeded,
        types::ExperienceLevel::{Advanced, Beginner, Intermediate},
    };

    fn labels(steps: &[Step]) -> Vec<(&str, f64, Option<bool>)> {
        steps
            .iter()
            .map(|s| (s.label, s.value, s.applied))
            .collect()
    }

    #[test]
    fn workout_xp_follows_duration() {
        let r = seeded();
        assert_eq!(workout_xp(62 * 60, &r).0, 30);
        let (xp, steps) = workout_xp(3 * 3600, &r);
        assert_eq!(xp, 50);
        assert_eq!(labels(&steps)[2], ("workout_max", 50.0, Some(true)));
        let (xp, steps) = workout_xp(14 * 60, &r);
        assert_eq!(xp, 0);
        assert_eq!(steps[0].label, "below_min_duration");
        assert_eq!(workout_xp(15 * 60, &r).0, 15);
    }

    #[test]
    fn diminishing_returns() {
        let r = seeded();
        let m: Vec<f64> = (1..=5).map(|n| diminishing_multiplier(n, &r)).collect();
        assert_eq!(m, [1.0, 1.0, 0.5, 0.0, 0.0]);
    }

    #[test]
    fn caps() {
        let r = seeded();
        assert_eq!(apply_caps(100, 350, 0, &r).0, 50);
        assert_eq!(apply_caps(100, 0, 1950, &r).0, 50);
        assert_eq!(apply_caps(100, 400, 0, &r).0, 0);
        let (granted, steps) = apply_caps(477, 30, 30, &r);
        assert_eq!(granted, 370);
        assert_eq!(
            labels(&steps),
            [
                ("daily_cap_remaining", 370.0, Some(true)),
                ("weekly_cap_remaining", 1970.0, Some(false))
            ]
        );
    }

    #[test]
    fn pr_xp_scales_with_the_ratio() {
        let r = seeded();
        // 0.634 is the worked example of docs/ARCHITECTURE.md §5.10.3.
        let xp: Vec<i64> = [0.0, 0.634, 2.0, 9.0, -1.0]
            .iter()
            .map(|ratio| pr_xp(*ratio, &r))
            .collect();
        assert_eq!(xp, [50, 193, 500, 500, 50]);
    }

    #[test]
    fn the_level_curve() {
        let r = seeded();
        let at = |total| {
            let l = level_from_xp(total, &r);
            (l.level, l.into, l.next)
        };
        assert_eq!(at(0), (1, 0, 100));
        assert_eq!(at(99), (1, 99, 100));
        assert_eq!(at(100), (2, 0, 283));
        assert_eq!(at(140), (2, 40, 283));
        assert_eq!(at(383), (3, 0, 520));
        assert_eq!(at(903), (4, 0, 800));
    }

    #[test]
    fn fairness() {
        assert!((improvement_pct(60.0, 65.0, Direction::Higher) - 8.333).abs() < 0.001);
        assert_eq!(improvement_pct(1500.0, 1440.0, Direction::Lower), 4.0);
        assert_eq!(improvement_pct(0.0, 10.0, Direction::Higher), 0.0);
        assert_eq!(progress_ratio(-2.0, 3.0), 0.0);
        assert_eq!(progress_ratio(6.0, 3.0), 2.0);
        assert_eq!(progress_ratio(6.0, 0.0), 0.0);
        assert!(is_better(285.0, 300.0, Direction::Lower));
        assert!(!is_better(300.0, 300.0, Direction::Higher));
        assert_eq!(Direction::parse("LOWER_IS_BETTER"), Some(Direction::Lower));
    }

    #[test]
    fn experience_level() {
        let r = seeded();
        let derive = |code, metric, best, bw| derive_experience_level(code, metric, best, bw, &r);
        assert_eq!(
            derive("BACK_SQUAT", "E1RM", 150.0, Some(70.0)),
            Some(Advanced)
        );
        assert_eq!(
            derive("BACK_SQUAT", "E1RM", 150.0, None),
            Some(Intermediate)
        );
        assert_eq!(derive("TIME_5K", "TIME_5K", 1200.0, None), Some(Advanced));
        assert_eq!(derive("BICEPS_CURL", "E1RM", 40.0, None), None);

        let expected = |l| {
            Some(match l {
                Beginner => 8.0,
                Intermediate => 3.0,
                Advanced => 1.0,
            })
        };
        assert_eq!(
            harder_level(&[Some(Advanced), Some(Beginner)], expected),
            Beginner
        );
        assert_eq!(
            harder_level(&[Some(Advanced), Some(Intermediate)], expected),
            Intermediate
        );
        assert_eq!(harder_level(&[None, None], expected), Beginner);
    }

    fn set(reps: Option<i32>, weight_kg: Option<f64>, duration_s: Option<i32>) -> SetInput {
        SetInput {
            reps,
            weight_kg,
            distance_m: None,
            duration_s,
            is_warmup: false,
        }
    }

    fn exercise(id: Uuid, code: &str, sets: Vec<SetInput>) -> ExerciseInput {
        ExerciseInput {
            exercise_id: id,
            code: code.to_owned(),
            is_bodyweight: false,
            sets,
        }
    }

    fn workout(duration_s: i32, exercises: Vec<ExerciseInput>) -> WorkoutInput {
        WorkoutInput {
            sport_id: Uuid::nil(),
            performed_at: Utc::now(),
            duration_s,
            exercises,
        }
    }

    fn get(obs: &[Observation], metric: &str, qualifier: f64) -> Option<f64> {
        obs.iter()
            .find(|o| o.metric == metric && o.qualifier == qualifier)
            .map(|o| o.value)
    }

    fn lower(code: &str) -> bool {
        code == "PACE" || code == "FINISH_TIME" || code.starts_with("TIME_")
    }

    #[test]
    fn observations_keep_the_best_working_value() {
        let (squat, pull) = (Uuid::now_v7(), Uuid::now_v7());
        let tracked = HashMap::from([
            (
                squat,
                vec!["MAX_WEIGHT".into(), "E1RM".into(), "REPS_AT_WEIGHT".into()],
            ),
            (pull, vec!["MAX_REPS".into()]),
        ]);
        let mut sets = vec![SetInput {
            is_warmup: true,
            ..set(Some(1), Some(150.0), None)
        }];
        sets.push(set(Some(5), Some(100.0), None));
        sets.push(set(Some(3), Some(110.0), None));
        let w = workout(
            3600,
            vec![
                exercise(squat, "BACK_SQUAT", sets),
                exercise(
                    pull,
                    "PULL_UP",
                    vec![set(Some(8), None, None), set(Some(10), None, None)],
                ),
            ],
        );
        let obs = observations(&w, &tracked, &seeded(), lower);
        assert_eq!(get(&obs, "MAX_WEIGHT", 0.0), Some(110.0));
        assert_eq!(get(&obs, "E1RM", 0.0), Some(121.0));
        assert_eq!(get(&obs, "REPS_AT_WEIGHT", 100.0), Some(5.0));
        assert_eq!(get(&obs, "MAX_REPS", 0.0), Some(10.0));
    }

    #[test]
    fn observations_keep_the_lowest_finish_time() {
        let fran = Uuid::now_v7();
        let tracked = HashMap::from([(fran, vec!["FINISH_TIME".to_owned()])]);
        let timed = workout(
            900,
            vec![exercise(
                fran,
                "WOD_FRAN",
                vec![set(None, None, Some(312)), set(None, None, Some(298))],
            )],
        );
        let obs = observations(&timed, &tracked, &seeded(), lower);
        assert_eq!(obs.len(), 1);
        assert_eq!(get(&obs, "FINISH_TIME", 0.0), Some(298.0));

        let untimed = workout(
            900,
            vec![exercise(fran, "WOD_FRAN", vec![set(Some(45), None, None)])],
        );
        assert!(observations(&untimed, &tracked, &seeded(), lower).is_empty());
    }

    #[test]
    fn observations_project_standard_distances() {
        let run = Uuid::now_v7();
        let tracked = HashMap::from([(
            run,
            [
                "DISTANCE", "PACE", "TIME_1K", "TIME_5K", "TIME_10K", "TIME_21K",
            ]
            .map(String::from)
            .to_vec(),
        )]);
        let w = workout(
            3000,
            vec![exercise(
                run,
                "RUN",
                vec![SetInput {
                    distance_m: Some(10_000),
                    ..set(None, None, Some(3000))
                }],
            )],
        );
        let obs = observations(&w, &tracked, &seeded(), lower);
        let got: Vec<Option<f64>> = ["DISTANCE", "PACE", "TIME_5K", "TIME_10K", "TIME_21K"]
            .iter()
            .map(|m| get(&obs, m, 0.0))
            .collect();
        assert_eq!(
            got,
            [
                Some(10_000.0),
                Some(300.0),
                Some(1500.0),
                Some(3000.0),
                None
            ]
        );
    }

    #[test]
    fn the_daily_streak() {
        let d = NaiveDate::from_ymd_opt(2026, 10, 12).unwrap();
        let after = |days| d + chrono::Duration::days(days);
        assert_eq!(next_daily_streak(None, 0, d, 2), Some(1));
        assert_eq!(next_daily_streak(Some(d), 1, d, 2), None);
        assert_eq!(next_daily_streak(Some(d), 1, after(1), 2), Some(2));
        // Planned rest: two days off keep the streak, and count in it.
        assert_eq!(next_daily_streak(Some(d), 2, after(3), 2), Some(5));
        assert_eq!(next_daily_streak(Some(d), 5, after(4), 2), Some(1));
        assert_eq!(next_daily_streak(Some(d), 3, after(-2), 2), None);
        assert_eq!(next_daily_streak(Some(d), 3, after(2), 0), Some(1));
    }
}
