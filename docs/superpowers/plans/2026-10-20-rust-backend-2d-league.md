# Rust backend, plan 2d: league

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Date: 2026-10-20 · Spec: `docs/superpowers/specs/2026-10-18-rust-backend-training-loop-design.md` · Fourth and last
plan of part 2, after plan 2c (`docs/superpowers/plans/2026-10-19-rust-backend-2c-goals-badges.md`).

**Goal:** the running week shows its provisional score; the worker closes each week into a final score and its
League Points, closes each season with a soft reset into the next one, and keeps the ranks, the badges and the
balances up to date; the app reads its LP, division and ranks, and the national and governorate leaderboards.

**Architecture:**

- A new module, `modules/league`:
  - `engine.rs`: the pure rules of the old `fairness.ts`, `ledger.service.ts` (`divisionFor`),
    `seasons.service.ts` (`softReset`), the baseline audit and `badge-rules.ts` (`currentStreak`), unit-tested
    with the spec's vectors;
  - `weekly.rs`: the weekly score (the old `WeeklyScoreService`), the baseline audit, the weekly close and
    `GET /me/weekly-scores/current`;
  - `seasons.rs`: opening and closing seasons, the standings, `GET /me/lp`;
  - `boards.rs`: the leaderboards, `GET /me/ranks` and the daily snapshot;
  - `jobs.rs`: `job_runs`, `run_due` and the small jobs (calibration finalize, balance reconcile, badge sweep);
  - `mod.rs`: the routes.
- `scoring/ledger.rs` gains the LP ledger: it stays the only writer of both ledgers.
- `security/policy.rs` gains the business week and quarter.
- One migration, `0009_league.sql`. The seed opens the current quarter's season and schedules the next.
- The worker loop calls `league::jobs::run_due` every ten minutes, next to part 1's daily sweep.

**Tech stack:** Axum 0.8 and sqlx 0.9 on MariaDB 11.4, as in plan 2c. No new crate.

**Contract:** the old API's code, as the app calls it.

- **Old API:** `apps/api/src/modules/seasons/` (`seasons.service.ts`, `weekly-score.service.ts`,
  `seasons.controller.ts`, `seasons.spec.ts`), `leaderboards/`, `ledger/` (`appendLp`, `reverseLp`, `divisionFor`),
  `jobs/jobs.service.ts`, `scoring/engine/fairness.ts` and `engine.spec.ts`, `badges/badges.service.ts` (the
  `DIVISION` and `STREAK_WEEKS` facts, `sweep`), `goals/goals.service.ts` (`onWeekClosed`), the seasons of
  `database/seed.ts`.
- **The app's callers:** `features/me/api.ts` (`ranks`, `lp`, `currentWeek`), `features/home/screen.tsx`
  (`ranks.national`, `ranks.governorate`, `week.total`, `week.trainingDays`, `week.plannedDays`),
  `features/league/api.ts` and `screen.tsx` (rows: `rank`, `lp`, `level`, `division`, `movement`, `athlete`, `gym`,
  `governorate.name`).
- `apps/mobile-rn/assets/demo/api.json` records `GET /me/ranks`, `/me/lp`, `/me/weekly-scores/current`,
  `/leaderboards/national`, `/national/me`, `/governorates/:id` and `/governorates/:id/me`: the tests check the
  same keys and types (`assert_same_shape`).

**Where it is built:** this Windows checkout, branch `feat/rust-backend-2d` (from `feat/rust-backend-2c`, not yet in
`origin/main`), with the environment line of `handoff.md` §2.

## Global constraints

Plans 2a to 2c's constraints hold unchanged: no `unwrap` or `expect` outside tests and no `unsafe`; `user_id = ?`
in every query on an account's data; database errors through `AppError::from(sqlx::Error)`; query strings and
bodies with `deny_unknown_fields`, field paths, and every wrong field at once; timestamps through `types::iso`; ids
from `Uuid::now_v7()`; no health value in a log, an error or another account's answer; no new public route; only
`scoring/ledger.rs` writes the XP and LP ledgers; every XP or LP writer locks the athlete's `user_stats` row first.
And:

- **Jobs take the clock as a parameter** (`now: DateTime<Utc>`) and never read `UTC_TIMESTAMP()` or `Utc::now()`
  themselves, so the tests run them on a test clock.
- **Business time:** weeks start on Monday 00:00 and seasons on the first day of a quarter, in
  `cfg.business_utc_offset_minutes` (Tunisia, UTC+1). A week's `DATE` column and its LP source id hold the local
  date of its Monday.
- A leaderboard row never carries an email, a birth date or body data.
- Before the last commit: `cargo fmt --check`; Clippy `-D warnings` online and with `SQLX_OFFLINE=true` (after
  `touch src/lib.rs`); `cargo sqlx prepare -- --all-targets` with `.sqlx/` committed.

## Endpoints

| Route | Query | Answer |
|---|---|---|
| `GET /me/weekly-scores/current` | — | 200 `{weekStart, status: "PROVISIONAL", trainingDays, plannedDays, components: {progress, consistency, performance, challenge: null}, total, projectedLp, eligible, breakdown}` |
| `GET /me/lp` | — | 200 `{season: {id, name, startsAt, endsAt, status}, lp, division, nextDivision, lpToNextDivision}`; 404 `Season` without an active season |
| `GET /me/ranks` | — | 200 `{seasonId, national, governorate, gym: null, friends: null}`, a rank or `null` each; 404 `Season` |
| `GET /leaderboards/national` | `limit`, `cursor` | 200 `{seasonId, data: [Row], page: {nextCursor, hasMore}}`; 404 `Season` |
| `GET /leaderboards/national/me` | `limit` | 200 `{seasonId, me: Row \| null, data: [Row], page}` |
| `GET /leaderboards/governorates/:id` and `/:id/me` | as above | the same within the governorate; a malformed id is 404 `Governorate`, an unknown one an empty page |

- `Row` is `{rank, athlete: {id, username, fullName}, gym: null, governorate: {id, code, name: {fr, en, ar}}, lp,
  level, division, movement}`. `movement` is the rank gained since the latest earlier snapshot, or `"NEW"`.
- `limit` is `page::limit` (20 by default, 1 to 100); the cursor is `page::encode` of `{lp, id}`.
- `weekStart` is the `iso` instant of the week's Monday 00:00 local. `breakdown` is
  `{formula: "weekly_score", weights, trainingDays, plannedDays, metrics: [{exerciseId, metric, reference, current,
  ratio, progressScore, cappedForPlausibility, weekBest, performanceRatio}], topN, ruleSetVersion}`.
- `GET /me/lp`: `lp` and `division` are the athlete's when their current season is the active one, else 0 and
  `BRONZE`. `nextDivision` is the first division whose threshold is above `lp` (`null` at the top), and
  `lpToNextDivision` the LP still missing.

## The weekly score (docs §5.5, the old `computeWindow`)

For an athlete and a week `[start, start + 7 days)`, with the active rule set:

- **Workouts:** `ACCEPTED`, performed in the week, at least `workout_min_duration_min` long, and without a
  `LATE_LOG` hit in their evaluation. `trainingDays` is their number of distinct business days.
  `plannedDays` is `max(1, profile.planned_training_days_per_week)`.
- **Consistency:** `min(1, trainingDays / plannedDays) × 100`.
- **Per baseline** `FINAL` or `CORRECTED` (except `REPS_AT_WEIGHT`), with the athlete's observations of that
  exercise and metric that are qualifier 0, `counts_for_competition`, and before the week's end; skipped unless one
  of them is within the 56 days before the week's end:
  - `current` is the best of the last `progress_window_days` (28) before the week's end, `before` the best earlier,
    and `reference` the better of `before` and the baseline's `effective_value`;
  - with a `current`, the level is `harder_level` of the declared level and the baseline's level, and `pct` its
    expected percent (`scoring::expected`). When `pct` exists: `ratio = progress_ratio(improvement_pct(reference,
    current), pct)`, `cappedForPlausibility = ratio > progress_ceiling_ratio`, and `progressScore =
    metric_progress_score(min(ratio, progress_ceiling_ratio), progress_reward_cap)`;
  - `weekBest` is the best since the week's start; with it, `performanceRatio = performance_ratio(weekBest,
    all-time best)`.
- **Components:** `progress` is the mean of the `progress_top_n` (3) best scores; `performance` is `min(100, mean of
  the top 3 ratios × 100)` (the verification factor is 1 until part 5's proofs); `challenge` is `null` (part 4), so
  the weights are renormalised over the other three. Each is rounded to 2 decimals, and `total =
  weighted_total(...)` too.
- `eligible` is calibration over by the week's start; `lp` is `round(total × weekly_lp_per_point)` when eligible,
  else 0.

## The weekly close (docs §8, the old `closeWeek`)

The last closable week is the latest one whose end plus `week_grace_hours` (24) has passed. Its athletes are those
with an accepted workout performed in it, plus those with an active `HABIT` goal. Each in its own transaction,
which first locks `user_stats`:

1. A week that already has its `weekly_scores` row is skipped.
2. **The baseline audit** (§5.4): each `FINAL` baseline with a `finalized_at` before the week's end; its competition
   observations after `finalized_at` and before the earlier of the week's end and `finalized_at +
   baseline_audit_days`; their best against the baseline, through `engine::audited_baseline`. A baseline it raises
   becomes `CORRECTED`, with `corrected_from` the old value and `rule_set_version`.
3. **When a baseline was corrected,** every `weekly_scores` row of the athlete from the week holding the earliest
   corrected `finalized_at` up to this week is scored again: its LP entry, if any, is reversed, and a new
   `WEEKLY_SCORE` entry is posted when the new score earns LP, with source id `<date>#c<n>` (`n`: the entries
   already holding that week's source, reversals included). The row takes the new values (§5.10.3).
4. **The week's score:** its LP entry (`WEEKLY_SCORE`, source `week` / the Monday's local date, effective at the
   week's end, explanation `breakdown + {components, total, result}`) when `lp > 0` and a season of the athlete's
   country holds the week's start; then its `weekly_scores` row.
5. **The weekly streak:** `user_streaks.current_weeks` grows by one when `trainingDays >= plannedDays`, else falls
   to 0; `longest_weeks` keeps the maximum.
6. **The habit goals:** each active `HABIT` goal's `habit_weeks_met` grows by one when `trainingDays >=` its
   target, else falls to 0; then `milestones::credit` with that count, at the week's end.

## The LP ledger (docs §5.8, the old `appendLp` and `reverseLp`)

- `append_lp` inserts the entry, then, with `user_stats` locked: an entry of another season than the athlete's
  current one changes nothing more; otherwise `season_lp = max(0, season_lp + amount)`, `current_season_id` is the
  entry's season, and `division_code` is `engine::division_for(season_lp)`.
- `reverse_lp` inserts the opposite entry (`REVERSAL`, same source, `reverses_id`, explanation `{reverses, why}`,
  the original's `effective_at`) and moves the balance the same way. An entry already reversed, or a reversal, is
  not reversed.
- The database refuses the same `(user, reason, source)` twice and a second reversal of one entry.

## Seasons (docs §5.10.4, the old `SeasonsService`)

- **Open:** a `SCHEDULED` season whose start has passed becomes `ACTIVE`, unless its country has an active season.
- **Close,** once `ends_at + week_grace_hours` has passed, in one transaction:
  - the next season is the country's earliest `SCHEDULED` one starting at or after this one's end, else a new one
    for the following quarter, named `Season <year> Q<n>`;
  - **the standings:** every athlete of the season who is `ACTIVE`, email verified and has LP, with `final_lp`, the
    division, and `RANK() OVER (ORDER BY season_lp DESC)` nationally, per governorate and per gym; `is_champion`
    for a national or governorate first, `champion_scope` `NATIONAL` first, else `GOVERNORATE`;
  - **the soft reset:** every athlete of the season moves to the next one at 0 LP and `BRONZE`, then receives a
    `SEASON_SOFT_RESET` entry of `soft_reset(lp)` in the next season when it is above 0 (source `season` / the
    closed season's id, effective at the next season's start, explanation `{formula: "floor + (lp − floor) ×
    ratio", inputs: {lp, floor, ratio}, result}`);
  - the season becomes `CLOSED` with `closed_at` and `rule_set_version_at_close`, and the next one `ACTIVE`.

## Leaderboards (docs §15, the old `LeaderboardsService`)

- **Eligible:** in the active season (`current_season_id`), `ACTIVE`, email verified, calibration ended (by `now`),
  `show_on_leaderboards`.
- **Ranked** in SQL with `RANK() OVER (ORDER BY season_lp DESC)` within the scope; rows ordered by `lp` descending,
  then id. A page after the cursor `{lp, id}` takes `lp < c.lp OR (lp = c.lp AND id > c.id)`.
- **`/me`:** the `floor(limit / 2)` rows just above me, me, then a page after me filling `limit`. When the rest is
  empty, `page` is `{nextCursor: <my cursor>, hasMore: true}`, as in the old API.
- **Movement:** the latest snapshot of the season and scope dated before today (business date); `prev − rank`,
  or `"NEW"` when the athlete is not in it.
- **The snapshot** (daily): today's ranks of every eligible athlete, nationally (scope id: the zero id) and per
  governorate; a second run the same day adds nothing.

## The jobs (spec « Background jobs »)

`run_due(state, now)`, every ten minutes; each job runs once per key through `job_runs`, in this order:

| Job | Key | Work |
|---|---|---|
| `season-open` | today's local date | `seasons::open_due` |
| `season-close` | the season's id | `seasons::close`, for each `ACTIVE` season ended more than `week_grace_hours` ago |
| `weekly-close` | the closable week's local date | `weekly::close_week` |
| `calibration-finalize` | today | `PROVISIONAL` baselines with a `calibrated_value` whose calibration ended by `now` become `FINAL`: `effective_value` the better of declared and calibrated, `finalized_at` the calibration's end |
| `badge-sweep` | today | `badges::evaluate`, in its own transaction, for each athlete with an XP or LP entry, or a weekly score, written in the last 26 hours |
| `leaderboard-snapshot` | today | `boards::snapshot` |
| `balance-reconcile` | today | each athlete whose `xp_total` or `season_lp` differs from the ledgers: in a transaction that locks `user_stats`, both are recomputed (with the level and the division) |

- **`once(job, key)`:** an `INSERT IGNORE` of a `RUNNING` row claims the key. Otherwise one `UPDATE … WHERE status
  = 'FAILED' OR (status = 'RUNNING' AND started_at < now − 1 hour)` takes it over. A claim that changes no row
  skips the job. The job's result goes into `result` with `DONE`, its error into `error` with `FAILED`.
- A failed job is logged and the others still run.

## Badges

- **`DIVISION`:** the better of the rank of `user_stats.division_code` and the best division of the athlete's
  `season_standings`; 0 for none.
- **`STREAK_WEEKS`:** `engine::current_streak` of the athlete's 60 latest `weekly_scores`, a week met when its
  `consistency_c` is 100.

## Rulings

1. **No `divisions` table.** The six divisions are a closed set: the `badges::Division` enum in Rust, an `ENUM` in
   `season_standings`, and `user_stats.division_code` as it is. Their thresholds are the rule set's; their names,
   in `catalog.json`, are read by no route of part 2 (`GET /divisions` is not called).
2. **The soft reset follows the old code**, not ARCHITECTURE §5.10.4's ledger line: the next season starts at 0 and
   receives one positive `SEASON_SOFT_RESET` entry (1,240 LP gives +1,070), instead of a −170 entry.
3. **A season closes in one transaction**, `ACTIVE` to `CLOSED`, so a run that dies leaves it untouched for the
   next try; the old `CLOSING` status is not carried over. `shortcut: one transaction for the whole close, split
   it per athlete once a season holds many thousand athletes`.
4. **A week outside any season is still saved**, with `season_id` NULL and no LP, so the close stays idempotent
   per athlete (the old API skipped the row, and a rerun would count the streak twice).
5. **`weekly_scores` holds closed weeks only;** the running week is computed on read, so there is no `status`
   column (every row is final).
6. **The athletes' country decides their season** (`profiles.country_code`); the old API always took `TN`.
7. **No `seasonId` parameter** on `/me/lp` and the leaderboards: no caller sends it, and they answer the active
   season. Standings of past seasons are written but no route reads them yet.
8. **No audit entry for seasons:** the security audit trail names an account; a season's open and close are in
   `job_runs.result`.
9. **The seed opens seasons in Tunisia's fixed offset (UTC+1)**, the seed being Tunisia's; the worker uses
   `cfg.business_utc_offset_minutes`, 60 by default.
10. **Badges for division and streak come from the daily sweep,** as in the old API; the weekly close and the
    season close do not evaluate badges themselves.
11. **The correction's earliest week** is the week of the earliest `finalized_at` among the baselines corrected
    (the old API took the first one it met).
12. **Leaderboard snapshots cover the national and governorate scopes only**; the gym scope comes with part 3.
13. **`leaderboardEligible` in `GET /me` stays the stored column,** which nothing writes, as in the old API.
14. **Anonymisation changes nothing in the league tables:** the LP ledger, weekly scores, standings and snapshots
    hold no free text and keep pointing at the anonymous row, and the leaderboards skip accounts that are not
    `ACTIVE` (spec « Part 1 routes that change »).

## Review focus

1. A weekly close run twice, or by two workers at once, pays one LP entry per athlete and week (tasks 4 and 7).
2. A late-logged workout adds no training day and no progress to its week (task 3).
3. A leaderboard walked page by page while LP changes shows no athlete twice and loses none that stayed (task 6).
4. An ineligible athlete never appears, and their `/me` answers `me: null` (task 6).
5. An LP entry of a closed season, or its reversal, never moves the live balance of the new season (task 5).

---

### Task 1: the rule-set fields, the business calendar and the pure league rules

**Files:**

- Create: `apps/backend/src/modules/league/mod.rs` (`pub mod engine;` for now),
  `apps/backend/src/modules/league/engine.rs`.
- Modify: `apps/backend/src/modules/mod.rs`, `apps/backend/src/rules.rs`, `apps/backend/src/security/policy.rs`,
  `apps/backend/src/modules/badges.rs`.

**Interfaces (produces):**

- `badges::Division` gains `Hash`, `pub const ALL: [Division; 6]`, `as_str(self) -> &'static str` and
  `rank(self) -> i64` (Bronze 1 to Elite 6; `Rule::target` uses it).
- `Rules` gains `progress_window_days: i64`, `progress_reward_cap: f64`, `progress_top_n: usize`,
  `lp_weights: LpWeights {progress, consistency, performance, challenge: f64}` (`Serialize` too),
  `weekly_lp_per_point: f64`, `week_grace_hours: i64`, `season_soft_reset_ratio: f64`,
  `division_thresholds: HashMap<Division, i64>`, `baseline_audit_days: i64`.
- In `policy.rs`: `week_start(at: DateTime<Utc>, offset: i32) -> DateTime<Utc>` (Monday 00:00 local) and
  `quarter_bounds(at: DateTime<Utc>, offset: i32) -> (DateTime<Utc>, DateTime<Utc>)`.
- In `league/engine.rs`, using `scoring::engine::Direction`:
  - `metric_progress_score(ratio: f64, reward_cap: f64) -> f64`, `top_n_mean(values: &[f64], n: usize) -> f64`,
    `consistency(training_days: i64, planned_days: i64) -> f64`,
    `performance_ratio(week_best: f64, all_time: f64, d: Direction) -> f64`;
  - `#[derive(Serialize)] pub struct Components {progress: f64, consistency: f64, performance: f64, challenge:
    Option<f64>}` and `weighted_total(c: &Components, w: &LpWeights) -> f64`;
  - `division_for(lp: i64, t: &HashMap<Division, i64>) -> Division`,
    `next_division(lp: i64, t) -> Option<(Division, i64)>` (the division and the LP missing),
    `division_floor(lp: i64, t) -> i64`, `soft_reset(lp: i64, t, ratio: f64) -> i64`;
  - `audited_baseline(baseline: f64, best: f64, elapsed_days: f64, pct: f64, d: Direction, ceiling: f64,
    window_days: f64) -> Option<f64>`: `allowed = ceiling × pct × max(1, elapsed) / window`; `None` while
    `improvement_pct(baseline, best) <= allowed`, else the best divided (higher is better) or multiplied (lower)
    by `1 + allowed / 100`, rounded to 3 decimals;
  - `current_streak(weeks: &[(NaiveDate, bool)]) -> i64`: newest first after sorting; stops at a missed week or
    a gap (a week not 7 days before the previous one);
  - `last_closable_week(now: DateTime<Utc>, grace_hours: i64, offset: i32) -> DateTime<Utc>`.

- [ ] **Step 1: write the failing unit tests:**
  - `the_worked_example_of_5_10_1`: Sami's progress `metric_progress_score(progress_ratio(improvement_pct(60, 65),
    8), 1.5)` ≈ 69.4 and Karim's (200 → 202 at 1 %) ≈ 66.7; with a challenge (100 and 0), totals ≈ 87.8 and 66.3;
    without (`challenge: None`), ≈ 85.6 and 78.0 (all within 0.05). Karim's performance is
    `top_n_mean([1, 140/145], 3) × 100`.
  - `rewards_are_capped`: `metric_progress_score(3, 1.5)` is 100; 95 after 100 at 3 % scores 0;
    `consistency(6, 3)` is 100 and `consistency(1, 3)` ≈ 33.33; `performance_ratio(1500, 1440, Lower)` ≈ 0.96;
    `top_n_mean([], 3)` is 0 and `top_n_mean([10, 50, 30, 20], 3)` ≈ 33.33.
  - `divisions_follow_lp`: 0, 399, 400, 1240, 2599, 5000 give `BRONZE`, `BRONZE`, `SILVER`, `GOLD`, `DIAMOND`,
    `ELITE`; `next_division(1240)` is `(PLATINUM, 160)`, `next_division(2600)` `None`.
  - `the_soft_reset`: 1240 → 1070, 900 → 900, 86 → 43, 0 → 0; `division_floor(3000)` is 2600.
  - `nours_baseline_is_corrected`: `audited_baseline(50, 64, 28, 8, Higher, 2, 28)` is `Some(55.172)`;
    `(50, 58, 28, …)` is `None`; `(50, 52.5, 7, …)` is `Some(50.481)`.
  - `the_weekly_streak`: the vectors of `badge-rules.spec.ts` (3, 0, 2, 0).
  - `last_closable_week`: on Tuesday 2026-10-20 10:00Z it is 2026-10-11 23:00Z; on Monday 2026-10-19 10:00Z it is
    2026-10-04 23:00Z.
  - In `policy.rs`, `weeks_and_quarters`: `week_start` of 2026-10-20 10:00Z, of 2026-10-18 23:30Z and of
    2026-10-18 22:30Z (offset 60) are 2026-10-18 23:00Z, 2026-10-18 23:00Z and 2026-10-11 23:00Z;
    `quarter_bounds(2026-10-20 10:00Z)` is (2026-09-30 23:00Z, 2026-12-31 23:00Z).
  - `rules::tests::the_seeded_rule_set_reads` also asserts `progress_top_n` 3, `division_thresholds[GOLD]` 900,
    `lp_weights.progress` 0.4, `week_grace_hours` 24, `season_soft_reset_ratio` 0.5, `baseline_audit_days` 28.
- [ ] **Step 2:** `cargo test -j 4 --lib league policy rules` fails to compile.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --lib` passes.
- [ ] **Step 5:** commit `feat(backend): the league rules as pure functions; the business week and quarter`.

### Task 2: the tables, and the seasons in the seed

**Files:**

- Create: `apps/backend/migrations/0009_league.sql`.
- Modify: `apps/backend/src/seed.rs`, `apps/backend/tests/schema.rs`.

**Migration** (part 1's conventions):

- **`seasons`:** `id`, `name VARCHAR(40)`, `country_code CHAR(2) ascii` (FK `countries`), `starts_at`, `ends_at`
  `DATETIME(6)`, `status ENUM('SCHEDULED','ACTIVE','CLOSED') DEFAULT 'SCHEDULED'`, `closed_at NULL`,
  `rule_set_version_at_close INT NULL`, `created_at`, `updated_at`; `CHECK (ends_at > starts_at)`;
  `active_slot TINYINT AS (IF(status = 'ACTIVE', 1, NULL)) STORED` under `UNIQUE (country_code, active_slot)`;
  `KEY (country_code, status)`.
- **`league_point_transactions`:** as `xp_transactions` (no cascade, `once_slot`, the two unique keys, the two
  checks, the two triggers), with `season_id` (FK) and `reason ENUM('WEEKLY_SCORE','BATTLE_WIN','BATTLE_DRAW',
  'BATTLE_PARTICIPATION','GYM_WAR','SEASON_SOFT_RESET','REVERSAL','MODERATION','ADMIN_ADJUSTMENT')`, and no
  `workout_id`; `KEY (user_id, season_id, created_at)`.
- **`weekly_scores`:** `id`, `user_id` (cascade), `week_start DATE`, `season_id NULL` (FK), `rule_set_version`,
  `progress_c`, `consistency_c`, `performance_c` `DECIMAL(5,2)`, `challenge_c DECIMAL(5,2) NULL`,
  `total DECIMAL(5,2)`, `breakdown JSON CHECK`, `lp_transaction_id BINARY(16) NULL`, `created_at`, `updated_at`;
  `UNIQUE (user_id, week_start)`, `KEY (season_id, week_start)`.
- **`season_standings`:** `season_id`, `user_id` (both FK), `final_lp INT`, `division ENUM('BRONZE','SILVER','GOLD',
  'PLATINUM','DIAMOND','ELITE')`, `rank_national`, `rank_governorate`, `rank_gym` `INT NULL`, `is_champion BOOLEAN`,
  `champion_scope ENUM('NATIONAL','GOVERNORATE') NULL`, `created_at`; `PRIMARY KEY (season_id, user_id)`.
- **`leaderboard_snapshots`:** `snapshot_date DATE`, `season_id` (FK), `scope_type ENUM('NATIONAL','GOVERNORATE')`,
  `scope_id BINARY(16)` (the zero id for national), `user_id` (FK, cascade), `rank INT`, `lp INT`;
  `PRIMARY KEY (snapshot_date, scope_type, scope_id, user_id)`, `KEY (season_id, scope_type, scope_id,
  snapshot_date)`.
- **`job_runs`:** `id`, `job VARCHAR(40) ascii`, `run_key VARCHAR(64) ascii`, `status ENUM('RUNNING','DONE',
  'FAILED')`, `result JSON NULL CHECK`, `error VARCHAR(2000) NULL`, `started_at`, `finished_at NULL`;
  `UNIQUE (job, run_key)`.
- `baselines` gains `corrected_from DECIMAL(12,3) NULL` and `rule_set_version INT NULL`; `user_stats` gets its
  foreign key to `seasons`.

**Seed:** after the catalog, in a transaction that first reads the country's seasons `FOR UPDATE`: the current
quarter (`ACTIVE`, or `SCHEDULED` when the country already has an active season) and the next one (`SCHEDULED`),
each skipped when it overlaps an existing season. `Summary` gains `seasons` (how many it created).

- [ ] **Step 1: write the failing tests** in `tests/schema.rs`:
  - `the_lp_ledger_is_append_only_and_grants_once`: as the XP test; an `UPDATE` and a `DELETE` are refused, the
    same `(user, reason, source)` twice is a unique violation, a second reversal of one entry too.
  - `one_active_season_per_country`: a second `ACTIVE` `TN` season is a unique violation; a `CLOSED` one is not.
  - `the_seed_opens_this_quarter`: after `seeded`, one `ACTIVE` `TN` season holds now, is named
    `Season <year> Q<n>`, and one `SCHEDULED` starts at its end; a second `seed::run` creates none.
- [ ] **Step 2:** apply the migration to the dev database, then `cargo test -j 4 --test schema` fails.
- [ ] **Step 3: implement** the seed change.
- [ ] **Step 4:** `cargo test -j 4 --test schema --test reference` passes.
- [ ] **Step 5:** commit `feat(backend): the league tables; the seasons in the seed`.

### Task 3: the weekly score, and `GET /me/weekly-scores/current`

**Files:**

- Create: `apps/backend/src/modules/league/weekly.rs`, `apps/backend/tests/league.rs`.
- Modify: `apps/backend/src/modules/league/mod.rs` (`routes`), `apps/backend/src/http/mod.rs`,
  `apps/backend/tests/common/mod.rs` (`calibrated(app, user)`: email verified, calibration ended 30 days ago).

**Interfaces:**

- **Consumes:** task 1's engine; `scoring::expected`, `records::Expected::get`, `engine::{harder_level,
  improvement_pct, progress_ratio, is_better}`.
- **Produces:**
  - `pub struct WeeklyScore {week_start: DateTime<Utc>, training_days: i64, planned_days: i64, components:
    Components, total: f64, lp: i64, eligible: bool, breakdown: Value}`;
  - `pub async fn compute(conn: &mut MySqlConnection, rules: &Rules, user: Uuid, week_start: DateTime<Utc>,
    offset: i32) -> Result<WeeklyScore, AppError>`;
  - `league::routes(api: Api) -> Api`.

- [ ] **Step 1: write the failing tests** in `tests/league.rs`. A calibrated athlete logs `strength` 1 minute
  after the current week's start, or 2 hours ago, whichever is later.

  | Test | Asserts |
  |---|---|
  | `the_running_week_is_provisional` | `weekStart` is `iso(week_start(now))`, `status` `PROVISIONAL`, `trainingDays` 1, `plannedDays` 3, `consistency` 33.33, `challenge` null, `eligible` true, `projectedLp` = `round(total)`, `breakdown.formula` `weekly_score`, `breakdown.topN` 3, `breakdown.weights.progress` 0.4; the same shape as the recorded answer |
  | `a_calibrating_athlete_projects_no_lp` | calibration not over: `eligible` false, `projectedLp` 0 |
  | `a_late_log_counts_for_nothing` (review focus 2) | a workout performed 80 h ago: `weekly::compute` of its week gives `trainingDays` 0 and no metric |
  | `progress_is_measured_against_the_expected_rate` | a `FINAL` squat `E1RM` baseline at 112.5, level `INTERMEDIATE` (SQL), then `strength` (116.67): its metric has `reference` 112.5, `current` 116.67, `ratio` 1.235, `progressScore` 82.3, `weekBest` 116.67, `performanceRatio` 1; `components.progress` 82.3, `performance` 100 |

  The route walker of `tests/security.rs` checks the 401 without a token.
- [ ] **Step 2:** `cargo test -j 4 --test league` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --test league --test security` passes.
- [ ] **Step 5:** commit `feat(backend): the weekly score; GET /me/weekly-scores/current`.

### Task 4: the LP ledger and the weekly close

**Files:**

- Modify:
  - `apps/backend/src/modules/scoring/ledger.rs`: the LP ledger;
  - `apps/backend/src/modules/league/weekly.rs`: the audit and the close;
  - `apps/backend/src/modules/goals/milestones.rs`: `on_week_closed`; `active` selects the goals by type (a `HABIT`
    goal's direction is already `INCREASE`);
  - `apps/backend/src/modules/me/privacy.rs`: the export's `leaguePointTransactions`;
  - `apps/backend/tests/league.rs`, `apps/backend/tests/privacy.rs`.

**Interfaces:**

- **Produces:**
  - `pub struct LpEntry {user: Uuid, season: Uuid, amount: i64, reason: &'static str, source_type: &'static str,
    source_id: String, explanation: Value, effective_at: DateTime<Utc>}`;
  - `pub async fn append_lp(tx: &mut MySqlConnection, rules: &Rules, e: LpEntry) -> Result<Uuid, AppError>`;
  - `pub async fn reverse_lp(tx: &mut MySqlConnection, rules: &Rules, original: Uuid, why: &str) ->
    Result<Option<Uuid>, AppError>`;
  - `pub async fn close_week(state: &AppState, rules: &Rules, week_start: DateTime<Utc>) -> Result<Value,
    AppError>`, answering `{users, lpPosted}`;
  - `pub async fn on_week_closed(tx: &mut MySqlConnection, rules: &Rules, user: Uuid, training_days: i64,
    at: DateTime<Utc>) -> Result<(), AppError>`.

- [ ] **Step 1: write the failing tests.** Tests that move data into past weeks first move the active season's start
  90 days back (SQL).

  | Test | Asserts |
  |---|---|
  | `closing_a_week_pays_its_lp_once` (review focus 1) | planned days 1 (SQL); after `close_week` of the workout's week, twice: one `WEEKLY_SCORE` entry, source the Monday's local date, amount the score's `lp`, effective at the week's end, explanation `total` and `components`; one `weekly_scores` row with that `total` and `lp_transaction_id`; `user_stats` `season_lp` the amount, `current_season_id` the active season, `division_code` `BRONZE`; `current_weeks` and `longest_weeks` 1; `GET /me` `stats.seasonLp` the amount |
  | `a_week_without_a_season_pays_nothing` | the seasons moved away (SQL): the row is saved with `season_id` NULL and no entry |
  | `a_habit_goal_counts_its_weeks` | a `HABIT` goal of 1 day with `habit_weeks_met` 1 (SQL); a workout this week; after the close, `habitWeeksMet` 2, its first milestone reached with a `GOAL_MILESTONE` entry; an athlete with the same goal and no workout falls to 0 |
  | `a_corrected_baseline_rescores_the_paid_weeks` | a `FINAL` squat `E1RM` baseline at 50, finalized 20 days ago (SQL); `strength` logged, then moved 13 days back (`performed_at`, `observed_at`); its week closed (an entry `L1`); `lifting` 105 × 5 now; this week closed: the baseline is `CORRECTED` with `corrected_from` 50 and `rule_set_version` 2; `L1` has a `REVERSAL`; a new `WEEKLY_SCORE` entry whose source starts with `<L1's date>#c` and whose amount is lower; the old week's row points at it; `season_lp` equals the sum of the season's entries |
  | `the_export_holds_league_points` | in `tests/privacy.rs`: after a close, `leaguePointTransactions` holds `{id, seasonId, amount, reason, sourceType, sourceId, reversesId, ruleSetVersion, explanation, effectiveAt, createdAt}` |
- [ ] **Step 2:** `cargo test -j 4 --test league --test privacy` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --test league --test privacy --test goals --test points` passes.
- [ ] **Step 5:** commit `feat(backend): the LP ledger; the weekly close with the baseline audit, the streak and the habit goals`.

### Task 5: seasons, and `GET /me/lp`

**Files:**

- Create: `apps/backend/src/modules/league/seasons.rs`.
- Modify: `apps/backend/src/modules/league/mod.rs`, `apps/backend/src/seed.rs` (calls `seasons::plan`),
  `apps/backend/tests/league.rs`.

**Interfaces:**

- **Produces:**
  - `pub async fn plan(tx: &mut MySqlConnection, country: &str, now: DateTime<Utc>, offset: i32) ->
    Result<usize, sqlx::Error>`: the seed's season creation;
  - `pub async fn open_due(db: &MySqlPool, now: DateTime<Utc>) -> Result<Value, AppError>`;
  - `pub async fn close(state: &AppState, rules: &Rules, season: Uuid, now: DateTime<Utc>) -> Result<Value,
    AppError>`, answering `{standings, nextSeasonId}`;
  - `pub async fn active(db: &MySqlPool, country: &str) -> Result<Option<Season>, AppError>` with
    `Season {id, name, starts_at, ends_at, status}`.

- [ ] **Step 1: write the failing tests:**

  | Test | Asserts |
  |---|---|
  | `my_lp_in_the_season` | `season_lp` 1240, `division_code` `GOLD`, the active season (SQL): `{season: {id, name, startsAt, endsAt, status: ACTIVE}, lp: 1240, division: GOLD, nextDivision: PLATINUM, lpToNextDivision: 160}`, the recorded shape; a new athlete: 0, `BRONZE`, `SILVER`, 400 |
  | `closing_a_season_soft_resets_into_the_next` | the active season ends 2 days ago, the next starts then (SQL); verified athletes A (1240) and B (86), and C (500, unverified), all in it; `close`: standings A rank 1 champion `NATIONAL`, B rank 2, no C; A in the next season at 1070 `GOLD` with one `SEASON_SOFT_RESET` entry of 1070 effective at its start; B at 43; C at 250; the season `CLOSED` with `closed_at`, the next `ACTIVE`; a second `close` changes nothing |
  | `an_old_season_entry_moves_nothing` (review focus 5) | after that close, `reverse_lp` of an entry of A in the closed season: the reversal exists, A's `season_lp` stays 1070 |
  | `a_season_without_a_successor_creates_one` | no scheduled season: `close` creates `Season <year> Q<n>` starting at the end, `ACTIVE` |
  | `seasons_open_when_due` | the active season closed and the scheduled one due (SQL): `open_due` makes it `ACTIVE`; with an active season present, a due one stays `SCHEDULED` |
- [ ] **Step 2:** `cargo test -j 4 --test league` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --test league --test schema` passes.
- [ ] **Step 5:** commit `feat(backend): seasons open and close with standings and the soft reset; GET /me/lp`.

### Task 6: the leaderboards, `GET /me/ranks` and the snapshot

**Files:**

- Create: `apps/backend/src/modules/league/boards.rs`, `apps/backend/tests/leaderboards.rs`.
- Modify: `apps/backend/src/modules/league/mod.rs`.

**Interfaces:**

- **Produces:** `pub async fn snapshot(db: &MySqlPool, now: DateTime<Utc>, offset: i32) -> Result<Value, AppError>`,
  answering `{rows}`.

The tests rank athletes set up in SQL: verified, calibrated, in the active season with a given `season_lp` and
division.

- [ ] **Step 1: write the failing tests** in `tests/leaderboards.rs`:

  | Test | Asserts |
  |---|---|
  | `the_national_board` | LP 1520, 1240, 1240, 900, 10: ranks 1, 2, 2, 4, 5, the tie by id; each row's shape is the recorded one; `gym` null, `movement` `NEW` |
  | `pages_hold_under_inserts` (review focus 3) | `limit` 2: a page and a cursor; an athlete at 2000 inserted; following the cursors gives every first athlete once |
  | `only_eligible_athletes_rank` (review focus 4) | unverified, calibrating, opted out, `DELETED`, or without a season: none listed; their `/national/me` is `{me: null, data: [], page: {hasMore: false}}` |
  | `my_page_is_centred_on_me` | 9 athletes, I am 5th, `limit` 4: `me.rank` 5 and `data` ranks 3, 4, 5, 6 |
  | `the_governorate_board` | two governorates: each lists its own athletes ranked from 1; `/governorates/not-a-uuid` is 404 |
  | `my_ranks` | `{seasonId, national: 2, governorate: 1, gym: null, friends: null}`, the recorded shape; an ineligible athlete has `national: null` |
  | `movement_follows_the_last_snapshot` | `snapshot` at yesterday's date, then two athletes swap LP: movements +1 and −1; one added since: `NEW` |
  | `a_forged_cursor_is_refused` | 422 `INVALID_CURSOR` on `cursor` |
  | `no_active_season` | every route answers 404 `Season` |
- [ ] **Step 2:** `cargo test -j 4 --test leaderboards` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test -j 4 --test leaderboards --test security` passes.
- [ ] **Step 5:** commit `feat(backend): national and governorate leaderboards, my ranks, the daily snapshot`.

### Task 7: the jobs, the last badge facts, and the worker

**Files:**

- Create: `apps/backend/src/modules/league/jobs.rs`.
- Modify: `apps/backend/src/modules/badges.rs` (the two facts), `apps/backend/src/main.rs` (the worker loop),
  `apps/backend/tests/league.rs`.

**Interfaces:**

- **Produces:**
  - `pub async fn once<F>(db: &MySqlPool, job: &str, key: &str, now: DateTime<Utc>, work: F) -> Result<bool,
    AppError>` where `F: Future<Output = Result<Value, AppError>>`: true when it ran;
  - `pub async fn run_due(state: &AppState, now: DateTime<Utc>) -> Result<(), AppError>`.

- [ ] **Step 1: write the failing tests:**

  | Test | Asserts |
  |---|---|
  | `a_job_runs_once_per_key` | `once` runs, then skips; a `RUNNING` row 2 h old is taken over, one 10 min old is not; a `FAILED` row is retried; two `once` at the same instant run the work once; the row ends `DONE` with the result |
  | `the_worker_closes_the_week_once` (review focus 1) | a workout; `run_due` at the week's end + 25 h, twice: one `WEEKLY_SCORE` entry; `job_runs` holds `weekly-close` with the Monday's date, `DONE` |
  | `calibration_finalizes_on_its_day` | a `PROVISIONAL` baseline, declared 90, calibrated 100, calibration ended yesterday (SQL): after `run_due`, `FINAL`, 100, `finalized_at` the calibration's end |
  | `balances_are_reconciled` | `xp_total` and `season_lp` changed in SQL: `run_due` restores the ledgers' sums, the level and the division |
  | `the_sweep_awards_division_and_streak_badges` | `GOLD` with an LP entry today: `GOLD_DIVISION` awarded; four consecutive closed weeks with `consistency_c` 100 (SQL): `STREAK_4`; `GET /badges` shows `GOLD_DIVISION` `{3, 3, true}` |
- [ ] **Step 2:** `cargo test -j 4 --test league` fails.
- [ ] **Step 3: implement**, and call `run_due` from the worker loop every ten minutes; a failure is logged and
  tried again in a minute, as the daily sweep does.
- [ ] **Step 4:** `cargo test -j 4 --test league --test badges --test jobs` passes.
- [ ] **Step 5:** commit `feat(backend): the league jobs once per key; division and streak badges; the worker runs them`.

### Task 8: documents and checks

- [ ] **Step 1: update the documents:**
  - the README's backend section (the seven routes, the worker's jobs);
  - the spec's status line (plan 2d built, part 2 complete);
  - `handoff.md`;
  - a « Built » section at the end of this plan, for any departure from it.
- [ ] **Step 2:** `cargo sqlx prepare -- --all-targets`, with `DATABASE_URL` in the command's own environment;
  commit `.sqlx/`.
- [ ] **Step 3: run the checks** and read each output:
  - `cargo fmt --check`;
  - `cargo clippy --all-targets -- -D warnings`, then the same after `touch src/lib.rs` with `SQLX_OFFLINE=true`;
  - `cargo test -j 4 --no-fail-fast`;
  - `cargo audit`;
  - `cargo deny check`.
- [ ] **Step 4:** commit `docs: Rust backend plan 2d built: README, spec, handoff; sqlx offline data`.

## Done when

- `cargo test` passes with `league` and `leaderboards` next to the earlier suites, and the security suite passes
  unchanged.
- The worker closes a week and a season on a test clock (the tests of tasks 5 and 7).
- In the app: the home screen shows the national and governorate ranks and this week's score; the league screen
  lists the national and governorate boards with the movement arrows, and jumps to my rank.
