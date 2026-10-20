# Rust backend, plan 2b: points

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Date: 2026-10-19 · Spec: `docs/superpowers/specs/2026-10-18-rust-backend-training-loop-design.md` · Second plan of
part 2, after plan 2a (`docs/superpowers/plans/2026-10-18-rust-backend-2a-workouts-in.md`).

**Goal:** an accepted workout earns its XP in the same transaction that saves it: observations, calibration,
baselines, personal records, the XP ledger with its caps, the level, the daily streak and the first quest. The app
reads them back through `GET /workouts/:id/points`, `/me/records`, `/me/progress` and its metric series, and the
`stats` and `streak` of `GET /me`.

**Architecture:**

- A new module, `modules/scoring`:
  - `engine.rs`: pure rules (XP, caps, level, fairness, observations, daily streak), unit-tested;
  - `records.rs`: observations, baselines and personal records, in the caller's transaction;
  - `ledger.rs`: the only writer of `xp_transactions` and of `user_stats`' XP columns;
  - `mod.rs`: `score()`, which runs the whole chain, and `GET /workouts/{id}/points`;
  - `progress.rs`: `/me/progress`, its metric series, `/me/records`.
- `intake::create` calls `scoring::score` inside its transaction, where plan 2a left the comment.
- One migration, `0007_points.sql`.

**Tech stack:** Axum 0.8 and sqlx 0.9 on MariaDB 11.4, as in plan 2a. No new crate.

**Contract:** the old API's code, as the app calls it.

- **Old API:**
  - `apps/api/src/modules/scoring/`: `workout-scoring.service.ts`, `engine/xp.ts`, `engine/observations.ts`,
    `engine/fairness.ts`, `level.ts`, `expected-progression.service.ts`, `scoring.controller.ts`
    (`workoutPoints`);
  - `apps/api/src/modules/progress/`: `progress.service.ts` (baselines and records),
    `progress-query.service.ts`, `progress.controller.ts`;
  - `apps/api/src/modules/ledger/ledger.service.ts`;
  - the ledger constraints of `apps/api/prisma/migrations/20260925213021_init/migration.sql` (lines 1426 to
    1460).
- **The app's callers:**
  - `apps/mobile-rn/src/features/workouts/api.ts` (`WorkoutPoints`, `explainPoints`) and `screens.tsx`;
  - `features/progress/api.ts` and `screens.tsx` (`ProgressScreen`, `MetricCard`);
  - `features/home/screen.tsx` (`stats`).

**Where it is built:** this Windows checkout, branch `feat/rust-backend-2b`, with the environment line of
`handoff.md` §2.

## Global constraints

Plan 2a's constraints hold unchanged: no `unwrap` or `expect` outside tests and no `unsafe`; `user_id = ?` in every
query on an account's data; database errors through `AppError::from(sqlx::Error)`; request bodies with
`deny_unknown_fields`, field paths, and every wrong field at once; timestamps through `types::iso`; ids from
`Uuid::now_v7()`; no health value in a log, an error or another account's answer; no new public route. And:

- The ledger is append-only, by trigger, as `audit_log` is. Only `scoring/ledger.rs` writes it.
- The same event is never granted twice: a unique index on `(user, reason, source type, source id)` while the
  entry is not a reversal.
- Amounts are integers. A metric value is stored as `DECIMAL(12,3)`; kilograms keep 2 decimals, as in plan 2a.
- The rule set gives every number; no threshold is written in the code.
- Before the last commit: `cargo fmt --check`; Clippy `-D warnings` online and with `SQLX_OFFLINE=true` (after
  `touch src/lib.rs`); `cargo sqlx prepare -- --all-targets` with `.sqlx/` committed.

## Endpoints

| Route | Query | Answer |
|---|---|---|
| `GET /workouts/:id/points` | — | 200 `{workoutId, status, totalXp, entries: [{id, amount, reason, reversesId, explanation, ruleSetVersion}]}`, entries oldest first; 404 when not the caller's or the id is malformed |
| `GET /me/records` | — | 200 `[{id, exercise: {id, code, name: {fr, en, ar}}, metric: {code, unit}, value, previousValue, status, achievedAt, workoutId}]`: current records, `REPS_AT_WEIGHT` left out, newest first |
| `GET /me/progress` | `period`: `7d`, `30d` (default), `3m`, `6m`, `1y`; anything else is 422 `ISIN` on `period` | 200 `{period, from, to, metrics: [{exercise: {id, code, name}, metric: {code, unit, direction}, before, now, changePct, xpFromRecords, sessions}], bodyWeight: {first, last, points} \| null}` |
| `GET /me/progress/metrics/:exerciseId/:metricCode` | `period` as above | 200 `{metric: {code, unit, direction}, points: [{at, value, workoutId}]}`, oldest first; 404 `Metric` for an unknown code; 404 for a malformed exercise id |
| `GET /me` | — | unchanged shape; `stats` and `streak` now move |

Periods reach 7, 30, 91, 182 and 365 days back from now (`PERIODS` of the old API).

**An XP entry's explanation** (what `explainPoints` renders):

```json
{"formula": "workout_xp", "inputs": {"durationMin": 60, "workoutOfDay": 1},
 "steps": [{"label": "base", "value": 10}, {"label": "duration_bonus", "value": 20, "expr": "floor(60/3)"},
           {"label": "workout_max", "value": 50, "applied": false}, {"label": "diminishing_multiplier", "value": 1}],
 "workoutId": "…", "requested": 30,
 "caps": [{"label": "daily_cap_remaining", "value": 400, "applied": false},
          {"label": "weekly_cap_remaining", "value": 2000, "applied": false}],
 "result": 30}
```

- `PR` and `CALIBRATION_PR`: `formula` `pr_xp` or `calibration_pr_xp`, `inputs {exerciseId, metric, value,
  previous, ratio}`, no `steps`.
- `QUEST`: `formula` `first_workout_quest_xp`, `caps: []` (quests are outside the caps).

## How `score` works

A port of `WorkoutScoringService.onAccepted`, without its outbox checks (ruling 3), in this order:

1. Observations (`engine::observations`) are stored with `counts_for_competition`.
2. For each observation: its baseline (qualifier 0 only), then PR detection (`records.rs`).
3. The daily streak, from the business day of `performed_at`.
4. A late log (`counts_for_competition` false) stops here: history and progress only.
5. The day's counter takes one more workout; workout XP is `floor(workout_xp × diminishing(nth))`, granted under
   the caps, source `workout` / `"<workoutId>#v1"`.
6. One PR reward per exercise:
   - skip every exercise with a `HELD` record in this workout;
   - keep the `AWARDED` and `CALIBRATION` records of the XP metrics, and take the one first in `PR_PRIORITY`;
   - skip it when a record of the same exercise, metric and status, with XP, was achieved within
     `pr_same_metric_cooldown_days` before this workout;
   - `CALIBRATION` earns `calibration_pr_xp` and `AWARDED` earns `pr_xp(ratio)`, under the caps; the record gets
     `xp_transaction_id`.
7. `// plan 2c: goal milestones here` (a comment only).
8. The first quest, once per account: `first_workout_quest_xp`, source `quest` / `FIRST_WORKOUT`, uncapped.
9. `// plan 2c: badges here` (a comment only).

A grant whose result is 0 writes nothing. A capped grant adds its result to the day's counter. Caps read the
counter of the workout's business day and the sum over its Monday-to-Sunday business week, not today's.

- `XP_METRICS`: `E1RM`, `FINISH_TIME`, `MAX_WEIGHT`, `MAX_REPS`, `DISTANCE`, `PACE`, `TIME_1K`, `TIME_5K`,
  `TIME_10K`, `TIME_21K`.
- `PR_PRIORITY`: `E1RM`, `FINISH_TIME`, `TIME_21K`, `TIME_10K`, `TIME_5K`, `TIME_1K`, `MAX_WEIGHT`, `PACE`,
  `MAX_REPS`, `DISTANCE`.

## Rulings

1. **The transaction of `intake::create` starts by locking the athlete's `user_stats` row**
   (`SELECT … FOR UPDATE`). One athlete's workouts are then saved and scored one after the other, so two phones
   syncing at once can neither both take the first quest nor lose a counter increment. Spec ruling 2 already puts
   scoring in that transaction.
2. **`xp_transactions.workout_id`.** Every entry a workout earns carries its id, so `GET /workouts/:id/points`
   is one indexed query. The old API matched a source-id prefix, the workout's record ids and a JSON path.
3. **No "already processed" checks.** The old worker guarded against handling one outbox event twice; here
   scoring runs once, in the transaction that creates the workout.
4. **`bodyWeight` in `/me/progress` needs the `HEALTH_DATA` consent**, like the measurements themselves (plan 2a
   ruling 3). Without it the field is `null`.
5. **A malformed exercise id in the metric series answers 404** (plan 2a ruling 4). An unknown metric code is 404
   `Metric`, and an unknown exercise gives an empty series, as in the old API.
6. **`baselines` gains `calibrated_value`, `experience_level`, `logs_counted` and `finalized_at` only.**
   `corrected_from` and `rule_set_version` come with the baseline audit of plan 2d.
7. **Activity events** (workout, PR, level-up) are not written: spec ruling 9, part 3. Goal milestones and
   badges are plan 2c, at the two marked comments.
8. **A beaten record keeps its status** and only loses `is_current`, as in the old API. `REVOKED` and
   `SUPERSEDED` stay in the enum for later parts.
9. **Expected progression** is a table keyed by rule set. The seed upserts `ruleset-v2.json`'s
   `expectedProgression` for the rule set of that version. A generic row (no exercise) is keyed by a zero id in a
   generated column, so a second seed run changes nothing.
10. **Export and deletion:** the export fills `account.personalRecords` and `xpTransactions`. Anonymisation
    changes nothing for these tables: records, observations, baselines, counters and the ledger hold no free text,
    and the spec keeps them.

## Review focus

1. Two different workouts of one athlete arriving at the same instant are both scored, the first quest is granted
   once, and `user_stats.xp_total` equals the ledger's sum (task 3, ruling 1).
2. A workout logged offline on an earlier business day is capped by that day's counter, not by today's (task 3).
3. A workout dated before the last training day leaves the daily streak as it is, neither resetting nor growing
   it (task 1).
4. Logging the current record's value again is not a record and earns nothing (task 3).
5. A faster run is a record and a slower one is not: run times are lower-is-better (tasks 1 and 3).

---

### Task 1: the rule-set fields and the pure engine

**Files:**

- Create: `apps/backend/src/modules/scoring/mod.rs` (`pub mod engine;` for now) and
  `apps/backend/src/modules/scoring/engine.rs`.
- Modify: `apps/backend/src/modules/mod.rs`, `apps/backend/src/rules.rs`, `apps/backend/src/types.rs`.

**Interfaces (produces):**

- `Rules` gains, with the names of `ruleset-v2.json`:
  - `i64`: `workout_base_xp`, `workout_max_xp`, `workout_xp_minutes_per_point`, `workout_min_duration_min`,
    `diminishing_returns_after`, `daily_xp_cap`, `weekly_xp_cap`, `pr_xp_min`, `pr_xp_max`, `calibration_pr_xp`,
    `pr_same_metric_cooldown_days`, `first_workout_quest_xp`, `baseline_first_logs`;
  - `f64`: `progress_ceiling_ratio`, `level_base_xp`, `level_exponent`; `diminishing_multipliers: Vec<f64>`;
  - `strength_standards: HashMap<String, StrengthStandard>` (`bwRatio` and `absoluteKg`, each
    `Tiers {intermediate, advanced}`) and `running_standards: HashMap<String, Tiers>`.
- `types::ExperienceLevel` derives `PartialOrd, Ord, Hash, Serialize, sqlx::Type` (variant order is the level
  order).
- In `engine.rs`:
  - `#[derive(Serialize)] pub struct Step { label: &'static str, value: f64, expr: Option<String>,
    applied: Option<bool> }`, with `None` skipped.
  - `pub fn workout_xp(duration_s: i32, r: &Rules) -> (i64, Vec<Step>)`.
  - `pub fn diminishing_multiplier(nth: i64, r: &Rules) -> f64`.
  - `pub fn apply_caps(requested: i64, today: i64, week: i64, r: &Rules) -> (i64, Vec<Step>)`.
  - `pub fn pr_xp(ratio: f64, r: &Rules) -> i64`: `round(min + (max − min) × clamp(ratio / 2, 0, 1))`.
  - `pub struct Level { pub level: i32, pub into: i64, pub next: i64 }` and
    `pub fn level_from_xp(total: i64, r: &Rules) -> Level`. Going from level n to n + 1 costs
    `round(base × n^exponent)`.
  - `#[derive(Clone, Copy, PartialEq, Eq)] pub enum Direction { Higher, Lower }`, with `Direction::parse(&str)`
    reading `HIGHER_IS_BETTER` and `LOWER_IS_BETTER`.
  - `improvement_pct(reference, current, Direction) -> f64`, `is_better(candidate, record, Direction) -> bool`,
    `progress_ratio(improvement, expected_pct) -> f64`.
  - `derive_experience_level(exercise_code: &str, metric_code: &str, best: f64, body_weight_kg: Option<f64>,
    r: &Rules) -> Option<ExperienceLevel>`.
  - `harder_level(candidates: &[Option<ExperienceLevel>], expected: impl Fn(ExperienceLevel) -> Option<f64>)
    -> ExperienceLevel`: the one expecting the most improvement, the first on a tie, `Beginner` when none.
  - `pub struct Observation { pub exercise_id: Uuid, pub metric: &'static str, pub qualifier: f64,
    pub value: f64 }` and `pub fn observations(w: &WorkoutInput, tracked: &HashMap<Uuid, Vec<String>>,
    r: &Rules, lower_is_better: impl Fn(&str) -> bool) -> Vec<Observation>`: the port of `extractObservations`,
    in first-seen order.
  - `pub fn next_daily_streak(last: Option<NaiveDate>, current: i32, day: NaiveDate, freeze_days: i32)
    -> Option<i32>`: `None` leaves the streak as it is.

- [ ] **Step 1: write the failing unit tests** in `engine.rs`, against `rules::tests::seeded()`:
  - `workout_xp_follows_duration`: 62 min gives 30; 3 h gives 50 with `workout_max` applied; 14 min gives 0 with a
    `below_min_duration` step; 15 min gives 15.
  - `diminishing_returns`: `nth` 1 to 5 give `[1, 1, 0.5, 0, 0]`.
  - `caps`: `(100, 350, 0)` gives 50; `(100, 0, 1950)` gives 50; `(100, 400, 0)` gives 0; `(477, 30, 30)` gives
    370, with `daily_cap_remaining` 370 applied and `weekly_cap_remaining` 1970 not applied.
  - `pr_xp_scales_with_the_ratio`: 0 → 50, 0.634 → 193 (ARCHITECTURE §5.10.3), 2 → 500, 9 → 500, −1 → 50.
  - `the_level_curve`: 0 → (1, 0, 100); 99 → (1, 99, 100); 100 → (2, 0, 283); 140 → (2, 40, 283);
    383 → (3, 0, 520); 903 → (4, 0, 800).
  - `fairness`: `improvement_pct(60, 65, Higher)` ≈ 8.333; `(1500, 1440, Lower)` = 4; a reference of 0 gives 0;
    `progress_ratio(−2, 3)` = 0; `progress_ratio(6, 3)` = 2; an expected 0 gives 0; `is_better(285, 300, Lower)`.
  - `experience_level`: squat 150 at 70 kg is `Advanced`; 150 without body weight `Intermediate`; `TIME_5K` 1200
    `Advanced`; `BICEPS_CURL` `None`. `harder_level`, with 8, 3 and 1 expected: `[Advanced, Beginner]` →
    `Beginner`, `[Advanced, Intermediate]` → `Intermediate`, `[None, None]` → `Beginner`.
  - The four `extractObservations` cases of `engine.spec.ts`:
    - best value per metric, warm-ups left out: `MAX_WEIGHT` 110, `E1RM` 121, `REPS_AT_WEIGHT` at 100 is 5,
      `MAX_REPS` 10;
    - `FINISH_TIME` keeps the lowest (298);
    - no `FINISH_TIME` without a duration;
    - a 10 km run in 3,000 s gives `DISTANCE` 10000, `PACE` 300, `TIME_5K` 1500, `TIME_10K` 3000, no `TIME_21K`.
  - `the_daily_streak` (review focus 3): first day → 1; same day → `None`; next day → +1; a gap of 3 days with 2
    freeze days → `current + 3`; a gap of 4 → 1; a day before the last → `None`; with 0 freeze days a gap of 2 → 1.
  - `rules::tests::the_seeded_rule_set_reads` also asserts `daily_xp_cap` 400 and
    `strength_standards["BACK_SQUAT"].absolute_kg.intermediate` 100.
- [ ] **Step 2:** `cargo test -j 4 --lib scoring rules` fails to compile.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --lib` passes.
- [ ] **Step 5:** commit `feat(backend): the scoring engine as pure rules: XP, caps, levels, fairness, observations, daily streak`.

### Task 2: the tables, and the expected progression in the seed

**Files:**

- Create: `apps/backend/migrations/0007_points.sql`.
- Modify: `apps/backend/src/seed.rs` and `apps/backend/tests/schema.rs`.

**Migration** (part 1's conventions):

- **`expected_progression`:**
  - `id`, `rule_set_id` (`ON DELETE CASCADE`), `experience_level ENUM`, `exercise_id NULL`, `metric_type_id`,
    `expected_pct DECIMAL(6,3)`;
  - `exercise_key BINARY(16) AS (IFNULL(exercise_id, 0x0…0)) STORED`;
  - `UNIQUE (rule_set_id, experience_level, exercise_key, metric_type_id)`.
- **`metric_observations`:**
  - `id`, `user_id`, `exercise_id`, `metric_type_id`, `qualifier DECIMAL(12,3) DEFAULT 0`, `value DECIMAL(12,3)`;
  - `workout_id` (`ON DELETE CASCADE`), `observed_at`, `counts_for_competition BOOLEAN`, `created_at`;
  - `KEY (user_id, exercise_id, metric_type_id, observed_at)` and `KEY (user_id, observed_at)`.
- **`personal_records`:**
  - `id`, `user_id`, `exercise_id`, `metric_type_id`, `qualifier`, `value`, `previous_value NULL`, `workout_id`;
  - `status ENUM('AWARDED','CALIBRATION','HELD','REVOKED','SUPERSEDED')`, `is_current BOOLEAN`, `achieved_at`;
  - `xp_transaction_id BINARY(16) NULL`, `created_at`, `updated_at`;
  - `current_slot TINYINT AS (IF(is_current, 1, NULL)) STORED`, under
    `UNIQUE uq_personal_records_one_current (user_id, exercise_id, metric_type_id, qualifier, current_slot)`;
  - `KEY (user_id, exercise_id, metric_type_id, achieved_at)`.
- **`baselines`** gains `calibrated_value DECIMAL(12,3) NULL`, `experience_level ENUM NULL`,
  `logs_counted INT NOT NULL DEFAULT 0` and `finalized_at DATETIME(6) NULL`.
- **`xp_transactions`:**
  - `id`, `user_id` (no cascade: the ledger is never deleted), `amount INT`;
  - `reason ENUM('WORKOUT','PR','CALIBRATION_PR','GOAL_MILESTONE','CHALLENGE','BATTLE','BATTLE_WIN',
    'GYM_WAR_WIN','QUEST','REVERSAL','MODERATION','ADMIN_ADJUSTMENT')`;
  - `source_type VARCHAR(32)` and `source_id VARCHAR(64)`, in ASCII; `workout_id BINARY(16) NULL`;
  - `reverses_id BINARY(16) NULL UNIQUE`, a foreign key to the table itself;
  - `rule_set_version INT`, `explanation JSON CHECK (JSON_VALID(explanation))`, `effective_at`,
    `created_by BINARY(16) NULL`, `created_at`;
  - `once_slot TINYINT AS (IF(reverses_id IS NULL, 1, NULL)) STORED`, under
    `UNIQUE uq_xp_transactions_source_once (user_id, reason, source_type, source_id, once_slot)`;
  - `CHECK (amount >= 0 OR reason IN ('REVERSAL','MODERATION','ADMIN_ADJUSTMENT'))` and
    `CHECK ((reason = 'REVERSAL') = (reverses_id IS NOT NULL))`;
  - `KEY (user_id, effective_at)` and `KEY (user_id, workout_id)`;
  - triggers `xp_transactions_no_update` and `xp_transactions_no_delete`, as `audit_log`'s.
- **`xp_daily_counters`:** `user_id` (`ON DELETE CASCADE`), `day DATE`, `xp_granted INT DEFAULT 0`,
  `workouts_counted INT DEFAULT 0`, `PRIMARY KEY (user_id, day)`.
- **`user_streaks`** gains `longest_days INT NOT NULL DEFAULT 0` and `last_training_date DATE NULL`.

**Seed:** `RuleSetFile` gains `expected_progression: Vec<Expected>` (`level`, `exercise: Option<String>`,
`metric`, `pct`). `run` checks its exercise and metric codes, as it checks the catalog's. `write` upserts each row
for the rule set whose `version` is the file's (`ON DUPLICATE KEY UPDATE expected_pct`).

- [ ] **Step 1: write the failing tests** in `tests/schema.rs`:
  - `the_xp_ledger_is_append_only_and_grants_once`:
    - insert an entry; its `UPDATE` and its `DELETE` fail;
    - a second entry with the same `(user, reason, source type, source id)` is a unique violation;
    - a `REVERSAL` of it (`reverses_id` set, amount negative) is accepted, and a second reversal of it is a unique
      violation;
    - a negative `WORKOUT` amount fails its check.
  - `a_record_is_current_once`: two current records of one `(user, exercise, metric, qualifier)` are a unique
    violation; a second record that is not current is accepted.
  - `the_seed_loads_the_expected_progression`: after `seeded`, 30 rows for version 2; running
    `backend::seed::run` again leaves 30.
- [ ] **Step 2:** apply the migration to the dev database (`sqlx migrate run --source migrations` with the
  handoff's URL), then `cargo test -j 4 --test schema` fails.
- [ ] **Step 3: implement** the seed change.
- [ ] **Step 4:** `cargo test -j 4 --test schema --test reference` passes.
- [ ] **Step 5:** commit `feat(backend): the points tables: observations, records, the append-only XP ledger, daily counters; expected progression in the seed`.

### Task 3: scoring in the workout's transaction, and `GET /workouts/:id/points`

**Files:**

- Create:
  - `apps/backend/src/modules/scoring/records.rs` and `apps/backend/src/modules/scoring/ledger.rs`;
  - `apps/backend/tests/common/workouts.rs`: the helpers of `tests/workouts.rs` (`Catalog`, `catalog`, `athlete`,
    `rfc`, `lifting`, `strength`, `single`, `run`, `send`, `post`, `get`), moved there so both test files use
    them;
  - `apps/backend/tests/points.rs`.
- Modify:
  - `apps/backend/src/modules/scoring/mod.rs`: `score` and the route;
  - `apps/backend/src/modules/workouts/intake.rs`: the lock (ruling 1) and the call to `score`. `Resolved` gains
    `tracked: HashMap<Uuid, Vec<String>>`, the exercise's metric codes, read in the existing catalog query, which
    then derives the `DISTANCE` flag from them;
  - `apps/backend/src/http/mod.rs`: `api()` adds `scoring::routes`;
  - `apps/backend/tests/common/mod.rs` (`pub mod workouts;`) and `apps/backend/tests/workouts.rs`.

**Interfaces:**

- **Consumes:** task 1's engine, `Rules::active`, `policy::business_day_start`, the anti-cheat context's
  `body_weight_kg`, and the evaluation's `counts_for_competition`.
- **Produces:**
  - `pub struct Scoring<'a> { pub user: Uuid, pub workout_id: Uuid, pub workout: &'a WorkoutInput,
    pub tracked: &'a HashMap<Uuid, Vec<String>>, pub counts_for_competition: bool,
    pub body_weight_kg: Option<f64> }`.
  - `pub async fn score(tx: &mut MySqlConnection, state: &AppState, rules: &Rules, s: Scoring<'_>)
    -> Result<(), AppError>`. Inside `tx` it reads the metric types, the expected progression of
    `rules.version`, the profile's calibration end and declared level, and the settings'
    `streak_freeze_days_per_week`. Its call site carries
    `shortcut: synchronous scoring, move to a job if POST /workouts gets slow`.
  - `records::record(tx, ctx: &RecordContext<'_>) -> Result<(Vec<Observation>, Vec<PrOutcome>), AppError>`, the
    port of `ProgressService.recordWorkout` (`updateBaseline`, `detectPr`). `in_calibration` is « no calibration
    end, or performed before it »; `calibration_over` is « an end, and now past it ».
  - `pub struct PrOutcome { pub id: Uuid, pub exercise_id: Uuid, pub metric: &'static str, pub value: f64,
    pub previous: Option<f64>, pub status: &'static str, pub ratio: Option<f64> }`.
  - `ledger::append_xp(tx, rules: &Rules, e: XpEntry) -> Result<Uuid, AppError>`. `XpEntry` has `user`,
    `amount`, `reason`, `source_type`, `source_id`, `workout_id`, `explanation: Value` and `effective_at`; the
    version is `rules.version`. It inserts the entry, then sets `xp_total`, `level`, `xp_into_level` and
    `xp_for_next_level` from `engine::level_from_xp`.
- **`GET /api/v1/workouts/{id}/points`:** `AppUser`; a malformed or foreign id is 404 `Workout`. `totalXp` is the
  sum of the workout's entries: a reversal carries the same `workout_id`, so it cancels its original.

- [ ] **Step 1: write the failing tests** in `tests/points.rs`. Each athlete is in calibration unless the test
  moves `profiles.calibration_ends_at` 30 days back.

  | Test | Asserts |
  |---|---|
  | `a_first_workout_earns_its_points_and_the_quest` | `strength` (3 × 5 × 100, 60 min): points `totalXp` 140; reasons `[WORKOUT, CALIBRATION_PR, QUEST]` with 30, 10 and 100; the workout entry's explanation has `requested` 30, `result` 30, and the steps `base` 10 and `duration_bonus` 20; `GET /me` `stats` is `{xpTotal: 140, level: 2, xpIntoLevel: 40, xpForNextLevel: 283}` and `streak.currentDays` 1; `xp_total` equals `SUM(amount)` |
  | `records_after_calibration_follow_the_expected_progress` | calibration over; squat 100 × 5 at now − 60 h: `CALIBRATION_PR` 10 (no earlier record); 102.5 × 5 at now − 36 h: `PR` 237, `inputs.previous` 116.67, `ratio` ≈ 0.831; 105 × 5 at now − 12 h: no PR entry (cooldown), yet its `E1RM` record is current and `AWARDED` |
  | `an_implausible_jump_is_held` | after those three, 140 × 5 at now − 6 h: no PR entry; that workout's `E1RM` record is `HELD` and not current; `/me/records` still gives 122.5 |
  | `the_same_value_again_is_no_record` (review focus 4) | in calibration, 3 × 5 × 100 then 4 × 5 × 100 a day later (another fingerprint, the same bests): the second workout makes no `E1RM` record and no PR entry |
  | `a_faster_run_is_a_record` (review focus 5) | in calibration, 5 km in 30, then 28, then 29 minutes, a day apart: the current `TIME_5K` is 1680, and the third run made no `TIME_5K` record |
  | `caps_follow_the_day_of_the_workout` (review focus 2) | calibration over; 100 × 5 at now − 60 h, then 105.7 × 5 at now − 36 h: its PR entry has `requested` 477, `result` 370 and `daily_cap_remaining` applied; a third workout at now − 12 h, another day, earns its full workout XP of 30 |
  | `a_late_workout_earns_no_xp` | performed 80 h ago: `totalXp` 0 and no entries; a `personal_records` row exists; `streak.currentDays` 1 |
  | `held_and_rejected_workouts_earn_nothing` | a held 320 × 1 squat and a rejected 5 km in 10 min: both `totalXp` 0; no observation for either |
  | `simultaneous_workouts_are_scored_in_turn` (review focus 1) | `tokio::join!` of two different workouts 3 h apart: both 201; one `QUEST` row; `xp_total` equals `SUM(amount)` |
  | `points_belong_to_their_owner` | another account's `GET /workouts/:id/points` is 404; `/workouts/not-a-uuid/points` is 404; the shape matches the recorded `GET /workouts/<id>/points` of `apps/mobile-rn/assets/demo/api.json` |

  The PR values: `e1rm(102.5, 5)` is 119.58, an improvement of 2.494 % against the expected 3 %
  (`INTERMEDIATE`, `E1RM`), a ratio of 0.8314, so `pr_xp` 237. `e1rm(105.7, 5)` is 123.32, a ratio of 1.8999, so
  `pr_xp` 477; the day's workout XP of 30 leaves 370.
- [ ] **Step 2:** `cargo test -j 4 --test points` fails.
- [ ] **Step 3: implement** `records.rs`, `ledger.rs`, `score`, the route, and the intake changes.
- [ ] **Step 4:** `cargo test -j 4 --test points --test workouts --test security` passes.
- [ ] **Step 5:** commit `feat(backend): an accepted workout earns XP in its own transaction: records, caps, level, daily streak, first quest; GET /workouts/:id/points`.

### Task 4: `/me/records`, `/me/progress` and its metric series

**Files:**

- Create: `apps/backend/src/modules/scoring/progress.rs`.
- Modify: `apps/backend/src/modules/scoring/mod.rs` (routes) and `apps/backend/tests/points.rs`.

**Interfaces:**

- **Consumes:** `body::has_consent`, `body::all`, and the tables of task 2.
- **Produces:** the three routes, added by `scoring::routes`. `overview` is the port of
  `ProgressQueryService.overview`. For each `(exercise, metric)` seen in the period:
  - `before` is the best value before the period, else the baseline's `effective_value`, else the period's first
    value;
  - `now` is the best value in the period, and `changePct` is `improvement_pct` rounded to 1 decimal;
  - `xpFromRecords` sums the period's unreversed `PR` and `CALIBRATION_PR` entries whose `inputs` name that
    exercise and metric;
  - `sessions` counts the period's observations, and metrics are sorted by it, most first.

  `bodyWeight` comes from at most 400 measurements in the period, and only with the consent (ruling 4).

- [ ] **Step 1: write the failing tests** in `tests/points.rs`:
  - `records_list_the_current_bests`: after `strength` at 100, then at 110 (in calibration), `/me/records` holds
    `E1RM` 128.33 and `MAX_WEIGHT` 110, without `REPS_AT_WEIGHT`. Each has `exercise.code` `BACK_SQUAT`, an
    `exercise.name.fr`, `metric.unit` `kg`, `previousValue` 116.67 or 100, and `status` `CALIBRATION`.
  - `progress_compares_the_period_with_before`: squat 100 × 5 performed 40 days ago and 110 × 5 performed 2 days
    ago. `period=30d` gives the `E1RM` metric with `before` 116.67, `now` 128.33, `changePct` 10 and `sessions` 1.
    `period=1y` gives `before` 128.33, the baseline's effective value since nothing is earlier (calibration
    raised it to the best logged), `changePct` 0 and `sessions` 2.
  - `the_series_reads_oldest_first`: `/me/progress/metrics/<squat>/E1RM?period=1y` gives two points in time
    order, each with its `workoutId`, and `metric.direction` `HIGHER_IS_BETTER`; `/metrics/<squat>/NOPE` is 404;
    `/metrics/not-a-uuid/E1RM` is 404.
  - `body_weight_shows_only_with_the_consent`: weigh-ins at 80, then 79, with the consent: `bodyWeight` is
    `{first: 80, last: 79, points: 2}`; once the consent is withdrawn, `bodyWeight` is null.
  - `progress_periods`: `period=2w` is 422 `ISIN` on `period`; without `period` the answer's `period` is `30d`.
  - `progress_has_the_shape_recorded_from_the_old_api`: `assert_same_shape` of `GET /me/progress?period=30d` and
    `GET /me/records` against `api.json`.
- [ ] **Step 2:** `cargo test -j 4 --test points` fails on these tests.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --test points --test security` passes.
- [ ] **Step 5:** commit `feat(backend): GET /me/records, /me/progress and its metric series`.

### Task 5: the export

**Files:** modify `apps/backend/src/modules/me/privacy.rs` and `apps/backend/tests/privacy.rs`.

- `account.personalRecords`: every record of the account, oldest first: `{id, exerciseId, exerciseCode,
  metricCode, qualifier, value, previousValue, status, isCurrent, achievedAt, workoutId}`.
- `xpTransactions`: every entry, oldest first: `{id, amount, reason, sourceType, sourceId, workoutId, reversesId,
  ruleSetVersion, explanation, effectiveAt, createdAt}`.

- [ ] **Step 1: write the failing test** `the_export_holds_records_and_xp`: after one `strength` workout, the
  export has 3 records and 3 XP entries, whose amounts add up to 140.
- [ ] **Step 2:** `cargo test -j 4 --test privacy` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --test privacy` passes.
- [ ] **Step 5:** commit `feat(backend): the export carries personal records and the XP ledger`.

### Task 6: documents and checks

- [ ] **Step 1: update the documents:** the README's backend section (the four routes), the spec's status line
  (plan 2b built), `handoff.md`, and a « Built » section at the end of this plan for any departure from it.
- [ ] **Step 2:** `cargo sqlx prepare -- --all-targets`, with `DATABASE_URL` in the command's own environment;
  commit `.sqlx/`.
- [ ] **Step 3: run the checks** and read each output: `cargo fmt --check`; `cargo clippy --all-targets --
  -D warnings`; after `touch src/lib.rs`, the same with `SQLX_OFFLINE=true`; `cargo test -j 4`; `cargo audit`;
  `cargo deny check`.
- [ ] **Step 4:** commit `docs: Rust backend plan 2b built: README, spec, handoff; sqlx offline data`.

## Done when

- `cargo test` passes with `points` next to the earlier suites, and the security suite passes unchanged.
- In the app, the workout screen's « Why these points » card lists the entries with their steps, the progress
  screen shows before and now per metric with its chart, and the home screen's level bar moves.

## Built (2026-10-19): where the code departs from this plan

- `caps_follow_the_day_of_the_workout`: the third workout is a 30-minute run, so its full workout XP is 20
  (10 + 30/3), not the 30 the plan wrote. What it proves is unchanged: another day has its own room.
- `an_implausible_jump_is_held` reads the current record in SQL: `/me/records` arrives in task 4, whose own test
  covers the route.
- `records.rs` also defines `Metric` (id, code, direction) and `Expected` (the expected progression, with the
  exercise's own row winning over the generic one). `engine::step` is public, for the diminishing multiplier's
  step.
- The explanation is a serialised struct (`Explanation` in `scoring/mod.rs`) rather than a merged JSON object.
- One query reads the day's and the week's granted XP together (`granted`).
- The seed writes the expected progression with one `INSERT … SELECT` per row, joined to the rule set by
  version, so it needs no lookup first.
- `intake.rs` reads the exercise's metric codes with `GROUP_CONCAT` in its catalog query; the `DISTANCE` flag
  now comes from that list, replacing the former `EXISTS`.
