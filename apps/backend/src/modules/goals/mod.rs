//! Goals: what an athlete aims for, the milestones on the way, and the targets suggested to them.
//! A port of the old API's `GoalsService`. Weight goals are health data: their values are stored
//! encrypted and shown only while the `HEALTH_DATA` consent is granted.

pub mod milestones;
pub mod planning;

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::MySqlConnection;
use uuid::Uuid;

use self::planning::{FAST_RATE, round_for};
use crate::{
    db,
    error::AppError,
    http::{Api, auth::AppUser},
    modules::{
        me::body,
        scoring::{self, engine, engine::Direction, records::decimal},
    },
    rules::Rules,
    security::policy,
    state::AppState,
    types::{ExperienceLevel, Visibility, iso},
    validate::{Check, ValidJson, Validate, round_to},
};

const GOALS: &str = "/api/v1/goals";
const DISCLAIMER_KEY: &str = "goals.disclaimer";
// The old API's limits; the rule set does not carry them (plan 2c ruling 1).
const MAX_ACTIVE_GOALS: i64 = 10;
const MAX_WEIGHT_CHANGE_PCT: f64 = 25.0;
const WEIGHT_RANGE_KG: (f64, f64) = (40.0, 250.0);
/// Weight milestones, every 2 kg.
const WEIGHT_STEP_KG: f64 = 2.0;
/// Habit milestones, in weeks with the target met.
const HABIT_WEEK_MILESTONES: [f64; 4] = [2.0, 4.0, 8.0, 12.0];
/// More than two years of progress away is not a goal but a dream.
const UNREALISTIC_WEEKS: i64 = 104;

pub fn routes(api: Api) -> Api {
    api.get(GOALS, list)
        .post(GOALS, create)
        .post("/api/v1/goals/suggestions", suggestions)
        .delete("/api/v1/goals/{id}", abandon)
}

#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum GoalType {
    Weight,
    Strength,
    Running,
    Habit,
}

impl GoalType {
    fn as_str(self) -> &'static str {
        match self {
            GoalType::Weight => "WEIGHT",
            GoalType::Strength => "STRENGTH",
            GoalType::Running => "RUNNING",
            GoalType::Habit => "HABIT",
        }
    }

    fn metrics(self) -> &'static [&'static str] {
        match self {
            GoalType::Strength => &["E1RM", "MAX_WEIGHT", "MAX_REPS"],
            GoalType::Running => &["TIME_1K", "TIME_5K", "TIME_10K", "TIME_21K", "DISTANCE"],
            GoalType::Weight => &["BODY_WEIGHT"],
            GoalType::Habit => &["WORKOUTS_PER_WEEK"],
        }
    }
}

/// Suggestions exist for the goals an expected progression describes.
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum SuggestType {
    Strength,
    Running,
}

fn is_code(code: &str) -> bool {
    (2..=40).contains(&code.len())
        && code
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

/// `2026-12-31`, or an RFC 3339 instant whose date is kept as written.
fn date_of(raw: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d").ok().or_else(|| {
        DateTime::parse_from_rfc3339(raw)
            .ok()
            .map(|at| at.date_naive())
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CreateBody {
    #[serde(rename = "type")]
    kind: GoalType,
    exercise_id: Option<Uuid>,
    metric_code: String,
    target_value: f64,
    target_date: Option<String>,
    visibility: Option<Visibility>,
    was_suggested: Option<bool>,
}

impl Validate for CreateBody {
    fn validate(&self, check: &mut Check) {
        check.ensure("metricCode", is_code(&self.metric_code), "MATCHES");
        if self.target_value <= 0.0 {
            check.fail("targetValue", "ISPOSITIVE");
        } else if self.target_value > 1_000_000.0 {
            check.fail("targetValue", "MAX");
        }
        if let Some(date) = &self.target_date {
            check.ensure("targetDate", date_of(date).is_some(), "ISISO8601");
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SuggestBody {
    #[serde(rename = "type")]
    kind: SuggestType,
    exercise_id: Uuid,
    metric_code: String,
}

impl Validate for SuggestBody {
    fn validate(&self, check: &mut Check) {
        check.ensure("metricCode", is_code(&self.metric_code), "MATCHES");
    }
}

struct MetricRow {
    id: Uuid,
    code: String,
    unit: String,
    /// As stored: `HIGHER_IS_BETTER` or `LOWER_IS_BETTER`.
    direction_code: String,
    direction: Direction,
}

impl MetricRow {
    fn round(&self, v: f64) -> f64 {
        round_for(&self.unit, &self.code, v)
    }
}

fn bad(code: &str) -> AppError {
    AppError::field("targetValue", code)
}

async fn metric(state: &AppState, kind: GoalType, code: &str) -> Result<MetricRow, AppError> {
    if !kind.metrics().contains(&code) {
        return Err(AppError::field("metricCode", "NOT_ALLOWED_FOR_TYPE"));
    }
    let row = sqlx::query!(
        r#"SELECT id AS "id: Uuid", unit, direction FROM metric_types WHERE code = ?"#,
        code
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::internal(format!("metric type {code} missing: run `backend seed`")))?;
    Ok(MetricRow {
        id: row.id,
        code: code.to_owned(),
        unit: row.unit,
        direction: Direction::parse(&row.direction).unwrap_or(Direction::Higher),
        direction_code: row.direction,
    })
}

/// The goal's exercise: none for weight and habit goals, an enabled one tracking the metric otherwise.
async fn exercise_for(
    state: &AppState,
    kind: GoalType,
    exercise: Option<Uuid>,
    metric: &MetricRow,
) -> Result<Option<Uuid>, AppError> {
    if matches!(kind, GoalType::Weight | GoalType::Habit) {
        return match exercise {
            Some(_) => Err(AppError::field("exerciseId", "NOT_ALLOWED_FOR_TYPE")),
            None => Ok(None),
        };
    }
    let id = exercise.ok_or_else(|| AppError::field("exerciseId", "REQUIRED"))?;
    let tracked = sqlx::query_scalar!(
        "SELECT EXISTS (SELECT 1 FROM exercises e JOIN exercise_metrics em ON em.exercise_id = e.id \
           WHERE e.id = ? AND e.enabled AND em.metric_type_id = ?)",
        id,
        metric.id
    )
    .fetch_one(&state.db)
    .await?;
    if tracked == 0 {
        return Err(AppError::field("exerciseId", "METRIC_NOT_TRACKED"));
    }
    Ok(Some(id))
}

/// The current best: the current record, else the baseline (declared or calibrated).
async fn current_value(
    conn: &mut MySqlConnection,
    user: Uuid,
    exercise: Uuid,
    metric: &MetricRow,
) -> Result<f64, AppError> {
    let record = sqlx::query_scalar!(
        r#"SELECT CAST(value AS DOUBLE) AS "value!: f64" FROM personal_records
           WHERE user_id = ? AND exercise_id = ? AND metric_type_id = ? AND qualifier = 0 AND is_current"#,
        user,
        exercise,
        metric.id
    )
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(value) = record {
        return Ok(value);
    }
    sqlx::query_scalar!(
        r#"SELECT CAST(effective_value AS DOUBLE) AS "value!: f64" FROM baselines
           WHERE user_id = ? AND exercise_id = ? AND metric_type_id = ?"#,
        user,
        exercise,
        metric.id
    )
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| bad("NO_CURRENT_VALUE"))
}

/// The expected progress per 28 days, at the harder of the declared and the measured level.
async fn expected_pct(
    conn: &mut MySqlConnection,
    rules: &Rules,
    user: Uuid,
    exercise: Uuid,
    metric: &MetricRow,
) -> Result<f64, AppError> {
    let expected = scoring::expected(conn, rules.version).await?;
    let row = sqlx::query!(
        r#"SELECT p.experience_level_declared AS "declared?: ExperienceLevel",
                  (SELECT b.experience_level FROM baselines b
                   WHERE b.user_id = p.user_id AND b.exercise_id = ? AND b.metric_type_id = ?)
                    AS "measured?: ExperienceLevel"
           FROM profiles p WHERE p.user_id = ?"#,
        exercise,
        metric.id,
        user
    )
    .fetch_one(&mut *conn)
    .await?;
    let lookup = |level| expected.get(level, exercise, metric.id);
    let level = engine::harder_level(
        &[
            row.declared,
            Some(row.measured.unwrap_or(ExperienceLevel::Beginner)),
        ],
        lookup,
    );
    Ok(lookup(level).unwrap_or(1.0))
}

/// What a new goal starts from and aims at, before it is stored.
struct Plan {
    start: f64,
    target: f64,
    direction: &'static str,
    milestones: Vec<f64>,
    target_date: Option<NaiveDate>,
    safety: Option<Value>,
}

fn weeks_from(day: NaiveDate, weeks: i64) -> NaiveDate {
    day + Duration::days(weeks * 7)
}

async fn create(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<CreateBody>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let metric = metric(&state, body.kind, &body.metric_code).await?;
    let exercise = exercise_for(&state, body.kind, body.exercise_id, &metric).await?;
    let rules = Rules::active(&state.db).await?;

    let mut tx = state.db.begin().await?;
    // Holds the account until the commit: two goals sent at the same instant are checked in turn.
    sqlx::query!("SELECT id FROM users WHERE id = ? FOR UPDATE", user.id)
        .fetch_one(&mut *tx)
        .await?;
    let active = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM goals WHERE user_id = ? AND status = 'ACTIVE'",
        user.id
    )
    .fetch_one(&mut *tx)
    .await?;
    if active >= MAX_ACTIVE_GOALS {
        return Err(AppError::conflict("CONFLICT").detail("At most 10 active goals."));
    }
    let duplicate = sqlx::query_scalar!(
        r#"SELECT id AS "id: Uuid" FROM goals
           WHERE user_id = ? AND status = 'ACTIVE' AND metric_type_id = ? AND exercise_id <=> ?"#,
        user.id,
        metric.id,
        exercise
    )
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(goal) = duplicate {
        return Err(already_active().with("goalId", goal.to_string()));
    }

    let today = policy::business_today(Utc::now(), state.cfg.business_utc_offset_minutes);
    let requested = body.target_date.as_deref().and_then(date_of);
    if requested.is_some_and(|date| date <= today) {
        return Err(AppError::field("targetDate", "MUST_BE_IN_FUTURE"));
    }
    let raw_target = round_to(body.target_value, 2);
    let plan = match (body.kind, exercise) {
        (GoalType::Habit, _) => {
            // Planned rest is part of the design: a habit never asks for 7 days a week (docs §5).
            if raw_target.fract() != 0.0 || raw_target > 6.0 {
                return Err(bad("REST_DAY_REQUIRED"));
            }
            Plan {
                start: 0.0,
                target: raw_target,
                direction: "INCREASE",
                milestones: HABIT_WEEK_MILESTONES.to_vec(),
                target_date: requested,
                safety: None,
            }
        }
        (GoalType::Weight, _) => {
            let start = body::latest_weight_kg(&state, user.id)
                .await?
                .ok_or_else(|| bad("NO_CURRENT_VALUE"))?;
            weight_plan(&rules, &metric, start, raw_target, requested, body.target_date.as_deref(), today)?
        }
        (_, Some(exercise)) => {
            let start = current_value(&mut tx, user.id, exercise, &metric).await?;
            let target = metric.round(raw_target);
            let better = match metric.direction {
                Direction::Higher => target > start,
                Direction::Lower => target < start,
            };
            if !better {
                return Err(bad("TARGET_NOT_BETTER").with("current", start));
            }
            let pct = expected_pct(&mut tx, &rules, user.id, exercise, &metric).await?;
            let fast = planning::weeks_at_rate(start, target, pct * FAST_RATE, metric.direction);
            if fast.is_some_and(|weeks| weeks > UNREALISTIC_WEEKS) {
                let suggestions =
                    planning::suggest_targets(start, pct, metric.direction, |v| metric.round(v));
                return Err(bad("UNREALISTIC_TARGET")
                    .with("suggestions", serde_json::to_value(suggestions).map_err(AppError::internal)?));
            }
            let mut target_date = requested;
            let mut safety = None;
            if let (Some(date), Some(weeks)) = (requested, fast) {
                let fastest = weeks_from(today, weeks);
                if date < fastest {
                    safety = Some(json!({
                        "reason": "TOO_FAST", "requestedTargetDate": body.target_date,
                        "earliestRealisticWeeks": weeks,
                    }));
                    target_date = Some(fastest);
                }
            }
            Plan {
                start,
                target,
                direction: if metric.direction == Direction::Higher { "INCREASE" } else { "DECREASE" },
                milestones: planning::plan_milestones(start, target, start * pct / 100.0, |v| metric.round(v)),
                target_date,
                safety,
            }
        }
        (_, None) => return Err(AppError::field("exerciseId", "REQUIRED")),
    };

    let id = Uuid::now_v7();
    let weight = body.kind == GoalType::Weight;
    // Weight values only ever reach the database encrypted.
    let value = |v: f64| -> Result<(Option<String>, Option<Vec<u8>>), AppError> {
        Ok(if weight {
            (None, Some(state.health.encrypt_number(v)?))
        } else {
            (Some(decimal(v)), None)
        })
    };
    let (start_plain, start_sealed) = value(plan.start)?;
    let (target_plain, target_sealed) = value(plan.target)?;
    // Weight goals are health data: always private (docs §5).
    let visibility = if weight {
        Visibility::Private
    } else {
        body.visibility.unwrap_or(Visibility::Private)
    };
    let inserted = sqlx::query!(
        "INSERT INTO goals (id, user_id, type, exercise_id, metric_type_id, direction, start_value, target_value, \
           start_value_enc, target_value_enc, start_date, target_date, was_suggested, safety_adjustment, visibility) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        user.id,
        body.kind.as_str(),
        exercise,
        metric.id,
        plan.direction,
        start_plain,
        target_plain,
        start_sealed,
        target_sealed,
        today,
        plan.target_date,
        body.was_suggested.unwrap_or(false),
        plan.safety.as_ref().map(Value::to_string),
        visibility.as_str()
    )
    .execute(&mut *tx)
    .await;
    if let Err(e) = inserted {
        return Err(if db::duplicate_key(&e) == Some("uq_goals_one_active") {
            already_active()
        } else {
            e.into()
        });
    }
    for (position, target) in plan.milestones.iter().enumerate() {
        let (plain, sealed) = value(*target)?;
        sqlx::query!(
            "INSERT INTO goal_milestones (id, goal_id, position, target_value, target_value_enc) VALUES (?, ?, ?, ?, ?)",
            Uuid::now_v7(),
            id,
            position as i16,
            plain,
            sealed
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    let mut view = load(&state, user.id, Some(id), true)
        .await?
        .pop()
        .ok_or_else(|| AppError::internal("the goal just created is missing"))?;
    view["disclaimerKey"] = json!(DISCLAIMER_KEY);
    Ok((StatusCode::CREATED, Json(view)))
}

fn already_active() -> AppError {
    AppError::conflict("CONFLICT").detail("An active goal already exists for this metric.")
}

/// A body-weight goal, paced at the safe rate.
fn weight_plan(
    rules: &Rules,
    metric: &MetricRow,
    start: f64,
    raw_target: f64,
    requested: Option<NaiveDate>,
    requested_raw: Option<&str>,
    today: NaiveDate,
) -> Result<Plan, AppError> {
    let target = metric.round(raw_target);
    if target == metric.round(start) {
        return Err(bad("TARGET_NOT_BETTER"));
    }
    let change_pct = (target - start).abs() / start * 100.0;
    if target < WEIGHT_RANGE_KG.0 || target > WEIGHT_RANGE_KG.1 || change_pct > MAX_WEIGHT_CHANGE_PCT {
        return Err(bad("UNSAFE_TARGET"));
    }
    let losing = target < start;
    let max_pct = rules.weight_change_max_pct_per_week;
    let safe = weeks_from(today, planning::safe_weight_weeks(start, target, max_pct));
    let (target_date, safety) = match requested {
        Some(date) if date >= safe => (Some(date), None),
        Some(_) => (
            Some(safe),
            Some(json!({
                "reason": "WEIGHT_RATE_LIMIT", "requestedTargetDate": requested_raw, "maxPctPerWeek": max_pct,
            })),
        ),
        None => (Some(safe), None),
    };
    let step = if losing { -WEIGHT_STEP_KG } else { WEIGHT_STEP_KG };
    Ok(Plan {
        start,
        target,
        direction: if losing { "DECREASE" } else { "INCREASE" },
        milestones: planning::plan_milestones(start, target, step, |v| metric.round(v)),
        target_date,
        safety,
    })
}

async fn suggestions(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<SuggestBody>,
) -> Result<Json<Value>, AppError> {
    let kind = match body.kind {
        SuggestType::Strength => GoalType::Strength,
        SuggestType::Running => GoalType::Running,
    };
    let metric = metric(&state, kind, &body.metric_code).await?;
    let exercise = exercise_for(&state, kind, Some(body.exercise_id), &metric)
        .await?
        .ok_or_else(|| AppError::field("exerciseId", "REQUIRED"))?;
    let rules = Rules::active(&state.db).await?;
    let mut conn = state.db.acquire().await?;
    let current = current_value(&mut conn, user.id, exercise, &metric).await?;
    let pct = expected_pct(&mut conn, &rules, user.id, exercise, &metric).await?;
    let suggestions = planning::suggest_targets(current, pct, metric.direction, |v| metric.round(v));
    Ok(Json(json!({
        "current": current,
        "metric": {"code": metric.code, "unit": metric.unit, "direction": metric.direction_code},
        "expectedPctPer28Days": pct,
        "suggestions": suggestions,
        "disclaimerKey": DISCLAIMER_KEY,
    })))
}

async fn list(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
    let health = body::has_consent(&state.db, user.id, body::HEALTH_DATA).await?;
    Ok(Json(Value::Array(views(&state, user.id, health).await?)))
}

/// Abandons an active goal. Any other one stays as it is.
async fn abandon(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    // A malformed id names no goal, like an unknown one.
    let id = Uuid::parse_str(&id).map_err(|_| AppError::not_found("Goal"))?;
    sqlx::query_scalar!(
        "SELECT status FROM goals WHERE id = ? AND user_id = ?",
        id,
        user.id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Goal"))?;
    sqlx::query!(
        "UPDATE goals SET status = 'ABANDONED' WHERE id = ? AND user_id = ? AND status = 'ACTIVE'",
        id,
        user.id
    )
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Every goal of the account as the app shows it: active first, newest first. `health` false
/// hides the values of weight goals.
pub async fn views(state: &AppState, user: Uuid, health: bool) -> Result<Vec<Value>, AppError> {
    load(state, user, None, health).await
}

async fn load(
    state: &AppState,
    user: Uuid,
    only: Option<Uuid>,
    health: bool,
) -> Result<Vec<Value>, AppError> {
    let goals = sqlx::query!(
        r#"SELECT g.id AS "id: Uuid", g.type AS kind, g.exercise_id AS "exercise_id?: Uuid", m.code AS metric_code,
                  m.unit, g.direction, CAST(g.start_value AS DOUBLE) AS "start_value?: f64",
                  CAST(g.target_value AS DOUBLE) AS "target_value?: f64", g.start_value_enc, g.target_value_enc,
                  g.start_date, g.target_date, g.status, g.visibility, g.was_suggested AS "was_suggested: bool",
                  g.safety_adjustment, g.habit_weeks_met
           FROM goals g JOIN metric_types m ON m.id = g.metric_type_id
           WHERE g.user_id = ? AND (? IS NULL OR g.id = ?)
           ORDER BY g.status, g.created_at DESC, g.id DESC"#,
        user,
        only,
        only
    )
    .fetch_all(&state.db)
    .await?;
    let rows = sqlx::query!(
        r#"SELECT mi.goal_id AS "goal_id: Uuid", mi.position, CAST(mi.target_value AS DOUBLE) AS "target_value?: f64",
                  mi.target_value_enc, mi.reached_at
           FROM goal_milestones mi JOIN goals g ON g.id = mi.goal_id
           WHERE g.user_id = ? AND (? IS NULL OR g.id = ?)
           ORDER BY mi.goal_id, mi.position"#,
        user,
        only,
        only
    )
    .fetch_all(&state.db)
    .await?;
    // A sealed value is shown only with the consent.
    let value = |plain: Option<f64>, sealed: Option<&[u8]>| -> Result<Option<f64>, AppError> {
        match sealed {
            Some(blob) if health => state.health.decrypt_number(blob).map(Some),
            Some(_) => Ok(None),
            None => Ok(plain),
        }
    };
    let mut milestones: HashMap<Uuid, Vec<Value>> = HashMap::new();
    for row in rows {
        milestones.entry(row.goal_id).or_default().push(json!({
            "index": row.position,
            "targetValue": value(row.target_value, row.target_value_enc.as_deref())?,
            "reachedAt": row.reached_at.map(iso),
        }));
    }
    goals
        .into_iter()
        .map(|g| {
            let steps = milestones.remove(&g.id).unwrap_or_default();
            let reached = steps.iter().filter(|m| !m["reachedAt"].is_null()).count();
            let safety: Value = match &g.safety_adjustment {
                Some(text) => serde_json::from_str(text).map_err(AppError::internal)?,
                None => Value::Null,
            };
            let mut view = json!({
                "id": g.id,
                "type": g.kind,
                "exerciseId": g.exercise_id,
                "metric": {"code": g.metric_code, "unit": g.unit},
                "direction": g.direction,
                "startValue": value(g.start_value, g.start_value_enc.as_deref())?,
                "targetValue": value(g.target_value, g.target_value_enc.as_deref())?,
                "startDate": g.start_date.to_string(),
                "targetDate": g.target_date.map(|d| d.to_string()),
                "status": g.status,
                "visibility": g.visibility,
                "wasSuggested": g.was_suggested,
                "safetyAdjustment": safety,
                "milestones": steps,
                "milestonesReached": reached,
            });
            if g.kind == "HABIT" {
                view["habitWeeksMet"] = json!(g.habit_weeks_met);
            }
            Ok(view)
        })
        .collect()
}
