#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use std::{sync::Mutex, time::Duration};

use backend::jobs::{self, Job, JobKind, Worker};
use common::TestApp;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use uuid::Uuid;

/// The clock is an argument of `tick`, so a test moves time without waiting.
const T0: u64 = 1_800_000_000_000;

async fn size(app: &TestApp, command: &str, suffix: &str) -> i64 {
    let mut redis = app.state.redis.clone();
    redis::cmd(command)
        .arg(format!("{}jobs{suffix}", app.state.redis_prefix))
        .query_async(&mut redis)
        .await
        .unwrap()
}

#[sqlx::test]
async fn a_job_runs_once_and_leaves_nothing_behind(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = TestApp::new(opts, conn).await;
    let user = Uuid::now_v7();
    jobs::enqueue(&app.state, JobKind::EmailVerify, user)
        .await
        .unwrap();

    let worker = Worker::new(app.state.clone(), "w1");
    let seen = Mutex::new(Vec::new());
    let ran = worker
        .tick(T0, false, async |job: Job| {
            seen.lock().unwrap().push(job);
            Ok(())
        })
        .await
        .unwrap();

    assert_eq!(ran, 1);
    assert_eq!(
        *seen.lock().unwrap(),
        [Job {
            kind: JobKind::EmailVerify,
            user_id: user,
            attempt: 1
        }]
    );
    assert_eq!(worker.tick(T0, false, async |_| Ok(())).await.unwrap(), 0);
    assert_eq!(size(&app, "XLEN", "").await, 0);
}

#[sqlx::test]
async fn a_failing_job_comes_back_later_and_is_abandoned_after_the_fifth_failure(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = TestApp::new(opts, conn).await;
    jobs::enqueue(&app.state, JobKind::AccountLocked, Uuid::now_v7())
        .await
        .unwrap();
    let worker = Worker::new(app.state.clone(), "w1");
    let attempts = Mutex::new(Vec::new());
    let fail = async |job: Job| {
        attempts.lock().unwrap().push(job.attempt);
        Err("smtp: refused with 451".to_owned())
    };

    let mut now = T0;
    assert_eq!(worker.tick(now, false, &fail).await.unwrap(), 1);
    for delay_s in [30, 60, 120, 240] {
        // One second before it is due, nothing runs.
        let early = now + (delay_s - 1) * 1000;
        assert_eq!(worker.tick(early, false, &fail).await.unwrap(), 0);
        now += delay_s * 1000;
        assert_eq!(worker.tick(now, false, &fail).await.unwrap(), 1);
    }

    assert_eq!(*attempts.lock().unwrap(), [1, 2, 3, 4, 5]);
    // Abandoned: nothing waits, nothing is left to run, and the dead-letter stream holds it.
    assert_eq!(
        worker.tick(now + 86_400_000, false, &fail).await.unwrap(),
        0
    );
    assert_eq!(size(&app, "ZCARD", ":waiting").await, 0);
    assert_eq!(size(&app, "XLEN", ":dead").await, 1);
    assert_eq!(size(&app, "XLEN", "").await, 0);
}

#[sqlx::test]
async fn a_job_left_by_a_dead_worker_is_run_by_another(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = TestApp::new(opts, conn).await;
    let user = Uuid::now_v7();
    jobs::enqueue(&app.state, JobKind::PasswordReset, user)
        .await
        .unwrap();

    // A worker takes the job and dies before finishing it.
    let dying = Worker::new(app.state.clone(), "w1");
    let never = dying.tick(T0, false, async |_| {
        std::future::pending::<()>().await;
        Ok(())
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(500), never)
            .await
            .is_err(),
        "the handler never returns"
    );

    // To another worker it is not a new job…
    let other = Worker::new(app.state.clone(), "w2");
    assert_eq!(other.tick(T0, false, async |_| Ok(())).await.unwrap(), 0);
    // …but it takes it over once the job has been left alone long enough (at once, in this test).
    let ran = other
        .claim_after_ms(0)
        .tick(T0, false, async |job: Job| {
            assert_eq!(job.user_id, user);
            Ok(())
        })
        .await
        .unwrap();
    assert_eq!(ran, 1);
    assert_eq!(size(&app, "XLEN", "").await, 0);
}

#[sqlx::test]
async fn an_entry_that_is_not_a_job_goes_straight_to_the_dead_letters(
    opts: MySqlPoolOptions,
    conn: MySqlConnectOptions,
) {
    let app = TestApp::new(opts, conn).await;
    let mut redis = app.state.redis.clone();
    let _: String = redis::cmd("XADD")
        .arg(format!("{}jobs", app.state.redis_prefix))
        .arg("*")
        .arg("job")
        .arg(r#"{"kind":"FROM_A_NEWER_VERSION","userId":"x","attempt":1}"#)
        .query_async(&mut redis)
        .await
        .unwrap();

    let worker = Worker::new(app.state.clone(), "w1");
    let ran = worker
        .tick(T0, false, async |_| panic!("the handler must not see it"))
        .await
        .unwrap();
    assert_eq!(ran, 1);
    assert_eq!(size(&app, "XLEN", ":dead").await, 1);
    assert_eq!(size(&app, "XLEN", "").await, 0);
}
