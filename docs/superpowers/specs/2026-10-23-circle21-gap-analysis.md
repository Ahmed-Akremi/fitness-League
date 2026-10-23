# Circle21 gap analysis — what the Fitness League interface still lacks

Date: 2026-10-23. Branch `organisation-update` (all 12 phases built).
Compared with: `circle21-event-organisation-report.md` (repo root).
Method: keyword search in `apps/mobile-rn/src` and `src/core/i18n/en.json`, checked against the report. This is not a
screen-by-screen review.

## Scope rule for any follow-up

- **Frontend only:** everything goes in `apps/mobile-rn`.
- **Backend:** nothing changes under `apps/api`, `apps/backend` (Rust), `apps/admin` or `apps/landing`.
- **No new API:** no new server endpoint and no change to existing ones.
- New data goes through the existing local mock layer (`core/api/local-routes.ts`, `local-store.ts`, `loc_` ids),
  like the organisation update. Live events go through `LiveBus`.
- The `handoff-frontend.md` rules apply: i18n in en/fr/ar, `testID`s, no new native dependency, prices in millimes.

## Already covered (not gaps)

The update already covers:
- creation in steps: CrossFit / HYROX-style mode, visibility, label, invite-only, copy from a previous event
- team divisions, sub-divisions, locked divisions, early-bird pricing, fees, VAT, deposits
- registration form, agreements, minors
- queue, gift and team registration, waiting list
- participants, finalists, sponsors, check-in
- staff forms, applications, roles, shifts
- scorecard builder, penalties, tie-breaks, locations, heat generator options
- Competition Flow, waves, hybrid timetable, race judge screen
- `/display/*` screens (timer, heat, lane, race, leaderboard, schedule, call) and the Tools page
- results: hybrid total time, points, freeze, visibility, CSV import
- message segments, scheduled messages, outbox
- spectator tickets, shop

## 1. Missing from the interface

| Area | What Circle21 has | Fitness League today |
|---|---|---|
| Messaging | One-to-one and group chat with athletes, judges and volunteers; tags (APPEAL, In-Review, Approved, Declined, custom); appeals handled inside the chat; support chat | Only a « Request a review » button and the appeals settings |
| Messaging | Attachments (up to 10 MB), `{{user_name}}` placeholder in custom messages | None |
| Marketing | Referral / affiliate links with registrations tracked per link | None |
| Marketing | Facebook Pixel, Meta Business integration | None |
| Marketing | Event Partnership Rewards (automatic promo code for athletes who join two linked events) | None |
| Online judging | Video-review panel: judging teams, division and status filters, to review / reviewed / in review / blocked totals | Only the « Start judging » step |
| Workouts | Weightlifting formulas: Sinclair, Q-points, IPF GL, Q-masters | None |
| Workouts | « Allow scaling » per workout | None |
| Workouts | Global WODs and global divisions (organisation templates, diff modal) | None |
| Workouts | Scorecard printed as a PDF (portrait / landscape) | None |
| Live tools | Event slider (slideshow with an interval) | None |
| Live tools | Division leader display | None |
| Live tools | Embeddable leaderboard (dark / light theme) | None |
| Event creation | Timezone (all dates shown in it) | None |
| Event creation | Eligibility by licence / organisation membership, licence bought during registration | None |
| Settings | Brand colours | None |
| Dashboard | Top 5 countries and top 5 clubs | Gender, divisions, registrations per day only |
| Ticketing | Ticket swap | None |
| Heats | Judge groups and automatic judge assignment | None |
| Heats | Printing the heat list | None |

## 2. Present but simulated (stays so: frontend only)

Each of these needs a server to be real. Under the scope rule they stay local or simulated; the interface should
keep saying so (the « Local » badge).

- **Data on one device or browser only.** Nothing is shared between devices or shown in the admin panel.
- **Live events** (judge → TV) use `BroadcastChannel`: same browser only. Circle21 uses Pusher across devices.
- **Payments:** no Stripe or PayPal; deposits and « paid » are marked by hand.
- **Emails and push:** the outbox lists what would be sent.
- **Queue and unlock codes:** simulated on the device. The security review says the server must enforce them later
  (`docs/organisation-backend-contract.md`).

## 3. Known problems (from `handoff-frontend.md`, frontend fixes)

1. **A cold load lands on « Email verification »:** any typed address opens `/verify-email`, because the guarded
   route is not ready while the session loads (`shell/root.tsx`).
2. **Arabic is not mirrored on the web:** nothing sets `dir="rtl"` on the page.
3. **A `<button>` inside a `<button>` on Planning:** the heat row (`ListRow` with `onPress`) holds its edit
   `IconButton`.
4. **No organizer link to the race judge screen:** it only opens from a floor-judge invitation card.

## Deliberate choices (not gaps)

- No event live-scoring password and no judge OTP: floor judges are app accounts (organisation update, ruling 5).
- No drawn signature: it would need a native library (ruling 6).

## Suggested order

1. The four problems in part 3.
2. Messaging: chat with tags and appeals in the chat (local data, `LiveBus` for new messages).
3. Live tools: event slider, division leader display, embeddable leaderboard (new `/display/*` kinds).
4. Workouts: scaling, weightlifting formulas (pure `logic-*.ts`, unit-tested), scorecard print.
5. The rest of part 1: timezone, top countries and clubs, referrals, ticket swap, judge groups, brand colours.
