# Floor judging in the app (on-site events) — design

Date: 2026-10-21. Owner's request (FR): on a real (on-site) competition made by an organizer, the organizer
invites existing app users as judges; one judge per athlete; each judge finds their heats, the WOD and the
athlete's name; For Time = the judge stops the clock when the athlete finishes; AMRAP / EMOM = a + / − rep
counter. Modelled on circle21's judge app (circle21 Live: assigned heats and workouts, a scoring template per
format, judges paired with athletes).

## Scope

- **Untouched:** the admin panel judges (judge accounts `JUDGE` / `HEAD_JUDGE`, video review of online
  scores). Owner: « laisse la partie admin ». Judge accounts stay refused by the app (403 `JUDGE_ACCOUNT`).
- **New:** floor judges, a per-competition role held by ordinary app users, for `ONSITE` and `HYBRID` events.

## Data (migration `20261021120000_floor_judging`)

| Change | Why |
|---|---|
| `CompetitionStaffRole` + `FLOOR_JUDGE` | A new role, so no existing rule (queue, review, publication) grants it anything |
| `competition_staff.accepted_at` (null = invitation pending) | Invitation, accepted or declined by the user |
| `competition_heat_lanes.judge_staff_id` → `competition_staff` (set null on delete) | One judge per lane = one judge per athlete |
| `competition_heats.started_at` | Common start: every judge's clock counts from the same instant |

## API (`apps/api`, competitions module; same routes to keep when the Rust part 4 is written)

| Route | Who | What |
|---|---|---|
| `POST /competitions/:id/staff` `{userId, role: FLOOR_JUDGE}` | organizer | Invites an app user (`USER` / `GYM_ADMIN` accounts only); on-site or hybrid events only; notification `COMPETITION_JUDGE_INVITED` |
| `DELETE /competitions/:id/staff/:staffId` | organizer | Withdraws the invitation / removes the judge (their lanes become free) |
| `GET /competitions/floor-judging` | any user | My invitations and my judged events |
| `POST /competitions/:id/floor-judging/accept` · `/decline` | the invitee | Accept (sets `accepted_at`) or decline (deletes the row) |
| `PUT /competitions/:id/heats/:heatId/lanes/:lane/judge` `{staffId \| null}` | organizer | Puts a floor judge on a lane; a judge holds one lane per heat |
| `POST /competitions/:id/heats/:heatId/judges/auto` | organizer | Fills the judge of every occupied lane without one, with accepted judges free in that heat |
| `POST /competitions/:id/heats/:heatId/start` · `DELETE …/start` | organizer or a judge of the heat · organizer | Starts the heat clock once (idempotent) · false start: clears it |
| `GET /competitions/:id/floor-judging/lanes` | accepted floor judge | My lanes: heat, start, WOD (with the category's version), athlete, category, the score already sent |
| `PUT /competitions/:id/heats/:heatId/lanes/:lane/score` | the lane's judge, or an organizer | The score; see below |
| `GET /competitions/:id/heats` | everyone | Each lane gains `judge` (name) and `judgedByMe`; each heat gains `startedAt` and `serverTime` |

### The score

Body: `{clientId, raw, athleteConfirmed: true, notes?}`. `raw` has the shapes of the athlete's form
(`timeS`; `capped` + `reps`; `rounds` + `reps` + `repsPerRound`; `reps`; `movementReps`; `value`) plus the floor
extras `tieBreakS` and `noReps`. The server computes `rawValue` with the same `rawValue()` as online scores.
In one transaction: the submission is created or corrected with status **FINAL** (the judge's word on the floor,
confirmed by the athlete), a `ScoreVersion` with the judge's id and the reason `Floor judge · <heat> · lane N`,
the category leaderboard is recomputed (live leaderboard), an audit row, the athlete's notification
`COMPETITION_SCORE_APPROVED`. Replaying the same `clientId` returns the stored score (offline retries).

## Rulings (the owner can change them)

1. **Score goes FINAL at once.** On site the athlete confirms in front of the judge; there is no head judge in
   the app. Corrections: the same judge or an organizer sends the lane again (new version, audit). Refused once the
   final leaderboard is locked.
2. **Athlete confirmation = a tap**, « Je confirme mon score », on the judge's phone, with the athlete's name.
   A drawn signature needs a new native library: later.
3. **Time-capped For Time**: the judge counts the reps done; `maxReps` is the fixed 100 000, so every capped
   athlete ranks after every finisher, by reps. Exact for on-site events, where every score comes from a judge.
4. **Tie-break and no-reps are stored** (`raw.tieBreakS`, `raw.noReps`) and shown to the organizer; the WOD
   ranking does not use the tie-break yet (the leaderboard tie-break rules stay as they are).
5. **A judge never scores their own lane** (an athlete may judge other heats, as at local events).
6. **Offline**: a score that could not leave the phone is kept on it (same `clientId`) and sent again when the
   network returns; the screen says « en attente d'envoi ».
7. **No new native dependency** (no keep-awake, no haptics module, no signature pad).

## App (`apps/mobile-rn`)

- **Organizer → Équipe:** section « Juges sur place » (on-site / hybrid only): invite by searching an app user,
  status « invitation envoyée » / « a accepté », remove.
- **Organizer → Planning → a heat:** each lane shows its athlete and its judge; « Juge » picks one; « Répartir
  les juges » fills the free ones.
- **Invited user:** a card on the competition page « Tu es invité comme juge » with Accepter / Refuser; the
  notification opens that page.
- **Judge space** `/competitions/[id]/judge`: my lanes by start time (heat, lane, WOD, athlete, status sent or
  not), then `/competitions/[id]/judge/[heatId]`, the scoring screen:
  - header: heat, lane, athlete (large), WOD, standards, time cap;
  - clock from the heat's common start (« Lancer le heat » if not started; the others see it within 5 s);
  - For Time: a big « FINI » stops the athlete's time; at the cap the screen switches to counting reps; « TB »
    records the tie-break time;
  - AMRAP / EMOM / reps: big « + 1 », smaller « − 1 », « + round » for rounds + reps, one counter per movement
    for movement-scored WODs; a « no rep » counter;
  - other types (load, distance, calories…): a number field;
  - « Valider » → the athlete confirms → sent; corrections allowed after.
