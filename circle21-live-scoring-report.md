# How Circle21 Live Scoring Works

Investigation date: 2026-10-22
Page studied: `https://circle21.events/myevent/scoring/settings?competitionId=e5c5f79c-2e0f-4790-b6ae-8e60682d3486&date=2026-10-22`
Method: logged-in session in Brave (separate temporary profile), passive page and network capture through Chrome DevTools Protocol, plus reading the site's public JavaScript (~94 Next.js chunks). Nothing in the event was clicked, changed or saved.

The prompt to build this feature in your own app is in `live-scoring-build-prompt.md` (same folder).

---

## 1. Big picture

```
Judge's phone (Circle21 mobile app)  --enters 6-digit "Live Scoring" password-->  circle21 backend
        | taps reps / time / done / no-rep                                      |
        v                                                                       v
   api.circle21.events  --broadcasts in real time via Pusher-->  one channel per heat ("<heatId>")
                                                                       |
                  +----------------------------------------------------+-----------------------+
                  v                                                    v                       v
        TV / big-screen pages                              broadcast / green-screen       admin pages
        (/embedLiveHeat..., /embedTvDisplay)               overlays                       (leaderboard via REST)
```

- **Front end:** Next.js (pages router), React Query, axios.
- **API:** `https://api.circle21.events/api/...` (REST, paginated `page` / `per_page`).
- **Real time:** Pusher Channels, EU cluster (`wss://ws-eu.pusher.com`, pusher-js 7.6.0), wrapped in React hooks (`useChannel`, `useEvent`).
- **Judges:** use the separate **Circle21 mobile app** (App Store id1582295158, Play Store `app.circle21.circle21`), not the website.

---

## 2. The Scoring > Settings page (what you see)

| Section | Content |
|---|---|
| Leaderboard Visibility Policy | Random order of registered athletes / **Display leaderboard in order of scores** (selected) / Hide leaderboard. Toggle: **Scores are public** (on). |
| **Live Scoring** | "Generate a password for Live Scoring Judging App" button + the current 6-digit code + copy icon. |
| Import Results | Import results from a file (`POST /api/workouts/results/bulk-upload`, multipart: `file`, `workout_id`) or a link (`POST /api/workouts/results/import-url`, supports `dry_run`). |
| Set number of finalists | Per division, or "Same for all divisions". |
| Age Filters | Age ranges used to group athletes on the leaderboard. |
| Athlete/Team representation | Name, large image (left side), secondary info (Club Name), Show flag. |

Other Scoring sub-pages: Leaderboard, by HEAT's (`/myevent/scoring/beta-heats`), Judging (`/myevent/scoring/judging`), Tutorials.

---

## 3. The judges' password (`live_scoring_otp`)

Seen in the code of the settings page (component `LiveScoringOTP`):

- It's stored as a field on the competition: `competition.live_scoring_otp`.
- **Generate password** runs `Math.floor(100000 + 900000 * Math.random())` **in the browser**, then saves it with a competition update mutation (`{ live_scoring_otp: <code> }`) and shows "OTP updated successfully".
- The copy icon copies it to the clipboard.
- Judges type this code into the mobile judging app.

Security notes (inference):
- It's one shared 6-digit code per competition (900,000 possibilities).
- It's generated with `Math.random()`, which isn't cryptographically secure, and generated client-side.
- Whether the server limits wrong guesses can't be seen from the website.
- Advice: generate a new code before each event day and share it only with judges.

---

## 4. Real-time channels and events

All channels are **public** Pusher channels (subscribe auth is empty). Browsers never use Pusher "client events" (0 `client-` triggers found). Instead, every event is broadcast by the Circle21 server. The organizer's web pages ask the server to broadcast through a general relay, **`POST /api/push-message {channel, event, message}`** (used for timers, lane selection, upcoming heat and starting waves). The **score** events (`movement_update`, …) don't appear in the website code, so they most likely come from the judge app (through that relay or a dedicated endpoint). *Corrected after the event-organisation investigation; see `circle21-event-organisation-report.md`.*

### 4.1 Per-heat scoring channel: `"<heatId>"`

Each event's data is `{ message: "<JSON string>" }`.

| Event | Payload (inside `message`) | Effect on screens |
|---|---|---|
| `movement_update` | `{ total?, attempt?, attemptFail?, heatUserId, workoutId }` | Updates a lane's rep total, or the current lift attempt / failed attempt |
| `time_update` | `{ time (ms), heatUserId, workoutId }` | Shows a finish / split time |
| `done` | `{ heatUserId, workoutId }` | Marks the athlete finished |
| `dnf` | `{ heatUserId, dnf: 0/1 }` | Did not finish |
| `attempting` | `{ heatUserId }` | Lift in progress |
| `failed` | `{ heatUserId }` | Failed lift / no-rep |
| `scaled` | `{ heatUserId, scaled: 0/1, workoutId }` | Athlete is doing the scaled version |
| `clear` | `{ heatUserId }` | Resets the lane |

Screen logic seen in `useHeatScoring` / `useHeatScoringMultiLanes`:
- **Merging:** each update is merged into `scores[heatUserId]`.
- **"+N" badge:** when `total` changes, a `diff` (+N) is stored and removed after 500 ms.
- **Leader highlight:** the first lane to reach the highest total gets `firstReached` (leader effect).
- **Workout switch:** if `workoutId` changes (multi-part workouts), lane state is reset.
- **Units:** reps, ft, mi, lb, m, km, cal, kg, rounds. Times are shown as `mm:ss` or `mm:ss.SSS`.

### 4.2 Other channels

| Channel | Events | Purpose |
|---|---|---|
| `heat_activated_<competitionId>` | `call_warm_up` with `{ heat_id, location_id, stream_active }` | Switches screens / streams to the active heat |
| `online_timer_<id>` | `timer_config`, `timer_start`, `timer_pause`, `timer_stop` | Shared clock: AMRAP, EMOM, countdown, work/rest/rounds, server `start_timestamp` |
| `heat_user_updated_<competitionId>` | `call_warm_up`, `call_corral`, `warm_up_checkin`, `corral_checkin` | Calling athletes to warm-up / corral and check-ins ("Call Screen") |
| `laneSelection_<locationId>` | `laneSelected` with `{ heat_id, lane_number, location_id, division_id }` | Picks which lane a single-lane screen shows |
| `upcomingHeat_<locationId>` | `upcomingHeat` | "Next heat" screen |
| `athlete_score_<competitionId>` | `show_athlete_score` with `{ division_id, athlete_id or team_id }` | Pops up one athlete's score card |
| `competition_chat_<competitionId>` | `new_message`, `mark_read` | Event messaging (the only channel opened on the settings page) |

---

## 5. Live score vs. official result

- **Live events only update displays.** The official result is a separate record:
  - Create: `POST /api/workouts/{workoutId}/results?athlete_id=… | team_id=…` (multipart, optional `score_card` photo, `judge_comment`).
  - Update: `POST /api/workouts/{workoutId}/results/{resultId}` with `_method=PUT`.
  - Bulk edit: `PUT /api/workouts/{wodExerciseId}/results/{id}`.
- **Result states:** `judging_state` is `MANUAL_SCORE` (typed by a person) or `AUTO_SCORE` (calculated, e.g. for-time workouts with a time cap use reps when the cap is hit).
- **Leaderboards are fetched over REST, not Pusher:**
  - `GET /api/leader_live?competition_id=…&division_id=…` and `/api/leader_live/team?…`
  - `GET /api/leaderboard?…` and `/api/leaderboard/team?…`
  - `POST /api/leaderboard/cache` (rebuild the cache)
- **Heat management:** `/api/new/heats` (create / update / delete / clear / move athletes), `POST /api/heats/{id}/athletes/order` (lane order), `POST /api/heats/{id}/announcement` (announce results, optional notification).

---

## 6. Display screens (routes found in the build manifest)

- **Live heat screens:** `/embedLiveHeat`, `/embedLiveHeatNew`, `/embedLiveHeatMultiLanes`, `/embedLiveHeatSingleLane`, `/embedLiveHeatAllLanesWithImages`, `/embedLiveHeatMultipleDivisions`, `/embedLiveHeatRackScreens`, `/embedLiveHeatVideoBeam`, `/embedLiveHeatSingleLaneGreenScreen`, `/embedLiveHeatAllLanesGreenScreen`, `/embedLiveDogRace`.
- **Broadcast and TV:** `/embedLiveScoringBroadcast`, `/embedTvDisplay`, `/embedActiveHeat`, `/embedUpcomingHeat`, `/embedHeatIntroScreen`, `/embedHeatResult`, `/embedShowAthleteScore`.
- **Leaderboards:** `/embedLeaderboard`, `/embedEventLeaderboard`, `/embedDivisionLeader`, `/embedWorkoutsLeaderboard`.
- **Organizer tools:** `/myevent/tools/live`, `/myevent/tools-beta/live`, `/myevent/scoring/judging`, `/judge-panel` and `/judge-review` (video-submission judging for online events).

Screens are configured with URL options (layout, text color, show flag, section, location) and keep them in the address bar.

---

## 7. What's certain vs. inferred

- **Seen directly:**
  - The logged-in settings page and its contents.
  - REST calls on load: `/api/auth/me`, `/api/competition/{id}`, `/api/competition/{id}/admin`, `/api/conversations`.
  - The Pusher connection plus subscription to `competition_chat_<id>`.
  - No score events during the capture, because no heat was running.
- **Read from the site's JavaScript (static):** all channel names, event names, payload fields, API paths and the password generation above.
- **Inferred (high confidence):** the server broadcasts every live event. Organizer pages trigger theirs through `/api/push-message`, and score events most likely come from the judge app.
- **Also found later:** besides the event-wide `live_scoring_otp`, the newer Staff section gives **each judge a personal OTP generated by the server** (`PUT /api/competition/{id}/organisers/{organiserId}/otp`).
- **Unknown:**
  - The mobile judging app's requests.
  - How the server checks the password, and any rate limiting.
  - Server-side ranking and points rules.
  - Possibly a few shared JS chunks that weren't downloaded.
