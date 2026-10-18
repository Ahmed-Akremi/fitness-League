//! Saving a workout: idempotency, the catalog, the anti-cheat context and one transaction for its
//! rows. Loading: one statement for a page of workouts with their sets and verdict.

use std::collections::HashMap;

use chrono::{DateTime, Duration, NaiveDateTime, SubsecRound, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::MySqlPool;
use uuid::Uuid;

use super::{
    anticheat::{self, Context, Plausibility},
    metrics::{self, ExerciseInput, SetInput, WorkoutInput},
};
use crate::{
    db,
    error::AppError,
    modules::me::body,
    rules::Rules,
    security::policy,
    state::AppState,
    types::{Visibility, iso},
    validate::{Check, Validate, rfc3339, round_to},
};

/// A workout as the app sends it. The client never sends points: unknown fields are refused.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkoutBody {
    pub client_id: Uuid,
    /// The device's clock when it sent the workout: compared with the server's, never hashed.
    #[serde(skip_serializing)]
    pub device_submitted_at: Option<String>,
    pub sport_id: Uuid,
    pub workout_type: String,
    pub performed_at: String,
    pub duration_s: i32,
    pub notes: Option<String>,
    pub visibility: Option<Visibility>,
    pub exercises: Vec<ExerciseBody>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExerciseBody {
    pub exercise_id: Uuid,
    pub notes: Option<String>,
    pub sets: Vec<SetBody>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetBody {
    pub reps: Option<i32>,
    pub weight_kg: Option<f64>,
    pub distance_m: Option<i32>,
    pub duration_s: Option<i32>,
    pub is_warmup: Option<bool>,
    pub rpe: Option<f64>,
}

fn size(check: &mut Check, field: &str, n: usize, max: usize) {
    if n == 0 {
        check.fail(field, "ARRAYMINSIZE");
    } else if n > max {
        check.fail(field, "ARRAYMAXSIZE");
    }
}

/// `^[A-Z][A-Z0-9_]{1,39}$`, e.g. `STRENGTH`, `EASY_RUN`.
fn workout_type_ok(kind: &str) -> bool {
    match kind.as_bytes().split_first() {
        Some((first, rest)) => {
            first.is_ascii_uppercase()
                && (1..=39).contains(&rest.len())
                && rest
                    .iter()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || *b == b'_')
        }
        None => false,
    }
}

impl Validate for WorkoutBody {
    fn validate(&self, check: &mut Check) {
        check.ensure(
            "workoutType",
            workout_type_ok(&self.workout_type),
            "MATCHES",
        );
        check.ensure(
            "performedAt",
            rfc3339(&self.performed_at).is_some(),
            "ISISO8601",
        );
        if let Some(at) = &self.device_submitted_at {
            check.ensure("deviceSubmittedAt", rfc3339(at).is_some(), "ISISO8601");
        }
        check.range("durationS", i64::from(self.duration_s), 60, 86_400);
        if let Some(notes) = &self.notes {
            check.length("notes", notes, 0, 2000);
        }
        size(check, "exercises", self.exercises.len(), 60);
        for (i, exercise) in self.exercises.iter().enumerate() {
            let at = format!("exercises[{i}]");
            if let Some(notes) = &exercise.notes {
                check.length(&format!("{at}.notes"), notes, 0, 500);
            }
            size(check, &format!("{at}.sets"), exercise.sets.len(), 100);
            for (j, set) in exercise.sets.iter().enumerate() {
                let field = |name: &str| format!("{at}.sets[{j}].{name}");
                if let Some(reps) = set.reps {
                    check.range(&field("reps"), i64::from(reps), 0, 1000);
                }
                if let Some(kg) = set.weight_kg {
                    check.within(&field("weightKg"), kg, 0.0, 1000.0);
                }
                if let Some(m) = set.distance_m {
                    check.range(&field("distanceM"), i64::from(m), 0, 1_000_000);
                }
                if let Some(s) = set.duration_s {
                    check.range(&field("durationS"), i64::from(s), 0, 86_400);
                }
                if let Some(rpe) = set.rpe {
                    check.within(&field("rpe"), rpe, 1.0, 10.0);
                }
            }
        }
    }
}

impl WorkoutBody {
    /// Weights keep 2 decimals and efforts 1: the values stored, checked and hashed.
    fn rounded(mut self) -> Self {
        for set in self.exercises.iter_mut().flat_map(|e| e.sets.iter_mut()) {
            set.weight_kg = set.weight_kg.map(|kg| round_to(kg, 2));
            set.rpe = set.rpe.map(|rpe| round_to(rpe, 1));
        }
        self
    }
}

pub enum Created {
    New(Value),
    Replayed(Value),
}

/// Saves a workout once. Sending it again replays the stored answer; other data under the same
/// client id is a conflict.
pub async fn create(state: &AppState, user: Uuid, body: WorkoutBody) -> Result<Created, AppError> {
    let body = body.rounded();
    let hash: [u8; 32] =
        Sha256::digest(serde_json::to_vec(&body).map_err(AppError::internal)?).into();
    if let Some(found) = find(&state.db, user, body.client_id).await? {
        return replay(&state.db, user, found, &hash).await;
    }

    let rules = Rules::active(&state.db).await?;
    let resolved = resolve(&state.db, &body).await?;
    let workout = &resolved.workout;
    let fingerprint = metrics::fingerprint(workout);
    let now = Utc::now();
    let device = body.device_submitted_at.as_deref().and_then(rfc3339);
    let ctx = context(state, user, workout, &rules, now, device, fingerprint).await?;
    let plausibility = |code: &str| {
        resolved
            .plausibility
            .get(code)
            .cloned()
            .unwrap_or_default()
    };
    let evaluation = anticheat::evaluate(workout, &ctx, &rules, &plausibility);

    let visibility = match body.visibility {
        Some(chosen) => chosen.as_str().to_owned(),
        None => sqlx::query_scalar!(
            "SELECT default_visibility FROM user_settings WHERE user_id = ?",
            user
        )
        .fetch_optional(&state.db)
        .await?
        .unwrap_or_else(|| Visibility::Friends.as_str().to_owned()),
    };

    let id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    let inserted = sqlx::query!(
        "INSERT INTO workouts (id, user_id, client_id, payload_hash, fingerprint, sport_id, workout_type, \
           performed_at, duration_s, notes, visibility, status, received_at, device_submitted_at, \
           total_volume_kg, total_distance_m) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        user,
        body.client_id,
        &hash[..],
        &fingerprint[..],
        body.sport_id,
        body.workout_type,
        workout.performed_at.naive_utc(),
        body.duration_s,
        body.notes,
        visibility,
        evaluation.outcome.as_str(),
        now.naive_utc(),
        device.map(|at| at.naive_utc()),
        format!("{:.2}", metrics::total_volume_kg(workout)),
        metrics::total_distance_m(workout)
    )
    .execute(&mut *tx)
    .await;
    if let Err(e) = inserted {
        // The same workout sent twice at the same instant: the second one replays the first.
        if db::duplicate_key(&e) == Some("uq_workouts_user_client") {
            drop(tx);
            let found = find(&state.db, user, body.client_id)
                .await?
                .ok_or_else(|| AppError::internal("a duplicate workout vanished"))?;
            return replay(&state.db, user, found, &hash).await;
        }
        return Err(e.into());
    }

    for (position, (exercise, sent)) in workout.exercises.iter().zip(&body.exercises).enumerate() {
        let row = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO workout_exercises (id, workout_id, exercise_id, position, notes) VALUES (?, ?, ?, ?, ?)",
            row,
            id,
            exercise.exercise_id,
            position as i32,
            sent.notes
        )
        .execute(&mut *tx)
        .await?;
        for (index, (set, sent)) in exercise.sets.iter().zip(&sent.sets).enumerate() {
            let e1rm = match (set.is_warmup, set.weight_kg, set.reps) {
                (false, Some(kg), Some(reps)) => {
                    metrics::e1rm(kg, reps, rules.e1rm_formula, rules.e1rm_max_reps)
                }
                _ => None,
            };
            sqlx::query!(
                "INSERT INTO workout_sets (id, workout_exercise_id, set_index, reps, weight_kg, distance_m, \
                   duration_s, is_warmup, rpe, e1rm_kg) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                Uuid::now_v7(),
                row,
                index as i32,
                set.reps,
                set.weight_kg.map(|kg| format!("{kg:.2}")),
                set.distance_m,
                set.duration_s,
                set.is_warmup,
                sent.rpe.map(|rpe| format!("{rpe:.1}")),
                e1rm.map(|kg| format!("{kg:.2}"))
            )
            .execute(&mut *tx)
            .await?;
        }
    }
    sqlx::query!(
        "INSERT INTO workout_evaluations (workout_id, outcome, rule_hits, confidence, rule_set_version) \
         VALUES (?, ?, ?, ?, ?)",
        id,
        evaluation.outcome.as_str(),
        serde_json::to_string(&evaluation.hits).map_err(AppError::internal)?,
        format!("{:.3}", evaluation.confidence),
        rules.version
    )
    .execute(&mut *tx)
    .await?;
    // plan 2b scores an ACCEPTED workout here, in this transaction.
    tx.commit().await?;
    Ok(Created::New(one(&state.db, user, id).await?))
}

async fn find(
    db: &MySqlPool,
    user: Uuid,
    client: Uuid,
) -> Result<Option<(Uuid, Vec<u8>)>, AppError> {
    Ok(sqlx::query!(
        r#"SELECT id AS "id: Uuid", payload_hash FROM workouts WHERE user_id = ? AND client_id = ?"#,
        user,
        client
    )
    .fetch_optional(db)
    .await?
    .map(|row| (row.id, row.payload_hash)))
}

async fn replay(
    db: &MySqlPool,
    user: Uuid,
    (id, stored): (Uuid, Vec<u8>),
    hash: &[u8; 32],
) -> Result<Created, AppError> {
    let workout = one(db, user, id).await?;
    if stored == hash[..] {
        Ok(Created::Replayed(workout))
    } else {
        Err(AppError::conflict("IDEMPOTENCY_CONFLICT")
            .detail("A workout with this clientId was already synced with different data.")
            .with("workout", workout))
    }
}

/// The workout as the catalog sees it, with every catalog error reported at once.
struct Resolved {
    workout: WorkoutInput,
    plausibility: HashMap<String, Plausibility>,
}

async fn resolve(db: &MySqlPool, body: &WorkoutBody) -> Result<Resolved, AppError> {
    let category = sqlx::query_scalar!(
        "SELECT category FROM sports WHERE id = ? AND enabled",
        body.sport_id
    )
    .fetch_optional(db)
    .await?;
    // shortcut: reads the whole exercise catalog (47 rows) per workout; cache it in the process if
    // it grows to hundreds.
    let catalog: HashMap<Uuid, _> = sqlx::query!(
        r#"SELECT e.id AS "id: Uuid", e.sport_id AS "sport_id?: Uuid", e.code,
                  e.is_bodyweight AS "is_bodyweight: bool", e.enabled AS "enabled: bool", e.plausibility,
                  EXISTS (SELECT 1 FROM exercise_metrics em JOIN metric_types m ON m.id = em.metric_type_id
                          WHERE em.exercise_id = e.id AND m.code = 'DISTANCE') AS "distance!"
           FROM exercises e"#
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .map(|row| (row.id, row))
    .collect();

    let mut check = Check::default();
    if category.is_none() {
        check.fail("sportId", "UNKNOWN_SPORT");
    }
    let cardio_sport = category.as_deref() == Some("CARDIO");
    let mut exercises = Vec::with_capacity(body.exercises.len());
    let mut plausibility = HashMap::new();
    for (i, sent) in body.exercises.iter().enumerate() {
        let field = format!("exercises[{i}].exerciseId");
        let Some(known) = catalog.get(&sent.exercise_id).filter(|e| e.enabled) else {
            check.fail(&field, "UNKNOWN_EXERCISE");
            continue;
        };
        // An exercise of no sport (the squat) belongs to every strength and functional sport.
        let shared = known.sport_id.is_none() && !cardio_sport;
        if category.is_some() && known.sport_id != Some(body.sport_id) && !shared {
            check.fail(&field, "EXERCISE_NOT_IN_SPORT");
        }
        let distance = known.distance != 0;
        for (j, set) in sent.sets.iter().enumerate() {
            let at = format!("exercises[{i}].sets[{j}]");
            if distance && set.distance_m.is_none() && set.duration_s.is_none() {
                check.fail(&at, "DISTANCE_OR_DURATION_REQUIRED");
            }
            if !distance && set.reps.is_none() && set.duration_s.is_none() {
                check.fail(&at, "REPS_OR_DURATION_REQUIRED");
            }
            if !known.is_bodyweight && !distance && set.reps.is_some() && set.weight_kg.is_none() {
                check.fail(&format!("{at}.weightKg"), "REQUIRED");
            }
        }
        plausibility.insert(
            known.code.clone(),
            serde_json::from_str(&known.plausibility).unwrap_or_default(),
        );
        exercises.push(ExerciseInput {
            exercise_id: sent.exercise_id,
            code: known.code.clone(),
            is_bodyweight: known.is_bodyweight,
            sets: sent
                .sets
                .iter()
                .map(|s| SetInput {
                    reps: s.reps,
                    weight_kg: s.weight_kg,
                    distance_m: s.distance_m,
                    duration_s: s.duration_s,
                    is_warmup: s.is_warmup.unwrap_or(false),
                })
                .collect(),
        });
    }
    check.finish()?;
    // To the millisecond, as the app sends it: the list's cursor carries the time at that precision.
    let performed_at = rfc3339(&body.performed_at)
        .ok_or_else(|| AppError::field("performedAt", "ISISO8601"))?
        .trunc_subsecs(3);
    Ok(Resolved {
        workout: WorkoutInput {
            sport_id: body.sport_id,
            performed_at,
            duration_s: body.duration_s,
            exercises,
        },
        plausibility,
    })
}

/// The little history anti-cheat looks at. Rejected workouts count for nothing.
async fn context(
    state: &AppState,
    user: Uuid,
    w: &WorkoutInput,
    rules: &Rules,
    now: DateTime<Utc>,
    device: Option<DateTime<Utc>>,
    fingerprint: [u8; 32],
) -> Result<Context, AppError> {
    let day = policy::business_day_start(w.performed_at, state.cfg.business_utc_offset_minutes);
    let workouts_same_day = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM workouts \
         WHERE user_id = ? AND status <> 'REJECTED' AND performed_at >= ? AND performed_at < ?",
        user,
        day.naive_utc(),
        (day + Duration::days(1)).naive_utc()
    )
    .fetch_one(&state.db)
    .await?;

    let start = w.performed_at.naive_utc();
    let end = start + Duration::seconds(i64::from(w.duration_s));
    let tolerance = Duration::seconds(anticheat::OVERLAP_TOLERANCE_S);
    let overlapping = sqlx::query!(
        "SELECT performed_at, duration_s, fingerprint FROM workouts \
         WHERE user_id = ? AND status <> 'REJECTED' AND performed_at >= ? AND performed_at < ?",
        user,
        start - Duration::days(1),
        end
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .filter(|other| {
        let other_end = other.performed_at + Duration::seconds(i64::from(other.duration_s));
        other.performed_at < end - tolerance && other_end > start + tolerance
    })
    .filter_map(|other| <[u8; 32]>::try_from(other.fingerprint.as_slice()).ok())
    .collect();

    let identical_recent = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM workouts \
         WHERE user_id = ? AND status <> 'REJECTED' AND fingerprint = ? AND performed_at >= ?",
        user,
        &fingerprint[..],
        (now - Duration::days(rules.anticheat.identical_fingerprint_hold.days)).naive_utc()
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Context {
        now,
        device_submitted_at: device,
        body_weight_kg: body::latest_weight_kg(state, user).await?,
        workouts_same_day,
        overlapping,
        identical_recent,
        fingerprint,
    })
}

/// Which of the athlete's workouts to load. Every field narrows; the default is all of them.
#[derive(Default)]
pub struct Filter {
    pub id: Option<Uuid>,
    /// The page cursor: workouts strictly before this `(performed_at, id)`.
    pub before: Option<(NaiveDateTime, Uuid)>,
    pub from: Option<NaiveDateTime>,
    pub to: Option<NaiveDateTime>,
    pub sport: Option<Uuid>,
    pub limit: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkoutView {
    id: Uuid,
    client_id: Uuid,
    sport_id: Uuid,
    workout_type: String,
    performed_at: String,
    duration_s: i32,
    notes: Option<String>,
    visibility: String,
    status: String,
    is_verified: bool,
    version: i32,
    total_volume_kg: f64,
    total_distance_m: i64,
    received_at: String,
    exercises: Vec<ExerciseView>,
    evaluation: EvaluationView,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExerciseView {
    id: Uuid,
    exercise_id: Uuid,
    position: i16,
    notes: Option<String>,
    sets: Vec<SetView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetView {
    set_index: i16,
    reps: Option<i16>,
    weight_kg: Option<f64>,
    distance_m: Option<i32>,
    duration_s: Option<i32>,
    is_warmup: bool,
    rpe: Option<f64>,
    e1rm_kg: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EvaluationView {
    outcome: String,
    rule_hits: Value,
    /// False for a late log: history and progress only.
    counts_for_competition: bool,
    reviewed_at: Option<String>,
}

/// One of the athlete's workouts, as the app reads it.
pub async fn one(db: &MySqlPool, user: Uuid, id: Uuid) -> Result<Value, AppError> {
    let filter = Filter {
        id: Some(id),
        limit: Some(1),
        ..Filter::default()
    };
    load(db, user, &filter)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::not_found("Workout"))
}

/// The athlete's workouts matching `filter`, newest first, each with its sets and verdict. One
/// statement: the page of workouts is a derived table joined to the rest.
pub async fn load(db: &MySqlPool, user: Uuid, filter: &Filter) -> Result<Vec<Value>, AppError> {
    let limit = filter.limit.map_or(i64::MAX, i64::from);
    let (before_at, before_id) = filter.before.unzip();
    let rows = sqlx::query!(
        r#"SELECT w.id AS "id: Uuid", w.client_id AS "client_id: Uuid", w.sport_id AS "sport_id: Uuid",
                  w.workout_type, w.performed_at, w.duration_s, w.notes, w.visibility, w.status,
                  w.is_verified AS "is_verified: bool", w.version,
                  CAST(w.total_volume_kg AS DOUBLE) AS "total_volume_kg!: f64", w.total_distance_m,
                  w.received_at, ev.outcome, ev.rule_hits, ev.reviewed_at,
                  e.id AS "exercise_row: Uuid", e.exercise_id AS "exercise_id: Uuid", e.position,
                  e.notes AS exercise_notes,
                  s.set_index, s.reps, CAST(s.weight_kg AS DOUBLE) AS "weight_kg?: f64", s.distance_m,
                  s.duration_s AS set_duration_s, s.is_warmup AS "is_warmup: bool",
                  CAST(s.rpe AS DOUBLE) AS "rpe?: f64", CAST(s.e1rm_kg AS DOUBLE) AS "e1rm_kg?: f64"
           FROM (SELECT id FROM workouts
                 WHERE user_id = ?
                   AND (? IS NULL OR id = ?)
                   AND (? IS NULL OR performed_at < ? OR (performed_at = ? AND id < ?))
                   AND (? IS NULL OR performed_at >= ?)
                   AND (? IS NULL OR performed_at < ?)
                   AND (? IS NULL OR sport_id = ?)
                 ORDER BY performed_at DESC, id DESC
                 LIMIT ?) page
           JOIN workouts w ON w.id = page.id
           JOIN workout_evaluations ev ON ev.workout_id = w.id
           JOIN workout_exercises e ON e.workout_id = w.id
           JOIN workout_sets s ON s.workout_exercise_id = e.id
           ORDER BY w.performed_at DESC, w.id DESC, e.position, s.set_index"#,
        user,
        filter.id,
        filter.id,
        before_at,
        before_at,
        before_at,
        before_id,
        filter.from,
        filter.from,
        filter.to,
        filter.to,
        filter.sport,
        filter.sport,
        limit
    )
    .fetch_all(db)
    .await?;

    let mut workouts: Vec<WorkoutView> = Vec::new();
    for row in rows {
        if workouts.last().is_none_or(|w| w.id != row.id) {
            let rule_hits: Value =
                serde_json::from_str(&row.rule_hits).map_err(AppError::internal)?;
            let late = rule_hits
                .as_array()
                .is_some_and(|hits| hits.iter().any(|h| h["rule"] == "LATE_LOG"));
            workouts.push(WorkoutView {
                id: row.id,
                client_id: row.client_id,
                sport_id: row.sport_id,
                workout_type: row.workout_type,
                performed_at: iso(row.performed_at),
                duration_s: row.duration_s,
                notes: row.notes,
                visibility: row.visibility,
                status: row.status,
                is_verified: row.is_verified,
                version: row.version,
                total_volume_kg: row.total_volume_kg,
                total_distance_m: row.total_distance_m,
                received_at: iso(row.received_at),
                exercises: Vec::new(),
                evaluation: EvaluationView {
                    outcome: row.outcome,
                    rule_hits,
                    counts_for_competition: !late,
                    reviewed_at: row.reviewed_at.map(iso),
                },
            });
        }
        let Some(workout) = workouts.last_mut() else {
            continue;
        };
        if workout
            .exercises
            .last()
            .is_none_or(|e| e.id != row.exercise_row)
        {
            workout.exercises.push(ExerciseView {
                id: row.exercise_row,
                exercise_id: row.exercise_id,
                position: row.position,
                notes: row.exercise_notes,
                sets: Vec::new(),
            });
        }
        if let Some(exercise) = workout.exercises.last_mut() {
            exercise.sets.push(SetView {
                set_index: row.set_index,
                reps: row.reps,
                weight_kg: row.weight_kg,
                distance_m: row.distance_m,
                duration_s: row.set_duration_s,
                is_warmup: row.is_warmup,
                rpe: row.rpe,
                e1rm_kg: row.e1rm_kg,
            });
        }
    }
    workouts
        .into_iter()
        .map(|w| serde_json::to_value(w).map_err(AppError::internal))
        .collect()
}
