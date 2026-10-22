# Organisation update — backend contract

What the organizer space of `apps/mobile-rn` already uses but the API does not have yet. Today the app answers these
on the device (`src/core/api/org-local.ts`, design `docs/superpowers/specs/2026-10-22-organisation-update-design.md`).
This file is the backend's to-do list for Rust part 4.

**To move an item to the server:**
1. Build it with the shapes below.
2. Remove its entry from `ORG_LOCAL_LAYER`.
3. Delete its section here.

The screens do not change.

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

Copying a previous event (phase 2) needs no new route: the app reads the source with `GET /competitions/:id`,
creates the draft, then posts the categories and the WODs (dates moved by the gap between the two event starts)
through the existing routes.

## Routes

None yet (phase 1 only lays the mechanism).

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
