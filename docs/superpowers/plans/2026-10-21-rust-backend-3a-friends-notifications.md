# Rust backend, plan 3a: friends and notifications

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Date: 2026-10-21 · Spec: `docs/superpowers/specs/2026-10-21-rust-backend-gyms-social-design.md` · First plan of
part 3, after plan 2d (`docs/superpowers/plans/2026-10-20-rust-backend-2d-league.md`).

**Goal:** athletes find each other, ask, accept, decline and end friendships, follow and block; they read their
notifications (friend requests and acceptances, badges) and set their push preferences; the friends leaderboard and
`/me/ranks.friends` rank them among their friends; friend badges are awarded.

**Architecture:**

- A new module, `modules/social`:
  - `mod.rs`: the routes, and the helpers the other files share (`pair`, `target`, `summaries`);
  - `friends.rs`: friend requests and answers, unfriend, follows, blocks;
  - `athletes.rs`: the athlete search and the public profile.
- A new module, `modules/notifications`:
  - `mod.rs`: the routes, `Kind`, `notify`, the list and « mark read »;
  - `preferences.rs`: `GET` and `PUT /me/notification-preferences`.
- `league/boards.rs` gains a friends scope; `badges.rs` the `FRIEND` fact and the `BADGE_AWARDED` notification;
  `league/jobs.rs`'s badge sweep the athletes whose friendship changed; `me/privacy.rs` the new tables.
- `http/auth.rs` gains the « verified email » gate; `http/rate_limit.rs` two rules.
- One migration, `0010_social.sql`.

**Tech stack:** Axum 0.8 and sqlx 0.9 on MariaDB 11.4, as in plan 2d. No new crate.

**Contract:** the old API's code, as the app calls it.

- **Old API:** `apps/api/src/modules/social/` (`social.controller.ts`, `social.service.ts`, `social-access.ts`),
  `notifications/notifications.service.ts`, `push/push.controller.ts`, `push/push-policy.ts`,
  `push/push.service.ts` (`preferences`, `setPreferences`), `leaderboards/leaderboards.service.ts` (the `FRIENDS`
  scope, `myRanks`), `badges/badges.service.ts` (`award`, the `FRIEND` fact, `sweep`).
- **The app's callers:** `features/social/api.ts` and `screens.tsx` (`friendship` states, `followers`, `seasonLp`,
  `bio`, `gym`), `features/notifications/api.ts` (`unread`, `type`, `payload.userId`, `payload.name`),
  `features/settings/` (preferences), `features/league/api.ts` (scope `friends`).
- `apps/mobile-rn/assets/demo/api.json` records `GET /friends`, `/friends/requests?direction=in|out`,
  `/search/athletes?q=…`, `/users/<name>`, `/notifications`, `/me/notification-preferences`,
  `/leaderboards/friends`, `/leaderboards/friends/me` and `/me/ranks`: the tests check the same keys and types
  (`assert_same_shape`).

**Where it is built:** this Windows checkout, branch `feat/rust-backend-3` (from `origin/main` with
`feat/rust-backend-2d` merged in), with the environment line of `handoff.md` §2.

## Global constraints

Part 2's constraints hold unchanged: no `unwrap` or `expect` outside tests and no `unsafe`; the caller in the
`WHERE` of every query on their data; database errors through `AppError::from(sqlx::Error)`; bodies with
`deny_unknown_fields`, field paths, and every wrong field at once; timestamps through `types::iso`; ids from
`Uuid::now_v7()`; no health value in a log, an error or another account's answer; no new public route; jobs take
the clock as a parameter; every XP or LP writer locks the athlete's `user_stats` row first. And:

- **Never another account's private data:** a friend row, a search result, a profile and a leaderboard row carry no
  email, birth date or body data; the age bracket only when its athlete opted in.
- **A blocked account does not exist** for the other side: 404 `Athlete`, never 403.
- **A notification is written in the transaction of its cause** (`notify(&mut *tx, …)`), so a rolled-back cause
  leaves no notification.
- **A malformed id in a path is 404**, like an unknown one (spec ruling 7).
- Before the last commit: `cargo fmt --check`; Clippy `-D warnings` online and with `SQLX_OFFLINE=true` (after
  `touch src/lib.rs`); `cargo sqlx prepare -- --all-targets` with `.sqlx/` committed.

## Endpoints

| Route | Body or query | Answer |
|---|---|---|
| `GET /friends` | — | 200 `[Summary]`, ordered by username |
| `GET /friends/requests` | `direction=in\|out` (default `in`) | 200 `[Summary]` of pending requests, newest first; 422 `direction` `ISIN` |
| `POST /friends/requests` | `{userId}` | 201 `{status: "PENDING"}`, or `{status: "ACCEPTED"}` when they had asked me; 409 `CONFLICT` (already friends, already sent); 404 `Athlete`; 422 `userId` `SELF`, `ISUUID`, `REQUIRED`; 403 `EMAIL_NOT_VERIFIED`; 429 after 30 a day |
| `POST /friends/requests/:userId/accept` | — | 200 `{status: "ACCEPTED"}`; 404 `Friend request` unless they asked me and it is pending |
| `POST /friends/requests/:userId/decline` | — | 200 `{status: "DECLINED"}`; 404 as above |
| `DELETE /friends/:userId` | — | 204, whatever there was (friendship or a request either way) |
| `POST /follows/:userId` | — | 204, also when already following; 404 `Athlete`; 422 `userId` `SELF` |
| `DELETE /follows/:userId` | — | 204 |
| `POST /blocks/:userId` | — | 204, also when already blocked; 404 `Athlete` for no such account; 422 `userId` `SELF` |
| `GET /search/athletes` | `q` (2 to 40 characters), `limit`, `cursor` | 200 `{data: [Summary], page}`; 422 `q` `REQUIRED`, `MINLENGTH`, `MAXLENGTH`; 429 after 60 a minute |
| `GET /users/:username` | — | 200 `Profile`; 404 `Athlete` |
| `GET /notifications` | `limit`, `cursor` | 200 `{unread, data: [{id, type, payload, read, createdAt}], page}`, newest first |
| `POST /notifications/read` | `{ids?}` (≤ 200 UUIDs) | 204; without `ids` every one is read; 422 `ids` `ISUUID`, `ARRAYMAXSIZE` |
| `GET /me/notification-preferences` | — | 200 `Prefs` |
| `PUT /me/notification-preferences` | `{categories?: {SOCIAL?, BATTLES?, COMPETITION?, CHALLENGES?, BADGES?, GYM?}, quietHours?: {start, end} \| null}` | 200 `Prefs`; absent keys keep their value, `quietHours: null` removes them; 422 `quietHours.start` / `.end` `MATCHES`, `UNKNOWN_FIELD` |
| `GET /leaderboards/friends` | `limit`, `cursor` | 200 as the national board, over me and my friends, `movement: null` |
| `GET /leaderboards/friends/me` | `limit` | 200 as `/national/me` over the same set |

- `Summary` is `{id, username, fullName, governorate, level}`, `governorate` being the code (`TN-51`).
- `Profile` is `{id, username, fullName, bio, ageBracket, governorate: {code, name: {fr, en, ar}}, gym: null, level,
  division, seasonLp, followers, following, friendship}`. `ageBracket` is `policy::age_bracket` of the age today
  when `show_age_bracket`, else `null`; `friendship` is `null`, `"FRIENDS"`, `"REQUEST_SENT"` or
  `"REQUEST_RECEIVED"` seen from me (always `null` on my own profile). `gym` is `null` until plan 3b.
- `Prefs` is `{categories: {SOCIAL, BATTLES, COMPETITION, CHALLENGES, BADGES, GYM: bool}, quietHours: {start, end}
  | null}`, times as `HH:MM` (`^([01]\d|2[0-3]):[0-5]\d$`).
- Pages use `page::limit` and signed cursors: `{u: username}` for the search, `{id}` for notifications.
- `GET /me/ranks` answers `friends`: my rank on the friends board, `null` when I am not eligible.

## Behaviour (the old `SocialService`)

- `pair(a, b)` orders two ids (`Uuid`'s byte order, which is MariaDB's for `BINARY(16)`).
- `target(me, id)`: `SELF` when it is me; 404 `Athlete` unless the account is `ACTIVE` and neither blocked the
  other. Used by friend requests and follows.
- **Friend request**, one transaction: `INSERT IGNORE` the pending pair and notify them `FRIEND_REQUEST`
  `{userId: me}`. When the row existed, read it `FOR UPDATE`: accepted is 409 « Already friends. », mine is 409
  « Request already sent. », theirs is accepted (`accepted_at`) and they get `FRIEND_ACCEPTED` `{userId: me}`.
  Two cross requests at the same time end with one accepted friendship.
- **Accept** is one `UPDATE … WHERE pair AND status = 'PENDING' AND requested_by = them`, then `FRIEND_ACCEPTED` to
  them; **decline** the same `DELETE`; no row touched is the 404.
- **Block**, one transaction: the block row, then the friendship and both follows are deleted (battles: plan 3e).
- **Search:** `ACTIVE`, not me, not blocked either way, `username` or `full_name` `LIKE '%q%'` with `\`, `%` and `_`
  escaped, `ORDER BY username`, keyset on the username.
- **Profile:** by username; 404 when not `ACTIVE`, or (not me and) blocked either way. `followers` and `following`
  count the follows rows.

## Notifications (the old `NotificationsService`, `PushService`)

- `Kind` is `FriendRequest`, `FriendAccepted` and `BadgeAwarded` for now (`as_str`: `FRIEND_REQUEST`…); later plans
  add theirs. The column is the ENUM of all 31 types the app knows (spec ruling 4).
- `notify(conn, user, kind, payload)` inserts one row with a new id; nothing else (the socket comes with plan 3c).
- « Mark read » sets `read_at` on my unread rows, all or those in `ids`, in one `UPDATE` joined to
  `JSON_TABLE(?, '$[*]' …)` of the ids; another athlete's id matches nothing.
- Preferences: an absent category is on. `PUT` merges into the stored values and answers the result.

## Badges

- `Fact::Count(Event::Friend)` counts my accepted friendships.
- `badges::evaluate` notifies `BADGE_AWARDED` `{badge: code, name: {fr, en, ar}}` for each badge it awards, in its
  transaction (the old `award`). This covers every award path of part 2.
- The badge sweep adds, as the old `sweep`, both sides of every friendship accepted (its `updated_at`) in the last
  26 hours (spec ruling 6: no evaluation at the moment of acceptance).

## Database (`0010_social.sql`)

- **`friendships`:** `user_low_id`, `user_high_id` (both FK `users`, cascade), `status ENUM('PENDING','ACCEPTED')`,
  `requested_by BINARY(16)` (FK `users`, cascade), `accepted_at NULL`, `created_at`, `updated_at`;
  `PRIMARY KEY (user_low_id, user_high_id)`, `KEY (user_high_id)`, `CHECK (user_low_id < user_high_id)`,
  `CHECK (requested_by IN (user_low_id, user_high_id))`.
- **`follows`:** `follower_id`, `followee_id` (FK, cascade), `created_at`; `PRIMARY KEY (follower_id, followee_id)`,
  `KEY (followee_id)`, `CHECK (follower_id <> followee_id)`.
- **`blocks`:** `blocker_id`, `blocked_id` (FK, cascade), `created_at`; `PRIMARY KEY (blocker_id, blocked_id)`,
  `KEY (blocked_id)`, `CHECK (blocker_id <> blocked_id)`.
- **`notifications`:** `id`, `user_id` (FK, cascade), `type ENUM(<the 31 types of the old NotificationType>)`,
  `payload JSON CHECK (JSON_VALID(payload))`, `read_at NULL`, `created_at`; `KEY (user_id, id)`,
  `KEY (user_id, read_at)`.
- **`user_settings`** gains `push_social`, `push_battles`, `push_competition`, `push_challenges`, `push_badges`,
  `push_gym` `BOOLEAN NOT NULL DEFAULT TRUE`, and `quiet_hours_start`, `quiet_hours_end` `TIME NULL` with
  `CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL))`.

## Rulings

1. **Friend rows are ordered by username**, request rows newest first: the old API left the first unordered.
2. **The search keeps the old reach:** every `ACTIVE` account with a profile, verified or not, onboarded or not.
3. **A block needs an existing account** (404 `Athlete` otherwise); the old API failed on the foreign key.
4. **`EMAIL_NOT_VERIFIED`** is a new gate, `AuthUser::require_verified`, the port of the old
   `@RequiresVerifiedEmail()`; here only `POST /friends/requests` uses it.
5. **Validation codes are the house's:** `MINLENGTH`/`MAXLENGTH` for the search text (the old `Length` said
   `ISLENGTH`), `INVALID` for a non-boolean category.
6. **Push preferences are six columns**, not the old JSON, part 1's « real columns » convention.
7. **Anonymisation deletes the account's friendships, follows, blocks (both ways) and notifications**; the old API
   kept them. Notifications other athletes received about the account keep only its opaque id.
8. **The export gains** `friendships` (`{userId, status, requestedByMe, createdAt, acceptedAt}`), `following`,
   `blocked` (`{userId, createdAt}`), `notifications` and `notificationPreferences`.
9. **The friends board has no snapshot,** so its `movement` is `null`, as in the old API.

## Review focus

1. Two athletes asking each other at the same moment end friends, with one row and no 500 (task 3).
2. After a block, nothing of either athlete reaches the other: profile, search, request, follow (tasks 3 and 4).
3. A search text with `%`, `_` or `\` matches those characters literally (task 4).
4. Another athlete's notification id in « mark read » changes nothing (task 2).
5. The friends board ranks only eligible athletes, and an ineligible me gets `me: null` and `friends: null` (task 5).

---

### Task 1: the tables

**Files:**

- Create: `apps/backend/migrations/0010_social.sql`.
- Modify: `apps/backend/tests/schema.rs`.

- [ ] **Step 1: write the failing test** in `tests/schema.rs`, `the_social_tables_hold_their_rules`: a friendship
  with `user_low_id > user_high_id` is refused (CHECK), the same pair twice is a unique violation, a follow and a
  block of oneself are refused, a notification of an unknown type is refused, and `quiet_hours_start` without
  `quiet_hours_end` is refused.
- [ ] **Step 2:** apply the migration to the dev database (`sqlx migrate run --source migrations --database-url …`);
  `cargo test -j 4 --test schema` fails, then passes once the migration is complete.
- [ ] **Step 3:** commit `feat(backend): the social and notification tables`.

### Task 2: notifications, « mark read » and preferences

**Files:**

- Create: `apps/backend/src/modules/notifications/mod.rs`, `apps/backend/src/modules/notifications/preferences.rs`,
  `apps/backend/tests/notifications.rs`.
- Modify: `apps/backend/src/modules/mod.rs`, `apps/backend/src/http/mod.rs`.

**Interfaces (produces):**

- `notifications::Kind` (`FriendRequest`, `FriendAccepted`, `BadgeAwarded`) with `as_str(self) -> &'static str`.
- `notifications::notify(conn: &mut MySqlConnection, user: Uuid, kind: Kind, payload: Value) -> Result<(), AppError>`.
- `notifications::routes(api: Api) -> Api`.

- [ ] **Step 1: write the failing tests** in `tests/notifications.rs`:
  - `my_notifications_page_newest_first`: three `notify` calls for me and one for another athlete; `GET
    /notifications?limit=2` gives the two newest with `unread: 3`, `hasMore: true`, and its cursor the third; the
    shape matches the recorded `GET /notifications`.
  - `marking_read`: `{ids: [<the newest>]}` → 204 and `unread: 2`; `{ids: [<the other athlete's>]}` → 204 and
    theirs stays unread; `{}` → `unread: 0`; `{ids: ["x"]}` → 422 `ids` `ISUUID`; 201 ids → 422 `ids`
    `ARRAYMAXSIZE`.
  - `push_preferences`: the default is every category `true` and `quietHours: null` (the recorded shape);
    `{categories: {SOCIAL: false}, quietHours: {start: "22:00", end: "07:00"}}` is answered back; `{}` keeps it;
    `{quietHours: null}` removes the hours only; `"24:00"` → 422 `quietHours.start` `MATCHES`;
    `{categories: {PARTY: true}}` → 422 `categories.PARTY` `UNKNOWN_FIELD`.
- [ ] **Step 2:** `cargo test -j 4 --test notifications` fails to compile.
- [ ] **Step 3: implement** the two files and the routes (`GET /api/v1/notifications`,
  `POST /api/v1/notifications/read`, `GET` and `PUT /api/v1/me/notification-preferences`). The time check is a
  unit test of `hhmm(&str) -> Option<NaiveTime>`: `"07:00"`, `"23:59"` parse; `"7:00"`, `"24:00"`, `"12:60"`,
  `"12:00:00"` do not.
- [ ] **Step 4:** `cargo test -j 4 --test notifications --lib` passes.
- [ ] **Step 5:** commit `feat(backend): notifications, mark read and push preferences`.

### Task 3: friends, follows and blocks

**Files:**

- Create: `apps/backend/src/modules/social/mod.rs`, `apps/backend/src/modules/social/friends.rs`,
  `apps/backend/tests/social.rs`.
- Modify: `apps/backend/src/modules/mod.rs`, `apps/backend/src/http/mod.rs`, `apps/backend/src/http/auth.rs`,
  `apps/backend/src/http/rate_limit.rs`.

**Interfaces:**

- Consumes: `notifications::notify`, `Kind::FriendRequest`, `Kind::FriendAccepted`.
- Produces: `social::pair(a: Uuid, b: Uuid) -> (Uuid, Uuid)`; `social::summaries(db: &MySqlPool, ids: &[Uuid]) ->
  Result<Vec<Value>, AppError>` (in the order given); `AuthUser::require_verified(&self) -> Result<(), AppError>`;
  `rate_limit::FRIEND_REQUESTS_USER` (`friend-requests`, 30 per 86 400 s) and `rate_limit::SEARCH_USER` (`search`,
  60 per 60 s), both failing open like `WORKOUTS_USER`.

- [ ] **Step 1: write the failing tests** in `tests/social.rs` (a local `friend(app, name)` helper makes a verified
  athlete):
  - `a_friend_request_is_accepted`: A asks B → 201 `PENDING`, B has a `FRIEND_REQUEST` `{userId: A}`; A asks again →
    409 `CONFLICT`; B's `direction=in` and A's `direction=out` list the other (recorded shapes); B accepts → 200
    `ACCEPTED`, A has `FRIEND_ACCEPTED` `{userId: B}`; both `/friends` list the other (recorded shape); A asks
    again → 409.
  - `asking_back_accepts`: A asks B, B asks A → 201 `ACCEPTED`, one row.
  - `crossed_requests_make_one_friendship`: A→B and B→A sent together (`tokio::join!`) answer `PENDING` and
    `ACCEPTED` in some order; one `ACCEPTED` row.
  - `declining_and_unfriending`: B declines → 200 `DECLINED` and no row; accepting it again → 404; A cannot accept
    their own request → 404; once friends, `DELETE /friends/B` → 204 and no row; a malformed id → 404.
  - `who_can_be_asked`: myself → 422 `userId` `SELF`; an unknown id → 404; `{}` → 422 `userId` `REQUIRED`;
    `{userId: "x"}` → 422 `ISUUID`; an unverified asker → 403 `EMAIL_NOT_VERIFIED`; a suspended target → 404.
  - `follows_are_silent`: follow → 204 twice, one row, no notification; unfollow → 204, no row; myself → 422.
  - `a_block_cuts_every_link`: A and B friends, following each other; A blocks B → 204 (twice too); no friendship,
    no follow either way; B asking A, A following B → 404 both.
- [ ] **Step 2:** `cargo test -j 4 --test social` fails to compile.
- [ ] **Step 3: implement** `require_verified` (403 `EMAIL_NOT_VERIFIED`, « Email address not verified »), the two
  rules, `social/mod.rs` and `friends.rs` with their routes.
- [ ] **Step 4:** `cargo test -j 4 --test social` passes.
- [ ] **Step 5:** commit `feat(backend): friend requests, follows and blocks`.

### Task 4: the athlete search and the public profile

**Files:**

- Create: `apps/backend/src/modules/social/athletes.rs`.
- Modify: `apps/backend/src/modules/social/mod.rs`, `apps/backend/tests/social.rs`.

**Interfaces:** consumes `social::summaries`, `social::pair`, `rate_limit::SEARCH_USER`.

- [ ] **Step 1: write the failing tests** in `tests/social.rs`:
  - `the_search`: athletes `sami`, `samira` and `karim`; `q=sam` lists `sami` then `samira` (recorded shape of a
    search), never me; `limit=1` pages through both with the cursor; a full name « Émna Ben Ali » is found by
    `q=emna`; `q=%_` finds nobody; `q=a` → 422 `q` `MINLENGTH`; no `q` → 422 `q` `REQUIRED`; a blocked athlete,
    either way, is not listed; a suspended one neither.
  - `a_public_profile`: the recorded shape of `GET /users/sami`; no key holds the email or the birth date;
    `ageBracket` is `null`, then the bracket once `show_age_bracket` is set; `followers` counts a follow;
    `friendship` reads `REQUEST_SENT`, `REQUEST_RECEIVED`, `FRIENDS` and `null` on my own profile; an unknown
    username, a suspended account and a block either way → 404.
- [ ] **Step 2:** `cargo test -j 4 --test social` fails.
- [ ] **Step 3: implement** `athletes.rs` (`GET /api/v1/search/athletes`, `GET /api/v1/users/{username}`).
- [ ] **Step 4:** `cargo test -j 4 --test social` passes.
- [ ] **Step 5:** commit `feat(backend): the athlete search and public profiles`.

### Task 5: the friends board, `/me/ranks.friends` and friend badges

**Files:**

- Modify: `apps/backend/src/modules/league/boards.rs`, `apps/backend/src/modules/league/mod.rs`,
  `apps/backend/src/modules/badges.rs`, `apps/backend/src/modules/league/jobs.rs`, `apps/backend/tests/leaderboards.rs`,
  `apps/backend/tests/badges.rs`.

**Interfaces:** `Board::of(state, user, scope: Scope)` with `enum Scope { National, Governorate(Uuid),
Friends(Uuid) }`; a friends board compares with no snapshot. Consumes `notifications::notify`,
`Kind::BadgeAwarded`.

- [ ] **Step 1: write the failing tests:**
  - `tests/leaderboards.rs`, `the_friends_board`: me (500 LP), two friends (900, 100), a stranger (2 000), a pending
    friend (700) and an ineligible friend; the board lists the first three, ranked 1 to 3, `movement: null`
    (recorded shape); `/me` puts me second; `/me/ranks` answers `friends: 2`. `my_ranks` now expects `friends: 1`
    for an athlete alone, and still `null` for an ineligible one.
  - `tests/badges.rs`, `a_friend_badge_and_its_notification`: A and B friends (accepted in the last hours);
    `run_due` awards both `FIRST_FRIEND`, and each gets one `BADGE_AWARDED` `{badge: "FIRST_FRIEND", name: {fr, en,
    ar}}`; `GET /badges` shows its progress 1/1.
- [ ] **Step 2:** `cargo test -j 4 --test leaderboards --test badges` fails.
- [ ] **Step 3: implement** the scope, the two routes (`/api/v1/leaderboards/friends`, `/friends/me`), `my_ranks`,
  the fact, the notification in `evaluate`, and the sweep's union.
- [ ] **Step 4:** `cargo test -j 4 --test leaderboards --test badges --test goals --test points` passes (the last two
  award badges in the scoring path).
- [ ] **Step 5:** commit `feat(backend): the friends board, friend badges and badge notifications`.

### Task 6: export, anonymisation, security, documents and checks

**Files:**

- Modify: `apps/backend/src/modules/me/privacy.rs`, `apps/backend/tests/privacy.rs`, `apps/backend/tests/security.rs`,
  `apps/backend/README.md`, the spec's status line, `handoff.md`, this plan's « Built » section.

- [ ] **Step 1: write the failing tests:**
  - `tests/privacy.rs`, `the_export_holds_friends_and_notifications`: one friendship, one follow, one block, one
    notification and changed preferences appear under the keys of ruling 8.
  - `tests/privacy.rs`, `anonymising_cuts_the_social_links`: after the sweep, no friendship, follow or block names
    the account and its notifications are gone.
  - `tests/security.rs`, `profiles_and_searches_carry_no_private_data`: a profile, a search page, the friend list
    and the friends board, serialised, contain neither the email, the birth date nor a body measurement's value of
    the athlete shown.
- [ ] **Step 2:** the three fail; implement the export keys and the anonymisation deletes.
- [ ] **Step 3:** `cargo sqlx prepare -- --all-targets`; fmt; Clippy online and offline; the whole suite in four
  chunks; `cargo audit` and `cargo deny check`.
- [ ] **Step 4:** documents: README (routes, tables), the spec's status, `handoff.md`, « Built ».
- [ ] **Step 5:** commit `docs: Rust backend plan 3a built`.

## Done when

- The 17 routes answer as the table says, with the recorded shapes, and `GET /me/ranks` carries `friends`.
- The friend badges are awarded by the sweep and every badge award writes its notification.
- Export and anonymisation cover the new tables; the security suite passes with the new routes behind a session.
- fmt, Clippy (online and offline), the whole suite, audit and deny are green, and `.sqlx/` is committed.

## Built

To be written once the plan is built.
