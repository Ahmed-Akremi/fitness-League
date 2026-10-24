# Rust backend, plan 3c: feed, home news and the live socket

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Date: 2026-10-23 · Spec: `docs/superpowers/specs/2026-10-21-rust-backend-gyms-social-design.md` (« Scope of part 3 »,
« Notifications », « Feed and home news (3c) », « Database », « Security additions », « Plans ») · Third plan of
part 3, after plan 3b (`docs/superpowers/plans/2026-10-21-rust-backend-3b-gyms.md`).

**Goal:** an athlete reads their own and their friends' activity, reacts and comments; reads the admins' news and
likes it; and the bell updates live through a socket.io connection.

**Architecture:**

- A new module, `modules/feed`:
  - `mod.rs`: the routes, `Activity` and `record` (the only writer of `activity_events`), `viewable`, `GET /feed`;
  - `reactions.rs`: `PUT` and `DELETE /activities/:id/reactions`;
  - `comments.rs`: the comment list, `POST`, `DELETE`.
- A new module, `modules/announcements.rs`: `GET /announcements` and the like routes.
- The part 2 code paths call `feed::record` in their transaction: `scoring::score` (`WORKOUT`, `PR`),
  `scoring::ledger::append_xp` (`LEVEL_UP`), `badges::evaluate` (`BADGE`), `goals::milestones` (`GOAL_COMPLETED`).
- A new file, `src/live.rs`: the socket.io endpoint (namespace `/ws`) and the tail that turns new notification rows
  into `notification.new` events. `http::app_live` returns the router with the socket layer and the `SocketIo`
  handle; `serve` spawns the tail.
- One migration, `0012_feed.sql`.

**Tech stack:** Axum 0.8 and sqlx 0.9 on MariaDB 11.4, as in plan 3b. **One new crate:** `socketioxide` 0.18
(feature `extensions`), spec ruling 5. Tests speak socket.io's text protocol over `tokio-tungstenite`, a dev
dependency already in the tree through `engineioxide`.

**Contract:** the old API's code, as the app calls it.

- **Old API:** `apps/api/src/modules/feed/` (`feed.controller.ts`, `feed.service.ts`), `announcements/`
  (`announcements.controller.ts`, `announcements.service.ts`), `realtime/` (`realtime.gateway.ts`,
  `realtime.module.ts`), `social/social-access.ts` (`canView`), and the event writers:
  `scoring/workout-scoring.service.ts` (`WORKOUT`, `PR`, `LEVEL_UP`), `badges/badges.service.ts` (`BADGE`),
  `goals/goals.service.ts` (`GOAL_COMPLETED`).
- **The app's callers:** `features/feed/api.ts` and `screen.tsx` (`details.sport.name`, `details.durationS`,
  `details.exercise`, `details.value`, `details.badgeName`, `details.to`, `reactions`, `myReaction`, `comments`,
  `isMine`, `user`), `features/announcements/api.ts` (`News`), `core/realtime.ts` (`io(origin + '/ws',
  {transports: ['websocket'], auth: {token}})`, `notification.new`), `features/notifications/api.ts`.
- `apps/mobile-rn/assets/demo/api.json` records `GET /announcements?limit=5` only. The feed shapes are pinned by
  the tests from the old code.

**Where it is built:** this Windows checkout, branch `feat/rust-backend-3`, using the environment line of
`handoff.md` §2.

## Global constraints

Plan 3b's constraints hold unchanged:

- no `unwrap` or `expect` outside tests, and no `unsafe`;
- the caller in the `WHERE` of every query on their own data;
- database errors through `AppError::from(sqlx::Error)`;
- bodies with `deny_unknown_fields`, field paths, and every wrong field reported at once;
- timestamps through `types::iso`, ids from `Uuid::now_v7()`;
- no health value in a log, an error or another account's answer;
- no new public route;
- jobs take the clock as a parameter;
- a malformed id in a path is 404, like an unknown one (spec ruling 7).

And:

- **A feed item, a comment and a socket event** carry no email, birth date or body data. A weight goal's
  `GOAL_COMPLETED` carries its type only, never a value.
- **`activity_events` is written only by `feed::record`,** in the transaction of its cause.
- **The socket authenticates as `AppUser` does** (the token, then the row: status, session version, judge roles
  refused). A refused connection gets socket.io's connect error, never a room.
- Before the last commit: `cargo fmt --check`; Clippy `-D warnings`, online and with `SQLX_OFFLINE=true` (after
  `touch src/lib.rs`); `cargo sqlx prepare -- --all-targets`, with `.sqlx/` committed; `cargo audit` and
  `cargo deny check` (the new crate included).

## Endpoints

| Route | Body or query | Answer |
|---|---|---|
| `GET /feed` | `limit`, `cursor` | 200 `{data: [Item], page}`, newest first |
| `PUT /activities/:id/reactions` | `{type}` | 200 `Reactions`. 404 `Activity` unless viewable. 422 `type` `ISIN` |
| `DELETE /activities/:id/reactions` | — | 200 `Reactions`. 404 as above |
| `GET /activities/:id/comments` | `limit`, `cursor` | 200 `{data: [Comment], page}`, oldest first. 404 as above |
| `POST /activities/:id/comments` | `{body}` | 201 `{id, body, createdAt, isMine: true}`. 403 `EMAIL_NOT_VERIFIED`. 429 at 30 an hour. 404 as above. 422 `body` `MINLENGTH`, `MAXLENGTH` (1 to 500 characters), `EMPTY` once trimmed |
| `DELETE /activities/:id/comments/:commentId` | — | 204. 404 `Comment` unless it is on that activity and not deleted. 403 `FORBIDDEN` « You can only delete your comments or comments on your activity. » |
| `GET /announcements` | `limit`, `cursor` | 200 `{data: [News], page}`, newest first, deleted ones hidden |
| `PUT /announcements/:id/like` | — | 200 `{likeCount, likedByMe: true}`. 404 `Announcement` unless live |
| `DELETE /announcements/:id/like` | — | 200 `{likeCount, likedByMe: false}`. 404 as above |
| socket.io `/ws` (engine.io path `/socket.io/`, WebSocket only) | `auth: {token}` | joins `user:<id>`; receives `notification.new` `{id, type, payload, unread}` |

The shapes:

- **`Item`:** `{id, type, createdAt, user: {id, username, fullName}, isMine, details, reactions: {LIKE, FIRE,
  STRONG}, myReaction: "LIKE" | "FIRE" | "STRONG" | null, comments}`. `comments` counts the comments not deleted.
  `details` is the event's payload, plus what the app prints:
  - `WORKOUT` `{sportId, durationS}` + `sport: {code, name: {fr, en, ar}}`;
  - `PR` `{exerciseId, metric, value, previous}` + `exercise: {fr, en, ar}`;
  - `BADGE` `{badge}` (the code) + `badgeName: {fr, en, ar}`, `badgeIcon`;
  - `LEVEL_UP` `{from, to}`;
  - `GOAL_COMPLETED` `{type}`.
- **`Reactions`:** `{reactions: {LIKE, FIRE, STRONG}, myReaction}`.
- **`Comment`:** `{id, body, createdAt, user: {id, username, fullName}, isMine}`.
- **`News`:** `{id, body, imageUrl: null, imageWidth: null, imageHeight: null, createdAt, likeCount, likedByMe}`.
- **Pages:** `page::limit` with signed cursors `{id}`: the feed and the news by `id` descending, comments by `id`
  ascending.

## Behaviour (the old `FeedService`, `AnnouncementsService` and `RealtimeGateway`)

- **Events**, each through `feed::record` in its cause's transaction:

  | Type | Written by | `ref` | Visibility | Payload | Column |
  |---|---|---|---|---|---|
  | `WORKOUT` | `scoring::score`, before the late-log return | `workout` | the workout's | `{sportId, durationS}` | `sport_id` |
  | `PR` | `scoring::score`, for each `AWARDED` record of an `XP_METRICS` metric | `personal_record` | the workout's | `{exerciseId, metric, value, previous}` | `exercise_id` |
  | `LEVEL_UP` | `ledger::append_xp`, when the stored level rises | `xp_transaction` | `FRIENDS` | `{from, to}` | — |
  | `BADGE` | `badges::evaluate`, for each award | `user_badge` | `FRIENDS` | `{badge: code}` | `badge_id` |
  | `GOAL_COMPLETED` | `milestones::credit`, when its `UPDATE … 'COMPLETED'` touches the row | `goal` | the goal's | `{type}` | — |

- **The feed:** my events, and those of my accepted friends whose visibility is `FRIENDS` or `PUBLIC`, from
  `ACTIVE` accounts, newest first. A block deletes the friendship in its transaction (plan 3a), so a blocked athlete
  is never a friend here. An item whose workout is no longer `ACCEPTED`, or whose record is `REVOKED`, is left out
  in the query.
- **`viewable(conn, me, activity)`** (the old `canView`): mine; else not `PRIVATE`, no block either way, and
  `PUBLIC` or an accepted friendship. Otherwise 404 `Activity`.
- **React:** `viewable`, then `INSERT … ON DUPLICATE KEY UPDATE type = VALUES(type)`. MariaDB answers 1 affected row
  for a new reaction: only then, and when the item is not mine, `notify(ACTIVITY_REACTION, {activityId, type,
  byUserId})`, in the same transaction. **Unreact:** `viewable`, then delete mine.
- **Comments:** the list is `viewable`, then the comments not deleted, never from an account blocked either way. A
  comment: `require_verified`, the rate limit (`COMMENTS_USER`, 30 an hour), `viewable`, the trimmed text, then the
  insert and `notify(ACTIVITY_COMMENT, {activityId, commentId, byUserId})` when the item is not mine, in one
  transaction. **Delete:** the comment's author or the activity's owner sets `deleted_at`.
- **News:** `GET` reads the live posts (`deleted_at IS NULL`) with `likeCount` and `likedByMe`. A like is
  `INSERT IGNORE`, an unlike a `DELETE`, each after the live check, and the answer counts afterwards.
- **The socket:**
  - `SocketIo::builder().transports([TransportType::Websocket])`, namespace `/ws`, whose connect middleware reads
    `auth.token`, runs `auth::app_user(state, token)` and stores the user id in the socket's extensions. Its error is
    the text `UNAUTHENTICATED`. The connect handler joins `user:<id>`;
  - the tail, every second: the notifications created in the last 30 seconds, by the database's clock, that it has
    not emitted yet (a set of ids, pruned to the window), each emitted to `user:<user_id>` as `notification.new`
    `{id, type, payload, unread}`, with the user's unread count. A rolled-back notification never becomes a row, so
    it is never emitted.

## Database (`0012_feed.sql`)

- **`activity_events`:**
  - `id`, `user_id` (FK, cascade);
  - `type ENUM('WORKOUT','PR','BADGE','LEVEL_UP','BATTLE_WIN','GYM_WAR_WIN','GOAL_COMPLETED')` (the app's seven, as
    `notifications.type`);
  - `ref_type ENUM('workout','personal_record','user_badge','xp_transaction','goal','battle','gym_war')`, `ref_id`;
  - `visibility ENUM('PUBLIC','FRIENDS','PRIVATE')`, `payload JSON` (`CHECK (JSON_VALID(payload))`);
  - `sport_id`, `exercise_id`, `badge_id` `NULL` (FK to `sports`, `exercises`, `badges`);
  - `created_at`;
  - `KEY (user_id, id)`.
- **`activity_reactions`:** `activity_event_id` (FK, cascade), `user_id` (FK, cascade), `type
  ENUM('LIKE','FIRE','STRONG')`, `created_at`, `updated_at`; `PRIMARY KEY (activity_event_id, user_id)`,
  `KEY (user_id)`.
- **`activity_comments`:** `id`, `activity_event_id` (FK, cascade), `user_id` (FK, cascade), `body VARCHAR(500)`,
  `created_at`, `deleted_at NULL`; `KEY (activity_event_id, id)`, `KEY (user_id)`.
- **`announcements`:** `id`, `author_id NULL` (FK `users`, set null), `body VARCHAR(2000) NULL`, `created_at`,
  `deleted_at NULL`; `KEY (deleted_at, id)`.
- **`announcement_likes`:** `announcement_id` (FK, cascade), `user_id` (FK, cascade), `created_at`;
  `PRIMARY KEY (announcement_id, user_id)`, `KEY (user_id)`.
- `notifications` gains `KEY ix_notifications_created (created_at)`, for the tail.

## Rulings

1. **The rows the feed prints from are columns** (`sport_id`, `exercise_id`, `badge_id`), next to the old payload,
   which stays as it was (ids included): the feed joins them in its one query. Plans 3d and 3e add `gym_id` and
   `opponent_id` for `GYM_WAR_WIN` and `BATTLE_WIN`.
2. **`LEVEL_UP` is written for every XP grant that raises the level** (in `append_xp`, the only XP writer). The old
   API wrote it only for workout grants, so a level reached through a goal milestone never reached the feed.
3. **The feed filters refused workouts and revoked records in SQL.** The old API dropped them after paging, so a
   page could hold fewer items than its limit.
4. **No mutes** (spec ruling 1): the feed hides blocked athletes, and nobody else.
5. **A reaction notifies once per athlete and item, decided by the upsert's row count** rather than a read first:
   a double tap cannot notify twice.
6. **News has no photo until part 5** (spec ruling 3): no image column; `imageUrl`, `imageWidth` and
   `imageHeight` are `null`. Part 5 adds the photo with file storage and the publish route.
7. **Live events cross processes through the notifications table, not Redis pub/sub** (spec ruling 5 changed):
   every API process tails the rows of the last 30 seconds once a second and emits to its own sockets. The worker's
   notifications (badge sweep, weekly close) reach the sockets with no Redis code, nothing is emitted before its
   transaction commits, and no caller of `notify` changes. Cost: one indexed query a second per API process, and up
   to a second of delay. Plan 3e's `battle.score` has no row; it adds Redis pub/sub (or a row) then.
8. **The socket refuses with socket.io's connect error `UNAUTHENTICATED`**, not the old `error` event followed by a
   disconnect. Both leave the app's socket unconnected. Only `auth.token` is read (the app's way); the old
   `Authorization` header fallback is left out. WebSocket only, as the app connects: no long-polling requests for
   the 10 s request timeout to cut.
9. **Anonymisation deletes the account's activity events** (their reactions and comments go by cascade), **its
   reactions, its comments and its likes.** The old API kept them.
10. **The export gains** `activities` (`{id, type, visibility, createdAt, details}`, my events and their payloads),
    `activityReactions` (`{activityId, type, createdAt}`), `activityComments` (`{id, activityId, body, createdAt,
    deletedAt}`) and `announcementLikes` (`{announcementId, createdAt}`).
11. **A comment's length is checked with the house's codes** (`MINLENGTH`, `MAXLENGTH`; plan 3a's rulings) on the
    text as sent, then `EMPTY` once trimmed; the trimmed text is stored.

## Review focus

1. **A double tap on a reaction** (two first `PUT`s at once): one row, one `ACTIVITY_REACTION` (task 3).
2. **Items I may not see:** a friend's `PRIVATE` workout, a stranger's `PUBLIC` one, a former friend after a block:
   absent from my feed, and reacting or commenting on them is 404 (task 3).
3. **An item whose workout was refused afterwards, or whose record was revoked:** gone from the feed, and the page
   still holds `limit` items when more exist (task 3).
4. **A socket with a forged or expired token, a judge's token, or none:** refused with no room; another athlete's
   socket receives nothing; a notification whose transaction rolled back is never emitted (task 5).
5. **Liking twice, unliking twice, liking a deleted post:** counted once, never below 0, 404 (task 4).

---

### Task 1: the tables

**Files:**

- Create: `apps/backend/migrations/0012_feed.sql`.
- Modify: `apps/backend/tests/schema.rs`.

- [ ] **Step 1: write the failing test** `the_feed_tables_hold_their_rules` in `tests/schema.rs`. Each of these is
  refused:
  - a second reaction by one athlete on one event (primary key);
  - a second like by one athlete on one post (primary key);
  - an event whose payload is not JSON (check);
  - an event of an unknown type (`STRICT_ALL_TABLES`).

  And deleting the event's athlete deletes the event, its reactions and its comments (cascade).
- [ ] **Step 2:** apply the migration to the dev database (`sqlx migrate run --source migrations --database-url
  …`), touch `tests/schema.rs` and `src/lib.rs`. `cargo test -j 4 --test schema` fails, then passes once the
  migration is complete.
- [ ] **Step 3:** commit `feat(backend): the feed and news tables`.

### Task 2: activity events in the part 2 code paths

**Files:**

- Create: `apps/backend/src/modules/feed/mod.rs` (`Activity`, `Kind`, `record` only in this task),
  `apps/backend/tests/feed.rs`.
- Modify:
  - `apps/backend/src/modules/mod.rs`;
  - `apps/backend/src/modules/scoring/mod.rs` (`Scoring` gains `visibility: &'a str`),
    `apps/backend/src/modules/workouts/intake.rs` (passes it);
  - `apps/backend/src/modules/scoring/ledger.rs`, `apps/backend/src/modules/badges.rs`,
    `apps/backend/src/modules/goals/milestones.rs`.

**Interfaces (produces):**

- `feed::Kind { Workout, Pr, Badge, LevelUp, GoalCompleted }` with `as_str` and `ref_type` (`workout`,
  `personal_record`, `user_badge`, `xp_transaction`, `goal`).
- `feed::Activity<'a> { user: Uuid, kind: Kind, ref_id: Uuid, visibility: &'a str, payload: Value, sport:
  Option<Uuid>, exercise: Option<Uuid>, badge: Option<Uuid> }`.
- `feed::record(conn: &mut MySqlConnection, a: Activity<'_>) -> Result<(), AppError>`.

- [ ] **Step 1: write the failing tests** in `tests/feed.rs`, reading `activity_events` directly:
  - `a_workout_writes_its_events`: a calibrated athlete posts a `FRIENDS` strength workout, then a better one.
    The first gives one `WORKOUT` (`ref_type` `workout`, its visibility, payload `{sportId, durationS}`,
    `sport_id` set); the second also gives one `PR` per paid record with `{exerciseId, metric, value, previous}`
    and `exercise_id`. A `PRIVATE` workout gives a `PRIVATE` event. A workout logged 4 days late still gives its
    `WORKOUT` and earns no `LEVEL_UP`.
  - `level_ups_and_badges`: the first workout of a new athlete (the first quest's XP) raises the level: one
    `LEVEL_UP` `FRIENDS` `{from: 1, to: 2}` whose `ref_id` is an `xp_transactions` id; the `FIRST_WORKOUT` badge
    gives one `BADGE` `{badge: "FIRST_WORKOUT"}` with `badge_id`. Use the levels and badge codes the seed gives; if
    the first quest does not reach level 2, set `xp_total` just below the threshold first.
  - `a_completed_goal`: a `HABIT` goal of 1 week, `PUBLIC`, completed by `milestones::on_week_closed` → one
    `GOAL_COMPLETED` `PUBLIC` `{type: "HABIT"}`. A second close writes no second one.
- [ ] **Step 2:** `cargo test -j 4 --test feed` fails to compile.
- [ ] **Step 3: implement** `record`, then the calls:
  - `scoring::score`: the `WORKOUT` event right after `records::record`; the `PR` events for the `prs` with status
    `AWARDED` and a metric in `XP_METRICS`;
  - `ledger::append_xp`: read `level` with `xp_total` (`FOR UPDATE`); when the new level is higher, the
    `LEVEL_UP` event;
  - `badges::evaluate`: keep the `user_badges` id, then the `BADGE` event;
  - `milestones::credit`: when the completing `UPDATE` touches one row, read the goal's `type` and `visibility`
    and write `GOAL_COMPLETED`.
- [ ] **Step 4:** `cargo test -j 4 --test feed --test points --test goals --test badges --test workouts` passes.
- [ ] **Step 5:** commit `feat(backend): activity events from workouts, levels, badges and goals`.

### Task 3: the feed, reactions and comments

**Files:**

- Create: `apps/backend/src/modules/feed/reactions.rs`, `apps/backend/src/modules/feed/comments.rs`.
- Modify:
  - `apps/backend/src/modules/feed/mod.rs` (routes, `viewable`, `GET /feed`), `apps/backend/src/http/mod.rs`;
  - `apps/backend/src/modules/notifications/mod.rs` (`Kind::ActivityReaction`, `Kind::ActivityComment`);
  - `apps/backend/src/http/rate_limit.rs` (`COMMENTS_USER = rule("comments", 30, 3600, false)`);
  - `apps/backend/tests/feed.rs`.

**Interfaces (produces):**

- `feed::routes(api: Api) -> Api`.
- `feed::activity_param(raw: &str) -> Result<Uuid, AppError>`: 404 `Activity` when malformed.
- `feed::viewable(conn: &mut MySqlConnection, me: Uuid, activity: Uuid) -> Result<Uuid, AppError>`: the owner, or
  404 `Activity`.

- [ ] **Step 1: write the failing tests** in `tests/feed.rs`. A local helper befriends two athletes (an
  `ACCEPTED` row in `friendships`), and events are posted as workouts or inserted with `feed::record`.
  - `the_feed`:
    - A, B (A's friend) and C (a stranger). A logs a `FRIENDS` workout; B logs a `FRIENDS` and a `PRIVATE` one; C a
      `PUBLIC` one. A's feed: B's `FRIENDS` item, then A's, newest first; never B's `PRIVATE` or C's. Each item has
      `user`, `isMine`, `details.sport.name.fr`, `details.durationS`, `reactions` `{LIKE: 0, FIRE: 0, STRONG: 0}`,
      `myReaction: null`, `comments: 0`.
    - `limit=1` pages through both with the cursor.
    - After A blocks B, B's items are gone.
    - B's workout set to `REJECTED` in the database leaves the feed; with three items and `limit=2`, the first page
      still holds two.
    - A `BADGE` item has `details.badgeName.fr` and `badgeIcon`; a `PR` item `details.exercise.fr` and `value`.
  - `reactions`:
    - A reacts `FIRE` to B's item → 200 `{reactions: {LIKE: 0, FIRE: 1, STRONG: 0}, myReaction: "FIRE"}`, and B has
      one `ACTIVITY_REACTION` `{activityId, type: "FIRE", byUserId: A}`. Changing to `LIKE` → 200, still one row and
      one notification. `DELETE` → 200 with zeros and `myReaction: null`; a second `DELETE` → 200 too.
    - Two first `PUT`s at once (`tokio::join!`) by a new friend D → one row, one notification.
    - Reacting to my own item notifies nobody. `type: "LOVE"` → 422 `type` `ISIN`. C's `PUBLIC` item can be reacted
      to by A; B's `PRIVATE` one → 404 `Activity`; a malformed id → 404.
  - `comments`:
    - A comments « Beast mode 💪 » on B's item → 201 `{id, body, createdAt, isMine: true}`; B gets one
      `ACTIVITY_COMMENT` `{activityId, commentId, byUserId: A}`. `GET …/comments` lists it with `user` and
      `isMine` (true for A, false for B). The feed's `comments` is 1.
    - `body: "   "` → 422 `body` `EMPTY`; `""` → `MINLENGTH`; 501 characters → `MAXLENGTH`. An unverified athlete
      → 403 `EMAIL_NOT_VERIFIED`. With rate limiting on, the 31st comment within the hour → 429.
    - C may not delete A's comment (403 `FORBIDDEN`); B, the item's owner, may (204); A's second comment is deleted
      by A (204). The list and the count then leave them out. Deleting it again → 404 `Comment`.
    - The comments of an account blocked by the reader are left out of the list.
- [ ] **Step 2:** `cargo test -j 4 --test feed` fails.
- [ ] **Step 3: implement** the six routes:
  - `GET /api/v1/feed`: one query, with the reaction counts, my reaction and the comment count as subqueries and the
    `sports`, `exercises` and `badges` rows `LEFT JOIN`ed; `details` is the payload object with the rendered keys
    added;
  - `PUT` and `DELETE /api/v1/activities/{id}/reactions`, `GET` and `POST /api/v1/activities/{id}/comments`,
    `DELETE /api/v1/activities/{id}/comments/{comment_id}`, as « Behaviour » says.
- [ ] **Step 4:** `cargo test -j 4 --test feed --test notifications --test security` passes.
- [ ] **Step 5:** commit `feat(backend): the feed, reactions and comments`.

### Task 4: home news

**Files:**

- Create: `apps/backend/src/modules/announcements.rs`, `apps/backend/tests/announcements.rs`.
- Modify: `apps/backend/src/modules/mod.rs`, `apps/backend/src/http/mod.rs`.

- [ ] **Step 1: write the failing test** `the_news` in `tests/announcements.rs`, with three posts inserted (one of
  them deleted):
  - `GET /announcements` lists the two live ones, newest first, matching the recorded shape of
    `GET /announcements?limit=5`, with `imageUrl: null`; `limit=1` pages through them.
  - `PUT …/like` → `{likeCount: 1, likedByMe: true}`; again → still 1. A second athlete's like → 2, and the list
    shows `likedByMe` per reader. `DELETE` twice → `{likeCount: 1, likedByMe: false}` both times.
  - The deleted post, an unknown id and a malformed id → 404 `Announcement`.
- [ ] **Step 2:** `cargo test -j 4 --test announcements` fails.
- [ ] **Step 3: implement** `GET /api/v1/announcements`, `PUT` and `DELETE /api/v1/announcements/{id}/like`.
- [ ] **Step 4:** `cargo test -j 4 --test announcements --test security` passes.
- [ ] **Step 5:** commit `feat(backend): home news and likes`.

### Task 5: the live socket

**Files:**

- Create: `apps/backend/src/live.rs`, `apps/backend/tests/live.rs`.
- Modify:
  - `apps/backend/Cargo.toml` (`socketioxide = { version = "0.18", features = ["extensions"] }`; dev:
    `tokio-tungstenite` at the version already in `Cargo.lock`), `apps/backend/src/lib.rs`;
  - `apps/backend/src/http/auth.rs`: `authenticate` splits into the header read and
    `pub async fn app_user(state: &AppState, token: &str) -> Result<AuthUser, AppError>`;
  - `apps/backend/src/http/mod.rs`: `pub fn app_live(state: AppState) -> (Router, SocketIo)`; `app(state)` is
    `app_live(state).0`. The socket layer goes first (innermost), so the request context, the security headers and
    the per-address limit apply to the upgrade;
  - `apps/backend/src/main.rs`: `serve` uses `app_live` and spawns `live::tail`.

**Interfaces (produces):**

- `live::socket(state: AppState) -> (SocketIoLayer, SocketIo)`.
- `live::tail(io: SocketIo, db: MySqlPool)`: the endless loop, one `tail_once` a second, a failure logged with
  `db::describe` and retried on the next tick.
- `live::tail_once(io: &SocketIo, db: &MySqlPool, seen: &mut HashMap<Uuid, NaiveDateTime>) ->
  Result<usize, AppError>`: the number emitted.

- [ ] **Step 1: write the failing tests** in `tests/live.rs`. A helper starts `app_live` on `127.0.0.1:0` and
  opens `ws://…/socket.io/?EIO=4&transport=websocket`; it reads the engine.io open packet (`0{…}`), sends
  `40/ws,{"token":"…"}` and returns the next text frame.
  - `a_socket_needs_a_session`: no auth, a forged token, an expired one and a judge's token each get
    `44/ws,{"message":"UNAUTHENTICATED"…}`; a valid one gets `40/ws,{"sid":…}`.
  - `notifications_reach_their_athlete_live`: A and B connected. B sends A a friend request over HTTP; one
    `tail_once` → A's socket receives `42/ws,["notification.new",{"id":…,"type":"FRIEND_REQUEST","payload":{…},
    "unread":1}]`; B's receives nothing within 300 ms; a second `tail_once` emits 0. A notification inserted in a
    transaction that is rolled back is never emitted.
- [ ] **Step 2:** `cargo test -j 4 --test live` fails to compile.
- [ ] **Step 3: implement** `live.rs`, `app_user`, `app_live` and the spawn in `serve`.
- [ ] **Step 4:** `cargo test -j 4 --test live --test http_shell --test sessions --test security` passes.
- [ ] **Step 5:** commit `feat(backend): the live socket and notification.new`.

### Task 6: export, anonymisation, security, documents and checks

**Files:**

- Modify:
  - `apps/backend/src/modules/me/privacy.rs`;
  - `apps/backend/tests/privacy.rs`, `apps/backend/tests/security.rs`;
  - the documents: `apps/backend/README.md`, the spec's status line, `handoff.md` and this plan's « Built »
    section.

- [ ] **Step 1: write the failing tests:**
  - `tests/privacy.rs`, `the_export_holds_the_feed`: one event, one reaction, one comment and one like appear under
    ruling 10's keys.
  - `tests/privacy.rs`, `anonymising_ends_feed_ties`: after the sweep, the account has no event, reaction, comment
    or like, and another athlete's item it reacted to and commented on is left with neither.
  - `tests/security.rs`, `feed_answers_carry_no_private_data`: the feed and the comment list, serialised, contain
    no email or birth date of the athletes in them, and a weight goal's item no value.
- [ ] **Step 2:** the three fail. Implement the export keys and the anonymisation statements.
- [ ] **Step 3:** run the checks: `cargo sqlx prepare -- --all-targets`; fmt, then Clippy online and offline; the
  whole suite in four chunks; `cargo audit` and `cargo deny check`.
- [ ] **Step 4:** update the documents: the README (routes, tables, the socket), the spec's status, `handoff.md`
  and « Built ».
- [ ] **Step 5:** commit `docs: Rust backend plan 3c built`.

## Done when

- The 9 routes answer as the table says, the news with the recorded shape, and the feed with the old code's shapes.
- Workouts, records, level-ups, badges and completed goals write their events in their transaction.
- A socket with a valid session receives `notification.new` within about a second of the commit; any other is
  refused.
- Export and anonymisation cover the new tables, and the security suite passes with the new routes behind a session.
- fmt, Clippy (online and offline), the whole suite, audit and deny are green, and `.sqlx/` is committed.

## Built (2026-10-23): where the code departs from this plan

- **A reaction is new when `INSERT IGNORE` inserts it** (then an `UPDATE` changes the type), not by the upsert's row
  count (ruling 5 kept, its mechanism changed). sqlx connects with `CLIENT_FOUND_ROWS`, so `ON DUPLICATE KEY UPDATE`
  with the same type counts 1 row, like an insert: the test saw a second `LIKE` notify again. **Trap for later
  plans:** with sqlx, an `UPDATE` that matches a row but changes nothing also counts 1 (found rows), not 0. The
  comment in `gyms/members.rs::set_coach` says the opposite; its code reads the row first, so it is right either way.
- **The refused-workout and revoked-record filters drop an item only when its row exists and is refused or
  revoked**, as the old `withoutDeletedRefs`: an item whose workout row is gone still shows.
- **`PR` items are written for every `AWARDED` record of an `XP_METRICS` metric** (the behaviour table and the old
  filter), not « one per paid record » as task 2's test step worded it.
- `feed::record` returns the event's id; the tests need it, the callers ignore it.
- The tail keeps `seen` as a `HashSet` of the window's ids, replaced each tick, not a map of timestamps: the window's
  own rows say what to forget. It reads the unread count once per athlete of the new rows, not for every row of the
  30 s window (a badge sweep's burst would otherwise be counted again every second for 30 seconds).
- The socket reads its auth payload with `TryData`: a CONNECT without auth, or with a malformed one, is refused like a
  bad token.
- A comment's `EMPTY` check runs after `viewable`; `require_verified` and the rate limit run before it, as the old
  guards and service ordered them. The length codes come first (the body extractor, the house order).
- The schema test checks the cascade by deleting the event, not the athlete (deleting a `users` row touches every
  part's tables; each foreign key declares its cascade).
- `feed_answers_carry_no_private_data` passed at once: it pins a property the code already had (each answer shows an
  athlete, so it is not vacuous), as plan 3b's gym check.
- The owner committed parts of tasks 3 and 5 from the working tree under their own messages, and merged the branch
  into `main` four times during the build (PRs #40 to #43). **PR #43 removed `apps/api`** (the old API) from `main`;
  its code stays in git history, for example `git show 1075b91:apps/api/src/modules/feed/feed.service.ts`.
- `socketioxide` 0.18.7 brings `engineioxide`, `socketioxide-core`, `socketioxide-parser-common`, `matchit` and
  `tokio-tungstenite`/`tungstenite` 0.30 (276 crates in all); `cargo audit` and `cargo deny check` are clean with
  them.
- **The whole suite on the final code (2026-10-24):** the 13 suites the build session could not run passed:
  `privacy` 19, `security` 9, `workouts` 23, `goals` 18, `badges` 8, `league` 20, `leaderboards` 11,
  `notifications` 3, `social` 10, `gyms` 8, `feed` 7, `announcements` 1, `live` 3, including
  `a_socket_outlives_the_request_timeout`, which had never run. The socket layer stays inside the timeout.
- **Whole-branch review (2026-10-24, a fresh session, no agent):** `b6a87cd..HEAD` read against this plan, the
  ledger's rulings, the old `FeedService`, `SocialAccess.canView`, `AnnouncementsService`, `RealtimeGateway` and the
  scoring service's event writes. Points 2 to 5 of « Review focus » hold:
  2. `viewable` is the old `canView` in one query (mine; else not `PRIVATE`, no block either way, `PUBLIC` or an
     accepted friendship), and the feed's friend set is the accepted friendships, which a block deletes;
  3. the refused and revoked filters are `NOT EXISTS` in the feed's `WHERE`, before the `LIMIT`, so a page stays
     full (the test refuses the newest item and pages by 3);
  4. the socket's middleware is `auth::app_user` (the HTTP check: token, status, session version, no judge), and
     only the tail emits, reading committed rows;
  5. a like is `INSERT IGNORE`, an unlike a `DELETE`, each after the live check.

  **Point 1 held for two taps but not for three. Fixed.** Taps beyond the first wait on the new row's key. Each
  `INSERT IGNORE` that finds the duplicate takes a shared lock on it, then needs an exclusive one for the type's
  `UPDATE`. Two such waiters deadlock, and one answers 500 (seen 3 runs out of 3 with three `PUT`s at once). `react`
  now locks the item's row first, so reactions to one item take turns. The athlete's `users` row was not used: a
  notification's foreign-key check takes a shared lock on its recipient's row, so A and B reacting to each other's
  items would deadlock. The test sends three taps (two `FIRE`, one `LIKE`).

  Left as in the old API: a socket stays connected after a logout or a ban until it reconnects (both check at
  connect only); a comment's rate limit is counted before its 404 and 422; the feed's `comments` count includes
  the comments of accounts the reader blocked, which the comment list leaves out.
