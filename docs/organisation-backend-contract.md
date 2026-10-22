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
