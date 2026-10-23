# Organisation update — backend contract

What the organizer space of `apps/mobile-rn` already uses but the API does not have yet. Today the app answers these
on the device (`src/core/api/org-local.ts`, design `docs/superpowers/specs/2026-10-22-organisation-update-design.md`).
This file is the backend's to-do list for Rust part 4.

**To move an item to the server:**
1. Build it with the shapes below.
2. Remove its entry from `ORG_LOCAL_LAYER`.
3. Delete its section here.

The screens do not change.

**Security limit of the local layer (until the server takes these over):**
- The device store (`org-local:v1`) is shared by every account signed in on that phone or browser, and it stays after sign-out.
- It holds contact emails, the invited-email list and the registration and unlock codes.
- That is what lets one browser demo organizer → athlete → judge → displays. But any build given to real users must use `EXPO_PUBLIC_ORG_LOCAL=false`, or the server must store these fields first. Codes must then be stored hashed and checked with a rate limit.

Conventions (same as the existing competitions API):
- Paths are under `/api/v1`. Organizer routes look rows up with `{ id, competitionId }`.
- Errors use the existing body `{ code, title, status, errors: [{ field, code }] }`.
- Money is in minor units (TND millimes). Dates are ISO-8601 UTC.
- Rows made on a device have ids starting with `loc_`. An import from the device must give them server ids.

## Competition fields

The app sends these fields in `POST /competitions` and `PUT /competitions/:id`, and expects them in
`GET /competitions/:id` and in each item of `GET /competitions`. Today the layer takes them out of the request and
adds them back to the response.

| Field | Type | Default | Since | Notes |
|---|---|---|---|---|
| `eventStyle` | `FUNCTIONAL_FITNESS` \| `HYBRID_RACE` | `FUNCTIONAL_FITNESS` (existing events) | phase 1 | Workouts ranked by points (CrossFit-style) or one race of stations ranked by time (HYROX-style). Unrelated to `format` (`ONLINE` / `ONSITE` / `HYBRID`). Read with `eventStyleOf()`. Changing it is refused once the event has a WOD or a flow (ruling 1) |
| `hybridTemplate` | `HYROX_STYLE` \| `CUSTOM` \| `null` | `null` | phase 2 | Required when `eventStyle` is `HYBRID_RACE`; `null` otherwise |
| `visibility` | `PUBLIC` \| `PASSWORD` \| `LINK` | `PUBLIC` | phase 2 | `PUBLIC`: listed, anyone registers. `PASSWORD`: listed, registering needs `accessCode`. `LINK`: not listed in the feed, the link is enough |
| `accessCode` | 6-digit string \| `null` | `null` | phase 2 | Only when `visibility` is `PASSWORD`. The app makes it from `expo-crypto` random bytes; the server should store a hash and check it on `POST /competitions/:id/register` (refusal `ACCESS_CODE_INVALID`, with a rate limit) |
| `participantTypes` | (`INDIVIDUAL` \| `TEAM`)[] | `["INDIVIDUAL"]` | phase 2 | At least one |
| `label` | `NONE` \| `QUALIFIER` \| `FINAL` \| `CHARITY` \| `BATTLE` \| `CHALLENGE` \| `WORKSHOP` | `NONE` | phase 2 | Shown on the event page |
| `inviteOnly` | boolean | `false` | phase 2 | Only invited athletes register (phase 4 uses `settings.invitedEmails`) |
| `organizerName` | string ≤ 300 | `""` | phase 2 | Legal entity organizing the event |
| `contactEmail` | email | `""` | phase 2 | **Required for publication** (checklist item `CONTACT`); the server's publication check should refuse a draft without it |
| `website`, `rulebookUrl` | `http(s)://…` | `""` | phase 2 | |
| `instagram`, `facebook` | string (no leading `@`) | `""` | phase 2 | |
| `videoUrl` | YouTube or Vimeo URL | `""` | phase 2 | Presentation video of the event (not a WOD's demo video) |
| `settings` | object, below | defaults below | phase 2 | Settings page |

`settings`:

| Key | Type | Default | Notes |
|---|---|---|---|
| `countVisibility` | `SHOW` \| `HIDE` | `SHOW` | Registration count on the event page |
| `maxIndividuals`, `maxTeams` | integer ≥ 1 \| `null` | `null` | `null`: no limit (the competition's `maxParticipants` still applies) |
| `hideAthletesTab` | boolean | `false` | |
| `coachAssignment` | boolean | `false` | Athletes may name a coach |
| `restrictToEmailList` | boolean | `false` | When true, only `invitedEmails` register |
| `invitedEmails` | lower-case emails, no duplicates | `[]` | |
| `confirmationMessage` | string ≤ 2000 | `""` | Appended to the confirmation email |
| `notifyOnRegistration` | boolean | `false` | Email the organizers at each registration |
| `appeals` | `{ enabled: boolean, price: millimes, maxPerAthlete: integer ≥ 1 \| null, deadline: ISO \| null }` | disabled, free | |
| `neutralCountries` | ISO 3166 alpha-2, upper case | `[]` | Athletes of these countries show a neutral flag |

Phase 3 adds three competition fields:

| Field | Shape | Notes |
|---|---|---|
| `pricing` | `{ payout: PLATFORM \| DIRECT, fee: PASS \| SPLIT \| ABSORB, tax: { enabled, percent, number, mode: INCLUDED \| ADDED }, deposit: { enabled, type: FIXED \| PERCENT, value, deadline: ISO \| null, refundable } }` | `deposit.value` is millimes for `FIXED`, a percentage for `PERCENT`. The platform fee itself (4 % + 1.5 TND in the app, `PLATFORM_FEE`) is a placeholder: the server must own the real rate and compute the amounts (`priceBreakdown()` is the reference) |
| `registrationForm` | `[{ id, label ≤ 80, type: TEXT \| NUMBER \| SELECT \| SIZE \| DATE \| PHONE, required, options: string[] }]` | `SELECT` needs ≥ 2 options; `SIZE` answers are XS–XXL. Answers are checked with `answerProblems()` |
| `agreements` | `{ liability: { required, text }, custom: { required, title, text }, minors: { enabled, age 1–21, photoConsent }, medicalReport: { required, description }, additionalDocument: { required, title, description }, faceRecognition: { required } }` | A required agreement needs its text |

## Category (division) fields

The app sends these in `POST /competitions/:id/categories` and `PUT /competitions/:id/categories/:categoryId`, and
expects them on each item of `categories` in `GET /competitions/:id`. Today the layer keeps them per category id.

| Field | Type | Default | Notes |
|---|---|---|---|
| `type` | `INDIVIDUAL` \| `TEAM` | `INDIVIDUAL` | |
| `teamMale`, `teamFemale` | integer 0–20 \| `null` | `null` | Teams only; together at least 2 |
| `parentId` | category id \| `null` | `null` | Sub-division, one level only (a parent has no parent; a division with sub-divisions is not one) |
| `locked`, `unlockCode` | boolean, 6 digits \| `null` | `false`, `null` | Registering in a locked division needs the code (`POST /divisions/:id/validate-otp` in the research); store a hash |
| `earlyPrice`, `earlyUntil` | millimes \| `null`, ISO \| `null` | `null` | Below the division's price; ends before registration closes. `effectivePrice()` is the reference |
| `teamNameChangeUntil`, `memberChangeUntil` | ISO \| `null` | `null` | Teams only |
| `memberChangePrice` | millimes \| `null` | `null` | Teams only |
| `oneMemberStays` | boolean | `false` | Teams only |

Copying a previous event (phase 2) needs no new route: the app reads the source with `GET /competitions/:id`,
creates the draft, then posts the categories and the WODs (dates moved by the gap between the two event starts)
through the existing routes.

## Registration extras (phase 4)

The app sends these with `POST /competitions/:id/register` next to `categoryId` and `couponCode`. It expects them back on
that answer, on `myRegistration` in `GET /competitions/:id`, and on each item of `GET /competitions/:id/registrations`.
Today the layer keeps them per registration id (`collections.registrations`).

| Field | Shape | Notes |
|---|---|---|
| `answers` | `{ [fieldId]: string }` | Answers to `registrationForm`; the server should check them with the rules of `answerProblems()` |
| `agreementsAccepted` | (`LIABILITY` \| `CUSTOM` \| `MEDICAL` \| `DOCUMENT`)[] | Every required agreement must be in the list |
| `faceRecognition` | boolean | Only when the organizer asks |
| `teamName`, `teamMembers` | string 2–60, lower-case emails | Team divisions: `teamMembers` holds `teamMale + teamFemale − 1` distinct emails (the captain registers). The server should invite them |
| `giftFor` | email | Registering someone else |
| `paymentPlan` | `FULL` \| `DEPOSIT` | `DEPOSIT` only when `pricing.deposit.enabled`; the balance is due by `pricing.deposit.deadline` |
| `guardian` | `{ name, email, phone, consent: true, photoConsent? }` | When the athlete is under `agreements.minors.age` |

**What the server must do itself, since the app only shows it:**
- apply the division's early-bird price;
- apply the event code (`visibility: PASSWORD`) and the division code (`locked`);
- apply invite-only (`inviteOnly` / `settings.restrictToEmailList` with `settings.invitedEmails`);
- refuse a full division with `409 CATEGORY_FULL`; the app then offers the waiting list.

`settings.highDemand` (boolean, phase 4) puts athletes in a queue before the form. Today the app simulates it
(`queueStart`/`queueTick`). The research's server shape is `POST /queue/join {competition_id}` →
`{ status: not_required | waiting | admitted, token, position }`, then `GET /queue/status/:token`.

## Routes

| Route | Body / answer | Since | Notes |
|---|---|---|---|
| `GET /competitions/:id/waiting-list` | `[{ id, categoryId, name, email, createdAt }]` | phase 4 | Organizer; sorted by `createdAt` |
| `POST /competitions/:id/waiting-list` | `{ categoryId, name, email }` → `201` entry | phase 4 | The athlete of a full division. `422` without a category or a valid email |
| `DELETE /competitions/:id/waiting-list/:entryId` | `204` | phase 4 | Organizer (phase 5 invites the next one) |

Phase 5 lists all follow the same pattern:
- `GET /competitions/:id/<list>` returns the items;
- `POST` creates one, and an `id` in the body replaces the item with that id;
- `PUT /:itemId` merges fields (`404` if unknown);
- `DELETE /:itemId` answers `204`;
- `422 VALIDATION_FAILED` names the missing field.

| List | Item | Required | Notes |
|---|---|---|---|
| `sponsors` | `{ id, name, country?, showOnLeaderboard, showOnLanding, createdAt }` | `name` | |
| `checkins` | `{ id: registrationId, createdAt }` | | One per registration; `DELETE` undoes a check-in. The server should also check teams in (`/teams/:id/checkin` in the research) |
| `finalist-invitations` | `{ id: "<categoryId>:<userId>", categoryId, categoryName, userId, name, rank, status: INVITED }` | `userId` | Built from the qualifier's `GET /competitions/:q/leaderboard?categoryId` (top N per division). The server should notify the athlete and let them accept (`/final-invitations` in the research) |
| `staff-forms` | `{ id, title, roles: string[], shifts: string[] }` | `title` | The public page `/competitions/:id/staff-apply?form=<id>` reads it (anyone, also signed out) |
| `staff-applications` | `{ id, formId, name, email, role, shifts: string[], status: PENDING \| APPROVED \| DECLINED, checkedIn }` | `name`, `email`, `role` | Anyone may `POST` one; only organizers read, approve, decline and check in |
| `locations` | `{ id, name, lanes }` | `name` | Phase 6: stages and floors |
| `heat-locations` | `{ id: heatId, locationId }` | `locationId` | Phase 6: should become a `locationId` column on `competition_heats` |

## WOD fields (phase 6)

The app sends these in `POST /competitions/:id/wods` and `PUT /competitions/:id/wods/:wodId`, and expects them on each
item of `workouts` in `GET /competitions/:id`. Today the layer keeps them per WOD id (`collections.workoutExtras`).

| Field | Shape | Notes |
|---|---|---|
| `scorecard` | `{ sets: [{ name, rounds ≥ 1, increment, movements: [{ name, reps ≥ 1, unit, countEvery 1..reps }] }], tieBreakAfterSet: 1..sets \| null }` | What the judge counts (phase 8). `scorecardTotal()` and `tapSteps()` are the references |
| `penalties` | `{ noRepSeconds, missedRepSeconds, minorPct, majorPct }` | |
| `tieBreak` | `NONE` \| `TIME` \| `REPS` | |

The advanced heat generator (phase 6) needs no new route. It plans in the app (`laneOrder`, `sortEntries`,
`planHeats`) and calls `POST /competitions/:id/heats` and `POST /competitions/:id/heats/:heatId/lanes`. A server
version would take `{ categoryId, workoutId?, locationId?, sort, placement, lanes, perHeat, startsAt, durationMin, transitionMin, pauseEvery?, pauseMin? }`.

## Live events

Today they travel on one device only (`src/core/live-bus.ts`): in the page, and to other tabs of the same browser
through `BroadcastChannel('fl-live')`.

**What the server must provide:**
- the same names over the competition socket rooms (Rust plan 3c / part 4);
- an authorization check per channel: only staff of the competition may publish; anyone may listen to a published
  event's display channels.

| Message | Shape |
|---|---|
| Any event | `{ channel: string, event: string, payload: object }` |

Channels and events are added by the phases that use them (8: judges and timers, 9: displays).
