//! Background jobs on a Redis Stream.
//!
//! The API adds a job. A worker reads it through a consumer group, runs it and acknowledges it. A
//! job that fails goes to a waiting list and comes back after a growing delay; after its fifth
//! failure it is moved to the dead-letter stream. A job whose worker died is taken over by another
//! worker. Delivery is at-least-once: a job must be safe to run twice.
//!
//! A job carries a kind and a user id, nothing else. No secret is ever written to Redis.

use std::sync::LazyLock;

use redis::streams::{StreamAutoClaimReply, StreamId, StreamReadReply};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, state::AppState};

pub const MAX_ATTEMPTS: u32 = 5;
const GROUP: &str = "workers";
/// A job delivered this long ago and still not acknowledged belongs to a worker that died.
const CLAIM_AFTER_MS: u64 = 60_000;
/// How long an idle worker waits for a job. Shorter than the second the connection gives Redis to answer.
const BLOCK_MS: u64 = 500;
const BATCH: usize = 10;
/// A safety valve when no worker runs: the oldest jobs are dropped beyond this many.
const STREAM_CAPACITY: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JobKind {
    EmailVerify,
    PasswordReset,
    AccountLocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub kind: JobKind,
    pub user_id: Uuid,
    pub attempt: u32,
}

/// Seconds to wait before running a job again after its `attempt`-th failure: 30 s, 1 min, 2 min,
/// 4 min. `None` after the fifth failure: the job is abandoned.
pub fn retry_delay_s(attempt: u32) -> Option<u64> {
    (1..MAX_ATTEMPTS)
        .contains(&attempt)
        .then(|| 30u64 << (attempt - 1))
}

struct Keys {
    stream: String,
    waiting: String,
    dead: String,
}

fn keys(state: &AppState) -> Keys {
    let prefix = &state.redis_prefix;
    Keys {
        stream: format!("{prefix}jobs"),
        waiting: format!("{prefix}jobs:waiting"),
        dead: format!("{prefix}jobs:dead"),
    }
}

pub async fn enqueue(state: &AppState, kind: JobKind, user_id: Uuid) -> Result<(), AppError> {
    let job = Job {
        kind,
        user_id,
        attempt: 1,
    };
    let job = serde_json::to_string(&job).map_err(AppError::internal)?;
    let mut redis = state.redis.clone();
    let _: String = redis::cmd("XADD")
        .arg(keys(state).stream)
        .arg("MAXLEN")
        .arg("~")
        .arg(STREAM_CAPACITY)
        .arg("*")
        .arg("job")
        .arg(job)
        .query_async(&mut redis)
        .await?;
    Ok(())
}

/// Moves the waiting jobs that are due back to the stream. One script, so two workers never move
/// the same job. KEYS: waiting list, stream. ARGV: now, in milliseconds.
static REQUEUE: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r"
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 50)
for _, job in ipairs(due) do
  redis.call('XADD', KEYS[2], '*', 'job', job)
  redis.call('ZREM', KEYS[1], job)
end
return #due
",
    )
});

pub struct Worker {
    state: AppState,
    /// The name of this worker in the consumer group. Unique per process.
    consumer: String,
    claim_after_ms: u64,
}

impl Worker {
    pub fn new(state: AppState, consumer: &str) -> Self {
        Self {
            state,
            consumer: consumer.to_owned(),
            claim_after_ms: CLAIM_AFTER_MS,
        }
    }

    /// How long a job must have been left alone before this worker takes it over from another.
    pub fn claim_after_ms(mut self, ms: u64) -> Self {
        self.claim_after_ms = ms;
        self
    }

    /// Runs the jobs that are ready (those due again, those left by a dead worker, the new ones)
    /// and returns how many it ran. `now_ms` is the clock; with `block` an idle worker waits half a
    /// second for a job instead of returning at once.
    pub async fn tick(
        &self,
        now_ms: u64,
        block: bool,
        handler: impl AsyncFn(Job) -> Result<(), String>,
    ) -> Result<usize, String> {
        let text = |e: redis::RedisError| e.to_string();
        let keys = keys(&self.state);
        let mut redis = self.state.redis.clone();

        // The group exists after the first call; creating it again is refused with BUSYGROUP.
        let created: redis::RedisResult<String> = redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(&keys.stream)
            .arg(GROUP)
            .arg("0")
            .arg("MKSTREAM")
            .query_async(&mut redis)
            .await;
        if let Err(e) = created
            && e.code() != Some("BUSYGROUP")
        {
            return Err(text(e));
        }

        let _: i64 = REQUEUE
            .key(&keys.waiting)
            .key(&keys.stream)
            .arg(now_ms)
            .invoke_async(&mut redis)
            .await
            .map_err(text)?;

        let abandoned: StreamAutoClaimReply = redis::cmd("XAUTOCLAIM")
            .arg(&keys.stream)
            .arg(GROUP)
            .arg(&self.consumer)
            .arg(self.claim_after_ms)
            .arg("0")
            .arg("COUNT")
            .arg(BATCH)
            .query_async(&mut redis)
            .await
            .map_err(text)?;
        let mut entries: Vec<StreamId> = abandoned.claimed;

        let mut read = redis::cmd("XREADGROUP");
        read.arg("GROUP")
            .arg(GROUP)
            .arg(&self.consumer)
            .arg("COUNT")
            .arg(BATCH);
        if block && entries.is_empty() {
            read.arg("BLOCK").arg(BLOCK_MS);
        }
        read.arg("STREAMS").arg(&keys.stream).arg(">");
        // Nothing to read is a nil answer.
        let fresh: Option<StreamReadReply> = read.query_async(&mut redis).await.map_err(text)?;
        entries.extend(
            fresh
                .into_iter()
                .flat_map(|reply| reply.keys)
                .flat_map(|key| key.ids),
        );

        for entry in &entries {
            let raw: String = entry.get("job").unwrap_or_default();
            let job = serde_json::from_str::<Job>(&raw).ok();
            let outcome = match job.clone() {
                Some(job) => handler(job).await,
                None => Err("not a job this version knows".to_owned()),
            };
            // What follows the run and the acknowledgement go together or not at all.
            let mut done = redis::pipe();
            done.atomic();
            if let Err(cause) = outcome {
                let again =
                    job.and_then(|job| retry_delay_s(job.attempt).map(|delay| (job, delay)));
                match again {
                    Some((job, delay_s)) => {
                        tracing::warn!(kind = ?job.kind, attempt = job.attempt, cause = %cause, "job failed; it will run again");
                        let next = Job {
                            attempt: job.attempt + 1,
                            ..job
                        };
                        let next = serde_json::to_string(&next).map_err(|e| e.to_string())?;
                        done.cmd("ZADD")
                            .arg(&keys.waiting)
                            .arg(now_ms + delay_s * 1000)
                            .arg(next);
                    }
                    None => {
                        tracing::error!(cause = %cause, "job abandoned");
                        done.cmd("XADD")
                            .arg(&keys.dead)
                            .arg("*")
                            .arg("job")
                            .arg(&raw)
                            .arg("cause")
                            .arg(&cause);
                    }
                }
            }
            done.cmd("XACK")
                .arg(&keys.stream)
                .arg(GROUP)
                .arg(&entry.id)
                .cmd("XDEL")
                .arg(&keys.stream)
                .arg(&entry.id);
            let _: () = done.query_async(&mut redis).await.map_err(text)?;
        }
        Ok(entries.len())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use serde_json::json;

    use super::*;

    #[test]
    fn the_delay_doubles_and_the_fifth_failure_is_the_last() {
        assert_eq!(
            [1, 2, 3, 4].map(retry_delay_s),
            [Some(30), Some(60), Some(120), Some(240)]
        );
        assert_eq!([0, 5, 6, u32::MAX].map(retry_delay_s), [None; 4]);
    }

    #[test]
    fn a_job_carries_a_kind_a_user_and_nothing_else() {
        let job = Job {
            kind: JobKind::PasswordReset,
            user_id: Uuid::nil(),
            attempt: 1,
        };
        assert_eq!(
            serde_json::to_value(&job).unwrap(),
            json!({"kind": "PASSWORD_RESET", "userId": "00000000-0000-0000-0000-000000000000", "attempt": 1})
        );
    }
}
