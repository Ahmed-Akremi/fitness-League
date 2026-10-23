# Rust + MariaDB backend, part 3: gyms and social — design

Date: 2026-10-21 · Status: plans 3a (2026-10-21) and 3b (2026-10-23) built; plans 3c to 3f to come; the rulings are open to the
owner's review · Frame: part 1 (`docs/superpowers/specs/2026-10-06-rust-backend-foundation-design.md`) and part 2
(`docs/superpowers/specs/2026-10-18-rust-backend-training-loop-design.md`): their conventions, security rules,
rate-limit plumbing, testing approach, CI and rulings apply unchanged and are not repeated here.

## Intent

Athletes find each other, become friends, follow and block; they join a gym, train on its WODs and fight other gyms;
they battle friends, queue for weekly duels, take on challenges and run their own leagues; they read a feed of their
friends' activity and the admins' news, and a bell tells them what happened. The Rust API answers every one of these
app calls with the old API's routes, shapes and codes.

Nothing in this part is a new product decision. The rules come from:

1. **`docs/ARCHITECTURE.md`**: social tables (§3.8), battles and matchmaking (§3.9), leagues and challenges
   (§3.10), gyms and gym wars (§3.11), notifications (§3.12), the later-phase endpoints and home news (§4.5),
   battle scoring (§5.7), the duel and gym-war algorithms with their worked examples (§6.1, §6.2) and the jobs (§8).
2. **The owner's standing decisions** in `handoff.md` §1 (home news: admins post, athletes only like, a bell
   notification for every post).
3. **The old API** (`apps/api/src/modules/`: `social`, `notifications`, `push`, `gyms`, `gym-wods`, `gym-wars`,
   `duels`, `battles`, `challenges`, `leagues`, `feed`, `realtime`, `announcements`, and the gym and friends parts
   of `leaderboards`). It is the reference implementation, and part 2's ruling 1 holds: where it and
   ARCHITECTURE.md differ, the code wins.

**Part 3 is done when** an athlete pointed at the Rust API can do everything above that the app offers, the worker
runs the gym-war, duel, battle and challenge jobs on a test clock, and the test suites pass, the security suite
included.

## Scope of part 3

Base path `/api/v1`, every route for a signed-in app user. 76 endpoints, the ones the app calls
(`apps/mobile-rn/src/features/{social,notifications,settings,league,gyms,gym-wods,gym-wars,battles,challenges,leagues,feed,announcements,home}`
and `core/realtime.ts`):

| Plan | Area | Routes |
|---|---|---|
| 3a | Friends | `GET /friends`, `GET /friends/requests?direction=in\|out`, `POST /friends/requests`, `POST /friends/requests/:userId/accept`, `…/decline`, `DELETE /friends/:userId` |
| | Follows, blocks | `POST`, `DELETE /follows/:userId`; `POST /blocks/:userId` |
| | Athletes | `GET /search/athletes?q&limit&cursor`, `GET /users/:username` |
| | Notifications | `GET /notifications`, `POST /notifications/read`, `GET`, `PUT /me/notification-preferences` |
| | League | `GET /leaderboards/friends`, `/leaderboards/friends/me` |
| 3b | Gyms | `GET /gyms`, `POST /gyms`, `GET /gyms/mine`, `GET /gyms/:id`, `GET /gyms/:id/dashboard` |
| | Membership | `POST /gyms/:id/membership`, `DELETE /gyms/me/membership`, `GET /gyms/:id/members`, `GET /gyms/:id/membership-requests`, `POST /gyms/:id/members/:userId/approve\|reject\|remove`, `POST`, `DELETE /gyms/:id/members/:userId/coach` |
| | League | `GET /leaderboards/gyms/:id`, `/leaderboards/gyms/:id/me` |
| 3c | Feed | `GET /feed`, `PUT`, `DELETE /activities/:id/reactions`, `GET`, `POST /activities/:id/comments`, `DELETE /activities/:id/comments/:commentId` |
| | Home news | `GET /announcements`, `PUT`, `DELETE /announcements/:id/like` |
| | Live | WebSocket `/ws` (socket.io): `notification.new`, later `battle.score` |
| 3d | Gym WODs | `POST`, `GET /gyms/:gymId/wods`, `GET`, `PATCH /gyms/:gymId/wods/:wodId`, `PUT …/score`, `GET …/leaderboard`, `POST …/scores/:scoreId/invalidate` |
| | Gym wars | `GET /gym-wars/current`, `GET /gym-wars/:id`, `GET /gyms/:id/wars`, `POST /gyms/:id/wars/registration` |
| 3e | Battles | `POST /battles`, `GET /battles`, `GET /battles/:id`, `POST /battles/:id/accept\|decline\|cancel` |
| | Duels | `GET`, `POST`, `DELETE /duels/queue` |
| 3f | Challenges | `GET /challenges`, `POST /challenges`, `GET /challenges/:id`, `POST`, `DELETE /challenges/:id/join`, `DELETE /challenges/:id` |
| | Leagues | `GET /leagues`, `POST /leagues`, `POST /leagues/join-by-code`, `GET /leagues/:id`, `GET /leagues/:id/leaderboard`, `POST /leagues/:id/join`, `DELETE /leagues/:id/membership`, `DELETE /leagues/:id` |

Bodies, answers, field codes and error codes are those of the old API as the app calls them; each plan lists them
route by route.

Part 1 and 2 routes that change:

- `GET /me/ranks`: `friends` (3a) and `gym` (3b) carry real ranks.
- Leaderboard rows and `GET /users/:username` carry `gym: {id, name}` from 3b; `null` before.
- `GET /badges`: the friend (3a), gym (3b), gym-war (3d), battle and duel (3e) and challenge (3f) facts count.
- `GET /me/export` and the anonymisation cover each plan's new tables, in that plan.

### Left out, on purpose

- **Not called by any frontend** (**ruling 1**):
  - `DELETE /blocks/:userId`, `PUT` and `DELETE /me/mutes/:userId`: the app has no unblock or mute screen;
  - `PUT /me/devices`, `DELETE /me/devices/:installId` and push delivery itself: the app never registers a device,
    so there is nothing to push to (**ruling 2**);
  - `PATCH /gyms/:id`, `GET /gyms/me/membership`, `DELETE /gyms/:id/logo`,
    `GET /gyms/:gymId/wods/:wodId/leaderboard/me`, `DELETE /leagues/:id/members/:userId`;
  - other athletes' workouts: the app never opens one, so `GET /workouts/:id` stays owner-only (part 2's 404).
    Workout visibility still decides who sees a workout's feed item (3c).
- **Part 5, with the admin panel and file storage** (**ruling 3**):
  - `PUT /gyms/:id/logo`: it needs file storage and image re-encoding, which part 2's ruling 5 put in part 5 with
    workout proofs. Until then `logoUrl` is `null`;
  - the gym verification queue (`/admin/gyms/verification-requests`). Until then a gym an athlete creates stays
    `PENDING`; tests and the demo seed insert verified gyms;
  - publishing, listing and deleting home news (`/admin/announcements`) and the `ANNOUNCEMENT` fan-out that goes
    with publishing. Part 3 serves the news and the likes, and the notification list already shows the type.

## Social graph (3a)

- **Friendships** are mutual: one row per pair, `(user_low_id, user_high_id)` ordered, `PENDING` or `ACCEPTED`,
  with who asked. Asking someone who already asked me accepts. Declining deletes the request, and so does
  unfriending, which also withdraws a request in either direction.
- **Follows** are one-way and silent: no notification, no approval.
- **Blocks** cut every link at once: the friendship, both follows, and from 3e any pending battle between the two.
  From then on each is invisible to the other: search hides them, their profile answers 404, and a friend request,
  follow or battle is refused as if the account did not exist. Leaderboards still show both, as in the old API.
- **Search** lists active accounts whose username or full name contains the text, accent- and case-insensitive
  (MariaDB's `utf8mb4_uca1400_ai_ci` collation replaces PostgreSQL's `unaccent`), never me, never a blocked
  account, ordered by username with a keyset cursor.
- **Public profile** (`GET /users/:username`): name, bio, governorate, gym, level, division, season LP, follower
  counts, the friendship state seen from me, and the age bracket only when the athlete opted in. Never the email,
  the birth date or body data.

## Notifications

- **One table, written by the code that has the news**, in that code's transaction: `notify(tx, user, type,
  payload)`. The type is one of the 31 the app knows (ENUM, part 1's convention for closed sets; **ruling 4**), the
  payload carries ids and the few words the app prints (a badge's name, a WOD's title), never another account's
  personal data.
- `GET /notifications` pages newest first with the unread count; `POST /notifications/read` marks some or all read.
- Who writes what: friend request and acceptance (3a), badge awarded (3a, for the badges of every part), gym war
  started and result (3d), WOD score invalidated (3d), activity reaction and comment (3c), battle invite, start,
  decline and result, duel matched and ghost (3e), challenge completed (3f); competition, proof, report and
  sanction notifications come with parts 4 and 5; announcements with part 5's publish route.
- **Preferences** (`/me/notification-preferences`): six category switches (`SOCIAL`, `BATTLES`, `COMPETITION`,
  `CHALLENGES`, `BADGES`, `GYM`, all on by default) and optional quiet hours in local time. They are stored and
  served now; they decide pushes once a device can be registered (**ruling 2**). The in-app list always keeps
  everything.
- **Live** (3c): the socket sends `notification.new` to the athlete's open sockets right after the transaction
  commits, so the bell updates without polling. Without a socket the app polls, as it does today.

## Gyms (3b)

- A gym is created `PENDING` by an athlete with a verified email (one pending request at a time) and becomes
  `VERIFIED` through part 5's queue; its creator then becomes its admin.
- **One gym per athlete**: a membership is `PENDING`, `APPROVED`, `REJECTED`, `REMOVED` or `LEFT`, and a unique
  index on a generated column (`user_id` while `PENDING` or `APPROVED`, else `NULL`) allows only one live
  membership (part 1's replacement for a partial unique index). The gym admin approves, rejects, removes and names
  coaches. `profiles.primary_gym_id` follows the approved membership and gets its foreign key.
- The profile shows the city-level location, the member count and the season's top athletes; phone and email stay
  private. The dashboard (gym admin only) shows membership and weekly-score trends.
- **Leaderboards**: the gym board ranks the gym's eligible members (part 2's rules), the snapshot gains the `GYM`
  scope for its movement arrows, and `/me/ranks.gym` reads it. The badge sweep adds approved memberships.

## Feed and home news (3c)

- **Activity events** are written in the transaction of their cause, with the workout's or the athlete's
  visibility: `WORKOUT` and `PR` (workout scoring), `BADGE`, `LEVEL_UP`, `GOAL_COMPLETED` (part 2's code paths),
  `GYM_WAR_WIN` (3d), `BATTLE_WIN` (3e). This is part 2's ruling 9.
- `GET /feed`: my activity and my friends' `FRIENDS` or `PUBLIC` items, never a blocked athlete's, newest first,
  each with its reaction counts, my reaction and its comment count. One reaction per athlete per item; comments can
  be deleted by their author or by the item's owner.
- **Home news**: `GET /announcements` pages the live posts newest first with `likeCount` and `likedByMe`; `PUT` and
  `DELETE …/like` are idempotent and answer `{likeCount, likedByMe}`. There is no comment route.
- **Live socket** (**ruling 5**): the app speaks socket.io (`socket.io-client`), so the server mounts a socket.io
  endpoint at `/ws` with `socketioxide`, authenticated with the access token on connect. Each socket joins its
  athlete's room; `battle.subscribe` (3e) joins a battle's room for its participants only. Events cross processes
  through Redis pub/sub (the old API used PostgreSQL `LISTEN`), so the worker can emit them too.

## Gym WODs and gym wars (3d)

- Coaches (approved members with the coach role, the gym admin, or staff) create and edit WODs; members submit one
  score per WOD (RX or scaled), which counts for the WOD board and plain workout XP, never PRs or national LP. A
  coach can invalidate a score with a reason, which notifies the athlete.
- Gym wars follow ARCHITECTURE §6.2 as the old `gym-war.ts` implements it: eligible rosters frozen at the start,
  pairing by size bracket and gym rating with no rematch within three weeks, scores from the members' closed weekly
  scores, XP to the winner's active members, and Glicko-2 gym ratings. The worked example (Sousse 64.70, Tunis
  63.75) is a unit test.
- Jobs: `gym-war-start` (key: the week) and `gym-war-close` (key: the closable week, after `weekly-close`), in
  `run_due` with `job_runs`, as the old `jobs.runDue`.

## Battles, duels, challenges and leagues (3e, 3f)

- **Friend battles** (ARCHITECTURE §5.7): two friends, a 3- to 14-day window, each side's normalised score over the
  window (the weekly score's components scaled to the window, as the old `computeWindow`), LP and XP with the old
  anti-farming caps. Invitations expire after 48 hours.
- **Weekly duels** (§6.1): opt-in queue from Friday 00:00 to Monday 12:00, hourly pairing batches from Sunday 12:00
  with the widening MMR window, greedy min-cost matching under the hard constraints, ghost duels for whoever is left.
  Glicko-2 with the paper's test vector (1464.06 / 151.52 / 0.05999) as a unit test.
- **Challenges** (§3.10): personal, friend, community and gym challenges on a workout quantity over a window;
  progress recomputed from accepted workouts, completion never undone, XP for community and gym ones. The weekly
  score's challenge component stays off, as rule set v2 has it.
- **Leagues** (§3.10): user-made groups, public or private with an invite code, ranked on their members' weekly
  scores over the league's period with the chosen preset.
- Jobs, each in `run_due` with `job_runs` as the old `jobs.runDue`: `battles.closeDue` and `challenges.closeDue`
  every tick; duel pairing hourly from Sunday 12:00 to Monday 12:00 (key: the hour), else the week's ghost duels.

## Database

Migrations `0010` onwards, part 1's conventions (UUID v7 in `BINARY(16)`, `DATETIME(6)` UTC, ENUMs, real columns,
JSON only for free-shape data).

| Plan | Tables |
|---|---|
| 3a | `friendships` (ordered pair, `CHECK (user_low_id < user_high_id)`), `follows`, `blocks`, `notifications` (type ENUM, payload JSON, `read_at`); `user_settings` gains the six push switches and the quiet hours (`TIME`, both or neither) |
| 3b | `gyms`, `gym_sports`, `gym_members` (generated-column unique index: one live membership), `gym_verification_requests`; `profiles.primary_gym_id` gets its foreign key; `leaderboard_snapshots.scope_type` gains `GYM` |
| 3c | `activity_events`, `activity_reactions`, `activity_comments`, `announcements`, `announcement_likes` |
| 3d | `gym_wods`, `gym_wod_scores`, `gym_wars`, `gym_war_participants`, `gym_ratings` |
| 3e | `battles`, `battle_participants`, `mmr_ratings`, `duel_queue_entries` |
| 3f | `challenges`, `challenge_participants`, `leagues`, `league_members` |

## Security additions

- Every query on a friendship, follow, block, notification, membership or participation carries the caller in its
  `WHERE`; another athlete's notification id simply matches nothing.
- Blocked accounts answer 404 everywhere a profile or an invitation is reached.
- A public profile, a search result, a friend row and a leaderboard row never carry an email, a birth date or body
  data; the security suite checks the profile and the search answers.
- Rate limits, as in the old API: friend requests 30 a day per user, athlete search 60 a minute per user, comments
  30 an hour, battles 10 a day, duel queue 20 an hour, challenge creation 20 a day, league creation 10 a day,
  league codes 10 an hour. The other routes fall under the general limits.
- Routes the old API marked « verified email » (friend requests, gym creation, comments, battles and their
  acceptance, duel queue, challenge and league creation) answer 403 `EMAIL_NOT_VERIFIED` for an unverified account.
- Every new route answers 401 without a token (the route walker in `tests/security.rs`). The socket refuses a
  connection without a valid access token.

## Testing

- **Unit tests** for the pure rules: Glicko-2 (the paper's vector, §6.1's expected score 0.619), the duel MMR window
  and greedy pairing (§6.1's worked example: A–B, D–E, then C–F at 18:00), the gym-war score (§6.2's example), the
  quiet-hours window across midnight, and the push category of each notification type.
- **Integration tests** against real MariaDB and Redis for every route: the friendship state machine both ways and
  under a simultaneous cross request, blocks hiding both sides, search and profile privacy, notifications paging and
  marking, the friends and gym boards, membership rules (one gym, approval, coach), feed visibility, likes counted
  once, each job run twice paying once.
- **Contract check**: for each part 3 route recorded in `apps/mobile-rn/assets/demo/api.json`, the Rust answer has
  the same keys and value types.

## Plans

Built in six plans, each written when the previous one is built, as in parts 1 and 2:

| Plan | Contents |
|---|---|
| **3a, friends and notifications** | `friendships`, `follows`, `blocks`, `notifications`; the 17 routes above; `notify`; the badge notification; the friend badge fact and sweep; the friends board and `/me/ranks.friends`; the « verified email » gate |
| **3b, gyms** | Gym tables, the 16 gym and gym-board routes, `primary_gym_id`, gym snapshots, `/me/ranks.gym`, `gym` in rows and profiles, the gym badge fact |
| **3c, feed and news** | Activity events in the part 2 code paths, the 6 feed routes, the 3 news routes, the socket and `notification.new` |
| **3d, gym WODs and gym wars** | The 11 routes, the gym-war maths and jobs, gym ratings, the gym-war badge fact |
| **3e, battles and duels** | The 9 routes, battle scoring, Glicko-2, matchmaking, the battle and duel jobs, `battle.score`, block cancels pending battles, their badge facts |
| **3f, challenges and leagues** | The 14 routes, challenge progress and completion, `challenge-close`, league boards, the challenge badge fact |

Each plan extends the export and the anonymisation for the tables it adds.

## Rulings the owner can change

1. Routes no frontend calls are left out (unblock, mutes, device registration, gym edit, and the others listed
   above), and `GET /workouts/:id` stays owner-only because the app never opens another athlete's workout.
2. Push preferences are stored and served, but nothing is pushed until the app registers devices; FCM delivery and
   `/me/devices` come with that app change.
3. The gym logo upload, the gym verification queue and the publishing of home news move to part 5, next to file
   storage and the admin panel. Nothing changes for users: the app only reaches the Rust API at the cut-over.
4. A notification's type is an ENUM of the 31 types the app knows.
5. The live socket speaks socket.io through `socketioxide` (a new crate), because the app's client is
   `socket.io-client`; events cross processes through Redis pub/sub.
6. Friend, gym and other social badge facts are awarded by the nightly badge sweep, as in the old API, not at the
   moment the friendship or membership changes.
7. A malformed id in a path answers 404, like an unknown one (part 2's rule), where the old API answered 400.
