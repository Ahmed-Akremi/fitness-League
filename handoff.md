# Handoff — fitness-league (2026-10-23: plan 3a reviewed; plan 3b built, on `feat/rust-backend-3`)

Earlier handoffs are in git: `git show 61b7787:handoff.md` (the full history since 2026-10-04),
`git show 02a732e:handoff.md` (part 1 complete), `git show 9bb2cdc:handoff.md` (plan 2a built),
`git show a4464bc:handoff.md` (plan 2b built), `git show 18e861e:handoff.md` (plan 2c built and reviewed),
`git show 1cdb980:handoff.md` (plan 2d built) and `git show 4b27150:handoff.md` (plan 3a built). This one keeps
what is still true and still to do.

## 0. Start here (next session)

Opening prompt to paste:

> Read `handoff.md` (the backend's; `handoff-frontend.md` is the app's and not for this session), then run plan
> 3b's whole-branch review as a fresh reviewer (§0 step 2). Then write and build plan 3c (feed and news) from the
> part 3 spec. Work in this Windows checkout only.

First steps, in order:
1. **Find where `main` is.** `git fetch && git log --oneline -5 origin/main feat/rust-backend-3`. The owner
   commits, pushes and merges during sessions; this session they committed plan 3b's tasks 2, 3 and 5 and the
   `.sqlx` data from the working tree, and merged twice (see §4).
   - At the end of this session, `origin/main` was at `8dfc78f`: PRs #35 and #36 merged `feat/rust-backend-3`
     up to `d3ccf4e` (all of plan 3a, its review, plan 3b's plan, tables, directory and memberships). PR #34
     (`feat/floor-judging`, the app and the old API only) came in before.
   - **`feat/rust-backend-3`** holds the rest of plan 3b, **local only**: `9c6f60a` (the dashboard),
     `716b13a`, `1348876`, `24b92c0` (the board, ranks and badge, the owner's), `fe4c1a8` (export,
     anonymisation, the security check, formatting), `c8a9ea5` (`.sqlx`, the owner's), `1d76c25` (two
     dependency patch bumps for new advisories) and the docs commit.
     **Don't push:** the user pushes themselves.
   - **Where to work:** if `main` holds all of plan 3b, run the review on `feat/rust-backend-3` as it is, then
     start plan 3c on a new branch from `origin/main`; otherwise go on with `feat/rust-backend-3` (merge
     `origin/main` first). Local `main` is far behind: never branch from it.
2. **Plan 3b's whole-branch review is not done.** No reviewer was spawned (the user did not ask for one). Run it
   as plan 3a's was run: a fresh session reads the branch against the plan and the old API, without agents.
   - Its inputs: the plan's « Review focus » and « Built » sections, and the ledger
     `.superpowers/sdd/2026-10-21-rust-backend-3b-gyms/progress.md` (git-ignored, local only), which holds every
     `Ruling:` line. Delete that folder once the review is done.
   - Range: `git diff 857a623..HEAD -- apps/backend` (857a623 is the plan commit).
3. **Check Docker.** `docker ps` should show three healthy containers. Otherwise see §5, « Containers
   stopped ». If a test panics in sqlx's `testing/mod.rs` with « Error dropping database … Directory not empty »,
   see §5, « A stuck test database ».
4. **Set up the environment.** Use §2's environment line in Git Bash for every cargo command, then check the
   build: `cargo test -j 4 --lib` (131 green). Then run the three suites the last session could not run on the
   final code (§4, « Checks »): `cargo test -j 2 --no-fail-fast --test league --test notifications --test social`.
5. **For plan 3c (feed and news), read:**
   - the part 3 spec, `docs/superpowers/specs/2026-10-21-rust-backend-gyms-social-design.md`: « Scope »
     (plan 3c's routes), its feed, news and socket sections, « Database », « Plans » and the rulings (ruling 3
     moves the publishing of home news to part 5; ruling 5 is the socket through `socketioxide`);
   - plans 3a and 3b for the house form;
   - the old API's feed, news and realtime modules, and the app's callers (`features/feed`, `features/home`,
     the socket client) and their recorded answers in `apps/mobile-rn/assets/demo/api.json`.
6. **Don't ask the owner product questions.** Their words: « you will find everything in the .md files ».
   Take the technical calls yourself and list them in the spec's and plans' « Rulings » sections.

## 1. Goal

Fitness League: a training and competition app for athletes, gyms and event organizers in Tunisia
(FR / EN / AR, Arabic right to left).

| Folder | What | State |
|---|---|---|
| `apps/mobile-rn` | The app (React Native, Expo); the only mobile app since the Flutter one was removed | Live code |
| `apps/admin` | Admin panel (Vite + React): staff, judges, publication of events | Live code |
| `apps/api` | Old API (NestJS, Prisma, PostgreSQL) that both frontends use today | Frozen; replaced part by part |
| `apps/backend` | **New API in Rust** (Axum, sqlx, MariaDB 11.4, Redis) | **Current work** |
| `apps/landing` | Landing page (Vite + React), merged in PR #8 | Done, not public yet |

**Current goal: the Rust backend** (owner's decision, 2026-10-06). It is a fresh design that keeps the
routes, JSON shapes and error codes the two frontends already use, so neither changes. Scope = what the
frontends call (about 166 endpoints), not the 301 routes of `apps/api`. The job queue is a Redis Stream, not
BullMQ (a Node library). Six parts:

1. Foundation and accounts: **done**.
2. Training loop: **done** (plans 2a to 2d).
3. Gyms and social: **under way** (spec written; plans 3a and 3b built; plans 3c to 3f to come).
4. Competitions.
5. Admin and moderation.
6. Cut-over: demo data, frontends pointed at Rust, `apps/api` and PostgreSQL removed.

Spec of part 1 (also the frame of every part):
`docs/superpowers/specs/2026-10-06-rust-backend-foundation-design.md`.
Spec of part 2: `docs/superpowers/specs/2026-10-18-rust-backend-training-loop-design.md`. It covers 22 app
endpoints in plans 2a to 2d, and its « Rulings » section lists the choices the owner can change.
Spec of part 3: `docs/superpowers/specs/2026-10-21-rust-backend-gyms-social-design.md`. It covers 76 app
endpoints in plans 3a to 3f (friends and notifications, gyms, feed and news, gym WODs and wars, battles and
duels, challenges and leagues), with seven rulings for the owner.

**Owner's standing product decisions** (they bind every part of the port):
- Video proof is a **YouTube link only**.
- **Judges work only in the admin panel.** Judge accounts are refused by the app (403 `JUDGE_ACCOUNT`).
  Admins generate judge accounts; head judges manage their competitions' judges.
- **No admin two-factor authentication**, production included.
- **The app computes the WOD score:** reps per movement × points per rep, capped at the WOD maximum
  (`MOVEMENT_REPS`).
- **Editable banner** per competition.
- **Home news:** admins post text and/or one photo, athletes only like (one ❤️); a bell notification for
  every post.
- **Organizer space:**
  - any app user creates a draft event; **only an admin publishes it**, with a « publication demandée »
    marker and a note when sent back;
  - the organizer prepares it in the app;
  - every organizer route looks rows up with `{ id, competitionId }`;
  - a draft's leaderboard cannot be published.

## 2. Current state

- **`origin/main`** is at `8dfc78f`. Merged so far:
  - #13 and #14: part 1;
  - #15: the part 2 spec, plan 2a and its code;
  - #16: formatting, the Windows build, and the README, spec and plan updates;
  - #17: plan 2a's handoff;
  - #18, #19 and #21: plan 2b, then plan 2c and its review;
  - #20: the organizer space (UI);
  - #22, #26 and #27: plan 2d, up to `6f9f1be` (the fix and the docs);
  - #32: `feat/rust-backend-3` up to `29c3bfb` (plan 2d's review fix, the part 3 spec, plan 3a up to the
    friends board);
  - #33: `feat/hig-phone`, the app's Apple HIG work (frontend only; see `handoff-frontend.md`);
  - #34: `feat/floor-judging`, floor judging in the app and the old API (no backend file). It adds the
    `COMPETITION_JUDGE_INVITED` notification type, which `0010_social`'s ENUM lacks: part 4 adds it, with the
    floor-judging routes the app now calls;
  - #35 and #36: `feat/rust-backend-3` up to `d3ccf4e` (the rest of plan 3a, its review, plan 3b up to the
    memberships).
- **Branch `feat/rust-backend-3`** starts at `3d42eed`. Its commits since `8dfc78f` (the rest of plan 3b) are
  local only; §4 lists them. It has no upstream.
- **Other local branches:**
  - `feat/rust-backend-2d` (plan 2d) is merged through #27, except its last four commits (plan 2d's review fix,
    its `.sqlx` data and the docs), which reach `main` through `feat/rust-backend-3`;
  - `main` is far behind `origin/main`, so don't use it;
  - `feat/rust-backend-2c` (plan 2c) is merged through #19 and #21;
  - `feat/rust-backend-2b` (plan 2b) is merged through #18;
  - `feat/rust-backend` is merged (#14);
  - `feat/gyms-sports-mobile` is old. It is ahead of its remote, but every one of its commits is in
    `origin/main`.

  None was deleted (owner's call). No stash.
- **Rust backend: parts 1 and 2 complete, part 3 under way. 81 endpoints.**
- **Plan 3b built: gyms.** Sixteen routes:
  - `GET /gyms` (verified gyms by name or by members, `q` accent- and case-insensitive with wildcards literal,
    `sport`, `governorateId`; a cursor fits only its sort, `CURSOR_SORT_MISMATCH`), `POST /gyms` (201
    `PENDING`; 409 for a second pending submission; 403 `EMAIL_NOT_VERIFIED`), `GET /gyms/mine`, `GET /gyms/{id}`
    (the card, `rank` by the members' summed season LP, `topAthletes` who show on leaderboards, `myMembership`,
    `canManage`, `warRecord: null`);
  - `POST /gyms/{id}/membership` (201 `PENDING`; 409 with `gymId` and `membershipStatus`: one live membership
    per athlete, by a unique generated column), `DELETE /gyms/me/membership`, `GET /gyms/{id}/members`;
  - for the gym's admin (its owner while `GYM_ADMIN` and the gym verified, or staff; otherwise 403):
    `GET /gyms/{id}/membership-requests`, `POST …/members/{userId}/approve|reject|remove`, `POST` and `DELETE
    …/members/{userId}/coach`, `GET /gyms/{id}/dashboard` (members, activity, the 8-week trend, top progress,
    who to nudge; `rating: 1500`, `wods: []` and wars at 0 until plan 3d);
  - `GET /leaderboards/gyms/{id}` and `/me`, over the athletes whose primary gym it is, with the movement
    since the `GYM` snapshot.

  Every membership change is one conditional `UPDATE` in the transaction that moves `profiles.primary_gym_id`
  (a change that touches no row is the 404), with its audit entry naming the athlete. The gym shows in `GET /me`
  (`profile.gym`), `GET /users/{username}`, every leaderboard row, onboarding (`steps.gym`) and `GET /me/ranks`
  (`gym`). The badge sweep awards `GYM_MEMBER`. Contact details and proofs never leave the API, except the
  submitter's own proof in the export (`gymMemberships`, `gyms`). Anonymisation deletes the account's
  memberships, its pending gyms and its verification requests, and leaves its other gyms without an owner.
- **Plan 3a built: friends and notifications.** Seventeen routes:
  - friends: `GET /friends` (by username), `GET /friends/requests?direction=in|out`, `POST /friends/requests`
    (201 `PENDING`, or `ACCEPTED` when they had asked; 409 when already friends or already sent; 403
    `EMAIL_NOT_VERIFIED`; 30 a day), `POST /friends/requests/{userId}/accept` and `/decline`,
    `DELETE /friends/{userId}`;
  - follows (`POST`, `DELETE /follows/{userId}`, silent) and blocks (`POST /blocks/{userId}`: the friendship and
    both follows go, and each side is a 404 to the other everywhere but the leaderboards);
  - `GET /search/athletes?q` (2 to 40 characters, accent- and case-insensitive, wildcards literal, 60 a minute)
    and `GET /users/{username}` (no email, birth date or body data; the age bracket only when opted in; the
    friendship state seen from me; the primary gym since plan 3b);
  - `GET /notifications` (newest first, `unread`) and `POST /notifications/read` (some or all);
    `GET` and `PUT /me/notification-preferences` (six categories and quiet hours, stored; nothing is pushed:
    the app registers no device, spec ruling 2);
  - `GET /leaderboards/friends` and `/me` (me and my accepted friends, eligible ones only, `movement: null`);
    `GET /me/ranks` now answers `friends`.

  Notifications are written in the transaction of their cause (`notifications::notify`): friend requests and
  acceptances, and every badge awarded (`BADGE_AWARDED` with the badge's names). The `FRIEND` badge fact counts
  accepted friendships, and the badge sweep adds both sides of friendships accepted in the last 26 hours.
  Writers of a link between two athletes (request, acceptance, follow, block) lock both `users` rows first
  (`social::lock_pair`), so a block cannot race them. The export adds `friendships`, `following`, `blocked`,
  `notifications` and `notificationPreferences`; anonymisation deletes the account's friendships, follows,
  blocks and notifications.
- **Plan 2d built and reviewed: the league.** Seven routes:
  - `GET /me/weekly-scores/current`: the running week computed on read (progress, consistency and performance
    against the athlete's own expected rate; challenges come with part 4, so their weight is renormalised);
  - `GET /me/lp`: LP, division, next division and the LP missing, in the active season;
  - `GET /me/ranks`: national and governorate ranks (`friends` since plan 3a, `gym` since plan 3b);
  - `GET /leaderboards/national` and `/leaderboards/governorates/{id}`, each with `/me` (the page centred on
    me): eligible athletes only (active, verified, calibration over, opted in), ranked in SQL, keyset cursor
    `{lp, id}`, movement against the last daily snapshot (`NEW` when absent).

  The worker (`league::jobs::run_due`, every 10 minutes) runs each job once per key through `job_runs`
  (`INSERT IGNORE` claims; a `RUNNING` row older than an hour, or a `FAILED` one, is taken over):
  - `season-open`, then `season-close` (one transaction: standings and champions, then every athlete carried
    into the next season at 0 with a positive `SEASON_SOFT_RESET` entry, 1,240 → 1,070);
  - `weekly-close`, athlete by athlete in its own transaction under the `user_stats` lock: the baseline audit
    (Nour 50 → 55.172), the rescoring of paid weeks after a correction (reversal, then a `<date>#c<n>` entry),
    the `WEEKLY_SCORE` LP entry, the `weekly_scores` row, the weekly streak and the habit goals;
  - `calibration-finalize`, `badge-sweep` (division and weekly-streak badges, and those a late log missed),
    `leaderboard-snapshot`, `balance-reconcile`.

  The LP ledger (`league_point_transactions`) is append-only like the XP one, written only by
  `scoring/ledger.rs`. Only the athlete's current season moves the live balance, and an athlete without a season
  joins only an active one. The seed opens the current quarter's season and schedules the next. The export
  fills `leaguePointTransactions`; anonymisation changes nothing in the league tables.
- **Plan 2c built: goals and badges.** Five routes:
  - `GET /goals`: active goals first, newest first;
  - `POST /goals` (201, with `disclaimerKey`):
    - milestones planned by the old `goal-planning.ts` maths;
    - the old API's checks and codes (`NOT_ALLOWED_FOR_TYPE`, `METRIC_NOT_TRACKED`, `REST_DAY_REQUIRED`,
      `NO_CURRENT_VALUE`, `TARGET_NOT_BETTER`, `UNSAFE_TARGET`, `UNREALISTIC_TARGET`, `MUST_BE_IN_FUTURE`);
    - 409 `CONFLICT` at 10 active goals or for a second active goal on one metric;
    - a too-early date is moved, with its `safetyAdjustment`;
  - `POST /goals/suggestions`: three targets with an ETA range;
  - `DELETE /goals/{id}`: abandons an active goal;
  - `GET /badges`: the catalogue with the athlete's progress.

  Behaviour:
  - **Weight goals are health data.** Their values are stored only encrypted (check constraints refuse a clear
    value), always private, answered `null` without the `HEALTH_DATA` consent, and paced at 1 %/week.
  - **Milestones are credited in the transaction that earns them:**
    - in `scoring::score`, after the record rewards; a late log or a held record reaches none;
    - in `POST /me/body-measurements`, which now locks `user_stats` and runs in a transaction; only the
      safe-rate part of a weight change counts.
  - **Milestone XP** is 150 (`goal_milestone_xp`) and outside the caps.
  - **Badges** are evaluated at the end of both paths and awarded once, under the `user_stats` lock. A revoked
    badge is never given again.
  - **Facts read today:** workouts accepted, records awarded, goals completed, level, since plan 2d the best
    division and the weekly streak, since plan 3a the friends, and since plan 3b the approved gym memberships.
    The others are 0 until plans 3c to 3f (battles, duels, gym wars, challenges).
  - **Onboarding:** `steps.goals` is true once the account has a goal.
  - **The export** fills `goals` (weight values decrypted) and adds `account.badges`.
  - **Anonymisation** deletes weight goals and their milestones; the other goals and the badges stay.
  - **The seed** loads the 22 badges of `catalog.json` and refuses an invalid rule. A second run keeps an
    admin's `enabled` choice.
- **Plan 2b** (points): an accepted workout is scored in the transaction that saves it (`scoring::score`, called
  from `intake::create`, which first locks the athlete's `user_stats` row):
  - observations, baselines (calibration), personal records judged against the expected progression, the
    plausibility hold;
  - the append-only XP ledger (`xp_transactions`, triggers, granted once per source) with the daily and weekly
    caps per business day, the level, the daily streak with planned rest, the first quest;
  - a late log (> 72 h) keeps its records and streak, earns no XP; held and rejected workouts earn nothing.

  Routes: `GET /workouts/{id}/points`, `GET /me/records`, `GET /me/progress` (`period` 7d to 1y; `bodyWeight`
  only with the health consent) and `GET /me/progress/metrics/{exerciseId}/{metricCode}`. `GET /me` `stats` and
  `streak` move.
- **Plan 2a** (workouts in):
  - `POST /workouts` and `POST /workouts/sync`: idempotent on `clientId`, checked by anti-cheat layer 1 (the old
    `rules.ts`, rule for rule, with rule set v2's thresholds);
  - `GET /workouts` (newest first, signed keyset cursor) and `GET /workouts/{id}`;
  - `GET` and `POST /me/body-measurements`: AES-256-GCM through `HEALTH_DATA_KEYS`, behind the `HEALTH_DATA`
    consent.
- **Part 1's 26 endpoints:**
  - health and readiness;
  - the four `/ref` lists;
  - `/auth`: register, login, refresh, logout, verify, resend, forgot, reset;
  - `/me`: `GET`, `PATCH /me/profile`, `PATCH /me/settings`, the three onboarding steps, `GET /me/export`
    (3 a day), `DELETE /me`;
  - the four `/admin/auth` and `/admin/me` routes.
- **Worker:** sends the emails and runs the **daily sweep**. Once per business day (Redis key `sweep:<day>`)
  it anonymises accounts whose 30-day grace is over and deletes expired tokens. Every 10 minutes it also runs
  the league's jobs (`league::jobs::run_due`, see plan 2d above).
- **CLI:** `backend promote <email> <role>` creates the first staff account.
- **Last checks (2026-10-23, native Windows):** see section 4.
- **Local machine: Windows checkout `C:\Users\moham\OneDrive\Desktop\Projects\fitness-League`.**
  - **Owner's instruction: work here, never in the WSL copy** `/home/th3r3bel/Projects/fitness-League`. That
    copy is stale. It holds a stray `feat/rust-backend-2` (commit `229890e` plus uncommitted spec edits),
    superseded by `main`.
  - Native toolchain:
    - Visual Studio 2022 C++ Build Tools;
    - rustup (1.99.0 from `rust-toolchain.toml`);
    - sqlx-cli, cargo-audit 0.22.2 and cargo-deny 0.20.2, in `%USERPROFILE%\.cargo\bin`.
  - Every cargo command runs in Git Bash with:
    `export PATH="$USERPROFILE/.cargo/bin:$PATH" CARGO_TARGET_DIR="$LOCALAPPDATA/fitness-league/target" AWS_LC_SYS_PREBUILT_NASM=1`,
    and `-j 4`.
  - The MariaDB (host port 3307), Redis and Mailpit containers are **running**. The dev database is migrated to
    `0011` but **not seeded** (`cargo run -- seed ../../infra/seed-data`).
  - `apps/backend/.env` holds dev keys, including `HEALTH_DATA_KEYS` (git-ignored, never printed).
  - No API process is running.
- **`gh` is not on the PATH, on Windows or in WSL's default shell.** Pushing and PRs go through the user and the
  owner, who have been merging them. **The user's instruction (2026-10-20): « don't push i'll push later ».**
- **Tools: the `security-audit` skill** (Cloudflare's, installed 2026-10-19 from
  `https://github.com/cloudflare/security-audit-skill`, commit `c1c8a8c`, MIT):
  - in `~/.claude/skills/security-audit/` (user level, outside the repository). Its 21 files were reviewed
    before installing: Markdown methodology, a JSON schema, and two zero-dependency Node validators that only
    read files (no network, no child process);
  - **guidance mode** (default): security questions and focused reviews, no files written;
  - **full audit mode**, only on an explicit request (« security audit this codebase »): six phases with
    sub-agents, output in `~/security-audit-skill/<repo>/run-<N>`, never in the repository. It runs target
    code only inside an OS sandbox without network; otherwise a lead stays `needs_validation`;
  - **its validators refuse to run on native Windows** (see section 5), so a full audit must run from WSL.
- **Other apps, unchanged this session** (the owner's merges of `main` brought design references under
  `docs/prompts/`, a mock-up HTML and `apps/admin/tsconfig.tsbuildinfo`, no app code). Last runs:
  - RN: 53 suites / 366 tests (`npx jest --maxWorkers=2`) + `npx tsc --noEmit`;
  - admin panel: 13 tests + typecheck;
  - API: integration 35 suites / 140 tests, unit 310;
  - landing: 60 tests + `vite build`.
- **Old API database:** migration `20261014120000_competition_publication_request` (and possibly earlier ones)
  is not applied to any local PostgreSQL. Run `pnpm prisma migrate deploy` in `apps/api` before starting the
  old API.

## 3. Active files (Rust backend)

- Package: `apps/backend/`.
  - `Cargo.toml`, `rust-toolchain.toml` (1.99.0), `deny.toml`.
  - `.cargo/config.toml`: root database URL for the sqlx macros and tests, `TEST_REDIS_URL`.
  - `.env.example`, `.sqlx/` (offline query data), `assets/common-passwords.txt`.
- `migrations/`:
  - `0001_reference`, `0002_identity`, `0003_profile`, `0004_audit` (the append-only triggers);
  - `0005_one_pending_deletion` (generated `pending_user` under a unique index);
  - `0006_workouts`: `workouts`, `workout_exercises`, `workout_sets`, `workout_evaluations`; `body_measurements`
    with the values encrypted in `VARBINARY`;
  - `0007_points`: `expected_progression`, `metric_observations`, `personal_records` (one current per key),
    `xp_transactions` (append-only by trigger, granted once per source), `xp_daily_counters`; new columns in
    `baselines` and `user_streaks`;
  - `0008_goals_badges`:
    - `goals`: clear values or encrypted ones, exactly one form, and the encrypted one exactly for `WEIGHT`, by
      check constraints. One active goal per `(user, metric, exercise)`, by a unique index on generated columns;
    - `goal_milestones` (`position`, a value in one form, `reached_at`, `workout_id`, `xp_transaction_id`);
    - `badges` (code, category enum in the old order, names and descriptions in three languages, icon, rarity,
      rule JSON, `enabled`);
    - `user_badges` (once per badge, `source_ref`, `revoked_at`);
  - `0009_league`:
    - `seasons` (one `ACTIVE` per country, by a unique index on a generated column; `SCHEDULED`, `ACTIVE`,
      `CLOSED`); `user_stats.current_season_id` gets its foreign key;
    - `league_point_transactions`: append-only by trigger, granted once per source, reversed at most once;
    - `weekly_scores` (closed weeks only, `season_id` NULL outside any season), `season_standings`,
      `leaderboard_snapshots` (national and governorate scopes);
    - `job_runs` (`job`, `run_key` unique, `RUNNING`/`DONE`/`FAILED`, `result`, `error`);
    - `baselines` gains `corrected_from` and `rule_set_version`;
  - `0010_social`: `friendships` (ordered pair, `CHECK (user_low_id < user_high_id)`, `requested_by`), `follows`,
    `blocks`, `notifications` (type ENUM of the 31 types the app knows, payload JSON, `read_at`); `user_settings`
    gains six `push_*` switches and `quiet_hours_start`/`end` (both or neither).
  - `0011_gyms`: `gyms` (slug unique, four social link columns, contact phone and email, `PENDING`/`VERIFIED`/
    `REJECTED`/`SUSPENDED`, owner set null on delete), `gym_sports`, `gym_members` (one live membership per athlete
    by the unique generated `live_user`), `gym_verification_requests` (one pending per submitter by the unique
    generated `pending_submitter`, `proof_text`); `profiles.primary_gym_id` gets its foreign key;
    `leaderboard_snapshots.scope_type` gains `GYM`.
- `src/main.rs`: subcommands `serve`, `worker` (job loop, the daily sweep and the league jobs every 10 min, 1 min
  after a failure), `migrate`, `seed [dir]`, `promote`, `keys`.
- Infrastructure:
  - `config.rs`, `error.rs` (problem+json, `AppError`);
  - `validate.rs`:
    - `Check` (with `within` for decimals), `ValidJson`, `valid`;
    - `normalise_email`, `nullable`, `readable_name`;
    - `contains` (`%text%` for `LIKE … ESCAPE '|'`, the search's and the gym directory's), `rfc3339`, `round_to`;
  - `db.rs`: session settings, `duplicate_key`, `describe`;
  - `state.rs`, `types.rs`: `Role`, `Gender`, `Locale`, `Theme`, `Visibility`, `ExperienceLevel`, `iso`;
  - `rules.rs`: the active rule set and its `version`:
    - `min_age_years`, `level_titles`, `calibration_days`;
    - the e1RM formula, `late_log_max_hours`;
    - the XP numbers, the fairness numbers, `goal_milestone_xp`, `weight_change_max_pct_per_week`;
    - the league numbers: `progress_window_days`, `progress_reward_cap`, `progress_top_n`, `lp_weights`,
      `weekly_lp_per_point`, `week_grace_hours`, `season_soft_reset_ratio`, `division_thresholds`,
      `baseline_audit_days`;
    - `anticheat` (every threshold of v2).
  - `audit.rs`, `jobs.rs` (the Redis Stream queue), `mail.rs`, `seed.rs` (now with the badges).
- `src/http/`:
  - `mod.rs`: `Api` route builder, middleware, `route_table()`;
  - `auth.rs`: the `AppUser` and `PanelUser` extractors; `AuthUser::require_verified` (403
    `EMAIL_NOT_VERIFIED`, the old `@RequiresVerifiedEmail()`);
  - `rate_limit.rs`: every limit of the spec, `ClientIp::subject()`;
  - `page.rs`: the signed keyset cursor (`encode`, `decode`, `limit`, `page`). Parts 2 to 5 reuse it for
    every list.
- `src/security/`:
  - `password.rs` (Argon2id, NFKC, hashing cap);
  - `tokens.rs` (Ed25519 JWT, opaque tokens);
  - `policy.rs` (lockout, age, business day, `business_day_start`, `week_start`, `quarter_bounds`);
  - `health.rs`: `HealthCipher`, AES-256-GCM. Rows carry the key id, and the first key in
    `HEALTH_DATA_KEYS` encrypts.
- `src/modules/`:
  - `health.rs`, `reference.rs`, `admin_auth.rs`;
  - `auth/{mod,accounts,sessions,emails}.rs`;
  - `me/mod.rs`: `GET /me`, profile, settings, `payload`;
  - `me/onboarding.rs` (the `goals` step reads `goals`, the `gym` step a live membership);
  - `me/privacy.rs`: export (goals, badges, the social keys, `gymMemberships`, `gyms`), `DELETE /me`,
    `daily_sweep`, `sweep`, `anonymise` (deletes weight goals, the social links, the gym memberships, pending
    gyms and verification requests);
  - `me/body.rs`: body measurements, `has_consent`, `HEALTH_DATA`, `latest_weight_kg` (`None` without the
    consent). `add` locks `user_stats`, credits weight goals and evaluates badges in its transaction;
  - `workouts/`:
    - `mod.rs`: routes, the sync batch, the list;
    - `intake.rs`: `create`, which locks the athlete's `user_stats` row, then hashes, replays, evaluates, stores
      and scores (an accepted workout) in one transaction. Also `load` and `one`, which give the app's JSON;
    - `metrics.rs`: e1RM (2 decimals), volume, distance, fingerprint;
    - `anticheat.rs`: layer 1, pure.
  - `scoring/`:
    - `engine.rs`: the pure rules (XP, caps, level, fairness, observations, daily streak);
    - `records.rs`: observations, baselines and records (`decimal`); `ledger.rs`: the only writer of the XP and
      LP ledgers (`append_xp`, `append_lp`, `reverse_lp`);
    - `mod.rs`: `score` (1 workout XP, 2 record rewards, 3 goal milestones, 4 the first quest, 5 badges),
      `expected`, `GET /workouts/{id}/points`; `progress.rs`: `/me/records`, `/me/progress` and its series.
  - `goals/`:
    - `planning.rs`: the pure goal maths (`round_for`, `plan_milestones`, `reached`, `weeks_at_rate`,
      `suggest_targets`, `safe_weight_weeks`, `credited_weight_change`);
    - `mod.rs`: the four routes, `views` (used by the export), the old API's limits as constants;
    - `milestones.rs`: `on_workout`, `on_weigh_in` and `on_week_closed`, the only writers of
      `goal_milestones.reached_at`.
  - `badges.rs`: `Rule`, `Fact`, `Division` (rank order), `parse_rule`, `progress`, `evaluate` (notifies each
    award), `GET /badges`.
  - `notifications/`: `mod.rs` (`Kind`, `notify`, `GET /notifications`, `POST /notifications/read`),
    `preferences.rs` (`GET`/`PUT /me/notification-preferences`, `load`).
  - `social/`: `mod.rs` (routes, `Summary`, `pair`, `lock_pair`, `target`), `friends.rs` (requests, answers,
    unfriend, follows, blocks), `athletes.rs` (search, public profile).
  - `gyms/`: `mod.rs` (routes, `gym_param`, `can_manage`, `manageable`), `directory.rs` (the card query, the
    directory, `POST /gyms`, `mine`, the profile), `members.rs` (join, leave, the member list, requests,
    decisions, coaches), `dashboard.rs`.
  - `league/`:
    - `engine.rs`: the pure rules (components, weighted total, divisions, soft reset, baseline audit, weekly
      streak, last closable week), with the spec's vectors;
    - `weekly.rs`: `compute`, the audit, `close_week`, `GET /me/weekly-scores/current`;
    - `seasons.rs`: `plan` (the seed), `active`, `open_due`, `close`, `GET /me/lp`;
    - `boards.rs`: the national, governorate, gym and friends boards (`Scope`) with `/me`, the gym in every row,
      `GET /me/ranks`, `snapshot` (national, governorate and gym scopes);
    - `jobs.rs`: `once` and `run_due`, with calibration finalize, the badge sweep and the reconcile.
- `tests/`:
  - `common/mod.rs`: `TestApp`, `seeded`, `register`, `create_user`, `open_session`,
    `seeded_with_cuttable_redis`, `deliver_mail`, `assert_same_shape`, `recorded` (the app's recorded answer to
    a route), `set_consent`, `calibrated`, `a_gym` (a verified gym whose owner is its admin and member),
    `member_of`;
  - `common/workouts.rs`: workout bodies from the seeded catalog (`catalog`, `athlete`, `lifting`,
    `strength`, `single`, `run`) and `post`, `get`;
  - suites: `schema`, `http_shell`, `rate_limit`, `reference`, `jobs`, `mail`, `emails`, `sessions`,
    `register`, `login`, `admin_auth`, `me`, `profile`, `onboarding`, `privacy`, `security`, `body`,
    `workouts`, `points`, `goals`, `badges`, `league`, `leaderboards`, `notifications`, `social`, `gyms`.
  - `security.rs` holds `PUBLIC`, the 14 routes that answer without a session. **A new public route must be
    added there**; any other new route must answer 401 without a token, or the suite fails. Its role walker
    counts a 403 as a refusal only when the code is `FORBIDDEN`, so `CONSENT_REQUIRED` is not one.
  - `workouts.rs` checks the list against the shape recorded from the old API
    (`apps/mobile-rn/assets/demo/api.json`). That file records `GET /goals` as an empty list and no badges, so
    `goals.rs` and `badges.rs` pin the shapes themselves. `league.rs` and `leaderboards.rs` check
    `/me/weekly-scores/current`, `/me/lp`, `/me/ranks` and the board pages against their recorded answers.
- Plans:
  - `docs/superpowers/plans/2026-10-06-rust-backend-1a-foundation.md`;
  - `docs/superpowers/plans/2026-10-07-rust-backend-1b-accounts.md`;
  - `docs/superpowers/plans/2026-10-18-rust-backend-1c-profile-privacy.md` (its « Rulings » section lists
    the choices the owner can change);
  - `docs/superpowers/plans/2026-10-18-rust-backend-2a-workouts-in.md`: rulings, and at the end « Built »,
    where the code departs from the plan;
  - `docs/superpowers/plans/2026-10-19-rust-backend-2b-points.md`: the same two sections;
  - `docs/superpowers/plans/2026-10-19-rust-backend-2c-goals-badges.md`: the same two sections, and a
    « Review focus » list;
  - `docs/superpowers/plans/2026-10-20-rust-backend-2d-league.md`: the same three sections;
  - `docs/superpowers/plans/2026-10-21-rust-backend-3a-friends-notifications.md`: the same three sections;
  - `docs/superpowers/plans/2026-10-21-rust-backend-3b-gyms.md`: the same three sections.
- CI: job `backend` in `.github/workflows/ci.yml`: fmt, Clippy, tests with MariaDB and Redis services,
  audit, deny.

## 4. Changes made this session (2026-10-21 to 23)

The previous session's list (plan 2d's review, plan 3a's commits, the `lock_pair` race fix) is in
`git show 4b27150:handoff.md`, §4.

- **Plan 3a's whole-branch review** (a fresh session, no agent; `38f66b7`): the five « Review focus » points hold.
  One cosmetic fix (`AppUser`'s doc comment). Three minors, the old API's too, left as they are (plan 3a's
  « Built » section). The ledger folder was deleted.
- `180e88b` and `3736439` merge `origin/main` (PRs #32 to #34) into the branch; `857a623`: plan 3b.
- Plan 3b, task by task: `eed6b57` (the tables), `4446ddc` (the directory, creation, profiles; the owner, from
  the working tree), `d3ccf4e` (memberships and coaches, the gym in `/me`, onboarding and profiles; the owner),
  `9c6f60a` (the dashboard), `716b13a`, `1348876`, `24b92c0` (the gym board, ranks, snapshot and badge; the
  owner), `fe4c1a8` (export, anonymisation, the security check, formatting), `c8a9ea5` (`.sqlx`; the owner), and
  the docs commit (README, the spec's status, the plan's « Built » section, this handoff).
- The owner merged PRs #35 and #36 (the branch up to `d3ccf4e`) into `main` during the session.
- `1d76c25`: `ctutils` 0.4.3 → 0.4.5 (RUSTSEC-2026-0385, non-constant-time comparisons, under `argon2` and
  `hmac`) and `tokio` 1.53.2 → 1.53.3 (RUSTSEC-2026-0386, unsound, which `cargo deny` refuses): two advisories
  published since the last check.
- **Checks (2026-10-23, native Windows):**
  - the whole suite in four chunks (`-j 2 --no-fail-fast`), on the code of `fe4c1a8`: **131 unit tests and 219
    integration tests green, 1 ignored** (the Windows skip), in 23 of 26 files. `me.rs` was rerun after a sleep
    of the PC broke its first run (§5). **Chunk 4 was stopped by Claude Code for low system memory** after
    `badges`, `goals`, `gyms` and `leaderboards`: `league`, `notifications` and `social` did not run on the final
    code. `league` (20) and `social` (10) passed earlier this session, before task 6's privacy change and the
    formatting; `notifications` last ran with plan 3a. Run those three first next session:
    `cargo test -j 2 --no-fail-fast --test league --test notifications --test social`;
  - after the dependency bump: `cargo audit` (264 crates) and `cargo deny check` clean, and the 131 unit tests
    green. The integration suites were not rerun after it (memory);
  - `cargo fmt --check`; Clippy `-D warnings`, online and with `SQLX_OFFLINE=true`, clean.

  Not done: plan 3b's whole-branch review (§0 step 2), a live run against the real binaries, and the mobile app
  against the Rust API.
- **The rulings part 3's spec took** (its « Rulings » section, for the owner's review):
  1. routes no frontend calls are left out (unblock, mutes, `/me/devices`, gym edit, others), and
     `GET /workouts/:id` stays owner-only: the app never opens another athlete's workout;
  2. push preferences are stored and served, but nothing is pushed until the app registers devices;
  3. the gym logo upload, the gym verification queue and the publishing of home news move to part 5, next to
     file storage and the admin panel;
  4. a notification's type is an ENUM of the 31 types the app knows;
  5. the live socket (plan 3c) speaks socket.io through `socketioxide`, a new crate, because the app uses
     `socket.io-client`; events cross processes through Redis pub/sub;
  6. social badge facts are awarded by the nightly badge sweep, as in the old API;
  7. a malformed id in a path answers 404, like an unknown one.
- **The rulings plan 3a took** (its « Rulings » section): friends by username, requests newest first; the
  search keeps the old reach (any active account with a profile); a block needs an existing account;
  `EMAIL_NOT_VERIFIED` as a new gate; the house's validation codes (`MINLENGTH`, not `ISLENGTH`); push
  preferences in six columns; anonymisation deletes friendships, follows, blocks and notifications (the old API
  kept them); the export's new keys; no snapshot, so no movement, on the friends board. And during the build
  (the « Built » section and the ledger): `Summary` filled by each query instead of `summaries(ids)`;
  `lock_pair`; `preferences::load` public; the notification list's shape check leaves the payload's keys out.
- **The rulings plan 3b took** (its « Rulings » section): social links in four columns; `level: 1`,
  `warRecord: null`, `rating: 1500` until gym wars (3d); no logo and no gym deletion until part 5; one pending
  submission and one live membership per athlete by unique generated columns (the old API counted first);
  membership changes as conditional `UPDATE`s (an approval of a withdrawn request is a 404; a leave racing an
  approval leaves the athlete out); `topAthletes` only athletes who show on leaderboards; audit entries name the
  athlete with the gym in `after`; anonymisation deletes memberships and pending gyms and leaves the others
  without an owner (the old API kept everything); the export's `gymMemberships` and `gyms`; the name checked once
  trimmed; the member list and the gym board answer for any gym id. And during the build (the « Built » section
  and the ledger): anonymisation also deletes the account's verification requests (their proof is free text);
  the slug by insert and retry; `contactEmail` normalised; `topAthletes` filtered on the opt-out only; the
  dashboard's 403 detail shared with the other management routes.

## 5. Traps (still true)

**Rust backend**
- **`cargo sqlx prepare` needs `DATABASE_URL` in its own environment.** `.cargo/config.toml` only applies to
  cargo's child processes. Use
  `DATABASE_URL=mysql://root:fl_root_dev@127.0.0.1:3307/fitness_league cargo sqlx prepare -- --all-targets`,
  then commit `.sqlx/`.
- **A new migration must be applied to the dev database before the macros compile:** `sqlx migrate run
  --source migrations --database-url mysql://root:fl_root_dev@127.0.0.1:3307/fitness_league`. Without
  `--database-url`, sqlx-cli reads `.env` and runs as `fl_app`, which may not create tables (« CREATE command
  denied »). Tests create their own databases and apply the migrations themselves.
- **`#[sqlx::test]` embeds the migrations at compile time.** After adding a migration file, touch a source file
  (`touch tests/schema.rs src/lib.rs`): a test binary that cargo does not rebuild still runs the old list and
  fails with « Table … doesn't exist ».
- **The sqlx macros read `apps/backend/.env` at compile time.** A value with spaces must be quoted, or every
  `query!` fails with « error reading dotenv file ».
- **An offline Clippy run can hit the cache** and check nothing: `touch src/lib.rs` before
  `SQLX_OFFLINE=true cargo clippy`.
- **Containers stopped after a PC restart, or after Docker Desktop's engine stopped mid-session.** It happened
  twice on 2026-10-19 and twice more on 2026-10-20 (overnight, and during a full test run). `docker ps` then
  says « failed to connect to the docker API », and the sqlx test harness panics in `testing/mod.rs`:
  - start `Docker Desktop.exe` and wait for `docker info`;
  - then `docker compose -f infra/docker-compose.yml up -d --wait mariadb redis mailpit`, from the repository
    root (the path is relative).

  Otherwise every `query!` reports « error communicating with database ». The dev data survives. It stopped
  three more times on 2026-10-20 and 21, once together with a low-memory episode.
- **A stuck test database.** After the engine stops in the middle of a test, a `#[sqlx::test]` can panic in
  `testing/mod.rs` with « Error dropping database (can't rmdir './_sqlx_test_…', errno: 39 "Directory not
  empty") ». The test database's name comes from the test's name, so the same test fails every time. Look inside
  the container (`docker exec fitness-league-mariadb-1 sh -c 'ls -la /var/lib/mysql/_sqlx_test_<name>'`): a
  stray `<table>.TRG-` file (an interrupted trigger drop) was the only file both times. Remove that file inside
  the container with `sh -c 'rm …'` (from Git Bash a bare path is rewritten to `C:/Program Files/Git/…`), and
  the harness drops the database on the next run.
- **The whole `cargo test` takes more than 10 minutes on Windows,** and a background run was stopped by Claude
  Code once for low system memory. Build first (`cargo test -j 2 --no-run`), then run it in the foreground in
  four chunks of about 6 test files each, with `-j 2` and `--no-fail-fast` so one failing binary does not hide
  the others. A chunk moved to the background by the 10-minute tool limit can outlive a sleep of the PC: on
  2026-10-22 `me.rs` then ran 19 hours and failed on « pool timed out » and 503 `TIMEOUT`. Rerun such a binary.
- **Native Windows build** (section 2 has the full environment line):
  - `CARGO_TARGET_DIR="$LOCALAPPDATA/fitness-league/target"` keeps the build out of OneDrive;
  - `AWS_LC_SYS_PREBUILT_NASM=1`, or `aws-lc-sys` asks for NASM;
  - `-j 4`: a build on all 16 threads was killed for lack of memory.
- **Windows takes 2 s to refuse a local connection** (Linux refuses at once). During a Redis outage every
  request therefore waits the 1 s timeout. `http_shell::a_redis_outage_does_not_stall_requests` is ignored on
  Windows only and runs in CI.
- **Docker Desktop's disk** (`%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx`) grows without shrinking. It
  filled the drive once. `docker builder prune` and `docker image prune` before it does.
- `#[sqlx::test]` leaves a `_sqlx_test_databases` table in the dev database: harmless.
- **Test data traps:**
  - e1RM values are kept to 2 decimals (3 × 5 × 100 gives 116.67);
  - two 60-minute workouts less than an hour apart are rejected as `OVERLAPPING_WORKOUT`;
  - after calibration, an exercise's first log is a calibration record, and its second is judged.
- **Library and language traps from earlier plans:**
  - serde fills a struct from a JSON array (`validate::parse` refuses non-objects);
  - sqlx reads `GROUP_CONCAT` as bytes (alias `AS "x?: String"`);
  - `EXISTS (...)` and `x IS NOT NULL` decode as integers (read `i64`, compare with `!= 0`);
  - DECIMAL needs `CAST(... AS DOUBLE)` to be read, or a string to be written exactly (`records::decimal`);
  - Axum 0.8 writes path parameters as `/{id}`; a malformed id answers 404, not 400 (plan 2a ruling);
  - serde_json compares `3` and `3.0` as different numbers: compare decimals in tests with `as_f64()`.
- **The Redis stall lesson (keep the fix):** `ConnectionManagerConfig::set_number_of_retries(0)` with 1 s
  timeouts. No deadline or pause of our own; the identity routes fail closed during an outage.
- **Rules for every new route:**
  - a per-address limit uses `ClientIp::subject()`, never the raw address;
  - every query on user-owned data carries the owner in its `WHERE`;
  - every organizer query uses `{ id, competitionId }`;
  - never log a database error message (MariaDB quotes values in it); use `db::describe`;
  - every XP or LP writer locks the athlete's `user_stats` row first (the weekly close, the season close and the
    reconcile do);
  - a job takes the clock as a parameter (`now`) and never reads `UTC_TIMESTAMP()` or `Utc::now()` itself, so
    the tests run it on a test clock.

**Tooling and hooks**
- **The owner commits the working tree during sessions**, sometimes mid-task (six commits this session, and
  two merges each way between the branch and `main`). A `git commit` that finds « nothing to commit » means that
  happened: check `git log`, and record the task against their commit.
- **The `security-audit` validators fail closed on native Windows.** `validate-findings.cjs` and
  `validate-coverage-ledger.cjs` need `O_NOFOLLOW` and `O_NONBLOCK`, which Node lacks there. They answer
  « OS no-follow and nonblocking input protection is unavailable », and 7 of the skill's 65 tests fail for
  that reason (46 pass, 12 skipped). This is their safety design, not a bug: don't patch it. Run a full audit
  from WSL, pointed at the Windows checkout (`/mnt/c/Users/moham/OneDrive/Desktop/Projects/fitness-League`),
  never at the stale WSL copy. Guidance mode is unaffected.
- **GateGuard refuses the first Edit or Write of every file once**, and the first Bash command of a session
  (twice this session: after the `/clear` and after a usage-limit pause). State the facts (importers, affected
  API, data, the user's words) and retry. It also blocks Bash commands that contain a recursive folder deletion
  or destructive-looking SQL, even inside a heredoc: write such text (a migration) with the Edit or Write
  tool. An append to a file (`cat >> file <<EOF`) is refused as destructive too: use Edit. `git checkout -- <file>` is blocked: restore with `git show HEAD:<path> > <path>`. Adding the
  repository to `GATEGUARD_EXEMPT_GLOBS` would remove the first-touch refusals (owner's call).
  - Only a Grep, Glob or LS call (or a shell `grep`/`find`) counts as the search it asks for. A Read does not.
  - It also wants the user's instruction verbatim, and the first Bash command of a session needs the request
    and the purpose of the command.
- **Glob or Grep from the repository root can time out** (20 s, because of `node_modules`). Give them a path
  such as `apps/backend` or `apps/api/src`, or use `ls`.
- **`pkill -f <pattern>` can kill the calling shell:** kill by PID (`ss -ltnp`).
- **RN app:**
  - run jest with `npx jest --maxWorkers=2`;
  - its lint is `tsc --noEmit`, and **never `npx expo lint`** (it installs ESLint and edits
    `package.json`);
  - the test `FakeBackend` cannot answer 204, so use `[200, {}]`;
  - never put awaited work inside an optional call's arguments (`after?.(await fn())` skips `fn`).
- **Prettier in `apps/admin`** only with `--single-quote --print-width 220`; the repository has no Prettier
  config.
- **Browser screenshots in WSL:** the cached `playwright-core` plus `chrome-headless-shell`, with `libnspr4`,
  `libnss3` and `libasound2t64` extracted into the scratchpad (`LD_LIBRARY_PATH`). Scroll and wait before a
  full-page shot (`loading="lazy"`).
- **`expo start` in WSL** logs a React Native DevTools `libnspr4.so` error: harmless.

## 6. Next steps

1. **The rest of plan 3b reaches `main`:** `feat/rust-backend-3`'s commits after `8dfc78f` are local. The user
   pushes them, then the owner merges (PRs #35 and #36 took the branch up to `d3ccf4e`).
2. **Plan 3b's whole-branch review** (§0 step 2), with the plan's « Review focus » list and the ledger's rulings.
3. **Plan 3c, feed and news** (with the socket), then 3d (gym WODs and gym wars), 3e (battles and duels) and 3f
   (challenges and leagues), each written once the previous one is built (§0 step 5 lists 3c's inputs).
4. **Owner's review of part 3's rulings** (§4, the spec's and plans 3a's and 3b's « Rulings » sections). The ones
   that depart from the old API's behaviour: anonymisation now deletes the social links, notifications, gym
   memberships, pending gyms and verification requests; a blocked or unknown account is checked before a block
   (404); writers of a link take the pair's lock; a gym's top athletes leave out those who hide from
   leaderboards.
5. **Part 4 must carry over PR #34:** the floor-judging routes the app now calls in on-site events, and the
   `COMPETITION_JUDGE_INVITED` notification type (add it to the `notifications.type` ENUM). Floor judging in the
   app sits beside the standing decision « judges work only in the admin panel »: read
   `docs/superpowers/specs/2026-10-21-floor-judging-design.md` before part 4's spec.
6. **Plan 2c's whole-branch review: done**, against the old API's `goals` and `badges` modules and the plan.
   Re-run after it: `--lib` and the `goals`, `badges`, `body`, `points`, `privacy`, `onboarding` and `schema`
   suites, 195 green. Two minors, left as they are:
   - `DELETE /goals/{id}` takes no lock. Sent at the instant a workout reaches a goal's last milestone, it can
     leave the goal `ABANDONED` with every milestone paid, and no `GOAL_COMPLETED` badge. The fix, if wanted:
     lock the `user_stats` row first, as the XP writers do.
   - A `HABIT` target is rounded to 2 decimals before the integer check (plan 2a ruling 1), so 3.004 is taken as
     3; the old API refused it.

   The onboarding test that was never seen red is sound: the code before it answered `goals: false` always, and
   the test asserts `true` after the first goal.
7. **Owner's review of the plan 2d rulings** (`git show 1cdb980:handoff.md` §4, and the plan's « Rulings » and
   « Built » sections). The ones that depart from the old API's behaviour: an athlete without a season joins
   only an active one; a season closes only once the week holding its end is closed (the review's fix).
8. **Owner's review of the plan 2c rulings** (the plan's « Rulings » section; listed in
   `git show 18e861e:handoff.md`, §4).
9. **Owner's review of the plan 2b rulings** (the plan's « Rulings » section): the `user_stats` lock that
   serialises one athlete's workouts; `workout_id` on XP entries; `bodyWeight` in `/me/progress` only with the
   consent; a malformed exercise id in the series answers 404; the baseline columns of plan 2d left for it;
   no activity events until part 3.
10. **Owner's review of the plan 2a rulings** (the plan's « Rulings » section):
   - decimals are rounded, not refused;
   - a sync batch checks each item on its own;
   - reading body measurements also needs the consent;
   - a malformed id answers 404;
   - no soft delete and no `data_source` on workouts.
11. **By hand:** point the mobile app at the Rust API (`EXPO_PUBLIC_API_URL=http://<this
   machine>:3100/api/v1`, with its origin in `CORS_ORIGINS`). Seed the database first: it is migrated to `0011`
   but empty. Run `backend worker` too, for the league's jobs. Plan 3a's screens (friends, search, profiles, the
   bell, the notification settings, the friends board) and plan 3b's (the gym directory, a gym's page, joining,
   the gym admin's requests and dashboard, the gym board) are not watched in the app yet either. Part 1's flow (register, onboarding, profile)
   passed over HTTP. Still to see in the app, the « Done when » of plans 2a to 2d:
   - the outbox flush (`workout-sync.ts`) gets `CREATED`, `REPLAYED`, `CONFLICT`, `REJECTED` and
     `INVALID` as it expects;
   - `BodyScreen` shows its consent screen on the 403 `CONSENT_REQUIRED`;
   - the workout screen's « Why these points » card lists the entries with their steps, including
     `GOAL_MILESTONE`; the progress screen shows before and now per metric, with its chart; the home screen's
     level bar moves;
   - the goals screen lists goals with their milestone bar; « Nouvel objectif » shows three suggestions and
     saves one; the badges screen shows earned badges and progress bars;
   - the home screen shows the national and governorate ranks and this week's score (`total`,
     `trainingDays/plannedDays`); the league screen lists the national and governorate boards with the movement
     arrows, and jumps to my rank.

   The tests cover them through the recorded shapes or their own assertions; nobody has watched them in the app
   yet.
12. **Rust backend, open points for the owner:**
   - **Plan 1c rulings:**
     - baseline values are rounded to 3 decimals, not refused;
     - a wrong password on `DELETE /me` counts toward the lock;
     - anonymised names are `deleted:<id>` / `deleted-<12 hex>`;
     - consents and baselines are kept after anonymisation;
     - a refresh token removed by the sweep (expired) no longer raises the reuse alarm.
   - **No screen opens the `/verify-email` and `/reset-password` links** (true of the old API too): the app
     or a small web page must.
   - Admin two-factor stays removed; it is the strongest protection still missing for staff accounts.
   - **Is a C library in the build acceptable?** aws-lc, through `jsonwebtoken`'s `aws_lc_rs` backend; it
     replaced the `rsa` crate that `cargo audit` flagged.
   - The secret scan cannot comment on PRs (read-only token). Say if that is wanted.
   - Registration is limited to 5 per hour per address; a gym's shared Wi-Fi can hit it.
   - **Deferred minors:**
     - `Retry-After` is slightly short;
     - `CORS_ORIGINS` is not validated at start;
     - the seed is not one transaction;
     - the `/ref` delta sync misses metric changes;
     - a panic response skips the security headers;
     - `fl_app` can write the reference tables;
     - no header-read timeout (a proxy is expected in front);
     - production provisioning of the database accounts and of the triggers under binary logging belongs
       to the cut-over.
   - **Part 4 (competitions) must carry over:**
     - the organizer rules: any user drafts, an admin publishes, publication request and return note;
     - the `{ id, competitionId }` scoping;
     - the `DRAFT` guard on publish-leaderboard;
     - the YouTube-only submission;
     - the `MOVEMENT_REPS` score.
13. **Organizer space, waiting for the owner:**
   - a creation limit per user per day on `POST /competitions` (spam drafts crowd the admin list);
   - cancellation by organizers (admins only today);
   - « Publier » silently wins when two admins act at once;
   - the « sur place » phase (check-in, waiver, lane scoring by judges, online payment, notifications for
     announcements and delays, competition logo), which needs backend;
   - who may publish the final leaderboard (head judge or admin today);
   - a real CSV file (`expo-sharing` + `expo-file-system`);
   - proposals from lot Web 2 (create forms in the side panel, notice card, inline-save setting cards, radio
     cards, « Voir tout »).
   - **Pre-existing old-API bug, not fixed:** `PUT /competitions/:id` without the four dates answers 422
     `BEFORE_START`. The app always sends the dates. Fix it in Rust part 4, or in `apps/api` if the owner
     asks.
   - **Deferred minors:**
     - lot B: the clock's hour-only « Suivant »; the lane picker without search; a batch-code error
       without a reason; « Déjà pris » on retry; errors left after « Retour »; refresh spinner flash; English
       plurals;
     - lot Web 1: two separate « Demander la publication » guards; badge vs dashboard « À encaisser »; the
       shared link is still `fitnessleague://…`.
   - To check on a phone: the 30 s reload pauses in the background.
14. **Before anything goes public:**
    - the default banner and the tutorial video show **Alamy watermarks**. Replace
      `apps/mobile-rn/assets/competition-cover.jpg` (about 1440×596), then re-render
      `apps/landing/public/media/tutorial.mp4`;
    - landing: WhatsApp number and store links in `apps/landing/src/config.ts`, a host and a domain, an
      absolute `og:image`;
    - a logo per competition (still the app icon);
    - the offline demo `assets/demo/api.json` was recorded before `MOVEMENT_REPS`: re-record it (it would also
      give real goal and badge shapes);
    - the tutorial voice-off is synthetic;
    - a full security audit of `apps/backend` (and of `apps/admin`), with the `security-audit` skill, from
      WSL, before the cut-over. Optional; only when the owner asks for it.
15. **Needs the owner's accounts or choices:**
    - online payment for competitions (Konnect, Stripe…);
    - push notifications (Firebase project + `google-services.json`);
    - EAS builds (Expo account);
    - regenerate the old API's dev JWT keys (`cd apps/api && pnpm keys:generate`; a `.env` read once printed
      their start).
16. **Optional cleanups:**
    - drop `competition_submissions.video_media_id` and `COMPETITION_VIDEO`;
    - rename `apps/mobile-rn` to `apps/mobile`;
    - delete the merged remote branches (`feat/competitions`, `feat/gyms-sports-mobile`, `feat/home-news`,
      `feat/landing`, `feat/organizer-space`, `feat/rn-ui-polish`, `feat/rust-backend`, `feat/rust-backend-2`),
      the local `feat/rust-backend`, `feat/rust-backend-2b` and `feat/gyms-sports-mobile`, and in the WSL copy
      `feat/rust-backend-1c` and the stray `feat/rust-backend-2`.
17. **Owner's other PC:** Expo answered « Cannot read properties of undefined (reading 'transformFile') ».
    Likely causes: the checkout in OneDrive, or `npm install` run inside `apps/mobile-rn` in a pnpm workspace.
    Advised: move it out of OneDrive, `pnpm install`, `npx expo start --clear`. The real line
    (`Failed to construct transformer: …`) is still awaited.
