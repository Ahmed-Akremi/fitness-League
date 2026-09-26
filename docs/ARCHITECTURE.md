# Fitness League — Architecture Document (Phase 0)

> Status: **DRAFT, awaiting validation.** No application code has been written.
> Date: 2026-09-25 · Scope: the whole product (Phases 1–4), with Phase 1 detailed enough to start building.
> Conventions: `ASSUMPTION:` marks a decision I took to be able to continue. `Q-n` refers to the open questions in §12.

---

## Table of contents

1. [Stack confirmation and proposed changes](#1-stack-confirmation-and-proposed-changes)
2. [Module map and dependencies](#2-module-map-and-dependencies)
3. [Database schema](#3-database-schema)
4. [API](#4-api)
5. [Scoring engine](#5-scoring-engine)
6. [Matchmaking and Gym War algorithms](#6-matchmaking-and-gym-war-algorithms)
7. [Anti-cheat pipeline and thresholds](#7-anti-cheat-pipeline-and-thresholds)
8. [Background jobs](#8-background-jobs)
9. [Security architecture](#9-security-architecture)
10. [Offline sync protocol](#10-offline-sync-protocol)
11. [Testing strategy and deployment plan](#11-testing-strategy-and-deployment-plan)
12. [Open questions and assumptions](#12-open-questions-and-assumptions)
13. [Appendix: repository layout, Phase 1 build order, environment status](#13-appendix)

---

## 1. Stack confirmation and proposed changes

The default stack is **confirmed**. The table below only adds the choices the spec leaves open. Nothing here replaces a default.

| Layer | Choice | Note |
|---|---|---|
| Mobile | Flutter 3.x, Riverpod, go_router, **Drift** (SQLite), dio, freezed/json_serializable, fl_chart, `flutter_localizations` + ARB files | Confirmed. |
| Backend | NestJS 11 (TypeScript, strict), REST + OpenAPI (`@nestjs/swagger`), modular monolith | Confirmed. |
| ORM / migrations | **Prisma** (proposed) + raw SQL (`$queryRaw`) for ledger aggregation and reporting queries | Not specified in the spec. Prisma gives typed models, migrations and seeding with little glue. Alternative: Kysely (more SQL control, less tooling). **Q-14** |
| Validation | `class-validator` DTOs (Nest standard); **zod** for the `ScoringRuleSet` JSON document | Rule sets are big nested JSON; zod gives one schema for server validation and the admin form. |
| Database | PostgreSQL 16 (`citext`, `pgcrypto`) | Confirmed. |
| Cache / queues | Redis 7 + BullMQ | Confirmed. Redis also holds leaderboard sorted sets and rate-limit counters. |
| Real-time | **Socket.IO** (`@nestjs/websockets`) with Redis adapter | Socket.IO has a built-in long-polling fallback, which covers the "polling fallback" requirement for free. |
| Storage | S3-compatible (MinIO locally), presigned URLs | Confirmed. |
| Admin | React 19 + Vite + TanStack Query + React Router + shadcn/ui (Tailwind) | Confirmed (component library is my pick). |
| API clients | Generated from OpenAPI: `openapi-generator` **dart-dio** for mobile, `openapi-typescript` for admin | Keeps mobile/admin in sync with the API contract; CI fails if the generated client is stale. |
| Push | Firebase Cloud Messaging (Phase 2) | Confirmed. |
| Monorepo | **pnpm workspaces** (`apps/api`, `apps/admin`, `apps/mobile`, `packages/*`) | One repo, one CI. Flutter lives in the same repo but is built by its own toolchain. |
| Logs / errors | pino (JSON logs, request id), Sentry (optional, via env) | No stack traces to clients (§4.4). |
| Timezone | All timestamps stored UTC (`timestamptz`); business calendar (weeks, seasons) in **Africa/Tunis** | Configurable per country later. |
| Local dev | Docker Compose: `api`, `db`, `redis`, `minio`, `mailpit` (captures emails locally) | Added `mailpit` so email verification works offline in dev. |
| CI | GitHub Actions: lint, typecheck, unit, integration (service containers), Flutter analyze/test, admin build | Confirmed. |

**No change to the architecture style**: modular monolith, one deployable API process + one worker process (same codebase, different entrypoint) so BullMQ jobs never run inside request handlers.

---

## 2. Module map and dependencies

### 2.1 Modules

Each backend module = `controller → service → repository` + its DTOs, events and tests. Modules talk to each other **only through exported services or domain events**, never through another module's repository or tables.

| Module | Responsibility | Phase |
|---|---|---|
| `common` | Config, errors (problem+json), pagination, guards, i18n error codes, encryption helper, clock | 1 |
| `auth` | Register, login, OAuth (Google/Apple), tokens, email verification, password reset, lockout | 1 |
| `users` | User, Profile, UserSettings, consents, data export, account deletion (anonymisation), body measurements | 1 |
| `reference` | Countries, governorates, cities, sports, exercises, metric types (data-driven catalog) | 1 |
| `gyms` | Gym profiles, verification requests, memberships | 1 (wars in 2) |
| `workouts` | Workout ingestion, idempotency, edit/delete, derived metrics (volume, e1RM) | 1 |
| `anticheat` | Rule-based evaluation of workouts & PRs (Phase 1), behavioural signals (Phase 3) | 1 / 3 |
| `progress` | Baselines, calibration, PR detection, "My Progress" queries | 1 |
| `goals` | Goals, milestones, suggestions, safety softening | 1 |
| `scoring` | Rule sets, calculation pipeline (XP, weekly score, LP), explanations | 1 |
| `ledger` | Append-only `XpTransaction` / `LeaguePointTransaction`, reversals, cached balances | 1 |
| `seasons` | Seasons, divisions, soft reset, standings | 1 |
| `leaderboards` | Redis sorted sets, snapshots, movement, eligibility | 1 |
| `social` | Friendships, follows, blocks, mutes (Phase 1); feed, likes, comments (Phase 2) | 1 / 2 |
| `battles` | Friend Battles (Phase 1), Weekly Duels (Phase 2) | 1 / 2 |
| `matchmaking` | MMR (Glicko-2), duel queue, gym-war pairing | 2 |
| `leagues` | User-created and public leagues | 2 |
| `challenges` | Personal / friend / community / gym challenges | 2 |
| `badges` | Data-driven badge rules, awarding | 2 |
| `notifications` | In-app + FCM, preferences, quiet hours, WebSocket gateway | 2 (in-app list minimal in 1) |
| `media` | Upload pipeline (avatar in Phase 1, proofs in Phase 3) | 1 / 3 |
| `moderation` | Reports, evidence, actions, appeals, public log | 3 (held-workout queue in 1) |
| `audit` | AuditLog writer (used by every module) | 1 |
| `admin` | Admin-only controllers aggregating other modules' services | 1 |
| `integrations` | `DataSourceAdapter` interface only; adapters in Phase 4 | 1 (interface) / 4 |

### 2.2 Dependency graph (arrows = "depends on")

```
                      ┌────────────┐
                      │   common   │  ← everyone
                      └────────────┘
 auth ──► users ──► reference
 gyms ──► users, reference
 workouts ──► users, reference, anticheat, media
 progress ──► workouts(events), reference
 goals ──► progress, reference
 scoring ──► progress, workouts(read), goals, ledger, seasons, (challenges P2), (gyms P2)
 ledger  ──► (nothing but common)            ◄── scoring, battles, moderation
 seasons ──► ledger
 leaderboards ──► ledger(events), seasons, users, gyms, social
 battles ──► scoring(weekly/battle score), ledger, social, (matchmaking P2)
 matchmaking ──► battles, seasons, social, gyms
 moderation ──► workouts, ledger, users, media
 admin ──► all module services (read + privileged commands)
 audit ◄── everyone (write-only)
```

**Rules enforced in code review / lint (`eslint-plugin-boundaries`):** no import of another module's `*.repository.ts`; `ledger` has zero outgoing domain dependencies; `scoring` is the only module allowed to *create* score ledger entries (battles/moderation call `scoring`/`ledger` services).

### 2.3 Main event flow (workout → points)

```
POST /workouts
  └─ workouts: validate DTO, idempotency check, persist Workout (status=PROCESSING)
      └─ anticheat.evaluate(workout)  (synchronous, < 50 ms, rules only)
          ├─ REJECTED → Workout.status=REJECTED, no points, reason returned
          ├─ HELD_FOR_REVIEW → points computed but stored as "pending" in WorkoutEvaluation
          └─ ACCEPTED
               └─ domain event WorkoutAccepted (in-process, same transaction boundary via outbox)
                    ├─ progress: update derived metrics, detect PRs, calibration baselines
                    ├─ goals: check milestones
                    └─ scoring: compute XP (workout, PR, milestone) → ledger.append()
                          └─ event LedgerChanged → leaderboards (weekly LP is posted by job, §8)
```

Events are dispatched via a **transactional outbox** table (`domain_event_outbox`) drained by the worker. This guarantees that "workout saved" and "points computed" can't diverge if the process crashes between the two.

---

## 3. Database schema

### 3.1 Conventions

- Primary keys: `id uuid` (UUID v7 generated by the app, time-ordered for index locality).
- Every table: `created_at timestamptz not null default now()`, `updated_at timestamptz not null` (except append-only tables, which have `created_at` only).
- Soft delete (`deleted_at timestamptz null`) on: `users`, `workouts`, `goals`, `gyms`, `leagues`, `challenges`, comments (P2). Partial indexes filter `deleted_at is null`.
- Money-like and measurement values: `numeric(8,2)` for kg, `integer` metres / seconds. All units SI; display conversion is client-side.
- Enums: PostgreSQL enums for stable sets (roles, statuses); lookup tables for data-driven sets (sports, exercises, metric types, badges).
- **Health data** (body weight, measurements) stored in `bytea` columns encrypted with AES-256-GCM at application level (key from secret manager, key id stored alongside for rotation). Never indexed, never exported to analytics.
- `citext` for email and username (case-insensitive uniqueness).

### 3.2 Identity, profile, settings

**users**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| email | citext unique not null | |
| username | citext unique not null | 3–20 chars `[a-z0-9_.]` |
| password_hash | text null | null for OAuth-only accounts; Argon2id |
| role | enum `SUPER_ADMIN, ADMIN, MODERATOR, GYM_ADMIN, USER` | default USER |
| status | enum `ACTIVE, SUSPENDED, BANNED, DELETED` | |
| email_verified_at | timestamptz null | |
| phone_e164 | text null unique | optional |
| phone_verified_at | timestamptz null | |
| date_of_birth | date not null | never exposed publicly; used for age gate and optional bracket |
| failed_login_count | int default 0 | |
| locked_until | timestamptz null | |
| suspended_until | timestamptz null | |
| last_login_at | timestamptz null | |
| deleted_at, anonymised_at | timestamptz null | deletion = anonymisation (§9.7) |

Indexes: unique(email), unique(username), index(status).
Constraint: `check (date_of_birth <= current_date - interval '16 years')` is **not** used (age is config-driven); enforced in service.

**oauth_identities** — `user_id FK`, `provider enum(GOOGLE, APPLE)`, `subject text`, unique(provider, subject).

**refresh_tokens** — `id`, `user_id`, `family_id uuid`, `token_hash bytea` (SHA-256), `device_id`, `expires_at`, `revoked_at`, `replaced_by_id`. Index(user_id), unique(token_hash).

**verification_tokens** — `user_id`, `type enum(EMAIL_VERIFY, PASSWORD_RESET, PHONE_OTP)`, `token_hash`, `expires_at`, `consumed_at`, `attempts`.

**devices** — `user_id`, `platform enum(ANDROID, IOS, WEB)`, `fcm_token null`, `app_version`, `last_seen_at`, `install_id` (for multi-account signals, P3).

**profiles** (1:1 users)
| column | notes |
|---|---|
| user_id PK/FK | |
| full_name | |
| bio | ≤ 280 chars |
| avatar_media_id FK media null | |
| gender | enum `MALE, FEMALE, UNDISCLOSED` null (optional) — see Q-7 |
| country_code | char(2), default `TN` |
| governorate_id FK | not null |
| city_id FK | not null |
| primary_gym_id FK null | denormalised from active approved membership |
| experience_level_declared | enum `BEGINNER, INTERMEDIATE, ADVANCED` |
| planned_training_days_per_week | smallint 1–7, default 3 |
| calibration_started_at, calibration_ends_at | timestamptz |
| onboarding_completed_at | timestamptz null |

**user_sports** — `user_id`, `sport_id`, `is_primary bool`; PK(user_id, sport_id).

**user_settings** (1:1) — `locale enum(fr, en, ar)`, `theme enum(DARK, LIGHT, SYSTEM)`, `reduced_motion bool null` (null = follow OS), `default_visibility enum(PUBLIC, FRIENDS, PRIVATE)`, `show_age_bracket bool default false`, `show_on_leaderboards bool default true`, `notification_prefs jsonb`, `quiet_hours_start time null`, `quiet_hours_end time null`, `streak_freeze_days_per_week smallint default 2`.

**consents** — append-only: `user_id`, `type enum(TERMS, PRIVACY, HEALTH_DATA, MARKETING)`, `document_version`, `granted bool`, `created_at`, `ip_hash`.

**body_measurements** — `user_id`, `measured_at`, `weight_kg_enc bytea`, `body_fat_pct_enc bytea null`, `key_id`, `source enum DataSource`. Index(user_id, measured_at desc). Visible to owner only.

**data_requests** — `user_id`, `type enum(EXPORT, DELETION)`, `status`, `requested_at`, `completed_at`, `artifact_media_id null`, `scheduled_for` (deletion grace, default 30 days).

### 3.3 Location and reference catalog

**countries** — `code char(2) PK`, `name_i18n jsonb`, `enabled bool`.
**governorates** — `id`, `country_code FK`, `code` (ISO 3166-2, e.g. `TN-51` Sousse), `name_i18n jsonb`. Seed: 24 Tunisian governorates.
**cities** — `id`, `governorate_id FK`, `name_i18n jsonb`. Seed: main cities / delegations per governorate (ASSUMPTION: municipalities, not the 264 delegations — Q-18).

**sports** — `id`, `code` unique (`BODYBUILDING`, `POWERLIFTING`, `WEIGHT_TRAINING`, `CROSSFIT`, `FUNCTIONAL`, `RUNNING`, `CYCLING`, `WALKING`, `SWIMMING`), `category enum(STRENGTH, FUNCTIONAL, CARDIO)`, `name_i18n`, `icon`, `enabled`, `logging_mode enum(SETS_REPS_WEIGHT, DISTANCE_TIME, MIXED)`.

**metric_types** — `id`, `code` (`MAX_WEIGHT`, `E1RM`, `REPS_AT_WEIGHT`, `DISTANCE`, `TIME_1K`, `TIME_5K`, `TIME_10K`, `TIME_21K`, `PACE`, `BODY_WEIGHT`, `WORKOUTS_PER_WEEK`), `unit` (`kg`, `m`, `s`, `s_per_km`, `count`), `direction enum(HIGHER_IS_BETTER, LOWER_IS_BETTER)`.

**exercises** — `id`, `sport_id FK null` (null = shared across strength sports), `code` unique (`BACK_SQUAT`, `BENCH_PRESS`, `DEADLIFT`, `OHP`, `PULL_UP`, `RUN`, `RIDE`, `WALK`, `SWIM_FREESTYLE`…), `name_i18n`, `equipment`, `is_bodyweight bool`, `tracked_metrics text[]` (metric codes), `plausibility jsonb` (per-exercise overrides of §7 thresholds), `enabled`, `updated_at` (for client delta sync).

### 3.4 Workouts

**workouts**
| column | type | notes |
|---|---|---|
| id | uuid PK | server id |
| user_id | FK | |
| client_id | uuid not null | client-generated idempotency key |
| payload_hash | bytea | SHA-256 of canonical payload (idempotent replay vs conflict) |
| sport_id | FK | |
| workout_type | text | free enum per sport (e.g. `STRENGTH`, `WOD`, `EASY_RUN`, `INTERVALS`) |
| performed_at | timestamptz | start time as declared by client |
| duration_s | int | |
| notes | text ≤ 2000 | |
| visibility | enum | |
| data_source | enum `MANUAL, HEALTH_CONNECT, APPLE_HEALTH, STRAVA, GARMIN, IMPORT` | Phase 4 adapters write other values |
| external_ref | text null | provider activity id; unique(user_id, data_source, external_ref) |
| status | enum `PROCESSING, ACCEPTED, HELD_FOR_REVIEW, REJECTED` | |
| is_verified | bool default false | Phase 3 proof |
| received_at | timestamptz | server time of first receipt |
| device_submitted_at | timestamptz | client clock at submission (skew detection) |
| total_volume_kg | numeric(12,2) | derived |
| total_distance_m | int | derived |
| fingerprint | bytea | hash of normalised sets (near-duplicate detection) |
| version | int default 1 | optimistic concurrency |
| deleted_at | timestamptz null | |

Indexes: **unique(user_id, client_id)**, (user_id, performed_at desc) where deleted_at is null, (status) where status = 'HELD_FOR_REVIEW', (user_id, fingerprint).

**workout_exercises** — `id`, `workout_id FK cascade`, `exercise_id FK`, `position smallint`, `notes`.

**workout_sets** — `id`, `workout_exercise_id FK cascade`, `set_index`, `reps smallint null`, `weight_kg numeric(6,2) null`, `distance_m int null`, `duration_s int null`, `is_warmup bool`, `rpe numeric(3,1) null`, `e1rm_kg numeric(6,2) null` (derived).
Check constraints: `reps between 0 and 1000`, `weight_kg between 0 and 1000`, `distance_m between 0 and 1000000`, `duration_s between 0 and 86400`, at least one of (reps, distance_m, duration_s) not null.

**workout_evaluations** (1:1 workouts, anti-cheat + scoring snapshot)
`workout_id PK`, `outcome enum(ACCEPTED, HELD_FOR_REVIEW, REJECTED)`, `rule_hits jsonb` (list of `{rule, severity, value, threshold}`), `confidence numeric(4,3)`, `rule_set_version int`, `pending_points jsonb` (XP that will be posted if a held workout is approved), `reviewed_by`, `reviewed_at`, `review_note`.

**proof_media** (Phase 3) — `workout_id`, `media_id`, `kind enum(PHOTO, SCREENSHOT, VIDEO, IMPORT)`.

**media** — `id`, `owner_id`, `bucket`, `object_key`, `mime`, `size_bytes`, `sha256`, `status enum(PENDING_UPLOAD, SCANNING, READY, REJECTED)`, `purpose enum(AVATAR, PROOF, REPORT_EVIDENCE, GYM_PROOF, EXPORT)`, `width`, `height`, `duration_s`.

### 3.5 Progress, baselines, PRs, goals

**baselines** — `id`, `user_id`, `exercise_id`, `metric_type_id`, `declared_value numeric null`, `calibrated_value numeric null`, `effective_value numeric not null`, `status enum(PROVISIONAL, FINAL, CORRECTED)`, `experience_level enum` (derived, §5.4), `finalized_at`, `corrected_from numeric null`, `rule_set_version`. Unique(user_id, exercise_id, metric_type_id).

**personal_records** — `id`, `user_id`, `exercise_id`, `metric_type_id`, `qualifier numeric null` (e.g. weight for `REPS_AT_WEIGHT`, distance for times), `value numeric`, `previous_value numeric null`, `workout_id FK`, `workout_set_id FK null`, `status enum(AWARDED, CALIBRATION, HELD, REVOKED, SUPERSEDED)`, `achieved_at`, `xp_transaction_id null`.
Indexes: (user_id, exercise_id, metric_type_id, qualifier, achieved_at desc); partial unique on the current record per key: `unique(user_id, exercise_id, metric_type_id, coalesce(qualifier,0)) where status in ('AWARDED','CALIBRATION')` is replaced by a `current` flag: `is_current bool` + partial unique index `where is_current`.

**metric_observations** — materialised per-workout best value per (user, exercise, metric): `user_id`, `exercise_id`, `metric_type_id`, `qualifier`, `value`, `workout_id`, `observed_at`, `counts_for_competition bool`. Index(user_id, exercise_id, metric_type_id, observed_at). Source for "My Progress" charts and rolling progress windows (keeps §5 queries O(index range)).

**goals** — `id`, `user_id`, `type enum(WEIGHT, STRENGTH, RUNNING, HABIT)`, `exercise_id null`, `metric_type_id`, `direction enum(INCREASE, DECREASE)`, `start_value`, `target_value`, `start_date`, `target_date null`, `status enum(ACTIVE, COMPLETED, ABANDONED, EXPIRED)`, `was_suggested bool`, `safety_adjustment jsonb null` (original request + reason it was softened), `visibility`, `deleted_at`. Weight goal values are stored encrypted (`start_value_enc`, `target_value_enc`) — weight goals use the encrypted variant columns; other goals use plain numeric.

**goal_milestones** — `id`, `goal_id FK`, `index smallint`, `target_value`, `reached_at null`, `workout_id null`, `xp_transaction_id null`. Unique(goal_id, index).

**streaks** — `user_id PK`, `current_days`, `longest_days`, `last_training_date`, `freezes_used_this_week`, `week_start`. (Derived/cached; recomputable from workouts.)

**activity_events** — `id`, `user_id`, `type enum(WORKOUT, PR, BADGE, LEVEL_UP, BATTLE_WIN, GYM_WAR_WIN, GOAL_COMPLETED)`, `ref_type`, `ref_id`, `payload jsonb`, `visibility`, `created_at`. Index(user_id, created_at desc). Written in Phase 1, feed read in Phase 2.

### 3.6 Scoring and ledgers

**scoring_rule_sets**
| column | notes |
|---|---|
| id uuid PK | |
| version int unique not null | monotonically increasing |
| status enum `DRAFT, ACTIVE, ARCHIVED` | partial unique index: only one ACTIVE |
| config jsonb not null | full rule document validated by zod schema (keys in §5.9) |
| config_hash bytea | |
| based_on_version int null | |
| change_note text not null | |
| created_by FK users, activated_by FK users, activated_at | |

**expected_progression** — `id`, `rule_set_id FK`, `experience_level`, `sport_id null`, `exercise_id null`, `metric_type_id`, `period_days` (default 28), `expected_pct numeric(6,3)`. Unique(rule_set_id, experience_level, exercise_id, metric_type_id, period_days). Kept out of the JSON because it's a large, filterable table edited as a grid in admin.

**xp_transactions** (append-only)
| column | notes |
|---|---|
| id uuid PK | |
| user_id FK | |
| amount int not null | positive for grants; negative only for `REVERSAL` / `MODERATION` |
| reason enum | `WORKOUT, PR, CALIBRATION_PR, GOAL_MILESTONE, CHALLENGE, BATTLE, BATTLE_WIN, GYM_WAR_WIN, QUEST, REVERSAL, MODERATION, ADMIN_ADJUSTMENT` |
| source_type text, source_id uuid | what caused it (workout, PR, battle…) |
| reverses_id uuid null FK self | for reversals; **unique** (an entry is reversed at most once) |
| rule_set_version int not null | |
| explanation jsonb not null | inputs + formula steps + caps applied (§5.8) |
| effective_at timestamptz | business time (workout time), used for daily/weekly caps |
| created_at | |
| created_by FK null | admin/mod for manual entries |

Constraints: partial **unique(user_id, reason, source_type, source_id) where reverses_id is null** → the same event can never be granted twice, even under retries. `check ((reason in ('REVERSAL','MODERATION','ADMIN_ADJUSTMENT')) or amount >= 0)`.
DB-level immutability: `REVOKE UPDATE, DELETE` from the app role + a trigger raising on UPDATE/DELETE.

**league_point_transactions** (append-only) — same shape as `xp_transactions` plus `season_id FK not null`; reasons: `WEEKLY_SCORE, BATTLE_WIN, BATTLE_DRAW, BATTLE_PARTICIPATION, GYM_WAR, SEASON_SOFT_RESET, REVERSAL, MODERATION, ADMIN_ADJUSTMENT`. Amount may be negative only for `REVERSAL`, `MODERATION`, `ADMIN_ADJUSTMENT`, `SEASON_SOFT_RESET`. Index(user_id, season_id, created_at).

**user_stats** (cached balances, updated **in the same DB transaction** as the ledger insert)
`user_id PK`, `xp_total bigint`, `level int`, `xp_into_level int`, `xp_for_next_level int`, `current_season_id`, `season_lp int`, `division_id`, `leaderboard_eligible bool`, `updated_at`. A nightly job (§8) recomputes from ledgers and alerts on drift.

**weekly_scores** — `id`, `user_id`, `week_start date` (Monday, Africa/Tunis), `season_id`, `rule_set_version`, `progress_c numeric(5,2)`, `consistency_c`, `performance_c`, `challenge_c`, `total numeric(5,2)`, `breakdown jsonb`, `lp_transaction_id null`, `status enum(PROVISIONAL, FINAL)`. Unique(user_id, week_start).

**xp_daily_counters** — `user_id`, `day date`, `xp_granted int`, `workouts_counted int`; PK(user_id, day). Used for caps (row-locked `SELECT … FOR UPDATE` to be race-safe). Weekly cap computed by summing 7 rows.

### 3.7 Seasons, divisions, leaderboards

**seasons** — `id`, `name`, `country_code`, `starts_at`, `ends_at`, `status enum(SCHEDULED, ACTIVE, CLOSING, CLOSED)`, `closed_at`, `rule_set_version_at_close`. Constraint: no overlapping ACTIVE seasons per country (exclusion constraint on `tstzrange`).

**divisions** — `id`, `code enum(BRONZE, SILVER, GOLD, PLATINUM, DIAMOND, ELITE)`, `order smallint`, `min_lp int`, `name_i18n`, `rule_set_version`. (Thresholds are part of rule set; the table is the materialised current version for joins.)

**season_standings** — `season_id`, `user_id`, `final_lp`, `division_id`, `rank_national`, `rank_governorate`, `rank_gym null`, `is_champion bool`, `champion_scope text null`. PK(season_id, user_id).

**leaderboard_snapshots** — `snapshot_date date`, `season_id`, `scope_type enum(NATIONAL, GOVERNORATE, GYM, LEAGUE)`, `scope_id uuid null`, `user_id`, `rank int`, `lp int`. PK(snapshot_date, scope_type, scope_id, user_id). **Range-partitioned by month** on `snapshot_date`; retention: daily for 90 days, then keep Monday snapshots only. Friends leaderboard is not snapshotted (computed from national ranks).

### 3.8 Social

**friendships** — `user_low_id`, `user_high_id` (ordered pair, `check (user_low_id < user_high_id)`), `status enum(PENDING, ACCEPTED)`, `requested_by`, `accepted_at`. PK(user_low_id, user_high_id). Index(user_high_id).
**follows** — `follower_id`, `followee_id`, PK both, index(followee_id).
**blocks** — `blocker_id`, `blocked_id`, PK both. Blocks hide both users from each other everywhere (search, leaderboards names are kept but profile access denied, battles impossible).
**mutes** — `muter_id`, `muted_id` (Phase 2 feed).
**reactions / comments** (Phase 2) — `activity_event_id`, `user_id`, `type`/`body`, `deleted_at`.

### 3.9 Battles and matchmaking

**battles** — `id`, `type enum(FRIEND, DUEL)`, `status enum(PENDING, ACTIVE, COMPLETED, DECLINED, CANCELLED, EXPIRED)`, `created_by`, `season_id`, `starts_at`, `ends_at`, `duration_days smallint`, `config jsonb` (counted components, §5.7), `is_ghost bool default false`, `result jsonb null`, `closed_at`, `rule_set_version`. Index(status, ends_at).
**battle_participants** — `battle_id`, `user_id`, `accepted_at`, `score numeric(5,2) null`, `breakdown jsonb`, `outcome enum(WIN, LOSS, DRAW) null`, `lp_transaction_id null`, `xp_transaction_id null`. PK(battle_id, user_id). Index(user_id, battle_id).
**mmr_ratings** (P2) — `user_id PK`, `rating numeric(7,2) default 1500`, `rd numeric(6,2) default 350`, `volatility numeric(6,5) default 0.06`, `games int`, `last_period date`.
**duel_queue_entries** (P2) — `user_id`, `week_start`, `joined_at`, `status enum(WAITING, MATCHED, GHOST, LEFT)`, `current_window int`. Unique(user_id, week_start).

### 3.10 Leagues, challenges, badges (Phase 2)

**leagues** — `id`, `name`, `slug`, `visibility enum(PUBLIC, PRIVATE)`, `invite_code` unique, `owner_id`, `max_members`, `starts_at`, `ends_at`, `allowed_sport_ids uuid[]`, `scoring_preset enum(STANDARD, CONSISTENCY, PROGRESS)`, `governorate_id null`, `deleted_at`.
**league_members** — `league_id`, `user_id`, `role enum(OWNER, MEMBER)`, `joined_at`, `left_at`. PK(league_id, user_id).
**challenges** — `id`, `scope enum(PERSONAL, FRIEND, COMMUNITY, GYM)`, `metric_type_id`, `target_value`, `aggregation enum(SUM, COUNT, MAX)`, `starts_at`, `ends_at`, `gym_id null`, `created_by`, `xp_reward`, `status`, `deleted_at`.
**challenge_participants** — `challenge_id`, `user_id`, `progress_value`, `completed_at`, `xp_transaction_id`.
**badges** — `id`, `code`, `category enum(PROGRESS, CONSISTENCY, COMPETITION, SOCIAL, GYM, ELITE)`, `name_i18n`, `description_i18n`, `icon`, `rarity`, `rule jsonb` (e.g. `{"type":"COUNT","event":"PR_AWARDED","gte":10}`), `enabled`.
**user_badges** — `user_id`, `badge_id`, `awarded_at`, `source_ref`, `revoked_at`. Unique(user_id, badge_id).

### 3.11 Gyms and Gym Wars

**gyms** — `id`, `name`, `slug` unique, `country_code`, `governorate_id`, `city_id`, `address_line`, `contact_phone`, `contact_email`, `social_links jsonb`, `status enum(PENDING, VERIFIED, REJECTED, SUSPENDED)`, `owner_user_id`, `verified_at`, `verified_by`, `level int`, `rating numeric`, `rating_rd numeric`, `logo_media_id`, `deleted_at`. Index(governorate_id, status).
**gym_verification_requests** — `gym_id`, `submitted_by`, `proof_media_ids uuid[]`, `status`, `reviewed_by`, `review_note`.
**gym_members** — `id`, `gym_id`, `user_id`, `status enum(PENDING, APPROVED, REMOVED, LEFT, REJECTED)`, `requested_at`, `approved_at`, `approved_by`, `left_at`. Partial unique(user_id) where status in ('PENDING','APPROVED') → **one gym per user** (ASSUMPTION, Q-9).
**gym_wars** (P2) — `id`, `week_start`, `status`, `size_bracket`, `result jsonb`, `rule_set_version`.
**gym_war_participants** — `gym_war_id`, `gym_id`, `score numeric`, `breakdown jsonb`, `outcome`, `eligible_member_count`, `active_member_count`.

### 3.12 Trust, moderation, notifications, audit

**reports** — `id`, `reporter_id`, `target_type enum(WORKOUT, PR, ACTIVITY, COMMENT, PROFILE, GYM)`, `target_id`, `target_owner_id`, `reason enum(SUSPICIOUS, IMPOSSIBLE, DUPLICATE, FAKE_PROOF, MANIPULATED_EVIDENCE, HARASSMENT, OTHER)`, `explanation`, `status enum(PENDING_REVIEW, VALID, INVALID, DISMISSED)`, `merged_into_id null` (duplicate reports on same target merge), `assigned_to`, `decided_at`.
Index(target_type, target_id, status), (reporter_id, created_at).
**report_evidence** — `report_id`, `media_id`, `note`.
**moderation_actions** — `id`, `report_id null`, `target_user_id`, `action enum(WARNING, POINTS_REMOVED, TEMP_SUSPENSION, BAN, PR_REVOKED, WORKOUT_REJECTED, WORKOUT_APPROVED)`, `reason_code`, `details jsonb`, `ledger_refs uuid[]`, `suspension_until`, `decided_by`, `appeal_status enum(NONE, PENDING, UPHELD, OVERTURNED)`, `public_summary_i18n jsonb` (anonymised text for the public log).
**reporter_reputation** — `user_id PK`, `score numeric default 1.0`, `valid_count`, `invalid_count`.
**notifications** — `id`, `user_id`, `type`, `payload jsonb`, `read_at`, `delivered_push_at`, `created_at`. Index(user_id, created_at desc).
**audit_logs** (append-only, partitioned by month) — `id`, `actor_id null`, `actor_role`, `action` (e.g. `RULESET_ACTIVATED`, `USER_BANNED`), `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `ip_hash`, `request_id`, `created_at`. Index(entity_type, entity_id), (actor_id, created_at).
**domain_event_outbox** — `id`, `type`, `payload jsonb`, `created_at`, `processed_at`, `attempts`. Index where processed_at is null.

---

## 4. API

### 4.1 Conventions

- Base path `/api/v1`. JSON only. OpenAPI at `/api/docs` (disabled in production, spec exported as a build artifact).
- Auth: `Authorization: Bearer <access JWT>`. Legend below: **P** public, **U** authenticated user, **U✓** user with verified email, **GA** gym admin of that gym, **M** moderator+, **A** admin+, **SA** super admin.
- `Accept-Language: fr|en|ar` only affects server-rendered texts (emails, notifications). API errors return stable **codes**; the client translates them.
- Idempotency: `POST /workouts` and `POST /workouts/sync` require `Idempotency-Key` (= workout `clientId`).
- Concurrency: mutable resources return `ETag: "<version>"`; `PATCH` requires `If-Match`.

### 4.2 Pagination (cursor only)

Request: `?limit=20&cursor=<opaque>` (limit 1–100, default 20).

```json
{
  "data": [ ... ],
  "page": { "nextCursor": "eyJrIjoiMjAyNi0wOS0yNVQxMDowMDowMFoiLCJpZCI6Ii4uLiJ9", "hasMore": true }
}
```
The cursor is base64url of `{sortKey, id}` (keyset pagination, stable under inserts), HMAC-signed so clients can't forge it. Leaderboards use `{scoreKey, userId, snapshotVersion}`.

### 4.3 Error format (RFC 9457 problem+json)

```json
{
  "type": "https://errors.fitnessleague.app/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "detail": "One or more fields are invalid.",
  "errors": [ { "field": "exercises[0].sets[2].reps", "code": "MAX", "params": { "max": 1000 } } ],
  "traceId": "01J8…"
}
```
Standard codes: `VALIDATION_FAILED` 422, `UNAUTHENTICATED` 401, `TOKEN_EXPIRED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` / `IDEMPOTENCY_CONFLICT` / `VERSION_CONFLICT` 409, `RATE_LIMITED` 429 (+ `Retry-After`), `ACCOUNT_LOCKED` 423, `UNDER_AGE` 422, `WORKOUT_REJECTED` 422 (with `ruleHits`), `INTERNAL` 500 (no stack trace, only `traceId`).

### 4.4 Endpoints — Phase 1

**Health**
| Method | Path | Auth |
|---|---|---|
| GET | `/health`, `/ready` | P |

**auth**
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | P | username, fullName, email, password, dateOfBirth, countryCode, governorateId, cityId, consents[]; optional phone, gender |
| POST | `/auth/login` | P | returns access + refresh |
| POST | `/auth/refresh` | P (refresh token) | rotation, reuse detection |
| POST | `/auth/logout` | U | revokes the token family |
| POST | `/auth/oauth/google` | P | Google ID token |
| POST | `/auth/oauth/apple` | P | Apple identity token |
| POST | `/auth/email/verify` | P | token |
| POST | `/auth/email/resend` | U | |
| POST | `/auth/password/forgot` | P | always 202 (no account enumeration) |
| POST | `/auth/password/reset` | P | |
| POST | `/auth/phone/send-code`, `/auth/phone/verify` | U | provider TBD, Q-15 (may slip to P2) |

**users / me**
| Method | Path | Auth |
|---|---|---|
| GET | `/me` | U — user + profile + settings + stats summary (home screen payload) |
| PATCH | `/me/profile` | U |
| PATCH | `/me/settings` | U |
| GET / POST | `/me/consents` | U |
| GET / POST | `/me/body-measurements` | U (owner only, decrypted on read) |
| POST | `/me/avatar/upload-url` → `/me/avatar/confirm` | U |
| POST | `/me/data-export` | U (async, emailed link) |
| DELETE | `/me` | U (re-auth required; 30-day grace) |
| GET | `/users/{username}` | U — public profile, respects visibility & blocks |
| GET | `/search?q=&type=athletes\|gyms` | U |

**onboarding**
| POST | `/me/onboarding/sports` | U |
| POST | `/me/onboarding/baselines` | U — declared values (provisional) |
| GET | `/me/onboarding` | U — current step |
| POST | `/me/onboarding/complete` | U — starts calibration, grants first quest |

**reference** (cacheable, `ETag`, `?updatedSince=` for delta sync)
| GET | `/ref/countries`, `/ref/governorates`, `/ref/cities?governorateId=`, `/ref/sports`, `/ref/exercises?sportId=&updatedSince=`, `/ref/metric-types` | P |

**workouts**
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/workouts` | U | `Idempotency-Key` required; returns workout + evaluation + points summary |
| POST | `/workouts/sync` | U | batch ≤ 50 offline workouts, per-item result |
| GET | `/workouts?cursor=&from=&to=&sportId=` | U | own workouts |
| GET | `/workouts/{id}` | U | owner, or visibility allows |
| PATCH | `/workouts/{id}` | U | `If-Match`; editable ≤ 24 h after `received_at`, triggers rescoring |
| DELETE | `/workouts/{id}` | U | soft delete → reversal entries |
| GET | `/workouts/{id}/points` | U (owner) | "why I got these points" |
| GET | `/users/{username}/workouts` | U | public/friends-visible only |

**progress / PRs / goals**
| GET | `/me/progress?period=7d\|30d\|3m\|6m\|1y` | U |
| GET | `/me/progress/metrics/{exerciseId}/{metricCode}?period=` | U — series for chart |
| GET | `/me/baselines` | U |
| GET | `/me/records`, `/me/records/{id}` | U |
| GET | `/users/{username}/records` | U (visibility) |
| GET / POST | `/goals` | U |
| GET / PATCH / DELETE | `/goals/{id}` | U (owner) |
| POST | `/goals/suggestions` | U — `{type, exerciseId?, metricCode}` → ranked suggestions with ETA range |

**scoring / ledger**
| GET | `/me/xp` (balance, level, progress to next) | U |
| GET | `/me/xp/transactions?cursor=` | U |
| GET | `/me/lp?seasonId=` (balance, division) | U |
| GET | `/me/lp/transactions?cursor=&seasonId=` | U |
| GET | `/me/weekly-scores?cursor=` | U |
| GET | `/me/weekly-scores/current` | U — live provisional breakdown for the running week |

**seasons / leaderboards**
| GET | `/seasons/current`, `/seasons`, `/seasons/{id}` | U |
| GET | `/seasons/{id}/standings?scope=&cursor=` | U |
| GET | `/divisions` | U |
| GET | `/leaderboards/national?seasonId=&cursor=&limit=` | U |
| GET | `/leaderboards/governorates/{id}` | U |
| GET | `/leaderboards/gyms/{gymId}` | U |
| GET | `/leaderboards/friends` | U |
| GET | `/leaderboards/{scope}/me` | U — "jump to my rank": page centred on me + cursors both ways |

**gyms**
| GET | `/gyms?governorateId=&q=&cursor=` | U |
| GET | `/gyms/{id}` | U |
| POST | `/gyms` | U✓ — creates gym in PENDING + verification request (submitter becomes GYM_ADMIN on approval) |
| PATCH | `/gyms/{id}` | GA |
| POST | `/gyms/{id}/membership` | U — request to join (one active gym) |
| DELETE | `/gyms/me/membership` | U — leave |
| GET | `/gyms/{id}/members?cursor=` | U (public list of approved members) |
| GET | `/gyms/{id}/membership-requests` | GA |
| POST | `/gyms/{id}/members/{userId}/approve` \| `/reject` \| `/remove` | GA |

**social**
| GET | `/friends`, `/friends/requests?direction=in\|out` | U |
| POST | `/friends/requests` `{userId}` | U✓ |
| POST | `/friends/requests/{id}/accept` \| `/decline` | U |
| DELETE | `/friends/{userId}` | U |
| POST / DELETE | `/follows/{userId}` | U |
| POST / DELETE | `/blocks/{userId}` | U |

**battles (Friend Battles)**
| POST | `/battles` `{opponentId, durationDays, components?}` | U✓ (friends only) |
| GET | `/battles?status=&cursor=` | U |
| GET | `/battles/{id}` | U (participant) — live scores & breakdown |
| POST | `/battles/{id}/accept` \| `/decline` \| `/cancel` | U (participant; cancel only while PENDING) |

**notifications (minimal in Phase 1: in-app list, no push)**
| GET | `/notifications?cursor=`, POST `/notifications/read` | U |

**admin** (`/api/v1/admin/...`, separate JWT audience `admin`, see §9)
| Method | Path | Auth |
|---|---|---|
| GET | `/admin/users?q=&role=&status=&cursor=`, `/admin/users/{id}` | A (M read-only) |
| PATCH | `/admin/users/{id}/status` (suspend/ban/reactivate) | A |
| PATCH | `/admin/users/{id}/role` | SA (A may grant MODERATOR/GYM_ADMIN only) |
| GET | `/admin/rule-sets`, `/admin/rule-sets/{version}`, `/admin/rule-sets/{a}/diff/{b}` | A |
| POST | `/admin/rule-sets` (new draft from version) | A |
| PUT | `/admin/rule-sets/{version}` (edit draft) | A |
| POST | `/admin/rule-sets/{version}/validate` (dry run on sample users) | A |
| POST | `/admin/rule-sets/{version}/activate` | SA (or A + second approval, Q-10) |
| GET/PUT | `/admin/rule-sets/{version}/expected-progression` | A |
| GET/POST/PATCH | `/admin/seasons`, `POST /admin/seasons/{id}/close` | A |
| GET/PUT | `/admin/divisions` | A |
| GET | `/admin/gyms/verification-requests` ; POST `…/{id}/approve` \| `/reject` | A |
| GET/POST/PATCH | `/admin/sports`, `/admin/exercises` | A |
| GET | `/admin/workouts/held?cursor=` ; POST `/admin/workouts/{id}/approve` \| `/reject` | M |
| POST | `/admin/ledger/adjustments` (manual XP/LP with reason) | A (audited) |
| GET | `/admin/audit-logs?entityType=&actorId=&cursor=` | A |
| GET | `/admin/stats/overview` | A |

### 4.5 Endpoints — later phases (contract sketched now)

- **P2** `/duels/queue` (POST join, DELETE leave, GET status); `/gym-wars/current`, `/gym-wars/{id}`, `/gyms/{id}/wars`, `POST /gyms/{id}/wars/registration` (GA); `/leagues` CRUD, `/leagues/{id}/join`, `/leagues/join-by-code`, `/leagues/{id}/leaderboard`; `/challenges` CRUD, `/challenges/{id}/join`; `/badges`, `/me/badges`; `/feed?cursor=`, `/activities/{id}/reactions`, `/activities/{id}/comments`; `/me/devices` (FCM token), `/me/notification-preferences`; WebSocket namespace `/ws` events `battle.score`, `leaderboard.move`, `notification.new`.
- **P3** `/workouts/{id}/proofs` (upload-url/confirm); `/reports` POST, `/me/reports`, `/me/reports/{id}`; `/me/sanctions`, `/me/sanctions/{id}/appeal`; `/moderation-log` (public, anonymised); `/admin/moderation/queue`, `/admin/reports/{id}/decide`; gym admin dashboard `/gyms/{id}/dashboard`, `/gyms/{id}/challenges`.
- **P4** `/integrations/{provider}/connect|callback|disconnect`, `/coach/...`, `/billing/...`.

---

## 5. Scoring engine

### 5.1 Principles recap

1. Server-only. The client sends raw workouts; any `xp`, `points`, `lp`, `score` field in a request body is **stripped by a global `whitelist + forbidNonWhitelisted` validation pipe** (and a dedicated security test asserts it).
2. Every number comes from the **active `ScoringRuleSet`**; every ledger entry records `rule_set_version`.
3. Ledgers are append-only; corrections are reversals.
4. Every entry carries an `explanation` JSON rendered by the app.

### 5.2 Rule-set versioning

```
DRAFT ──validate──► DRAFT(validated) ──activate──► ACTIVE ──(next activation)──► ARCHIVED
```
- Admin clones the active version → edits a draft (form generated from the zod schema) → `validate` runs schema checks (e.g. LP weights sum to 1.0, caps positive, level curve monotonic) **and a dry run** that recomputes last week's scores for a sample of 500 users with the draft vs active and shows the distribution shift.
- Activation is atomic (`UPDATE … SET status='ARCHIVED' WHERE status='ACTIVE'; UPDATE … SET status='ACTIVE' WHERE version=$v` in one transaction), audited with before/after config.
- **Which version applies?** Per-event scoring (workout XP, PR XP) uses the version active **when the event is evaluated**. Weekly scores use the version active **when the week is closed**. Changing rules is **never retroactive** by default. An explicit admin "recompute range" job (Phase 2+) may re-score a range; it writes reversal + new entries, never edits.
- The engine loads the active rule set from Redis (cache key invalidated on activation, pub/sub to all instances).

### 5.3 Calculation pipeline

```
Workout accepted
   │
   ├─ 1. Derive metrics        volume, e1RM per set (Epley: w × (1 + reps/30), only reps 1–12),
   │                           best value per (exercise, metric) → metric_observations
   ├─ 2. Calibration check     if user in calibration → update calibrated baseline, PRs = CALIBRATION
   ├─ 3. PR detection          compare to current record per key; strictly better → PR candidate
   │                           plausibility (progress ratio > ceiling) → PR HELD
   ├─ 4. Goals                 milestones reached → milestone events
   ├─ 5. XP computation        workout XP, PR XP (one best PR per exercise per workout),
   │                           milestone XP, quest XP
   ├─ 6. Anti-farming          min duration, diminishing returns, daily cap, weekly cap
   └─ 7. Ledger append         one XpTransaction per source (idempotent unique key), user_stats update,
                               level-up detection → ActivityEvent LEVEL_UP

Weekly close job (§8)
   ├─ compute components over the week (§5.5) → weekly_scores
   └─ LeaguePointTransaction(WEEKLY_SCORE) → user_stats.season_lp → leaderboards
```

### 5.4 Anti-sandbagging and experience level

**Calibration (default 14 days).**
- Declared onboarding values create `PROVISIONAL` baselines (hint only, used for goal suggestions and to pre-fill forms).
- During calibration: PRs are `CALIBRATION` (small flat XP, `calibration_pr_xp` = 10), progress component = 0, user **not leaderboard-eligible**.
- At calibration end (daily job): `effective_value = max(declared, best observed during calibration)` → `FINAL`.
- **Exercise first seen after calibration**: its first `baseline_first_logs` (default 2) logged sessions set the baseline instead of scoring improvement. So a user cannot declare a low value for an exercise they never logged and then "improve" on it.

**Automatic correction (baseline audit window, default 28 days after finalisation).**
If during the window `best / baseline − 1 > progress_ceiling_ratio × expected_pct(elapsed)`, the baseline is **raised** to `best / (1 + progress_ceiling_ratio × expected_pct(elapsed))`, marked `CORRECTED`, and all progress-derived points granted on the old baseline are recomputed: the difference is posted as `REVERSAL` entries referencing the originals. See worked example §5.10.3.

**Experience level is derived, not declared.** Important because the incentive runs the *other* way too: declaring yourself "advanced" lowers your expected improvement and inflates your progress ratio. So:
- `experience_level = f(performance standards)` per exercise/metric: strength uses e1RM / body weight tables (by gender if provided, Q-7), running uses pace tables per distance. Tables live in the rule set.
- The declared level is only used until the first derived level is available, and the engine uses `max_expected(declared, derived)`, i.e. **the level with the higher expected improvement** (harder to score), so lying never helps.
- Body weight absent → absolute unisex fallback table (conservative) — Q-7.

### 5.5 Weekly score and LP

Week = Monday 00:00 → Sunday 24:00 Africa/Tunis. Computed provisionally in real time (for the home screen) and finalised by the weekly close job after a **24 h grace period** for offline sync (Q-4).

Each component is 0–100. Default weights (`lp_weights`): progress 0.40, consistency 0.25, performance 0.20, challenge 0.15.

**Progress (rolling 28-day improvement, normalised).**
For each *active* metric (trained in the last 8 weeks):
```
ref      = all-time best BEFORE the current 28-day window   (never below the baseline)
current  = best value inside the 28-day window ending this Sunday
improvement_pct = (current − ref) / ref            (inverted for LOWER_IS_BETTER metrics; < 0 → 0)
ratio    = improvement_pct / expected_pct(level, exercise, metric, 28 days)
ratio    → if > progress_ceiling_ratio (2.0): capped at 2.0 and the source PR is held for review
metric_score = min(ratio, progress_reward_cap (1.5)) / 1.5 × 100
progress_c   = mean of the top-N metric scores (N = progress_top_n = 3)
```
Rolling window = one PR counts for 4 consecutive weeks, which smooths the natural lumpiness of PRs (an intermediate lifter adds 2.5 kg every few weeks, not every week). Top-N avoids penalising people who train many exercises, without letting them cherry-pick a single lucky metric.

**Consistency.**
`consistency_c = 100 × min(1, training_days / planned_training_days_per_week)`. A training day = at least one ACCEPTED workout ≥ `workout_min_duration_min`. Training more than planned earns nothing extra (safety: no incentive to skip rest).

**Performance ("verified performance").**
`performance_c = 100 × mean over top-N active metrics of (best this week / all-time best) × verification_factor`
Rewards staying near your level (important for advanced athletes whose progress is slow). `verification_factor = 1` in Phase 1–2; in Phase 3 = `1 + (verified_weight_multiplier − 1) × share_of_verified_workouts`, capped at 100 overall. (Interpretation — Q-1.)

**Challenge participation.**
`challenge_c = 100 × min(1, active_challenges_with_progress_this_week / 1)` (Phase 2). **Phase 1 has no challenges** → ASSUMPTION: weights renormalised over the 3 other components (0.40/0.25/0.20 → 0.471/0.294/0.235) until Phase 2. Q-1.

**Weekly LP.** `weekly_lp = round(total × weekly_lp_per_point)` (default 1.0 → max 100 LP/week). Eligibility: past calibration, email verified, no active sanction. HELD workouts don't count until approved (then the week is recomputed; if already final, the delta is posted as an adjustment entry).

### 5.6 XP rules (defaults, all in the rule set)

| Event | Formula |
|---|---|
| Workout | `0` if duration < `workout_min_duration_min` (15). Else `workout_base_xp (10) + floor(duration_min / 3)`, max `workout_max_xp (50)` |
| Diminishing returns | per day: workouts 1–`diminishing_returns_after` (2) × 1.0, 3rd × 0.5, 4th+ × 0 |
| PR | `pr_xp_min + (pr_xp_max − pr_xp_min) × min(r_pr / 2, 1)` with `r_pr = PR improvement % / expected_pct(28 d)`; only the best PR per exercise per workout; max 1 rewarded PR per (exercise, metric) per 7 days |
| Calibration PR | `calibration_pr_xp` (10) |
| Goal milestone | `goal_milestone_xp` (150) |
| First quest | 100 + badge *First Step* (badge awarded in P2 retroactively if badges ship later — ASSUMPTION) |
| Battle | `battle_xp_per_point × battle score` (1.0 → 0–100) + `battle_win_xp` (300) for the winner |
| Caps | `daily_xp_cap` 400, `weekly_xp_cap` 2000 (applied in order: diminishing → daily → weekly; the entry records requested vs granted) |
| Level curve | `xp_to_next(n) = level_base_xp (100) × n ^ level_exponent (1.5)`; titles by level ranges: 1–5 Beginner, 6–15 Rookie, 16–30 Athlete, 31–50 Advanced, 51–75 Elite, 76+ Legend |

Weight goal safety: counted change toward milestones = `min(|actual change|, weight_change_max_pct_per_week × start_weight × weeks_elapsed)`. Faster change: milestone not credited early, no celebration, a neutral (non-alarming) info message.

### 5.7 Battles scoring

Battle score = the weekly-score formula applied to the **battle window** (7 days by default) instead of the calendar week, with the participants' own baselines/expectations → comparable across sports. Friend Battles may **disable** components (e.g. "consistency + progress only") but never compare raw performance; the remaining weights are renormalised.
- `|scoreA − scoreB| < battle_draw_margin (2.0)` → draw.
- LP: win `battle_win_lp` (25), draw `battle_draw_lp` (12), loss `battle_participation_lp` (5) **if the loser logged ≥ 1 accepted workout**.
- Anti-collusion: LP from Friend Battles counts for at most `friend_battle_lp_weekly_max` (1) battle per week and `friend_battle_same_opponent_season_max` (3) per opponent per season. XP is still granted.

### 5.8 Ledger and reversal

- `ledger.append(entry)` inside the caller's transaction: insert → update `user_stats` with `SELECT … FOR UPDATE` on the stats row → emit `LedgerChanged`.
- `ledger.reverse(originalId, reason, actor)`: inserts `amount = −original.amount`, `reason = REVERSAL`, `reverses_id = originalId`; unique constraint makes double reversal impossible; partial reversal = reversal + new corrected entry.
- **Balances are derived**: `xp_total = SUM(amount)`; `user_stats` is a cache, verified nightly.
- Level never decreases through normal play; a moderation reversal can lower XP and therefore the level (spec: "except moderation reversal").

**Explanation JSON (example, workout XP):**
```json
{
  "formula": "workout_xp",
  "inputs": { "durationMin": 62, "workoutsToday": 1 },
  "steps": [
    { "label": "base", "value": 10 },
    { "label": "duration_bonus", "expr": "floor(62/3)", "value": 20 },
    { "label": "diminishing_multiplier", "value": 1.0 },
    { "label": "daily_cap_remaining", "value": 370, "applied": false }
  ],
  "result": 30,
  "ruleSetVersion": 3
}
```
The app renders `steps[].label` through i18n keys (`points.step.base`, …).

### 5.9 Rule-set keys (minimum + additions)

Spec keys: `workout_base_xp`, `workout_min_duration_min`, `pr_xp_min`, `pr_xp_max`, `goal_milestone_xp`, `challenge_xp`, `battle_win_lp`, `battle_draw_lp`, `battle_participation_lp`, `gym_war_win_xp`, `daily_xp_cap`, `weekly_xp_cap`, `diminishing_returns_after`, `calibration_days`, `progress_ceiling_ratio`, `weight_change_max_pct_per_week`, `lp_weights`, `season_soft_reset_ratio`, `verified_weight_multiplier`.

Additions I need: `workout_max_xp`, `diminishing_multipliers[]`, `calibration_pr_xp`, `baseline_first_logs`, `baseline_audit_days`, `progress_window_days` (28), `progress_reward_cap` (1.5), `progress_top_n` (3), `weekly_lp_per_point`, `week_grace_hours` (24), `late_log_max_hours` (72), `battle_win_xp`, `battle_xp_per_point`, `battle_draw_margin`, `friend_battle_lp_weekly_max`, `friend_battle_same_opponent_season_max`, `level_base_xp`, `level_exponent`, `level_titles[]`, `division_thresholds{}`, `e1rm_formula` (`EPLEY`|`BRZYCKI`), `e1rm_max_reps` (12), `strength_standards{}`, `running_standards{}`, `anticheat{}` (§7), `gym_war{weights, top_k, member_score_cap, min_active_verified_members}`, `mmr{tau, initial_rating, initial_rd, window_initial, window_step, window_max, step_hours}`, `min_age_years` (16).

### 5.10 Worked numerical examples

Expected improvement table used (28-day, squat e1RM): Beginner **8 %**, Intermediate **3 %**, Advanced **1 %**. Bench press e1RM: Beginner 6 %, Intermediate 2 %, Advanced 0.75 %.

#### 5.10.1 Beginner vs advanced — same week

| | **Sami** (beginner, 3 planned days) | **Karim** (advanced, 5 planned days) |
|---|---|---|
| Squat e1RM: best before window → best in window | 60 → 65 kg (+8.33 %) | 200 → 202 kg (+1.00 %) |
| Progress ratio | 8.33 / 8 = **1.04** | 1.00 / 1 = **1.00** |
| Progress component | 1.04 / 1.5 × 100 = **69.4** | 1.00 / 1.5 × 100 = **66.7** |
| Training days / planned | 3 / 3 → **100** | 4 / 5 → **80** |
| Performance (week best / all-time best) | squat 65/65 = 1.00 → **100** | squat 202/202 = 1.00, bench 140/145 = 0.966 → mean **98.3** |
| Challenge (Phase 2) | joined & progressed → **100** | none → **0** |
| **Weekly total** | 0.40×69.4 + 0.25×100 + 0.20×100 + 0.15×100 = **87.8** | 0.40×66.7 + 0.25×80 + 0.20×98.3 + 0.15×0 = **66.3** |
| **LP this week** | **88** | **66** |

(For readability each athlete has one progress metric; with top-N the mean is taken over up to 3.)

Take-aways:
- Raw improvement differs 8× (8.33 % vs 1 %), progress scores differ by 2.7 points. Neither the beginner's "newbie gains" nor the advanced athlete's 200 kg decide the result.
- A "who lifts most" board would rank Karim first by 137 kg; here Sami wins because he executed his plan fully.
- Karim is not stuck: if he trains his 5 planned days and joins a challenge, his total becomes 0.40×66.7 + 25 + 19.7 + 15 = **86.4** — the same range as Sami.
- **Phase 1 variant** (no challenge component, weights renormalised by /0.85): Sami (27.8 + 25 + 20)/0.85 = **85.6**, Karim (26.7 + 20 + 19.7)/0.85 = **78.1**.

#### 5.10.2 Why raw % would be unfair (counter-example)

Scoring raw % × 10: Sami 83 points, Karim 10 points — Karim could never win. Scoring absolute kg added: Karim +2 kg vs Sami +5 kg — also meaningless across sports. The normalised ratio is the only one that compares a runner and a lifter.

#### 5.10.3 Sandbagging caught and reversed

Nour (derived level: beginner, squat expected 8 %/28 d, ceiling 2.0) lifts deliberately light during calibration: baseline squat e1RM **50 kg** (FINAL, day 14).
- Week 3 (day 21): logs 58 kg → +16 % in 7 days. Allowed max at 7 days = 2.0 × 8 % × 7/28 = 4 % → PR **held**, progress ratio capped. Say ratio capped at 2.0 → metric score 100 → progress_c 100 → weekly LP included **+40 LP** from the progress component (0.40 × 100). Workout XP (30) is still granted (the workout itself is plausible).
- Week 4 (day 28): logs 64 kg (+28 % vs baseline). Audit rule at 28 days: allowed = 2.0 × 8 % = 16 % → 50 × 1.16 = 58 kg max plausible. 64 > 58 → **baseline corrected** to 64 / 1.16 = **55.2 kg**.
- Recompute week 3 with baseline 55.2: 58 / 55.2 = +5.1 % in the window, ratio 5.1/8 = 0.64 → metric 42.5 → progress LP 0.40 × 42.5 = 17. Ledger:

| id | type | amount | reason | reverses | note |
|---|---|---|---|---|---|
| L-101 | LP | +83 | WEEKLY_SCORE (w3) | — | original |
| L-140 | LP | −83 | REVERSAL | L-101 | baseline corrected 50 → 55.2 |
| L-141 | LP | +60 | WEEKLY_SCORE (w3, recomputed) | — | progress 42.5 instead of 100 |
| X-220 | XP | −500 | REVERSAL | X-180 | PR on 58 kg had been granted at capped r = 2.0 (50 + 450 × 1 = 500) |
| X-221 | XP | +193 | PR | — | re-evaluated vs 55.2 kg: r = 5.07 % / 8 % = 0.634 → 50 + 450 × 0.317 = 193 |

(Week 3 other components unchanged; LP total drops by 23. X-180 had been posted as "pending" in `workout_evaluations`, so in reality there's nothing to reverse for a *held* PR — shown here for the case where the PR had been accepted.) The user sees an explanation "Your starting level was corrected based on your recent performances."

#### 5.10.4 Season soft reset

`season_soft_reset_ratio` = 0.5. Division thresholds: Bronze 0, Silver 400, Gold 900, Platinum 1400, Diamond 2000, Elite 2600.
User ends at 1 240 LP (Gold, floor 900): `new = 900 + (1240 − 900) × 0.5 = 1 070` → a `SEASON_SOFT_RESET` entry of −170 into the **new** season's ledger (the old season's ledger is closed, archived into `season_standings`). User starts the new season in Gold at 1 070 LP.
ASSUMPTION: division is **live** (derived from LP thresholds). Promotion/relegation "at season end" = the reset preserves division floors, so users only drop a division if they lose LP during the season. Q-3.

---

## 6. Matchmaking and Gym War algorithms

### 6.1 Weekly Duels (Phase 2)

**Rating: Glicko-2** (Glickman 2012), rating period = 1 week, `τ = 0.5`, new player 1500 / RD 350 / σ 0.06. RD grows for inactive weeks (standard step 6 with no games). Result input per duel: win 1, draw 0.5, loss 0 using the battle outcome (§5.7).
Reference test vector (unit test): player 1500/200 vs {1400/30 win, 1550/100 loss, 1700/300 loss} → **1464.06 / RD 151.52 / σ 0.05999** (paper example).
Expected score example: 1600 vs 1500 (RD 200): μ = 0.5757, φⱼ = 1.1513, g(φⱼ) = 0.8443, E = 1 / (1 + e^(−0.8443 × 0.5757)) = **0.619**.

**Queue.** Opt-in each week; queue open Friday 00:00 → Monday 12:00. Pairing batch runs hourly from Sunday 12:00.

**Hard constraints** (pair impossible if violated): same or adjacent division; not friends; not same gym (configurable); no rematch within `no_rematch_weeks` (4); not blocked; both past calibration; recent activity: both have ≥ 1 training day in the last 14 days.

**Cost** of pair (i, j):
```
cost = |mmr_i − mmr_j| / 100
     + 0.5 × |avg_training_days_i − avg_training_days_j|     (last 4 weeks)
     + 1.0 if divisions differ
```
allowed only if `|mmr_i − mmr_j| ≤ window`, where `window = 150 + 100 × floor(hours_waiting / 6)`, max 400.
Algorithm: build candidate edges satisfying constraints, sort by cost, greedy match (O(E log E), good enough at Tunisian scale; can be swapped for min-cost perfect matching later). Unmatched at Monday 12:00 → **ghost duel** vs the user's own previous week score (no MMR change, reduced LP: participation only on loss, `ghost_win_lp` 10 on win).

**Worked example** (Sunday 12:00 batch):

| User | Division | MMR | Avg days/week |
|---|---|---|---|
| A | Gold | 1620 | 3.5 |
| B | Gold | 1580 | 3.0 |
| C | Silver | 1450 | 2.5 |
| D | Gold | 1900 | 4.0 |
| E | Platinum | 1950 | 4.5 |
| F | Bronze | 1200 | 2.0 |

Edges within window 150: A–B (Δ40 → 0.40 + 0.25 = **0.65**), D–E (Δ50, adjacent div → 0.50 + 0.25 + 1 = **1.75**), A–C (Δ170) ✗, C–F (Δ250) ✗.
Batch 1: pair A–B, then D–E. C and F wait. At 18:00 window = 250: C–F (Silver–Bronze adjacent, Δ250 → 2.5 + 0.25 + 1 = 3.75) → paired. If F had been Silver-incompatible or already rematched, F would get a ghost duel on Monday 12:00. Never beginner vs elite: division adjacency makes Bronze vs Elite impossible regardless of MMR.

### 6.2 Gym Wars (Phase 2)

**Eligibility:** gym VERIFIED; ≥ `min_active_verified_members` (8) members with verified email, past calibration, not sanctioned, **membership approved before the war starts**; gym registered for the week (GYM_ADMIN) or auto-enrolled (Q-11).

**Size brackets** by eligible members: S 8–30, M 31–80, L 81+. Pairing: same bracket, closest gym rating (Glicko-2 on gyms), no rematch within 3 weeks; fallback to adjacent bracket; else bye (no result).

**Score** (weights from rule set; default w1 0.35, w2 0.20, w3 0.20, w4 0.10, w5 0.15):
```
member_score_i  = min(weekly_total_i, member_score_cap (100))   // already bounded 0–100, cap guards future changes
top_k           = mean of the K best member scores, K = min(20, eligible) — inactive members count as 0
participation   = active_members / eligible_members × 100      // active = ≥ 1 accepted workout in the war week
mean_progress   = mean progress_c over active members
verified_ratio  = verified accepted workouts / accepted workouts × 100    // Phase 3; until then w4 is redistributed
consistency     = mean consistency_c over eligible members
gym_score = w1·top_k + w2·participation + w3·mean_progress + w4·verified_ratio + w5·consistency
```

**Worked example** (fallback pairing across brackets to show size-neutrality):

| | **Gym A — Sousse** (S, 25 eligible) | **Gym B — Tunis** (M, 60 eligible) |
|---|---|---|
| Active members | 18 | 27 |
| top-K (K = 20) mean | 18 actives ~70, 2 zeros → **63.0** | 20 best → **85.0** |
| Participation | 18/25 = **72** | 27/60 = **45** |
| Mean progress | **65** | **55** |
| Verified ratio | **40** | **50** |
| Consistency | **75** | **60** |
| **Score** | 0.35×63 + 0.20×72 + 0.20×65 + 0.10×40 + 0.15×75 = **64.70** | 0.35×85 + 0.20×45 + 0.20×55 + 0.10×50 + 0.15×60 = **63.75** |

Gym B has 2.4× the members and stronger stars, but Gym A wins through engagement. Adding 100 more passive members to B would *lower* its score (participation and consistency drop), so gyms can't win by size or by padding their rosters. Win: +`gym_war_win_xp` (500) to active members of the winning gym, gym rating updated.

---

## 7. Anti-cheat pipeline and thresholds

### 7.1 Pipeline (Phase 1 = layer 1)

```
DTO validation (types, ranges, max 60 exercises, max 100 sets/exercise)
  → Time checks        performed_at not > now + 10 min; not older than late_log_max_hours (72) for points
  → Idempotency         (user_id, client_id) exists? replay or 409
  → Hard limits  ──►   REJECTED  (physically impossible)
  → Soft limits  ──►   HELD_FOR_REVIEW  (possible but exceptional)
  → Duplicates   ──►   REJECTED (exact/overlapping) or HELD (repeated identical)
  → Frequency    ──►   HELD
  → Progress plausibility (PR ratio > progress_ceiling_ratio) ──► PR HELD (workout itself ACCEPTED)
  → ACCEPTED
```
Each check returns `{rule, severity: INFO|SOFT|HARD, value, threshold}`. Outcome: any HARD → REJECTED; any SOFT → HELD; else ACCEPTED. `confidence` stored for Phase 3 behavioural scoring. **Automatic punishment (sanctions) never happens in Phase 1**: at most a workout is rejected with a clear message and the user can contest via the held queue / support.

Workouts logged > 72 h late: recorded for history and progress charts, **no XP/LP** (ASSUMPTION, Q-4).

### 7.2 Default thresholds (rule set `anticheat` section, editable)

| Domain | HOLD (soft) | REJECT (hard) |
|---|---|---|
| Running (≥ 1 km) avg pace | faster than 3:15 /km | faster than 2:30 /km |
| Running distance per session | > 60 km | > 120 km |
| Running 5K / 10K / 21.1K time | < 15:00 / < 31:00 / < 1:08:00 | < 12:30 / < 26:00 / < 57:00 |
| Cycling avg speed | > 45 km/h | > 60 km/h |
| Cycling distance | > 250 km | > 400 km |
| Walking avg speed | > 9 km/h | > 15 km/h |
| Swimming 100 m pace (≥ 200 m) | < 1:00 | < 0:45 |
| Squat e1RM | > 3.0 × BW or > 300 kg | > 4.5 × BW or > 500 kg |
| Bench e1RM | > 2.2 × BW or > 220 kg | > 3.5 × BW or > 360 kg |
| Deadlift e1RM | > 3.2 × BW or > 330 kg | > 5.0 × BW or > 510 kg |
| Other weighted exercise | > `exercise.plausibility.hold_kg` | > `exercise.plausibility.reject_kg` |
| Reps per set (weighted) | > 50 | > 200 |
| Reps per set (bodyweight) | > 150 | > 1000 |
| Workout duration | > 5 h | > 12 h |
| Sets per workout | > 60 | > 150 |
| Workouts per day | > 4 | overlapping in time → REJECT |
| Identical fingerprint | ≥ 3 in 14 days → HOLD | same fingerprint + overlapping time → REJECT (duplicate) |
| Client clock | skew > 24 h → HOLD | `performed_at` > now + 10 min → REJECT |
| PR progress ratio | > `progress_ceiling_ratio` (2.0) → PR HOLD | — |

BW = latest body weight if provided; if absent only the absolute kg thresholds apply (Q-7). The spec example "100 km run in 20 min" = 300 km/h → rejected by the pace rule.

### 7.3 Later layers

- **Phase 3 behavioural**: z-score of weekly total vs the user's own history (> 3σ → review), farming patterns (many minimum-duration workouts), multi-account signals (same `install_id`, IP /24 clusters, invite graph cycles between accounts that battle each other), collusion in Friend Battles (win/loss alternation).
- **Evidence**: proof review by moderators, gym-admin confirmation for gym members.
- Auto-sanction only when `confidence ≥ auto_action_threshold` (0.98) and rule is HARD; everything else goes to the moderator queue.

---

## 8. Background jobs

All jobs run in the **worker** process (BullMQ), are **idempotent** (keyed by business id, e.g. `weekly-close:2026-09-21`), retried with exponential backoff, and log start/end to `audit_logs` when they change scores. Times are Africa/Tunis.

| Job | Schedule | Phase | What it does |
|---|---|---|---|
| `outbox-drain` | continuous (every 1 s) | 1 | dispatches domain events |
| `calibration-finalize` | daily 01:00 | 1 | finalises baselines of users whose calibration ended; makes them leaderboard-eligible |
| `baseline-audit` | daily 01:30 | 1 | audit-window check (§5.4), writes corrections + reversals |
| `weekly-close` | Tuesday 00:05 (Monday week-end + 24 h grace) | 1 | computes FINAL weekly scores, posts `WEEKLY_SCORE` LP, updates leaderboards |
| `weekly-provisional` | on workout accepted (debounced 30 s per user) | 1 | refreshes provisional weekly score for home screen |
| `battle-activate` | delayed job at `starts_at` | 1 | PENDING → ACTIVE (or EXPIRED if not accepted in 48 h) |
| `battle-close` | delayed job at `ends_at + grace (24 h)` + sweeper every 15 min | 1 | final scores, outcome, LP/XP entries, MMR update (duels) |
| `battle-ending-soon` | delayed at `ends_at − 24 h` | 2 | notification |
| `leaderboard-snapshot` | daily 00:10 | 1 | copies Redis ranks → `leaderboard_snapshots` (movement ↑↓/NEW) |
| `leaderboard-rebuild` | daily 03:00 + on demand | 1 | rebuilds Redis sorted sets from `user_stats` (repair after Redis loss) |
| `balance-reconcile` | daily 03:30 | 1 | recomputes balances from ledgers, alerts on drift, repairs cache |
| `season-close` | at `season.ends_at + 24 h` | 1 | state machine ACTIVE → CLOSING → CLOSED: freeze, standings, champions, soft reset entries in new season, rebuild leaderboards |
| `season-open` | at `season.starts_at` | 1 | activates next season (admin creates seasons in advance; job alerts if none scheduled 14 days before end) |
| `duel-matchmaking` | hourly Sun 12:00 → Mon 12:00 | 2 | §6.1; ghost fallback at the end |
| `gym-war-pairing` | Monday 00:30 | 2 | §6.2 |
| `gym-war-close` | Tuesday 01:00 | 2 | scores, outcomes, XP, gym rating |
| `challenge-close` | at `ends_at` | 2 | completion XP |
| `badge-evaluate` | on events + nightly sweep | 2 | rule-based badge awarding |
| `notification-dispatch` | continuous | 2 | FCM with quiet hours / preferences |
| `media-scan` | on upload confirm | 1 (avatar) | magic bytes, re-encode, ClamAV hook |
| `cleanup` | daily 04:00 | 1 | expired tokens, abandoned uploads (> 24 h), processed outbox (> 7 d) |
| `data-export` | on request | 1 | builds JSON/CSV zip → signed URL (7 days) |
| `account-anonymise` | daily 02:00 | 1 | executes deletions after 30-day grace (§9.7) |
| `snapshot-partition-maintenance` | monthly | 1 | creates next partitions, applies retention |

---

## 9. Security architecture

### 9.1 Authentication flow

- **Passwords**: Argon2id (m = 19 MiB, t = 2, p = 1, OWASP 2024 minimum), min length 10, checked against a top-100k breached password list (offline file), max 128 chars.
- **Access token**: JWT, **15 min**, signed EdDSA (Ed25519), claims `sub`, `role`, `aud` (`app` or `admin`), `sv` (session version for instant revocation on ban/password change).
- **Refresh token**: opaque 256-bit random, **30 days** (sliding), stored as SHA-256 hash, **rotated on every use**. Reuse of an already-rotated token → the whole family is revoked (theft detection) and the user is logged out everywhere. Mobile stores it in Keychain / Android Keystore (`flutter_secure_storage`).
- **OAuth**: mobile obtains the Google/Apple ID token natively; the API verifies signature, `aud`, `iss`, expiry, nonce; links to existing account only if the email is verified by the provider. OAuth users still go through the DOB/age gate before the account is activated.
- **Email verification** required for competitive features (U✓): leaderboards, battles, gym creation. Token 24 h, single use.
- **Lockout**: 5 failed logins → 15 min lock (doubling up to 24 h), notification email. Generic error messages (no enumeration).
- **Age gate**: `age(dob) < min_age_years` → `UNDER_AGE`, no account created, nothing stored except a hashed-email throttle entry for 24 h.
- **Admin panel**: separate `aud=admin`, only roles MODERATOR+; **TOTP 2FA mandatory** for MODERATOR/ADMIN/SUPER_ADMIN (proposed, Q-10); admin logins audited; IP allow-list optional via env.

### 9.2 RBAC matrix

Permissions are checked server-side by a `@RequirePermission()` guard + resource ownership checks in services (e.g. gym admin **of that gym**).

| Capability | USER | GYM_ADMIN | MODERATOR | ADMIN | SUPER_ADMIN |
|---|---|---|---|---|---|
| Own profile, workouts, goals | ✓ | ✓ | ✓ | ✓ | ✓ |
| View public profiles / leaderboards | ✓ | ✓ | ✓ | ✓ | ✓ |
| Friend battles, social | ✓ (verified) | ✓ | ✓ | ✓ | ✓ |
| Manage own gym (members, profile, challenges) | — | ✓ own gym | — | ✓ any | ✓ |
| Register gym for Gym Wars | — | ✓ own gym | — | ✓ | ✓ |
| Held-workout queue, reports, evidence | — | — | ✓ | ✓ | ✓ |
| Warnings, points removal, temp suspension | — | — | ✓ | ✓ | ✓ |
| Permanent ban | — | — | — | ✓ | ✓ |
| Verify gyms | — | — | — | ✓ | ✓ |
| Edit sports/exercises/badges | — | — | — | ✓ | ✓ |
| Draft rule sets / seasons / divisions | — | — | — | ✓ | ✓ |
| Activate rule set | — | — | — | — (Q-10) | ✓ |
| Manual ledger adjustments | — | — | — | ✓ (audited) | ✓ |
| Grant MODERATOR / GYM_ADMIN | — | — | — | ✓ | ✓ |
| Grant ADMIN / SUPER_ADMIN | — | — | — | — | ✓ |
| View audit log | — | — | own actions | ✓ | ✓ |
| System settings, secrets rotation | — | — | — | — | ✓ |

A user can never change their own role; privilege-escalation tests cover every role-changing path.

### 9.3 Rate limits (Redis, sliding window; `429` + `Retry-After`)

| Scope | Limit |
|---|---|
| Global per IP | 300 req / min |
| Per user (authenticated) | 120 req / min |
| `POST /auth/login` | 10 / min per IP, 5 / 15 min per account |
| `POST /auth/register` | 5 / hour per IP |
| Password forgot / email resend | 3 / hour per account |
| `POST /workouts` | 30 / hour per user; `/workouts/sync` 10 / hour |
| Friend requests | 30 / day |
| Battle creation | 10 / day |
| Upload URLs | 20 / hour |
| Reports (P3) | 10 / day, weighted by reporter reputation |
| Search | 60 / min |

### 9.4 Upload pipeline

```
1. POST /…/upload-url {mime, sizeBytes, purpose}
      → validate declared MIME against allow-list per purpose, size limit (avatar 5 MB, photo 10 MB, video 50 MB / 60 s)
      → create media(PENDING_UPLOAD), return presigned PUT to `quarantine` bucket (5 min, content-length-range enforced)
2. Client uploads directly to S3/MinIO.
3. POST /…/confirm {mediaId}
      → worker `media-scan`: read magic bytes (file-type) — must match declared type;
        images re-encoded with sharp (strips EXIF/GPS, max 2048 px, WebP);
        videos: ffprobe duration/codec check, transcode + strip metadata (Phase 3);
        ClamAV hook (clamd over TCP, pluggable, no-op in dev with a warning)
      → move to `private` bucket, media READY (or REJECTED + object deleted)
4. Reads: short-lived presigned GET (15 min) generated per request; avatars via a CDN-cacheable signed URL (24 h).
```
Buckets are private; no public ACLs; object keys are random UUIDs (no user data in keys).

### 9.5 Secrets management

- Repo contains only `.env.example`. `.env` is git-ignored; a pre-commit hook + CI step run `gitleaks`.
- Local: `.env` loaded by Docker Compose. Staging/production: platform secret manager (e.g. Docker/Kubernetes secrets or the cloud provider's secret manager), injected as env vars; config validated at boot with zod (the app refuses to start on missing secrets).
- Keys: JWT signing keys (Ed25519, `kid` in header, rotation with overlap), health-data encryption key(s) (envelope: data key per key id, rotation re-encrypts lazily), cursor HMAC key, S3 credentials, OAuth client secrets, FCM service account, SMTP.

### 9.6 Other controls

Helmet headers; CORS allow-list (admin origin only; mobile needs none); TLS everywhere (HSTS); Postgres app role without DDL rights (migrations use a separate role); parameterised queries only (Prisma / tagged `$queryRaw`); JSON body limit 256 kB; request id propagated to logs; PII (email, phone, DOB, weight) never logged (pino redaction paths); dependency scanning (Dependabot + `npm audit` in CI).

### 9.7 Privacy operations

- **Export**: JSON + CSV zip of profile, workouts, goals, PRs, ledgers, consents, body data (decrypted for the owner).
- **Deletion**: 30-day grace (cancel by logging in), then: profile/PII erased (email/username replaced by `deleted-<hash>`, DOB/phone/body data/media deleted), workouts detached from feed, **ledgers kept** but `user_id` points to the anonymised tombstone user so aggregates and past rankings stay consistent. Leaderboard/standing rows show "Deleted athlete".
- **Visibility**: body weight never leaves the owner scope; public profiles show age bracket (18–24, 25–34, 35+) only if opted in.

---

## 10. Offline sync protocol

### 10.1 Local storage (Drift)

Tables: `local_workouts` (+ exercises/sets), `outbox` (`id`, `entity`, `client_id`, `op CREATE|UPDATE|DELETE`, `payload json`, `status PENDING|SENDING|SENT|FAILED|CONFLICT`, `attempts`, `last_error`), cached reference data (`sports`, `exercises` with `updated_at`), cached read models (home, progress, leaderboard pages) with `fetched_at`.

### 10.2 Create offline

1. User saves a workout → UUID v4 `client_id` generated, row stored locally with `sync_status = PENDING`, outbox entry created. UI shows it immediately with a "Pending sync" badge; **no points are shown locally** (points only come from the server).
2. Connectivity restored (connectivity_plus + app resume + periodic WorkManager/BGTask) → sync engine sends outbox in order via `POST /workouts/sync` (≤ 50 items), each item carrying `clientId`, `payload`, `deviceSubmittedAt`, header `Idempotency-Key` per request batch id.
3. Server per item:
   - new `(user_id, client_id)` → process normally → `201` with server id, status, points.
   - exists and `payload_hash` equal → **idempotent replay** → `200` with the stored result (no second scoring; ledger unique keys guarantee it anyway).
   - exists and hash differs → `409 IDEMPOTENCY_CONFLICT` with the server version; client marks CONFLICT and shows "this workout was already synced with different data" → user chooses *keep server* or *save as edit* (becomes a `PATCH`, subject to the 24 h edit window).
4. Client replaces local row with server data (server wins for all computed fields), removes outbox entry.

### 10.3 Edit / delete

- `PATCH` with `If-Match: <version>`; mismatch → `409 VERSION_CONFLICT` + server copy; client shows diff, user picks. Edits allowed ≤ 24 h after first receipt; after that, workouts are read-only (prevents rewriting history to farm points).
- Scoring on edit/delete = reversal of the workout's entries + fresh computation (same source id, new unique key suffix `:v2`).
- Offline deletes of never-synced workouts are removed locally without a server call.

### 10.4 Time and late arrival

- `performed_at` is trusted within limits; server compares `device_submitted_at` to `received_at` to estimate skew (§7.2).
- Week attribution uses `performed_at`. Workouts arriving after the week's FINAL close (24 h grace) → recorded, XP granted if ≤ 72 h late, **no LP change** for the closed week (ASSUMPTION, Q-4).
- Battles: same rule relative to `battle.ends_at + 24 h`.

### 10.5 Read-side caching

Reference data: `ETag` + `updatedSince` delta. Read models: stale-while-revalidate (show cached, refresh in background). Leaderboards show "updated X min ago" when offline.

---

## 11. Testing strategy and deployment plan

### 11.1 Test pyramid

| Level | Tools | Scope (minimum from spec §22) |
|---|---|---|
| Unit (API) | Jest | scoring formulas, normalised progress, anti-sandbagging (calibration, first-log baseline, audit correction), caps & diminishing returns, PR detection (incl. equal values, LOWER_IS_BETTER), ledger reversal (no double reversal), level curve, Glicko-2 (paper vector), Gym War formula (§6.2 example as a test), matchmaking constraints, anti-cheat thresholds, rule-set zod validation |
| Property-based | fast-check | ledger balance = sum of entries under random reversal sequences; score components always within 0–100; weights sum invariant |
| Integration (API) | Jest + Supertest + **Testcontainers** (Postgres 16, Redis 7, MinIO) | auth (register/age gate/login/lockout/refresh rotation & reuse detection), workouts incl. **offline duplicate sync** (replay → same result, different payload → 409), battles lifecycle with fake clock, leaderboards (eligibility, pagination stability, jump-to-rank), weekly close & season close jobs, reports (P3) |
| Security | Jest integration suite | authorization bypass (IDOR on every `/{id}` route), privilege escalation (role change paths), **client-sent points ignored** (`xp`/`lp`/`points` fields rejected), rate limits, invalid uploads (spoofed MIME, oversize, polyglot), JWT tampering / `aud` confusion (app token on admin API) |
| Contract | OpenAPI diff in CI | generated clients up to date; breaking changes flagged |
| Mobile | `flutter test` (unit + widget, golden tests for key cards), `integration_test` on emulator | onboarding, log workout (incl. offline → sync), battle flow, leaderboard; RTL goldens (Arabic) and large-font goldens |
| Admin | Vitest + Testing Library, Playwright smoke | login + 2FA, rule-set edit/validate/activate, user suspend, season create |
| Load (before launch) | k6 | workout ingestion 50 rps, leaderboard reads 500 rps, weekly close on 100k users < 10 min |

Clock is injected (`ClockService`) everywhere so weeks/seasons/battles are testable. Coverage target: ≥ 90 % lines on `scoring`, `ledger`, `anticheat`, `progress`; ≥ 80 % elsewhere.

### 11.2 Environments & deployment

| Env | How | Data |
|---|---|---|
| **Dev** | `docker compose up` (api + worker hot-reload, db, redis, minio, mailpit) + `pnpm dev:admin` + `flutter run --flavor dev`; one command via `make dev` / `pnpm dev` | seed: 24 governorates, cities, sports, exercises, default rule set v1, divisions, current season, sample gyms, demo users (beginner/advanced), admin account |
| **Staging** | Same container images as prod; auto-deploy on merge to `main` | anonymised synthetic data, seeded; FCM/Apple sandbox |
| **Production** | Tagged release (`v*`) → manual approval | managed Postgres with PITR (daily backups, 30-day retention), managed Redis (persistence on), S3-compatible object storage, API ×2 + worker ×1 behind a load balancer |

- Images: one multi-stage Dockerfile (`api` & `worker` entrypoints), distroless/node-slim, non-root.
- Migrations: `prisma migrate deploy` as a pre-deploy release step; expand/contract pattern for zero-downtime.
- Hosting region: **Q-6** (INPDP requirements for health data and cross-border transfer).
- Mobile: Flutter flavors (dev/staging/prod) with configurable app name, bundle id and API URL; Fastlane lanes to Play Internal Testing / TestFlight; app name also an i18n key (`app.name`) so rebranding = config change.
- Admin: static build served by CDN / object storage.
- Observability: `/health` & `/ready`, structured logs, Sentry, basic metrics (Prometheus endpoint: request latency, job durations, queue depth, ledger drift count).

---

## 12. Open questions and assumptions

### 12.1 Open questions (need your decision)

| # | Question | My proposal |
|---|---|---|
| **Q-1** | "Verified performance" (20 %) and "challenge participation" (15 %) are not defined precisely, and neither verification (P3) nor challenges (P2) exist in Phase 1. | Performance = week best / all-time best per active metric (× verification factor from P3); Phase 1 renormalises weights over progress/consistency/performance. |
| **Q-2** | Experience level: may the user declare it, or must it be derived from performance? | Derived from standards tables; engine uses the level that is *harder* to score with (§5.4). |
| **Q-3** | Division: live (from LP thresholds) or fixed for a season with promotion/relegation at the end (top/bottom %)? The spec suggests both. | Live thresholds + soft reset toward the division floor. |
| **Q-4** | Week boundaries, grace period for offline sync, and late logging. | Week Mon–Sun Africa/Tunis; 24 h grace before final close; > 72 h late = history only, no points. |
| **Q-5** | **Minimum age 16 vs audience 18–35.** Tunisian law 2004-63 requires guardian consent for processing minors' data (under 18). Do we want to handle parental consent for 16–17, or set the minimum to 18 at launch? | Launch at **18** (config key stays), revisit with a lawyer. |
| **Q-6** | Hosting location and INPDP formalities: health data processing needs prior INPDP authorisation; hosting outside Tunisia is a cross-border transfer. Where will production run? | Decide with legal before production; architecture is provider-agnostic (containers + S3 + Postgres). |
| **Q-7** | Gender is optional, but strength standards differ strongly by sex and body weight is private/optional. How to derive level and plausibility when they are missing? | Use them server-side when given (never displayed); otherwise conservative unisex absolute tables. |
| **Q-8** | Streak: daily streak (with planned rest days/freezes) or weekly streak (weeks meeting the plan)? A daily streak pushes daily training, which conflicts with §5 safety. | **Weekly streak** as the headline ("12-week streak"), plus a daily streak where planned rest days never break it. |
| **Q-9** | One gym per user, or several (e.g. a CrossFit box + a regular gym)? | One primary gym (counts for Gym Wars and gym leaderboard). |
| **Q-10** | Rule-set activation: super admin only, or admin + four-eyes approval? Mandatory 2FA for staff? | Super admin only in P1; TOTP 2FA mandatory for moderators and above. |
| **Q-11** | Gym Wars: gyms opt in weekly (gym admin) or auto-enrolled if eligible? | Auto-enrolled, gym admin can opt out. |
| **Q-12** | Arabic: Modern Standard Arabic or Tunisian Derja for UI copy? Default language? | MSA for UI, French as default locale for Tunisia. |
| **Q-13** | Real-time in Phase 1: needed for Friend Battle scores, or is polling (30 s on the battle screen) enough until the WebSocket gateway lands with notifications in Phase 2? | Polling in P1, Socket.IO in P2. |
| **Q-14** | ORM: Prisma (proposed) OK, or do you prefer TypeORM / Kysely / Drizzle? | Prisma. |
| **Q-15** | Phone verification: which SMS provider (Tunisian operators, Twilio…)? Is it needed in Phase 1? | Defer to Phase 2; schema ready. |
| **Q-16** | Friend Battles "choose which metrics count": is choosing among the score components (progress / consistency / performance) acceptable? Picking raw metrics (e.g. "km run") would break cross-sport fairness. | Components only. |
| **Q-17** | Notifications in Phase 1: spec puts notifications in Phase 2, but Friend Battles (P1) need invites. | In-app notification list in P1 (no push), FCM in P2. |
| **Q-18** | Cities: Tunisian municipalities (~350) or delegations (264)? Do you have a dataset? | Delegations from the official INS list (I'll seed from a public source and cite it). |
| **Q-19** | Where is the repository hosted (GitHub org/name)? Needed for CI. | `fitness-league` monorepo on your GitHub. |
| **Q-20** | Default numbers (division thresholds, XP values, caps, anti-cheat thresholds) in this doc are my estimates. Do you want to review/tune them now or after beta data? | Ship as rule set v1, tune after beta with the dry-run tool. |

### 12.2 Assumptions taken (already reflected in the design)

- `ASSUMPTION:` Modular monolith with **two processes** (API + worker) from the same codebase.
- `ASSUMPTION:` UUID v7 primary keys generated in the app.
- `ASSUMPTION:` Weight values stored in kg, distances in m, durations in s; unit display (lb/mi) is a client setting.
- `ASSUMPTION:` Held workouts compute points into `workout_evaluations.pending_points`; nothing reaches the ledger until approved (so rankings are never affected by held data).
- `ASSUMPTION:` Workouts are editable for 24 h only.
- `ASSUMPTION:` e1RM is computed only for sets of 1–12 reps (Epley unreliable above).
- `ASSUMPTION:` Standard-distance run times (5K, 10K…) are derived from the average pace of runs **at least** that long (no splits in v1); true splits come with integrations in Phase 4.
- `ASSUMPTION:` The home-screen mock numbers in the spec (e.g. level 18 = 2 400 XP) are illustrative; the real curve is configurable.
- `ASSUMPTION:` Friend Battles are between accepted friends only, max 3 concurrent per user.
- `ASSUMPTION:` The "First Step" badge is granted at first workout in Phase 1 as a hard-coded quest reward stored in `user_badges`; the generic badge rule engine arrives in Phase 2 and re-expresses it as data.
- `ASSUMPTION:` Leaderboards are per **current season**; the friends board is computed on the fly from national ranks (no snapshot).
- `ASSUMPTION:` Account deletion keeps anonymised ledgers (spec) and removes all media.
- `ASSUMPTION:` A held-workout review queue (moderator) exists in Phase 1 admin, because the Phase 1 anti-cheat produces HELD outcomes that someone must resolve. Full reports/moderation stay in Phase 3.

---

## 13. Appendix

### 13.1 Repository layout

```
fitness-league/
├─ apps/
│  ├─ api/                 NestJS (src/modules/<module>/…, src/worker.ts, prisma/)
│  ├─ admin/               React + Vite
│  └─ mobile/              Flutter (lib/features/<feature>/{presentation,domain,data}, lib/core/…, l10n/)
├─ packages/
│  ├─ scoring-schema/      zod schema of the rule set (shared API ↔ admin)
│  └─ api-client-ts/       generated TS client for admin
├─ infra/
│  ├─ docker-compose.yml
│  └─ seed-data/           governorates, cities, sports, exercises, rule set v1 (JSON/CSV)
├─ docs/
│  ├─ ARCHITECTURE.md      (this file)
│  └─ adr/                 architecture decision records
├─ .github/workflows/
├─ .env.example
└─ README.md
```

### 13.2 Proposed Phase 1 build order (one report after each)

1. **Foundation** — monorepo, Docker Compose, NestJS skeleton (config, errors, pagination, logging, health), Prisma schema v1 + seeds, CI.
2. **auth + users + reference** — register/login/OAuth/tokens/age gate/consents; profile & settings; catalog endpoints.
3. **Flutter shell** — theme (dark first), i18n fr/en/ar + RTL, go_router, auth & onboarding screens, generated API client.
4. **workouts + anticheat (rules) + offline sync** — API, Drift outbox, log-workout screens.
5. **progress + PRs + calibration** — baselines, PR detection, My Progress screen.
6. **scoring + ledger + XP/levels** — rule sets, pipeline, explanations, caps.
7. **goals + suggestions** — goals UI with milestones and disclaimer.
8. **seasons + divisions + weekly LP + leaderboards** — jobs, Redis, snapshots, League screens.
9. **gyms (no wars)** — gym directory, join/approval, verification workflow.
10. **social (friends) + Friend Battles** — friends, battles, in-app notifications.
11. **admin panel** — users, rule sets (edit/validate/activate/diff), seasons, gym verification, held workouts, audit log.
12. **Hardening** — security test suite, mobile UI tests, README one-command run.

### 13.3 Local environment status (checked 2026-09-25)

| Tool | Status |
|---|---|
| git | 2.43 ✓ |
| Node.js | v22.17 on the **Windows** side only (not inside WSL) |
| Docker | **not available in WSL** (Docker Desktop WSL integration probably disabled) |
| Flutter / Dart | **not installed** |
| PostgreSQL client | not installed (not needed with Docker) |

Before Phase 1, we need: Docker Desktop with WSL integration enabled (or Docker Engine in WSL), Node 22 + pnpm inside WSL, and the Flutter SDK (+ Android SDK/emulator) — or tell me you prefer to run Flutter from Windows.
