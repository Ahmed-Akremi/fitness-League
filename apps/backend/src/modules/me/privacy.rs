//! What an athlete can take away or erase: the export of their data, and the deletion of their
//! account after a grace period, carried out by the daily sweep.

use axum::{Json, extract::State, http::StatusCode};
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::MySqlPool;
use uuid::Uuid;

use crate::{
    audit, db,
    error::AppError,
    http::{
        Api,
        auth::{AppUser, AuthUser},
        rate_limit,
    },
    modules::{
        auth::{accounts, sessions},
        goals,
        workouts::intake,
    },
    security::{password, policy},
    state::AppState,
    types::iso,
    validate::{Check, ValidJson, Validate},
};

/// How long a deletion request waits. Signing in again during it cancels the request.
pub const GRACE_DAYS: i64 = 30;

pub fn routes(api: Api) -> Api {
    api.get("/api/v1/me/export", export)
        .delete("/api/v1/me", delete_account)
}

/// Everything held about the account, in one answer: the `GET /me` payload with what it leaves
/// out (date of birth, phone, dates, declared values), and the consent history. The keys of later
/// parts are empty lists until those parts exist.
async fn export(
    State(state): State<AppState>,
    AppUser(user): AppUser,
) -> Result<Json<Value>, AppError> {
    rate_limit::check(&state, &rate_limit::EXPORT_USER, &user.id.to_string()).await?;
    let mut account = super::payload(&state, user.id).await?;
    let row = sqlx::query!(
        "SELECT u.date_of_birth, u.phone_e164, u.email_verified_at, u.last_login_at, u.created_at, \
                p.calibration_started_at, p.onboarding_completed_at \
         FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?",
        user.id
    )
    .fetch_one(&state.db)
    .await?;
    let baselines = sqlx::query!(
        r#"SELECT e.id AS "exercise_id: Uuid", e.code AS exercise_code, m.code AS metric_code,
                  CAST(b.declared_value AS DOUBLE) AS "declared_value: f64",
                  CAST(b.effective_value AS DOUBLE) AS "effective_value!: f64",
                  b.status, b.created_at, b.updated_at
           FROM baselines b
           JOIN exercises e ON e.id = b.exercise_id
           JOIN metric_types m ON m.id = b.metric_type_id
           WHERE b.user_id = ?
           ORDER BY b.created_at, b.id"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;
    let consents = sqlx::query!(
        r#"SELECT type AS kind, granted AS "granted: bool", document_version, created_at
           FROM consents WHERE user_id = ? ORDER BY created_at, id"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;
    let records: Vec<Value> = sqlx::query!(
        r#"SELECT p.id AS "id: Uuid", e.id AS "exercise_id: Uuid", e.code AS exercise_code,
                  m.code AS metric_code, CAST(p.qualifier AS DOUBLE) AS "qualifier!: f64",
                  CAST(p.value AS DOUBLE) AS "value!: f64",
                  CAST(p.previous_value AS DOUBLE) AS "previous_value?: f64", p.status,
                  p.is_current AS "is_current: bool", p.achieved_at, p.workout_id AS "workout_id: Uuid"
           FROM personal_records p
           JOIN exercises e ON e.id = p.exercise_id
           JOIN metric_types m ON m.id = p.metric_type_id
           WHERE p.user_id = ?
           ORDER BY p.achieved_at, p.id"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|r| {
        json!({
            "id": r.id, "exerciseId": r.exercise_id, "exerciseCode": r.exercise_code,
            "metricCode": r.metric_code, "qualifier": r.qualifier, "value": r.value,
            "previousValue": r.previous_value, "status": r.status, "isCurrent": r.is_current,
            "achievedAt": iso(r.achieved_at), "workoutId": r.workout_id,
        })
    })
    .collect();
    let league_points = sqlx::query!(
        r#"SELECT id AS "id: Uuid", season_id AS "season_id: Uuid", amount, reason, source_type, source_id,
                  reverses_id AS "reverses_id?: Uuid", rule_set_version, explanation, effective_at, created_at
           FROM league_point_transactions WHERE user_id = ? ORDER BY created_at, id"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|l| {
        Ok(json!({
            "id": l.id, "seasonId": l.season_id, "amount": l.amount, "reason": l.reason,
            "sourceType": l.source_type, "sourceId": l.source_id, "reversesId": l.reverses_id,
            "ruleSetVersion": l.rule_set_version,
            "explanation": serde_json::from_str::<Value>(&l.explanation).map_err(AppError::internal)?,
            "effectiveAt": iso(l.effective_at), "createdAt": iso(l.created_at),
        }))
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    let xp_transactions = sqlx::query!(
        r#"SELECT id AS "id: Uuid", amount, reason, source_type, source_id, workout_id AS "workout_id?: Uuid",
                  reverses_id AS "reverses_id?: Uuid", rule_set_version, explanation, effective_at, created_at
           FROM xp_transactions WHERE user_id = ? ORDER BY created_at, id"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|x| {
        Ok(json!({
            "id": x.id, "amount": x.amount, "reason": x.reason, "sourceType": x.source_type,
            "sourceId": x.source_id, "workoutId": x.workout_id, "reversesId": x.reverses_id,
            "ruleSetVersion": x.rule_set_version,
            "explanation": serde_json::from_str::<Value>(&x.explanation).map_err(AppError::internal)?,
            "effectiveAt": iso(x.effective_at), "createdAt": iso(x.created_at),
        }))
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    let badges: Vec<Value> = sqlx::query!(
        r#"SELECT b.code, ub.awarded_at, ub.revoked_at, ub.source_ref
           FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
           WHERE ub.user_id = ? ORDER BY ub.awarded_at, ub.id"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|b| {
        json!({
            "code": b.code, "awardedAt": iso(b.awarded_at), "revokedAt": b.revoked_at.map(iso),
            "sourceRef": b.source_ref,
        })
    })
    .collect();

    let extra = json!({
        "dateOfBirth": row.date_of_birth.to_string(),
        "phone": row.phone_e164,
        "emailVerifiedAt": row.email_verified_at.map(iso),
        "lastLoginAt": row.last_login_at.map(iso),
        "createdAt": iso(row.created_at),
        "calibrationStartedAt": row.calibration_started_at.map(iso),
        "onboardingCompletedAt": row.onboarding_completed_at.map(iso),
        "baselines": baselines.iter().map(|b| json!({
            "exerciseId": b.exercise_id.to_string(),
            "exerciseCode": b.exercise_code,
            "metricCode": b.metric_code,
            "declaredValue": b.declared_value,
            "effectiveValue": b.effective_value,
            "status": b.status,
            "createdAt": iso(b.created_at),
            "updatedAt": iso(b.updated_at),
        })).collect::<Vec<_>>(),
        "personalRecords": records,
        "badges": badges,
    });
    if let (Some(account), Value::Object(extra)) = (account.as_object_mut(), extra) {
        account.extend(extra);
    }
    let consents: Vec<Value> = consents
        .iter()
        .map(|c| {
            json!({
                "type": c.kind,
                "granted": c.granted,
                "documentVersion": c.document_version,
                "createdAt": iso(c.created_at),
            })
        })
        .collect();
    let workouts = intake::load(&state.db, user.id, &intake::Filter::default()).await?;
    // Decrypted: the athlete's own health data, given back to them.
    let body_measurements = super::body::all(&state, user.id, None).await?;
    Ok(Json(json!({
        "exportedAt": iso(Utc::now().naive_utc()),
        "account": account,
        "consents": consents,
        "bodyMeasurements": body_measurements,
        "workouts": workouts,
        "xpTransactions": xp_transactions,
        // Weight goals decrypted, like the weigh-ins.
        "goals": goals::views(&state, user.id, true).await?,
        "leaguePointTransactions": league_points,
    })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeleteBody {
    password: Option<String>,
    /// The literal word `DELETE`, so the request cannot be sent by accident.
    confirm: String,
}

impl Validate for DeleteBody {
    fn validate(&self, check: &mut Check) {
        check.ensure("confirm", self.confirm == "DELETE", "EQUALS");
        if let Some(password) = &self.password {
            check.length("password", password, 0, password::MAX_LENGTH);
        }
    }
}

async fn delete_account(
    State(state): State<AppState>,
    AppUser(user): AppUser,
    ValidJson(body): ValidJson<DeleteBody>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    // Checked as at sign-in, lockout included: a stolen access token must not become a way to try
    // passwords at the pace of the general limit.
    let email = sqlx::query_scalar!("SELECT email FROM users WHERE id = ?", user.id)
        .fetch_one(&state.db)
        .await?;
    accounts::check_credentials(&state, &email, body.password.unwrap_or_default()).await?;
    let scheduled_for = request_deletion(&state.db, &user).await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"scheduledFor": iso(scheduled_for)})),
    ))
}

/// Schedules the deletion and signs the account out everywhere.
async fn request_deletion(db: &MySqlPool, user: &AuthUser) -> Result<NaiveDateTime, AppError> {
    let scheduled_for = Utc::now().naive_utc() + Duration::days(GRACE_DAYS);
    let mut tx = db.begin().await?;
    // The account row first (see `sessions::start`). It also makes a second request sent at the
    // same instant wait, then replace this one, instead of colliding with it.
    sqlx::query!("SELECT id FROM users WHERE id = ? FOR UPDATE", user.id)
        .fetch_one(&mut *tx)
        .await?;
    // One pending request at a time, which the database holds as well (`pending_user`).
    sqlx::query!(
        "UPDATE deletion_requests SET status = 'CANCELLED' WHERE user_id = ? AND status = 'PENDING'",
        user.id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "INSERT INTO deletion_requests (id, user_id, scheduled_for) VALUES (?, ?, ?)",
        Uuid::now_v7(),
        user.id,
        scheduled_for
    )
    .execute(&mut *tx)
    .await?;
    sessions::end_all(&mut tx, user.id).await?;
    let event = audit::Event {
        actor: Some((user.id, user.role)),
        action: "ACCOUNT_DELETION_REQUESTED",
        user_id: user.id,
        after: Some(json!({"scheduledFor": iso(scheduled_for)})),
    };
    audit::record(&mut *tx, event).await?;
    tx.commit().await?;
    Ok(scheduled_for)
}

/// What one sweep did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Swept {
    pub anonymised: u64,
    pub refresh_tokens: u64,
    pub email_tokens: u64,
}

/// The sweep of the day, run by whichever worker takes the day's key first. `Ok(None)`: it is
/// taken. A sweep that fails gives the key back; one whose worker dies keeps it, and the next
/// day's sweep catches up, since it takes every request that is due.
pub async fn daily_sweep(state: &AppState, now: DateTime<Utc>) -> Result<Option<Swept>, String> {
    let day = policy::business_today(now, state.cfg.business_utc_offset_minutes);
    let key = format!("{}sweep:{day}", state.redis_prefix);
    let mut redis = state.redis.clone();
    let taken: Option<String> = redis::cmd("SET")
        .arg(&key)
        .arg(1)
        .arg("NX")
        .arg("EX")
        .arg(2 * 86_400)
        .query_async(&mut redis)
        .await
        .map_err(|e| e.to_string())?;
    if taken.is_none() {
        return Ok(None);
    }
    match sweep(&state.db, now.naive_utc()).await {
        Ok(swept) => Ok(Some(swept)),
        Err(e) => {
            let _: redis::RedisResult<()> =
                redis::cmd("DEL").arg(&key).query_async(&mut redis).await;
            Err(db::describe(&e))
        }
    }
}

/// Anonymises the accounts whose grace period is over, then removes the tokens that have expired.
// ponytail: every due request in one list and one statement per token table; page both with LIMIT
// if a day ever holds more than a few thousand rows.
pub async fn sweep(db: &MySqlPool, now: NaiveDateTime) -> Result<Swept, sqlx::Error> {
    let due = sqlx::query!(
        r#"SELECT id AS "id: Uuid", user_id AS "user_id: Uuid" FROM deletion_requests
           WHERE status = 'PENDING' AND scheduled_for <= ? ORDER BY scheduled_for"#,
        now
    )
    .fetch_all(db)
    .await?;
    let mut swept = Swept::default();
    for request in due {
        if anonymise(db, request.id, request.user_id, now).await? {
            swept.anonymised += 1;
        }
    }
    swept.refresh_tokens = sqlx::query!("DELETE FROM refresh_tokens WHERE expires_at < ?", now)
        .execute(db)
        .await?
        .rows_affected();
    swept.email_tokens = sqlx::query!("DELETE FROM email_tokens WHERE expires_at < ?", now)
        .execute(db)
        .await?
        .rows_affected();
    Ok(swept)
}

/// Erases who the person was. The row stays, anonymous, so that what points at it (consents,
/// declared values, the audit trail, and the ledgers of part 2) stays whole.
async fn anonymise(
    db: &MySqlPool,
    request: Uuid,
    user: Uuid,
    now: NaiveDateTime,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query!("SELECT id FROM users WHERE id = ? FOR UPDATE", user)
        .fetch_one(&mut *tx)
        .await?;
    // Decided by the request: a sign-in that cancelled it first wins, and nothing happens here.
    let completed = sqlx::query!(
        "UPDATE deletion_requests SET status = 'COMPLETED', completed_at = ? WHERE id = ? AND status = 'PENDING'",
        now,
        request
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if completed != 1 {
        return Ok(false);
    }
    // Neither can be registered (an email needs an @, a username refuses a hyphen), so nobody can
    // block a deletion by taking the name first.
    let hex = user.simple().to_string();
    let email = format!("deleted:{user}");
    let username = format!("deleted-{}", &hex[hex.len() - 12..]);
    sqlx::query!(
        "UPDATE users SET email = ?, username = ?, password_hash = NULL, phone_e164 = NULL, \
         date_of_birth = '1900-01-01', status = 'DELETED', anonymised_at = ?, failed_login_count = 0, \
         locked_until = NULL, session_version = session_version + 1 WHERE id = ?",
        email,
        username,
        now,
        user
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE profiles SET full_name = 'Deleted athlete', bio = NULL, gender = NULL WHERE user_id = ?",
        user
    )
    .execute(&mut *tx)
    .await?;
    // Health data goes. Workouts stay for what they fed (records, ledgers, past rankings), without
    // their notes and out of sight.
    sqlx::query!("DELETE FROM body_measurements WHERE user_id = ?", user)
        .execute(&mut *tx)
        .await?;
    // Their milestones go with them; the XP they paid stays in the ledger, which names them by id.
    sqlx::query!(
        "DELETE FROM goals WHERE user_id = ? AND type = 'WEIGHT'",
        user
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE workouts SET notes = NULL, visibility = 'PRIVATE' WHERE user_id = ?",
        user
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE workout_exercises e JOIN workouts w ON w.id = e.workout_id SET e.notes = NULL \
         WHERE w.user_id = ?",
        user
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!("DELETE FROM refresh_tokens WHERE user_id = ?", user)
        .execute(&mut *tx)
        .await?;
    sqlx::query!("DELETE FROM email_tokens WHERE user_id = ?", user)
        .execute(&mut *tx)
        .await?;
    let event = audit::Event {
        actor: None,
        action: "ACCOUNT_ANONYMISED",
        user_id: user,
        after: None,
    };
    audit::record(&mut *tx, event).await?;
    tx.commit().await?;
    Ok(true)
}
