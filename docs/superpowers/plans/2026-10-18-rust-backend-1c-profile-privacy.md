# Rust backend, plan 1c: profile and privacy

Date: 2026-10-18 · Spec: `docs/superpowers/specs/2026-10-06-rust-backend-foundation-design.md` · Follows plan 1b
(`docs/superpowers/plans/2026-10-07-rust-backend-1b-accounts.md`, its "Left for plan 1c" section).

**Goal:** the last seven endpoints of part 1 and the daily sweep, so the mobile app can register, finish
onboarding, change its profile and settings, export its data and delete its account against the Rust API.

**Contract:** the routes, bodies, answers and error codes of `apps/api/src/modules/users` (the NestJS API),
as the mobile app calls them (`apps/mobile-rn/src/features/me/api.ts`). Built inline, one commit per task.

## Endpoints

| Route | Body | Answer |
|---|---|---|
| `PATCH /me/profile` | any of `fullName` (2–80, readable), `bio` (≤ 280 or `null`), `gender` (or `null`), `governorateId` + `cityId` (together), `experienceLevelDeclared`, `plannedTrainingDaysPerWeek` (1–7) | 200, the `GET /me` payload |
| `PATCH /me/settings` | any of `locale`, `theme`, `reducedMotion` (or `null`), `defaultVisibility`, `showAgeBracket`, `showOnLeaderboards`, `streakFreezeDaysPerWeek` (0–4) | 200, the `GET /me` payload |
| `POST /me/onboarding/sports` | `sportIds` (1–9, unique), `primarySportId` (one of them) | 200, onboarding state |
| `POST /me/onboarding/baselines` | `entries` (≤ 30) of `{exerciseId, metricCode, value}` | 200, onboarding state |
| `POST /me/onboarding/complete` | none | 200, onboarding state |
| `GET /me/export` | — | 200, everything held about the account |
| `DELETE /me` | `confirm: "DELETE"`, `password` | 202 `{scheduledFor}` |

Onboarding state: `{steps: {sports, baselines, goals, gym}, completed, calibrationEndsAt}`. `goals` and `gym`
stay `false` until parts 2 and 3 create their tables.

Error codes kept from the old API: `REQUIRED_TOGETHER` (one of governorate and city), `NOT_IN_GOVERNORATE`,
`NOT_IN_SPORT_IDS`, `UNKNOWN_SPORT`, `UNKNOWN_EXERCISE`, `METRIC_NOT_TRACKED`, 422 `PRECONDITION_FAILED` with
`missingStep: "sports"`, 401 `INVALID_CREDENTIALS` for a wrong password on `DELETE /me`, 429 on the fourth
export of the day.

## Rulings

1. **A `null` and an absent field differ** only where the old API let a field be cleared: `bio`, `gender`,
   `reducedMotion`. Elsewhere `null` means "unchanged", as before.
2. **A full name follows the registration rule** (no invisible or direction-changing character, two letters
   or digits). The rule moves to `validate.rs` so both routes share it.
3. **The new place must be in the account's country**, like at registration.
4. **Baseline values are rounded to 3 decimals** instead of refused: the app multiplies minutes by 60, and a
   float such as `1342.1999999999998` must not fail onboarding. Disabled exercises count as unknown.
   Every wrong entry is reported in one answer.
5. **`DELETE /me` checks the password like a sign-in**, through `check_credentials`: five wrong passwords
   lock the account. A stolen access token must not become a way to guess the password at 120 tries a
   minute.
6. **One pending deletion per account**, held by the database: a generated column that is the user id while
   the request is `PENDING` and `NULL` otherwise, under a unique index (migration `0005`). A new request
   cancels the older one, as before.
7. **Anonymising writes `1900-01-01`** into `users.date_of_birth` (the column stays `NOT NULL`; the old API
   wrote the same). Email becomes `deleted:<id>` and username `deleted-<12 hex>`: neither can be registered
   (an email needs `@`, a username refuses `-`), so nobody can block someone's deletion by taking the name
   first. Profile name becomes `Deleted athlete`, bio and gender are cleared; sessions and links are deleted.
   Consents, baselines and the audit trail stay: they are the record, and the ledgers of part 2 will keep
   pointing at the anonymous row.
8. **The sweep runs once per business day**, behind a Redis key `sweep:<day>` taken with `SET NX`. A sweep
   that fails gives the key back; one that dies holds it, and the next day's sweep catches up. It also
   deletes refresh and email tokens that have expired.
9. **The export is the account's own data in one answer**: the `GET /me` payload plus date of birth, phone,
   dates, baselines and the consent history. The keys of later parts (`workouts`, `goals`, …) are empty lists.

## Tasks

1. Shared rules: `validate::readable_name`, `validate::nullable`, `Rules.calibration_days`, migration `0005`.
2. `PATCH /me/profile` and `PATCH /me/settings` (`modules/me/mod.rs`), tests `tests/profile.rs`.
3. Onboarding (`modules/me/onboarding.rs`), tests `tests/onboarding.rs`.
4. Export, deletion and the sweep (`modules/me/privacy.rs`, the worker loop in `main.rs`), tests `tests/privacy.rs`.
5. Documents: README, spec, handoff; `cargo sqlx prepare`; fmt, Clippy (online and offline), tests, audit, deny.

## Done when

- `cargo test` passes with `profile`, `onboarding` and `privacy` next to the suites of plans 1a and 1b, and the
  security suite covers the seven new routes without a change (they are not public).
- Part 1 of the spec is complete: the mobile app pointed at the Rust API registers, finishes onboarding and
  shows its profile.
