#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The league as the app and the worker see it: the weekly score, the weekly close, seasons and jobs.
mod common;

use axum::http::{Method, StatusCode};
use backend::{
    modules::{
        league::{jobs, seasons, weekly},
        scoring::ledger::{self, LpEntry},
    },
    rules::Rules,
    security::policy,
    types::iso,
};
use chrono::{DateTime, Duration, Utc};
use common::{TestApp, assert_same_shape, calibrated, seeded, workouts::*};
use serde_json::{Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

const OFFSET: i32 = 60;

fn recorded(key: &str) -> Value {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../mobile-rn/assets/demo/api.json");
    let all: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    all[key].clone()
}

/// A moment of the current week, at least 2 hours ago when the week allows it.
fn this_week() -> DateTime<Utc> {
    let start = policy::week_start(Utc::now(), OFFSET);
    (Utc::now() - Duration::hours(2)).max(start + Duration::minutes(1))
}

async fn logged(app: &TestApp, token: &str, body: &Value) -> Value {
    let reply = post(app, token, body).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    reply.json
}

async fn league_athlete(app: &TestApp, name: &str) -> (Uuid, String) {
    let (user, token) = athlete(app, name).await;
    calibrated(app, user).await;
    (user, token)
}

/// A final squat `E1RM` baseline at `kg`, at the intermediate level.
async fn final_baseline(app: &TestApp, user: Uuid, kg: f64) {
    sqlx::query(
        "INSERT INTO baselines (id, user_id, exercise_id, metric_type_id, calibrated_value, effective_value, status, \
           experience_level, logs_counted, finalized_at) \
         SELECT ?, ?, e.id, m.id, ?, ?, 'FINAL', 'INTERMEDIATE', 2, UTC_TIMESTAMP(6) - INTERVAL 20 DAY \
         FROM exercises e, metric_types m WHERE e.code = 'BACK_SQUAT' AND m.code = 'E1RM'",
    )
    .bind(Uuid::now_v7())
    .bind(user)
    .bind(kg)
    .bind(kg)
    .execute(&app.db)
    .await
    .unwrap();
}

async fn current_week(app: &TestApp, token: &str) -> Value {
    let reply = get(app, token, "/api/v1/me/weekly-scores/current").await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    reply.json
}

async fn score_of(app: &TestApp, user: Uuid, week: DateTime<Utc>) -> weekly::WeeklyScore {
    let rules = Rules::active(&app.db).await.unwrap();
    let mut conn = app.db.acquire().await.unwrap();
    weekly::compute(&mut conn, &rules, user, week, OFFSET)
        .await
        .unwrap()
}

#[sqlx::test]
async fn the_running_week_is_provisional(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = league_athlete(&app, "provisional").await;
    logged(&app, &token, &strength(&c, Uuid::now_v7(), this_week())).await;

    let week = current_week(&app, &token).await;
    let start = policy::week_start(Utc::now(), OFFSET);
    assert_eq!(week["weekStart"], iso(start.naive_utc()));
    assert_eq!(week["status"], "PROVISIONAL");
    assert_eq!(week["trainingDays"], 1);
    assert_eq!(week["plannedDays"], 3);
    assert_eq!(week["components"]["consistency"], 33.33);
    assert!(week["components"]["challenge"].is_null());
    assert_eq!(week["eligible"], true);
    assert_eq!(
        week["projectedLp"].as_i64().unwrap(),
        week["total"].as_f64().unwrap().round() as i64
    );
    assert_eq!(week["breakdown"]["formula"], "weekly_score");
    assert_eq!(week["breakdown"]["topN"], 3);
    assert_eq!(week["breakdown"]["weights"]["progress"], 0.4);
    assert_same_shape("week", &recorded("GET /me/weekly-scores/current"), &week);
}

#[sqlx::test]
async fn a_calibrating_athlete_projects_no_lp(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (_, token) = athlete(&app, "calibrating").await;
    logged(&app, &token, &strength(&c, Uuid::now_v7(), this_week())).await;
    let week = current_week(&app, &token).await;
    assert_eq!(week["eligible"], false);
    assert_eq!(week["projectedLp"], 0);
}

#[sqlx::test]
async fn a_late_log_counts_for_nothing(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = league_athlete(&app, "late").await;
    final_baseline(&app, user, 112.5).await;
    let at = Utc::now() - Duration::hours(80);
    logged(&app, &token, &strength(&c, Uuid::now_v7(), at)).await;
    let score = score_of(&app, user, policy::week_start(at, OFFSET)).await;
    assert_eq!(score.training_days, 0);
    assert_eq!(score.breakdown["metrics"].as_array().unwrap().len(), 0);
}

#[sqlx::test]
async fn progress_is_measured_against_the_expected_rate(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = league_athlete(&app, "progress").await;
    final_baseline(&app, user, 112.5).await;
    logged(&app, &token, &strength(&c, Uuid::now_v7(), this_week())).await;

    let week = current_week(&app, &token).await;
    let metrics = week["breakdown"]["metrics"].as_array().unwrap();
    assert_eq!(metrics.len(), 1, "{week}");
    let m = &metrics[0];
    assert_eq!(m["exerciseId"], c.squat.to_string());
    assert_eq!(m["metric"], "E1RM");
    assert_eq!(m["reference"], 112.5);
    assert_eq!(m["current"], 116.67);
    // (116.67 − 112.5) / 112.5 = 3.707 %, against 3 % expected.
    assert_eq!(m["ratio"], 1.236);
    assert_eq!(m["progressScore"], 82.4);
    assert_eq!(m["cappedForPlausibility"], false);
    assert_eq!(m["weekBest"], 116.67);
    assert_eq!(m["performanceRatio"], 1.0);
    assert_eq!(week["components"]["progress"], 82.37);
    assert_eq!(week["components"]["performance"], 100.0);
}

/// The active season's start moved 90 days back, so every week a test closes lies in it.
async fn stretch_season(app: &TestApp) -> Uuid {
    sqlx::query(
        "UPDATE seasons SET starts_at = starts_at - INTERVAL 90 DAY WHERE status = 'ACTIVE'",
    )
    .execute(&app.db)
    .await
    .unwrap();
    sqlx::query_scalar("SELECT id FROM seasons WHERE status = 'ACTIVE'")
        .fetch_one(&app.db)
        .await
        .unwrap()
}

async fn close(app: &TestApp, week: DateTime<Utc>) {
    let rules = Rules::active(&app.db).await.unwrap();
    weekly::close_week(&app.state, &rules, week).await.unwrap();
}

/// The local date of the week's Monday: the week's LP source id.
fn monday(week: DateTime<Utc>) -> String {
    policy::business_today(week, OFFSET).to_string()
}

type LpRow = (Uuid, i32, String, String, Option<Uuid>);

/// `(id, amount, reason, source_id, reverses_id)` of the athlete's LP entries, oldest first.
async fn lp_entries(app: &TestApp, user: Uuid) -> Vec<LpRow> {
    sqlx::query_as(
        "SELECT id, amount, reason, source_id, reverses_id FROM league_point_transactions \
         WHERE user_id = ? ORDER BY created_at, id",
    )
    .bind(user)
    .fetch_all(&app.db)
    .await
    .unwrap()
}

/// `(season_lp, current_season_id, division_code)`.
async fn stats(app: &TestApp, user: Uuid) -> (i32, Option<Uuid>, Option<String>) {
    sqlx::query_as(
        "SELECT season_lp, current_season_id, division_code FROM user_stats WHERE user_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap()
}

#[sqlx::test]
async fn closing_a_week_pays_its_lp_once(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let season = stretch_season(&app).await;
    let c = catalog(&app).await;
    let (user, token) = league_athlete(&app, "weekly").await;
    sqlx::query("UPDATE profiles SET planned_training_days_per_week = 1 WHERE user_id = ?")
        .bind(user)
        .execute(&app.db)
        .await
        .unwrap();
    let at = this_week();
    logged(&app, &token, &strength(&c, Uuid::now_v7(), at)).await;
    let week = policy::week_start(at, OFFSET);
    let expected = score_of(&app, user, week).await;
    assert!(expected.lp > 0);

    close(&app, week).await;
    close(&app, week).await;

    let entries = lp_entries(&app, user).await;
    assert_eq!(entries.len(), 1, "{entries:?}");
    let (id, amount, reason, source, _) = &entries[0];
    assert_eq!(
        (reason.as_str(), source.as_str()),
        ("WEEKLY_SCORE", monday(week).as_str())
    );
    assert_eq!(i64::from(*amount), expected.lp);
    let (effective, explanation): (chrono::NaiveDateTime, String) = sqlx::query_as(
        "SELECT effective_at, explanation FROM league_point_transactions WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(effective, (week + Duration::days(7)).naive_utc());
    let explanation: Value = serde_json::from_str(&explanation).unwrap();
    assert_eq!(explanation["total"], expected.total);
    assert_eq!(explanation["components"]["consistency"], 100.0);
    let (total, paid): (f64, Option<Uuid>) = sqlx::query_as(
        "SELECT CAST(total AS DOUBLE), lp_transaction_id FROM weekly_scores WHERE user_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!((total, paid), (expected.total, Some(*id)));
    assert_eq!(
        stats(&app, user).await,
        (*amount, Some(season), Some("BRONZE".to_owned()))
    );
    let streak: (i32, i32) =
        sqlx::query_as("SELECT current_weeks, longest_weeks FROM user_streaks WHERE user_id = ?")
            .bind(user)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(streak, (1, 1));
    let me = get(&app, &token, "/api/v1/me").await;
    assert_eq!(me.json["stats"]["seasonLp"], *amount);
}

#[sqlx::test]
async fn a_week_without_a_season_pays_nothing(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let c = catalog(&app).await;
    let (user, token) = league_athlete(&app, "seasonless").await;
    let at = this_week();
    logged(&app, &token, &strength(&c, Uuid::now_v7(), at)).await;
    sqlx::query(
        "UPDATE seasons SET starts_at = starts_at + INTERVAL 2 YEAR, ends_at = ends_at + INTERVAL 2 YEAR",
    )
    .execute(&app.db)
    .await
    .unwrap();
    close(&app, policy::week_start(at, OFFSET)).await;
    let season: Option<Option<Uuid>> =
        sqlx::query_scalar("SELECT season_id FROM weekly_scores WHERE user_id = ?")
            .bind(user)
            .fetch_optional(&app.db)
            .await
            .unwrap();
    assert_eq!(season, Some(None));
    assert!(lp_entries(&app, user).await.is_empty());
    assert_eq!(stats(&app, user).await.0, 0);
}

#[sqlx::test]
async fn a_habit_goal_counts_its_weeks(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    stretch_season(&app).await;
    let c = catalog(&app).await;
    let (keen, keen_token) = league_athlete(&app, "keen").await;
    let (_, idle_token) = league_athlete(&app, "idle").await;
    for token in [&keen_token, &idle_token] {
        let body = json!({"type": "HABIT", "metricCode": "WORKOUTS_PER_WEEK", "targetValue": 1});
        let reply = app
            .call(Method::POST, "/api/v1/goals", Some(token), Some(body))
            .await;
        assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    }
    sqlx::query("UPDATE goals SET habit_weeks_met = 1")
        .execute(&app.db)
        .await
        .unwrap();
    let at = this_week();
    logged(&app, &keen_token, &strength(&c, Uuid::now_v7(), at)).await;

    close(&app, policy::week_start(at, OFFSET)).await;

    let goal = |token: String| {
        let app = &app;
        async move { get(app, &token, "/api/v1/goals").await.json[0].clone() }
    };
    let kept = goal(keen_token.clone()).await;
    assert_eq!(kept["habitWeeksMet"], 2, "{kept}");
    assert!(kept["milestones"][0]["reachedAt"].is_string(), "{kept}");
    let milestones: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM xp_transactions WHERE user_id = ? AND reason = 'GOAL_MILESTONE'",
    )
    .bind(keen)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(milestones, 1);
    assert_eq!(goal(idle_token).await["habitWeeksMet"], 0);
}

#[sqlx::test]
async fn a_corrected_baseline_rescores_the_paid_weeks(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    stretch_season(&app).await;
    let c = catalog(&app).await;
    let (user, token) = league_athlete(&app, "nour").await;
    let first = logged(&app, &token, &strength(&c, Uuid::now_v7(), this_week())).await;
    let first = Uuid::parse_str(first["id"].as_str().unwrap()).unwrap();
    // Eight days back: an earlier week.
    for sql in [
        "UPDATE workouts SET performed_at = performed_at - INTERVAL 8 DAY WHERE id = ?",
        "UPDATE metric_observations SET observed_at = observed_at - INTERVAL 8 DAY WHERE workout_id = ?",
    ] {
        sqlx::query(sql).bind(first).execute(&app.db).await.unwrap();
    }
    let first_at: chrono::NaiveDateTime =
        sqlx::query_scalar("SELECT performed_at FROM workouts WHERE id = ?")
            .bind(first)
            .fetch_one(&app.db)
            .await
            .unwrap();
    // The baseline became final at 50 just after that workout, so its own close audits nothing.
    sqlx::query(
        "UPDATE baselines b JOIN metric_types m ON m.id = b.metric_type_id \
         SET b.status = 'FINAL', b.effective_value = 50, b.experience_level = 'INTERMEDIATE', \
           b.finalized_at = ? + INTERVAL 1 MINUTE \
         WHERE b.user_id = ? AND m.code = 'E1RM'",
    )
    .bind(first_at)
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
    let paid_week = policy::week_start(first_at.and_utc(), OFFSET);
    close(&app, paid_week).await;
    let paid = lp_entries(&app, user).await;
    assert_eq!(paid.len(), 1, "{paid:?}");
    let (original, original_amount) = (paid[0].0, paid[0].1);

    let at = this_week();
    logged(&app, &token, &lifting(&c, Uuid::now_v7(), at, 105.0, 5)).await;
    close(&app, policy::week_start(at, OFFSET)).await;

    let corrected: (String, Option<f64>, Option<i32>) = sqlx::query_as(
        "SELECT b.status, CAST(b.corrected_from AS DOUBLE), b.rule_set_version FROM baselines b \
         JOIN metric_types m ON m.id = b.metric_type_id WHERE b.user_id = ? AND m.code = 'E1RM'",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(corrected, ("CORRECTED".to_owned(), Some(50.0), Some(2)));
    let entries = lp_entries(&app, user).await;
    assert!(
        entries
            .iter()
            .any(|e| e.2 == "REVERSAL" && e.4 == Some(original)),
        "{entries:?}"
    );
    let again = entries
        .iter()
        .find(|e| e.2 == "WEEKLY_SCORE" && e.3.starts_with(&format!("{}#c", monday(paid_week))))
        .expect("a corrected entry");
    assert!(again.1 < original_amount, "{entries:?}");
    let points_at: Option<Uuid> = sqlx::query_scalar(
        "SELECT lp_transaction_id FROM weekly_scores WHERE user_id = ? AND week_start = ?",
    )
    .bind(user)
    .bind(monday(paid_week))
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(points_at, Some(again.0));
    let sum: i32 = entries.iter().map(|e| e.1).sum();
    assert_eq!(stats(&app, user).await.0, sum);
}

/// Puts the athlete in `season` with `lp` and its division, straight in SQL.
async fn in_season(app: &TestApp, user: Uuid, season: Uuid, lp: i64) {
    let rules = Rules::active(&app.db).await.unwrap();
    let division = backend::modules::league::engine::division_for(lp, &rules.division_thresholds);
    sqlx::query(
        "UPDATE user_stats SET current_season_id = ?, season_lp = ?, division_code = ? WHERE user_id = ?",
    )
    .bind(season)
    .bind(lp)
    .bind(division.as_str())
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
}

async fn my_lp(app: &TestApp, token: &str) -> Value {
    let reply = get(app, token, "/api/v1/me/lp").await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    reply.json
}

#[sqlx::test]
async fn my_lp_in_the_season(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let season = stretch_season(&app).await;
    let (user, token) = league_athlete(&app, "gold").await;
    in_season(&app, user, season, 1240).await;
    let lp = my_lp(&app, &token).await;
    assert_eq!(lp["season"]["id"], season.to_string());
    assert_eq!(lp["season"]["status"], "ACTIVE");
    assert!(
        lp["season"]["name"]
            .as_str()
            .unwrap()
            .starts_with("Season ")
    );
    assert_eq!(lp["lp"], 1240);
    assert_eq!(lp["division"], "GOLD");
    assert_eq!(lp["nextDivision"], "PLATINUM");
    assert_eq!(lp["lpToNextDivision"], 160);
    assert_same_shape("lp", &recorded("GET /me/lp"), &lp);

    let (_, fresh) = league_athlete(&app, "fresh").await;
    let lp = my_lp(&app, &fresh).await;
    assert_eq!(
        (
            &lp["lp"],
            &lp["division"],
            &lp["nextDivision"],
            &lp["lpToNextDivision"]
        ),
        (&json!(0), &json!("BRONZE"), &json!("SILVER"), &json!(400))
    );
}

/// The active season ended two days ago and the scheduled one starts at its end: `(ended, next)`.
async fn season_ended(app: &TestApp) -> (Uuid, Uuid) {
    let ended = stretch_season(app).await;
    sqlx::query("UPDATE seasons SET ends_at = UTC_TIMESTAMP(6) - INTERVAL 2 DAY WHERE id = ?")
        .bind(ended)
        .execute(&app.db)
        .await
        .unwrap();
    // One instant for both, as the seed writes them.
    sqlx::query("UPDATE seasons s JOIN seasons e ON e.id = ? SET s.starts_at = e.ends_at WHERE s.status = 'SCHEDULED'")
        .bind(ended)
        .execute(&app.db)
        .await
        .unwrap();
    let next = sqlx::query_scalar("SELECT id FROM seasons WHERE status = 'SCHEDULED'")
        .fetch_one(&app.db)
        .await
        .unwrap();
    (ended, next)
}

async fn close_season(app: &TestApp, season: Uuid) -> Value {
    let rules = Rules::active(&app.db).await.unwrap();
    seasons::close(&app.state, &rules, season, Utc::now())
        .await
        .unwrap()
}

#[sqlx::test]
async fn closing_a_season_soft_resets_into_the_next(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (ended, next) = season_ended(&app).await;
    let (a, _) = league_athlete(&app, "anis").await;
    let (b, _) = league_athlete(&app, "basma").await;
    let (c, _) = athlete(&app, "chokri").await;
    for (user, lp) in [(a, 1240), (b, 86), (c, 500)] {
        in_season(&app, user, ended, lp).await;
    }

    let closed = close_season(&app, ended).await;
    assert_eq!(closed["standings"], 2, "{closed}");
    assert_eq!(closed["nextSeasonId"], next.to_string());

    let standings: Vec<(Uuid, i32, String, Option<i32>, bool, Option<String>)> = sqlx::query_as(
        "SELECT user_id, final_lp, division, rank_national, is_champion, champion_scope \
         FROM season_standings WHERE season_id = ? ORDER BY rank_national",
    )
    .bind(ended)
    .fetch_all(&app.db)
    .await
    .unwrap();
    assert_eq!(
        standings,
        [
            (
                a,
                1240,
                "GOLD".to_owned(),
                Some(1),
                true,
                Some("NATIONAL".to_owned())
            ),
            (b, 86, "BRONZE".to_owned(), Some(2), false, None),
        ]
    );
    assert_eq!(
        stats(&app, a).await,
        (1070, Some(next), Some("GOLD".to_owned()))
    );
    assert_eq!(stats(&app, b).await.0, 43);
    // 500 is Silver, floor 400: 400 + 100 × 0.5.
    assert_eq!(
        stats(&app, c).await,
        (450, Some(next), Some("SILVER".to_owned()))
    );
    let reset: Vec<(i32, Uuid, chrono::NaiveDateTime)> = sqlx::query_as(
        "SELECT amount, season_id, effective_at FROM league_point_transactions \
         WHERE user_id = ? AND reason = 'SEASON_SOFT_RESET'",
    )
    .bind(a)
    .fetch_all(&app.db)
    .await
    .unwrap();
    let next_start: chrono::NaiveDateTime =
        sqlx::query_scalar("SELECT starts_at FROM seasons WHERE id = ?")
            .bind(next)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(reset, [(1070, next, next_start)]);
    let statuses: Vec<(Uuid, String, bool)> =
        sqlx::query_as("SELECT id, status, closed_at IS NOT NULL FROM seasons ORDER BY starts_at")
            .fetch_all(&app.db)
            .await
            .unwrap();
    assert_eq!(
        statuses,
        [
            (ended, "CLOSED".to_owned(), true),
            (next, "ACTIVE".to_owned(), false)
        ]
    );

    let again = close_season(&app, ended).await;
    assert_eq!(again["standings"], 0);
    assert_eq!(stats(&app, a).await.0, 1070);
}

#[sqlx::test]
async fn an_old_season_entry_moves_nothing(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (ended, _) = season_ended(&app).await;
    let (a, _) = league_athlete(&app, "amel").await;
    let rules = Rules::active(&app.db).await.unwrap();
    let mut tx = app.db.begin().await.unwrap();
    let entry = LpEntry {
        user: a,
        season: ended,
        amount: 1240,
        reason: "WEEKLY_SCORE",
        source_type: "week",
        source_id: "2026-07-06".to_owned(),
        explanation: json!({}),
        effective_at: Utc::now() - Duration::days(30),
    };
    let paid = ledger::append_lp(&mut tx, &rules, entry).await.unwrap();
    tx.commit().await.unwrap();
    close_season(&app, ended).await;
    assert_eq!(stats(&app, a).await.0, 1070);

    let mut tx = app.db.begin().await.unwrap();
    let reversal = ledger::reverse_lp(&mut tx, &rules, a, paid, "test")
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(reversal.is_some());
    assert_eq!(stats(&app, a).await.0, 1070);
}

#[sqlx::test]
async fn a_season_without_a_successor_creates_one(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let (ended, next) = season_ended(&app).await;
    sqlx::query("DELETE FROM seasons WHERE id = ?")
        .bind(next)
        .execute(&app.db)
        .await
        .unwrap();
    let closed = close_season(&app, ended).await;
    let created = Uuid::parse_str(closed["nextSeasonId"].as_str().unwrap()).unwrap();
    let (name, starts_at, status): (String, chrono::NaiveDateTime, String) =
        sqlx::query_as("SELECT name, starts_at, status FROM seasons WHERE id = ?")
            .bind(created)
            .fetch_one(&app.db)
            .await
            .unwrap();
    let ended_at: chrono::NaiveDateTime =
        sqlx::query_scalar("SELECT ends_at FROM seasons WHERE id = ?")
            .bind(ended)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(starts_at, ended_at);
    assert_eq!(status, "ACTIVE");
    let (quarter, _) = policy::quarter_bounds(ended_at.and_utc() + Duration::days(1), OFFSET);
    assert_eq!(name, seasons::name(quarter, OFFSET));
}

#[sqlx::test]
async fn seasons_open_when_due(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (ended, next) = season_ended(&app).await;
    let status = |id: Uuid| {
        let db = app.db.clone();
        async move {
            sqlx::query_scalar::<_, String>("SELECT status FROM seasons WHERE id = ?")
                .bind(id)
                .fetch_one(&db)
                .await
                .unwrap()
        }
    };
    seasons::open_due(&app.db, Utc::now()).await.unwrap();
    assert_eq!(status(next).await, "SCHEDULED");

    sqlx::query("UPDATE seasons SET status = 'CLOSED' WHERE id = ?")
        .bind(ended)
        .execute(&app.db)
        .await
        .unwrap();
    seasons::open_due(&app.db, Utc::now()).await.unwrap();
    assert_eq!(status(next).await, "ACTIVE");
}

async fn job_row(app: &TestApp, job: &str, key: &str) -> (String, Option<String>) {
    sqlx::query_as("SELECT status, result FROM job_runs WHERE job = ? AND run_key = ?")
        .bind(job)
        .bind(key)
        .fetch_one(&app.db)
        .await
        .unwrap()
}

#[sqlx::test]
async fn a_job_runs_once_per_key(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let app = seeded(opts, conn).await;
    let now = Utc::now();
    let runs = AtomicUsize::new(0);
    let work = || async {
        runs.fetch_add(1, Ordering::SeqCst);
        Ok(json!({"n": 1}))
    };
    assert!(
        jobs::once(&app.db, "test", "k1", now, work())
            .await
            .unwrap()
    );
    assert!(
        !jobs::once(&app.db, "test", "k1", now, work())
            .await
            .unwrap()
    );
    assert_eq!(job_row(&app, "test", "k1").await.0, "DONE".to_owned());
    let result: Value =
        serde_json::from_str(&job_row(&app, "test", "k1").await.1.unwrap()).unwrap();
    assert_eq!(result, json!({"n": 1}));

    for (key, status, minutes) in [
        ("dead", "RUNNING", 120),
        ("busy", "RUNNING", 10),
        ("failed", "FAILED", 1),
    ] {
        sqlx::query(
            "INSERT INTO job_runs (id, job, run_key, status, started_at) VALUES (?, 'test', ?, ?, ?)",
        )
        .bind(Uuid::now_v7())
        .bind(key)
        .bind(status)
        .bind((now - Duration::minutes(minutes)).naive_utc())
        .execute(&app.db)
        .await
        .unwrap();
    }
    assert!(
        jobs::once(&app.db, "test", "dead", now, work())
            .await
            .unwrap()
    );
    assert!(
        !jobs::once(&app.db, "test", "busy", now, work())
            .await
            .unwrap()
    );
    assert!(
        jobs::once(&app.db, "test", "failed", now, work())
            .await
            .unwrap()
    );

    let before = runs.load(Ordering::SeqCst);
    let (a, b) = tokio::join!(
        jobs::once(&app.db, "test", "both", now, work()),
        jobs::once(&app.db, "test", "both", now, work())
    );
    assert!(a.unwrap() ^ b.unwrap());
    assert_eq!(runs.load(Ordering::SeqCst), before + 1);
}

#[sqlx::test]
async fn the_worker_closes_the_week_once(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    stretch_season(&app).await;
    let c = catalog(&app).await;
    let (user, token) = league_athlete(&app, "worker").await;
    let at = this_week();
    logged(&app, &token, &strength(&c, Uuid::now_v7(), at)).await;
    let week = policy::week_start(at, OFFSET);
    let later = week + Duration::days(7) + Duration::hours(25);
    jobs::run_due(&app.state, later).await.unwrap();
    jobs::run_due(&app.state, later).await.unwrap();
    let entries = lp_entries(&app, user).await;
    let weekly = entries.iter().filter(|e| e.2 == "WEEKLY_SCORE").count();
    assert_eq!(weekly, 1, "{entries:?}");
    assert_eq!(
        job_row(&app, "weekly-close", &monday(week)).await.0,
        "DONE".to_owned()
    );
}

#[sqlx::test]
async fn calibration_finalizes_on_its_day(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let (user, _) = athlete(&app, "finalist").await;
    sqlx::query(
        "UPDATE profiles SET calibration_started_at = UTC_TIMESTAMP(6) - INTERVAL 15 DAY, \
           calibration_ends_at = UTC_TIMESTAMP(6) - INTERVAL 1 DAY WHERE user_id = ?",
    )
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO baselines (id, user_id, exercise_id, metric_type_id, declared_value, calibrated_value, \
           effective_value, status) \
         SELECT ?, ?, e.id, m.id, 90, 100, 90, 'PROVISIONAL' \
         FROM exercises e, metric_types m WHERE e.code = 'BACK_SQUAT' AND m.code = 'E1RM'",
    )
    .bind(Uuid::now_v7())
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
    jobs::run_due(&app.state, Utc::now()).await.unwrap();
    let (status, effective, on_time): (String, f64, bool) = sqlx::query_as(
        "SELECT b.status, CAST(b.effective_value AS DOUBLE), b.finalized_at = p.calibration_ends_at \
         FROM baselines b JOIN profiles p ON p.user_id = b.user_id WHERE b.user_id = ?",
    )
    .bind(user)
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(
        (status.as_str(), effective, on_time),
        ("FINAL", 100.0, true)
    );
}

#[sqlx::test]
async fn balances_are_reconciled(opts: MySqlPoolOptions, conn: MySqlConnectOptions) {
    let app = seeded(opts, conn).await;
    let season = stretch_season(&app).await;
    let c = catalog(&app).await;
    let (user, token) = league_athlete(&app, "drift").await;
    logged(&app, &token, &strength(&c, Uuid::now_v7(), this_week())).await;
    let rules = Rules::active(&app.db).await.unwrap();
    let mut tx = app.db.begin().await.unwrap();
    let entry = LpEntry {
        user,
        season,
        amount: 450,
        reason: "WEEKLY_SCORE",
        source_type: "week",
        source_id: "2026-01-05".to_owned(),
        explanation: json!({}),
        effective_at: Utc::now(),
    };
    ledger::append_lp(&mut tx, &rules, entry).await.unwrap();
    tx.commit().await.unwrap();
    let before: (i64, i32) =
        sqlx::query_as("SELECT xp_total, level FROM user_stats WHERE user_id = ?")
            .bind(user)
            .fetch_one(&app.db)
            .await
            .unwrap();
    sqlx::query(
        "UPDATE user_stats SET xp_total = 99999, level = 40, season_lp = 5, division_code = 'ELITE' WHERE user_id = ?",
    )
    .bind(user)
    .execute(&app.db)
    .await
    .unwrap();
    jobs::run_due(&app.state, Utc::now()).await.unwrap();
    let after: (i64, i32) =
        sqlx::query_as("SELECT xp_total, level FROM user_stats WHERE user_id = ?")
            .bind(user)
            .fetch_one(&app.db)
            .await
            .unwrap();
    assert_eq!(after, before);
    assert_eq!(
        stats(&app, user).await,
        (450, Some(season), Some("SILVER".to_owned()))
    );
}

#[sqlx::test]
async fn the_sweep_awards_division_and_streak_badges(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = seeded(opts, conn).await;
    let season = stretch_season(&app).await;
    let rules = Rules::active(&app.db).await.unwrap();
    let (gold, gold_token) = league_athlete(&app, "golden").await;
    let mut tx = app.db.begin().await.unwrap();
    let entry = LpEntry {
        user: gold,
        season,
        amount: 900,
        reason: "WEEKLY_SCORE",
        source_type: "week",
        source_id: "2026-01-05".to_owned(),
        explanation: json!({}),
        effective_at: Utc::now(),
    };
    ledger::append_lp(&mut tx, &rules, entry).await.unwrap();
    tx.commit().await.unwrap();

    let (steady, _) = league_athlete(&app, "steady").await;
    let monday = policy::business_today(policy::week_start(Utc::now(), OFFSET), OFFSET);
    for weeks_ago in 1..=4 {
        sqlx::query(
            "INSERT INTO weekly_scores (id, user_id, week_start, rule_set_version, progress_c, consistency_c, \
               performance_c, total, breakdown) VALUES (?, ?, ?, 2, 0, 100, 0, 29.41, '{}')",
        )
        .bind(Uuid::now_v7())
        .bind(steady)
        .bind(monday - Duration::days(7 * weeks_ago))
        .execute(&app.db)
        .await
        .unwrap();
    }

    jobs::run_due(&app.state, Utc::now()).await.unwrap();
    let awarded = |user: Uuid, code: &'static str| {
        let db = app.db.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM user_badges ub JOIN badges b ON b.id = ub.badge_id \
                 WHERE ub.user_id = ? AND b.code = ?",
            )
            .bind(user)
            .bind(code)
            .fetch_one(&db)
            .await
            .unwrap()
        }
    };
    assert_eq!(awarded(gold, "GOLD_DIVISION").await, 1);
    assert_eq!(awarded(steady, "STREAK_4").await, 1);
    let catalogue = get(&app, &gold_token, "/api/v1/badges").await.json;
    let badge = catalogue
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["code"] == "GOLD_DIVISION")
        .unwrap();
    assert_eq!(
        badge["progress"],
        json!({"current": 3, "target": 3, "met": true})
    );
}
