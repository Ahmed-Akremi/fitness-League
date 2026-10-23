# Circle21: Event Organisation, Full Breakdown (CrossFit mode + HYROX mode)

Investigation date: 2026-10-22
Method (REA):
- Your logged-in Brave session (temporary profile). Every admin page of your event was opened **in view-only mode**; nothing was clicked, saved or published.
- Static reading of the site's public code: 215 Next.js chunks, the build manifest (239 routes) and the English translation file `locales/en.json` (1,120 strings).

Related files in this folder:
- `circle21-live-scoring-report.md`: live scoring in detail.
- `live-scoring-build-prompt.md`: the prompt to build live scoring in your app.

Evidence IDs (REA captures):
- `ev_0f077f6d…` (Staff / Planning / Scoring pages)
- `ev_fdc91dae…` (Messaging / Tools / Ticketing / Shop / Finance)
- `ev_21707855…` (Scoring settings + network)
- The Dashboard / General / Participants capture is saved in the session tool results.

---

## 1. Architecture in one look

| Layer | What Circle21 uses |
|---|---|
| Front end | Next.js (pages router), React Query, MUI, i18next |
| API | `https://api.circle21.events/api/...` REST (226 distinct paths found). Pagination with `page`/`per_page`; `_method=PUT` in form data |
| Real time | Pusher Channels (EU), public channels |
| Live event sending | **`POST /api/push-message {channel, event, message}`**: a general relay. The organizer's browser asks the server to broadcast any event (timers, lane selection, upcoming heat, starting waves) |
| Live heat state | `GET /api/heats/{id}/mongo` (live heat state, apparently in MongoDB) + `GET /api/heats/{id}/live-start` (clock sync) |
| Payments | Stripe Connect, PayPal onboarding, or "Circle21 collects all payments" |
| Judges | Circle21 mobile app (Judge App) |
| Registration under heavy load | Waiting-room queue (`/api/queue/join`, `/api/queue/status/{token}`) |

---

## 2. Life of an event (organizer journey)

1. **Create the event (wizard):**
   - visibility and format
   - **event type: Functional Fitness (CrossFit-style) or Hybrid (HYROX-style)**
   - participants, label and dates
2. **General:** details, divisions, pricing, media, waiver & registration form, promo codes, referrals, organization staff, settings, integrations (Meta).
3. **Publish:** a checklist modal ("Your Event Is About to Go Live!") with these items:
   - Main Event Details
   - Divisions
   - Pricing
   - Logo & Cover
   - Registration Form
   - Waiver

   Public events appear on the Circle21 feed and athletes are notified. Private events are reachable by link only. Endpoints: `POST /api/competition/{id}/publish` and `/un-publish`.
4. **Registration:** athletes register (queue, locked divisions, team or gift registration, promo codes, deposit, waiting list).
5. **Staff:** application forms → judges, head judges, managers, stage managers, volunteers, scoring admins, with shifts and check-in.
6. **Planning:**
   - **Workouts:** CrossFit WODs, or a HYROX/Custom "Competition Flow".
   - **Locations.**
   - **HEATs** (CrossFit) or **WAVES** (Hybrid).
   - **Timetable.**
7. **Live day:**
   - check-in
   - call screen (warm-up / corral)
   - shared timer
   - live scoring (Judge App)
   - TV screens and stream overlays
8. **Results:**
   - leaderboard (points or total time)
   - judging review
   - appeals
   - freeze leaderboard
   - announce results
   - invite finalists to the Final event
9. **Money and extras:** finance, spectator ticketing, event shop, custom messages.

---

## 3. Creating an event (wizard fields)

Source: event form (chunk 338) + translations `myclub.pages.events.eventForm.*`

| Section | Options | Field(s) |
|---|---|---|
| Visibility | Public / Private; **Protected by password** (visible, but you need a password to register); **Anyone with the link** | `visibility` (`public`/`private`), `private_protection` |
| Details | Name, country, timezone (all dates shown in it), address (Google Places) | `name`, `competition_address`, `formatted_address`, `place_id` |
| Format | **Virtual** (online qualifiers, charity) / **On-Site** (venue) | location type `virtual` / `onsite` |
| **Event type** | **Functional Fitness (CrossFit-style)**: WOD-style workouts based on time or reps, no fixed stages. **Hybrid (HYROX-style)**: multi-stage format; template **Hyrox** or **Custom stages** | `style_type` / `event_style` = `functional_fitness` \| `hybrid`; template `hyrox` \| `custom_stages` (default: functional_fitness) |
| Who is it for | Individuals / Teams / both | `i` / `t` |
| Event label | Qualifications, Finale, Charity, Battle, Challenge, Workshop, None | label enum |
| Registration period | From / To | `registration_from`, `registration_to` |
| Event period | When results can be submitted (by athletes for virtual events, by judges on-site) | `date_from`, `date_to` |
| Eligibility (licensing) | Everyone, or members of a licensed organization; option to buy the license during registration | `organization_eligibility`, `allow_license_purchase_on_registration`, `license_purchase_description` |
| Global organization | Show in the global organization's events list | `global_organization_visible` |
| Migrate from previous event | General info, divisions, workouts, pricing, waiver | `migrate_*` |
| Invite-only registration | Only athletes invited by the organizer can register | `registration_only_invited` |

---

## 4. CROSSFIT mode vs HYROX mode (the core difference)

| Topic | Functional Fitness (CrossFit-style) | Hybrid (HYROX-style) |
|---|---|---|
| Field | `event_style = functional_fitness` | `event_style = hybrid`, WOD `template = "hyrox"` or `"custom"` |
| Workouts page | "Workouts Overview": several WODs, each with one or more scored workouts | "Hybrid Workouts": you choose a template and get one **Competition Flow** (a chain of stages) |
| Structure | Independent workouts (WOD 1, WOD 2…) ranked separately | One continuous race: stations + transitions (runs) + optional breaks |
| Workout types | `fortime`, `amrap`, `emom`, `max`, `weightlifting` (plus forreps / forkal / fordistance in scoring modes) | Each stage is scored by **Time / For Reps / Calories / Distance**, or is a **Transition Stage (No Result)** |
| Template | n/a | **HYROX** (8 fixed stations, each after a 1 km run, stages locked) or **Custom Stages** (any number of stations, your own order and scoring) |
| Scoring of the event | **Points** per workout ("Point coefficients": position 1 = 1 point), summed on the leaderboard | **Total Time** (or Total Reps / Calories / Distance; choosing "time" excludes the others) |
| Penalties | No-reps (+2 s each, for example), missed reps (time penalty, or a reps penalty past the CAP), minor/major penalties (% of points or time), max score, tie-break | **Scoring rule**: "Add/Remove N sec\|rep to/from Total Time". It's a button judges tap in the Judge App; if no value is set, the judge enters it |
| Schedule unit | **HEATs** (lanes) | **WAVES** ("Start selected / Stop selected" waves, several at once) |
| Timetable page | `/myevent/planning/timeTable`: "No active heat", "x of y HEAT'S finished" | `/myevent/planning/hybrid-timetable`: "No active wave", "x of y WAVES finished" |
| Starting | Heat activated → screens follow (`heat_activated_<event>`) | Each started wave: `live_start` = now, `stream_active = true`, `timer_config` on `online_timer_<location>`, `heat_start` on the wave's channel |
| Leaderboard | Points table per division; filters by country/club | Leaderboard workouts are the flow's stages **minus transitions**. "Finish" = the last non-transition stage |
| Heat fill cost (inference) | Uses the number of workouts in the WOD | Counts a hybrid WOD as **one** workout (`template hyrox/custom` or `event_style hybrid` → 1) |

### 4.1 HYROX template (from the code)

| Order | Station preset | Distance / reps |
|---|---|---|
| (run before each one) | `run` stage (transition, `no_results`) | 1 km |
| 1 | `ski_erg`: "1000m SkiErg" | 1000 M |
| 2 | `sled_push`: "50m Sled Push" | 50 M |
| 3 | `sled_pull`: "50m Sled Pull" | 50 M |
| 4 | `burpee_broad_jumps`: "80m Burpee Broad Jump" | 80 M |
| 5 | `rowing`: "1000m Row" | 1000 M |
| 6 | `farmers_carry`: "200m Farmers Carry" | 200 M |
| 7 | `sandbag_lunges`: "100m Sandbag Lunges" | 100 M |
| 8 | `wall_balls`: "100 Wall Balls" | 100 Reps |

Creating it calls `POST /api/wods` with `{ name: "HYROX", template: "hyrox", wod_duration: 0, divisions: [] }`. The stages are locked; deleting the flow deletes every stage.

### 4.2 Hybrid "Competition Flow" data (from the code)

```
Flow  = { workoutName, visibilityDate, timeCapMs, timeFormat ("mm:ss" | "HH:mm:ss"), totalScoring: ["time"] | ["reps","calories",...],
          stages: [Stage], breaks: [{ afterStageId, durationSeconds, label }] }
Stage = { id, name ("Station N"), timeCapMs, scoringMode (fortime|forreps|forkal|fordistance|...), isTransition, sets: [Set] }
Set   = { setName, rounds, movements: [Movement] }
Movement = { movementName, howMany, countEvery, tapEvery, units, multiplier, allDivisions, divisions[] }
```
It's saved on the WOD as:
- `live_scoring` (JSON string): `{ scorecard: [ { workoutName, workoutId, sets:[...] } ], isTapEveryActive, scoringRules?: { operation: "add"|"remove", value: number|null, unit: "sec"|"rep" } }`
- `breaks`: an array of seconds after each stage.

### 4.3 CrossFit workout model (from the code and translations)

- **WOD (container):**
  - name, description, visibility date, time format, total time (time cap/duration of all parts)
  - scorecard & instructions (file or link), video (YouTube/Vimeo), sponsors
  - submission period (virtual events), "Live Scoring Activate" toggle
  - can link to a **Global WOD** (organization-wide template; a "diff" modal shows mismatches)
- **Workout (scored part):**
  - name, type, score type, duration, **time cap**, units (`Reps, Feet, Miles, Pounds, Meters, Kilometers, Calories, Kilograms, Round`), **max score**
  - **allow scaling**
  - **point coefficients**
  - judging policy and penalties: `no_reps_judges`, `missed_reps_judges(+_reps)`, `minor_penalties_judges`, `major_penalties_judges`
  - tie-break (`tie_break_position`, `tie_break_set_index`)
- **Score fields:** `time`, `how_many`, `tie_break`, `tie_break_reps`; result `judging_state` = `MANUAL_SCORE` | `AUTO_SCORE`.
- **Weightlifting scoring formulas:** **Sinclair, Q-points, IPF GL points, Q-masters**.
- **Scorecard builder (used by the Judge App):** sets → rounds (+ increment each round) → movements (name, how many, count every, unit) → tie-break round. It can be printed as a PDF (portrait/landscape), with several scorecard variations per workout.

---

## 5. Admin tabs, page by page (observed in your account)

Event header: name, format ("ON-SITE Individuals"), settings gear, "Registration open: …", Notifications, **Preview**, **Publish Event**, ⋯ menu.
Tabs: **Dashboard · General · Participants · Staff · Planning · Scoring · Messaging · Tools · Spectators · Shop**.

### Dashboard
- **Overview:**
  - totals: athletes, teams, volunteers and judges registered
  - charts: individuals per division, team divisions, top 5 countries, top 5 clubs, gender split (shown as % or numbers)
  - **Facebook Pixel** connection
  - "Share Event link", "Send Invitation"
- **Finance:** gross revenue (includes Stripe fees), processing fees, refunded, net revenue, revenue over time, payments list.
- **Check-ins:** athletes, volunteers and judges checked in (count and %), and check-ins per division.

### General
| Page | What's there |
|---|---|
| Event Details | Rich-text description*, organizer legal entity*, landing page video (YouTube/Vimeo), **rulebook upload**, contact email*/website*, Instagram (*mandatory before publishing) |
| Divisions | Create / re-order / duplicate / delete. Division fields: name, standards, **Individuals or Team**, gender, **team composition (male/female size, mixed)**, max participants (can be set at the parent), age limit (from/to, or average age), colour, **sub-divisions (parent)**, **lock with OTP for invites**, visibility, free of charge, connect to a global division, team management (allow team name change until a date, team member change until a date with a price, "one member must stay the same", request members during registration) |
| Pricing | Payment account (**Stripe Connect / PayPal / Circle21 collects**). **Platform fee 4% + €1.50** passed to athletes, split, or absorbed (`fee_split`: pass/split/absorb). Taxes (VAT %, VAT number, included or added on top). **Deposits** (fixed or %, deadline, refundable or not). Per-division price, **early-bird price and date**, currency |
| Media | Logo 400×400*, cover 1440×600*, image for the confirmation email |
| Waiver & Form | Registration form builder (custom fields: shirt/shorts/shoe size, emergency contact, billing, CrossFit ID, box, WeChat…), liability & refund agreement, custom agreement, **minors** (guardian details, guardian as main contact, digital signature, photo consent), medical reports, additional document, **AI face recognition agreement** |
| Promo Codes | Generate codes (discount, divisions, usage), stats and top 5 |
| Referrals | Referral links for partners/influencers, tracking registrations per link |
| Organization | Event staff list (name, representing, role, T-shirt) |
| Settings | Registration count visibility, max individuals/teams, hide Athletes tab, **coach assignment** (deadline, label), **restrict registration to an imported email list**, custom confirmation email text, email on each registration, **Event Partnership Rewards** (automatic promo code for athletes who join two linked events), **neutral athletes (INA flag) for chosen countries**, **appeals** (enable, price, deadline, how many, email, description), brand colours |
| Integration | Meta Business (ads/campaigns, Meta events) |

### Participants
| Page | What's there |
|---|---|
| Individuals / Teams | Athlete and team lists (you need at least one division). Endpoints include switching division, resending waivers, moving to the final, check-in, name-change requests |
| Waiting List | By division; name, representing, division, waiting since; send email |
| Invite Finalists | Connect a **qualification event**, then invite its top athletes to this **Final** |
| Judges / Volunteers / Host-Manager / Scoring admins | Older staff lists (being moved to the new Staff section): stats, check-in, desired roles, judge "teams" |
| Sponsors | Name, country, shown on leaderboard and/or landing page |

### Staff (new Staff service)
- **Forms:** the starting point, a form builder with questions, **roles**, **shifts** and media. Endpoints: `/api/competition/{id}/forms/{formId}/questions|roles|shifts|media`.
- **Applications:** approve or decline.
- **Role lists:** Judges, Head Judges, Managers, Stage Managers, Volunteers, Hosts, Scoring admins.
- **Stats:** applicants / approved / pending / declined.
- **Each judge gets a personal OTP generated by the server:** `PUT /api/competition/{id}/organisers/{organiserId}/otp`, shown in the "JudgeOtpDisplay" component.

### Planning
| Page | What's there |
|---|---|
| Workouts | CrossFit: WOD cards (Scorecard, Edit, More, description, divisions, visibility date, **Live Scoring Activate**). Hybrid: template chooser → Competition Flow editor (re-order stages, breaks, workout scoring rules) |
| HEATs (old) | Filters by date/division/workout/location; "Generate HEATs" (date, location, athletes per heat, **sort**, start number, **lane placement**, **pause**, **transition**, auto-assign judges / hide judges), assign judge, add athlete or team, "publicly visible" date, print. *Old method being discontinued for events after July 30* |
| HEATs (Beta) | First add **Locations** (stages/floors), then a timeline of **sections**. Sections can be filled automatically (`/api/sections/{id}/fill`: start heat, lane placement, sort, divisions with workout, `linked`, `cut`, mix divisions), repopulated, copied/moved/deleted in bulk; heat avatars; judges per heat |
| Timetable | Live clock, "Schedule for today finishes at …", active heat, progress (HEATs finished / remaining) |
| Hybrid timetable | The same for **waves**: select waves → **Start N waves / Stop N waves** |

Heat options:
- **Lane placement** of top-ranked athletes: `start` / `medium` / `end`
- **Sort:** `rank_top`, `rank_low`, `alphabet`, `number`

### Scoring
| Page | What's there |
|---|---|
| Leaderboard | Refresh (rebuilds the cache), division / country / club filters, columns Name/Club, **Points**, per-workout scores; add/edit results (time, CAP, reps, max, tie-break, lift kg) |
| by HEAT's | Enter scores heat by heat (needs the planning done) |
| Judging (online events) | Video-review judging: judging teams, division and status filters, review period (**Start Judging**), totals to review / reviewed / in review / blocked; judge panel and judge review pages |
| Settings | Leaderboard visibility (random / ranked / hidden, scores public), **Live Scoring password**, import results (file/link), finalists per division, age filters, display (image, secondary info, flag) |
| Other | **Freeze leaderboard** (`athlete_leaderboard_frozen`), **announce** heat or division results (with a notification), leaderboard background, hide scores |

### Messaging
- **Chat:** one-to-one or groups with athletes/judges/volunteers. **Tags/labels** (APPEAL, In-Review, Approved, Declined, custom); appeals are handled here.
- **Custom messages (email + app):**
  - recipients: all members, athletes, judges, volunteers, finalists only, waiting list, per division, coaches, team managers
  - `{{user_name}}` placeholder, attachment up to 10 MB
  - **send now or schedule** for later
- **Support:** chat with Circle21 staff.

### Tools
- **Live:**
  - YouTube stream #1/#2
  - **overlay links** for streaming: schedule, upcoming heat, active heat, live heat, finished heat, leaderboard, workouts
  - the Beta version adds: workouts leaderboard, **warm-up screen**, single lane athlete card, single lane finish by event, heat intro screen, show athlete score, custom backgrounds
- **Timer:**
  - a local timer page
  - **Online Timer**, "controlled remotely via Pusher events" (`online_timer_<location>`: timer_config / heat_start / timer_pause / timer_stop)
- **Event slider:**
  - a slideshow with interval
  - **Live Scoring video-beam** screen
  - **single lane display**
  - **division leader display**
- **Integration:** embeddable leaderboard (dark/light theme).

### Spectators (Ticketing)
- **Overview:** gross, fees, net, refunded; tickets over time and by type.
- **All Tickets:** create spectator ticket types (seats, availability window, **6-digit code to unlock** a ticket).
- **Orders:** sold, used (checked in), distribution, assign a ticket manually, export, resend, swap.
- **Promo codes** for tickets.

### Shop
- **Products:** sold inside the app, with sponsor items; can sync with the organization shop.
- **Orders:** paid/delivery filters, order details.
- **Settings:** notification email, VAT, refunds/returns policy, delivery/pick-up, size & fit.

---

## 6. Athlete registration flow (public side)

- **Queue / waiting room:**
  - `POST /api/queue/join` → `not_required`, or a position number with "Finding your place in line…", "Your position updates automatically".
  - When admitted, the athlete gets a token. The spot can expire ("Rejoin the queue").
- **Locked division or password-protected event:** "Enter 6-digit code to unlock this division". Endpoints: `POST /api/divisions/{id}/validate-otp` and `POST /api/competitions/{id}/validate-otp`.
- **Registration types:** Single / Team, or **Multi / Gift registration** (register others by email, captain email, team name, add another team).
- **Checks:** age-range check, division full / sold out → **waiting list**, invite-only check (`/api/competition/invited/check`).
- **Payment:** promo code (`/api/promotion-codes/validate`), **Pay deposit or pay in full**, refundable or not, Stripe/PayPal checkout (`/api/payment/session`, `/api/payment/purchase`). Referral tracking (`/api/affiliate/{code}`).
- **After paying:** waivers and minor consent, check-in on event day.

---

## 7. Real-time summary (both modes)

| Channel | Events | Sent by |
|---|---|---|
| `<heatId>` | `movement_update`, `time_update`, `done`, `dnf`, `attempting`, `failed`, `scaled`, `clear`, `heat_start` | Judge App (score events; not in the web code), organizer (`heat_start` when starting waves) |
| `heat_activated_<event>` | `call_warm_up` (`heat_id`, `location_id`, `stream_active`) | backend after a heat is activated (`stream_active` update) |
| `online_timer_<location>` | `timer_config`, `heat_start`, `timer_pause`, `timer_stop` | organizer via `/api/push-message` |
| `heat_user_updated_<event>` | `call_warm_up`, `call_corral`, `warm_up_checkin`, `corral_checkin` | call screen / check-in staff |
| `laneSelection_<location>` | `laneSelected` | organizer via `/api/push-message` |
| `upcomingHeat_<location>` | `upcomingHeat` | organizer via `/api/push-message` |
| `athlete_score_<event>` | `show_athlete_score` | organizer tools |
| `competition_chat_<event>` | `new_message`, `mark_read` | messaging |

**Clock sync:** `GET /api/heats/{id}/live-start` returns `live_start`, `serverReceivedTime` and `serverSentTime`. The screen adjusts for network delay (NTP-like), so every screen shows the same race time.

---

## 8. API map (grouped, 226 paths)

| Area | Main endpoints |
|---|---|
| Event | `/api/competition` (list/create), `/api/competition/{id}` (+ `/admin`, `/dashboard`, `/stats`, `/publish`, `/un-publish`, `/media`, `/division`, `/divisions/order`, `/affiliate-links`, `/custom-message`, `/final-invitations`, `/forms…`, `/organisers…`, `/meta-connection`, `/meta-events`, `/checkin-stats`, `/ticket-stats`), `/api/competitions/{id}/frozen \| judging/* \| tags \| support-conversation \| validate-otp` |
| Athletes and teams | `/api/competition-athletes…` (move-to-final, minor-consent, resend-waiver), `/api/teams…` (members, check-in), `/api/waiting-lists`, `/api/name-change-requests` |
| Divisions | `/api/divisions/{id}` (+ `/duplicate`, `/validate-otp`, `/announcement`) |
| Workouts | `/api/wods` (+ `/order`, `/ratings`), `/api/workouts…`, `/api/workouts/{id}/results…`, `/api/workouts/results/bulk-upload \| import-url`, `/api/global-wods`, `/api/club-wods` |
| Heats / planning | `/api/heats…` (generate, duplicate, move, order, update, athletes, users, announcement, live-start, mongo), `/api/new/heats…`, `/api/sections…` (fill, repopulate, bulk copy/move/delete), `/api/locations`, `/api/judge-groups` |
| Leaderboard | `/api/leaderboard`, `/api/leaderboard/team`, `/api/leader_live`, `/api/leaderboard/cache`, organization / global leaderboards |
| Money | `/api/payment/*` (currencies, session, purchase, ticket, pending balances, mark-paid-cash, deposit deadline), `/api/payments/stats`, `/api/refund`, `/api/promotion-codes…`, `/api/connect-stripe`, `/api/paypal/onboard` |
| Ticketing | `/api/ticket-types…` (seats, available, validate-otp), `/api/tickets…` (assign, resend, swap, bulk-delete) |
| Messaging | `/api/conversations…` (messages, participants, tags, mark-read), `/api/push-message`, `/api/competition-appeals/{id}`, `/api/competition-templates` (email templates) |
| Other | `/api/queue/*`, `/api/licenses`, `/api/organizations…`, `/api/global-organizations/{id}`, `/api/sponsors`, `/api/ai/global-concierge`, `/api/export/team-images` |

---

## 9. Judge / access codes (there are 4 kinds)

1. **Event Live Scoring password** (`competition.live_scoring_otp`): generated **in the browser** with `Math.random()`, 6 digits, one per event (Scoring > Settings).
2. **Per-judge OTP** (new Staff service): generated **by the server** (`PUT /organisers/{id}/otp`), shown and copyable for each judge.
3. **Division / event unlock code** for registration (`validate-otp` on divisions/competitions; "Protected by password" visibility).
4. **Ticket unlock code** (6 digits) for hidden spectator tickets.

---

## 10. Notes and risks (inference)

- **`/api/push-message` is a general broadcast relay** that browser code calls with any channel and event name. Whether the server limits who can call it, and which channels they can use, can't be seen from the client. If it doesn't, someone could send fake timer or score events to screens.
- **Event live-scoring password:** client-side `Math.random()`, 6 digits, no visible expiry. The newer per-judge server OTP is the safer design.
- **HEATs are being migrated** (old method ends for events after July 30) to "HEATs (Beta)" with locations and sections. Volunteers/Hosts are moving to the new Staff forms.

---

## 11. What's certain vs inferred vs unknown

- **Seen in your account (view-only):**
  - every admin page and its sections and labels listed in §5
  - the Pusher connection
  - REST calls on Dashboard/General
- **Read from code:**
  - all enums (event style, templates, workout types, units, formulas, lane/sort options)
  - the HYROX stations, Flow/live_scoring structure, scoring rules
  - the endpoint list, real-time channels, relay usage, clock sync, queue
- **Inferred:**
  - MongoDB for live heat state (from the endpoint name)
  - score events sent by the Judge App
  - hybrid heats counted as one workout
- **Unknown:**
  - server-side ranking / points maths and tie-break order
  - Judge App requests
  - the authorization rules on `/api/push-message` and on the OTP checks
  - pages that only appear with data (e.g. a filled division form, heats with athletes), since your event is still mostly empty
