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
apps/mobile-rn React Native app (Expo: Android, iOS; web build for previews)
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

First sign-in enrols an authenticator app (TOTP is mandatory for staff).

### Media storage

`STORAGE_DRIVER=local` (default) keeps files in `apps/api/storage/` and serves them at `/api/v1/media/...`;
`STORAGE_DRIVER=s3` uses `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. `MEDIA_PUBLIC_BASE_URL` is the
public base of stored files (CDN in production).

### Demo data

With the API running: `cd apps/api && pnpm demo-data` (idempotent). Athletes `ahmed`, `yassine`, `nour`, `sami`,
`karim` `@demo.fitnessleague.test`, password `demo-password-2026`. `ahmed` owns and coaches the fictional gym
**Bodynade** (Tunis), with an open WOD and a past one; 8 fictional gyms have generated logos.

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
| Admin API (2FA, RBAC, rule sets with dry run, seasons, catalog, audit, ledger adjustments) + React panel | Done, tested |
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
| Docker images / compose, CI | Written, not yet run (no Docker locally; CI runs on the next push) |

## Not done yet

- Run Docker compose and CI once for real.
- Phase 2: mobile FCM token registration (needs a Firebase project), live leaderboard moves, phone verification by SMS.
- Phase 3: video proofs (needs a transcoding pipeline: ffprobe/ffmpeg).
- Phase 4: integrations (watches, apps), coach tools, billing.

See `docs/ARCHITECTURE.md` §4.5 for the planned endpoints.

## Security notes

- No secrets in the repository: only `.env.example`. CI runs gitleaks.
- Client-sent points are refused: every request DTO rejects unknown fields (`forbidNonWhitelisted`).
