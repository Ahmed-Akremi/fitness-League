# Rust backend, plan 2a: workouts in

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Date: 2026-10-18 · Spec: `docs/superpowers/specs/2026-10-18-rust-backend-training-loop-design.md` · First plan of
part 2.

**Goal:** against the Rust API, the app saves workouts (one at a time and as an offline batch), lists and opens
them, and records weigh-ins. Anti-cheat layer 1 checks every workout, which is stored with its verdict. Points
come in plan 2b.

**Architecture:**

- A new module, `modules/workouts`:
  - `mod.rs`: routes, handlers and the shape of the answer;
  - `intake.rs`: the SQL of saving and loading;
  - `metrics.rs` and `anticheat.rs`: pure rules.
- Body measurements in `modules/me/body.rs`.
- The health-data cipher in `security/health.rs`.
- The signed page cursor in `http/page.rs`.
- One migration, `0006_workouts.sql`.

**Tech stack:**

- Axum 0.8 and sqlx 0.9 on MariaDB 11.4.
- `ring` 0.17 for AES-256-GCM. It is already in `Cargo.lock` through sqlx's rustls, so it becomes a direct
  dependency at that same version.
- `hmac`, `sha2` and `base64`, which are direct dependencies already.

**Contract:** the old API's code, as the app calls it.

- **Old API:**
  - `apps/api/src/modules/workouts/`: `workouts.controller.ts`, `workouts.service.ts`, `workout-metrics.ts`,
    `dto/workout.dto.ts`;
  - `apps/api/src/modules/anticheat/rules.ts`;
  - the body measurements of `apps/api/src/modules/users/privacy.service.ts`;
  - `apps/api/src/common/pagination/cursor.ts`.
- **The app's callers:**
  - `apps/mobile-rn/src/core/offline/workout-sync.ts`;
  - `features/workouts/api.ts`;
  - `features/progress/screens.tsx` (`BodyScreen`).

**Where it is built:** this Windows checkout. The build output stays outside OneDrive
(`CARGO_TARGET_DIR=%LOCALAPPDATA%\fitness-league\target`), and MariaDB, Redis and Mailpit come from
`infra/docker-compose.yml`.

## Global constraints

- No `unwrap` or `expect` outside tests, and no `unsafe` (the lints in `Cargo.toml`).
- Every query on an account's data carries `user_id = ?` in its `WHERE`.
- A database error is never logged with its message. It goes through `AppError::from(sqlx::Error)`, which uses
  `db::describe`.
- **Request bodies:**
  - each is a struct with `#[serde(deny_unknown_fields, rename_all = "camelCase")]` and a `Validate`
    implementation;
  - field paths look like `exercises[0].sets[2].reps`;
  - every wrong field is reported in one answer.
- Timestamps leave through `types::iso`, and ids are UUID v7 (`Uuid::now_v7()`).
- A health value never appears in a log, an error, or another account's answer.
- No new route is public, so `tests/security.rs` passes unchanged.
- Before the last commit:
  - `cargo fmt --check`;
  - Clippy with `-D warnings`, both online and with `SQLX_OFFLINE=true`;
  - `cargo sqlx prepare -- --all-targets`, with `.sqlx/` committed.

## Endpoints

| Route | Body or query | Answer |
|---|---|---|
| `POST /workouts` | header `Idempotency-Key` = `clientId`; the workout body below | 201 the workout, `ETag: "1"`; 200 replay; 409 `IDEMPOTENCY_CONFLICT` with `workout`; 422 `WORKOUT_REJECTED` with `workout` and detail « This workout exceeds physiological limits or duplicates another one. »; 429 after 30 an hour |
| `POST /workouts/sync` | `{items}`, 1 to 50 workout bodies | 200 `{results: [...]}`; 429 after 10 an hour |
| `GET /workouts` | `limit` 1–100 (default 20), `cursor` (≤ 512), `from`, `to`, `sportId` | 200 `{data: [workout], page: {nextCursor, hasMore}}`, newest first, every status |
| `GET /workouts/:id` | — | 200 the workout and `ETag`; 404 when it is not the caller's or the id is malformed |
| `GET /me/body-measurements` | — | 200 `[{id, measuredAt, weightKg, bodyFatPct, source}]`, newest first, at most 100; 403 `CONSENT_REQUIRED` with `consent: "HEALTH_DATA"` |
| `POST /me/body-measurements` | `weightKg` 25–350, `bodyFatPct?` 2–70, `measuredAt?`, `source?` (`MANUAL`, `HEALTH_CONNECT`, `APPLE_HEALTH`, `STRAVA`, `GARMIN`, `IMPORT`) | 201 the measurement; 403 as above; `measuredAt` more than 10 minutes ahead is `IN_FUTURE` |

**Workout body:**

- `clientId`: a UUID.
- `deviceSubmittedAt?`: RFC 3339.
- `sportId`: a UUID.
- `workoutType`: `^[A-Z][A-Z0-9_]{1,39}$` (`MATCHES`).
- `performedAt`: RFC 3339 (`ISISO8601`).
- `durationS`: 60 to 86,400.
- `notes?`: up to 2,000 characters.
- `visibility?`: `PUBLIC`, `FRIENDS` or `PRIVATE`. The default is the account's `defaultVisibility`.
- `exercises`: 1 to 60 (`ARRAYMINSIZE`, `ARRAYMAXSIZE`), each with:
  - `exerciseId`;
  - `notes?`: up to 500 characters;
  - `sets`: 1 to 100, each with `reps?` (0 to 1,000), `weightKg?` (0 to 1,000), `distanceM?` (0 to 1,000,000),
    `durationS?` (0 to 86,400), `isWarmup?` and `rpe?` (1 to 10).

**Catalog codes**, each on its field:

| Field | Code | When |
|---|---|---|
| `sportId` | `UNKNOWN_SPORT` | The sport is missing or disabled |
| `exercises[i].exerciseId` | `UNKNOWN_EXERCISE` | The exercise is missing or disabled |
| `exercises[i].exerciseId` | `EXERCISE_NOT_IN_SPORT` | The exercise belongs to another sport, or it is shared (`sport_id` NULL) and the sport's category is `CARDIO` |
| `exercises[i].sets[j]` | `DISTANCE_OR_DURATION_REQUIRED` | The exercise tracks `DISTANCE` and the set has neither |
| `exercises[i].sets[j]` | `REPS_OR_DURATION_REQUIRED` | Any other exercise, and the set has neither |
| `exercises[i].sets[j].weightKg` | `REQUIRED` | A weighted exercise (not bodyweight, not distance) with reps and no weight |
| header `Idempotency-Key` | `MUST_EQUAL_CLIENT_ID` | Absent, or different from `clientId` (compared ignoring case) |

**Workout answer** (the old `toView` for the owner):

```json
{
  "id": "…", "clientId": "…", "sportId": "…", "workoutType": "STRENGTH",
  "performedAt": "…", "durationS": 3600, "notes": null, "visibility": "FRIENDS",
  "status": "ACCEPTED", "isVerified": false, "version": 1,
  "totalVolumeKg": 1500, "totalDistanceM": 0, "receivedAt": "…",
  "exercises": [{
    "id": "…", "exerciseId": "…", "position": 0, "notes": null,
    "sets": [{"setIndex": 0, "reps": 5, "weightKg": 100, "distanceM": null, "durationS": null,
              "isWarmup": false, "rpe": null, "e1rmKg": 116.67}]
  }],
  "evaluation": {"outcome": "ACCEPTED", "ruleHits": [], "countsForCompetition": true, "reviewedAt": null}
}
```

`countsForCompetition` is true when no hit is `LATE_LOG`.

**Sync result:** `{clientId, result, workout?, error?}`.

| `result` | Carries |
|---|---|
| `CREATED`, `REPLAYED` | `workout` |
| `REJECTED` | `workout`, which is stored, whether new or replayed |
| `CONFLICT` | `error: {code: "IDEMPOTENCY_CONFLICT", workout}` |
| `INVALID` | `error: {code, errors?, …extras}`, for any other 4xx |

A 5xx fails the whole batch. The items already done replay on the retry.

## Rulings

1. **Decimals are rounded, not refused.** `weightKg` and the body weight keep 2 decimals; `rpe` and `bodyFatPct`
   keep 1 (as plan 1c ruling 4). The rounded value is the one stored, hashed and checked.
2. **A sync validates each item on its own.**
   - The old API validated the whole batch first, so one malformed item turned the batch into a 422 and left the
     app's outbox stuck on it. Here only that item is `INVALID`.
   - The batch itself (an object with 1 to 50 items) is still checked up front.
3. **Reading body measurements needs the consent too.**
   - The old API only guarded `POST`; the app already shows its consent screen on a 403 for the read.
   - Anti-cheat uses the latest weight only while the consent is granted.
4. **A malformed workout id answers 404**, like an unknown one.
5. **The idempotency hash** is SHA-256 of the parsed body without `deviceSubmittedAt`, serialised from the Rust
   struct: the field order is fixed and numbers are `f64`. Key order, `80` versus `80.0`, and an absent field
   versus `null` change nothing.
6. **No `deleted_at`, `data_source` or `external_ref` columns yet**: no route deletes or imports a workout.
   Part 3 adds `deleted_at` with gym WODs.
7. **The key id lives inside the ciphertext only**: `[id length: 1 byte][id][nonce: 12][ciphertext + tag]`. There
   is no `key_id` column.
8. **A sync item whose `clientId` is missing or not a UUID** is `INVALID`, with `clientId` echoed as sent (`null`
   when absent).

## Review focus

1. A sync item without a usable `clientId` must not stop the batch: that item is `INVALID`, the others are
   processed (task 5).
2. A workout near local midnight counts on the business day (UTC+1), not the UTC day (task 4).
3. A weight with float noise (`82.35000000000001`) is stored and hashed as `82.35`, so sending it again replays
   (tasks 3 and 4).
4. A lone cardio set with no duration of its own is judged with the workout's duration (task 3).
5. Once the health consent is withdrawn, the server stops using the stored weight (task 4).

---

### Task 1: the health-data cipher and its keys

**Files:**

- Create: `apps/backend/src/security/health.rs`.
- Modify:
  - `apps/backend/src/security/mod.rs`;
  - `apps/backend/src/config.rs`;
  - `apps/backend/src/state.rs`;
  - `apps/backend/Cargo.toml` (`ring = "0.17"`);
  - `apps/backend/.env.example`;
  - `apps/backend/tests/common/mod.rs`: `env()` gains `HEALTH_DATA_KEYS`, a fixed test key.

**Interfaces (produces):**

- `Config.health_data_keys: Vec<(String, SecretBox<[u8; 32]>)>`, read from `HEALTH_DATA_KEYS`.
  - The format is `id:base64` pairs separated by commas. The first key encrypts.
  - Problems are reported as `HEALTH_DATA_KEYS: required` and `HEALTH_DATA_KEYS: expected id:base64(32 bytes)[,…]`.
    The second covers an empty id, an id over 32 bytes or outside `[A-Za-z0-9_-]`, a key that is not 32 bytes, and
    a repeated id.
  - `Debug` of `Config` shows the ids only.
- `pub struct HealthCipher`:
  - `HealthCipher::new(keys: &[(String, SecretBox<[u8; 32]>)]) -> Result<Self, String>`;
  - `encrypt(&self, plain: &str) -> Result<Vec<u8>, AppError>` and
    `decrypt(&self, blob: &[u8]) -> Result<String, AppError>`;
  - `encrypt_number(&self, n: f64)` and `decrypt_number(&self, blob: &[u8]) -> Result<f64, AppError>`.
  - It uses `ring::aead::AES_256_GCM` with `LessSafeKey`, and a fresh nonce from `ring::rand::SystemRandom` for
    every value.
  - Its errors are `AppError::internal` and never carry the value.
- `AppState.health: Arc<HealthCipher>`, built in `AppState::new`.

- [ ] **Step 1: write the failing tests**
  - Unit tests in `health.rs`:
    - `a_value_comes_back`;
    - `two_encryptions_of_one_value_differ`;
    - `old_rows_stay_readable_after_a_rotation`: encrypt with `[k1]`, decrypt with `[k2, k1]`;
    - `an_unknown_key_id_is_an_error`;
    - `a_changed_byte_is_an_error`.
  - In `config.rs`:
    - `health_keys_are_required_and_checked`: missing gives `HEALTH_DATA_KEYS: required`, and a 16-byte key gives
      the format message;
    - `health_keys_never_print`: `format!("{cfg:?}")` contains the id and not the base64.
- [ ] **Step 2:** `cargo test --lib health config` fails to compile.
- [ ] **Step 3: implement.**
  - `.env.example` gets, next to the other generated secrets:
    `printf 'HEALTH_DATA_KEYS=k1:%s\n' "$(openssl rand -base64 32)" >> .env`.
  - Append a key to the local `apps/backend/.env` the same way, without printing it.
- [ ] **Step 4:** `cargo test --lib` passes.
- [ ] **Step 5:** commit `feat(backend): health-data cipher, AES-256-GCM with rotating keys from HEALTH_DATA_KEYS`.

### Task 2: the tables, and body measurements

**Files:**

- Create:
  - `apps/backend/migrations/0006_workouts.sql`;
  - `apps/backend/src/modules/me/body.rs`;
  - `apps/backend/tests/body.rs`.
- Modify:
  - `apps/backend/src/modules/me/mod.rs`: `pub mod body;`, and the routes;
  - `apps/backend/tests/common/mod.rs`: `set_consent(app, user, kind, granted)` inserts a `consents` row.

**Migration** (part 1's conventions: `BINARY(16)` ids, `DATETIME(6)`, InnoDB, `utf8mb4_uca1400_ai_ci`):

- **`workouts`:**
  - `id`, `user_id`, `client_id`;
  - `payload_hash BINARY(32)`, `fingerprint BINARY(32)`;
  - `sport_id`, `workout_type VARCHAR(40)` in ASCII;
  - `performed_at`, `duration_s INT`, `notes VARCHAR(2000) NULL`;
  - `visibility ENUM('PUBLIC','FRIENDS','PRIVATE')`;
  - `status ENUM('ACCEPTED','HELD_FOR_REVIEW','REJECTED')`;
  - `is_verified BOOLEAN DEFAULT FALSE`;
  - `received_at`, `device_submitted_at NULL`;
  - `total_volume_kg DECIMAL(12,2)`, `total_distance_m INT`;
  - `version INT DEFAULT 1`, `created_at`, `updated_at`.
  - Keys:
    - `UNIQUE uq_workouts_user_client (user_id, client_id)`;
    - `KEY (user_id, performed_at, id)`;
    - `KEY (user_id, fingerprint)`;
    - foreign keys to `users` (`ON DELETE CASCADE`) and `sports`.
- **`workout_exercises`:**
  - `id`, `workout_id` (`ON DELETE CASCADE`), `exercise_id`;
  - `position SMALLINT`, `notes VARCHAR(500) NULL`;
  - `UNIQUE (workout_id, position)`.
- **`workout_sets`:**
  - `id`, `workout_exercise_id` (`ON DELETE CASCADE`), `set_index SMALLINT`;
  - `reps SMALLINT NULL`, `weight_kg DECIMAL(6,2) NULL`, `distance_m INT NULL`, `duration_s INT NULL`;
  - `is_warmup BOOLEAN`, `rpe DECIMAL(3,1) NULL`, `e1rm_kg DECIMAL(7,2) NULL`;
  - `UNIQUE (workout_exercise_id, set_index)`;
  - the range checks of ARCHITECTURE §3.4, plus `reps`, `distance_m` or `duration_s` not null.
- **`workout_evaluations`:**
  - `workout_id` as the primary key (`ON DELETE CASCADE`);
  - `outcome` (the status enum);
  - `rule_hits JSON NOT NULL CHECK (JSON_VALID(rule_hits))`;
  - `confidence DECIMAL(4,3)`, `rule_set_version INT`, `reviewed_at DATETIME(6) NULL`.
- **`body_measurements`:**
  - `id`, `user_id` (`ON DELETE CASCADE`), `measured_at`;
  - `weight_kg_enc VARBINARY(128) NOT NULL`, `body_fat_pct_enc VARBINARY(128) NULL`;
  - `source ENUM(…) DEFAULT 'MANUAL'`, `created_at`;
  - `KEY (user_id, measured_at)`.

**Interfaces (produces):**

- `pub async fn has_consent(db: &MySqlPool, user: Uuid, kind: &str) -> Result<bool, AppError>`. It reads the
  latest row of that type, ordered by `created_at DESC, id DESC`.
- `pub async fn latest_weight_kg(state: &AppState, user: Uuid) -> Result<Option<f64>, AppError>`. It is `None`
  without the `HEALTH_DATA` consent.
- `pub async fn all(state: &AppState, user: Uuid, limit: Option<u32>) -> Result<Vec<Value>, AppError>`, the decrypted
  measurements. The export (task 7) uses it too.
- In `validate.rs`, shared with the workouts:
  - `pub fn round_to(value: f64, decimals: i32) -> f64`;
  - `pub fn rfc3339(raw: &str) -> Option<DateTime<Utc>>`.

- [ ] **Step 1: write the failing tests** in `tests/body.rs`:
  - `measurements_need_the_health_consent`: `GET` and `POST` answer 403, `code` `CONSENT_REQUIRED`, `consent`
    `HEALTH_DATA`.
  - `a_measurement_is_kept_encrypted`:
    1. grant the consent;
    2. `POST {weightKg: 78.4, bodyFatPct: 18.5}` answers 201 with `weightKg` 78.4, `bodyFatPct` 18.5, `source`
       `MANUAL`, an `id` and `measuredAt`;
    3. a second one, `measuredAt` yesterday, is listed second;
    4. the raw `weight_kg_enc` does not contain `b"78.4"`.
  - `withdrawing_the_consent_closes_both_routes`: after a `granted = false` row, both routes answer 403 and
    `latest_weight_kg` is `None`.
  - `measurement_limits`: `weightKg` 24 is `MIN`; 351 is `MAX`; `bodyFatPct` 71 is `MAX`; `measuredAt` 20 minutes
    ahead is `IN_FUTURE`; `source` `"FITBIT"` is `INVALID`; `weightKg` 78.456 is stored as 78.46.
- [ ] **Step 2:** apply the migration to the dev database (`sqlx migrate run --source migrations`), then
  `cargo test --test body` fails.
- [ ] **Step 3: implement** `body.rs`. The routes are `GET` and `POST /api/v1/me/body-measurements`.
- [ ] **Step 4:** `cargo test --test body` passes.
- [ ] **Step 5:** commit `feat(backend): the workout tables and body measurements, encrypted and behind the health consent`.

### Task 3: the pure workout rules

**Files:**

- Create:
  - `apps/backend/src/modules/workouts/mod.rs` (`pub mod anticheat; pub mod metrics;`);
  - `apps/backend/src/modules/workouts/metrics.rs`;
  - `apps/backend/src/modules/workouts/anticheat.rs`.
- Modify: `apps/backend/src/modules/mod.rs` and `apps/backend/src/rules.rs`.

**Interfaces (produces):**

- **`metrics.rs`:**
  - `pub struct SetInput { pub reps: Option<i32>, pub weight_kg: Option<f64>, pub distance_m: Option<i32>,
    pub duration_s: Option<i32>, pub is_warmup: bool }`
  - `pub struct ExerciseInput { pub exercise_id: Uuid, pub code: String, pub is_bodyweight: bool,
    pub sets: Vec<SetInput> }`
  - `pub struct WorkoutInput { pub sport_id: Uuid, pub performed_at: DateTime<Utc>, pub duration_s: i32,
    pub exercises: Vec<ExerciseInput> }`
  - `pub enum E1rmFormula { Epley, Brzycki }`, deserialised from `EPLEY` and `BRZYCKI`.
  - `pub fn e1rm(weight_kg: f64, reps: i32, formula: E1rmFormula, max_reps: i32) -> Option<f64>`, with 2
    decimals.
  - `pub fn total_volume_kg(w: &WorkoutInput) -> f64`: reps times weight over working sets.
  - `pub fn total_distance_m(w: &WorkoutInput) -> i64`: over every set.
  - `pub fn fingerprint(w: &WorkoutInput) -> [u8; 32]`: SHA-256 of the sport and, per exercise, its id and its
    sets' `(reps, weight, distance, duration, warm-up)`. The time is left out.
  - Rounding uses `validate::round_to`, from task 2.
- **`anticheat.rs`:**
  - `pub enum Severity { Info, Soft, Hard }`.
  - `pub struct RuleHit { pub rule: &'static str, pub severity: Severity, pub value: Option<f64>,
    pub threshold: Option<f64>, pub exercise_index: Option<usize>, pub set_index: Option<usize> }`. It serialises
    in camelCase and skips `None`.
  - `pub struct Plausibility { hold_kg, reject_kg, hold_s, reject_s, hold_reps, reject_reps: Option<f64> }`,
    `Deserialize` with `#[serde(default)]`, read from `exercises.plausibility`.
  - `pub struct Context { pub now: DateTime<Utc>, pub device_submitted_at: Option<DateTime<Utc>>,
    pub body_weight_kg: Option<f64>, pub workouts_same_day: i64, pub overlapping: Vec<[u8; 32]>,
    pub identical_recent: i64, pub fingerprint: [u8; 32] }`.
  - `pub enum Outcome { Accepted, HeldForReview, Rejected }`, with `as_str` giving the enum names of the database.
  - `pub struct Evaluation { pub outcome: Outcome, pub hits: Vec<RuleHit>, pub confidence: f64,
    pub counts_for_competition: bool }`.
  - `pub fn evaluate(w: &WorkoutInput, ctx: &Context, rules: &Rules,
    plausibility: &dyn Fn(&str) -> Plausibility) -> Evaluation`. It is a rule-for-rule port of `rules.ts`, rule
    names included.
  - `pub const OVERLAP_TOLERANCE: chrono::Duration` is 5 minutes.
- **`Rules`** gains:
  - `late_log_max_hours: f64`, `e1rm_formula: E1rmFormula`, `e1rm_max_reps: i32`;
  - `anticheat: Anticheat`, a struct with `ruleset-v2.json`'s `anticheat` keys: `Limits {hold, reject}`;
    `lifts: HashMap<String, Lift>`, where `Lift` has `bwRatio` and `absoluteKg`; `run_time_s: HashMap<String,
    Limits>`; `identical_fingerprint_hold {count, days}`.

- [ ] **Step 1: write the failing unit tests.**
  - **`metrics`:**
    - `epley_and_brzycki`: 100 kg × 5 gives 116.67 and 112.5; × 1 gives 100; × 13 gives `None`; 0 kg gives
      `None`;
    - `volume_skips_warmups`;
    - `fingerprint_ignores_time_and_follows_the_sets`;
    - `rounding_removes_float_noise`: `82.35000000000001` gives 82.35, and `0.1 + 0.2` gives 0.3.
  - **`rules`:** `the_seeded_rule_set_reads` parses the `config` of `infra/seed-data/ruleset-v2.json` into
    `Rules`.
  - **`anticheat`:**
    - `each_limit_holds_on_both_sides`, table-driven, one row per check, each just inside a limit and just past
      it:
      - run pace 196 s/km passes, 194 is `SOFT`, 149 is `HARD`;
      - run distance 60,001 m is `SOFT`, 120,001 m is `HARD`;
      - `RUN_TIME_5K`, `RUN_TIME_10K` and `RUN_TIME_21K` likewise;
      - ride speed 46 km/h is `SOFT`, 61 is `HARD`; ride distance likewise;
      - walk speed 9.5 km/h is `SOFT`, 16 is `HARD`;
      - swim: 200 m in 1:58 is `SOFT`, 200 m in 1:28 is `HARD`, 150 m is not checked;
      - squat e1RM 301 kg is `SOFT`, 501 is `HARD`;
      - squat at a body weight of 70 kg: a ratio of 3.1 is `SOFT`, 4.6 is `HARD`;
      - another weighted exercise against its plausibility `hold_kg` and `reject_kg`;
      - reps per weighted set 51 is `SOFT`, 201 is `HARD`; bodyweight 151 and 1,001;
      - duration 5.1 h is `SOFT`, 12.1 h is `HARD`;
      - sets 61 is `SOFT`, 151 is `HARD`;
      - 4 other workouts that day is `SOFT`; 2 identical recent fingerprints is `SOFT`;
      - an overlap is `OVERLAPPING_WORKOUT` (`HARD`), or `DUPLICATE_WORKOUT` (`HARD`) with the same fingerprint;
      - performed 11 minutes ahead is `HARD`, 9 minutes passes;
      - a clock skew of 25 h is `SOFT`;
      - 73 h late is `LATE_LOG` (`INFO`) with `counts_for_competition` false;
      - `FINISH_TIME_S` and `WOD_TOTAL_REPS` against the exercise's plausibility.
    - `a_lone_cardio_set_takes_the_workout_duration` (review focus 4).
    - `the_outcome_follows_the_worst_hit`: `HARD` gives `Rejected` with confidence 0.99; `SOFT` gives
      `HeldForReview` with 0.6; `INFO` alone gives `Accepted` with 0.
- [ ] **Step 2:** `cargo test --lib workouts rules` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test --lib` passes.
- [ ] **Step 5:** commit `feat(backend): workout metrics and anti-cheat layer 1 as pure rules`.

### Task 4: `POST /workouts` and `GET /workouts/:id`

**Files:**

- Create: `apps/backend/src/modules/workouts/intake.rs` and `apps/backend/tests/workouts.rs`.
- Modify:
  - `apps/backend/src/modules/workouts/mod.rs`: routes, handlers, and the body structs;
  - `apps/backend/src/http/mod.rs`: `api()`;
  - `apps/backend/src/http/rate_limit.rs`: `WORKOUTS_USER` is `rule("workouts", 30, 3600, false)` and
    `WORKOUTS_SYNC_USER` is `rule("workouts-sync", 10, 3600, false)`;
  - `apps/backend/src/error.rs`: `pub fn summary(&self) -> Value`, the object `{code, errors?, …extras}`;
  - `apps/backend/src/types.rs`: `Visibility` derives `Serialize`;
  - `apps/backend/src/security/policy.rs`: `pub fn business_day_start(at: DateTime<Utc>, utc_offset_minutes: i32)
    -> DateTime<Utc>`.

**Interfaces:**

- **Consumes:** `metrics::*`, `anticheat::evaluate`, `body::latest_weight_kg`, `Rules::active`.
- **Produces:**
  - `#[derive(Deserialize, Serialize)] pub struct WorkoutBody`, with the fields of the workout body;
    `device_submitted_at` is `#[serde(skip_serializing)]`. Its `Validate` checks the ranges above and leaves the
    catalog codes to `create`.
  - `pub enum Created { New(Value), Replayed(Value) }`.
  - `pub async fn create(state: &AppState, user: Uuid, body: WorkoutBody) -> Result<Created, AppError>`, in this
    order:
    1. hash the payload;
    2. look up `(user, clientId)`: the same hash replays, another hash is `AppError::conflict("IDEMPOTENCY_CONFLICT")`
       with `workout`;
    3. resolve the catalog in two queries (the sport; the exercises with their `DISTANCE` flag and
       plausibility) and collect every catalog error;
    4. gather the evaluation context: the count for the same business day, the overlap window
       `[start − 24 h, end)` with `OVERLAP_TOLERANCE`, identical fingerprints within
       `identical_fingerprint_hold.days`, and `latest_weight_kg`; rejected workouts are left out of all three
       counts;
    5. evaluate;
    6. in one transaction, insert the workout, its exercises, its sets (`e1rm_kg` on working sets that have a
       weight and reps) and its evaluation;
    7. a duplicate key on `uq_workouts_user_client` (two simultaneous sends) re-reads and replays.

    After the evaluation insert, inside the transaction, write the comment
    `// plan 2b scores an ACCEPTED workout here, in this transaction`.
  - `#[derive(Default)] pub struct Filter { pub id: Option<Uuid>, pub before: Option<(NaiveDateTime, Uuid)>,
    pub from: Option<NaiveDateTime>, pub to: Option<NaiveDateTime>, pub sport: Option<Uuid>,
    pub limit: Option<u32> }`.
  - `pub async fn load(db: &MySqlPool, user: Uuid, filter: &Filter) -> Result<Vec<Value>, AppError>`. It is one
    statement: the page of workouts as a derived table, joined to exercises, sets and evaluation, then grouped in
    Rust. The detail, the list (task 6), the export (task 7), the answer to a create and the replays all use it.
- **The handler** `post_workout`:
  1. `AppUser`, then `ValidJson<WorkoutBody>`;
  2. `rate_limit::check(WORKOUTS_USER, user id)`;
  3. the `Idempotency-Key` check;
  4. `create`;
  5. a `REJECTED` status answers 422 `WORKOUT_REJECTED` with the detail and `workout`; otherwise 201 or 200, with
     `ETag`.

- [ ] **Step 1: write the failing tests.**

  `tests/workouts.rs` has two helpers that build bodies from the seeded catalog:
  `strength(client_id, at) -> Value` uses `WEIGHT_TRAINING` and `BACK_SQUAT`, with one warm-up set of 10 × 60 and
  three sets of 5 × 100; `run(client_id, km, minutes, at) -> Value` uses `RUNNING` and `RUN`.

  | Test | Asserts |
  |---|---|
  | `a_workout_is_stored_as_the_app_reads_it` | 201; `ETag` `"1"`; status `ACCEPTED`; visibility `FRIENDS`; `totalVolumeKg` 1500; `sets[1].e1rmKg` 116.67; the warm-up's `e1rmKg` null; `evaluation` is `{outcome: ACCEPTED, ruleHits: [], countsForCompetition: true, reviewedAt: null}`; `GET /workouts/:id` gives the same body |
  | `a_resent_workout_is_replayed` | another `deviceSubmittedAt`, and a weight of `100.00000000000001` (review focus 3): 200, same id, one row |
  | `other_data_under_the_same_client_id_is_a_conflict` | 409 `IDEMPOTENCY_CONFLICT`; `workout.id` is the first workout's id |
  | `two_simultaneous_sends_make_one_workout` | `tokio::join!`: the sorted statuses are `[200, 201]`; `COUNT(*)` is 1 |
  | `the_idempotency_key_must_be_the_client_id` | absent: 422 on `Idempotency-Key`, `MUST_EQUAL_CLIENT_ID`; another UUID: the same; the same UUID in upper case: 201 |
  | `an_impossible_workout_is_rejected_and_kept` | 5 km in 10 minutes: 422 `WORKOUT_REJECTED`; `workout.status` `REJECTED`; `ruleHits` contains `RUN_PACE` `HARD`; sending it again: 422 again, one row |
  | `an_exceptional_workout_is_held` | a squat of 320 × 1: 201 `HELD_FOR_REVIEW`, `LIFT_ABSOLUTE_KG` `SOFT` |
  | `body_weight_counts_only_with_the_consent` | grant the consent and weigh in at 70: a squat of 220 × 1 is `HELD_FOR_REVIEW` (`LIFT_BODYWEIGHT_RATIO`); withdraw it: another 220 × 1, two hours later, is `ACCEPTED` (review focus 5) |
  | `a_late_workout_is_history_only` | performed 80 h ago: 201 `ACCEPTED`; `ruleHits` is `[LATE_LOG INFO]`; `countsForCompetition` false |
  | `overlapping_and_duplicate_workouts_are_rejected` | a run 10 minutes into a strength session: `OVERLAPPING_WORKOUT`; the same sets 10 minutes in under a new `clientId`: `DUPLICATE_WORKOUT` |
  | `the_fifth_workout_of_a_business_day_is_held` | four workouts on the business day two days back (06:00, 09:00, 12:00 and 15:00 local); the fifth, at 18:00, is held with `WORKOUTS_PER_DAY` |
  | `the_catalog_must_agree` | one body holding an unknown exercise, `RUN` in `WEIGHT_TRAINING`, `BACK_SQUAT` in `RUNNING`, a squat set with only a weight, a squat set with reps and no weight, and a `RUN` set with only reps: one 422 with the six codes on their paths; an unknown sport is `UNKNOWN_SPORT` on `sportId` |
  | `the_body_is_checked_before_anything_is_stored` | `durationS` 59 is `MIN`; 61 exercises is `ARRAYMAXSIZE`; 101 sets is `ARRAYMAXSIZE`; `workoutType` `"strength"` is `MATCHES`; `performedAt` `"yesterday"` is `ISISO8601`; an `xp` field is `UNKNOWN_FIELD`; no row is written |
  | `a_workout_belongs_to_its_owner` | another account's `GET` answers 404; `/api/v1/workouts/not-a-uuid` answers 404 |
  | `posting_is_limited_per_user` | rate limits on: 30 posts, two hours apart, pass; the 31st is 429 `RATE_LIMITED` with `Retry-After` |

  Unit test in `policy.rs`: `the_business_day_starts_at_local_midnight`. At an offset of +60,
  `2026-10-18T23:30Z` gives `2026-10-18T23:00Z`, and `2026-10-18T22:30Z` gives `2026-10-17T23:00Z` (review
  focus 2).
- [ ] **Step 2:** `cargo test --test workouts` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test --test workouts --test security` passes.
- [ ] **Step 5:** commit `feat(backend): POST /workouts and GET /workouts/:id, idempotent, with anti-cheat layer 1`.

### Task 5: `POST /workouts/sync`

**Files:**

- Modify:
  - `apps/backend/src/modules/workouts/mod.rs`;
  - `apps/backend/src/validate.rs`;
  - `apps/backend/tests/workouts.rs`.

**Interfaces:**

- **Produces:** `pub fn valid<T: DeserializeOwned + Validate>(bytes: &[u8]) -> Result<T, AppError>` in
  `validate.rs`, which is `parse` followed by `validate`. `ValidJson` now calls it, so a single-workout body and a
  batch item go through the same path.
- **The sync body:** `SyncBody { items: Vec<Value> }` with `deny_unknown_fields`, validated for 1 to 50 items
  (`ARRAYMINSIZE`, `ARRAYMAXSIZE`). The handler:
  1. checks `rate_limit::check(WORKOUTS_SYNC_USER, user id)`;
  2. then, for each item in order, runs `valid::<WorkoutBody>` and `intake::create`;
  3. maps the result as in the sync table above.

- [ ] **Step 1: write the failing tests.**
  - `a_batch_answers_item_by_item`: six items, in this order:
    1. a new one: `CREATED`;
    2. one already sent: `REPLAYED`;
    3. a changed one under a known `clientId`: `CONFLICT`, with `error.code` `IDEMPOTENCY_CONFLICT`;
    4. an impossible run: `REJECTED`, with `workout.status` `REJECTED`;
    5. an unknown exercise: `INVALID`, with `error.code` `VALIDATION_FAILED` and `error.errors[0].code`
       `UNKNOWN_EXERCISE`;
    6. `durationS` 10: `INVALID`.

    The answer is one 200 with six results in order.
  - `a_batch_holds_one_to_fifty_items`: 0 items and 51 items each answer 422 on `items`.
  - `an_item_without_a_usable_client_id_is_invalid` (review focus 1): `clientId: "abc"` gives
    `{clientId: "abc", result: "INVALID"}`; an item without `clientId` gives `clientId: null`; the valid item
    after them is `CREATED`.
  - `syncing_is_limited_per_user`: rate limits on, the 11th one-item batch answers 429.
- [ ] **Step 2:** `cargo test --test workouts sync` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test --test workouts` passes.
- [ ] **Step 5:** commit `feat(backend): POST /workouts/sync, each offline workout answered on its own`.

### Task 6: `GET /workouts`

**Files:**

- Create: `apps/backend/src/http/page.rs`.
- Modify:
  - `apps/backend/src/http/mod.rs` (`pub mod page;`);
  - `apps/backend/src/modules/workouts/mod.rs`;
  - `apps/backend/tests/workouts.rs`.

**Interfaces (produces, for every list of part 2):**

- `pub fn encode(secret: &SecretString, key: &impl Serialize) -> String`. It gives base64url(JSON), then `.`,
  then the first 22 characters of base64url(HMAC-SHA256), as the old `CursorCodec` does.
- `pub fn decode<T: DeserializeOwned>(secret: &SecretString, cursor: &str) -> Result<T, AppError>`. It compares
  the signature in constant time, and answers `INVALID_CURSOR` on `cursor` for anything wrong.
- `pub fn limit(raw: Option<&str>) -> Result<u32, AppError>`: 20 by default; `ISINT`, `MIN` or `MAX` on `limit`.
- `pub fn page(data: Vec<Value>, next: Option<String>) -> Value`, the object `{data, page: {nextCursor, hasMore}}`.
- The workouts' cursor key is `{"p": performedAt, "id": workoutId}`. The order is `performed_at DESC, id DESC`, and
  a page fetches `limit + 1` rows.

- [ ] **Step 1: write the failing tests.**
  - Unit tests in `page.rs`:
    - `a_cursor_comes_back`;
    - `a_changed_character_is_refused`;
    - `another_secret_is_refused`;
    - `limits`: absent gives 20; 0 is `MIN`; 101 is `MAX`; `x` is `ISINT`.
  - `the_list_pages_newest_first`:
    1. three workouts, `limit` 2: `[w3, w2]` and `hasMore`;
    2. add a fourth, dated before `w2`;
    3. the next page is `[w4, w1]`, with `hasMore` false and `nextCursor` null.
  - `the_list_filters`:
    - `from` and `to` (`to` excluded), and `sportId`;
    - `cursor=abc` is 422 `INVALID_CURSOR`;
    - `from=x` is `ISISO8601`;
    - `sportId=x` is `ISUUID`.
  - `the_list_shows_only_mine`.
  - `workouts_have_the_shape_recorded_from_the_old_api`: `assert_same_shape` of `GET /workouts`, and of the first
    recorded `GET /workouts/<id>`, against `apps/mobile-rn/assets/demo/api.json`.
- [ ] **Step 2:** `cargo test --test workouts list` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test --lib page`, then `cargo test --test workouts`, pass.
- [ ] **Step 5:** commit `feat(backend): GET /workouts, newest first, with a signed keyset cursor`.

### Task 7: export and deletion

**Files:**

- Modify:
  - `apps/backend/src/modules/me/privacy.rs`;
  - `apps/backend/tests/privacy.rs`.

**Changes:**

- **The export:**
  - `workouts` becomes `intake::load(db, user, &Filter { limit: None, ..Default::default() })`;
  - `bodyMeasurements` becomes `body::all(state, user, None)`, decrypted.
- **`anonymise`, in its transaction:**
  - `DELETE FROM body_measurements WHERE user_id = ?`;
  - `UPDATE workouts SET notes = NULL, visibility = 'PRIVATE' WHERE user_id = ?`;
  - the notes of `workout_exercises` become NULL for that user's workouts.

- [ ] **Step 1: write the failing tests.**
  - `the_export_holds_workouts_and_weigh_ins`: one workout, and one weigh-in at 78.4, show in the export
    decrypted.
  - `anonymising_removes_weigh_ins_and_workout_notes`: after the sweep there are no measurements, the workout's
    notes are null and its visibility is `PRIVATE`, and the workout itself is still there.
- [ ] **Step 2:** `cargo test --test privacy` fails.
- [ ] **Step 3: implement.**
- [ ] **Step 4:** `cargo test --test privacy` passes.
- [ ] **Step 5:** commit `feat(backend): the export carries workouts and weigh-ins, and deletion removes weigh-ins and workout notes`.

### Task 8: documents and checks

- [ ] **Step 1: update the documents.**
  - README, backend section: `HEALTH_DATA_KEYS` in the setup, and the six routes.
  - Spec: the status line says plan 2a is built.
  - `handoff.md`.
- [ ] **Step 2:** `cargo sqlx prepare -- --all-targets`, with `DATABASE_URL` in the command's own environment
  (see the handoff's traps), then commit `.sqlx/`.
- [ ] **Step 3: run the checks** and read each output:
  - `cargo fmt --check`;
  - `cargo clippy --all-targets -- -D warnings`;
  - after touching `src/lib.rs`, `SQLX_OFFLINE=true cargo clippy --all-targets -- -D warnings`;
  - `cargo test`;
  - `cargo audit` and `cargo deny check`.
- [ ] **Step 4:** commit `docs: Rust backend plan 2a built: README, spec, handoff; sqlx offline data`.

## Done when

- `cargo test` passes with `body` and `workouts` next to the earlier suites, and the security suite passes
  unchanged.
- The app's outbox flush (`workout-sync.ts`) receives `CREATED`, `REPLAYED`, `CONFLICT`, `REJECTED` and `INVALID`
  as it expects.
- `BodyScreen` shows its consent screen on the 403.
