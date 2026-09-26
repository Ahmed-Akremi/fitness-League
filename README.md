# Fitness League

*Compete with yourself. Challenge your friends. Represent your gym. Climb the League.*

A mobile app that turns real training progress into a fair competitive game: it rewards **progress, consistency and verified effort**, not absolute strength.
The name is configurable (`APP_NAME`).

- Architecture and decisions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Status: **Phase 1 (MVP): modules 1–2 of 12 done** (foundation; auth + users + reference). See "What exists today" below.

## Repository layout

```
apps/api       NestJS API + worker (Prisma, PostgreSQL 16)
apps/admin     React admin panel            (not started)
apps/mobile    Flutter app                  (not started)
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

## What exists today

| Area | Status |
|---|---|
| API skeleton: env validation, problem+json errors, signed cursor pagination, request-id logs with PII redaction, Helmet, health/readiness | Done, tested |
| Phase 1 database schema + constraints (append-only ledgers, no double grants, one reversal per entry, non-overlapping seasons…) | Done, tested |
| Seed: 24 governorates, 92 cities, 9 sports, 25 exercises, 12 metric types, 6 divisions, rule set v1, seasons, sample gyms | Done, tested |
| Scoring rule-set schema (zod) with the spec's configuration keys | Done, tested |
| Worker process | Boots; no jobs yet |
| Dockerfile / docker-compose | Written, **not yet run** (Docker unavailable on the dev machine) |
| CI (GitHub Actions) | Written, not yet run (no remote) |
| Auth: register (age gate, consents), login, Argon2id, lockout, refresh rotation + reuse detection, logout, email verification, password reset | Done, tested |
| RBAC guard (`@Public`, `@Roles`, `@RequiresVerifiedEmail`), rate limits (in-memory) | Done, tested |
| `/me` (profile, settings, stats), reference catalog (`/ref/*`, delta sync) | Done, tested |
| Google / Apple sign-in, phone verification, onboarding endpoints, avatar upload, data export & deletion | Not started |
| Workouts, scoring engine, leaderboards, battles, admin, mobile | Not started |

## Security notes

- No secrets in the repository: only `.env.example`. CI runs gitleaks.
- Client-sent points are refused: every request DTO rejects unknown fields (`forbidNonWhitelisted`).
