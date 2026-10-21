//! The league's scheduled jobs (docs §8), each run once per key through `job_runs` (spec ruling 4):
//! a week, a season or a business day is handled once, and a run that died is taken over. A port of
//! the old API's `JobsService`.

use std::future::Future;

use chrono::{DateTime, Duration, Utc};
use serde_json::{Value, json};
use sqlx::MySqlPool;
use uuid::Uuid;

use super::{boards, engine, seasons, weekly};
use crate::{error::AppError, modules::badges, rules::Rules, security::policy, state::AppState};

/// A run still `RUNNING` after this long belongs to a worker that died.
const STALE_RUN: Duration = Duration::hours(1);

/// Runs `work` unless the `(job, key)` already ran, or is running elsewhere; true when it ran.
/// A failed run is recorded and retried by the next tick.
pub async fn once<F>(
    db: &MySqlPool,
    job: &str,
    key: &str,
    now: DateTime<Utc>,
    work: F,
) -> Result<bool, AppError>
where
    F: Future<Output = Result<Value, AppError>>,
{
    let at = now.naive_utc();
    let claimed = sqlx::query!(
        "INSERT IGNORE INTO job_runs (id, job, run_key, status, started_at) VALUES (?, ?, ?, 'RUNNING', ?)",
        Uuid::now_v7(),
        job,
        key,
        at
    )
    .execute(db)
    .await?
    .rows_affected()
        == 1
        || sqlx::query!(
            "UPDATE job_runs SET status = 'RUNNING', started_at = ?, finished_at = NULL, error = NULL \
             WHERE job = ? AND run_key = ? AND (status = 'FAILED' OR (status = 'RUNNING' AND started_at < ?))",
            at,
            job,
            key,
            (now - STALE_RUN).naive_utc()
        )
        .execute(db)
        .await?
        .rows_affected()
            == 1;
    if !claimed {
        return Ok(false);
    }
    match work.await {
        Ok(result) => {
            sqlx::query!(
                "UPDATE job_runs SET status = 'DONE', result = ?, finished_at = ? WHERE job = ? AND run_key = ?",
                result.to_string(),
                at,
                job,
                key
            )
            .execute(db)
            .await?;
            Ok(true)
        }
        Err(e) => {
            let error: String = format!("{e:?}").chars().take(2000).collect();
            sqlx::query!(
                "UPDATE job_runs SET status = 'FAILED', error = ?, finished_at = ? WHERE job = ? AND run_key = ?",
                error,
                at,
                job,
                key
            )
            .execute(db)
            .await?;
            Err(e)
        }
    }
}

/// Runs every job that is due at `now`, in order. A failed job is logged and the others still run.
pub async fn run_due(state: &AppState, now: DateTime<Utc>) -> Result<(), AppError> {
    let rules = Rules::active(&state.db).await?;
    let db = &state.db;
    let offset = state.cfg.business_utc_offset_minutes;
    let today = policy::business_today(now, offset).to_string();
    let logged = |job: &str, outcome: Result<bool, AppError>| {
        if let Err(cause) = outcome {
            tracing::error!(job, ?cause, "job failed; the next tick tries again");
        }
    };

    logged(
        "season-open",
        once(db, "season-open", &today, now, seasons::open_due(db, now)).await,
    );
    let week = engine::last_closable_week(now, rules.week_grace_hours, offset);
    let key = policy::business_today(week, offset).to_string();
    let work = weekly::close_week(state, &rules, week);
    logged(
        "weekly-close",
        once(db, "weekly-close", &key, now, work).await,
    );
    let week_closed = sqlx::query_scalar!(
        "SELECT EXISTS (SELECT 1 FROM job_runs WHERE job = 'weekly-close' AND run_key = ? AND status = 'DONE')",
        key
    )
    .fetch_one(db)
    .await?
        != 0;
    let ended = sqlx::query!(
        r#"SELECT id AS "id: Uuid", ends_at FROM seasons WHERE status = 'ACTIVE' AND ends_at <= ?"#,
        now.naive_utc()
    )
    .fetch_all(db)
    .await?;
    for season in ended {
        // The week holding the season's last instant is paid into it first, so it counts in the
        // standings (the old API closed at ends_at + 24 h and lost that week).
        let last = policy::week_start(season.ends_at.and_utc() - Duration::microseconds(1), offset);
        if last > week || (last == week && !week_closed) {
            continue;
        }
        let work = seasons::close(state, &rules, season.id, now);
        logged(
            "season-close",
            once(db, "season-close", &season.id.to_string(), now, work).await,
        );
    }
    let work = finalize_calibrations(db, now);
    logged(
        "calibration-finalize",
        once(db, "calibration-finalize", &today, now, work).await,
    );
    let work = badge_sweep(db, now);
    logged(
        "badge-sweep",
        once(db, "badge-sweep", &today, now, work).await,
    );
    let work = boards::snapshot(db, now, offset);
    logged(
        "leaderboard-snapshot",
        once(db, "leaderboard-snapshot", &today, now, work).await,
    );
    let work = reconcile(db, &rules);
    logged(
        "balance-reconcile",
        once(db, "balance-reconcile", &today, now, work).await,
    );
    Ok(())
}

/// Baselines built during a calibration that has ended become final: the better of the declared and
/// the calibrated value (docs §9.2).
async fn finalize_calibrations(db: &MySqlPool, now: DateTime<Utc>) -> Result<Value, AppError> {
    let finalized = sqlx::query!(
        "UPDATE baselines b JOIN profiles p ON p.user_id = b.user_id JOIN metric_types m ON m.id = b.metric_type_id \
         SET b.status = 'FINAL', b.finalized_at = p.calibration_ends_at, \
             b.effective_value = IF(m.direction = 'HIGHER_IS_BETTER', \
               GREATEST(b.calibrated_value, COALESCE(b.declared_value, b.calibrated_value)), \
               LEAST(b.calibrated_value, COALESCE(b.declared_value, b.calibrated_value))) \
         WHERE b.status = 'PROVISIONAL' AND b.calibrated_value IS NOT NULL AND p.calibration_ends_at <= ?",
        now.naive_utc()
    )
    .execute(db)
    .await?
    .rows_affected();
    Ok(json!({"finalized": finalized}))
}

/// The badges the closes can unlock (division, weekly streak), those a late log missed, and the
/// friend badges: every athlete with points, a closed week or a new friend in the last 26 hours.
async fn badge_sweep(db: &MySqlPool, now: DateTime<Utc>) -> Result<Value, AppError> {
    let since = (now - Duration::hours(26)).naive_utc();
    let athletes = sqlx::query_scalar!(
        r#"SELECT user_id AS "user: Uuid" FROM xp_transactions WHERE created_at >= ?
           UNION SELECT user_id FROM league_point_transactions WHERE created_at >= ?
           UNION SELECT user_id FROM weekly_scores WHERE updated_at >= ?
           UNION SELECT user_low_id FROM friendships WHERE status = 'ACCEPTED' AND updated_at >= ?
           UNION SELECT user_high_id FROM friendships WHERE status = 'ACCEPTED' AND updated_at >= ?"#,
        since,
        since,
        since,
        since,
        since
    )
    .fetch_all(db)
    .await?;
    for user in &athletes {
        let mut tx = db.begin().await?;
        badges::evaluate(&mut tx, *user, None).await?;
        tx.commit().await?;
    }
    Ok(json!({"users": athletes.len()}))
}

/// The balances in `user_stats` against the ledgers: any drift is repaired and logged.
async fn reconcile(db: &MySqlPool, rules: &Rules) -> Result<Value, AppError> {
    let drifted = sqlx::query_scalar!(
        r#"SELECT us.user_id AS "user: Uuid" FROM user_stats us
           WHERE us.xp_total <> COALESCE((SELECT SUM(x.amount) FROM xp_transactions x WHERE x.user_id = us.user_id), 0)
              OR us.season_lp <> GREATEST(0, COALESCE((SELECT SUM(l.amount) FROM league_point_transactions l
                                                       WHERE l.user_id = us.user_id AND l.season_id = us.current_season_id), 0))"#
    )
    .fetch_all(db)
    .await?;
    for user in &drifted {
        let mut tx = db.begin().await?;
        // Locked like every ledger writer, so a workout being scored cannot slip in between.
        let sums = sqlx::query!(
            r#"SELECT CAST(COALESCE((SELECT SUM(x.amount) FROM xp_transactions x WHERE x.user_id = us.user_id), 0) AS SIGNED) AS "xp!: i64",
                      CAST(COALESCE((SELECT SUM(l.amount) FROM league_point_transactions l
                                     WHERE l.user_id = us.user_id AND l.season_id = us.current_season_id), 0) AS SIGNED) AS "lp!: i64"
               FROM user_stats us WHERE us.user_id = ? FOR UPDATE"#,
            user
        )
        .fetch_one(&mut *tx)
        .await?;
        let level = crate::modules::scoring::engine::level_from_xp(sums.xp, rules);
        let lp = sums.lp.max(0);
        sqlx::query!(
            "UPDATE user_stats SET xp_total = ?, level = ?, xp_into_level = ?, xp_for_next_level = ?, \
               season_lp = ?, division_code = ? WHERE user_id = ?",
            sums.xp,
            level.level,
            level.into,
            level.next,
            lp,
            engine::division_for(lp, &rules.division_thresholds).as_str(),
            user
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        tracing::warn!(user_id = %user, "balance drift repaired");
    }
    Ok(json!({"repaired": drifted.len()}))
}
