//! Anti-cheat layer 1 (docs/ARCHITECTURE.md §7): fixed rules on one workout and a little history.
//! HARD (physically impossible, or a duplicate) rejects the workout; SOFT (possible but exceptional)
//! holds it for a moderator; INFO is recorded and never blocks (a late log). Rule names and values
//! are the old API's (`apps/api/src/modules/anticheat/rules.ts`).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::metrics::{ExerciseInput, WorkoutInput, e1rm};
use crate::{
    rules::{Anticheat, Limits, Rules},
    validate::round_to,
};

/// Back-to-back sessions may touch; only overlaps longer than this count.
pub const OVERLAP_TOLERANCE_S: i64 = 5 * 60;

/// The race distances a run is also timed on, with the rule each one feeds.
const RACE_TIMES: [(&str, i32, &str); 3] = [
    ("TIME_5K", 5_000, "RUN_TIME_5K"),
    ("TIME_10K", 10_000, "RUN_TIME_10K"),
    ("TIME_21K", 21_097, "RUN_TIME_21K"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Severity {
    Info,
    Soft,
    Hard,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleHit {
    pub rule: &'static str,
    pub severity: Severity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub threshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exercise_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub set_index: Option<usize>,
}

impl RuleHit {
    fn new(rule: &'static str, severity: Severity, value: f64, threshold: Option<f64>) -> Self {
        Self {
            rule,
            severity,
            value: Some(value),
            threshold,
            exercise_index: None,
            set_index: None,
        }
    }

    fn at(mut self, exercise: usize, set: Option<usize>) -> Self {
        self.exercise_index = Some(exercise);
        self.set_index = set;
        self
    }
}

/// Per-exercise bounds from the catalog: loads (kg), finish times (s), AMRAP totals (reps).
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct Plausibility {
    pub hold_kg: Option<f64>,
    pub reject_kg: Option<f64>,
    pub hold_s: Option<f64>,
    pub reject_s: Option<f64>,
    pub hold_reps: Option<f64>,
    pub reject_reps: Option<f64>,
}

/// What the rules need to know beyond the workout itself.
pub struct Context {
    pub now: DateTime<Utc>,
    pub device_submitted_at: Option<DateTime<Utc>>,
    /// The latest weight, only while the athlete shares it.
    pub body_weight_kg: Option<f64>,
    /// The athlete's other workouts on the same business day, rejected ones left out.
    pub workouts_same_day: i64,
    /// The fingerprints of the other workouts whose time overlaps this one.
    pub overlapping: Vec<[u8; 32]>,
    /// Workouts with this fingerprint in the look-back window, this one excluded.
    pub identical_recent: i64,
    pub fingerprint: [u8; 32],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Accepted,
    HeldForReview,
    Rejected,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Accepted => "ACCEPTED",
            Outcome::HeldForReview => "HELD_FOR_REVIEW",
            Outcome::Rejected => "REJECTED",
        }
    }
}

pub struct Evaluation {
    pub outcome: Outcome,
    pub hits: Vec<RuleHit>,
    pub confidence: f64,
    /// False when logged too late to earn points: history and progress only.
    pub counts_for_competition: bool,
}

/// Higher is suspicious (loads, distances, speeds).
fn above(rule: &'static str, value: f64, limits: &Limits) -> Option<RuleHit> {
    if value > limits.reject {
        Some(RuleHit::new(
            rule,
            Severity::Hard,
            value,
            Some(limits.reject),
        ))
    } else if value > limits.hold {
        Some(RuleHit::new(rule, Severity::Soft, value, Some(limits.hold)))
    } else {
        None
    }
}

/// Lower is suspicious (paces, race times).
fn below(rule: &'static str, value: f64, limits: &Limits) -> Option<RuleHit> {
    if value < limits.reject {
        Some(RuleHit::new(
            rule,
            Severity::Hard,
            value,
            Some(limits.reject),
        ))
    } else if value < limits.hold {
        Some(RuleHit::new(rule, Severity::Soft, value, Some(limits.hold)))
    } else {
        None
    }
}

fn millis(delta: chrono::TimeDelta) -> f64 {
    delta.num_milliseconds() as f64
}

pub fn evaluate(
    w: &WorkoutInput,
    ctx: &Context,
    rules: &Rules,
    plausibility: &dyn Fn(&str) -> Plausibility,
) -> Evaluation {
    let r = &rules.anticheat;
    let mut hits: Vec<RuleHit> = Vec::new();

    // Time
    let ahead_min = millis(w.performed_at - ctx.now) / 60_000.0;
    if ahead_min > r.future_skew_max_min {
        hits.push(RuleHit::new(
            "PERFORMED_IN_FUTURE",
            Severity::Hard,
            ahead_min.round(),
            Some(r.future_skew_max_min),
        ));
    }
    if let Some(device) = ctx.device_submitted_at {
        let skew_h = millis(device - ctx.now).abs() / 3_600_000.0;
        if skew_h > r.clock_skew_hold_hours {
            hits.push(RuleHit::new(
                "CLOCK_SKEW",
                Severity::Soft,
                skew_h.round(),
                Some(r.clock_skew_hold_hours),
            ));
        }
    }
    let late_h = millis(ctx.now - w.performed_at) / 3_600_000.0;
    let late = late_h > rules.late_log_max_hours;
    if late {
        hits.push(RuleHit::new(
            "LATE_LOG",
            Severity::Info,
            late_h.round(),
            Some(rules.late_log_max_hours),
        ));
    }

    // The workout's shape
    hits.extend(above(
        "WORKOUT_DURATION",
        f64::from(w.duration_s) / 3600.0,
        &r.workout_duration_h,
    ));
    let set_count: usize = w.exercises.iter().map(|e| e.sets.len()).sum();
    hits.extend(above(
        "SETS_PER_WORKOUT",
        set_count as f64,
        &r.sets_per_workout,
    ));

    for (index, ex) in w.exercises.iter().enumerate() {
        let p = plausibility(&ex.code);
        for (set_index, s) in ex.sets.iter().enumerate() {
            // AMRAP totals (e.g. Cindy) are judged by their own bounds, not the per-set rep limit.
            if let (Some(reps), None) = (s.reps, p.hold_reps) {
                let limits = if ex.is_bodyweight || s.weight_kg.is_none_or(|kg| kg <= 0.0) {
                    &r.reps_bodyweight
                } else {
                    &r.reps_weighted
                };
                hits.extend(
                    above("REPS_PER_SET", f64::from(reps), limits)
                        .map(|h| h.at(index, Some(set_index))),
                );
            }
        }
        hits.extend(strength_hits(ex, index, ctx.body_weight_kg, rules, &p));
        hits.extend(cardio_hits(ex, index, w, r));
        hits.extend(timed_hits(ex, index, &p));
    }

    // History
    if !ctx.overlapping.is_empty() {
        let rule = if ctx.overlapping.contains(&ctx.fingerprint) {
            "DUPLICATE_WORKOUT"
        } else {
            "OVERLAPPING_WORKOUT"
        };
        hits.push(RuleHit::new(
            rule,
            Severity::Hard,
            ctx.overlapping.len() as f64,
            None,
        ));
    }
    if ctx.workouts_same_day >= r.workouts_per_day_hold {
        hits.push(RuleHit::new(
            "WORKOUTS_PER_DAY",
            Severity::Soft,
            (ctx.workouts_same_day + 1) as f64,
            Some(r.workouts_per_day_hold as f64),
        ));
    }
    if ctx.identical_recent + 1 >= r.identical_fingerprint_hold.count {
        hits.push(RuleHit::new(
            "REPEATED_IDENTICAL_WORKOUT",
            Severity::Soft,
            (ctx.identical_recent + 1) as f64,
            Some(r.identical_fingerprint_hold.count as f64),
        ));
    }

    let outcome = if hits.iter().any(|h| h.severity == Severity::Hard) {
        Outcome::Rejected
    } else if hits.iter().any(|h| h.severity == Severity::Soft) {
        Outcome::HeldForReview
    } else {
        Outcome::Accepted
    };
    Evaluation {
        outcome,
        hits,
        confidence: match outcome {
            Outcome::Rejected => 0.99,
            Outcome::HeldForReview => 0.6,
            Outcome::Accepted => 0.0,
        },
        counts_for_competition: !late,
    }
}

/// The heaviest load moved and, for the lifts the rule set names, the best e1RM against absolute and
/// body-weight limits. Other weighted exercises use their catalog bounds.
fn strength_hits(
    ex: &ExerciseInput,
    index: usize,
    body_weight_kg: Option<f64>,
    rules: &Rules,
    p: &Plausibility,
) -> Vec<RuleHit> {
    let loads: Vec<(f64, i32)> = ex
        .sets
        .iter()
        .filter(|s| !s.is_warmup)
        .filter_map(|s| {
            s.weight_kg
                .filter(|kg| *kg > 0.0)
                .map(|kg| (kg, s.reps.unwrap_or(0)))
        })
        .collect();
    let Some(max_load) = loads.iter().map(|(kg, _)| *kg).reduce(f64::max) else {
        return Vec::new();
    };
    if let Some(lift) = rules.anticheat.lifts.get(&ex.code) {
        let best_e1rm = loads
            .iter()
            .filter_map(|(kg, reps)| e1rm(*kg, *reps, rules.e1rm_formula, rules.e1rm_max_reps))
            .fold(max_load, f64::max);
        let mut out: Vec<RuleHit> = above("LIFT_ABSOLUTE_KG", best_e1rm, &lift.absolute_kg)
            .into_iter()
            .collect();
        if let Some(bw) = body_weight_kg.filter(|bw| *bw > 0.0) {
            out.extend(above(
                "LIFT_BODYWEIGHT_RATIO",
                round_to(best_e1rm / bw, 2),
                &lift.bw_ratio,
            ));
        }
        return out.into_iter().map(|h| h.at(index, None)).collect();
    }
    match (p.hold_kg, p.reject_kg) {
        (Some(hold), Some(reject)) => above("LOAD_KG", max_load, &Limits { hold, reject })
            .map(|h| h.at(index, None))
            .into_iter()
            .collect(),
        _ => Vec::new(),
    }
}

/// Finish times (lower is suspicious) and AMRAP totals (higher is suspicious) against the
/// exercise's own bounds.
fn timed_hits(ex: &ExerciseInput, index: usize, p: &Plausibility) -> Vec<RuleHit> {
    let mut out = Vec::new();
    for (set_index, s) in ex.sets.iter().enumerate() {
        if let (Some(hold), Some(reject), Some(seconds)) =
            (p.hold_s, p.reject_s, s.duration_s.filter(|d| *d > 0))
        {
            out.extend(
                below(
                    "FINISH_TIME_S",
                    f64::from(seconds),
                    &Limits { hold, reject },
                )
                .map(|h| h.at(index, Some(set_index))),
            );
        }
        if let (Some(hold), Some(reject), Some(reps)) = (p.hold_reps, p.reject_reps, s.reps) {
            out.extend(
                above("WOD_TOTAL_REPS", f64::from(reps), &Limits { hold, reject })
                    .map(|h| h.at(index, Some(set_index))),
            );
        }
    }
    out
}

fn cardio_hits(ex: &ExerciseInput, index: usize, w: &WorkoutInput, r: &Anticheat) -> Vec<RuleHit> {
    let mut out = Vec::new();
    let single = w.exercises.len() == 1 && ex.sets.len() == 1;
    let mut distance: i64 = 0;

    for (set_index, s) in ex.sets.iter().enumerate() {
        let Some(meters) = s.distance_m.filter(|m| *m > 0) else {
            continue;
        };
        distance += i64::from(meters);
        // A lone cardio set without its own duration takes the workout's.
        let seconds = match s.duration_s {
            Some(d) => d,
            None if single => w.duration_s,
            None => continue,
        };
        if seconds <= 0 {
            continue;
        }
        let (m, secs) = (f64::from(meters), f64::from(seconds));
        let km = m / 1000.0;
        let kmh = km / (secs / 3600.0);
        let at = move |h: RuleHit| h.at(index, Some(set_index));

        match ex.code.as_str() {
            "RUN" => {
                if meters >= 1000 {
                    out.extend(
                        below("RUN_PACE", (secs / km).round(), &r.run_pace_s_per_km).map(at),
                    );
                }
                for (metric, race, rule) in RACE_TIMES {
                    if let (true, Some(limits)) = (meters >= race, r.run_time_s.get(metric)) {
                        let time = (secs / m * f64::from(race)).round();
                        out.extend(below(rule, time, limits).map(at));
                    }
                }
            }
            "RIDE" => out.extend(above("RIDE_SPEED", round_to(kmh, 1), &r.ride_speed_kmh).map(at)),
            "WALK" => out.extend(above("WALK_SPEED", round_to(kmh, 1), &r.walk_speed_kmh).map(at)),
            "SWIM_FREESTYLE" if meters >= 200 => out.extend(
                below(
                    "SWIM_PACE",
                    (secs / (m / 100.0)).round(),
                    &r.swim_pace_s_per_100m,
                )
                .map(at),
            ),
            _ => {}
        }
    }

    let whole = |h: RuleHit| h.at(index, None);
    match ex.code.as_str() {
        "RUN" => out.extend(above("RUN_DISTANCE", distance as f64, &r.run_distance_m).map(whole)),
        "RIDE" => {
            out.extend(above("RIDE_DISTANCE", distance as f64, &r.ride_distance_m).map(whole))
        }
        _ => {}
    }
    out
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use chrono::Duration;

    use super::*;
    use crate::{
        modules::workouts::metrics::{
            SetInput,
            tests::{set, workout},
        },
        rules::tests::seeded,
    };

    fn ctx() -> Context {
        Context {
            now: Utc::now(),
            device_submitted_at: None,
            body_weight_kg: None,
            workouts_same_day: 0,
            overlapping: Vec::new(),
            identical_recent: 0,
            fingerprint: [1; 32],
        }
    }

    fn timed(code: &str, meters: i32, seconds: i32) -> WorkoutInput {
        workout(
            code,
            vec![SetInput {
                distance_m: Some(meters),
                duration_s: Some(seconds),
                ..set(None, None)
            }],
        )
    }

    fn lift(code: &str, kg: f64, reps: i32) -> WorkoutInput {
        workout(code, vec![set(Some(reps), Some(kg))])
    }

    fn catalog(code: &str) -> Plausibility {
        match code {
            "LEG_PRESS" => Plausibility {
                hold_kg: Some(400.0),
                reject_kg: Some(600.0),
                ..Plausibility::default()
            },
            "FRAN" => Plausibility {
                hold_s: Some(120.0),
                reject_s: Some(60.0),
                hold_reps: Some(300.0),
                reject_reps: Some(500.0),
                ..Plausibility::default()
            },
            _ => Plausibility::default(),
        }
    }

    /// The severity of `rule` in the evaluation, if it was hit.
    fn severity(w: &WorkoutInput, ctx: &Context, rule: &str) -> Option<Severity> {
        let rules = seeded();
        evaluate(w, ctx, &rules, &catalog)
            .hits
            .iter()
            .find(|h| h.rule == rule)
            .map(|h| h.severity)
    }

    #[test]
    fn each_limit_holds_on_both_sides() {
        use Severity::{Hard, Soft};
        let base = ctx();
        let with = |change: fn(&mut Context)| {
            let mut c = ctx();
            change(&mut c);
            c
        };
        let weighed = with(|c| c.body_weight_kg = Some(70.0));
        let three_today = with(|c| c.workouts_same_day = 3);
        let four_today = with(|c| c.workouts_same_day = 4);
        let one_identical = with(|c| c.identical_recent = 1);
        let two_identical = with(|c| c.identical_recent = 2);
        let overlap = with(|c| c.overlapping = vec![[2; 32]]);
        let duplicate = with(|c| c.overlapping = vec![[1; 32]]);
        let skew_23 = with(|c| c.device_submitted_at = Some(c.now - Duration::hours(23)));
        let skew_25 = with(|c| c.device_submitted_at = Some(c.now - Duration::hours(25)));
        let bodyweight = |reps| workout("PUSH_UP", vec![set(Some(reps), None)]);
        let sets = |n: usize| workout("CURL", (0..n).map(|_| set(Some(5), Some(20.0))).collect());
        let long = |seconds| WorkoutInput {
            duration_s: seconds,
            ..lift("CURL", 20.0, 5)
        };
        let fran = |reps, seconds| {
            workout(
                "FRAN",
                vec![SetInput {
                    duration_s: Some(seconds),
                    ..set(Some(reps), None)
                }],
            )
        };
        let cases: Vec<(&str, WorkoutInput, &Context, &str, Option<Severity>)> = vec![
            (
                "pace 196 s/km",
                timed("RUN", 5_000, 980),
                &base,
                "RUN_PACE",
                None,
            ),
            (
                "pace 194 s/km",
                timed("RUN", 5_000, 970),
                &base,
                "RUN_PACE",
                Some(Soft),
            ),
            (
                "pace 149 s/km",
                timed("RUN", 5_000, 745),
                &base,
                "RUN_PACE",
                Some(Hard),
            ),
            (
                "run 60,001 m",
                timed("RUN", 60_001, 18_000),
                &base,
                "RUN_DISTANCE",
                Some(Soft),
            ),
            (
                "run 120,001 m",
                timed("RUN", 120_001, 36_000),
                &base,
                "RUN_DISTANCE",
                Some(Hard),
            ),
            (
                "run 60,000 m",
                timed("RUN", 60_000, 18_000),
                &base,
                "RUN_DISTANCE",
                None,
            ),
            (
                "5K in 901 s",
                timed("RUN", 5_000, 901),
                &base,
                "RUN_TIME_5K",
                None,
            ),
            (
                "5K in 899 s",
                timed("RUN", 5_000, 899),
                &base,
                "RUN_TIME_5K",
                Some(Soft),
            ),
            (
                "5K in 749 s",
                timed("RUN", 5_000, 749),
                &base,
                "RUN_TIME_5K",
                Some(Hard),
            ),
            (
                "10K in 1,859 s",
                timed("RUN", 10_000, 1_859),
                &base,
                "RUN_TIME_10K",
                Some(Soft),
            ),
            (
                "21.1K in 3,419 s",
                timed("RUN", 21_097, 3_419),
                &base,
                "RUN_TIME_21K",
                Some(Hard),
            ),
            (
                "ride 44 km/h",
                timed("RIDE", 44_000, 3_600),
                &base,
                "RIDE_SPEED",
                None,
            ),
            (
                "ride 46 km/h",
                timed("RIDE", 46_000, 3_600),
                &base,
                "RIDE_SPEED",
                Some(Soft),
            ),
            (
                "ride 61 km/h",
                timed("RIDE", 61_000, 3_600),
                &base,
                "RIDE_SPEED",
                Some(Hard),
            ),
            (
                "ride 250,001 m",
                timed("RIDE", 250_001, 36_000),
                &base,
                "RIDE_DISTANCE",
                Some(Soft),
            ),
            (
                "ride 400,001 m",
                timed("RIDE", 400_001, 72_000),
                &base,
                "RIDE_DISTANCE",
                Some(Hard),
            ),
            (
                "walk 9.5 km/h",
                timed("WALK", 9_500, 3_600),
                &base,
                "WALK_SPEED",
                Some(Soft),
            ),
            (
                "walk 16 km/h",
                timed("WALK", 16_000, 3_600),
                &base,
                "WALK_SPEED",
                Some(Hard),
            ),
            (
                "swim 200 m in 1:58",
                timed("SWIM_FREESTYLE", 200, 118),
                &base,
                "SWIM_PACE",
                Some(Soft),
            ),
            (
                "swim 200 m in 1:28",
                timed("SWIM_FREESTYLE", 200, 88),
                &base,
                "SWIM_PACE",
                Some(Hard),
            ),
            (
                "swim 150 m",
                timed("SWIM_FREESTYLE", 150, 60),
                &base,
                "SWIM_PACE",
                None,
            ),
            (
                "squat 299 kg",
                lift("BACK_SQUAT", 299.0, 1),
                &base,
                "LIFT_ABSOLUTE_KG",
                None,
            ),
            (
                "squat 301 kg",
                lift("BACK_SQUAT", 301.0, 1),
                &base,
                "LIFT_ABSOLUTE_KG",
                Some(Soft),
            ),
            (
                "squat 501 kg",
                lift("BACK_SQUAT", 501.0, 1),
                &base,
                "LIFT_ABSOLUTE_KG",
                Some(Hard),
            ),
            (
                "squat 3.1 × 70 kg",
                lift("BACK_SQUAT", 217.0, 1),
                &weighed,
                "LIFT_BODYWEIGHT_RATIO",
                Some(Soft),
            ),
            (
                "squat 4.6 × 70 kg",
                lift("BACK_SQUAT", 322.0, 1),
                &weighed,
                "LIFT_BODYWEIGHT_RATIO",
                Some(Hard),
            ),
            (
                "squat 217 kg, no weight",
                lift("BACK_SQUAT", 217.0, 1),
                &base,
                "LIFT_BODYWEIGHT_RATIO",
                None,
            ),
            (
                "leg press 401 kg",
                lift("LEG_PRESS", 401.0, 5),
                &base,
                "LOAD_KG",
                Some(Soft),
            ),
            (
                "leg press 601 kg",
                lift("LEG_PRESS", 601.0, 5),
                &base,
                "LOAD_KG",
                Some(Hard),
            ),
            (
                "51 weighted reps",
                lift("CURL", 20.0, 51),
                &base,
                "REPS_PER_SET",
                Some(Soft),
            ),
            (
                "201 weighted reps",
                lift("CURL", 20.0, 201),
                &base,
                "REPS_PER_SET",
                Some(Hard),
            ),
            (
                "50 weighted reps",
                lift("CURL", 20.0, 50),
                &base,
                "REPS_PER_SET",
                None,
            ),
            (
                "151 push-ups",
                bodyweight(151),
                &base,
                "REPS_PER_SET",
                Some(Soft),
            ),
            (
                "1,001 push-ups",
                bodyweight(1_001),
                &base,
                "REPS_PER_SET",
                Some(Hard),
            ),
            ("5.1 h", long(18_360), &base, "WORKOUT_DURATION", Some(Soft)),
            (
                "12.1 h",
                long(43_560),
                &base,
                "WORKOUT_DURATION",
                Some(Hard),
            ),
            ("60 sets", sets(60), &base, "SETS_PER_WORKOUT", None),
            ("61 sets", sets(61), &base, "SETS_PER_WORKOUT", Some(Soft)),
            ("151 sets", sets(151), &base, "SETS_PER_WORKOUT", Some(Hard)),
            (
                "3 others today",
                lift("CURL", 20.0, 5),
                &three_today,
                "WORKOUTS_PER_DAY",
                None,
            ),
            (
                "4 others today",
                lift("CURL", 20.0, 5),
                &four_today,
                "WORKOUTS_PER_DAY",
                Some(Soft),
            ),
            (
                "1 identical",
                lift("CURL", 20.0, 5),
                &one_identical,
                "REPEATED_IDENTICAL_WORKOUT",
                None,
            ),
            (
                "2 identical",
                lift("CURL", 20.0, 5),
                &two_identical,
                "REPEATED_IDENTICAL_WORKOUT",
                Some(Soft),
            ),
            (
                "overlap",
                lift("CURL", 20.0, 5),
                &overlap,
                "OVERLAPPING_WORKOUT",
                Some(Hard),
            ),
            (
                "duplicate",
                lift("CURL", 20.0, 5),
                &duplicate,
                "DUPLICATE_WORKOUT",
                Some(Hard),
            ),
            (
                "clock 23 h off",
                lift("CURL", 20.0, 5),
                &skew_23,
                "CLOCK_SKEW",
                None,
            ),
            (
                "clock 25 h off",
                lift("CURL", 20.0, 5),
                &skew_25,
                "CLOCK_SKEW",
                Some(Soft),
            ),
            (
                "Fran in 119 s",
                fran(100, 119),
                &base,
                "FINISH_TIME_S",
                Some(Soft),
            ),
            (
                "Fran in 59 s",
                fran(100, 59),
                &base,
                "FINISH_TIME_S",
                Some(Hard),
            ),
            (
                "Fran 301 reps",
                fran(301, 300),
                &base,
                "WOD_TOTAL_REPS",
                Some(Soft),
            ),
            (
                "Fran 501 reps",
                fran(501, 300),
                &base,
                "WOD_TOTAL_REPS",
                Some(Hard),
            ),
            (
                "Fran 501 reps, not per set",
                fran(501, 300),
                &base,
                "REPS_PER_SET",
                None,
            ),
        ];
        for (name, w, c, rule, expected) in cases {
            assert_eq!(severity(&w, c, rule), expected, "{name}: {rule}");
        }
    }

    #[test]
    fn the_time_rules() {
        let now = Utc::now();
        let at = |offset: Duration| WorkoutInput {
            performed_at: now + offset,
            ..lift("CURL", 20.0, 5)
        };
        let c = Context { now, ..ctx() };
        assert_eq!(
            severity(&at(Duration::minutes(9)), &c, "PERFORMED_IN_FUTURE"),
            None
        );
        assert_eq!(
            severity(&at(Duration::minutes(11)), &c, "PERFORMED_IN_FUTURE"),
            Some(Severity::Hard)
        );
        let late = evaluate(&at(-Duration::hours(73)), &c, &seeded(), &catalog);
        assert_eq!(late.hits.len(), 1);
        assert_eq!(late.hits[0].rule, "LATE_LOG");
        assert_eq!(late.hits[0].severity, Severity::Info);
        assert_eq!(late.outcome, Outcome::Accepted);
        assert!(!late.counts_for_competition);
        assert!(
            evaluate(&at(-Duration::hours(71)), &c, &seeded(), &catalog).counts_for_competition
        );
    }

    #[test]
    fn a_lone_cardio_set_takes_the_workout_duration() {
        let alone = |sets: Vec<SetInput>| WorkoutInput {
            duration_s: 745,
            ..workout("RUN", sets)
        };
        let run = || SetInput {
            distance_m: Some(5_000),
            ..set(None, None)
        };
        assert_eq!(
            severity(&alone(vec![run()]), &ctx(), "RUN_PACE"),
            Some(Severity::Hard)
        );
        // With a second set, neither has a duration to be judged by.
        assert_eq!(
            severity(&alone(vec![run(), run()]), &ctx(), "RUN_PACE"),
            None
        );
    }

    #[test]
    fn the_outcome_follows_the_worst_hit() {
        let rules = seeded();
        let judge = |w: &WorkoutInput| evaluate(w, &ctx(), &rules, &catalog);

        let clean = judge(&lift("BACK_SQUAT", 100.0, 5));
        assert_eq!(clean.outcome, Outcome::Accepted);
        assert!(clean.hits.is_empty() && clean.confidence == 0.0 && clean.counts_for_competition);

        let held = judge(&lift("BACK_SQUAT", 320.0, 1));
        assert_eq!(
            (held.outcome, held.confidence),
            (Outcome::HeldForReview, 0.6)
        );

        // A hard hit wins over a soft one in the same workout.
        let mut both = lift("BACK_SQUAT", 320.0, 1);
        both.exercises.extend(timed("RUN", 5_000, 700).exercises);
        let rejected = judge(&both);
        assert_eq!(
            (rejected.outcome, rejected.confidence),
            (Outcome::Rejected, 0.99)
        );
        assert_eq!(rejected.hits[0].exercise_index, Some(0));
    }

    #[test]
    fn a_hit_serialises_as_the_app_reads_it() {
        let hit = RuleHit::new("RUN_PACE", Severity::Hard, 120.0, Some(150.0)).at(0, Some(2));
        assert_eq!(
            serde_json::to_value(&hit).unwrap(),
            serde_json::json!({"rule": "RUN_PACE", "severity": "HARD", "value": 120.0,
                               "threshold": 150.0, "exerciseIndex": 0, "setIndex": 2})
        );
        let bare = RuleHit::new("OVERLAPPING_WORKOUT", Severity::Hard, 1.0, None);
        assert!(
            serde_json::to_value(&bare)
                .unwrap()
                .get("threshold")
                .is_none()
        );
    }
}
