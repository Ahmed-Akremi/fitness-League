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
apps/mobile    Flutter app (Android, iOS; web build for previews)
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

See [`apps/mobile/README.md`](apps/mobile/README.md) (`flutter pub get`, `build_runner`, `gen-l10n`, `flutter run`).

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
| Docker images / compose, CI | Written, not yet run (no Docker locally; CI runs on the next push) |

## Not done yet

- Run Docker compose and CI once for real.
- Phase 2: Gym Wars, private leagues, challenges, badge engine, activity feed (reactions, comments), push notifications (FCM), real-time WebSocket, phone verification by SMS, admin score recompute job.
- Phase 3: workout proofs (photo/video) and verified scoring, behavioural anti-cheat, reports, sanctions and appeals, gym admin dashboard.
- Phase 4: integrations (watches, apps), coach tools, billing.

See `docs/ARCHITECTURE.md` §4.5 for the planned endpoints.

## Security notes

- No secrets in the repository: only `.env.example`. CI runs gitleaks.
- Client-sent points are refused: every request DTO rejects unknown fields (`forbidNonWhitelisted`).
