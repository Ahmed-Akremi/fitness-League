# Organisation update — design

Date: 2026-10-22. Branch `organisation-update` (from `origin/main` `cdd9924`).
Source: the owner's prompt `event-platform-frontend-prompt.md` (repo root). Research behind it:
`circle21-event-organisation-report.md` and `circle21-live-scoring-report.md` (repo root, untracked).

Owner's answers (phase 0):

| Question | Answer |
|---|---|
| Data for features the API does not have yet | **Local mock layer**: the existing features keep the real API; the new ones call their future endpoints, answered on the device for now |
| Order | **Every phase, in order**; stop after each phase for review |
| Live judges (CrossFit and HYROX-style) | **Keep app accounts**: the floor judges of `2026-10-21-floor-judging-design.md`; no judge codes |

## Scope and rules

- **Frontend only:**
  - Everything goes in `apps/mobile-rn`: phone, plus the computer layout of the web build.
  - Nothing under `apps/api`, `apps/backend`, `apps/admin` or `apps/landing`.
  - No new server endpoint.
- **What exists keeps working.** Every current organizer page, route, `testID` and test stays. New controls get a `testID`.
- **App rules from `handoff-frontend.md` still apply:**
  - Expo SDK 57: read the versioned docs first; add packages only with `npx expo install --pnpm`; never edit `android/` or `ios/`.
  - Texts in `en.json`, `fr.json`, `ar.json` with the same keys and placeholders. French uses « tu ». ICU plurals. Use `marginStart`/`End`.
  - Colours are 6-digit hex.
  - Prices are millimes (TND).
  - No unrelated refactors.
- **No new native dependency:** no keep-awake, haptics or signature pad (floor-judging ruling 7), unless the owner agrees.
- **The organizer computer layout** keeps its look (`useWideWeb()`, `ThemeScope dense`). New pages follow the existing web-shell patterns (`OrgPageHeader`, menu sections, `FORM_WIDTH` / `WIDE_WIDTH`).
- **"HYROX" is a trademark.** The template is labelled « Course hybride – 8 stations (style HYROX) » / "Hybrid race – 8 stations (HYROX-style)". The wording lives in the i18n files only.
- The research reports describe features; no other platform's code, text or branding is copied.

## Architecture: the local mock layer

```
ApiClient ── fetch ──▶ withLocalRoutes(innerFetch)
                         ├─ route table hit  → answered from the local store (persisted)
                         ├─ overlay hit      → inner fetch + local fields merged in / stripped out
                         └─ anything else    → inner fetch (real server, or demoFetch in the demo build)
```

- **`src/core/api/local-routes.ts`:** a `Fetch` wrapper, built like `demoFetch` (`core/api/demo-backend.ts`):
  - **Local routes:** new resources (examples: `GET/PUT /competitions/:id/flow`, `/competitions/:id/waves`, `/competitions/:id/locations`, `/competitions/:id/staff-forms`). Each is a method + path pattern + handler that reads and writes the local store. Handlers return the same JSON shapes and error bodies (`ApiError` field errors) as the server would.
  - **Overlays:** new fields on existing resources (e.g. `eventStyle`, `visibility`, `label`, `participantTypes` on a competition; `teamSize`, `parentId`, `unlockCode`, `earlyPrice` on a category):
    - **on write**, the wrapper strips the new fields from the body sent to the server and saves them locally;
    - **on read**, it merges them into `GET /competitions/:id`, lists and detail responses.

    Screens are written against the final shape.
- **Local store** (`src/core/api/local-store.ts`):
  - Saved with AsyncStorage: device storage on phones, `localStorage` in the web build.
  - One versioned key, `org-local:v1`, holding data per competition id, plus a schema version for migrations.
  - Dates are UTC ISO-8601; money is in millimes.
  - IDs are prefixed `loc_` (so a later import to the server can recognise them).
  - Tests get an in-memory instance.
- **Flag:** `EXPO_PUBLIC_ORG_LOCAL` is **on unless set to `false`** (`config.orgLocal`). That covers development, the demo and the web build. When a route moves to the server, its entry leaves `ORG_LOCAL_LAYER` (`core/api/org-local.ts`): a one-line change, no screen change.
- **The user sees it:** a small « Local » badge on every page whose data is only on this device, with a tooltip explaining it.
- **Realtime:** a separate **`LiveBus`** service (`core/live-bus.ts`, `Services.live`, `useLive()`) with `subscribe(channel, event, listener)` and `publish(channel, event, payload)`. `Realtime` and its notification and battle socket stay as they are.
  - **Local implementation:** `BroadcastChannel('fl-live')` in web pages only, so TV displays in other tabs or windows of the same browser receive the events. An in-page emitter on phones and in tests (Node has a `BroadcastChannel` too; an open one would keep jest alive).
  - **Displays never depend on messages only:** they load a snapshot first, then apply events with a higher `seq`, and keep the existing 5 s poll as a fallback.
  - Same channel and event names as the future socket rooms (Rust plan 3c / part 4).
- **`docs/organisation-backend-contract.md`:** updated in every phase. For every local route and overlay field, it gives the future endpoint, request/response types, errors and the realtime events. This is the backend's spec for Rust part 4.
- **Known limits (shown in the README section):**
  - Local data stays on one device or browser.
  - In the web build, every account signed in on that browser shares it. That is enough to demo organizer → athlete → judge → TV with several accounts in one browser, but not across devices.
  - New data is not visible on the server or in the admin panel until the backend exists.

## Mapping the prompt onto the app

| Prompt area | Today | Plan |
|---|---|---|
| Event creation | `organizer/create.tsx` (title, format, dates, place, price, max) | **Extend** into steps: mode (Functional fitness / Hybrid race + template), visibility (public / private / password / link), participants (individuals / teams), label, invite-only, copy from a previous event (overlay + local) |
| General | `general.tsx` (description, cover, dates…) | **Extend**: rulebook, contact, socials, video, legal entity, settings page (count visibility, max individuals/teams, coach, email list, appeals config, neutral athletes) |
| Divisions | `categories.tsx` (gender, ages, level, max, price, templates) | **Extend**: team divisions (composition), sub-divisions, locked with a code, early-bird price, team rules |
| Pricing | price + `coupons.tsx` + `finances.tsx` + `payments.tsx` | **Extend**: platform fee distribution (pass / split / absorb), VAT, deposits, breakdown shown at checkout |
| Waiver & form | none | **New**: registration form builder, agreements, minors (guardian + consent), medical / extra document |
| Athlete registration | `competitions/[id]/register.tsx` | **Extend**: queue simulation, locked division code, team / gift registration, deposit or full payment, consents, waiting list, « My registrations » |
| Participants | `participants.tsx`, `participants-web.tsx` | **Extend**: teams, waiting list, invite finalists (linked qualifier), sponsors, check-in |
| Staff | `team.tsx` (organizers, floor judges) | **Extend**: staff forms (questions, roles, shifts), applications, volunteers / stage managers / scoring admins lists, staff check-in |
| WODs (functional fitness) | `wods.tsx` (10 score types, placement table, variants) | **Extend**: scorecard builder (sets, rounds, increment, movements with « count every », tie-break round), penalty settings, tie-break settings |
| **Hybrid race (HYROX-style)** | none | **New**: template chooser, Competition Flow editor (8 locked stations + 1 km runs, or custom stages), breaks, total scoring, scoring rule (add/remove sec/rep) |
| Heats | `planning.tsx`, `schedule.tsx`, `timetable.tsx` | **Extend**: locations, generator options (sort, lane placement start/middle/end, transition, pause) |
| Waves | none | **New**: wave generator + board, hybrid timetable (start / stop selected waves) |
| Judges | floor judging (`judge/screens.tsx`) | **Extend**: scorecard-driven counting; **new** hybrid screen (split per station, penalty button, finish); publishes live events |
| Live displays | none | **New** web routes `/display/...`: live heat lanes, single lane, race view, leaderboard rotation, upcoming / active heat, call screen, timer, green-screen overlays; « Tools » page with links |
| Results | `leaderboard.tsx` | **Extend**: total-time ranking for hybrid events, points tables, freeze, visibility random / ranked / hidden, finalists, age filters, CSV import with a dry run |
| Messages | `announcements.tsx` | **Extend**: segments, schedule for later, outbox |
| Spectators, shop | none | **New** (last phase) |

## Phases (in order; each stops for the owner's review)

| # | Content | Done when |
|---|---|---|
| 1 | Foundations: local store, `withLocalRoutes` (routes + overlays), flag, « Local » badge, `LiveBus` (BroadcastChannel / emitter), the contract doc, `eventStyle` overlay. Menu entries arrive with the phase that builds each page (no empty pages) | Unit tests for the store, wrapper and bus; existing suites still green |
| 2 | Event setup: creation in steps (mode, template, visibility, participants, label, invite-only, copy from a previous event), General extras, Settings page, publication checklist additions | Both modes can be created, configured and sent for publication |
| 3 | Divisions, pricing, forms: team divisions, sub-divisions, locked divisions, early-bird; fees, VAT, deposits; form builder, agreements, minors | Price breakdown tests (pure); pages work on phone and computer |
| 4 | Athlete registration: queue, locked code, team / gift, deposit or full, consents, waiting list, « My registrations » | A registration end to end in one browser |
| 5 | Participants and staff: teams, waiting list, finalists, sponsors, check-in; staff forms, applications, roles, shifts | Lists, filters and check-in counts update |
| 6 | Planning, functional fitness: scorecard builder, penalties, tie-break, locations, heat generator options, timetable per location | Generator tests (sort, lane placement, times) |
| 7 | Planning, hybrid race: template chooser, Competition Flow editor, scoring rule, waves, hybrid timetable | HYROX-style preset locked; custom flows editable; waves start / stop |
| 8 | Judges and live: scorecard-driven floor judging, hybrid judge screen, live events, timer control | A judge in one tab updates another tab in < 1 s |
| 9 | Displays: `/display/*` routes and the Tools page | Displays reconnect from a snapshot; overlays have a transparent background |
| 10 | Results: hybrid total time, points tables, freeze, visibility, finalists, age filters, CSV import | Ranking tests (caps, ties, penalties, splits) |
| 11 | Messages (segments, schedule, outbox), spectator tickets, shop | All new tabs work with local data |
| 12 | Polish: accessibility, RTL (ar), empty and error states, performance, demo script, final contract and README section | Full suite green; demo script runs end to end |

Each phase:
1. Pure rules go in `organizer/logic-*.ts` files (the existing pattern), unit-tested first.
2. Screen tests go in `test/screens/organizer-*.test.tsx`.
3. Checks: `npx tsc --noEmit`, the phase's suites, then the full suite: `npx jest --maxWorkers=2`, about 9 min or more on `/mnt/c`.
4. One commit per coherent group, staged by name: never `git commit -a`, because of the CRLF noise.
5. No push without the owner's go-ahead.

## Rulings (the owner can change them)

1. **The mode is chosen at creation.** It can be changed only while the event has no WOD and no flow; switching would leave the other mode's data orphaned.
2. **One Competition Flow per hybrid event in v1.** Divisions share it; per-division versions come later.
3. **Waves reuse the heat model** with no lane limit. They are stored locally for hybrid events; the server heats stay for functional-fitness events.
4. **Hybrid scoring:**
   - total = sum of stage times (runs included) + breaks if counted + scoring-rule adjustments;
   - splits are kept per station;
   - a time cap gives DNF, ranked after finishers by stations completed.
5. **Floor judges stay app accounts.** No judge codes; the event-wide « live scoring password » of the research is not copied.
6. **No drawn signature** (a native library would be needed): athlete confirmation stays a tap, as in floor judging.
7. **Displays are web-only routes**, opened in a browser on the TV or projector computer. They are read-only and need no sign-in when the event is published.
8. **Queue and payments are simulated:**
   - the queue appears only when the event has the local « high demand » flag;
   - payment uses the existing mark-paid flow and a local « deposit paid » state;
   - no payment provider.

## Not in this update

- Anything that needs the server: sharing local data across devices, real payments, push and emails (the outbox lists what would be sent), and the admin panel.
- Moving local data to the server once Rust part 4 exists. The `loc_` ids and the contract make that import possible later.
