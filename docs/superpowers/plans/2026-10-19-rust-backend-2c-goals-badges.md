# Rust backend, plan 2c: goals and badges

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Date: 2026-10-19 · Spec: `docs/superpowers/specs/2026-10-18-rust-backend-training-loop-design.md` · Third plan of
part 2, after plan 2b (`docs/superpowers/plans/2026-10-19-rust-backend-2b-points.md`).

**Goal:** an athlete sets goals (strength, running, body weight, habit) with realistic milestones and suggested
targets; workouts and weigh-ins reach the milestones and earn their XP; badges are awarded in the same transactions,
and `GET /badges` shows the catalogue with the athlete's progress. The onboarding `goals` step turns true with the
first goal.

**Architecture:**

- A new module, `modules/goals`:
  - `planning.rs`: the pure maths of the old `goal-planning.ts` (rounding, milestones, ETAs, suggestions,
    weight-change safety), unit-tested;
  - `mod.rs`: the four routes and the goal view;
  - `milestones.rs`: crediting, called by `scoring::score` (a workout) and by `body::add` (a weigh-in).
- A new file, `modules/badges.rs`: the rule types of the old `badge-rules.ts`, `evaluate` (awarding, in the
  caller's transaction) and `GET /badges`.
- `scoring::score` fills its two `plan 2c` comments. `body::add` gains a transaction.
- One migration, `0008_goals_badges.sql`. The seed loads `catalog.json`'s badges.

**Tech stack:** Axum 0.8 and sqlx 0.9 on MariaDB 11.4, as in plan 2b. No new crate.

**Contract:** the old API's code, as the app calls it.

- **Old API:** `apps/api/src/modules/goals/` (`goals.service.ts`, `goal-planning.ts` and its spec,
  `dto/goal.dto.ts`), `apps/api/src/modules/badges/` (`badges.service.ts`, `badge-rules.ts` and its spec), the call
  sites in `scoring/workout-scoring.service.ts` (steps 3 and 5), `users/onboarding.service.ts` (`goals` step) and
  `users/privacy.service.ts` (export, anonymisation).
- **The app's callers:** `apps/mobile-rn/src/features/goals/api.ts` and `screen.tsx` (list, create from a
  suggestion, abandon); `features/badges/api.ts` and `screen.tsx` (`awardedAt`, `category`, `rarity`, `icon`,
  `name`, `description`, `progress.current` and `progress.target`).
- `apps/mobile-rn/assets/demo/api.json` holds `GET /goals` as an empty list and no badges, so the contract check
  covers no key of these routes: the tests below pin the shapes.

**Where it is built:** this Windows checkout, branch `feat/rust-backend-2c` (from `feat/rust-backend-2b`, not yet in
`origin/main`), with the environment line of `handoff.md` §2.

## Global constraints

Plans 2a and 2b's constraints hold unchanged: no `unwrap` or `expect` outside tests and no `unsafe`; `user_id = ?`
in every query on an account's data; database errors through `AppError::from(sqlx::Error)`; request bodies with
`deny_unknown_fields`, field paths, and every wrong field at once; timestamps through `types::iso`; ids from
`Uuid::now_v7()`; no health value in a log, an error or another account's answer; no new public route; only
`scoring/ledger.rs` writes the XP ledger. And:

- **Every XP writer locks the athlete's `user_stats` row first** (`SELECT … FOR UPDATE`), as `intake::create`
  does: the weigh-in path too, and `badges::evaluate` takes it itself.
- **Weight goal values are health data:** stored only encrypted (`HealthCipher::encrypt_number`), a check
  constraint forbids plain values on a `WEIGHT` goal, and they leave the API only to their owner with the consent.
- A metric value is `DECIMAL(12,3)`, as in plan 2b. Dates of a goal are business days (`policy::business_today`).
- Before the last commit: `cargo fmt --check`; Clippy `-D warnings` online and with `SQLX_OFFLINE=true` (after
  `touch src/lib.rs`); `cargo sqlx prepare -- --all-targets` with `.sqlx/` committed.

## Endpoints

| Route | Body | Answer |
|---|---|---|
| `GET /goals` | — | 200 `[Goal]`: `ACTIVE`, `COMPLETED`, `ABANDONED`, `EXPIRED` in that order, newest first within each |
| `POST /goals` | `{type, exerciseId?, metricCode, targetValue, targetDate?, visibility?, wasSuggested?}` | 201 `Goal` plus `disclaimerKey: "goals.disclaimer"` |
| `POST /goals/suggestions` | `{type: STRENGTH\|RUNNING, exerciseId, metricCode}` | 200 `{current, metric: {code, unit, direction}, expectedPctPer28Days, suggestions: [{horizon, targetValue, etaWeeks: {min, max}}], disclaimerKey}` |
| `DELETE /goals/:id` | — | 204: an `ACTIVE` goal becomes `ABANDONED`, any other stays as it is; 404 `Goal` when not the caller's or malformed |
| `GET /badges` | — | 200 `[{code, category, name: {fr, en, ar}, description: {fr, en, ar}, icon, rarity, awardedAt, progress: {current, target, met} \| null}]`, enabled badges by category (enum order) then code |

`Goal` is `{id, type, exerciseId, metric: {code, unit}, direction, startValue, targetValue, startDate, targetDate,
status, visibility, wasSuggested, safetyAdjustment, habitWeeksMet, milestones: [{index, targetValue, reachedAt}],
milestonesReached}`. Dates are `YYYY-MM-DD`, `reachedAt` is `iso`; `habitWeeksMet` is present only on a `HABIT` goal.

**`POST /goals`, in the old API's order:**

1. **The body:**
   - `type`: `WEIGHT`, `STRENGTH`, `RUNNING` or `HABIT`;
   - `metricCode`: `^[A-Z0-9_]{2,40}$` (`MATCHES`);
   - `targetValue`: `ISPOSITIVE`, `MAX` above 1,000,000, rounded to 2 decimals (plan 2a ruling 1);
   - `targetDate`: `YYYY-MM-DD` or RFC 3339, of which the date is kept (`ISISO8601`).

   A wrong enum or id is `INVALID`, the house's serde code.
2. `metricCode` outside the type's list is `NOT_ALLOWED_FOR_TYPE` on `metricCode`. The lists:
   - `STRENGTH`: `E1RM`, `MAX_WEIGHT`, `MAX_REPS`;
   - `RUNNING`: `TIME_1K`, `TIME_5K`, `TIME_10K`, `TIME_21K`, `DISTANCE`;
   - `WEIGHT`: `BODY_WEIGHT`;
   - `HABIT`: `WORKOUTS_PER_WEEK`.
3. **`exerciseId`:**
   - on `WEIGHT` or `HABIT`, `NOT_ALLOWED_FOR_TYPE`;
   - missing on `STRENGTH` or `RUNNING`, `REQUIRED`;
   - unknown, disabled or not tracking the metric, `METRIC_NOT_TRACKED`.
4. **409 `CONFLICT`:**
   - at 10 active goals;
   - when an active goal exists for the same metric and exercise, with `goalId`.
5. A `targetDate` on or before today is `MUST_BE_IN_FUTURE` on `targetDate`.
6. **By type.** The codes below are on `targetValue`, under 422 `VALIDATION_FAILED`.
   - **`HABIT`:**
     - not an integer, or above 6: `REST_DAY_REQUIRED`;
     - start 0, milestones at 2, 4, 8 and 12 weeks met, `direction` `INCREASE`.
   - **`WEIGHT`:**
     - the start is `body::latest_weight_kg`, else `NO_CURRENT_VALUE`;
     - the target is rounded to 0.5 kg. Equal to the rounded start: `TARGET_NOT_BETTER`. Outside 40 to 250 kg or
       more than 25 % from the start: `UNSAFE_TARGET`;
     - `direction` follows the target;
     - the target date is at least `safe_weight_weeks` from today. A requested date earlier than that is moved, and
       `safetyAdjustment` is `{reason: "WEIGHT_RATE_LIMIT", requestedTargetDate, maxPctPerWeek}`;
     - milestones every 2 kg;
     - `visibility` is always `PRIVATE`.
   - **`STRENGTH` and `RUNNING`:**
     - the start is the current record (qualifier 0), else the baseline's `effective_value`, else
       `NO_CURRENT_VALUE`;
     - a target that is not better (by the metric's direction): `TARGET_NOT_BETTER` with `current`;
     - `pct` is the expected progression (below). More than 104 weeks at `1.5 × pct`: `UNREALISTIC_TARGET` with
       `suggestions`;
     - a `targetDate` before the fastest date is moved to it, and `safetyAdjustment` is
       `{reason: "TOO_FAST", requestedTargetDate, earliestRealisticWeeks}`;
     - milestones by steps of `start × pct / 100`.

**The expected percent** of a goal or a suggestion:

- the level is `engine::harder_level` of the profile's declared level and the baseline's `experience_level`
  (`BEGINNER` when the baseline has none);
- the percent is that level's row of the active rule set: the exercise's own, else the generic one, else 1.

## How a goal is credited

`milestones::credit(tx, rules, goal, value, workout, at)`, the port of `creditMilestones`:

- milestones in index order. One already reached is skipped; the first one not reached stops the walk;
- each one reached gets an XP entry: `GOAL_MILESTONE`, `goal_milestone_xp` (150), source `goal_milestone` /
  milestone id, `workout_id` the workout or `NULL`, at `at`, outside the caps. Its explanation is
  `{formula: "goal_milestone_xp", inputs: {goalId, milestone: index + 1, of: n}, workoutId?, result}`;
- the milestone then gets `reached_at`, `workout_id` and `xp_transaction_id`;
- a goal whose milestones are all reached becomes `COMPLETED`.

Three callers:

- **A workout** (`scoring::score`, after the record rewards; so a late log reaches nothing):
  - every active `STRENGTH` or `RUNNING` goal with an observation of its exercise and metric in this workout;
  - skip an exercise with a `HELD` record in this workout;
  - the value is the observation's, the direction the goal's.
- **A weigh-in** (`body::add`):
  - every active `WEIGHT` goal gets `start + credited_weight_change(latest − start, start, weeks, max)`;
  - `weeks` counts from `start_date` at 00:00 UTC to now; `at` is now.
- **The week** (plan 2d): `HABIT` goals. Nothing in this plan moves them.

## Badges

- **Rules:** `COUNT {event, gte}`, `LEVEL {gte}`, `DIVISION {gte: BRONZE…ELITE}`, `STREAK_WEEKS {gte}`.
  - `gte` is a positive integer, and a division's target is its rank, 1 to 6;
  - a rule that does not parse awards nothing and shows `progress: null`.
- **Facts read in this plan:**
  - `COUNT:WORKOUT_ACCEPTED`: workouts with status `ACCEPTED`;
  - `COUNT:PR_AWARDED`: records `AWARDED` or `SUPERSEDED`;
  - `COUNT:GOAL_COMPLETED`: goals with status `COMPLETED`;
  - `LEVEL`: `user_stats.level`.

  Every other fact is 0 for now:
  - `DIVISION` and `STREAK_WEEKS`: `// plan 2d`;
  - the `FRIEND`, `GYM_JOINED`, `BATTLE_WIN`, `DUEL_WIN`, `GYM_WAR_WIN` and `CHALLENGE_COMPLETED` counts:
    `// parts 3 and 4`.
- **`evaluate(tx, user, source_ref)`:**
  - takes the `user_stats` lock while it reads `LEVEL`;
  - looks only at enabled badges the account never had (a revoked one is not given again), and reads only the
    facts their rules need;
  - inserts a `user_badges` row for each rule now met, and returns their codes.
- `progress` is `{current: min(fact, target), target, met: fact >= target}`.
- **Called:**
  - at the end of `scoring::score` (source: the workout id);
  - after the weigh-in's crediting (source `NULL`).

## Rulings

1. **The numbers the rule set lacks stay constants, as in the old API.** `ruleset-v2.json` gives
   `goal_milestone_xp` and `weight_change_max_pct_per_week`. The others are in `goals/planning.rs` and `goals/mod.rs`:
   - 10 active goals;
   - weight targets within ±25 % and 40 to 250 kg;
   - habit milestones at 2, 4, 8 and 12 weeks;
   - 104 weeks as the unrealistic horizon;
   - at most 6 milestones;
   - 1.5 × the expected rate as the fast bound.

   This is an exception to plan 2b's « no threshold in the code ».
2. **Creating a goal locks the account row** (`SELECT … FROM users FOR UPDATE`). Two creations at the same instant
   cannot both pass the limit and the duplicate check. A unique index on the active `(user, metric, exercise)` holds
   the duplicate rule as well.
3. **Weight goal values need the `HEALTH_DATA` consent to be read.** Without it, `GET /goals` answers `null` for a
   `WEIGHT` goal's `startValue`, `targetValue` and milestone values (plan 2b ruling 4). The export shows them
   decrypted, as it shows the weigh-ins.
4. **A weigh-in credits the weight goals in its own transaction.** The old API did it afterwards, through the
   outbox. Spec ruling 2 is applied here too. Badges are evaluated in the same transaction, so `GOAL_GETTER` does
   not wait for the next workout.
5. **`HABIT` goals are created with their milestones but do not move yet.** Plan 2d's weekly close counts their
   weeks.
6. **Milestone XP is outside the caps**, as in the old API. A late log and a held record reach no milestone.
7. **No soft delete.** `DELETE` abandons; the old `deletedAt` column is not carried over.
8. **Anonymisation deletes weight goals and their milestones** (health data; the old API cleared their values and
   soft-deleted every goal). It keeps the other goals and the badges, which hold no free text. The ledger entries
   of deleted milestones stay: they name their source by id only.
9. **A goal's exercise must be enabled**, as for the onboarding baselines. The old API took any exercise.
10. **No notification and no activity event** for a badge or a completed goal (spec ruling 9, part 3). The daily
    `badge-sweep` comes with plan 2d's jobs.
11. **The export:** `goals` holds the app's view of every goal, in the list's order. `account.badges` lists
    `[{code, awardedAt, revokedAt, sourceRef}]`.

## Review focus

1. Two `POST /goals` for the same metric at the same instant make one goal; the other answers 409 (task 3,
   ruling 2).
2. A held record reaches no milestone, though its value passes them (task 4).
3. A weight goal's values are never stored in clear, and never answered without the consent (tasks 2 and 3).
4. One workout past several milestones credits each once. An abandoned or completed goal earns nothing more (task 4).
5. A badge is awarded once when two workouts arrive at the same instant (task 5).

---

### Task 1: the rule-set fields and the pure goal and badge rules

**Files:**

- Create:
  - `apps/backend/src/modules/goals/mod.rs` (`pub mod planning;` for now);
  - `apps/backend/src/modules/goals/planning.rs`;
  - `apps/backend/src/modules/badges.rs`.
- Modify: `apps/backend/src/modules/mod.rs`, `apps/backend/src/rules.rs`.

**Interfaces (produces):**

- `Rules` gains `goal_milestone_xp: i64` and `weight_change_max_pct_per_week: f64`.
- In `planning.rs`, using `scoring::engine::Direction`:
  - `round_for(unit: &str, metric: &str, v: f64) -> f64`:
    - `BODY_WEIGHT` to 0.5;
    - `kg` to 2.5;
    - `s` and `s_per_km` to 5;
    - anything else to 1.
  - `plan_milestones(start: f64, target: f64, monthly_step: f64, round: impl Fn(f64) -> f64) -> Vec<f64>`:
    `n = clamp(ceil(|range| / |step| − 1e-9), 1, 6)` (step = range when 0). The last one is the target, and a
    value equal to the previous one is dropped.
  - `reached(value: f64, milestone: f64, d: Direction) -> bool`.
  - `weeks_at_rate(start: f64, target: f64, pct_per_28_days: f64, d: Direction) -> Option<i64>`: weekly rate
    `pct / 400`, compounded. `None` unless all three are positive; 0 when already there.
  - `#[derive(Serialize)] pub struct Suggestion { horizon: &'static str, target_value: f64, eta_weeks: Eta }` and
    `Eta { min: i64, max: i64 }`, both camelCase.
  - `suggest_targets(current: f64, expected_pct: f64, d: Direction, round: impl Fn(f64) -> f64) -> Vec<Suggestion>`:
    - the horizons `SHORT` 4, `MEDIUM` 10 and `LONG` 20 weeks;
    - the target is `round(current × or ÷ (1 + pct/400)^weeks)`. One equal to `round(current)`, or already
      listed, is skipped;
    - `min` is `max(1, weeks at 1.5 × pct)`, and `max` is `max(1, weeks at pct)`, each falling back to the
      horizon.
  - `safe_weight_weeks(start_kg: f64, target_kg: f64, max_pct_per_week: f64) -> i64`.
  - `credited_weight_change(actual_kg: f64, start_kg: f64, weeks: f64, max_pct_per_week: f64) -> f64`.
- In `badges.rs`:
  - `#[derive(Deserialize)] #[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")] pub enum Rule
    { Count { event: Event, gte: i64 }, Level { gte: i64 }, Division { gte: Division }, StreakWeeks { gte: i64 } }`;
  - `Event`: the nine events of `BADGE_EVENTS`; `Division`: `BRONZE` to `ELITE`, in order;
  - `#[derive(Clone, Copy, PartialEq, Eq, Hash)] pub enum Fact { Count(Event), Level, Division, StreakWeeks }`;
  - `Rule::fact(&self) -> Fact` and `Rule::target(&self) -> i64`;
  - `pub fn parse_rule(raw: &str) -> Option<Rule>`: `None` when the JSON does not fit or `gte` < 1;
  - `#[derive(Serialize)] pub struct Progress { current: i64, target: i64, met: bool }` and
    `pub fn progress(rule: &Rule, facts: &HashMap<Fact, i64>) -> Progress` (a missing fact is 0).

- [ ] **Step 1: write the failing unit tests**, the vectors of `goal-planning.spec.ts` and `badge-rules.spec.ts`:
  - `milestones_split_the_way`:
    - `(100, 120, 5)` in kg gives `[105, 110, 115, 120]`;
    - `(100, 200, 5)` gives 6 milestones;
    - `(1800, 1650, 60)` in `s` gives `[1750, 1700, 1650]`.
  - `milestones_are_reached_both_ways`: `reached(110, 110, Higher)`, `reached(1649, 1650, Lower)`,
    `!reached(1651, 1650, Lower)`.
  - `suggestions_for_a_beginner_squat`: `suggest_targets(80, 8, Higher, kg)` gives `SHORT` 87.5, `MEDIUM` 97.5 and
    `LONG` 120, the first with `eta {min: 4, max: 5}`; `weeks_at_rate(80, 90, 8)` is 6 and at 3 % it is 16;
    `suggest_targets(200, 1, …)[0].target_value` ≤ 205.
  - `weeks_at_a_rate`: `(100, 100, 8)` → 0, `(100, 110, 8)` → 5, `(100, 110, 0)` → `None`.
  - `weight_change_is_paced`: `safe_weight_weeks(90, 80, 1)` is 12; `credited_weight_change(−6, 90, 4, 1)` ≈ −3.6;
    `(2, 60, 4, 1)` is 2.
  - `rounding`: `round_for("kg", "BODY_WEIGHT", 77.3)` is 77.5; `("kg", "E1RM", 121.2)` is 120;
    `("s", "TIME_5K", 1712)` is 1710; `("count", "MAX_REPS", 12.4)` is 12.
  - `badge_progress`, with the facts `{PR_AWARDED: 12, LEVEL: 7, DIVISION: 3, STREAK_WEEKS: 2}`:
    - `COUNT PR_AWARDED ≥ 10` gives `{10, 10, met}`;
    - `LEVEL ≥ 10` gives `{7, 10, not met}`;
    - `DIVISION ≥ GOLD` is met, and `≥ PLATINUM` gives `{3, 4, not met}`;
    - `STREAK_WEEKS ≥ 4` gives `{2, 4}`;
    - `COUNT FRIEND ≥ 1` is not met.
  - `bad_badge_rules`: `{"type":"COUNT","event":"NOPE","gte":1}`, `{"type":"LEVEL","gte":0}` and `{}` give `None`.
  - `rules::tests::the_seeded_rule_set_reads` also asserts `goal_milestone_xp` 150 and
    `weight_change_max_pct_per_week` 1.
- [ ] **Step 2:** `cargo test -j 4 --lib goals badges rules` fails to compile.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --lib` passes.
- [ ] **Step 5:** commit `feat(backend): the goal maths and the badge rules as pure functions`.

### Task 2: the tables, and the badges in the seed

**Files:**

- Create: `apps/backend/migrations/0008_goals_badges.sql`.
- Modify: `apps/backend/src/seed.rs` and `apps/backend/tests/schema.rs`.

**Migration** (part 1's conventions):

- **`goals`:**
  - `id`, `user_id` (`ON DELETE CASCADE`), `type ENUM('WEIGHT','STRENGTH','RUNNING','HABIT')`, `exercise_id NULL`,
    `metric_type_id`, `direction ENUM('INCREASE','DECREASE')`;
  - `start_value` and `target_value` `DECIMAL(12,3) NULL`; `start_value_enc` and `target_value_enc`
    `VARBINARY(128) NULL`;
  - `start_date DATE`, `target_date DATE NULL`;
  - `status ENUM('ACTIVE','COMPLETED','ABANDONED','EXPIRED') DEFAULT 'ACTIVE'`;
  - `was_suggested BOOLEAN DEFAULT FALSE`, `safety_adjustment JSON NULL CHECK (JSON_VALID(…))`,
    `habit_weeks_met INT DEFAULT 0`;
  - `visibility ENUM('PUBLIC','FRIENDS','PRIVATE') DEFAULT 'PRIVATE'`, `created_at`, `updated_at`;
  - **checks:**
    - `(start_value IS NULL) <> (start_value_enc IS NULL)`, the same for `target_value`;
    - `(type = 'WEIGHT') = (start_value_enc IS NOT NULL)`, the same for `target_value_enc`;
  - `exercise_key BINARY(16) AS (IFNULL(exercise_id, 0x0…0)) STORED` and
    `active_slot TINYINT AS (IF(status = 'ACTIVE', 1, NULL)) STORED`, under
    `UNIQUE uq_goals_one_active (user_id, metric_type_id, exercise_key, active_slot)`;
  - `KEY (user_id, status)`.
- **`goal_milestones`:**
  - `id`, `goal_id` (`ON DELETE CASCADE`), `position SMALLINT`;
  - `target_value DECIMAL(12,3) NULL` and `target_value_enc VARBINARY(128) NULL`, exactly one of them (check);
  - `reached_at DATETIME(6) NULL`, `workout_id BINARY(16) NULL` (foreign key), `xp_transaction_id BINARY(16) NULL`;
  - `UNIQUE (goal_id, position)`.
- **`badges`:**
  - `id`, `code VARCHAR(40) ascii_bin UNIQUE`;
  - `category ENUM('PROGRESS','CONSISTENCY','COMPETITION','SOCIAL','GYM','ELITE')`, in the old enum's order;
  - `name_fr`, `name_en`, `name_ar` `VARCHAR(80)`; `description_fr`, `description_en`, `description_ar`
    `VARCHAR(255)`;
  - `icon VARCHAR(40) NULL`, `rarity ENUM('COMMON','RARE','EPIC','LEGENDARY') DEFAULT 'COMMON'`;
  - `rule JSON CHECK (JSON_VALID(rule))`, `enabled BOOLEAN DEFAULT TRUE`, `created_at`, `updated_at`.
- **`user_badges`:**
  - `id`, `user_id` (`ON DELETE CASCADE`), `badge_id`;
  - `awarded_at DATETIME(6)`, `source_ref VARCHAR(64) ascii NULL`, `revoked_at DATETIME(6) NULL`;
  - `UNIQUE (user_id, badge_id)`.

**Seed:** `Catalog` gains `badges: Vec<Badge>` (`code`, `category`, `icon`, `rarity`, `rule: Value`, `name`,
`description`).

- `run` refuses a badge whose rule fails `badges::parse_rule`, before writing anything.
- `write` upserts each badge by code, every column but `enabled`, which stays an admin's choice.
- `Summary` gains `badges`.

- [ ] **Step 1: write the failing tests** in `tests/schema.rs`:
  - `a_weight_goal_holds_no_clear_value`: a `WEIGHT` goal row with a plain `start_value` fails its check; with both
    values encrypted it is accepted; a `STRENGTH` row with an encrypted value fails.
  - `one_active_goal_per_metric`: a second `ACTIVE` goal of the same `(user, metric, exercise)` is a unique
    violation; once the first is `ABANDONED`, the second is accepted. Two `HABIT` goals (no exercise) collide the
    same way.
  - `the_seed_loads_the_badges`: after `seeded`, 22 badges, `FIRST_STEP`'s rule is
    `{"type": "COUNT", "event": "WORKOUT_ACCEPTED", "gte": 1}`; a disabled badge stays disabled after a second
    `backend::seed::run`, and the count stays 22.
- [ ] **Step 2:** apply the migration to the dev database, then `cargo test -j 4 --test schema` fails.
- [ ] **Step 3: implement** the seed change.
- [ ] **Step 4:** `cargo test -j 4 --test schema --test reference` passes.
- [ ] **Step 5:** commit `feat(backend): the goals and badges tables; the badge catalogue in the seed`.

### Task 3: the goal routes and the onboarding step

**Files:**

- Modify:
  - `apps/backend/src/modules/goals/mod.rs`: the routes;
  - `apps/backend/src/modules/scoring/mod.rs`: `expected` becomes `pub(crate)`;
  - `apps/backend/src/http/mod.rs`: `api()` adds `goals::routes`;
  - `apps/backend/src/modules/me/onboarding.rs`: `steps.goals` is `EXISTS (SELECT 1 FROM goals WHERE user_id = …)`;
  - `apps/backend/tests/onboarding.rs`.
- Create: `apps/backend/tests/goals.rs`.

**Interfaces:**

- **Consumes:** task 1's `planning`; `body::latest_weight_kg`, `body::has_consent`; `scoring::expected`,
  `records::Expected::get`; `engine::harder_level`, `engine::Direction::parse`; `state.health`.
- **Produces:**
  - `goals::routes(api: Api) -> Api`;
  - `pub async fn views(state: &AppState, user: Uuid, health: bool) -> Result<Vec<Value>, AppError>`: every goal
    of the account in the list order. `health` false gives `null` for a `WEIGHT` goal's values. The export
    (task 6) calls it with `true`.

`create` runs in one transaction that first locks the account row (ruling 2). A unique violation of
`uq_goals_one_active` (`db::duplicate_key`) is the same 409 as the duplicate check.

- [ ] **Step 1: write the failing tests** in `tests/goals.rs`. The athlete logs `strength` (3 × 5 × 100,
  E1RM 116.667) 48 h ago, in calibration, unless the test says otherwise. The derived level is `INTERMEDIATE`, so
  `pct` is 3.

  | Test | Asserts |
  |---|---|
  | `suggestions_rank_three_targets` | `{STRENGTH, squat, E1RM}`: `current` 116.667, `metric` `{E1RM, kg, HIGHER_IS_BETTER}`, `expectedPctPer28Days` 3, suggestions `SHORT` 120 `{3, 4}`, `MEDIUM` 125 `{7, 10}`, `LONG` 135 `{14, 20}`, `disclaimerKey` `goals.disclaimer`; without a workout, 422 `NO_CURRENT_VALUE` on `targetValue`; `type: WEIGHT` is 422 `INVALID` on `type` |
  | `a_strength_goal_plans_its_milestones` | `{STRENGTH, squat, E1RM, 125}`: 201 with `startValue` 116.667, `targetValue` 125, `direction` `INCREASE`, milestones `[120, 122.5, 125]` all unreached, `milestonesReached` 0, `status` `ACTIVE`, `visibility` `PRIVATE`, `startDate` today, `targetDate` and `safetyAdjustment` null, no `habitWeeksMet` key, `disclaimerKey`; `GET /goals` lists it without `disclaimerKey` |
  | `a_too_early_date_is_moved` | target 125 with `targetDate` tomorrow: `targetDate` is today + 49 days, `safetyAdjustment` `{reason: TOO_FAST, requestedTargetDate: <sent>, earliestRealisticWeeks: 7}` |
  | `targets_must_be_better_and_reachable` | target 115: `TARGET_NOT_BETTER` with `current` 116.667; target 1000: `UNREALISTIC_TARGET` with 3 `suggestions` |
  | `goal_bodies_are_checked` | each alone, 422 on its field: no `exerciseId` → `REQUIRED`; `TIME_5K` on `STRENGTH` → `metricCode` `NOT_ALLOWED_FOR_TYPE`; the `RUN` exercise with `E1RM` → `exerciseId` `METRIC_NOT_TRACKED`; `HABIT` with an `exerciseId` → `NOT_ALLOWED_FOR_TYPE`; `HABIT` 7 and 3.5 → `REST_DAY_REQUIRED`; `targetValue` 0 → `ISPOSITIVE`; `targetDate` `"soon"` → `ISISO8601`; `targetDate` today → `MUST_BE_IN_FUTURE`; an `xp` field → `UNKNOWN_FIELD` |
  | `a_habit_goal_counts_weeks` | `{HABIT, WORKOUTS_PER_WEEK, 3}`, no workout needed: `startValue` 0, `targetValue` 3, milestones `[2, 4, 8, 12]`, `habitWeeksMet` 0 |
  | `a_weight_goal_is_paced_safely` | consent, weigh-in 80: `{WEIGHT, BODY_WEIGHT, 76, targetDate: today + 7, visibility: PUBLIC}` gives `direction` `DECREASE`, `visibility` `PRIVATE`, milestones `[78, 76]`, `targetDate` today + 35, `safetyAdjustment` `{WEIGHT_RATE_LIMIT, <sent>, maxPctPerWeek: 1}`; in SQL its `start_value` is NULL and `start_value_enc` is not |
  | `weight_targets_stay_safe` | weigh-in 80: target 55 and 35 → `UNSAFE_TARGET`; 80.2 → `TARGET_NOT_BETTER`; without the consent (another athlete) → `NO_CURRENT_VALUE` |
  | `weight_values_need_the_consent` (review focus 3) | after the weight goal, the consent withdrawn: `GET /goals` gives `startValue`, `targetValue` and every milestone's `targetValue` null; the strength goal's values still show |
  | `one_active_goal_per_metric` | a second squat `E1RM` goal is 409 `CONFLICT` with `goalId`; `DELETE` the first (204), then the second is 201; the list has the `ACTIVE` one first, then the `ABANDONED` one; `DELETE` of the abandoned one is 204 and it stays `ABANDONED` |
  | `ten_active_goals_at_most` | ten active goals inserted in SQL on ten exercises: an eleventh is 409 `CONFLICT` |
  | `simultaneous_goals_make_one` (review focus 1) | `tokio::join!` of two identical creations: one 201, one 409; one row in SQL |
  | `goals_belong_to_their_owner` | another account's `DELETE` is 404 and its `GET /goals` is empty; `/goals/not-a-uuid` is 404 |

  In `tests/onboarding.rs`, `the_goals_step_follows_the_first_goal`: `steps.goals` (read through
  `POST /me/onboarding/baselines` with `entries: []`) is false, then true after a `HABIT` goal.
- [ ] **Step 2:** `cargo test -j 4 --test goals --test onboarding` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --test goals --test onboarding --test security` passes.
- [ ] **Step 5:** commit `feat(backend): goals: list, create with milestones and safety, suggestions, abandon; the onboarding goals step`.

### Task 4: milestones from workouts and weigh-ins

**Files:**

- Create: `apps/backend/src/modules/goals/milestones.rs`.
- Modify:
  - `apps/backend/src/modules/scoring/mod.rs`: the first `plan 2c` comment becomes the call;
  - `apps/backend/src/modules/me/body.rs`: `add` runs in a transaction that first locks `user_stats`, then credits;
  - `apps/backend/tests/goals.rs`.

**Interfaces:**

- **Consumes:** `ledger::append_xp`, `engine::Observation`, `PrOutcome`, `planning::{reached, credited_weight_change}`.
- **Produces:**
  - `pub async fn on_workout(tx: &mut MySqlConnection, state: &AppState, rules: &Rules, user: Uuid,
    workout_id: Uuid, at: DateTime<Utc>, observations: &[Observation], held: &HashSet<Uuid>) -> Result<(), AppError>`;
  - `pub async fn on_weigh_in(tx: &mut MySqlConnection, state: &AppState, rules: &Rules, user: Uuid,
    latest_kg: f64) -> Result<(), AppError>`;
  - both decrypt a `WEIGHT` goal's values with `state.health`.

  `score` computes `held` once and gives it to both `rewardable` and `on_workout`.

- [ ] **Step 1: write the failing tests** in `tests/goals.rs`:

  | Test | Asserts |
  |---|---|
  | `workouts_reach_milestones_once` (review focus 4) | the goal to 125; 105 × 5 (E1RM 122.5) 2 h ago: its points are `[WORKOUT 30, GOAL_MILESTONE 150, GOAL_MILESTONE 150]`; the first milestone entry's explanation is `{formula: goal_milestone_xp, inputs: {goalId, milestone: 1, of: 3}, workoutId, result: 150}`; the goal has `milestonesReached` 2 and both `reachedAt` set; 110 × 5 1 h ago adds one `GOAL_MILESTONE`, and the goal is `COMPLETED`; a fourth workout at 112.5 × 5 earns no `GOAL_MILESTONE`; `xp_total` equals the ledger's sum |
  | `an_abandoned_goal_is_not_credited` | goal to 125, abandoned, then 110 × 5: no `GOAL_MILESTONE` |
  | `a_held_record_reaches_no_milestone` (review focus 2) | calibration over; 100 × 5 60 h ago; the goal to 125; 140 × 5 1 h ago: the workout is accepted, its `E1RM` record `HELD`, and the goal has `milestonesReached` 0 |
  | `a_late_workout_reaches_no_milestone` | the goal to 125, then 110 × 5 performed 80 h ago: `milestonesReached` 0 |
  | `only_the_safe_rate_counts_toward_a_weight_goal` | weigh-in 80, goal to 76, its `start_date` moved 28 days back in SQL; a weigh-in at 76: one `GOAL_MILESTONE` entry with `workout_id` NULL; `milestonesReached` 1, `status` `ACTIVE` (credited ≈ 76.8: only 3.2 kg of the 4 count) |

- [ ] **Step 2:** `cargo test -j 4 --test goals` fails on these tests.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --test goals --test points --test body` passes.
- [ ] **Step 5:** commit `feat(backend): workouts and weigh-ins reach goal milestones, in their own transaction`.

### Task 5: awarding badges, and `GET /badges`

**Files:**

- Modify:
  - `apps/backend/src/modules/badges.rs`: `evaluate`, the facts, the route;
  - `apps/backend/src/modules/scoring/mod.rs`: the second `plan 2c` comment becomes the call;
  - `apps/backend/src/modules/me/body.rs`: `evaluate` after the crediting;
  - `apps/backend/src/http/mod.rs`: `api()` adds `badges::routes`.
- Create: `apps/backend/tests/badges.rs`.

**Interfaces:**

- **Produces:**
  - `pub async fn evaluate(tx: &mut MySqlConnection, user: Uuid, source_ref: Option<&str>) -> Result<Vec<String>,
    AppError>`;
  - `badges::routes(api: Api) -> Api`.

- [ ] **Step 1: write the failing tests** in `tests/badges.rs`:

  | Test | Asserts |
  |---|---|
  | `the_catalogue_shows_progress` | a new athlete: 22 badges; categories in the order `PROGRESS`, `CONSISTENCY`, `COMPETITION`, `SOCIAL`, `GYM`, `ELITE`; `FIRST_STEP` has `awardedAt` null and `progress` `{0, 1, false}`, a `name.fr` and a `rarity`; `GOLD_DIVISION` `{0, 3, false}` |
  | `a_first_workout_earns_first_step` | after `strength`: `FIRST_STEP` `awardedAt` set and `{1, 1, true}`; `TEN_WORKOUTS` `{1, 10, false}`; in SQL its `source_ref` is the workout id; `FIRST_PR` not awarded (a calibration record does not count) |
  | `completing_a_goal_earns_goal_getter` | the goal to 125, then 110 × 5: `GOAL_GETTER` awarded |
  | `a_weigh_in_can_award_a_badge` | the weight goal of task 4 with all its milestones reached by a weigh-in (start date 42 days back, so the safe rate allows the whole 4 kg; weigh-in 76): `GOAL_GETTER` awarded with no workout since |
  | `simultaneous_workouts_award_once` (review focus 5) | `tokio::join!` of two different workouts: both 201; one `FIRST_STEP` row |
  | `a_revoked_or_disabled_badge` | a disabled badge is not listed; a revoked award shows `awardedAt` null and is not given again by the next workout; a rule set to `{}` in SQL shows `progress` null |

- [ ] **Step 2:** `cargo test -j 4 --test badges` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --test badges --test goals --test points --test security` passes.
- [ ] **Step 5:** commit `feat(backend): badges awarded in the scoring and weigh-in paths; GET /badges`.

### Task 6: the export and the anonymisation

**Files:** modify `apps/backend/src/modules/me/privacy.rs` and `apps/backend/tests/privacy.rs`.

- The export's `goals` is `goals::views(state, user, true)`, in the list's order. `account.badges` is
  `[{code, awardedAt, revokedAt, sourceRef}]`, oldest first.
- `anonymise` deletes the account's `WEIGHT` goals (ruling 8).

- [ ] **Step 1: write the failing tests:**
  - `the_export_holds_goals_and_badges`: with the consent withdrawn after a weight goal to 76, the export's
    `goals` holds it with `targetValue` 76, and the strength goal; `account.badges` holds `FIRST_STEP`.
  - `anonymisation_deletes_weight_goals`: after the sweep, the weight goal and its milestones are gone, the
    strength goal and the badges stay.
- [ ] **Step 2:** `cargo test -j 4 --test privacy` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --test privacy` passes.
- [ ] **Step 5:** commit `feat(backend): the export carries goals and badges; anonymisation deletes weight goals`.

### Task 7: documents and checks

- [ ] **Step 1: update the documents:**
  - the README's backend section (the five routes);
  - the spec's status line (plan 2c built);
  - `handoff.md`;
  - a « Built » section at the end of this plan, for any departure from it.
- [ ] **Step 2:** `cargo sqlx prepare -- --all-targets`, with `DATABASE_URL` in the command's own environment;
  commit `.sqlx/`.
- [ ] **Step 3: run the checks** and read each output:
  - `cargo fmt --check`;
  - `cargo clippy --all-targets -- -D warnings`, then the same after `touch src/lib.rs` with `SQLX_OFFLINE=true`;
  - `cargo test -j 4`;
  - `cargo audit`;
  - `cargo deny check`.
- [ ] **Step 4:** commit `docs: Rust backend plan 2c built: README, spec, handoff; sqlx offline data`.

## Done when

- `cargo test` passes with `goals` and `badges` next to the earlier suites, and the security suite passes
  unchanged.
- In the app:
  - the goals screen lists goals with their milestone bar;
  - « Nouvel objectif » shows three suggestions and saves one;
  - the badges screen shows the earned badges and the progress bars.
