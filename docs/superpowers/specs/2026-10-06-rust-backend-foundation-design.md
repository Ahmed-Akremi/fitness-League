# Rust + MariaDB backend, part 1: foundation and accounts — design

Date: 2026-10-06 · Status: draft, waiting for the owner's review

## Intent

Fitness League gets a new backend written in **Rust** on **MariaDB**, with **Redis** for rate limits and
background jobs. It replaces the NestJS + PostgreSQL API in `apps/api`.

Three decisions taken with the owner on 2026-10-06 frame everything below:

1. **Fresh design.** The Rust code and the MariaDB schema are designed from scratch. Nothing is translated
   line by line from NestJS or Prisma.
2. **Same contract.** The routes, JSON shapes and error codes stay the ones the mobile app
   (`apps/mobile-rn`) and the admin panel (`apps/admin`) already use, so neither frontend changes.
   Scope is what the frontends call (about 166 endpoints), not the 301 routes the old API defines.
   The count includes the six announcement endpoints the home news added on 2026-10-07; none of them
   belongs to part 1.
3. **Redis from the start**, so more than one API instance can run.

The work is too large for one spec. It is cut into six parts, each with its own spec, plan and build:

| # | Part | Contents |
|---|---|---|
| 1 | **Foundation and accounts** (this spec) | Project, MariaDB, Redis, security plumbing, sign-up, login, sessions, roles, onboarding, reference data, admin login |
| 2 | Training loop | Workouts and offline sync, scoring engine and ledger, progress, goals, seasons, leaderboards, badges |
| 3 | Gyms and social | Gyms, gym WODs, gym wars, duels, battles, challenges, leagues, feed, follows, notifications (including the `ANNOUNCEMENT` type), push, live socket, home news (`GET /announcements`, `PUT` and `DELETE /announcements/:id/like`) |
| 4 | Competitions | Events, registration, WODs, submissions, judging, leaderboard, banner upload, list filter `CURRENT` (home carousel) |
| 5 | Admin and moderation | Admin users, seasons, queues, judge accounts, moderation, proofs, anti-cheat, announcements (`GET` and `POST /admin/announcements` with one photo, `DELETE /admin/announcements/:id`) |
| 6 | Cut-over | Demo data, frontends pointed at the Rust API, `apps/api` and PostgreSQL removed |

Part 1 is built by two plans: **1a, foundation** (everything that needs no user account:
`docs/superpowers/plans/2026-10-06-rust-backend-1a-foundation.md`) and **1b, accounts**, written once 1a
compiles.

**Part 1 is done when:** a new user can register in the mobile app against the Rust API, receive the
verification email in Mailpit, sign in, finish onboarding and see their profile; a staff account can sign in
to the admin panel; and the test suites of section "Testing" pass, the security suite included.

## Scope of part 1

Base path `/api/v1`, JSON only. 26 endpoints:

| Area | Method and path | Access | Success |
|---|---|---|---|
| Health | `GET /health` | public | 200 `{status:"ok"}` |
| | `GET /ready` | public | 200 `{status:"ready",checks:{database,redis}}`, 503 if one is down |
| Auth | `POST /auth/register` | public | 201 session |
| | `POST /auth/login` | public | 200 session |
| | `POST /auth/refresh` | refresh token | 200 session |
| | `POST /auth/logout` | user | 204 |
| | `POST /auth/email/verify` | public (token) | 204 |
| | `POST /auth/email/resend` | user | 204 |
| | `POST /auth/password/forgot` | public | 202, always |
| | `POST /auth/password/reset` | public (token) | 204 |
| Me | `GET /me` | user | 200 profile payload |
| | `PATCH /me/profile`, `PATCH /me/settings` | user | 200 profile payload |
| | `POST /me/onboarding/sports`, `/baselines`, `/complete` | user | 200 onboarding state |
| | `GET /me/export` | user | 200 export |
| | `DELETE /me` | user + password | 202 `{scheduledFor}` |
| Reference | `GET /ref/governorates`, `/ref/cities`, `/ref/sports`, `/ref/exercises` | public | 200 list |
| Admin | `POST /admin/auth/login` | public | 200 `{session}` |
| | `POST /admin/auth/refresh` | refresh token | 200 session |
| | `POST /admin/auth/logout` | panel roles | 204 |
| | `GET /admin/me` | panel roles | 200 `{id,email,username,role}` |

A **session** is `{accessToken, expiresIn, refreshToken, userId}`. "User" means a signed-in app account;
"panel roles" are `MODERATOR`, `ADMIN`, `SUPER_ADMIN`, `JUDGE` and `HEAD_JUDGE`. Request bodies, response fields and
validation rules are those of the current frontends; the plan lists them endpoint by endpoint.

Left out of part 1, on purpose:

- **OAuth sign-in (Google, Apple)** and **phone verification**: neither frontend calls them.
- `GET /ref/countries`, `GET /ref/metric-types`, `GET /me/onboarding`, `/me/consents`: not called by a
  frontend.
- `/me/ranks`, `/me/lp`, `/me/weekly-scores/current`, `/me/body-measurements` (part 2) and
  `/me/notification-preferences` (part 3).
- File uploads and object storage: no part 1 endpoint takes a file.

Two payloads reach into later parts and are handled this way:

- `GET /me` returns `stats` and `streak`. Their tables are created now with default values (level 1, zero
  XP, no division); the scoring engine of part 2 fills them.
- `GET /me/export` returns every key the app reads (`account`, `consents`, `workouts`, `goals`, …); the keys
  owned by later parts are empty arrays until those parts exist.

## Architecture

One Cargo package in `apps/backend`, producing one binary with subcommands:

| Command | Role |
|---|---|
| `backend serve` | HTTP API |
| `backend worker` | Background jobs (emails, scheduled sweeps) |
| `backend migrate` | Applies database migrations, with the migration database user |
| `backend seed` | Loads reference data and the rule set from `infra/seed-data/*.json`, idempotent |
| `backend promote <email> <role>` | Gives a staff role to an account; roles cannot be self-assigned through the API |

Stack: **Axum** on **Tokio** for HTTP, **sqlx** for MariaDB, the **redis** crate, **argon2**,
**jsonwebtoken** (Ed25519), **lettre** for SMTP, **tracing** for logs. sqlx was chosen over an ORM because
the SQL is written by hand and checked against the real schema at compile time, and MariaDB-specific
features stay reachable. Query metadata is committed (`.sqlx/`) so builds and CI need no live database.

```
apps/backend/
  migrations/            plain SQL, applied by `backend migrate`
  src/
    main.rs              subcommands
    config.rs            environment → typed configuration, refuses to start when invalid
    error.rs             every error → problem+json
    http/                router, middleware, extractors (signed-in user, roles, validated JSON), rate limiter
    security/            passwords, tokens, pure policy rules (lockout schedule, age)
    jobs.rs  mail.rs  audit.rs
    modules/             auth/  me/  reference/  admin_auth/  health.rs
  tests/                 integration and security suites
```

Each module has its routes and handlers in one file and its logic and SQL in another. Handlers stay thin:
extract, validate, call the module, map the result.

### Request path

Every request crosses the same layers, outermost first: request id → access log → panic catcher → security
headers → CORS → body limit (256 kB) and timeout (15 s) → global rate limit per IP → route. Routes then
declare what they need through extractors:

- `AuthUser` — a valid access token for the right audience, then one primary-key read of the user to check
  status and session version, so a ban, a role change or a password reset applies on the very next request.
- `RequireRole` — the role list of the route. A handler cannot obtain the user without stating it.
- `ValidJson<T>` — the body parsed and validated; unknown fields are rejected.

### Background work

Jobs are entries in a **Redis Stream** read by a consumer group. A job that fails is retried with a growing
delay and moved to a dead-letter stream after five attempts; a job whose worker died is claimed by another
worker. Delivery is at-least-once, so every job is written to be safe to run twice.

**BullMQ is not used** (considered on 2026-10-06 at the owner's request). It is a Node.js library, so it
would bring a Node worker back next to the Rust backend. The Rust ports on crates.io are small community
crates (about 2,000 downloads in total for the most used one), which is too thin a base for a
security-sensitive service. The Redis Stream queue above gives what BullMQ would be used for: retries with
backoff, a dead-letter list, recovery of jobs from a dead worker, and scheduled runs.

Part 1 has two kinds of background work:

- **Emails** (verify address, reset password, account locked). The API only enqueues
  `{kind, userId}`. The worker reads the user's language, creates the one-time token, stores its hash and
  sends the mail, so
  **no secret is ever written to Redis**, and the slow steps happen outside the request, so the response
  time does not reveal whether the address exists.
- **Daily account sweep.** Accounts whose 30-day deletion grace period ended are anonymised; expired tokens
  are removed. A Redis lock makes sure one worker runs it.

## Security

### Passwords and sign-in

- **Argon2id** (19 MiB, 2 passes, 1 lane), 10 to 128 characters, no composition rules.
- Passwords found in a built-in list of common passwords, or equal to the username or email, are refused
  with field code `TOO_COMMON`. This is the one addition to the contract; the app shows unknown field
  codes as a generic invalid-field message.
- Hashing runs off the async threads with a cap on concurrent hashes, so a burst of logins cannot exhaust
  memory.
- An unknown email costs the same Argon2 verification as a known one and returns the same
  `INVALID_CREDENTIALS`, so neither the answer nor its timing reveals which emails exist.
- **Lockout:** every fifth consecutive failure locks the account, 15 minutes first, doubling up to 24 hours
  (`ACCOUNT_LOCKED` 423 with `Retry-After`). Stored in MariaDB, so it survives restarts. The account
  holder gets an email; a password reset lifts the lock.
- Account state (banned, suspended, judge) is only revealed to someone who presented the right password.
- **Age gate:** below the minimum age of the active rule set the answer is `UNDER_AGE` and nothing is stored.

### Tokens and sessions

- **Access token:** JWT signed with Ed25519, 15 minutes. Claims: `sub`, `role`, `sv` (session version),
  `aud` (`app` or `admin`), `iss`, `exp`. Verification pins the algorithm, issuer and audience. The key id
  in the header selects the key, and extra verification keys can be configured, so signing keys can be
  rotated without signing everyone out.
- **Refresh token:** 256 random bits, 30 days, stored only as a SHA-256 hash, **single use**. Each use
  returns a new one. Presenting a token that was already used means it was copied: the whole family (every
  token descended from that login) is revoked and the event is audited. Two simultaneous refreshes with the
  same token: one wins, the other triggers the same revocation.
- **Audiences are separate.** An app token is refused by admin routes and the reverse; each refresh
  endpoint only accepts its own kind.
- **Instant revocation:** a password reset, a ban, a role change or a deletion request increments the
  session version and revokes the refresh tokens.
- **Judge accounts** (`JUDGE`, `HEAD_JUDGE`) are refused by the app login with 403 `JUDGE_ACCOUNT`. The
  admin login accepts `MODERATOR`, `ADMIN`, `SUPER_ADMIN`, `JUDGE`, `HEAD_JUDGE` only, with email and
  password and no second factor (owner's decision of 2026-10); every admin login is audited.
- **Email links:** verification tokens last 24 hours and reset tokens 1 hour. Both are stored hashed, work
  once, and a new one cancels the older ones.

### Roles

Seven roles: `USER`, `GYM_ADMIN`, `MODERATOR`, `ADMIN`, `SUPER_ADMIN`, `JUDGE`, `HEAD_JUDGE`. Three rules
hold in every part:

1. A handler can only obtain the signed-in user through an extractor that names the allowed roles. A test
   walks every registered route and fails if one answers without a token and is not on the explicit list
   of public routes.
2. Every query on user-owned data carries the owner in its `WHERE` clause, so guessing another user's id
   returns 404 rather than their data.
3. Nobody changes their own role. The first staff account is created with `backend promote`.

### Rate limits

Counters live in Redis as sliding windows, updated by one atomic script. A refused request gets 429
`RATE_LIMITED` with `Retry-After`.

| Scope | Limit |
|---|---|
| Every route, per IP | 300 / minute |
| Every route, per signed-in user | 120 / minute |
| Login, app and admin | 10 / minute per IP and 5 / 15 minutes per account |
| Register | 5 / hour per IP |
| Refresh | 30 / minute per IP |
| Forgot password | 10 / hour per IP and 3 / hour per account |
| Reset password | 10 / hour per IP |
| Verify email | 20 / hour per IP |
| Resend verification | 3 / hour per user |
| Export | 3 / day per user |

- IPs and emails are stored in Redis as keyed hashes, never in clear.
- The client IP is the socket address. `X-Forwarded-For` is trusted only when the request comes from a
  proxy listed in `TRUSTED_PROXIES`.
- **If Redis is unreachable**, the routes in the table that create or prove an identity (login, register,
  refresh, forgot, reset, verify) answer 503: they fail closed. Other routes keep working and the outage is
  logged. Account lockout does not depend on Redis.

### Input, output and transport

- Bodies must be JSON, at most 256 kB, with no unknown field (`UNKNOWN_FIELD`). Lengths, formats and ranges
  are validated before any logic runs. This is also what stops a client from sending its own points.
- **SQL injection:** every value is a bound parameter; no SQL is built from strings; `unsafe` Rust is
  forbidden in the crate.
- Errors use the existing problem+json format with a stable `code` and a `traceId`. A 500 never carries a
  message, a stack trace or SQL.
- Response headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, a `default-src 'none'` content security policy, HSTS in production, and
  `Cache-Control: no-store` on everything except the public reference lists.
- **CORS** allows only the origins of `CORS_ORIGINS` (the admin panel). No cookies are used, so there is no
  CSRF surface.
- TLS ends at the reverse proxy; the API warns at start if MariaDB or Redis is reached without TLS in
  production.

### Secrets, logs and audit

- Configuration comes from the environment only. The server **refuses to start** when a secret is missing
  or too short, and in production also when rate limiting is disabled, CORS allows `*`, or no SMTP server
  is set.
- Secrets are held in a type that cannot be printed. Logs are JSON with request id, route, status, duration
  and user id; they never contain bodies, `Authorization` headers, tokens, emails or passwords.
- **Audit log:** registration, admin login, lockout, password reset, refresh-token reuse, deletion request,
  role change. It is append-only, enforced by the database itself (see below).
- **Supply chain:** `Cargo.lock` is committed; CI runs `cargo audit` (known vulnerabilities) and
  `cargo deny` (licences, banned and duplicate crates); the existing secret scan keeps running.

### Known trade-offs, kept on purpose

- `POST /auth/register` answers `EMAIL_TAKEN` or `USERNAME_TAKEN`, which reveals that an address is
  registered. The app's sign-up form depends on it; the 5 per hour per IP limit bounds the abuse.
- Lockout lets someone who knows an email lock that account for a while. The account holder is emailed and
  a password reset lifts the lock.
- A refresh whose answer is lost in transit signs the user out on the retry, because the retry looks like
  reuse. This is the current behaviour and the app already shares one refresh between concurrent requests.

## Database

MariaDB **11.4 LTS**, InnoDB, one database `fitness_league`.

### Conventions

- **Keys:** UUID version 7 generated by the application. They are time-ordered, which suits InnoDB's
  clustered primary key, and they stay opaque strings for the frontends.
- **Time:** `DATETIME(6)` in UTC; every connection sets `time_zone = '+00:00'`. Calendar dates (date of
  birth) are `DATE`.
- **Text:** `utf8mb4`. Display names and searchable text use the accent- and case-insensitive collation
  `utf8mb4_uca1400_ai_ci`. **Emails and usernames** are trimmed and lower-cased by the application and
  stored in case-insensitive, accent-sensitive columns, so `rené@` and `rene@` are never the same account.
- **Translated names** (governorates, sports, exercises) are three columns `name_fr`, `name_en`, `name_ar`,
  returned to the frontends as the `{fr,en,ar}` object they expect. `JSON` columns are kept for data whose
  shape is really free: the rule-set configuration and the before/after of the audit log.
- **Closed value sets** (role, status, gender, locale…) are `ENUM` columns mapped to Rust enums.
- **Connections** use strict SQL mode and `READ COMMITTED` isolation.
- Hashes are `BINARY(32)` with a unique index.

### PostgreSQL features and their MariaDB replacements

| PostgreSQL (old API) | MariaDB (new design) |
|---|---|
| `citext` columns | Case-insensitive collation on the column |
| `unaccent` search | Accent-insensitive collation |
| Partial unique index | Unique index on a generated column that is `NULL` when the rule does not apply |
| Exclusion constraint on date ranges | Overlap check inside a transaction that locks the rows it read |
| `ON CONFLICT` | `INSERT … ON DUPLICATE KEY UPDATE` |
| `jsonb` | Real columns; `JSON` only for free-shape data |

The last four mostly matter from part 2 on; they are fixed here so every part follows the same rule.

### Tables of part 1

| Group | Tables |
|---|---|
| Identity | `users` (email, username, password hash, role, status, session version, lockout counters, date of birth), `refresh_tokens`, `email_tokens`, `consents` (history, never updated), `deletion_requests` |
| Profile | `profiles`, `user_settings`, `user_sports`, `baselines`, `user_stats`, `user_streaks` |
| Reference | `countries`, `governorates`, `cities`, `sports`, `metric_types`, `exercises`, `rule_sets` |
| Trail | `audit_log` |

Foreign keys are declared everywhere. Columns that point at tables of later parts (`profiles.primary_gym_id`,
`user_stats.current_season_id`) exist now as nullable ids and get their foreign key in the part that creates
the target table.

### Database accounts

- `fl_migrate` owns the schema and is used only by `backend migrate`.
- `fl_app` is used by the API and the worker: `SELECT, INSERT, UPDATE, DELETE` on the database, **no**
  schema, file or grant rights.
- `audit_log` has `BEFORE UPDATE` and `BEFORE DELETE` triggers that raise an error. `fl_app` cannot drop a
  trigger, so even a compromised API cannot rewrite the trail.

## Configuration

Variable names are kept from the old API where the meaning is the same, so existing `.env` files carry over.

| Variable | Notes |
|---|---|
| `APP_ENV` | `development`, `test` or `production` |
| `PORT`, `LOG_LEVEL`, `APP_NAME`, `APP_LINK_BASE_URL`, `BUSINESS_UTC_OFFSET_MINUTES` | As today |
| `DATABASE_URL` | `mysql://fl_app:…@host:3306/fitness_league` |
| `MIGRATE_DATABASE_URL` | Same, with `fl_migrate`; read only by `backend migrate` |
| `REDIS_URL` | Required |
| `JWT_PRIVATE_KEY_B64`, `JWT_PUBLIC_KEY_B64`, `JWT_KEY_ID`, `JWT_ISSUER` | As today |
| `JWT_EXTRA_PUBLIC_KEYS` | Optional `kid:base64` list accepted for verification during a key rotation |
| `ACCESS_TOKEN_TTL_S`, `REFRESH_TOKEN_TTL_DAYS` | Defaults 900 and 30 |
| `APP_HMAC_SECRET` | At least 32 bytes; hashes rate-limit subjects (and signs cursors from part 2) |
| `CORS_ORIGINS`, `TRUSTED_PROXIES` | Comma-separated; both empty by default |
| `SMTP_URL`, `MAIL_FROM` | Mailpit locally |
| `RATE_LIMIT_ENABLED` | Default `true`; `false` is refused in production |

`infra/docker-compose.yml` gains a `mariadb:11.4` service with an init script creating the two database
accounts. Redis gets a password. PostgreSQL stays until part 6, because `apps/api` keeps running until then.

## Testing

- **Unit tests** for the pure rules: lockout schedule, age, password policy, token rotation decisions,
  sliding-window arithmetic.
- **Integration tests** call the real router in process against a real MariaDB and a real Redis. Each test
  gets its own throw-away database and its own Redis key prefix, so tests run in parallel.
- **Security suite**, one test per promise of this spec:
  - an unknown email and a wrong password give the same answer;
  - the fifth failure locks, and the lock doubles;
  - a reused refresh token revokes its family, and so does a concurrent double refresh;
  - an app token is refused by an admin route and the reverse;
  - every role is tried against every route, and only the allowed ones pass;
  - a banned or suspended user is refused on the next request, and an old access token dies after a
    password reset;
  - a judge is refused by the app login;
  - unknown fields, oversized bodies and SQL metacharacters in every text field are refused or stored
    literally;
  - each rate limit answers 429 with `Retry-After`, and identity routes answer 503 when Redis is down;
  - `fl_app` cannot update or delete an audit row, nor change the schema;
  - email and reset tokens work once and expire.
- **Contract check:** for each part 1 route recorded in `apps/mobile-rn/assets/demo/api.json`, the Rust
  answer has the same keys and value types. The mobile and admin test suites must still pass unchanged.
- **CI:** a new `backend` job runs format check, Clippy with warnings as errors (`unwrap` and `expect`
  denied outside tests), the tests with MariaDB and Redis services, `cargo audit` and `cargo deny`.

## Local setup

- Rust is installed with `rustup` in the WSL home; the toolchain version is pinned in
  `apps/backend/rust-toolchain.toml`.
- The repository lives in OneDrive on this PC, which is slow and locks files, so the build output goes
  outside it (`CARGO_TARGET_DIR` under the WSL home).
- MariaDB, Redis and Mailpit run from `infra/docker-compose.yml`.
- Work happens on a new branch `feat/rust-backend`.

## Open points

1. **No screen opens the email links.** The mobile app sends "forgot password" and "resend verification",
   but neither frontend has a screen for `/verify-email?token=…` or `/reset-password?token=…`. Part 1
   exposes the two endpoints; a screen or a small web page is still needed for the links to do anything.
   This is true of the current API as well.
2. **Second factor for admins** was removed at the owner's request and stays removed. It remains the
   strongest missing protection for staff accounts; the token design leaves room to add it later.
3. **Common-password list:** the 100,000 most common passwords of SecLists (MIT licence), reduced to the
   9,079 entries of 10 characters or more, since shorter ones are refused by length anyway. It is embedded
   in the binary (about 106 kB).
