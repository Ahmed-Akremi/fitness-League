# Handoff — fitness-league (2026-10-19: Rust backend plan 2a built, merged in PRs #15 and #16)

Earlier handoffs are in git: `git show 61b7787:handoff.md` (the full history since 2026-10-04) and
`git show 02a732e:handoff.md` (part 1 complete). This one keeps what is still true and still to do.

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
2. Training loop: **in progress**. Plan 2a is done; plans 2b to 2d come next.
3. Gyms and social.
4. Competitions.
5. Admin and moderation.
6. Cut-over: demo data, frontends pointed at Rust, `apps/api` and PostgreSQL removed.

Spec of part 1 (also the frame of every part):
`docs/superpowers/specs/2026-10-06-rust-backend-foundation-design.md`.
Spec of part 2: `docs/superpowers/specs/2026-10-18-rust-backend-training-loop-design.md`. It covers 22 app
endpoints in plans 2a to 2d, and its « Rulings » section lists the choices the owner can change.

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

- **`main`** is at `02a732e`. Merged so far:
  - #13 and #14: part 1;
  - #15: the part 2 spec, plan 2a and its code;
  - #16: formatting, the Windows build, and the README, spec and plan updates.
- **Local branch `feat/rust-backend-2`** tracks `origin/main` and holds this session's last commit (not
  pushed). The owner commits and merges through PRs, sometimes during a session: run `git log` before
  building on the branch.
- **Rust backend, part 1 complete and plan 2a built.** 32 endpoints. Plan 2a's six:
  - `POST /workouts` and `POST /workouts/sync`: idempotent on `clientId`, checked by anti-cheat layer 1
    (the old `rules.ts`, rule for rule, with rule set v2's thresholds);
  - `GET /workouts` (newest first, signed keyset cursor) and `GET /workouts/{id}`;
  - `GET` and `POST /me/body-measurements`: AES-256-GCM through `HEALTH_DATA_KEYS`, behind the
    `HEALTH_DATA` consent.

  The export carries workouts and weigh-ins. Anonymisation deletes the weigh-ins and clears the workout
  notes, making the workouts private.
- **Part 1's 26 endpoints:**
  - health and readiness;
  - the four `/ref` lists;
  - `/auth`: register, login, refresh, logout, verify, resend, forgot, reset;
  - `/me`: `GET`, `PATCH /me/profile`, `PATCH /me/settings`, the three onboarding steps, `GET /me/export`
    (3 a day), `DELETE /me`;
  - the four `/admin/auth` and `/admin/me` routes.
- **Worker:** sends the emails and runs the **daily sweep**. Once per business day (Redis key `sweep:<day>`)
  it anonymises accounts whose 30-day grace is over and deletes expired tokens.
- **CLI:** `backend promote <email> <role>` creates the first staff account.
- **Last checks (2026-10-19, native Windows):** see section 4.
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
  - Docker Desktop's data was reset on 2026-10-19. The disk had filled up, with `docker_data.vhdx` at 72 GB.
    The MariaDB (host port 3307), Redis and Mailpit containers are **running**. The dev database is migrated
    to `0006` but **not seeded** (`cargo run -- seed ../../infra/seed-data`).
  - `apps/backend/.env` holds dev keys, including `HEALTH_DATA_KEYS` (git-ignored, never printed).
  - No API process is running.
- **`gh` is not on the PATH, on Windows or in WSL's default shell.** Pushing and PRs go through the owner,
  who has been merging them.
- **Other apps, unchanged this session.** Last runs:
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
  - `0006_workouts`:
    - `workouts`, `workout_exercises`, `workout_sets` and `workout_evaluations`;
    - `body_measurements`, with the values encrypted in `VARBINARY`.
- `src/main.rs`: subcommands `serve`, `worker` (job loop plus the sweep every 10 min, 1 min after a failure),
  `migrate`, `seed [dir]`, `promote`, `keys`.
- Infrastructure:
  - `config.rs`, `error.rs` (problem+json, `AppError`);
  - `validate.rs`:
    - `Check` (with `within` for decimals), `ValidJson`, `valid`;
    - `normalise_email`, `nullable`, `readable_name`;
    - `rfc3339`, `round_to`;
  - `db.rs`: session settings, `duplicate_key`, `describe`;
  - `state.rs`, `types.rs`: `Role`, `Gender`, `Locale`, `Theme`, `Visibility`, `ExperienceLevel`, `iso`;
  - `rules.rs`: the active rule set and its `version`:
    - `min_age_years`, `level_titles`, `calibration_days`;
    - the e1RM formula, `late_log_max_hours`;
    - `anticheat` (every threshold of v2).
  - `audit.rs`, `jobs.rs` (the Redis Stream queue), `mail.rs`, `seed.rs`.
- `src/http/`:
  - `mod.rs`: `Api` route builder, middleware, `route_table()`;
  - `auth.rs`: the `AppUser` and `PanelUser` extractors;
  - `rate_limit.rs`: every limit of the spec, `ClientIp::subject()`;
  - `page.rs`: the signed keyset cursor (`encode`, `decode`, `limit`, `page`). Parts 2 to 5 reuse it for
    every list.
- `src/security/`:
  - `password.rs` (Argon2id, NFKC, hashing cap);
  - `tokens.rs` (Ed25519 JWT, opaque tokens);
  - `policy.rs` (lockout, age, business day, `business_day_start`);
  - `health.rs`: `HealthCipher`, AES-256-GCM. Rows carry the key id, and the first key in
    `HEALTH_DATA_KEYS` encrypts.
- `src/modules/`:
  - `health.rs`, `reference.rs`, `admin_auth.rs`;
  - `auth/{mod,accounts,sessions,emails}.rs`;
  - `me/mod.rs`: `GET /me`, profile, settings, `payload`;
  - `me/onboarding.rs`;
  - `me/privacy.rs`: export, `DELETE /me`, `daily_sweep`, `sweep`, `anonymise`;
  - `me/body.rs`: body measurements, `has_consent`, `latest_weight_kg` (`None` without the consent);
  - `workouts/`:
    - `mod.rs`: routes, the sync batch, the list;
    - `intake.rs`: `create`, which hashes, replays, evaluates and stores in one transaction. Plan 2b scores
      inside it, at the marked comment. Also `load` and `one`, which give the app's JSON;
    - `metrics.rs`: e1RM, volume, distance, fingerprint;
    - `anticheat.rs`: layer 1, pure.
- `tests/`:
  - `common/mod.rs`: `TestApp`, `seeded`, `register`, `create_user`, `open_session`,
    `seeded_with_cuttable_redis`, `deliver_mail`, `assert_same_shape`, `set_consent`;
  - suites: `schema`, `http_shell`, `rate_limit`, `reference`, `jobs`, `mail`, `emails`, `sessions`,
    `register`, `login`, `admin_auth`, `me`, `profile`, `onboarding`, `privacy`, `security`, `body`,
    `workouts`.
  - `security.rs` holds `PUBLIC`, the 14 routes that answer without a session. **A new public route must be
    added there**; any other new route must answer 401 without a token, or the suite fails. Its role walker
    counts a 403 as a refusal only when the code is `FORBIDDEN`, so `CONSENT_REQUIRED` is not one.
  - `workouts.rs` checks the list against the shape recorded from the old API
    (`apps/mobile-rn/assets/demo/api.json`).
- Plans:
  - `docs/superpowers/plans/2026-10-06-rust-backend-1a-foundation.md`;
  - `docs/superpowers/plans/2026-10-07-rust-backend-1b-accounts.md`;
  - `docs/superpowers/plans/2026-10-18-rust-backend-1c-profile-privacy.md` (its « Rulings » section lists
    the choices the owner can change);
  - `docs/superpowers/plans/2026-10-18-rust-backend-2a-workouts-in.md`: rulings, and at the end « Built »,
    where the code departs from the plan.
- CI: job `backend` in `.github/workflows/ci.yml`: fmt, Clippy, tests with MariaDB and Redis services,
  audit, deny.

## 4. Changes made this session (2026-10-18 and 19, on `feat/rust-backend-2`)

- `9c34df4`: the part 2 spec. `e7aad6f`: plan 2a.
- `9c93625` (committed by the owner): plan 2a's code, tasks 1 to 7.
- `24d0679` (committed by the owner):
  - `cargo fmt`;
  - `main.rs::shutdown` builds on Windows (Ctrl-C only; `tokio::signal::unix` is Unix-only);
  - README, spec status, the plan's « Built » section.
- Merged through PRs #15 and #16. `main` is at `02a732e`.
- Last commit (local, not pushed):
  - the Windows-only ignore of the Redis outage test;
  - this handoff;
  - `.sqlx/` regenerated.
- **Checks (2026-10-19, native Windows, after the last commit's changes):**
  - `cargo test`: 234 green, 1 ignored (the Windows skip). That is 98 unit tests, plus 136 integration
    tests in 18 files;
  - `cargo fmt --check`;
  - Clippy `-D warnings`, online and with `SQLX_OFFLINE=true`;
  - `cargo audit` (264 crates) and `cargo deny check`.

  Not done this session: a live run against the real binaries, and the mobile app against the Rust API.

## 5. Traps (still true)

**Rust backend**
- **`cargo sqlx prepare` needs `DATABASE_URL` in its own environment.** `.cargo/config.toml` only applies to
  cargo's child processes. Use
  `DATABASE_URL=mysql://root:fl_root_dev@127.0.0.1:3307/fitness_league cargo sqlx prepare -- --all-targets`,
  then commit `.sqlx/`.
- **A new migration must be applied to the dev database before the macros compile:** `sqlx migrate run
  --source migrations` with that same URL. Tests create their own databases and apply the migrations
  themselves.
- **The sqlx macros read `apps/backend/.env` at compile time.** A value with spaces must be quoted, or every
  `query!` fails with « error reading dotenv file ».
- **An offline Clippy run can hit the cache** and check nothing: `touch src/lib.rs` before
  `SQLX_OFFLINE=true cargo clippy`.
- **Containers stopped after a PC restart, or after Docker Desktop's engine stopped mid-session** (twice on
  2026-10-19; `docker ps` then says « failed to connect to the docker API »):
  - start `Docker Desktop.exe` and wait for `docker info`;
  - then `docker compose -f infra/docker-compose.yml up -d --wait mariadb redis mailpit`.

  Otherwise every `query!` reports « error communicating with database ». The dev data survives.
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
- **Library and language traps from earlier plans:**
  - serde fills a struct from a JSON array (`validate::parse` refuses non-objects);
  - sqlx reads `GROUP_CONCAT` as bytes (alias `AS "x?: String"`);
  - `EXISTS (...)` decodes as an integer (compare with `!= 0`);
  - DECIMAL needs `CAST(... AS DOUBLE)` to be read, or a string to be written exactly;
  - Axum 0.8 writes path parameters as `/{id}`; a malformed id answers 404, not 400 (plan 2a ruling).
- **The Redis stall lesson (keep the fix):** `ConnectionManagerConfig::set_number_of_retries(0)` with 1 s
  timeouts. No deadline or pause of our own; the identity routes fail closed during an outage.
- **Rules for every new route:**
  - a per-address limit uses `ClientIp::subject()`, never the raw address;
  - every query on user-owned data carries the owner in its `WHERE`;
  - every organizer query uses `{ id, competitionId }`;
  - never log a database error message (MariaDB quotes values in it); use `db::describe`.

**Tooling and hooks**
- **GateGuard refuses the first Edit or Write of every file once.** State the facts (importers, affected API,
  data, the user's words) and retry. It also blocks Bash commands that contain a recursive folder deletion or
  destructive-looking SQL, even inside a heredoc: write such text with the Edit or Write tool. `git checkout
  -- <file>` is blocked: restore with `git show HEAD:<path> > <path>`. Adding the repository to
  `GATEGUARD_EXEMPT_GLOBS` would remove the first-touch refusals (owner's call).
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

1. **Plan 2b, points.** Write the plan from the spec's plans table in the house style of plan 2a, then build
   it. Scope:
   - observations, calibration, PRs;
   - the XP ledger, caps and levels;
   - the daily streak and the first quest;
   - `GET /workouts/{id}/points`, `/me/records`, `/me/progress` and its metric series;
   - the stats and streak in `GET /me`.

   Scoring goes inside `intake::create`'s transaction, at the comment that marks it. The old API is the
   contract: `apps/api/src/modules/{scoring,ledger,progress}`. Then **2c** (goals and badges) and **2d**
   (league). Each plan extends `GET /me/export` and `anonymise` for its own tables.
2. **Owner's review of the plan 2a rulings** (the plan's « Rulings » section):
   - decimals are rounded, not refused;
   - a sync batch checks each item on its own;
   - reading body measurements also needs the consent;
   - a malformed id answers 404;
   - no soft delete and no `data_source` on workouts.
3. **By hand:** the mobile app pointed at the Rust API (`EXPO_PUBLIC_API_URL=http://<this
   machine>:3100/api/v1`, its origin in `CORS_ORIGINS`) registers, finishes onboarding and shows its profile.
   The same flow passed over HTTP.
4. **Rust backend, open points for the owner:**
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
5. **Organizer space, waiting for the owner:**
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
6. **Before anything goes public:**
   - the default banner and the tutorial video show **Alamy watermarks**. Replace
     `apps/mobile-rn/assets/competition-cover.jpg` (about 1440×596), then re-render
     `apps/landing/public/media/tutorial.mp4`;
   - landing: WhatsApp number and store links in `apps/landing/src/config.ts`, a host and a domain, an
     absolute `og:image`;
   - a logo per competition (still the app icon);
   - the offline demo `assets/demo/api.json` was recorded before `MOVEMENT_REPS`: re-record it;
   - the tutorial voice-off is synthetic.
7. **Needs the owner's accounts or choices:**
   - online payment for competitions (Konnect, Stripe…);
   - push notifications (Firebase project + `google-services.json`);
   - EAS builds (Expo account);
   - regenerate the old API's dev JWT keys (`cd apps/api && pnpm keys:generate`; a `.env` read once printed
     their start).
8. **Optional cleanups:**
   - drop `competition_submissions.video_media_id` and `COMPETITION_VIDEO`;
   - rename `apps/mobile-rn` to `apps/mobile`;
   - delete the merged remote branches (`feat/competitions`, `feat/gyms-sports-mobile`, `feat/home-news`,
     `feat/landing`, `feat/organizer-space`, `feat/rn-ui-polish`) and the local `feat/rust-backend-1c`.
9. **Owner's other PC:** Expo answered « Cannot read properties of undefined (reading 'transformFile') ».
   Likely causes: the checkout in OneDrive, or `npm install` run inside `apps/mobile-rn` in a pnpm workspace.
   Advised: move it out of OneDrive, `pnpm install`, `npx expo start --clear`. The real line
   (`Failed to construct transformer: …`) is still awaited.
