//! « My progress »: you against you (docs §11). Read-only views of the athlete's own observations,
//! records and record XP. Body weight shows here only, to its owner, with the health consent.

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use super::engine::{self, Direction};
use crate::{
    error::AppError,
    http::{Api, auth::AppUser},
    modules::me::body,
    state::AppState,
    types::iso,
    validate::{ValidQuery, rfc3339},
};

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/me/progress", overview)
        .get(
            "/api/v1/me/progress/metrics/{exercise_id}/{metric_code}",
            series,
        )
        .get("/api/v1/me/records", records)
}

/// How far back each period reaches, in days.
const PERIODS: [(&str, i64); 5] = [("7d", 7), ("30d", 30), ("3m", 91), ("6m", 182), ("1y", 365)];

#[derive(Deserialize)]
struct PeriodQuery {
    period: Option<String>,
}

/// The period's name and its first instant.
fn period(
    query: &PeriodQuery,
    now: DateTime<Utc>,
) -> Result<(&'static str, DateTime<Utc>), AppError> {
    let wanted = query.period.as_deref().unwrap_or("30d");
    PERIODS
        .iter()
        .find(|(name, _)| *name == wanted)
        .map(|(name, days)| (*name, now - Duration::days(*days)))
        .ok_or_else(|| AppError::field("period", "ISIN"))
}

fn name(fr: String, en: String, ar: String) -> Value {
    json!({"fr": fr, "en": en, "ar": ar})
}

struct Observed {
    value: f64,
    at: NaiveDateTime,
}

/// One metric of one exercise, its observations oldest first.
struct Group {
    exercise: Value,
    metric: Value,
    exercise_id: Uuid,
    metric_id: Uuid,
    metric_code: String,
    direction: Direction,
    observed: Vec<Observed>,
}

/// Per metric seen in the period: the best before it against the best in it.
async fn overview(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidQuery(query): ValidQuery<PeriodQuery>,
) -> Result<Json<Value>, AppError> {
    let now = Utc::now();
    let (period, from) = period(&query, now)?;
    let since = from.naive_utc();
    // shortcut: reads every observation of the athlete; keep the best value before the period
    // per metric in SQL if histories grow to thousands of workouts.
    let rows = sqlx::query!(
        r#"SELECT o.exercise_id AS "exercise_id: Uuid", o.metric_type_id AS "metric_id: Uuid",
                  CAST(o.value AS DOUBLE) AS "value!: f64", o.observed_at,
                  e.code AS exercise_code, e.name_fr, e.name_en, e.name_ar,
                  m.code AS metric_code, m.unit, m.direction
           FROM metric_observations o
           JOIN exercises e ON e.id = o.exercise_id
           JOIN metric_types m ON m.id = o.metric_type_id
           WHERE o.user_id = ? AND o.qualifier = 0 AND m.code <> 'REPS_AT_WEIGHT'
           ORDER BY o.observed_at, o.id"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;
    let mut groups: Vec<Group> = Vec::new();
    for row in rows {
        let observed = Observed {
            value: row.value,
            at: row.observed_at,
        };
        if let Some(group) = groups
            .iter_mut()
            .find(|g| g.exercise_id == row.exercise_id && g.metric_id == row.metric_id)
        {
            group.observed.push(observed);
            continue;
        }
        groups.push(Group {
            exercise: json!({
                "id": row.exercise_id, "code": row.exercise_code,
                "name": name(row.name_fr, row.name_en, row.name_ar),
            }),
            metric: json!({"code": row.metric_code, "unit": row.unit, "direction": row.direction}),
            exercise_id: row.exercise_id,
            metric_id: row.metric_id,
            direction: Direction::parse(&row.direction).unwrap_or(Direction::Higher),
            metric_code: row.metric_code,
            observed: vec![observed],
        });
    }

    let baselines = sqlx::query!(
        r#"SELECT exercise_id AS "exercise_id: Uuid", metric_type_id AS "metric_id: Uuid",
                  CAST(effective_value AS DOUBLE) AS "value!: f64"
           FROM baselines WHERE user_id = ?"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;
    // Record XP of the period that still stands; its explanation names the exercise and metric.
    let record_xp = sqlx::query!(
        "SELECT x.amount, x.explanation FROM xp_transactions x \
         WHERE x.user_id = ? AND x.source_type = 'pr' AND x.reason IN ('PR', 'CALIBRATION_PR') \
           AND x.effective_at >= ? \
           AND NOT EXISTS (SELECT 1 FROM xp_transactions r WHERE r.reverses_id = x.id)",
        user.id,
        since
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|row| {
        let inputs =
            serde_json::from_str::<Value>(&row.explanation).map_err(AppError::internal)?["inputs"]
                .clone();
        Ok((inputs, i64::from(row.amount)))
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    let mut metrics = Vec::new();
    for group in groups {
        let in_period: Vec<f64> = group
            .observed
            .iter()
            .filter(|o| o.at >= since)
            .map(|o| o.value)
            .collect();
        let before: Vec<f64> = group
            .observed
            .iter()
            .filter(|o| o.at < since)
            .map(|o| o.value)
            .collect();
        let best = |values: &[f64]| {
            values.iter().copied().reduce(|a, b| match group.direction {
                Direction::Higher => a.max(b),
                Direction::Lower => a.min(b),
            })
        };
        let Some(now_best) = best(&in_period) else {
            continue;
        };
        // Before the period, else the baseline, else the first value in it.
        let baseline = baselines
            .iter()
            .find(|b| b.exercise_id == group.exercise_id && b.metric_id == group.metric_id)
            .map(|b| b.value);
        let reference = best(&before)
            .or(baseline)
            .or(in_period.first().copied())
            .unwrap_or(now_best);
        let exercise_id = group.exercise_id.to_string();
        let xp: i64 = record_xp
            .iter()
            .filter(|(inputs, _)| {
                inputs["exerciseId"] == exercise_id.as_str()
                    && inputs["metric"] == group.metric_code.as_str()
            })
            .map(|(_, amount)| amount)
            .sum();
        let change = engine::improvement_pct(reference, now_best, group.direction);
        metrics.push(json!({
            "exercise": group.exercise,
            "metric": group.metric,
            "before": reference,
            "now": now_best,
            "changePct": (change * 10.0).round() / 10.0,
            "xpFromRecords": xp,
            "sessions": in_period.len(),
        }));
    }
    metrics.sort_by_key(|m| std::cmp::Reverse(m["sessions"].as_u64().unwrap_or(0)));

    // Health data: never without the consent (plan 2a ruling 3).
    let body_weight = if body::has_consent(&state.db, user.id, "HEALTH_DATA").await? {
        let weights: Vec<f64> = body::all(&state, user.id, Some(400))
            .await?
            .iter()
            .filter(|m| {
                m["measuredAt"]
                    .as_str()
                    .and_then(rfc3339)
                    .is_some_and(|at| at >= from)
            })
            .filter_map(|m| m["weightKg"].as_f64())
            .collect();
        // Newest first.
        match (weights.last(), weights.first()) {
            (Some(first), Some(last)) => {
                json!({"first": first, "last": last, "points": weights.len()})
            }
            _ => Value::Null,
        }
    } else {
        Value::Null
    };

    Ok(Json(json!({
        "period": period,
        "from": iso(from.naive_utc()),
        "to": iso(now.naive_utc()),
        "metrics": metrics,
        "bodyWeight": body_weight,
    })))
}

/// One metric of one exercise over the period, oldest first: the chart under a progress card.
async fn series(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    Path((exercise, metric)): Path<(String, String)>,
    ValidQuery(query): ValidQuery<PeriodQuery>,
) -> Result<Json<Value>, AppError> {
    let (_, from) = period(&query, Utc::now())?;
    // A malformed id names no exercise, like an unknown one.
    let exercise = Uuid::parse_str(&exercise).map_err(|_| AppError::not_found("Exercise"))?;
    let metric = sqlx::query!(
        r#"SELECT id AS "id: Uuid", code, unit, direction FROM metric_types WHERE code = ?"#,
        metric
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Metric"))?;
    let points: Vec<Value> = sqlx::query!(
        r#"SELECT CAST(value AS DOUBLE) AS "value!: f64", observed_at, workout_id AS "workout_id: Uuid"
           FROM metric_observations
           WHERE user_id = ? AND exercise_id = ? AND metric_type_id = ? AND qualifier = 0 AND observed_at >= ?
           ORDER BY observed_at, id"#,
        user.id,
        exercise,
        metric.id,
        from.naive_utc()
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|row| json!({"at": iso(row.observed_at), "value": row.value, "workoutId": row.workout_id}))
    .collect();
    Ok(Json(json!({
        "metric": {"code": metric.code, "unit": metric.unit, "direction": metric.direction},
        "points": points,
    })))
}

/// The current records, newest first; `REPS_AT_WEIGHT` ones are kept for history only.
async fn records(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT p.id AS "id: Uuid", p.exercise_id AS "exercise_id: Uuid", e.code AS exercise_code,
                  e.name_fr, e.name_en, e.name_ar, m.code AS metric_code, m.unit,
                  CAST(p.value AS DOUBLE) AS "value!: f64",
                  CAST(p.previous_value AS DOUBLE) AS "previous_value?: f64",
                  p.status, p.achieved_at, p.workout_id AS "workout_id: Uuid"
           FROM personal_records p
           JOIN exercises e ON e.id = p.exercise_id
           JOIN metric_types m ON m.id = p.metric_type_id
           WHERE p.user_id = ? AND p.is_current AND m.code <> 'REPS_AT_WEIGHT'
           ORDER BY p.achieved_at DESC, p.id DESC"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(Value::Array(
        rows.into_iter()
            .map(|row| {
                json!({
                    "id": row.id,
                    "exercise": {
                        "id": row.exercise_id, "code": row.exercise_code,
                        "name": name(row.name_fr, row.name_en, row.name_ar),
                    },
                    "metric": {"code": row.metric_code, "unit": row.unit},
                    "value": row.value,
                    "previousValue": row.previous_value,
                    "status": row.status,
                    "achievedAt": iso(row.achieved_at),
                    "workoutId": row.workout_id,
                })
            })
            .collect(),
    )))
}
