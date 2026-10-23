# Prompt: Add Live Scoring to My App

Copy everything below the line into your AI coding agent (Claude Code, Cursor, etc.), opened **in your own app's project folder**.
Fill in the 3 lines in "About my app" first. If you leave them empty, the agent will figure them out from the code.
Background research: `circle21-live-scoring-report.md` (same folder). Use it only as a reference for how the feature behaves. Do **not** copy Circle21's code, branding, API keys or texts.

---

## Task

Add a **Live Scoring** feature to my app for CrossFit / functional-fitness competitions:
- Judges score athletes **lane by lane, rep by rep** from their phones.
- Big screens, the event page and the organizer dashboard update **in real time (under 1 second)**.
- When a heat ends, the live scores become **official results** that feed the leaderboard.

## About my app (fill in)

- App name / repo path: `____`
- Stack (front end, back end, database, hosting): `____`
- Existing real-time service, if any (Pusher, Ably, Supabase Realtime, Socket.IO, Firebase…): `____`

## How to work

1. **Explore first; don't write code yet.** Read the codebase and summarize:
   - the stack and folder layout
   - auth and roles
   - existing models for events/competitions, divisions, workouts, athletes/teams, heats, results and leaderboard
   - any real-time infrastructure
   - test setup
   Reuse what already exists. Don't create duplicate models.
2. **Write a short plan.** List the files to add or change, the data model changes, the API endpoints, the real-time channels and events, and the new screens. Show it to me and **wait for my OK** before you start coding.
3. Build in the phases below. After each phase, run the tests and the linter, then show me what changed.
4. Follow the project's existing conventions: naming, folder layout, state management, styling, i18n, error handling.
5. Choosing a real-time service: if the app has none, pick the one that fits the stack. Supabase app: Supabase Realtime. Node server: Socket.IO, or Pusher/Ably if it's serverless. Explain the choice in the plan.

## What to build

### Phase 1: Data model

Add only what's missing:
- **Workout:**
  - `score_type`: `reps | time | load | rounds_reps | distance | calories`
  - `time_cap_seconds`
  - `tiebreak` (optional)
  - `unit`
  - `parts[]`, for multi-part workouts
- **Heat:** `event_id`, `workout_id`, `location_id` (floor/area), `start_at`, `status` (`scheduled | active | finished | validated`)
- **HeatLane:** `heat_id`, `lane_number`, `athlete_id` or `team_id`, `division_id`, `order`
- **LiveState** (one per heat lane): `total`, `attempt`, `attempt_failed`, `time_ms`, `done`, `dnf`, `scaled`, `seq` (number that goes up with each update), `updated_at`, `updated_by_judge_id`
- **Result** (official): `workout_id`, `athlete_id/team_id`, `score_value`, `time_ms`, `tiebreak`, `scaled`, `dnf`, `source` (`live | manual | import | auto`), `status` (`pending | validated`), `judge_comment`, `score_card_photo` (optional)
- **JudgeAccessCode:** `event_id`, `code_hash`, `expires_at`, `created_by`, `revoked_at`
- **JudgeSession:** `judge_name`, `event_id`, optional `heat_id`/`lane` scope, `token_hash`, `expires_at`
- **Event settings:**
  - `leaderboard_visibility` (`random | ranked | hidden`)
  - `scores_public` (bool)
  - `finalists_per_division`
  - `age_filters[]`
  - display options (show photo, secondary info, show flag)

Write migrations that can be rolled back. Store timestamps in UTC (ISO 8601).

### Phase 2: Judge access (more secure than a single shared 6-digit code)

- **Generating the code:**
  - The organizer clicks **"Generate judge code"** in Scoring > Settings.
  - The **server** generates it with a cryptographically secure random function, never `Math.random()` and never in the browser.
  - Length is 6–8 digits, or a short word code.
  - Store **only its hash**. Show the code once, with a copy button.
  - Expiry is configurable (default: end of the event day).
  - Generating a new code **cancels the old one**.
- **Judges logging in:**
  - The judge opens `/judge` on their phone and enters the code and their name.
  - The server returns a short-lived **judge session token**, valid for this event only.
- **Rate limiting:** at most 5 wrong code attempts per 10 minutes per IP and per device. After that, a cooldown starts.
- **Organizer controls:** see the list of active judge sessions and log any judge out.

### Phase 3: Judge scoring screen (mobile first)

- **Flow:** pick location → heat → lane (or arrive through a QR link that already has the heat and lane).
- **Large tap targets:**
  - **+1 / −1** reps, with a long press for +5
  - **Attempt / No-rep**, for lifts
  - **Done**: records the time from the shared heat clock and can be adjusted
  - **DNF**
  - **Scaled** toggle
  - **Clear lane** (asks for confirmation)
- **Sending updates:**
  - Each tap updates the screen immediately, then sends `POST /api/live/heats/{heatId}/lanes/{lane}/events`.
  - Each request includes `{ type, value, seq, client_ts, idempotency_key }`.
- **Offline support:** if the connection drops, queue the taps on the device and send them in order when it comes back. Show a clear "offline / syncing" indicator.
- **End of heat:** the judge sees a summary and taps **Submit**, which creates a `pending` official result. The athlete's signature on the phone is optional.

### Phase 4: Server and real-time broadcast

- **The API is the only way to write scores.** Displays can **never** send events: no client-side events, and read-only channels.
- **On each judge event, the server:**
  1. checks the judge token and that the heat is `active`
  2. rejects requests it has already seen (same `idempotency_key`)
  3. ignores old updates (`seq` lower than the stored one)
  4. updates `LiveState`
  5. broadcasts the update
- **Channels and events.** Name them in the project's style, for example:

| Channel | Events | Payload |
|---|---|---|
| `live.heat.{heatId}` | `score_update`, `time_update`, `done`, `dnf`, `attempting`, `failed`, `scaled`, `clear` | `{ laneId, workoutId, total?, attempt?, attemptFailed?, timeMs?, done?, dnf?, scaled?, seq, serverTs }` |
| `live.event.{eventId}` | `heat_activated`, `heat_finished`, `leaderboard_updated` | `{ heatId, locationId }` / `{ divisionId }` |
| `live.timer.{locationId}` | `timer_config`, `timer_start`, `timer_pause`, `timer_stop` | `{ type: AMRAP/EMOM/FOR_TIME/TABATA, workSec, restSec, rounds, countdownSec, startServerTs }` |
| `live.location.{locationId}` | `lane_selected`, `upcoming_heat`, `show_athlete_score` | IDs only |

- **Snapshot endpoint:** `GET /api/live/heats/{heatId}` returns the full current state of every lane. Screens call it **on page load and after every reconnect**, then apply only updates with a higher `seq`. Screens must never depend only on missed messages.
- **Shared clock:** the timer uses the **server timestamp** (`startServerTs`), and each screen corrects for its own clock difference. That way every screen shows the same time.

### Phase 5: Organizer control panel (Live Tools)

- **Heats:** activate / finish a heat. Activating one broadcasts `heat_activated`, and screens switch to it automatically.
- **Timer:** start / pause / stop the timer for a location.
- **Monitoring:** see every lane live with each judge's connection status, and fix a lane's score by hand. Each fix is logged with who changed what and when.
- **Validation:** validate pending results one by one or for the whole heat, with an "edited after live" warning when they differ.

### Phase 6: Display screens (public, read-only, TV friendly)

- **Routes:** `/live/heat/{heatId}`, `/live/location/{locationId}` (follows the active heat) and `/live/leaderboard/{eventId}`.
- **Lane board:**
  - For each lane: lane number, athlete or team name, photo (optional), flag (optional), division, total, time and status (done / DNF / scaled)
  - Rank updates live
  - A "+N" badge appears for 500 ms when a lane's total goes up
  - The lane that first reaches the top total is highlighted
  - Finish times shown as `mm:ss` or `mm:ss.SSS`
- **Layouts:** all lanes / single lane / multiple divisions / green-screen overlay (transparent background, for streaming). Options are set through URL parameters (`layout`, `textColor`, `showFlag`, `section`).
- **Big-screen setup:** full screen, no login, automatic reconnect, and a "reconnecting…" badge.

### Phase 7: Official results and leaderboard

- **Official scores:** results go `pending` → `validated`. Only **validated** results count, unless the organizer turns on "show provisional scores".
- **Ranking:**
  - per workout and division, using `score_type` and the tiebreak
  - for time-capped "for time" workouts, athletes who didn't finish are ranked by reps after the capped finishers
  - event points use a configurable points table
- **Speed:** cache the leaderboard and rebuild it when results change, then broadcast `leaderboard_updated`. Clients then fetch the new leaderboard over HTTP; don't push the whole leaderboard through the socket.
- **Visibility:** follow the settings (`random | ranked | hidden`, `scores_public`), the finalists cut-off and the age filters.
- **Import:** results can be imported from CSV (with a dry run before importing) and from a URL.

### Phase 8: Scoring > Settings page

Add these sections:
- leaderboard visibility and "scores public"
- Live Scoring (generate / rotate / cancel the judge code, list active judges)
- import results (file / link)
- number of finalists (per division or the same for all)
- age filters
- leaderboard display options
- Save

## Quality requirements

- **Tests:**
  - **Unit tests:**
    - scoring logic (merging live state, `seq` ordering, ignoring duplicates)
    - ranking and tiebreaks
    - time-cap handling
    - judge code hashing, expiry and rate limits
  - **Integration tests:**
    - a judge event updates `LiveState` and broadcasts the right payload
    - a cancelled code or expired token is rejected
  - **End-to-end test:** two browsers, one judge screen and one display screen. A judge's +1 shows on the display in under 1 s. Disconnecting and reconnecting the display restores the correct totals from the snapshot.
- **Security:**
  - No secret real-time keys in front-end code; use only the public key.
  - Only the server broadcasts, and only through the API.
  - Every API input is validated.
- **Accessibility and mobile:** judge buttons at least 64 px tall, high contrast, works one-handed, keeps the screen awake while scoring.
- **Docs:** add a short `docs/live-scoring.md` covering how to run an event (generate code → activate heat → start timer → validate results), plus the environment variables needed.

## Done when

- [ ] An organizer can generate a judge code, and a judge can log in with it on a phone.
- [ ] A judge's taps appear on the live display in under 1 second.
- [ ] Losing the connection on a judge's phone loses no taps.
- [ ] A display that reconnects shows correct totals.
- [ ] The shared timer is in sync (within 200 ms) across screens.
- [ ] Submitting a heat creates pending results, and validating them updates the leaderboard.
- [ ] Visibility settings (random / ranked / hidden, scores public) are respected.
- [ ] All tests and the linter pass, and `docs/live-scoring.md` exists.
