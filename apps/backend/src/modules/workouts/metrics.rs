//! What a workout measures, in SI units: the e1RM of a set, volume, distance, and the fingerprint
//! that recognises the same sets logged twice. Pure functions, shared by intake and scoring.

use chrono::{DateTime, Utc};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{rules::E1rmFormula, validate::round_to};

pub struct SetInput {
    pub reps: Option<i32>,
    pub weight_kg: Option<f64>,
    pub distance_m: Option<i32>,
    pub duration_s: Option<i32>,
    pub is_warmup: bool,
}

pub struct ExerciseInput {
    pub exercise_id: Uuid,
    pub code: String,
    pub is_bodyweight: bool,
    pub sets: Vec<SetInput>,
}

pub struct WorkoutInput {
    pub sport_id: Uuid,
    pub performed_at: DateTime<Utc>,
    pub duration_s: i32,
    pub exercises: Vec<ExerciseInput>,
}

/// Estimated one-rep max, only for 1 to `max_reps` reps: both formulas drift on high-rep sets.
/// Epley: w × (1 + r/30). Brzycki: w × 36 / (37 − r). A single rep is the weight itself.
pub fn e1rm(weight_kg: f64, reps: i32, formula: E1rmFormula, max_reps: i32) -> Option<f64> {
    if weight_kg <= 0.0 || reps < 1 || reps > max_reps {
        return None;
    }
    if reps == 1 {
        return Some(round_to(weight_kg, 2));
    }
    let r = f64::from(reps);
    let estimate = match formula {
        E1rmFormula::Epley => weight_kg * (1.0 + r / 30.0),
        E1rmFormula::Brzycki => weight_kg * 36.0 / (37.0 - r),
    };
    Some(round_to(estimate, 2))
}

/// Reps times weight over the working sets.
pub fn total_volume_kg(w: &WorkoutInput) -> f64 {
    let volume: f64 = w
        .exercises
        .iter()
        .flat_map(|e| &e.sets)
        .filter(|s| !s.is_warmup)
        .map(|s| f64::from(s.reps.unwrap_or(0)) * s.weight_kg.unwrap_or(0.0))
        .sum();
    round_to(volume, 2)
}

pub fn total_distance_m(w: &WorkoutInput) -> i64 {
    w.exercises
        .iter()
        .flat_map(|e| &e.sets)
        .map(|s| i64::from(s.distance_m.unwrap_or(0)))
        .sum()
}

/// The sport and the sets, time left out: the same sets logged twice give the same fingerprint.
pub fn fingerprint(w: &WorkoutInput) -> [u8; 32] {
    let exercises: Vec<_> = w
        .exercises
        .iter()
        .map(|e| {
            let sets: Vec<_> = e
                .sets
                .iter()
                .map(|s| json!([s.reps, s.weight_kg, s.distance_m, s.duration_s, s.is_warmup]))
                .collect();
            json!([e.exercise_id, sets])
        })
        .collect();
    Sha256::digest(json!([w.sport_id, exercises]).to_string()).into()
}

#[cfg(test)]
pub mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    pub fn set(reps: Option<i32>, weight_kg: Option<f64>) -> SetInput {
        SetInput {
            reps,
            weight_kg,
            distance_m: None,
            duration_s: None,
            is_warmup: false,
        }
    }

    pub fn workout(code: &str, sets: Vec<SetInput>) -> WorkoutInput {
        WorkoutInput {
            sport_id: Uuid::nil(),
            performed_at: Utc::now(),
            duration_s: 3600,
            exercises: vec![ExerciseInput {
                exercise_id: Uuid::nil(),
                code: code.to_owned(),
                is_bodyweight: false,
                sets,
            }],
        }
    }

    #[test]
    fn epley_and_brzycki() {
        assert_eq!(e1rm(100.0, 5, E1rmFormula::Epley, 12), Some(116.67));
        assert_eq!(e1rm(100.0, 5, E1rmFormula::Brzycki, 12), Some(112.5));
        assert_eq!(e1rm(100.0, 1, E1rmFormula::Epley, 12), Some(100.0));
        assert_eq!(e1rm(100.0, 13, E1rmFormula::Epley, 12), None);
        assert_eq!(e1rm(0.0, 5, E1rmFormula::Epley, 12), None);
        assert_eq!(e1rm(100.0, 0, E1rmFormula::Epley, 12), None);
    }

    #[test]
    fn volume_skips_warmups() {
        let mut sets = vec![SetInput {
            is_warmup: true,
            ..set(Some(10), Some(60.0))
        }];
        sets.extend((0..3).map(|_| set(Some(5), Some(100.0))));
        sets.push(SetInput {
            distance_m: Some(400),
            ..set(None, None)
        });
        let w = workout("BACK_SQUAT", sets);
        assert_eq!(total_volume_kg(&w), 1500.0);
        assert_eq!(total_distance_m(&w), 400);
    }

    #[test]
    fn fingerprint_ignores_time_and_follows_the_sets() {
        let a = workout("BACK_SQUAT", vec![set(Some(5), Some(100.0))]);
        let mut b = workout("BACK_SQUAT", vec![set(Some(5), Some(100.0))]);
        b.performed_at = a.performed_at - chrono::Duration::days(3);
        b.duration_s = 1200;
        assert_eq!(fingerprint(&a), fingerprint(&b));
        let c = workout("BACK_SQUAT", vec![set(Some(5), Some(102.5))]);
        assert_ne!(fingerprint(&a), fingerprint(&c));
    }

    #[test]
    fn rounding_removes_float_noise() {
        let noisy = 82.35 + 1e-14;
        assert_ne!(noisy, 82.35);
        assert_eq!(round_to(noisy, 2), 82.35);
        assert_eq!(round_to(0.1 + 0.2, 1), 0.3);
        assert_eq!(round_to(18.44, 1), 18.4);
    }
}
