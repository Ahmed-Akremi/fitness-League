# Organisation update — demo script

A walk through every page of the update in **one browser** (web build), about 20 minutes. The local layer
(`EXPO_PUBLIC_ORG_LOCAL`, on by default) keeps the new data in this browser. The live bus carries the updates between
its tabs: open the organizer, judge and TV screens as tabs of the same browser window.

The two flows marked 🤖 are also an automated test: `apps/mobile-rn/test/screens/organisation-demo.test.tsx`.

## 0. Setup

1. `pnpm infra:up && pnpm --filter @fitness-league/api dev` (the API), then `cd apps/mobile-rn && npx expo start --web`.
2. Sign in with an organizer account.
3. **Accounts:** the local data belongs to the browser, not to an account. One browser holds one signed-in account
   at a time, so play the athlete or the judge by signing out and in again **in the same browser**. A private window
   or another browser starts with empty local data.

## 1. Event setup (phases 2–3)

1. **Create an event:**
   - Competitions → Create; pick **Hybrid race → Hybrid race – 8 stations (HYROX-style)**;
   - visibility *Password* (a 6-digit code appears), participants *Individuals*, label *Qualifier*.
2. **General:** add the contact email (the checklist item *Contact* turns green), Instagram, a rulebook link.
3. **Settings:** maximum 40 individuals, appeals on (5 TND, with a deadline), a neutral country.
4. **Divisions:** add *RX Men* (individual) and *RX Pairs* (team, 1 man + 1 woman), early-bird price until next week.
5. **Pricing:** fee *Split*, VAT 19 % *added*, a 30 % deposit; the breakdown updates.
6. **Waiver & form:** a T-shirt size question (`SIZE`, required), the liability agreement, minors under 18 with photo
   consent.

## 2. Athlete registration (phase 4)

1. Sign in as an athlete, open the event → **Register**:
   - the code is asked (password visibility);
   - pick *RX Pairs*, enter the team name and teammate;
   - answer the form, accept the agreements, pick *Deposit*.
2. « My registration » on the event page shows the team and the deposit plan.

## 3. Participants and staff (phase 5)

1. Back as the organizer → **Roster:**
   - check the athlete in (the count goes up);
   - add a sponsor;
   - invite the finalists of a linked qualifier.
2. **Staff:**
   - create a staff form (roles *Judge*, *Volunteer*; shifts *Sat AM*, *Sat PM*);
   - open its public link `/competitions/<id>/staff-apply?form=…` in another tab and apply;
   - approve the application.

## 4. Hybrid race (phases 7, 8, 9, 10) 🤖

1. **Race:** choose *HYROX-style*. The 16 stages (a 1 km run before each of the 8 stations) are fixed → **Save**.
   A custom race instead lets stages be added, moved, given breaks, a time cap and a +5 s rule.
2. **Waves:**
   - choose *RX Men*, 10 per wave, every 10 min → **Generate waves**;
   - tick wave 1 → **Start selected**. The header reads « 1 racing · N waves ».
3. **Tools:** open **Race view** and **Timer** in two new tabs. They need no sign-in once the event is published.
4. In another tab, open `/competitions/<id>/judge/race` (**Judge the race** on the judge space of a hybrid event):
   - pick the wave and an athlete;
   - tap **Run done** / **Station done** at each stage, the rule penalty once.
   The race view tab shows the athlete's progress bar and splits at once.
5. **Results:**
   - *RX Men* shows the race standings with the station times (runs hidden);
   - set *Finalists per division* to 2 (the line appears) and *On the screens: Random order* → **Save**;
   - **Freeze the standings**. The leaderboard display (Tools → Leaderboard) keeps that moment.
6. **CSV import:**
   - paste `Name;Time` lines → **Check**: the dry run lists unknown names and unreadable times;
   - **Import** the good lines; they join the ranking.

## 5. Functional fitness (phases 6, 8, 9) 🤖

1. Create a second event, *Functional fitness*.
2. **WODs:** a For Time WOD with a scorecard:
   - set A: 21-15-9 thrusters + pull-ups;
   - tie-break after set A;
   - penalties: 5 s per missed rep.
3. **Planning:**
   - add a location *Main floor*;
   - generate the heats with the advanced options (sort, where the best athletes go, lanes, duration, transition).
4. **Planning → lanes:** put a floor judge on lane 3 (an app account invited as floor judge).
5. Sign in as that judge, `/competitions/<id>/judge` → the heat:
   - the screen walks the scorecard;
   - each tap shows on Tools → **Live heat**;
   - the tie-break time is taken at the end of set A.
6. **Live** (as the organizer):
   - a 12-minute AMRAP for *Main floor* → **Start**: Tools → **Timer** (with `loc=`) counts down from the same start;
   - pause and resume;
   - **Calls**: pick the heat → *Call to warm-up*; the **Call screen** shows it.
7. **Results:** *Rank = points* re-ranks from the server's per-WOD points; the equal totals explain themselves
   (countback, then the last WOD).

## 6. Messages, tickets, shop (phase 11)

1. **Messages:**
   - *Not paid yet* shows the recipient count;
   - send now: the outbox lists it as *Sent*;
   - schedule one for tomorrow, then **Cancel** it.
2. **Tickets:**
   - add *General* (15 TND, 200);
   - as an athlete or spectator, the event page shows **Tickets & shop** → reserve 2 → a code like `ABCD-EFGH`;
   - as the organizer, **Mark paid**, then type the code under *At the door* → « Valid »;
   - type it again → « Already used ».
3. **Shop:**
   - add *Event T-shirt* (40 TND, stock 50, sizes S M L);
   - reserve one size M from the shop page;
   - mark it paid, then picked up.

## 7. Right to left and screens

- Switch the language to **العربية** (Settings): every page above reads right to left.
- Every display takes `?overlay=1` (Tools → *Green-screen overlay*): the background turns transparent for the stream.

## Known limits (say them during the demo)

- New data stays in this browser: another device or the admin panel does not see it until the backend exists
  (`docs/organisation-backend-contract.md`).
- Payments are simulated (deposit, tickets, shop: paid on site). Messages are not sent; the outbox shows what would be.
- **Real users:** build with `EXPO_PUBLIC_ORG_LOCAL=false`. The local store keeps personal data unscoped, including
  the guardian details of minors, and it stays after sign-out (see the contract's security note).
