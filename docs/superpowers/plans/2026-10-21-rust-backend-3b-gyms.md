# Rust backend, plan 3b: gyms

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Date: 2026-10-21 · Spec: `docs/superpowers/specs/2026-10-21-rust-backend-gyms-social-design.md` (« Gyms (3b) »,
« Database », « Plans ») · Second plan of part 3, after plan 3a
(`docs/superpowers/plans/2026-10-21-rust-backend-3a-friends-notifications.md`).

**Goal:** athletes browse verified gyms, submit their own, join one, and leave it. A gym's admin approves,
rejects and removes members, names coaches and reads the dashboard. The gym board and `/me/ranks.gym` rank an
athlete among their gym's members, every leaderboard row and profile shows the athlete's gym, and the
`GYM_MEMBER` badge is awarded.

**Architecture:**

- A new module, `modules/gyms`:
  - `mod.rs`: the routes, and what the other files share (`gym_param`, `can_manage`, `manageable`, the gym card);
  - `directory.rs`: the directory, creation, my gyms, the gym profile;
  - `members.rs`: joining and leaving, the member list, requests, decisions, coaches;
  - `dashboard.rs`: the gym admin's dashboard.
- `league/boards.rs` gains a gym scope, the gym in every row, and the `GYM` snapshot. `badges.rs` gains the
  `GYM_JOINED` fact; the badge sweep in `league/jobs.rs` adds approved memberships.
- `me/mod.rs` (`profile.gym`), `me/onboarding.rs` (`steps.gym`) and `social/athletes.rs` (`gym`) read the
  membership. `me/privacy.rs` handles the new tables.
- One migration, `0011_gyms.sql`.

**Tech stack:** Axum 0.8 and sqlx 0.9 on MariaDB 11.4, as in plan 3a. No new crate: URLs are checked with
`axum::http::Uri`, slugs made with `seed::slugify`.

**Contract:** the old API's code, as the app calls it.

- **Old API:** `apps/api/src/modules/gyms/` (`gyms.controller.ts`, `gyms.service.ts`, `gym-dashboard.service.ts`,
  `dto/gym.dto.ts`), the `GYM` scope of `leaderboards/leaderboards.service.ts` (`scopeFilter`, `myRanks`,
  `snapshot`, `decorate`), `users/users.service.ts` (`profile.gym`), `users/onboarding.service.ts` (`steps.gym`),
  `badges/badges.service.ts` (`COUNT:GYM_JOINED`, `sweep`).
- **The app's callers:** `features/gyms/api.ts` and `screens.tsx` (`membersCount`, `myMembership`, `canManage`,
  `topAthletes`, `rank`, `socialLinks`, `addressLine`, the dashboard's `members`, `trend`, `topProgress`,
  `toNudge`, `wods`, `wars`), `features/league/api.ts` (scope `gym`), `features/home/screen.tsx`
  (`profile.gym`).
- `apps/mobile-rn/assets/demo/api.json` records `GET /gyms`, `/gyms?sort=members`, `/gyms/mine`,
  `/gyms/<id>`, `/gyms/<id>/members`, `/gyms/<id>/membership-requests`, `/leaderboards/gyms/<id>` and `/me`,
  `/me/ranks` and `GET /me`. The tests check the same keys and types (`assert_same_shape`).

**Where it is built:** this Windows checkout, branch `feat/rust-backend-3` (with `origin/main` merged in), using
the environment line of `handoff.md` §2.

## Global constraints

Plan 3a's constraints hold unchanged:

- no `unwrap` or `expect` outside tests, and no `unsafe`;
- the caller in the `WHERE` of every query on their own data;
- database errors through `AppError::from(sqlx::Error)`;
- bodies with `deny_unknown_fields`, field paths, and every wrong field reported at once;
- timestamps through `types::iso`, ids from `Uuid::now_v7()`;
- no health value in a log, an error or another account's answer;
- no new public route;
- jobs take the clock as a parameter.

And:

- **A gym's contact phone, contact email and proof of ownership never leave the API** in any answer. The
  export is the exception: it returns the submitter's own proof.
- **A member row, a request row, a dashboard entry and a leaderboard row** carry no email, birth date or body
  data.
- **Who manages a gym:** its owner, while their role is `GYM_ADMIN` and the gym is `VERIFIED`, or a staff account
  (`ADMIN`, `SUPER_ADMIN`). Anyone else gets 403 `FORBIDDEN` « Only this gym's admin can do that. ». An unknown
  gym is 404 `Gym`.
- **A malformed id in a path is 404**, like an unknown one (spec ruling 7): `Gym`, then `Membership`.
- **Every membership change is one conditional `UPDATE`, in the transaction that also moves
  `profiles.primary_gym_id`.** A change that touches no row is the 404.
- Before the last commit:
  - `cargo fmt --check`;
  - Clippy `-D warnings`, online and with `SQLX_OFFLINE=true` (after `touch src/lib.rs`);
  - `cargo sqlx prepare -- --all-targets`, with `.sqlx/` committed.

## Endpoints

| Route | Body or query | Answer |
|---|---|---|
| `GET /gyms` | `limit`, `cursor`, `q` (≤ 80), `sport` (a code), `governorateId`, `sort=name\|members` (default `name`) | 200 `{data: [Card], page}` of `VERIFIED` gyms. 422: `sport` `MATCHES` or `UNKNOWN_SPORT`, `governorateId` `ISUUID`, `q` `MAXLENGTH`, `sort` `ISIN`, `cursor` `CURSOR_SORT_MISMATCH` |
| `POST /gyms` | `Create` | 201 `{id, slug, status: "PENDING"}`. 403 `EMAIL_NOT_VERIFIED`. 409 `CONFLICT` « You already have a gym waiting for verification. ». 422 as below |
| `GET /gyms/mine` | — | 200 `[{id, name, slug, status, logoUrl: null}]`: the gyms I own, newest first |
| `GET /gyms/:id` | — | 200 `Profile`. 404 `Gym` unless `VERIFIED` |
| `GET /gyms/:id/dashboard` | — | 200 `Dashboard`. 404 `Gym`, 403 `FORBIDDEN` |
| `POST /gyms/:id/membership` | — | 201 `{gymId, status: "PENDING"}`. 404 `Gym` unless `VERIFIED`. 409 `CONFLICT` « Leave your current gym first (one gym per athlete). », with `gymId` and `membershipStatus` |
| `DELETE /gyms/me/membership` | — | 204, whatever there was |
| `GET /gyms/:id/members` | `limit`, `cursor` | 200 `{data: [{id, username, fullName, role, since}], page}`: approved members with an `ACTIVE` account, by membership id. An unknown gym gives an empty page |
| `GET /gyms/:id/membership-requests` | — | 200 `[{userId, username, fullName, requestedAt}]`, pending, oldest first. 404 or 403 as for managing |
| `POST /gyms/:id/members/:userId/approve` | — | 200 `{userId, status: "APPROVED"}`. 404 `Membership` unless pending |
| `POST /gyms/:id/members/:userId/reject` | — | 200 `{userId, status: "REJECTED"}`. 404 as above |
| `POST /gyms/:id/members/:userId/remove` | — | 200 `{userId, status: "REMOVED"}`. 404 `Membership` unless approved |
| `POST /gyms/:id/members/:userId/coach` | — | 200 `{userId, role: "COACH"}`. 404 `Membership` unless approved |
| `DELETE /gyms/:id/members/:userId/coach` | — | 204. 404 as above |
| `GET /leaderboards/gyms/:id` | `limit`, `cursor` | 200, the national board's shape over the members whose primary gym it is, with the movement since the `GYM` snapshot |
| `GET /leaderboards/gyms/:id/me` | `limit` | 200, the shape of `/national/me`, over the same members |

The shapes:

- **`Create`:** `{name, governorateId, cityId, addressLine?, contactPhone?, contactEmail?, socialLinks?, sportIds?,
  proofOfOwnership}`. The checks, each with its code:

  | Field | Rule | Code |
  |---|---|---|
  | `name` | 3 to 80 characters, trimmed | `MINLENGTH` / `MAXLENGTH` |
  | `governorateId`, `cityId` | a UUID | `ISUUID` |
  | `addressLine` | at most 200 characters | `MAXLENGTH` |
  | `contactPhone` | `^\+[1-9]\d{7,14}$` | `MATCHES` |
  | `contactEmail` | an email (`normalise_email`) | `ISEMAIL` |
  | `socialLinks.<key>` | key in `instagram`, `facebook`, `website`, `tiktok`; value an `http`/`https` URL of at most 300 characters | `INVALID_LINK` |
  | `sportIds` | at most 10, no duplicate, each a UUID | `ARRAYMAXSIZE`, `ARRAYUNIQUE`, `ISUUID` |
  | `proofOfOwnership` | 10 to 1,000 characters | `MINLENGTH` / `MAXLENGTH` |

  Then, against the database: `cityId` `NOT_IN_GOVERNORATE`, and `sportIds` `UNKNOWN_SPORT` for an unknown or
  disabled sport.
- **`Card`:** `{id, name, slug, verified, city: {fr, en, ar}, governorate: {id, code, name: {fr, en, ar}},
  logoUrl: null, sports: [{code, name: {fr, en, ar}, icon}] (by code), membersCount, level: 1}`.
  `membersCount` counts the `APPROVED` memberships.
- **`Profile`:** a `Card` plus:
  - `addressLine`, `socialLinks` (the links set, as an object);
  - `rank`: the gym's rank among `VERIFIED` gyms by the summed season LP of the members whose primary gym it
    is, in the active season. `null` when the sum is 0;
  - `topAthletes`: at most 5 `{id, username, fullName, lp, level}`. These are `ACTIVE` athletes of an active
    season whose primary gym it is and who show on leaderboards, by LP and then id;
  - `myMembership`: `{status: "PENDING" | "APPROVED" | "NONE", role}`. `role` is `"COACH"` for an approved coach
    or a manager, `"MEMBER"` for another approved member, and `null` otherwise;
  - `canManage`;
  - `warRecord: null` (plan 3d).
- **`Dashboard`:** `{gym: {id, name, rating: 1500}, members: {approved, pending, activeLast7Days,
  activeLast28Days}, trend, topProgress, toNudge, wods: [], wars: {wins: 0, losses: 0, draws: 0, enrolled:
  true}}`, over the gym's approved members:
  - `activeLast<N>Days`: the members with an accepted workout performed in the last N days;
  - `trend`: the 8 closed weeks before this one, oldest first, each `{weekStart: "YYYY-MM-DD", activeMembers,
    meanScore}`. `activeMembers` counts the `weekly_scores` rows of that week; `meanScore` is their mean `total`
    to 1 decimal, `null` without rows;
  - `topProgress`: last week's rows by `progress_c`, best first, at most 5, each `{userId, name, progress,
    total}`. `name` is the full name;
  - `toNudge`: at most 20 `{userId, name, lastWorkoutAt}`, for the members without an accepted workout in 14
    days (`lastWorkoutAt: null` when they never logged one).
- **Elsewhere:**
  - leaderboard rows: `gym: {id, name} | null`;
  - `GET /users/:username`: `gym: {id, name} | null`;
  - `GET /me`: `profile.gym: {id, name, slug} | null`. All three come from `profiles.primary_gym_id`;
  - onboarding `steps.gym`: a `PENDING` or `APPROVED` membership exists;
  - `GET /me/ranks`: `gym` is my rank on my gym's board, `null` without a gym or when I am not eligible.
- **Pages:** `page::limit` with signed cursors:
  - the directory: `{n, id}` by name, `{m, id}` by members. A cursor without its sort's key is
    `CURSOR_SORT_MISMATCH`;
  - members: `{id}` of the membership;
  - the gym board: `{lp, id}`, as the other boards.

## Behaviour (the old `GymsService`)

- **Directory:**
  - `VERIFIED` gyms only;
  - `q` is trimmed and matched with `LIKE '%q%' ESCAPE '|'` (plan 3a's `contains`, moved to `validate.rs`) on the
    name, accent- and case-insensitively through the collation;
  - `sport` must name a sport (`UNKNOWN_SPORT`);
  - order: `name, id` ascending, or `membersCount, id` descending.
- **Creation**, one transaction:
  1. the gym (`PENDING`, `owner_user_id` me, the name trimmed, the slug);
  2. its sports;
  3. the verification request (`proof_text`). Its unique generated column makes a second pending submission
     the 409;
  4. the audit entry `GYM_SUBMITTED` (`after: {gymId}`).

  The slug is `seed::slugify(name)` cut to 50 characters (no trailing `-`), `gym` when empty, then `-2`, `-3`…
  until free.
- **Join:** `INSERT` a `PENDING` row. A duplicate key on `uq_gym_members_live` is the 409: read my live row for
  its `gymId` and `membershipStatus`.
- **Leave:** one transaction:
  - `UPDATE gym_members SET status = 'LEFT', left_at = now WHERE user_id = me AND status IN ('PENDING',
    'APPROVED')`;
  - `UPDATE profiles SET primary_gym_id = NULL WHERE user_id = me`.
- **Decide** (`manageable` first), each in one transaction with its audit entry
  `GYM_MEMBER_APPROVE|REJECT|REMOVE` (`user_id` the member, `after: {gymId}`):
  - approve: `PENDING` → `APPROVED` (`approved_at`, `approved_by`), then `primary_gym_id = gym`;
  - reject: `PENDING` → `REJECTED` (`left_at`);
  - remove: `APPROVED` → `REMOVED` (`left_at`), then `primary_gym_id = NULL WHERE primary_gym_id = gym`.
- **Coach:** `manageable`, then `SELECT … FOR UPDATE` of the approved row (404 without one), then set `role`, with
  the audit entry `GYM_COACH_APPOINTED` or `GYM_COACH_REMOVED`. The read comes first because MariaDB counts an
  `UPDATE` that changes nothing as 0 rows.

## Badges and boards

- `Fact::Count(Event::GymJoined)` counts my `APPROVED` memberships (the old fact). The badge sweep adds
  `SELECT user_id FROM gym_members WHERE status = 'APPROVED' AND updated_at >= ?` (spec ruling 6).
- `Scope::Gym(Uuid)` filters on `p.primary_gym_id`; its snapshot scope is `('GYM', gym)`. `snapshot` adds the
  `GYM` rows, partitioned by `primary_gym_id`, for the athletes who have one.
- Every board row `LEFT JOIN`s `gyms` on `p.primary_gym_id` for `gym: {id, name}`.

## Database (`0011_gyms.sql`)

- **`gyms`:**
  - `id`, `name VARCHAR(80)`, `slug VARCHAR(60)` (ascii, unique);
  - `governorate_id`, `city_id` (FK);
  - `address_line VARCHAR(200) NULL`, `contact_phone VARCHAR(16) NULL`, `contact_email VARCHAR(254) NULL`;
  - `instagram_url`, `facebook_url`, `website_url`, `tiktok_url` `VARCHAR(300) NULL`;
  - `status ENUM('PENDING','VERIFIED','REJECTED','SUSPENDED') DEFAULT 'PENDING'`;
  - `owner_user_id NULL` (FK `users`, `ON DELETE SET NULL`), `verified_at NULL`, `verified_by NULL` (FK, set
    null);
  - `created_at`, `updated_at`;
  - `KEY (governorate_id, status)`, `KEY (owner_user_id)`.
- **`gym_sports`:** `gym_id` (FK, cascade), `sport_id` (FK); `PRIMARY KEY (gym_id, sport_id)`, `KEY (sport_id)`.
- **`gym_members`:**
  - `id`, `gym_id` (FK, cascade), `user_id` (FK, cascade);
  - `status ENUM('PENDING','APPROVED','REJECTED','REMOVED','LEFT') DEFAULT 'PENDING'`,
    `role ENUM('MEMBER','COACH') DEFAULT 'MEMBER'`;
  - `requested_at`, `approved_at NULL`, `approved_by NULL` (FK, set null), `left_at NULL`, `updated_at` (`ON
    UPDATE`);
  - `live_user BINARY(16) AS (IF(status IN ('PENDING','APPROVED'), user_id, NULL)) STORED` with
    `UNIQUE KEY uq_gym_members_live (live_user)`, as `0005`;
  - `KEY (gym_id, status)`, `KEY (user_id)`.
- **`gym_verification_requests`:**
  - `id`, `gym_id` (FK, cascade), `submitted_by` (FK, cascade), `proof_text VARCHAR(1000) NOT NULL`;
  - `status ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING'`;
  - `reviewed_by NULL` (FK, set null), `review_note VARCHAR(500) NULL`, `reviewed_at NULL`, `created_at`,
    `updated_at`;
  - `pending_submitter AS (IF(status = 'PENDING', submitted_by, NULL)) STORED`, unique;
  - `KEY (status, created_at)`.
- `profiles.primary_gym_id` gets `fk_profiles_gym` (`ON DELETE SET NULL`).
- `leaderboard_snapshots.scope_type` becomes `ENUM('NATIONAL','GOVERNORATE','GYM')`.

## Rulings

1. **Social links are four columns,** not the old JSON, following part 1's « real columns » convention (as
   plan 3a ruling 6). The answer's `socialLinks` holds the links that are set.
2. **What gym wars own waits for plan 3d:** there is no `rating`, `level` or `wars_opt_out` column. Until then:
   - a card's `level` is 1 (the old API never raised it);
   - `warRecord` is `null`, as recorded;
   - the dashboard answers `rating: 1500` (Glicko-2's start), wars at 0 with `enrolled: true`, and `wods: []`.
3. **No logo and no soft delete until part 5** (spec ruling 3): `logoUrl` is `null`, and nothing deletes a gym
   before the admin panel does.
4. **One pending submission per athlete is a unique generated column,** so two submissions at once cannot both
   pass. The old API counted first.
5. **One live membership is a unique generated column** (spec): a second join, simultaneous or not, is the 409.
6. **Membership changes are conditional `UPDATE`s:**
   - approving a request that was withdrawn meanwhile is a 404;
   - when a leave and an approval land together, the athlete ends up out, with no primary gym.
7. **`topAthletes` lists only athletes who show on leaderboards.** The old API listed every member, so an
   athlete who opted out of leaderboards still appeared in a gym's top five.
8. **Audit entries name the athlete concerned** (`audit::Event.user_id`, entity `user`), with the gym in `after`.
   The old API wrote `gym` and `gym_member` entities. `audit::record` stays as it is.
9. **Anonymisation:**
   - the account's memberships are deleted and its primary gym cleared;
   - its gyms still `PENDING` are deleted, with their requests;
   - its other gyms stay, without an owner.

   The old API kept everything.
10. **The export gains** `gymMemberships` (`{gymId, gymName, status, role, requestedAt, approvedAt, leftAt}`) and
    `gyms` (`{id, name, slug, status, createdAt, proofOfOwnership}`: the gyms I submitted).
11. **A gym's name is checked once trimmed.** The old API checked the raw text, then trimmed it.
12. **The member list and the gym board answer for any gym id,** an unknown one being empty, as in the old API.

## Review focus

1. **One athlete joins two gyms at the same moment:** one 201, one 409, one live row, no 500 (task 3).
2. **A cursor issued for `sort=name` and sent with `sort=members`:** 422 `cursor` `CURSOR_SORT_MISMATCH`, never a
   wrong page or a 500 (task 2).
3. **A directory search for `%` or `_`:** the characters match literally (task 2).
4. **Someone who is not this gym's admin calls a management route:** a member, a coach, an owner whose role is
   `USER`, or the submitter of a `PENDING` gym gets 403; an unknown gym gives 404 (task 3).
5. **After leaving or a removal:** the athlete is off the gym board, `/me/ranks.gym` is `null` and
   `profile.gym` is `null` (tasks 3 and 5).

---

### Task 1: the tables

**Files:**

- Create: `apps/backend/migrations/0011_gyms.sql`.
- Modify: `apps/backend/tests/schema.rs`.

- [ ] **Step 1: write the failing test** `the_gym_tables_hold_their_rules` in `tests/schema.rs`. Each of these
  is refused:
  - a second `PENDING` or `APPROVED` membership for one athlete (unique), while a `LEFT` one next to a live one
    is accepted;
  - a second `PENDING` verification request by one submitter, while one next to a `REJECTED` one is accepted;
  - `primary_gym_id` naming no gym (FK).

  And a `GYM` snapshot row is accepted.
- [ ] **Step 2:** apply the migration to the dev database (`sqlx migrate run --source migrations --database-url
  …`). `cargo test -j 4 --test schema` fails, then passes once the migration is complete.
- [ ] **Step 3:** commit `feat(backend): the gym tables`.

### Task 2: the directory, creation, my gyms and the gym profile

**Files:**

- Create: `apps/backend/src/modules/gyms/mod.rs`, `apps/backend/src/modules/gyms/directory.rs`,
  `apps/backend/tests/gyms.rs`.
- Modify:
  - `apps/backend/src/modules/mod.rs`, `apps/backend/src/http/mod.rs`;
  - `apps/backend/src/validate.rs`: `contains` moves here from `social/athletes.rs`, which then imports it;
  - `apps/backend/tests/common/mod.rs`.

**Interfaces (produces):**

- `gyms::routes(api: Api) -> Api`.
- `gyms::gym_param(raw: &str) -> Result<Uuid, AppError>`: 404 `Gym` when malformed.
- `gyms::can_manage(user: &AuthUser, owner: Option<Uuid>, verified: bool) -> bool`.
- `gyms::manageable(db: &MySqlPool, user: &AuthUser, gym: Uuid) -> Result<(), AppError>`: 404 `Gym`, or 403
  `FORBIDDEN` with the detail « Only this gym's admin can do that. ».
- `validate::contains(text: &str) -> String`: plan 3a's `%…%` pattern for `ESCAPE '|'`.
- Test helpers in `tests/common/mod.rs`:
  - `a_gym(app: &TestApp, owner: Uuid, name: &str) -> Uuid`: a `VERIFIED` gym in `a_place`, with the catalog's
    first two sports. The owner becomes `GYM_ADMIN`, with an `APPROVED` membership and the gym as primary;
  - `member_of(app: &TestApp, user: Uuid, gym: Uuid)`: an `APPROVED` membership and the gym as primary.

- [ ] **Step 1: write the failing tests** in `tests/gyms.rs`. A local `verified(app, name)` helper makes a
  verified athlete.
  - `the_directory`:
    - « Sahel Iron » (2 members), « Ariana Fit » (owner only) and a `PENDING` gym. `GET /gyms` lists the two
      verified ones by name (recorded shape of `GET /gyms`). `sort=members` puts Sahel first (recorded
      `GET /gyms?sort=members`). `limit=1` pages through both with the cursor, for each sort.
    - A name cursor sent with `sort=members` → 422 `cursor` `CURSOR_SORT_MISMATCH`.
    - `q=sahel` and `q=SÂHEL` find Sahel; `q=%` and `q=_` find nothing. `sport=<Sahel's sport>` filters.
    - `sport=NOPE` → 422 `sport` `UNKNOWN_SPORT`; `sport=x` → `MATCHES`; `governorateId=x` → `ISUUID`;
      `sort=size` → `sort` `ISIN`.
  - `creating_a_gym`:
    - A verified athlete posts a full body → 201 `{id, slug: "sahel-iron-club", status: "PENDING"}`. One
      `GYM_SUBMITTED` audit row exists. `GET /gyms/mine` lists it (recorded shape). It is not in `GET /gyms`,
      and `GET /gyms/<id>` → 404.
    - A second post → 409 `CONFLICT`. The same name from another athlete → slug `sahel-iron-club-2`. An
      unverified athlete → 403 `EMAIL_NOT_VERIFIED`.
    - A city of another governorate → 422 `cityId` `NOT_IN_GOVERNORATE`. An unknown sport id → `sportIds`
      `UNKNOWN_SPORT`.
    - In one body: `socialLinks: {myspace: "https://x.tn", instagram: "ftp://x"}`, `name: "  ab "`,
      `contactPhone: "123"` and `proofOfOwnership: "short"` → 422 listing `socialLinks.myspace` and
      `socialLinks.instagram` (`INVALID_LINK`), `name` `MINLENGTH`, `contactPhone` `MATCHES` and
      `proofOfOwnership` `MINLENGTH`.
  - `a_gym_profile`:
    - An owner and three members with LP 900, 500 and 100; the one with 500 hides from leaderboards.
      `GET /gyms/<id>` matches the recorded shape, with `membersCount: 4`, `rank: 1`, and `topAthletes` giving
      the 900 then the 100 (never the hidden athlete). No key holds `contactPhone`, `contactEmail` or the proof.
      A second gym with less LP answers `rank: 2`.
    - `myMembership`: the owner gets `{APPROVED, COACH}` with `canManage: true`; a member `{APPROVED, MEMBER}`
      with `canManage: false`; a stranger `{NONE, null}`; an `ADMIN` account `canManage: true`.
    - A malformed id → 404.
- [ ] **Step 2:** `cargo test -j 4 --test gyms` fails to compile.
- [ ] **Step 3: implement** `mod.rs` and `directory.rs`, with the routes `GET`/`POST /api/v1/gyms`,
  `GET /api/v1/gyms/mine` and `GET /api/v1/gyms/{id}`.
  - The card is one query whose sports come from a `JSON_ARRAYAGG(JSON_OBJECT(…) ORDER BY s.code)` subquery and
    whose `membersCount` comes from a count subquery.
  - The directory wraps it in a derived table, so the keyset can compare the count.
  - The slug, the link check (`Uri`, scheme `http` or `https`, an authority) and the phone pattern are unit tests
    in `directory.rs`.
- [ ] **Step 4:** `cargo test -j 4 --test gyms --test social --lib` passes.
- [ ] **Step 5:** commit `feat(backend): the gym directory, gym creation and profiles`.

### Task 3: memberships and coaches; the gym in `/me`, onboarding and public profiles

**Files:**

- Create: `apps/backend/src/modules/gyms/members.rs`.
- Modify:
  - `apps/backend/src/modules/gyms/mod.rs`;
  - `apps/backend/src/modules/me/mod.rs`, `apps/backend/src/modules/me/onboarding.rs`;
  - `apps/backend/src/modules/social/athletes.rs`;
  - `apps/backend/tests/gyms.rs`.

**Interfaces:** consumes `gym_param`, `manageable`, `a_gym` and `member_of`.

- [ ] **Step 1: write the failing tests** in `tests/gyms.rs`:
  - `joining_and_leaving`:
    - A joins → 201 `{gymId, status: "PENDING"}`; `myMembership.status` is `PENDING`, onboarding `steps.gym` is
      true, and `GET /me` `profile.gym` is still `null`.
    - Joining a second gym → 409 `CONFLICT` with `gymId` and `membershipStatus: "PENDING"`.
    - The owner's `membership-requests` lists A with `userId`, `username`, `fullName` and `requestedAt`.
    - Approving → 200 `APPROVED`. Then:
      - `GET /me` `profile.gym` is `{id, name, slug}` (recorded shape of `GET /me`);
      - `GET /users/a` `gym` is `{id, name}`;
      - the member page lists A as `MEMBER` with `since` (recorded shape).
    - Leaving → 204: `profile.gym` and `/users/a` `gym` are `null`, and `myMembership` is `NONE`.
    - Joining a `PENDING` gym, an unknown one or a malformed id → 404 `Gym`.
  - `two_joins_at_once`: A joins two gyms together (`tokio::join!`) → one 201 and one 409, and one live row.
  - `the_admin_decides`:
    - rejecting → 200 `REJECTED`, after which A can ask again; approving a request that is not pending → 404
      `Membership`;
    - removing → 200 `REMOVED`, and `primary_gym_id` is `NULL`;
    - coach `POST` → 200 `{userId, role: "COACH"}`, twice too, and the member page shows `COACH`. `DELETE` →
      204, and the role is back to `MEMBER`. Either on a non-member → 404 `Membership`;
    - each decision writes its audit row.
  - `who_manages`: a member, a coach, an owner whose role is `USER` and the submitter of a `PENDING` gym each
    get 403 `FORBIDDEN` on `membership-requests`, `approve` and `coach`. An unknown gym → 404 `Gym`. An `ADMIN`
    account may approve.
- [ ] **Step 2:** `cargo test -j 4 --test gyms` fails.
- [ ] **Step 3: implement** `members.rs` and its routes:
  - `POST /api/v1/gyms/{id}/membership`, `DELETE /api/v1/gyms/me/membership`;
  - `GET /api/v1/gyms/{id}/members`, `GET /api/v1/gyms/{id}/membership-requests`;
  - `POST /api/v1/gyms/{id}/members/{user_id}/{approve,reject,remove}`;
  - `POST` and `DELETE /api/v1/gyms/{id}/members/{user_id}/coach`.

  Then `profile.gym` in `me::payload`, `steps.gym` in `onboarding::progress`, and `gym` in `athletes::profile`,
  each a `LEFT JOIN gyms` on `primary_gym_id`.
- [ ] **Step 4:** `cargo test -j 4 --test gyms --test me --test onboarding --test social` passes.
- [ ] **Step 5:** commit `feat(backend): gym memberships and coaches`.

### Task 4: the dashboard

**Files:**

- Create: `apps/backend/src/modules/gyms/dashboard.rs`.
- Modify: `apps/backend/src/modules/gyms/mod.rs`, `apps/backend/tests/gyms.rs`.

**Interfaces:** consumes `manageable`, `policy::week_start` and `policy::business_today`.

- [ ] **Step 1: write the failing test** `the_dashboard` in `tests/gyms.rs`. The setup: an owner and three
  members (B with an accepted workout 3 days ago, C with one 20 days ago, D with none) and one pending request.
  Last week's `weekly_scores` rows are B (total 60, progress 30) and C (70, 50); the week before that holds one
  row. `GET /gyms/<id>/dashboard` answers:
  - `members` = `{approved: 4, pending: 1, activeLast7Days: 1, activeLast28Days: 2}`;
  - `trend`: 8 weeks, oldest first, ending with `{activeMembers: 2, meanScore: 65.0}`, the one before it
    `activeMembers: 1`, the first `{activeMembers: 0, meanScore: null}`;
  - `topProgress`: C (50), then B (30), each with its `name`;
  - `toNudge`: C, D (`lastWorkoutAt: null`) and the owner, and not B;
  - `wods: []`, `wars` all 0 with `enrolled: true`, `gym.rating: 1500`.

  A member gets 403, and an unknown gym 404.
- [ ] **Step 2:** `cargo test -j 4 --test gyms` fails.
- [ ] **Step 3: implement** `GET /api/v1/gyms/{id}/dashboard`. Use one query per block: members with their last
  accepted workout, the pending count, and the weekly rows of the 8 weeks. Do the arithmetic in Rust.
- [ ] **Step 4:** `cargo test -j 4 --test gyms` passes.
- [ ] **Step 5:** commit `feat(backend): the gym dashboard`.

### Task 5: the gym board, `/me/ranks.gym`, gyms in rows, gym snapshots and the gym badge

**Files:**

- Modify:
  - `apps/backend/src/modules/league/boards.rs`, `apps/backend/src/modules/league/mod.rs`,
    `apps/backend/src/modules/league/jobs.rs`;
  - `apps/backend/src/modules/badges.rs`;
  - `apps/backend/tests/leaderboards.rs`, `apps/backend/tests/badges.rs`.

**Interfaces:** `Scope::Gym(Uuid)`; `Row` gains `gym_id: Option<Uuid>` and `gym_name: Option<String>`.

- [ ] **Step 1: write the failing tests:**
  - `tests/leaderboards.rs`, `the_gym_board`:
    - The setup: a gym with three eligible members (900, 500, 100) and an ineligible one, plus a stranger without
      a gym (2 000).
    - `GET /leaderboards/gyms/<id>` lists the three, ranked 1 to 3, each with `gym: {id, name}` (recorded
      shape). `/me` puts the 500 second (recorded shape).
    - `/me/ranks` answers `gym: 2` (recorded shape). The national board shows the stranger with `gym: null`,
      and the stranger's `/me/ranks.gym` is `null`.
    - After `snapshot` yesterday, the 100 overtakes the 500, and the gym board shows the movement (`+1`, `-1`).
    - After the 500 leaves: they are off the board, with `/me/ranks.gym: null`.

    `movement_follows_the_last_snapshot` keeps its 4 rows: neither of its athletes has a gym.
  - `tests/badges.rs`, `a_gym_badge_and_its_notification`: an approved membership. `run_due` awards
    `GYM_MEMBER` with one `BADGE_AWARDED` notification. `GET /badges` shows its progress 1/1.
- [ ] **Step 2:** `cargo test -j 4 --test leaderboards --test badges` fails.
- [ ] **Step 3: implement:**
  - the scope, the two routes (`/api/v1/leaderboards/gyms/{id}` and `/{id}/me`, with a malformed id → 404
    `Gym`), and `gym` in `Row::view`;
  - `my_ranks`'s gym, from `profiles.primary_gym_id`;
  - the `GYM` snapshot insert;
  - the fact, and the sweep's union.
- [ ] **Step 4:** `cargo test -j 4 --test leaderboards --test badges --test league` passes.
- [ ] **Step 5:** commit `feat(backend): the gym board, gym ranks and the gym badge`.

### Task 6: export, anonymisation, security, documents and checks

**Files:**

- Modify:
  - `apps/backend/src/modules/me/privacy.rs`;
  - `apps/backend/tests/privacy.rs`, `apps/backend/tests/security.rs`;
  - the documents: `apps/backend/README.md`, the spec's status line, `handoff.md` and this plan's « Built »
    section.

- [ ] **Step 1: write the failing tests:**
  - `tests/privacy.rs`, `the_export_holds_gyms`: one approved membership and one submitted gym appear under
    ruling 10's keys.
  - `tests/privacy.rs`, `anonymising_ends_gym_ties`: after the sweep:
    - the account has no membership and no primary gym;
    - its `PENDING` gym and that gym's request are gone;
    - its `VERIFIED` gym stays, with `owner_user_id` NULL.
  - `tests/security.rs`, `gym_answers_carry_no_private_data`: the directory, the gym profile, the member page,
    the requests and the dashboard, serialised, contain neither the gym's contact phone, email or proof, nor a
    member's email or birth date.
- [ ] **Step 2:** the three fail. Implement the export keys and the anonymisation statements.
- [ ] **Step 3:** run the checks:
  - `cargo sqlx prepare -- --all-targets`;
  - fmt, then Clippy online and offline;
  - the whole suite in four chunks;
  - `cargo audit` and `cargo deny check`.
- [ ] **Step 4:** update the documents: the README (routes, tables), the spec's status, `handoff.md` and
  « Built ».
- [ ] **Step 5:** commit `docs: Rust backend plan 3b built`.

## Done when

- The 16 routes answer as the table says, with the recorded shapes. `GET /me`, `GET /users/:username`, the
  leaderboard rows and onboarding carry the gym, and `GET /me/ranks` carries `gym`.
- The `GYM_MEMBER` badge is awarded by the sweep, and the gym snapshot gives the gym board its movement.
- Export and anonymisation cover the new tables, and the security suite passes with the new routes behind a
  session.
- fmt, Clippy (online and offline), the whole suite, audit and deny are green, and `.sqlx/` is committed.

## Built (2026-10-23): where the code departs from this plan

- **Anonymisation also deletes the account's remaining verification requests** (ruling 9 extended): a decided
  gym stays without an owner, but the free text of the proof the account wrote goes with the account
  (`anonymising_ends_gym_ties` holds an `APPROVED` request too).
- The gym card lives in `directory.rs`, not `mod.rs`: only the directory and the profile read it. `mod.rs` holds
  `gym_param`, `can_manage` and `manageable`.
- `topAthletes` filters on `show_on_leaderboards` (with an `ACTIVE` account and an active season, as the old API),
  not on the whole board eligibility (verified, calibrated): ruling 7 names the opt-out only.
- The slug is found by inserting and retrying on `uq_gyms_slug`, not by reading first, so two submissions of one
  name at the same moment cannot fail.
- `contactEmail` is stored normalised (trimmed, lower-cased), like every email of the house. It is never shown.
- `sportIds` duplicates are compared once parsed: one id written in two cases is `ARRAYUNIQUE`, not a primary-key
  error.
- Appointing a coach who already is one answers 200 and writes a second `GYM_COACH_APPOINTED` entry, as the old API.
- The dashboard's 403 says « Only this gym's admin can do that. », the detail of every management route; the old
  API said « … can see its dashboard. ».
- `GET /me/ranks` reads the gym board only when I have a primary gym.
- `gym_answers_carry_no_private_data` passed at once: it pins a property the code already had (each answer must
  show the gym or a member, so it is not vacuous).
- **Trap:** `#[sqlx::test]` embeds the migrations at compile time. After adding `0011_gyms.sql`, a run that did not
  rebuild still failed with « Table … gyms doesn't exist »: touch a source file after adding a migration.
- The owner committed tasks 2, 3 and 5 and the `.sqlx` data from the working tree under their own messages, and
  merged the branch into `main` after task 3 (PRs #35 and #36).
- `cargo audit` found two advisories published since plan 3a: `ctutils` (RUSTSEC-2026-0385, under `argon2` and
  `hmac`) and `tokio` (RUSTSEC-2026-0386, unsound). `1d76c25` takes the patched versions (0.4.5 and 1.53.3).
- Checks: fmt, Clippy online and offline, `cargo audit` and `cargo deny check` clean. The whole suite: 131 unit
  tests and 219 integration tests green, 1 ignored, in 23 of 26 files. Claude Code stopped the last chunk for low
  system memory, so `league`, `notifications` and `social` did not run on the final code (`league` and `social`
  passed earlier in the build), and the integration suites were not rerun after the dependency bump.
- The whole-branch review is not done: no agent was spawned (the user did not ask for one). A fresh session runs
  it, as for plan 3a, with this plan's « Review focus » and the ledger
  `.superpowers/sdd/2026-10-21-rust-backend-3b-gyms/progress.md`.
