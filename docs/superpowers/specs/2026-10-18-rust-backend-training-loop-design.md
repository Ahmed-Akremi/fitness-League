# Rust + MariaDB backend, part 2: training loop — design

Date: 2026-10-18 · Status: plans 2a and 2b built (2026-10-19), plans 2c and 2d built (2026-10-20): part 2 is complete; the rulings are open to the owner's review · Frame: part 1
(`docs/superpowers/specs/2026-10-06-rust-backend-foundation-design.md`): its conventions, security rules, rate-limit
plumbing, testing approach and CI apply unchanged and are not repeated here.

## Intent

An athlete logs a workout in the app, online or offline, and the Rust API turns it into what the app shows: XP and
level, records, progress charts, goals and their milestones, badges, the provisional weekly score, League Points,
division and rank.

Nothing in this part is a new product decision. The rules come from three places:

1. **`docs/ARCHITECTURE.md`**: the workout → points flow (§2.3), the schema (§3.4 to §3.7, badges in §3.10), the
   scoring engine with its worked examples (§5), anti-cheat layer 1 and its thresholds (§7.1, §7.2), the jobs
   (§8) and the offline sync protocol (§10).
2. **The owner's standing decisions** in `handoff.md` §1.
3. **The old API** (`apps/api/src/modules/`: `workouts`, `anticheat/rules.ts`, `scoring`, `ledger`, `progress`,
   `goals`, `seasons`, `leaderboards`, `badges`, and the body measurements of `users/privacy.service.ts`). It is
   the reference implementation. It settles the questions ARCHITECTURE.md §12.1 left open: weights renormalised
   while challenges are off, a weekly streak plus a daily streak where planned rest never breaks it, live
   divisions with a soft reset, and late logs kept for history only.

**Ruling 1.** Where ARCHITECTURE.md and the old API's code differ, the code wins: it is what the app was built and
tested against. Example: the doc plans Redis sorted sets for leaderboards; the code ranks in SQL.

**Part 2 is done when** an athlete pointed at the Rust API logs workouts (one by one and through an offline batch)
and sees their points with the explanation, their records, progress, goals, badges, this week's provisional score,
their LP, division and national and governorate ranks; the worker closes a week and a season on a test clock; and
the test suites below pass, the security suite included.

## Scope of part 2

Base path `/api/v1`, every route for a signed-in app user. 22 endpoints, the ones the app calls
(`apps/mobile-rn/src/features/{workouts,progress,goals,badges,me,league}` and `core/offline/workout-sync.ts`):

| Area | Method and path | Success |
|---|---|---|
| Workouts | `POST /workouts` (header `Idempotency-Key` = `clientId`) | 201 created, 200 replay, 409 `IDEMPOTENCY_CONFLICT`, 422 `WORKOUT_REJECTED` with `ruleHits` |
| | `POST /workouts/sync` (≤ 50 items) | 200 `{results: [{clientId, result: CREATED\|REPLAYED\|REJECTED\|CONFLICT\|INVALID, workout?, error?}]}` |
| | `GET /workouts?limit&cursor&from&to&sportId` | 200 page, own workouts, newest first |
| | `GET /workouts/:id` | 200 workout with its evaluation (owner only, see below) |
| | `GET /workouts/:id/points` | 200 `{totalXp, entries: [{reason, amount, explanation}]}` |
| Progress | `GET /me/progress?period=7d\|30d\|3m\|6m\|1y` | 200 summary |
| | `GET /me/progress/metrics/:exerciseId/:metricCode?period=` | 200 chart series |
| | `GET /me/records` | 200 current records |
| Body | `GET /me/body-measurements`, `POST /me/body-measurements` | 200 list, 201 created; 403 `CONSENT_REQUIRED` without the `HEALTH_DATA` consent |
| Goals | `GET /goals`, `POST /goals`, `DELETE /goals/:id` | 200 list, 201 goal, 204 (abandon) |
| | `POST /goals/suggestions` `{type, exerciseId, metricCode}` | 200 ranked suggestions with an ETA range |
| Badges | `GET /badges` | 200 the catalogue with my progress and awards |
| League | `GET /me/ranks` | 200 `{seasonId, national, governorate, gym, friends}` |
| | `GET /me/lp` | 200 `{season, lp, division, nextDivision, lpToNextDivision}` |
| | `GET /me/weekly-scores/current` | 200 the running week's provisional score and breakdown |
| | `GET /leaderboards/national`, `/national/me` | 200 page of rows; `/me` is the page centred on me |
| | `GET /leaderboards/governorates/:id`, `/governorates/:id/me` | same |

Bodies, answers, field codes and error codes are those of the old API as the app calls them; each plan lists them
route by route.

Part 1 routes that change:

- `GET /me`: `stats` (XP, level, LP, division) and `streak` now carry real values.
- `GET /me/export`: its five empty keys (`workouts`, `goals`, `bodyMeasurements`, `xpTransactions`,
  `leaguePointTransactions`) are filled. Body data is decrypted for the owner.
- `DELETE /me` anonymisation (`me/privacy.rs::anonymise`) also deletes body measurements, clears goal values and
  workout notes, and makes workouts private. Ledgers, records and weekly scores stay and keep pointing at the
  anonymous row. Leaderboards already skip accounts that are not `ACTIVE`.
- The onboarding state's `goals` step becomes `true` once the account has a goal.

### Left out, on purpose

- **Not called by any frontend**:
  - `PATCH` and `DELETE /workouts/:id`, so there is no 24-hour edit window and no rescoring on edit (**ruling 6**);
  - `/me/xp` and `/me/xp/transactions`, `/me/lp/transactions`, `/me/weekly-scores`;
  - `/seasons…`, `/divisions`, `/me/baselines`, `/me/records/:id`;
  - `GET` and `PATCH /goals/:id`, `/me/badges`, `/users/:username/workouts`.
- **Part 3, because they read its tables** (**ruling 5**):
  - `/leaderboards/gyms/:id` and `/leaderboards/friends`, each with `/me`. Until then `GET /me/ranks` answers
    `gym: null, friends: null`;
  - other people's workouts, which follow visibility and friendships; part 2 answers 404 for any workout that is
    not the caller's;
  - activity events for the feed, the notifications a badge or a level-up sends, and live socket events
    (**ruling 9**);
  - the challenge component of the weekly score. Rule set v2 has it off, so the weights are renormalised over the
    other three, as in the old API;
  - the badges whose fact belongs to a later part (friends, gym, battles, duels, gym wars, challenges). `GET /badges`
    lists the whole catalogue, and those show zero progress until their part awards them.
- **Part 5, with the moderation that uses them** (**ruling 5**):
  - workout proofs (`GET`, `POST`, `DELETE /workouts/:id/proofs`), together with file storage, image re-encoding
    and the moderator queue that verifies them. Until then no workout is verified, so the verification factor is
    1. The app's proofs card renders nothing when its request fails, so the workout screen stays usable;
  - the held-workout queue (`/admin/workouts/held`, approve, reject). Until then a held workout stays held and
    earns nothing;
  - rule-set editing, season management, manual ledger adjustments and the behaviour flags (anti-cheat layer 3).

## How a workout becomes points

1. **Intake.**
   - Validation follows ARCHITECTURE §7.1: set ranges, at most 60 exercises and 100 sets per exercise.
   - The sport and its exercises must agree, with the old API's codes: `UNKNOWN_SPORT`, `UNKNOWN_EXERCISE`,
     `EXERCISE_NOT_IN_SPORT`, `DISTANCE_OR_DURATION_REQUIRED`, `REPS_OR_DURATION_REQUIRED`, and `REQUIRED` for
     `weightKg` on a weighted set.
   - `Idempotency-Key` must equal `clientId` (`MUST_EQUAL_CLIENT_ID`).
   - The payload is hashed canonically, without `deviceSubmittedAt`. A known `(user, clientId)` with the same hash
     replays the stored answer, and a different hash is a 409 carrying the server's version.
   - Two simultaneous sends of the same workout end with one row: the loser replays the winner.
2. **Anti-cheat layer 1.**
   - The thresholds of §7.2 come from the active rule set (`anticheat`) and each exercise's `plausibility`.
   - Body weight is the latest measurement when there is one; without it only the absolute limits apply.
   - Any hard hit means `REJECTED`, any soft hit `HELD_FOR_REVIEW`, otherwise `ACCEPTED`.
   - A rejected workout is stored too, so a replay gets the same 422.
   - A workout logged more than `late_log_max_hours` (72) late is accepted for history and progress but earns no
     XP or LP (`LATE_LOG`).
3. **Scoring** of an accepted workout (§5.3, §5.6):
   - e1RM per set (Epley, 1 to 12 reps), then the best value per exercise and metric into the observations;
   - calibration: PRs are `CALIBRATION` with a small flat XP, and an exercise first seen after calibration uses
     its first `baseline_first_logs` sessions as its baseline;
   - PR detection, and the plausibility hold that sets every PR of that exercise in the workout to held;
   - XP, in four sources:
     - the workout, after diminishing returns;
     - the best PR per exercise, with a 7-day cooldown per metric;
     - the calibration PR;
     - the first-workout quest;
   - the daily cap, then the weekly cap (the explanation records requested versus granted);
   - the ledger entry, `user_stats` and the level;
   - the daily streak, goal milestones and badges.

   **Ruling 2: scoring runs inside the request's transaction.** The old API saved the workout and scored it later
   in the worker, through an outbox. Here one transaction holds the workout and every point it earns, so the two can
   never diverge, and no outbox, scoring job or repair sweep is needed. The points are readable as soon as the
   answer arrives.

   The cost is more queries in `POST /workouts`. A sync batch is scored item by item, one transaction each. The
   scoring code is one function called with a transaction, so it can move to the job queue later without changing
   anything else. Mark the call site `shortcut: synchronous scoring, move to a job if POST /workouts gets slow`.
4. **The week** (§5.5).
   - `GET /me/weekly-scores/current` computes the running week on read.
   - Once the week's grace period (`week_grace_hours`, 24) is over, the worker closes it, user by user:
     - first the baseline audit (§5.4). A corrected baseline re-scores the weeks already paid on it: a reversal,
       then a corrected entry (§5.10.3);
     - then the `FINAL` weekly score and its `WEEKLY_SCORE` LP entry;
     - then the live division from `division_thresholds`, the weekly streak (plan met) and the habit goals.
5. **Seasons.**
   - A season is a calendar quarter per country, as in the old API.
   - The seed creates the current and the next season, and the divisions from the catalogue and the rule set.
   - After `ends_at` plus the grace period, the worker closes the season: standings, champions, and the soft reset
     (§5.10.4) into the next season, which it opens.

## Ledgers

- `xp_transactions` and `league_point_transactions` are append-only. Their `BEFORE UPDATE` and `BEFORE DELETE`
  triggers raise an error, like `audit_log`'s, so `fl_app` cannot rewrite them.
- **The same event is never granted twice.** A generated column holds `(user, reason, source type, source id)`
  while the row is not a reversal and `NULL` otherwise, under a unique index (part 1's rule for partial unique
  indexes).
- `reverses_id` is unique, so an entry is reversed at most once.
- Amounts are negative only for reversals, moderation and adjustments; the LP ledger also allows the soft reset.
- `user_stats` is updated in the same transaction, with its row locked. The nightly reconcile recomputes the
  balances from the ledgers and repairs any drift.
- Every entry carries an explanation in the shape the app renders: `formula`, `inputs`, `steps[{label, value}]`,
  `caps[{label, value, applied}]`, `requested`, `result`, `ruleSetVersion`.

## Leaderboards

- **Ruling 3.** The old API ranks in SQL over `user_stats`, with `RANK() OVER (ORDER BY season_lp DESC)`, and
  MariaDB 11.4 has the same window functions. There are no Redis sorted sets; revisit at load testing.
- Only eligible accounts appear: `ACTIVE`, email verified, calibration over, `show_on_leaderboards`.
- A row shows only `rank`, `lp`, `level`, `division`, `movement`, `athlete {id, username, fullName}`, `gym` and
  `governorate`: never email, birth date or body data.
- Pages use a keyset cursor `{lp, userId}`, signed with `APP_HMAC_SECRET` as part 1's configuration planned.
  `/me` returns the page with me near its middle.
- Movement compares with the latest earlier daily snapshot; `NEW` when the athlete is not in it.
- No partitioning and no retention for snapshots yet: `shortcut: snapshots grow by one row per eligible athlete per
  scope per day, add retention once real volumes are known`.

## Background jobs

The worker loop of part 1 (every 10 minutes) gains these, each run once per key:

| Job | Key | What it does |
|---|---|---|
| `calibration-finalize` | business day | Baselines of calibrations that ended become `FINAL` (`max(declared, best calibrated)`, `min` for lower-is-better) |
| `weekly-close` | week start | As above, user by user, each user in its own transaction, idempotent per (user, week) |
| `season-open`, `season-close` | day, season id | Open due seasons; close a finished one with standings, champions and the soft reset |
| `leaderboard-snapshot` | business day | Today's ranks per national and governorate scope, for the movement arrows |
| `badge-sweep` | business day | Re-checks the badges that weekly close and season close can unlock (division, weekly streak) |
| `balance-reconcile` | business day | Ledgers against `user_stats`; repairs and logs drift |

**Ruling 4.** "Once per key" is a `job_runs` table (`job`, `run_key` unique, `status RUNNING|DONE|FAILED`,
`started_at`, `finished_at`, `error`), as in the old API. This replaces part 1's Redis `SET NX` for these jobs:

- A week or a season must close exactly once, and a run that dies midway must be taken over. A `RUNNING` row older
  than one hour is taken over, and a `FAILED` row is retried on the next tick.
- Each user's share of the work is idempotent, so a takeover resumes where the dead run stopped.
- Part 1's daily sweep keeps its Redis key: it catches up on the next day by itself.

## Health data

- `body_measurements` keeps the weight, and the body fat when given, encrypted with **AES-256-GCM**, with the key
  id next to the value.
- Keys come from **`HEALTH_DATA_KEYS`**, the old API's variable and format: `keyId:base64key` pairs separated by
  commas. The first key encrypts and every key decrypts, which allows rotation. The server refuses to start
  without a valid key.
- The values of weight goals are encrypted the same way.
- Reading and writing need the `HEALTH_DATA` consent (403 `CONSENT_REQUIRED` with `consent: "HEALTH_DATA"`).
- Body data is never logged, never in another account's answer, and only read server-side for anti-cheat (body
  weight thresholds) and the derived experience level (strength standards).
- **Ruling 7.** The cipher is `ring`'s AES-256-GCM (`ring::aead`). `ring` is already in the build through
  sqlx's rustls, so no crate is added, and it does not lean on aws-lc, which is still an open point for the owner.

## Database

Migrations `0006` onwards. They follow part 1's conventions: UUID v7 in `BINARY(16)`, `DATETIME(6)` in UTC, `ENUM`
for closed sets, `DECIMAL` for measurements, and real columns rather than JSON except for free-shape snapshots.

| Group | Tables |
|---|---|
| Workouts | `workouts` (unique `(user_id, client_id)`, `payload_hash` and `fingerprint` `BINARY(32)`, status, visibility, derived totals), `workout_exercises`, `workout_sets` (the range checks of ARCHITECTURE §3.4), `workout_evaluations` (outcome, `rule_hits` JSON snapshot, confidence, rule-set version) |
| Progress | `metric_observations`, `personal_records` (the current record per key held by a unique index on a generated column), `expected_progression`; `baselines` gains `calibrated_value`, `experience_level`, `finalized_at`, `corrected_from`, `rule_set_version` |
| Goals | `goals` (encrypted value columns for weight goals), `goal_milestones` |
| Scoring | `xp_transactions`, `league_point_transactions`, `xp_daily_counters` (row-locked for the caps), `weekly_scores` |
| Seasons | `seasons`, `divisions`, `season_standings`, `leaderboard_snapshots`; `user_stats.current_season_id` gets its foreign key |
| Badges | `badges` (rule as JSON, the old API's four rule types `COUNT`, `LEVEL`, `DIVISION`, `STREAK_WEEKS`), `user_badges` |
| Health | `body_measurements` |
| Jobs | `job_runs` |

- `user_streaks` gains `longest_days` and `last_training_date`.
- The seed adds the badges of `infra/seed-data/catalog.json`, the divisions, the expected-progression rows of
  `ruleset-v2.json`, and the two seasons.
- No two seasons of a country may overlap. This is checked in a transaction that locks the rows it read (part 1's
  replacement for PostgreSQL's exclusion constraint).
- `Rules` (`src/rules.rs`) gains the rule-set fields this part reads. They are all in `ruleset-v2.json` already.

## Security additions

- Points cannot be sent by a client: `xp`, `points`, `lp`, `score` and any other unknown field are refused with
  `UNKNOWN_FIELD`. The security suite gains a test for it.
- Every query on a workout, goal, record, measurement or ledger carries the owner in its `WHERE`. Another user's
  workout or goal id answers 404.
- Rate limits: `POST /workouts` 30 an hour per user and `POST /workouts/sync` 10 an hour per user, as in the old
  API. The other new routes fall under the general limits.
- Every new route answers 401 without a token. The existing route walker in `tests/security.rs` enforces it, and
  none of the new routes is public.

## Testing

- **Unit tests** for the pure rules, using ARCHITECTURE §5.10's worked examples as test vectors:
  - the formulas: workout and PR XP, diminishing returns, caps, the level curve, e1RM;
  - the weekly components: the Phase 1 variant gives Sami 85.6 and Karim 78.1;
  - the baseline audit: Nour's baseline is corrected to 55.2 kg;
  - the soft reset: 1,240 LP becomes 1,070;
  - the division of an LP total, and every anti-cheat threshold of §7.2 on both sides of its limit.
- **Integration tests** against real MariaDB and Redis:
  - offline replay: the same payload gives the same answer, a different one a 409, and two simultaneous sends one
    row;
  - a rejected workout is stored and replayed;
  - a late log earns no XP; caps and the PR cooldown hold;
  - weekly close, run twice, posts once, and a baseline correction reverses and re-posts;
  - season close applies the soft reset;
  - leaderboard pages stay stable under inserts, and `/me` centres on me;
  - body measurements without consent answer 403;
  - export and anonymisation cover the new data;
  - the ledger balance equals the sum of entries after reversals.
- **Contract check**: for each part 2 route recorded in `apps/mobile-rn/assets/demo/api.json`, the Rust answer has
  the same keys and value types.

## Plans

Built in four plans, each written when the previous one is built, as in part 1:

| Plan | Contents |
|---|---|
| **2a, workouts in** | Workout and health tables, the health-data cipher, anti-cheat layer 1, `POST /workouts`, `POST /workouts/sync`, `GET /workouts`, `GET /workouts/:id`, both body-measurement routes |
| **2b, points** | Observations, calibration, PRs, the XP ledger, caps, levels, the daily streak, the first quest; `GET /workouts/:id/points`, `/me/records`, `/me/progress` and its metric series; `GET /me` stats and streak |
| **2c, goals and badges** | The four goal routes, milestones, suggestions, weight-goal safety, `GET /badges`, awarding in the scoring path, the onboarding `goals` step |
| **2d, league** | Seasons and divisions, the weekly score, the LP ledger, `job_runs` and the six jobs, `/me/ranks`, `/me/lp`, `/me/weekly-scores/current`, the national and governorate leaderboards |

Each plan extends the export and the anonymisation for the tables it adds, so no plan leaves personal data that
deletion forgets.

## Rulings the owner can change

1. The old API's code wins over ARCHITECTURE.md where they differ.
2. Scoring runs inside the request's transaction, not in the worker.
3. Leaderboards rank in SQL, with no Redis sorted sets.
4. The jobs that must run once (weekly close, season close…) use a `job_runs` table in MariaDB.
5. The gym and friends leaderboards move to part 3, and workout proofs to part 5, next to the tables and the
   moderation they need. Nothing changes for users: the app only reaches the Rust API at the cut-over, after
   parts 3 and 5.
6. Workout edit and delete are left out, because no frontend calls them.
7. Health data is encrypted with `ring`, already in the build.
8. Leaderboard snapshots get no partitioning or retention yet.
9. Activity events (the feed's input) are written from part 3, which reads them.
