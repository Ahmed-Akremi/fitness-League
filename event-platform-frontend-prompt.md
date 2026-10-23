# Prompt: Build the Event Platform Frontend (CrossFit + HYROX-style), no backend

Copy everything below the line into your AI coding agent (Claude Code, Cursor…), opened in your app's project folder.
Fill in "About my app" first; anything left empty uses the defaults.
Background research (feature reference only): `circle21-event-organisation-report.md` and `circle21-live-scoring-report.md` (same folder).

---

## Mission

Build the **complete frontend** of a competition platform for functional-fitness events. It must support **two event modes**:
- **Functional Fitness (CrossFit-style):** separate workouts, ranked by points, run in heats with lanes.
- **Hybrid race (HYROX-style):** one continuous race of stations and runs, ranked by total time, run in waves.

**There is no backend in this project.** All data, live updates, payments and notifications are **simulated in the browser** behind typed interfaces, so a real backend can be plugged in later without rewriting screens.

## About my app (fill in)

- Project path / name: `____` (empty = create a new project)
- Existing frontend stack, if any: `____` (empty = use the default stack below)
- Product name and brand colours: `____`
- UI languages: `French + English` (default)

## Ground rules

1. **Frontend only.** Don't build any of these: server code, database, real payment provider, real email/SMS/push, real WebSocket service. Everything goes through the `api` and `realtime` interfaces described below, with mock implementations.
2. **Original product.** Use the research reports only to understand the features. Don't copy any other platform's code, texts, logos or branding.
   - "HYROX" is a trademark. Label the template **"Hybrid race – 8 stations (HYROX-style)"** and keep the label configurable.
3. **Plan first.**
   - Explore the project. If it already exists, list its stack, conventions and what can be reused.
   - Then propose the folder structure, routes and phase plan.
   - **Wait for my OK** before writing code.
4. Work **phase by phase** (§9). After each phase:
   - run typecheck, lint and tests
   - give me a short summary of what's done and what isn't, plus how to try it
   - wait for my OK before the next phase
5. Follow the project's existing conventions. Use TypeScript `strict` and avoid `any`. Keep components small and logic in pure functions.

## 1. Default stack (only if the project has none)

| Area | Default |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui; Lucide icons |
| Data fetching / cache | TanStack Query (all reads and writes go through it, so the mock can later be swapped for HTTP) |
| Client state | Zustand (session, UI preferences, offline queue) |
| Forms | React Hook Form + Zod |
| Dates | dayjs (utc + timezone plugins), or date-fns-tz |
| Rich text | TipTap |
| Drag & drop | dnd-kit (re-ordering divisions, workouts, stages, heat lanes) |
| Charts | Recharts |
| i18n | next-intl or i18next (fr, en) |
| Tests | Vitest + Testing Library (unit), Playwright (end-to-end) |

## 2. Architecture without a backend

```
src/
  domain/        types + Zod schemas for every entity (§3), enums, constants (HYROX-style preset)
  logic/         pure, unit-tested business rules (§4): ranking, hybrid totals, penalties, heats, waves, pricing, timers
  api/
    Api.ts       one TypeScript interface, grouped by module (events, divisions, registrations, staff, workouts, heats, results…)
    mock/        in-memory implementation + localStorage persistence + seed data
    http/        stub implementation: each method throws "Not implemented" and notes its future REST endpoint
  realtime/      Realtime interface + mock (BroadcastChannel)
  clock/         serverNow() abstraction (mock = Date.now(); later: server offset)
  features/      one folder per area (public, registration, organizer/*, judge, displays, staff)
  components/    shared UI
docs/            backend-contract.md, demo-script.md
```

- **Mock API:**
  - Persist data in localStorage under a versioned key, with a **"Reset demo data"** button.
  - Add **150–400 ms random delay** and an optional **error-injection toggle** (dev menu).
  - IDs are UUIDs. Timestamps are stored as **UTC ISO-8601** and shown in the **event's timezone**.
- **Seed data:**
  - **Event A** (CrossFit-style, on-site, individuals + teams):
    - 4 divisions (including 1 team division and 1 sub-division)
    - 40 athletes, 3 teams
    - 3 WODs (AMRAP, for time with time cap, weightlifting), 2 locations
    - generated heats
    - staff: judges, head judge, volunteers
  - **Event B** (Hybrid, HYROX-style template):
    - 2 divisions, 30 athletes
    - waves
  - **Event C** (virtual qualifier) linked as the qualifier for Event A.
- **Realtime mock:**
  - Interface: `subscribe(channel, event, handler) → unsubscribe`, `publish(channel, event, payload)`.
  - Built on **BroadcastChannel** plus an in-tab emitter. A judge tab updates the display tabs **in the same browser**; say so in the UI. Several devices will need the future backend.
- **Auth mock:**
  - A **role switcher** in the header: Organizer, Head judge, Judge, Volunteer, Athlete, Spectator.
  - Route guards by role.
  - Judges log in with a code, checked against the mock data.
- **Payments mock:** a fake checkout page with "Pay" / "Payment fails" buttons, creating orders and payments.
- **Notifications mock:** an **Outbox** page (organizer) listing every email or push that would have been sent: confirmations, scheduled messages, finalist invitations.
- **Uploads mock:** files stored as data URLs in the mock store, with size and type checks (images ≤ 2 MB, PDF ≤ 10 MB).
- **`docs/backend-contract.md`:** keep it up to date in every phase. For every `Api` method, list the proposed REST endpoint, request/response types and errors, plus every realtime channel and event. This is the spec for the future backend.

## 3. Domain model (types + Zod)

- **Event:**
  - basics: name, slug
  - `visibility` (public | private | password | link), optional `accessCode`
  - `format` (virtual | onsite), `style` (functional_fitness | hybrid), `hybridTemplate` (hyrox_style | custom | null)
  - `participantTypes` (individual, team), `label` (qualifier | final | charity | battle | challenge | workshop | none)
  - location and dates: country, timezone, address, registrationOpensAt/ClosesAt, startsAt/endsAt
  - `inviteOnly`, `status` (draft | published), qualifierEventId
  - branding: logo, cover, colours, confirmation-email image
  - details: rich description, organizer legal entity, video URL, rulebook file, contact email/website, socials
  - settings: count visibility, max individuals/teams, hide athletes tab, coach assignment, restrict to an imported email list, confirmation message, notify organizer, partner-event reward, neutral-athlete countries, appeals (enabled, price, deadline, max per athlete)
  - `leaderboard`: visibility random | ranked | hidden, scoresPublic, frozen, finalistsPerDivision, ageFilters[], display options (photo, secondary info, flag)
- **Division:**
  - name, standards, type individual | team, gender male | female | mixed | open
  - team composition {male, female}, age min/max (or average age), maxParticipants
  - parentId (sub-divisions), colour, locked + unlockCode, visible, free
  - price, earlyPrice, earlyUntil, order
  - team rules: nameChangeUntil, memberChangeUntil, memberChangePrice, oneMemberMustStay, membersRequiredAtRegistration
- **PricingSettings:**
  - currency, payoutMode (direct | platform_collects)
  - platformFee {percent, fixed, distribution: pass | split | absorb}
  - tax {percent, number, mode included | added}
  - deposit {enabled, type fixed | percent, value, deadline, refundable}
- **Marketing:**
  - **PromoCode:** code, type % | fixed, value, divisions, maxUses, used
  - **ReferralLink:** code, owner, clicks, registrations
  - **Sponsor:** name, logo, country, showOnLeaderboard, showOnLanding
- **Registration forms:**
  - **RegistrationForm:** custom fields: text, select, size, emergency contact, billing…
  - **Agreements:** liability/refund text, custom agreement; minors {age, guardian fields, signature, photo consent}; medical report; additional document; face-recognition consent
- **Registrations:**
  - **Registration:** athlete or team, division, status pending | paid | deposit_paid | cancelled, answers, signatures, payments, checkedIn
  - **Team:** name, captain, members (+ invited emails)
  - **WaitingListEntry**, **FinalistInvitation**
- **Staff:**
  - **StaffForm:** questions, roles, shifts
  - **Application:** status pending | approved | declined
  - **StaffMember:** role judge | head_judge | manager | stage_manager | volunteer | host | scoring_admin; shifts, checkedIn, **personal judge code**
- **WOD (functional fitness):**
  - name, description, visibleFrom, timeFormat (mm:ss | HH:mm:ss | mm:ss.SSS), totalTimeCapSec
  - instructions file/link, video, divisions, liveScoringEnabled, parts[]
- **WorkoutPart:**
  - name, `type` amrap | for_time | emom | max | weightlifting, `scoreType` time | reps | load | calories | distance
  - timeCapSec, unit (reps, kg, lb, m, km, ft, mi, cal, rounds), maxScore, allowScaling
  - pointsTable, tieBreak {type time | reps, afterSet}
  - penalties {noRepSeconds, missedRep: {seconds} | {reps}, minorPct, majorPct}
  - liftFormula (none | sinclair | ipf_gl | q_points: leave the coefficient tables as a TODO stub)
- **Scorecard:** variations[] → sets[] {name, rounds, incrementPerRound, movements[] {name, quantity, unit, countEvery, divisionOverrides}}, tieBreakRound. Printable to PDF (portrait/landscape).
- **HybridFlow:**
  - name, visibleFrom, timeCapSec, timeFormat, `totalScoring` (["time"] OR any of reps/calories/distance)
  - `stages[]` {id, name, kind station | transition, scoringMode time | reps | calories | distance | none, timeCapSec, sets[] (same shape as the scorecard)}
  - `breaks[]` {afterStageId, seconds, label}
  - `scoringRule` {op add | remove, value | null (= judge enters it), unit sec | rep}
  - **HYROX-style preset** (locked order): before each station a 1 km run (transition), then SkiErg 1000 m, Sled Push 50 m, Sled Pull 50 m, Burpee Broad Jumps 80 m, Row 1000 m, Farmers Carry 200 m, Sandbag Lunges 100 m, Wall Balls 100 reps
- **Planning:**
  - **Location:** name, lanes
  - **Heat** (functional fitness): locationId, wodId/partId, divisionIds, startsAt, durationSec, lanes[] {lane, registrationId, judgeId}, status scheduled | active | finished, publicFrom
  - **Wave** (hybrid): locationId, flowId, startsAt, participants[] {registrationId, bib, judgeId}, status
- **Results:**
  - **Result:** partId | stageId | flowId, registrationId, value, timeMs, splits[], tieBreak, scaled, dnf, penalties, `source` live | manual | import, `status` pending | validated, judgeComment, scorecardPhoto, signature
  - **Appeal:** status in_review | approved | declined
- **LiveLaneState:** heatOrWaveId, laneOrBib, total, attempt, attemptFailed, timeMs, done, dnf, scaled, stageIndex, splits[], seq
- **Messaging:** Conversation, Message, Tag; **BulkMessage** {segments, subject, body with `{{name}}`, attachment, sendAt | now, status}
- **Spectators:** TicketType {price, seats, salesWindow, unlockCode}, TicketOrder
- **Shop:** Product {variants, stock, price}, ShopOrder {delivery | pickup, status}, ShopSettings (notification email, VAT, refund policy, delivery info, size guide)

## 4. Business rules (pure functions in `src/logic`, 100% unit-tested)

1. **Functional fitness ranking (per part):**
   - Sort by score type: time ascending; reps, load and distance descending.
   - **For time with a cap:** finishers first by time; then non-finishers by reps, then tie-break.
   - Penalties are applied before ranking.
   - Scaled results rank after Rx (configurable). DNF comes last.
   - Ties share a rank unless the tie-break separates them.
   - Points = `pointsTable[rank]`. The default is *rank = points, lowest total wins*; also offer a *descending points table* (100, 97, 94…).
   - Overall ranking = sum of points. Overall tie-break = most better placings, then the last workout (configurable, explained in the UI).
2. **Hybrid race:**
   - total = sum of stage times (transitions included) + breaks if configured + scoringRule adjustments + penalties
   - keep **splits** per stage
   - time cap → DNF, or ranked after finishers by stages completed
   - if `totalScoring` isn't time, rank by the chosen totals
   - leaderboard columns = stations (transitions hidden), last station = finish
3. **Heat generation:**
   - inputs: registrations by division, sort (rank_top | rank_low | alphabetical | bib)
   - lanes per heat, **placement of the best athletes** (start | middle | end lanes)
   - heat duration, transition, pause, first start time, location, keep divisions together or mix
   - output: heats with start times
   - manual edits after generation: drag athletes between lanes/heats; warn before regenerating
4. **Wave generation (hybrid):** wave size, interval between waves, start time, by division or mixed.
5. **Pricing:**
   - early-bird price if before the date, then the promo code
   - tax (included or added), then the platform fee by distribution (pass/split/absorb)
   - deposit amount, remaining balance and deadline
   - show the full breakdown at checkout
6. **Timers:**
   - AMRAP, EMOM, For time, Tabata/intervals, countdown
   - all screens compute the remaining time from `startTimestamp + serverNow()`, never from local ticks only
7. **Schedule:** "finishes at", progress (finished/remaining heats or waves), current/next heat per location.

## 5. Screens

### A. Public (athletes and spectators)

- **Event list** with filters: mode, format, label, country, dates.
- **Event page:**
  - hero, description, divisions with prices and spots left, workouts (when visible), schedule
  - live leaderboard, sponsors, rulebook, contact
  - "Register" and "Buy tickets"
- **Registration flow:**
  1. **Waiting room:** if the event has the "high demand" flag, show a queue with a position that counts down. The spot expires; rejoin is possible.
  2. Choose a division. A locked division asks for a **6-digit code**. Age check; full → **join the waiting list**.
  3. Individual / team / **gift (register others by email)**. Team name, captain and member emails.
  4. Form fields, then agreements (minor flow: guardian details + signature).
  5. Promo code, **deposit or full payment**, price breakdown.
  6. Mock checkout, then confirmation (+ Outbox entry).
- **Tickets:** ticket types, a code to unlock hidden tickets, quantity, checkout, QR ticket.
- **My account:** my registrations, pay the remaining balance, team management (change name or members within the deadlines), appeals.

### B. Organizer

- **My events:**
  - **Create event wizard** with steps: visibility → details → format → **mode choice (two big cards: Functional Fitness / Hybrid race, then template: HYROX-style or Custom)** → participants → label → dates → eligibility → copy from a previous event (info, divisions, workouts, pricing, waiver) → invite-only.
  - **Publish checklist modal:** details, divisions, pricing, logo & cover, registration form, waiver. Missing items link to their page.
- **Event admin** (header: status, Preview, Publish; tabs):
  - **Dashboard:**
    - overview cards and charts (registrations, divisions, countries, clubs, gender)
    - Finance (gross, fees, refunds, net, payments list)
    - Check-ins (athletes, judges, volunteers, per division)
  - **General:**
    - Details, Divisions (tree with sub-divisions, drag to re-order, duplicate), Pricing, Media
    - Waiver & Form builder, Promo codes, Referrals, Organization team
    - Settings (everything in §3 Event.settings), Integrations (placeholders)
  - **Participants:**
    - Individuals, Teams (search, filters, move division, check-in, resend waiver, export CSV)
    - Waiting list (invite next)
    - Invite finalists (from the linked qualifier, top N per division)
    - Sponsors
  - **Staff:**
    - Form builder (questions, roles, shifts) and a public application page
    - Applications (approve/decline)
    - Lists per role, shift planner
    - **personal judge codes** (generate, copy, revoke)
    - Stats, check-in
  - **Planning:**
    - *Functional fitness:*
      - WOD list (drag to re-order, duplicate, visibility date)
      - WOD editor (parts, penalties, points, tie-break)
      - **Scorecard builder**
      - Locations, Heats (generator + drag & drop board + judge assignment + print)
      - Timetable
    - *Hybrid:*
      - template chooser, then the **Competition Flow editor**:
        - vertical list of stages and transitions, drag to re-order (locked for the HYROX-style preset)
        - breaks between stages
        - stage scoring mode
        - total scoring and the **scoring rule**
      - Waves (generator + board), Hybrid timetable (**Start / Stop selected waves**)
  - **Scoring:**
    - Leaderboard (division/country/club filters, refresh, freeze, add or edit a result)
    - Scores by heat/wave (fast entry grid), validation queue (pending → validated, "edited after live" warning)
    - Appeals
    - Online judging for virtual events (video link review)
    - Settings (visibility, scores public, import CSV with preview/dry run, finalists, age filters, display)
  - **Messaging:**
    - Chat (one-to-one/groups, tags)
    - Bulk messages (segments: all, athletes, judges, volunteers, finalists, waiting list, per division, coaches, team managers; `{{name}}`; attachment; **send now or schedule**)
    - Outbox
  - **Tools:**
    - Timer control (per location: configure / start / pause / stop)
    - **Display links** with copy/open and options
    - Event slider, embed code for the leaderboard
  - **Spectators:** ticket types, orders, check-in, promo codes, stats.
  - **Shop:** products, orders, settings.

### C. Judge app (mobile web, offline-tolerant)

- **Login:** event + personal code (or the event-wide code). The session is limited to that event.
- **Choose:** location → heat/wave → lane/bib, or open a QR deep link.
- **Functional fitness scoring screen** (built from the scorecard):
  - current set/round/movement, big **+1 / −1** (+ "count every" steps), progress
  - **Attempt / No-rep** for lifts
  - **Done** → time from the shared clock (editable)
  - **DNF**, **Scaled**, tie-break capture
  - penalties (no-rep, missed rep, minor/major)
- **Hybrid scoring screen:**
  - station list with the current one highlighted
  - **"Next station" records the split** (transitions handled automatically)
  - **penalty button** from the scoring rule, **Finish**
- Each tap updates the screen immediately and publishes live updates (`seq`, idempotency key).
- **Offline queue** with a "syncing" badge.
- **Submit:** summary + athlete signature (canvas) → pending result.

### D. Displays (full-screen, read-only, dark theme, options in the URL)

- Live heat (all lanes), single lane card, **hybrid race view** (athletes × stations, progress bars, splits, gaps)
- Leaderboard (rotating divisions), upcoming heat/wave, active heat, finished heat results
- **Call screen** (warm-up / corral / check-in), timer, warm-up screen, heat intro, show athlete score
- **Green-screen overlay** variants (transparent background) for streaming
- All displays react to realtime events and reconnect automatically (with a snapshot from the mock API).

## 6. Realtime channels (mock now, backend later)

| Channel | Events |
|---|---|
| `heat.{id}` / `wave.{id}` | `score_update`, `time_update`, `split`, `done`, `dnf`, `attempting`, `failed`, `scaled`, `clear` (payload: laneOrBib, workoutOrStageId, values, `seq`, `serverTs`) |
| `event.{id}` | `heat_activated`, `wave_started`, `wave_stopped`, `leaderboard_updated`, `show_athlete_score`, `call_warm_up`, `call_corral`, `checkin` |
| `timer.{locationId}` | `timer_config`, `timer_start`, `timer_pause`, `timer_stop` (always with `startTimestamp`) |
| `location.{id}` | `lane_selected`, `upcoming_heat` |
| `chat.{conversationId}` | `message`, `read` |

Displays must never depend only on messages: they load a **snapshot** first, then apply updates with a higher `seq`.

## 7. UX and quality requirements

- **Responsive:** organizer screens on desktop and tablet, judge app mobile-first (buttons ≥ 64 px, one-handed use, keeps the screen awake), displays at 1080p/4K and portrait.
- **Accessibility:** keyboard navigation, focus states, contrast AA, labels on every input.
- **Every list:** empty state, loading skeleton, error state with retry. Toasts for actions, confirmation dialogs for anything destructive, autosave where natural (WOD/flow editors).
- **i18n:** all text in translation files (fr, en). Dates and numbers formatted by locale and event timezone.
- **Performance:** virtualize long tables (athletes, results). Displays re-render only the lanes that changed.
- **No secrets** in the code. No calls to real third-party services.

## 8. Tests

- **Unit:** every function in `src/logic` (ranking edge cases, time caps, ties, penalties, hybrid splits, pricing breakdowns, heat lane placement, timer maths).
- **Component:** registration steps, WOD/flow editors, judge scoring screen.
- **End-to-end (Playwright), 3 scenarios:**
  1. **Functional fitness:** create event → divisions & pricing → publish → 3 athletes register (one with a promo code, one with a deposit) → generate heats → start heat. A judge in tab A scores; the display in tab B updates in < 1 s → submit → validate → leaderboard updates.
  2. **Hybrid:** create event with the HYROX-style template → athletes → waves → start a wave → judge records splits + penalty → race display and leaderboard show total time and splits.
  3. **Registration edge cases:** queue, locked division code, full division → waiting list, minor consent, team member change after the deadline is refused.

## 9. Phases (stop after each one)

| Phase | Content | Done when |
|---|---|---|
| 0 | Explore + plan | I approved the plan |
| 1 | Foundations: domain types, mock API + seed, realtime mock, clock, role switcher, layout, design tokens, i18n, Outbox, `backend-contract.md` started | The app runs, demo data loads and can be reset, typecheck/lint/tests pass |
| 2 | Event creation wizard (both modes) + General tab (all pages) + publish checklist | An event of each mode can be created, configured and published |
| 3 | Public event page + full registration flow + waiting list + tickets + My account | Scenario 3 passes |
| 4 | Participants + Staff (forms, applications, roles, shifts, judge codes, check-in) | Judges get personal codes; check-in stats update |
| 5 | Planning, functional fitness: WODs, scorecard builder, locations, heat generator & board, timetable | Heats generated with the right lane placement and times |
| 6 | Planning, hybrid: template chooser, Competition Flow editor, scoring rule, waves, hybrid timetable | HYROX-style preset locked; custom flows editable; waves start/stop |
| 7 | Judge app (both modes) + realtime + displays + timer control | Scenarios 1 and 2 pass up to the live displays |
| 8 | Scoring: validation, leaderboard (points & total time), freeze, appeals, import CSV, online judging | Scenarios 1 and 2 pass fully |
| 9 | Dashboard, finance, messaging (chat, scheduled bulk messages), tools, spectators, shop | All tabs work with mock data |
| 10 | Polish: accessibility, responsive, performance, empty/error states, translations, `docs/demo-script.md`, final `backend-contract.md` | All tests pass; the demo script runs start to finish |

## 10. Deliverables

- The working frontend with demo data (`npm run dev`) and a **"Reset demo data"** button.
- `README.md`: how to run, the role switcher, how to demo the live features with two browser tabs.
- `docs/backend-contract.md`: every endpoint, payload, error and realtime event, ready for a backend developer.
- `docs/demo-script.md`: a 10-minute demo of both modes.
- A list of known limits: single-browser realtime, no real payments, no persistence across devices.
