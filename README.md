# Fitness League

*Compete with yourself. Challenge your friends. Represent your gym. Climb the League.*

A mobile app that turns real training progress into a fair competitive game: it rewards **progress, consistency and verified effort**, not absolute strength.
The name is configurable (`APP_NAME`).

- Architecture and decisions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Status: **Phase 1 (MVP) implemented**: API, mobile app and admin panel. See "What exists today" and "Not done yet" below.

## Repository layout

```
apps/api       NestJS API + worker (Prisma, PostgreSQL 16)
apps/admin     React admin panel (Vite + TypeScript)
apps/landing   Marketing site (Vite + React, EN/FR/AR), static build
apps/mobile-rn React Native app (Expo: Android, iOS; web build for previews)
apps/backend   Rust API on MariaDB + Redis; replaces apps/api part by part (in progress)
infra/         docker-compose + seed data (Tunisia, sports, exercises, rule set v1)
docs/          architecture document
```

## Run it locally

### Option A: Docker (one command)

Requires Docker Desktop (on Windows, enable *Settings → Resources → WSL integration*).

```bash
pnpm dev          # db, redis, minio, mailpit, api (migrations + seed run automatically)
```

API: http://localhost:3000/api/v1/health · Swagger: http://localhost:3000/api/docs · Mail UI: http://localhost:8025

### Option B: without Docker

Requires Node 22 and pnpm 10.

```bash
pnpm install
cp .env.example apps/api/.env      # then set DATABASE_URL to the embedded URL below
cd apps/api
pnpm keys:generate >> .env         # JWT signing keys
pnpm db:embedded                   # terminal 1: throw-away PostgreSQL 16 on port 55432
pnpm prisma:deploy && pnpm seed    # terminal 2: schema + seed data
pnpm dev                           # API on http://localhost:3000
```

On WSL, keep the repository on the Linux filesystem (`~/…`), not under `/mnt/c`: it is several times faster.

## Rust backend (in progress)

`apps/backend` is the API that will replace `apps/api`. Today it serves the health checks, the public
reference lists and accounts (plan 1b): registration, sign-in with lockout, sessions with single-use
refresh tokens, email verification and password reset through links, the admin panel's sign-in, and
`GET /me`; and the profile (plan 1c): profile and settings changes, onboarding, the data export, and
account deletion after a 30-day grace period, carried out by the worker's daily sweep. Part 1 of the spec
is complete. Part 2 (training loop) is under way. Plan 2a takes workouts in: `POST /workouts`,
`POST /workouts/sync` for the app's offline queue, `GET /workouts` and `GET /workouts/{id}`, checked by
anti-cheat layer 1. It also adds `GET` and `POST /me/body-measurements`, stored encrypted and only with the
`HEALTH_DATA` consent. Plan 2b scores an accepted workout in the transaction that saves it: records,
calibration, the append-only XP ledger with its daily and weekly caps, the level, the daily streak and the
first quest. The app reads them through `GET /workouts/{id}/points`, `GET /me/records`, `GET /me/progress`
and `GET /me/progress/metrics/{exerciseId}/{metricCode}`. Plan 2c adds goals: `GET` and `POST /goals`,
`POST /goals/suggestions` and `DELETE /goals/{id}`, with milestones that workouts and weigh-ins reach, safe
pacing for body-weight goals (their values encrypted), and the onboarding `goals` step. It also adds badges:
`GET /badges` lists the catalogue with the athlete's progress, and badges are awarded in the same
transactions. Plan 2d adds the league: `GET /me/weekly-scores/current` (the running week's provisional score),
`GET /me/lp`, `GET /me/ranks`, and the national and governorate leaderboards (`GET /leaderboards/national`,
`/leaderboards/governorates/{id}`, each with `/me`). The worker closes each week into its final score and its
League Points (with the baseline audit, the weekly streak and the habit goals), opens and closes seasons with a
soft reset, finalizes calibrations, sweeps badges, snapshots the ranks for the movement arrows and reconciles the
balances, each job once per key through `job_runs`. Part 2 is complete. Part 3 (gyms and social) is under way.
Plan 3a adds friends: `GET /friends`, `GET` and `POST /friends/requests`, `POST /friends/requests/{userId}/accept`
and `/decline`, `DELETE /friends/{userId}`, follows (`POST` and `DELETE /follows/{userId}`) and blocks
(`POST /blocks/{userId}`), the athlete search (`GET /search/athletes`) and public profiles
(`GET /users/{username}`). It also adds the bell: `GET /notifications` and `POST /notifications/read`, written for
friend requests, acceptances and every badge awarded; push preferences (`GET` and `PUT
/me/notification-preferences`); and the friends leaderboard (`GET /leaderboards/friends`, with `/me`), which
`GET /me/ranks` now reads. Plans 3b to 3f (gyms, feed and news, gym WODs and wars, battles and duels, challenges
and leagues) come next, then parts 4 to 6 (competitions, admin, cut-over).

One-time setup (Rust 1.99 through `rustup`, Docker for MariaDB, Redis and Mailpit):

```bash
docker compose -f infra/docker-compose.yml up -d mariadb redis mailpit
cd apps/backend
cp .env.example .env
cargo run -q -- keys >> .env
printf 'APP_HMAC_SECRET=%s\n' "$(openssl rand -base64 48)" >> .env
printf 'HEALTH_DATA_KEYS=k1:%s\n' "$(openssl rand -base64 32)" >> .env   # encrypts body measurements
cargo run -- migrate
cargo run -- seed ../../infra/seed-data
```

Then `cargo run -- serve` listens on http://localhost:3100/api/v1 and `cargo test` runs the test suites.

```bash
cargo run -- worker                                   # sends the emails; run one next to the API
cargo run -- promote someone@example.com ADMIN        # the first staff account; roles are never self-assigned
```

The emails go to Mailpit locally: http://localhost:8025.

- **Database accounts.** `fl_migrate` owns the schema and is used only by `migrate`. The API uses `fl_app`,
  which can read and write rows but cannot change the schema; the audit log refuses updates and deletes
  for everyone.
- **SQL is checked at compile time.** After changing a query, run `cargo sqlx prepare` and commit `.sqlx/`.
- **If the repository is in a synced folder** (OneDrive, Dropbox), set
  `CARGO_TARGET_DIR="$HOME/.cache/fitness-league/target"` so the build output stays outside it.
- **Native Windows** (not WSL) needs the Visual Studio C++ Build Tools and `AWS_LC_SYS_PREBUILT_NASM=1`, so
  `aws-lc-sys` uses its prebuilt assembly instead of asking for NASM. On a machine with 16 GB of memory or
  less, build with `-j 4`.
- **`HEALTH_DATA_KEYS`** is a list of `id:base64(32 bytes)` separated by commas. The first key encrypts and
  every key decrypts, so to rotate, put the new key first and keep the old ones.

## Tests

```bash
cd apps/api
pnpm test:unit          # pure logic, no database
pnpm test:integration   # real PostgreSQL 16 (embedded automatically, or TEST_DATABASE_URL)
pnpm lint && pnpm typecheck
```

Integration tests only run `prisma migrate deploy` on a fresh database; they never reset an existing one.

## Admin panel

```bash
cd apps/api && pnpm promote-admin you@example.com SUPER_ADMIN   # after registering in the app
cd apps/admin && pnpm dev                                        # http://localhost:5173 (proxies /api to :3000)
```

Staff sign in with email and password (no second factor).

### Media storage

`STORAGE_DRIVER=local` (default) keeps files in `apps/api/storage/` and serves them at `/api/v1/media/...`;
`STORAGE_DRIVER=s3` uses `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. `MEDIA_PUBLIC_BASE_URL` is the
public base of stored files (CDN in production).

### Demo data

With the API running: `cd apps/api && pnpm demo-data` (idempotent). Athletes `ahmed`, `yassine`, `nour`, `sami`,
`karim` `@demo.fitnessleague.test`, password `demo-password-2026`. `ahmed` owns and coaches the fictional gym
**Bodynade** (Tunis), with an open WOD and a past one; 8 fictional gyms have generated logos.

## Landing page

```bash
pnpm --filter @fitness-league/landing dev       # http://localhost:5174
pnpm --filter @fitness-league/landing build     # static site in apps/landing/dist
```

Contact address, WhatsApp number and store links: `apps/landing/src/config.ts`. Photo credits: `apps/landing/CREDITS.md`.

## Mobile app

See [`apps/mobile-rn/README.md`](apps/mobile-rn/README.md) (`npx expo run:android`, or `pnpm web` for a browser preview).

## What exists today

| Area | Status |
|---|---|
| Foundation: env validation, problem+json errors, signed cursor pagination, PII-redacted logs, schema with append-only ledgers, idempotent seed (Tunisia) | Done, tested |
| Auth: register (age gate, consents), login + lockout, rotating refresh tokens with reuse detection, email verification, password reset, Google/Apple sign-in | Done, tested |
| Users: profile, settings, onboarding, encrypted health data, export, deletion with anonymisation | Done, tested |
| Workouts: idempotent logging, offline batch sync, layer-1 anti-cheat, held-workout moderation | Done, tested |
| Scoring: fairness model, calibration, anti-sandbagging (incl. baseline correction + reversal), PRs, XP caps/diminishing returns, ledgers with reversals | Done, tested |
| Goals and suggestions (safe weight pace, habit goals with rest days) | Done, tested |
| Weekly LP, divisions, seasons (soft reset), leaderboards (national/region/gym/friends), scheduled jobs | Done, tested |
| Gyms: directory, verification, memberships | Done, tested |
| Friends, blocks, search, public profiles, Friend Battles, in-app notifications | Done, tested |
| Admin API (email + password sign-in, RBAC, rule sets with dry run, seasons, catalog, audit, ledger adjustments) + React panel | Done, tested |
| Media storage (local disk in dev, S3/MinIO in prod), gym logos (PNG/JPEG/WebP ≤ 2 MB → 512×512 WebP) | Done, tested |
| Gym directory: sports offered, accent-insensitive search, sort by members; owners submit a gym with a photo, staff approve it | Done, tested |
| CrossFit & Hyrox: movements, benchmark WODs (Fran, Murph, Cindy…), Hyrox race and stations, `FINISH_TIME` records, timed anti-cheat bounds, rule set v2 | Done, tested |
| Gym coaches and coach-made WODs (for time / AMRAP / max load, Rx/Scaled boards, invalidation reverses XP) | Done, tested |
| Mobile app: all screens (gyms, WODs, CrossFit/Hyrox logging, friends, battles, notifications, records, body, settings), redesigned UI (Barlow Condensed + Inter), fr/en/ar RTL | Done, widget tested; web preview verified at 390×844 |
| Weekly Duels: opt-in queue (Friday → Monday noon), Glicko-2 matchmaking, ghost duel when unmatched, MMR on close; mobile card and duel screen | Done, tested |
| Gym Wars: weekly auto-enrolment (gym admin can opt out), S/M/L brackets, Glicko-2 gym rating, size-neutral score (top-K, participation, progress, consistency), winners' XP; mobile war screen, gym record, battles card | Done, tested |
| Badges: data-driven rules (counts, level, division, weekly streaks), awarded on events + daily sweep, 21-badge catalogue; mobile collection with progress | Done, tested |
| Challenges: personal / friends / gym (admin, coaches) / community (staff), 5 workout quantities, live progress from workouts, XP for gym and community ones, optional weekly-score challenge component (`challenge_component`); mobile tab, detail, leaderboard, creation | Done, tested |
| Private and public leagues: invite code (rate-limited), member cap, ranking on summed weekly totals / consistency / progress over the period; mobile Leagues tab, detail, creation | Done, tested |
| Activity feed: friends' activity (visibility, blocks, mutes, deleted workouts hidden), one reaction per athlete (👍 🔥 💪), comments (author or activity owner deletes), notifications; mobile feed with comments sheet | Done, tested |
| Push notifications: every notification goes through the outbox to FCM HTTP v1 (`PUSH_DRIVER=fcm`, service account, no SDK) or a log driver; devices API, per-category switches, quiet hours (Africa/Tunis), dead tokens dropped; mobile settings section. The app does not register its FCM token yet (needs a Firebase project and `google-services.json`) | Done, tested (API) |
| Real time: Socket.IO `/ws` (access-token auth, session version checked), `notification.new` to the recipient, `battle.score` to battle participants; events relayed from the worker through PostgreSQL LISTEN/NOTIFY (no Redis); mobile bell and battle screen update live, polling kept as fallback | Done, tested |
| Admin score recompute: SUPER_ADMIN re-scores closed weeks of the running season with the active rule set (dry run first, reversal + new ledger entries, audited); admin panel form with preview | Done, tested |
| Workout proofs: up to 3 photos/screenshots per workout, re-encoded WebP without EXIF/GPS, private (athlete + moderators); moderator queue (admin panel) verifies or rejects with a note; verified workouts raise the performance component (`verified_weight_multiplier`); Gym War verified ratio behind `gym_war.use_verified_ratio`; mobile proof section on the workout | Done, tested |
| Moderation: reports on athletes, workouts, comments and gyms; moderator decisions (dismiss, warn, suspend N days; bans for admins) that sign the athlete out; appeals once, from the app for warnings or through a signed link emailed with a suspension/ban; a different moderator decides; public anonymised moderation log; admin panel queue; report sheet in the app | Done, tested |
| Behavioural anti-cheat: weekly scan after the close (score > 3σ above own history, minimum-duration farming, accounts sharing an install that meet in battles, friends alternating battle wins) raising flags only; moderators clear or confirm them in the admin panel | Done, tested |
| Gym admin dashboard: members and requests, active 7/28 days, 8-week trend, top progress, members to nudge (14 days without a workout), WOD participation, war record; mobile screen from the gym profile | Done, tested |
| Competitions: organizers create events (price, per-category price, the 18 category templates, coupons FREE / % / fixed), a banner per competition uploaded from the admin panel (replaced for each new event or final), WODs with direct or placement points (including WODs scored by the app from the reps of each movement × its points per rep, the athlete never types the score), prizes, judges and heats; athletes register (eligibility, capacity, deadlines checked by the server) and submit each score with the **YouTube link** of their video (required to submit); judge space in the **web admin panel** for judge-only accounts (`JUDGE` / `HEAD_JUDGE`, generated by admins, refused by the app so judges never compete or score): by athlete (each athlete's completed WODs with their links) or by status (approve, reject, penalty, adjust, versioned history), and head judges manage the judges and head judges of their competitions; TOTAL = sum of the WOD points, leaderboard recomputed on every change, tie-breaks, final lock, podium; organizer section in the admin panel. No online payment provider yet: organizers mark paid registrations by hand | Done, tested |
| Organizer space (2026-10-14): any app user creates an event as a draft (Compétitions → « Créer un événement »), prepares it in the app (dashboard with the publication checklist and the registrations per category, women / men and per day; general info and banner; categories; WODs with a version per category and a release date) and asks for publication; an admin publishes it or sends it back with a note (admin panel → Compétitions). Then the organizer runs it from the app: planning (heats, lanes, automatic heats, clock of the day, « Retard » that moves the heats not started and posts an announcement), participants (search, « À encaisser », mark paid with a receipt to share, CSV), team (co-organizers; judges stay in the admin panel), leaderboard (read only: the head judge publishes it from the admin panel), announcements (shown on the event page, no notification) and promo codes (one or a batch, top 5, activate) On a computer (browser window of 1024 px or more) the organizer space has its own layout: a left menu grouped like the Circle21 portal, a top bar with the status, « Aperçu », « Demander la publication » and « Partager », a centered column, an « Exporter (CSV) » button on every list (a downloaded file) and empty pages that point to what must be done first. On a computer the organizer space now looks like a desktop back-office (lot Web 2): dense flat cards, a compact top bar, an icon menu, a header row on every page; an overview with KPI rows, registrations per day, top categories, a scores ring and gender in % or numbers; a Finances page (gross, discounts, collected, to collect, free, refunded, transactions); participants as a table with a light side panel (payment, heats and lanes, receipt) and « Marquer payé » for several at once; Heats and « Horaire du jour » (live clock, current heat, progress ring) as separate pages. Lot Web 3, on phones and computers: a short message after every change, grey placeholders while lists load, Heats, « Horaire du jour » and the leaderboard read their data again every 30 s while they are on screen (a failed reload keeps the page), a leaderboard search and one export file per category, and promo codes that switch at once (put back if the server refuses). On a computer only: a focus ring after a key press, 24 px targets, a readable light palette and screen-reader names on the panel, switches and chart. | Lots A and B + web lots 1 to 3 done, tested |
| Docker images / compose, CI | Written, not yet run (no Docker locally; CI runs on the next push) |

## Not done yet

- Run Docker compose and CI once for real.
- Competitions: online payment (no provider connected; organizers mark registrations as paid).
- Phase 2: mobile FCM token registration (needs a Firebase project), live leaderboard moves, phone verification by SMS.
- Phase 3: video proofs (needs a transcoding pipeline: ffprobe/ffmpeg).
- Phase 4: integrations (watches, apps), coach tools, billing.

See `docs/ARCHITECTURE.md` §4.5 for the planned endpoints.

## Security notes

- No secrets in the repository: only `.env.example`. CI runs gitleaks.
- Client-sent points are refused: every request DTO rejects unknown fields (`forbidNonWhitelisted`).
