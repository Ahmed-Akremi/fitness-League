# Organizer Space — Lot B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The organizer runs the event from the mobile app: planning (heats, lanes, clock, « Retard »), participants and cash collection, team, leaderboard, announcements and promo codes; the dashboard gets the breakdown of registrations, and WODs get per-category versions and a release date.

**Architecture:** Frontend only: every screen calls a route that already exists in `apps/api` (no API, schema or admin-panel change). Each new tab of the organizer space is one file in `apps/mobile-rn/src/features/competitions/organizer/`; the pure rules they share live in a new `logic-b.ts` (lot A's `logic.ts` keeps lot A's rules) and are unit-tested on their own. Long lists use `FlatList`.

**Tech Stack:** Expo / React Native + Expo Router + React Query (Jest + `expo-router/testing-library`, `FakeBackend` from `test/fake-api.ts`, `renderScreen` from `test/harness.tsx`).

**Spec:** `docs/superpowers/specs/2026-10-14-organizer-space-design.md` (§1.3 items 5–10, §1.3 item 4 for the per-category WODs moved from lot A, §1.4, §4). Conventions and earlier interfaces: `docs/superpowers/plans/2026-10-14-organizer-space-lot-a.md`.

## Global Constraints

- Branch `feat/organizer-space-lot-b`, created from `feat/organizer-space` at `da155c1` (lot A, pushed; its PR is reviewed separately). Stage files **by name**; never `git commit -a` or `git add -A`: `.gitignore`, `apps/admin/tsconfig.tsbuildinfo`, `apps/mobile-rn/package-lock.json`, `infra/docker-compose.yml`, `infra/mariadb/init/01-accounts.sql` and three Rust plan/spec docs show as modified only by line endings. Check `git diff --cached --stat` before each commit. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No change under `apps/api` or `apps/admin`.** Server rules the screens rely on (all existing):
  - `GET /competitions/:id/registrations`: organizer or head judge; rows carry `id, categoryId, userId, registrationStatus (PENDING|CONFIRMED|CANCELLED|REFUNDED), paymentStatus (PENDING|PAID|FREE|FAILED|REFUNDED), finalPrice, currency, registeredAt, category { name }, user { username, profile { fullName } }`, oldest first.
  - `POST …/registrations/:rid/mark-paid`: organizer; only when `paymentStatus` is `PENDING`, else `409 CONFLICT` « Nothing to pay » (no `reason`).
  - `GET …/heats`: anyone; rows `id, number, name, startsAt|null, durationMin|null, laneCount, workout {id,name,number}|null, category {id,name}|null, lanes [{ lane, registrationId, athlete { id, fullName, username }, mine }]`. `POST …/heats`, `PUT …/heats/:heatId` (fields left out are kept), `DELETE …/heats/:heatId` (204): organizer; body `name 1–80, workoutId, categoryId, startsAt ISO, durationMin 1–600, laneCount 1–40`.
  - `POST …/heats/auto` `{ categoryId, workoutId?, laneCount 1–40, startsAt?, intervalMin? 1–600 }` → `{ heats, athletes }`; `409 CONFLICT` with `reason: 'HEATS_EXIST'` when that category already has heats for that WOD.
  - `POST …/heats/:heatId/lanes` `{ registrationId, lane }`: confirmed athlete, of the heat's category when it has one, `lane ≤ laneCount`; `409 CONFLICT` with `reason: 'LANE_TAKEN' | 'ALREADY_IN_HEAT'`. `DELETE …/heats/:heatId/lanes/:lane` (204).
  - `GET …/staff`: organizer or head judge; rows `id, userId, role (ORGANIZER|HEAD_JUDGE|JUDGE), user { username, profile { fullName } }`. `POST …/staff { userId, role: 'ORGANIZER' }`: organizer. `DELETE …/staff/:staffId` (204): organizer for an organizer row.
  - `GET /search/athletes?q=&limit=20` → `{ data: [{ id, username, fullName, … }], page }` (the caller is never in the results).
  - `GET …/coupons`: organizer; rows `id, code, type (PERCENTAGE|FIXED_AMOUNT|FREE), value, categoryId|null, maxUses|null, usedCount, expiresAt|null, active`, newest first. `POST …/coupons`: code `^[A-Z0-9_-]{3,32}$`, `PERCENTAGE` value 1–100, `FIXED_AMOUNT` value > 0 in millimes, `FREE` no value; a code already used → `422` with field error `{ field: 'code', code: 'TAKEN' }`. `POST …/coupons/:couponId/activate` or `/deactivate`.
  - `GET …/announcements`: anyone, last 50, newest first, rows `id, title, body, createdAt`. `POST …/announcements { title 3–120, body 1–5000 }`: organizer; **no notification is sent**.
  - `GET …/leaderboard?categoryId=` → `{ status, provisional, rows [{ rank, athlete { id, fullName, username }, totalPoints, pending }], … }`.
  - **`POST …/publish-leaderboard` accepts only a head judge or a platform admin** (`judging.service.ts` `publish`): an organizer of the app gets 403.
  - WOD `PUT`: `variants: [{ categoryId, description 1–5000, standards?, timeCapS? ≥ 60 }]` replaces all the WOD's variants (left out → kept); `releaseAt` ISO (null or left out → kept: it cannot be cleared).
- **Ruling (spec §1.3 item 8 vs server):** the « Classement » tab is read-only and explains that the head judge publishes the final leaderboard from the admin panel, because the server refuses an organizer and the backend stays frozen.
- **Ruling (spec §1.3 item 6, CSV « fichier partagé »):** the app has no file library (`expo-sharing` / `expo-file-system` are not installed; no new dependency) → the CSV text is shared through the native share sheet `Share.share({ message })`.
- **Ruling (`releaseAt` cannot be cleared):** the WOD form offers « Le montrer maintenant », which sends the current time.
- Money: TND in millimes; display with `formatMoney(amount, currency, locale)` from `apps/mobile-rn/src/features/competitions/api.ts`; parse with `toMillimes` from `organizer/logic.ts`.
- App text in `src/core/i18n/{en,fr,ar}.json` (same keys and same placeholders in the three files; French uses « tu »), all lot B keys added once in Task 1. Arabic is right to left (phones mirror; the web preview does not, by design).
- Mobile: no new dependency; **do not run `npx expo lint`** (the app has no ESLint config: it installs a package and edits `package.json`); the app's lint is `npx tsc --noEmit`; do not touch `android/` or `ios/`. AGENTS.md: run `npx tsc --noEmit` and the tests before declaring a task done.
- Tests: two taps go inside one `await act(async () => { … })` (two bare `fireEvent.press` calls leak act scopes and break the next tests of the file); `FakeBackend` cannot answer 204 → stub `DELETE` routes with `[200, {}]`; `git checkout -- <file>` is blocked by a hook → restore with `git show HEAD:<path> > <path>`. Run Jest with `--maxWorkers=2` for the full suite.
- Long lists (300+ registrations, lane candidates) use `FlatList`, never a `.map` inside a `ScrollView`; search and filters run on the phone.
- `PUT /competitions/:id` is not used in lot B (existing partial-update bug: a `PUT` without the four dates is refused).

## Review Focus

1. **« Retard » across the clock:** heats already started, heats without a start time, and a `PUT` that fails midway → only the heats starting after now move, by exactly X minutes, in running order; the failed ones are listed with « Réessayer », which retries only those from their original start; the announcement is posted once, only when every heat has moved. → Task 1 (`delayTargets`, `runDelay`), Task 3 (screen tests).
2. **Mark paid twice** (double tap, or a co-organizer already did it → 409) → exactly one `POST`; a 409 says the registration was already settled and the list reloads. → Task 4.
3. **Promo batch with a code already taken** in the middle → the other codes are still created, the summary names the skipped one; another error stops the batch and is shown; a double tap starts one batch. → Task 1 (`createCoupons`), Task 8.
4. **300 registrations:** a search on part of a name, without accents or case, finds the athlete; « À encaisser » shows pending, non-cancelled registrations oldest first. → Task 1 (`filterRegistrations`, `toCollect`), Task 4.
5. **Lane assignment:** an athlete of another category, already in the heat, not confirmed, or cancelled is not offered; the free lanes are the missing numbers of 1…laneCount. → Task 1 (`laneCandidates`, `freeLanes`), Task 2.

---

### Task 1: Shared foundation — API client, lot B rules, texts, test fixtures

**Files:**
- Modify: `apps/mobile-rn/src/features/competitions/organizer/api.ts`
- Create: `apps/mobile-rn/src/features/competitions/organizer/logic-b.ts`
- Create: `apps/mobile-rn/test/organizer-fixtures.ts`
- Create: `apps/mobile-rn/test/core/organizer-logic-b.test.ts`
- Modify: `apps/mobile-rn/src/core/i18n/en.json`, `fr.json`, `ar.json` (every lot B key)

**Interfaces:**
- Consumes: `organizerApi`, `useRefreshCompetition` (lot A, `organizer/api.ts`); `toMillimes` (lot A, `organizer/logic.ts`); `ApiError` (`src/core/api/errors.ts`: `fieldErrors`, `extra`, `status`, `code`).
- Produces (used by Tasks 2–11):
  - `organizerApi(api)` gains `registrations(id)`, `markPaid(id, registrationId)`, `addHeat(id, body)`, `autoHeats(id, body)`, `updateHeat(id, heatId, body)`, `removeHeat(id, heatId)`, `assignLane(id, heatId, registrationId, lane)`, `freeLane(id, heatId, lane)`, `staff(id)`, `addOrganizer(id, userId)`, `removeStaff(id, staffId)`, `coupons(id)`, `addCoupon(id, body)`, `setCouponActive(id, couponId, active)`, `announcements(id)`, `announce(id, { title, body })`.
  - Hooks `useRegistrations(id)`, `useStaff(id)`, `useCoupons(id)`, `useAnnouncements(id)` (query keys under `['competitions', id, …]`, so lot A's `useRefreshCompetition()` reloads them). Heats use the existing `useHeats(id)` from `../api`.
  - `logic-b.ts`: `fold`, `personName`, `localDay`, `PaymentFilter`, `filterRegistrations`, `toCollect`, `registrationsCsv`, `freeLanes`, `laneCandidates`, `HeatFilter`, `heatDays`, `filterHeats`, `timetable`, `delayTargets`, `shiftedStart`, `delayMinutes`, `runDelay`, `HeatDraft`, `heatDraft`, `heatValid`, `heatBody`, `AutoDraft`, `autoValid`, `autoBody`, `STAFF_ORDER`, `StaffRole`, `staffByRole`, `CouponKind`, `CouponDraft`, `couponDraft`, `normalizeCode`, `MAX_BATCH`, `batchCodes`, `couponValid`, `couponBody`, `BatchResult`, `createCoupons`, `topUsed`, `announcementValid`, `Distribution`, `distribution`.
  - Test fixtures `test/organizer-fixtures.ts`: `event` (published competition `c9` with categories `k1` RX Men / `k2` RX Women and WODs `w1`, `w2`), `regs` (`r1`…`r5`), `me`, `orgBackend(c?)`.

- [ ] **Step 1: Create the shared test fixtures**

`apps/mobile-rn/test/organizer-fixtures.ts`:
```ts
import { FakeBackend } from './fake-api';

/** Organizer space, lot B: a published event (id c9) organized by the signed-in user, and its registrations. */
export const event = {
  id: 'c9',
  title: 'Sousse Summer Throwdown',
  description: 'Two days on site.',
  status: 'REGISTRATION_OPEN',
  format: 'ONSITE',
  city: 'Sousse',
  location: 'Bodynade',
  countryCode: 'TN',
  currency: 'TND',
  registrationPrice: 40000,
  maxParticipants: null,
  coverUrl: 'https://cdn.test/cover.webp',
  deadlines: { registrationStart: '2026-10-20T08:00:00.000Z', registrationEnd: '2026-12-01T22:00:00.000Z' },
  registrationEnd: '2026-12-01T22:00:00.000Z',
  eventStart: '2026-12-12T08:00:00.000Z',
  eventEnd: '2026-12-13T18:00:00.000Z',
  categories: [
    { id: 'k1', name: 'RX Men', gender: 'MALE', active: true, sortOrder: 0 },
    { id: 'k2', name: 'RX Women', gender: 'FEMALE', active: true, sortOrder: 1 },
  ],
  workouts: [
    { id: 'w1', number: 1, name: 'WOD 1', scoreType: 'REPS', variants: [] },
    { id: 'w2', number: 2, name: 'WOD 2', scoreType: 'TIME', variants: [] },
  ],
  prizes: [],
  participants: 2,
  myRoles: ['ORGANIZER'],
  myRegistration: null,
  publicationRequestedAt: null,
  publicationNote: null,
};

const reg = (id: string, categoryId: string, category: string, fullName: string, username: string, registrationStatus: string, paymentStatus: string, finalPrice: number, registeredAt: string) => ({
  id,
  categoryId,
  userId: `u-${id}`,
  registrationStatus,
  paymentStatus,
  finalPrice,
  currency: 'TND',
  registeredAt,
  category: { name: category },
  user: { username, profile: { fullName } },
});

export const regs = [
  reg('r1', 'k1', 'RX Men', 'Sami Ben Ali', 'sami_rx', 'PENDING', 'PENDING', 40000, '2026-10-21T09:00:00.000Z'),
  reg('r2', 'k2', 'RX Women', 'Amira Trabelsi', 'amira', 'CONFIRMED', 'PAID', 35000, '2026-10-20T09:00:00.000Z'),
  reg('r3', 'k1', 'RX Men', 'Hédi Kéfi', 'hedi', 'CONFIRMED', 'FREE', 0, '2026-10-21T15:00:00.000Z'),
  reg('r4', 'k2', 'RX Women', 'Yasmine Jaziri', 'yasmine', 'PENDING', 'PENDING', 35000, '2026-10-19T09:00:00.000Z'),
  reg('r5', 'k1', 'RX Men', 'Omar Zid', 'omar', 'CANCELLED', 'PENDING', 40000, '2026-10-22T09:00:00.000Z'),
];

export const me = { id: 'u-me', username: 'ahmed_rx' };

/** The event, its dashboard figures, its registrations and the signed-in organizer; each test adds the routes it exercises. */
export const orgBackend = (c: object = event) =>
  new FakeBackend()
    .on('GET', '/competitions/c9', [200, c])
    .on('GET', '/competitions/c9/dashboard', [200, { participants: 5, paidRegistrations: 1, freeRegistrations: 1, pendingPayments: 2, revenue: 35000, pendingSubmissions: 0, pendingJudging: 0, approvedSubmissions: 0, rejectedSubmissions: 0 }])
    .on('GET', '/competitions/c9/registrations', [200, regs])
    .on('GET', '/me', [200, me]);
```

- [ ] **Step 2: Write the failing unit tests**

`apps/mobile-rn/test/core/organizer-logic-b.test.ts`:
```ts
import { ApiError } from '../../src/core/api/errors';
import {
  announcementValid,
  autoBody,
  autoValid,
  batchCodes,
  couponBody,
  couponDraft,
  couponValid,
  createCoupons,
  delayMinutes,
  delayTargets,
  distribution,
  filterHeats,
  filterRegistrations,
  freeLanes,
  heatBody,
  heatDays,
  heatDraft,
  heatValid,
  laneCandidates,
  normalizeCode,
  personName,
  registrationsCsv,
  runDelay,
  shiftedStart,
  staffByRole,
  timetable,
  toCollect,
  topUsed,
} from '../../src/features/competitions/organizer/logic-b';
import { regs } from '../organizer-fixtures';

const at = (s: string) => Date.parse(s);
const heat = (id: string, startsAt: string | null, durationMin: number | null, extra: object = {}) => ({
  id,
  name: `Heat ${id.toUpperCase()}`,
  startsAt,
  durationMin,
  laneCount: 4,
  lanes: [],
  workout: { id: 'w1', name: 'WOD 1', number: 1 },
  category: { id: 'k1', name: 'RX Men' },
  ...extra,
});

describe('participants', () => {
  it('finds a name without accents or case, and filters by category and payment', () => {
    const none = { q: '', categoryId: null, payment: 'ALL' as const };
    expect(filterRegistrations(regs, { ...none, q: 'kefi' }).map((r) => r.id)).toEqual(['r3']);
    expect(filterRegistrations(regs, { ...none, q: 'SAMI_RX' }).map((r) => r.id)).toEqual(['r1']);
    expect(filterRegistrations(regs, { ...none, categoryId: 'k2' }).map((r) => r.id)).toEqual(['r2', 'r4']);
    expect(filterRegistrations(regs, { ...none, payment: 'PAID' }).map((r) => r.id)).toEqual(['r2']);
  });

  it('finds one athlete among 300', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ ...regs[0], id: `m${i}`, user: { username: `athlete${i}`, profile: { fullName: `Athlète ${i}` } } }));
    expect(filterRegistrations(many, { q: 'athlete 287', categoryId: null, payment: 'ALL' }).map((r) => r.id)).toEqual(['m287']);
  });

  it('« to collect »: payment pending, registration not cancelled, oldest first', () => {
    expect(toCollect(regs).map((r) => r.id)).toEqual(['r4', 'r1']);
  });

  it('exports one CSV line per registration, quoting what needs it', () => {
    const lines = registrationsCsv([regs[0], { ...regs[1], user: { username: 'amira', profile: { fullName: 'Trabelsi, "Amira"' } } }]).split('\n');
    expect(lines[0]).toBe('name,username,category,registration,payment,amount,currency,registered_at');
    expect(lines[1]).toBe('Sami Ben Ali,sami_rx,RX Men,PENDING,PENDING,40.000,TND,2026-10-21T09:00:00.000Z');
    expect(lines[2]).toBe('"Trabelsi, ""Amira""",amira,RX Women,CONFIRMED,PAID,35.000,TND,2026-10-20T09:00:00.000Z');
  });

  it('names a person from a registration, a staff row or a lane', () => {
    expect(personName(regs[0])).toBe('Sami Ben Ali');
    expect(personName({ user: { username: 'solo', profile: null } })).toBe('solo');
    expect(personName({ athlete: { fullName: null, username: 'lane_guy' } })).toBe('lane_guy');
  });
});

describe('planning', () => {
  const day = [heat('a', '2026-12-12T08:00:00.000Z', 12), heat('b', '2026-12-12T09:00:00.000Z', 12), heat('c', '2026-12-12T10:00:00.000Z', 12), heat('d', null, 12)];

  it('free lanes, and who can still go in a heat', () => {
    const h = heat('h', null, null, { lanes: [{ lane: 1, registrationId: 'r3' }, { lane: 3, registrationId: 'x' }] });
    expect(freeLanes(h)).toEqual([2, 4]);
    // r1 and r4 are not confirmed, r2 is in RX Women, r3 is already in the heat, r5 is cancelled.
    expect(laneCandidates(h, regs)).toEqual([]);
    const karim = { ...regs[0], id: 'r6', registrationStatus: 'CONFIRMED' };
    expect(laneCandidates(h, [...regs, karim]).map((r) => r.id)).toEqual(['r6']);
    expect(laneCandidates({ ...h, category: null }, [...regs, karim]).map((r) => r.id)).toEqual(['r2', 'r6']);
  });

  it('filters by day, category, WOD and athlete', () => {
    const list = [
      heat('a', '2026-12-12T10:00:00.000Z', 12, { lanes: [{ lane: 1, registrationId: 'r3', athlete: { fullName: 'Hédi Kéfi', username: 'hedi' } }] }),
      heat('b', '2026-12-13T10:00:00.000Z', 12, { category: { id: 'k2', name: 'RX Women' } }),
      heat('c', null, null),
    ];
    const none = { day: null, categoryId: null, workoutId: null, q: '' };
    expect(heatDays(list)).toEqual(['2026-12-12', '2026-12-13']);
    expect(filterHeats(list, { ...none, day: '2026-12-13' }).map((h) => h.id)).toEqual(['b']);
    expect(filterHeats(list, { ...none, categoryId: 'k2' }).map((h) => h.id)).toEqual(['b']);
    expect(filterHeats(list, { ...none, workoutId: 'w2' })).toEqual([]);
    expect(filterHeats(list, { ...none, q: 'hedi' }).map((h) => h.id)).toEqual(['a']);
  });

  it('the clock: heat running, next heat, heats done (heats without a start are not counted)', () => {
    expect(timetable(day, at('2026-12-12T09:05:00Z'))).toMatchObject({ current: { id: 'b' }, next: { id: 'c' }, done: 1, total: 3 });
    expect(timetable(day, at('2026-12-12T09:30:00Z'))).toMatchObject({ current: null, next: { id: 'c' }, done: 2, total: 3 });
    expect(timetable(day, at('2026-12-12T12:00:00Z'))).toMatchObject({ current: null, next: null, done: 3, total: 3 });
  });

  it('« Retard » targets only the heats that have not started, in running order', () => {
    expect(delayTargets([day[2], day[0], day[3], day[1]], at('2026-12-12T08:30:00Z')).map((h) => h.id)).toEqual(['b', 'c']);
    expect(shiftedStart(day[2], 15)).toBe('2026-12-12T10:15:00.000Z');
    expect(delayMinutes('15')).toBe(15);
    for (const bad of ['0', '601', '2.5', '', 'x', '-5']) expect(delayMinutes(bad)).toBeNull();
  });

  it('runs the delay heat by heat and returns the heats that failed', async () => {
    const later = [heat('c', '2026-12-12T10:00:00.000Z', 12), heat('e', '2026-12-12T11:00:00.000Z', 12), heat('f', '2026-12-12T12:00:00.000Z', 12)];
    const sent: [string, string][] = [];
    const failed = await runDelay(later, 10, async (id, startsAt) => {
      sent.push([id, startsAt]);
      if (id === 'e') throw new Error('offline');
    });
    expect(sent).toEqual([
      ['c', '2026-12-12T10:10:00.000Z'],
      ['e', '2026-12-12T11:10:00.000Z'],
      ['f', '2026-12-12T12:10:00.000Z'],
    ]);
    expect(failed.map((h) => h.id)).toEqual(['e']);
  });

  it('heat form: server limits, and only what is filled is sent', () => {
    const d = heatDraft(null);
    expect(heatValid(d)).toBe(true);
    for (const bad of [{ lanes: '0' }, { lanes: '41' }, { lanes: '' }, { duration: '601' }, { name: 'x'.repeat(81) }]) expect(heatValid({ ...d, ...bad })).toBe(false);
    expect(heatBody({ ...d, name: ' Final ', workoutId: 'w1', start: new Date('2026-12-13T15:00:00Z'), duration: '20', lanes: '6' })).toEqual({ name: 'Final', workoutId: 'w1', startsAt: '2026-12-13T15:00:00.000Z', durationMin: 20, laneCount: 6 });
    expect(heatDraft(heat('h', '2026-12-12T08:00:00.000Z', null))).toMatchObject({ id: 'h', name: 'Heat H', workoutId: 'w1', categoryId: 'k1', duration: '', lanes: '4' });
  });

  it('automatic heats need a category and 1 to 40 lanes', () => {
    const d = { categoryId: 'k1', workoutId: null, lanes: '8', start: null, interval: '15' };
    expect(autoValid(d)).toBe(true);
    expect(autoValid({ ...d, categoryId: null })).toBe(false);
    expect(autoValid({ ...d, lanes: '' })).toBe(false);
    expect(autoValid({ ...d, interval: '0' })).toBe(false);
    expect(autoBody(d)).toEqual({ categoryId: 'k1', laneCount: 8, intervalMin: 15 });
    expect(autoBody({ ...d, workoutId: 'w2', start: new Date('2026-12-12T08:00:00Z'), interval: '' })).toEqual({ categoryId: 'k1', workoutId: 'w2', laneCount: 8, startsAt: '2026-12-12T08:00:00.000Z' });
  });
});

describe('team', () => {
  it('groups the staff by role, names in alphabetical order', () => {
    const rows = [
      { id: 's1', role: 'JUDGE', user: { username: 'zed' } },
      { id: 's2', role: 'ORGANIZER', user: { username: 'b', profile: { fullName: 'Bilel' } } },
      { id: 's3', role: 'ORGANIZER', user: { username: 'a', profile: { fullName: 'Amel' } } },
    ];
    const g = staffByRole(rows);
    expect(g.ORGANIZER.map((s) => s.id)).toEqual(['s3', 's2']);
    expect(g.HEAD_JUDGE).toEqual([]);
    expect(g.JUDGE.map((s) => s.id)).toEqual(['s1']);
  });
});

describe('promo codes', () => {
  it('batch codes and the form rules', () => {
    expect(normalizeCode(' summer 20 ')).toBe('SUMMER-20');
    expect(batchCodes('VIP', 1)).toEqual(['VIP']);
    expect(batchCodes('VIP', 3)).toEqual(['VIP-1', 'VIP-2', 'VIP-3']);
    const d = { ...couponDraft(), code: 'summer20' };
    expect(couponValid(d)).toBe(true);
    for (const bad of [{ code: 'ab' }, { value: '0' }, { value: '101' }, { value: '' }, { quantity: '51' }, { quantity: '0' }, { maxUses: '0' }]) expect(couponValid({ ...d, ...bad })).toBe(false);
    expect(couponValid({ ...d, type: 'FIXED_AMOUNT', value: '12,5' })).toBe(true);
    expect(couponValid({ ...d, type: 'FIXED_AMOUNT', value: '0' })).toBe(false);
    expect(couponValid({ ...d, type: 'FREE', value: '' })).toBe(true);
    // Every code of the batch must fit the 32 characters: AAA…A-10 does not.
    expect(couponValid({ ...d, code: 'A'.repeat(30), quantity: '12' })).toBe(false);
  });

  it('sends what the server expects for each type', () => {
    const d = { ...couponDraft(), categoryId: 'k1', maxUses: '20', expires: new Date('2026-12-01T22:00:00Z') };
    expect(couponBody({ ...d, type: 'PERCENTAGE', value: '20' }, 'SUMMER')).toEqual({ code: 'SUMMER', type: 'PERCENTAGE', value: 20, categoryId: 'k1', maxUses: 20, expiresAt: '2026-12-01T22:00:00.000Z' });
    expect(couponBody({ ...couponDraft(), type: 'FIXED_AMOUNT', value: '12,5' }, 'TEN')).toEqual({ code: 'TEN', type: 'FIXED_AMOUNT', value: 12500 });
    expect(couponBody({ ...couponDraft(), type: 'FREE', value: '50' }, 'GIFT')).toEqual({ code: 'GIFT', type: 'FREE' });
  });

  it('creates a batch one code at a time: a taken code is skipped, another error stops it', async () => {
    const taken = new ApiError('client', 422, 'VALIDATION_FAILED', [{ field: 'code', code: 'TAKEN' }]);
    const seen: string[] = [];
    const ok = await createCoupons(['A-1', 'A-2', 'A-3'], async (code) => {
      seen.push(code);
      if (code === 'A-2') throw taken;
    });
    expect(ok).toEqual({ created: ['A-1', 'A-3'], taken: ['A-2'], error: null });
    expect(seen).toEqual(['A-1', 'A-2', 'A-3']);
    const down = new ApiError('server', 500, 'INTERNAL');
    const stopped = await createCoupons(['B-1', 'B-2', 'B-3'], async (code) => {
      if (code === 'B-2') throw down;
    });
    expect(stopped).toEqual({ created: ['B-1'], taken: [], error: down });
  });

  it('top 5 of the codes in use', () => {
    const list = [3, 0, 9, 1, 4, 7, 2].map((n, i) => ({ id: `p${i}`, code: `C${i}`, usedCount: n }));
    expect(topUsed(list).map((c) => c.usedCount)).toEqual([9, 7, 4, 3, 2]);
    expect(topUsed([{ id: 'p', code: 'P', usedCount: 0 }])).toEqual([]);
  });
});

describe('announcements', () => {
  it('title 3 to 120 characters, message 1 to 5000, spaces not counted', () => {
    expect(announcementValid('Heat 3 moved', 'Now at 15:30.')).toBe(true);
    expect(announcementValid('  ab ', 'x')).toBe(false);
    expect(announcementValid('Title', '   ')).toBe(false);
    expect(announcementValid('x'.repeat(121), 'x')).toBe(false);
  });
});

describe('dashboard breakdown', () => {
  it('per category, women / men from the category, per day; cancelled registrations left out', () => {
    const cats = [
      { id: 'k1', name: 'RX Men', gender: 'MALE' },
      { id: 'k2', name: 'RX Women', gender: 'FEMALE' },
      { id: 'k3', name: 'Teams', gender: 'MIXED' },
    ];
    const d = distribution(regs, cats);
    expect(d.byCategory).toEqual([
      { id: 'k1', name: 'RX Men', count: 2 },
      { id: 'k2', name: 'RX Women', count: 2 },
    ]);
    expect([d.women, d.men, d.mixed]).toEqual([2, 2, 0]);
    expect(d.perDay).toEqual([
      { day: '2026-10-19', count: 1 },
      { day: '2026-10-20', count: 1 },
      { day: '2026-10-21', count: 2 },
    ]);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/core/organizer-logic-b.test.ts`
Expected: FAIL — `Cannot find module '../../src/features/competitions/organizer/logic-b'`.

- [ ] **Step 4: Write the lot B rules**

`apps/mobile-rn/src/features/competitions/organizer/logic-b.ts`:
```ts
import type { Json } from '../../../core/api/client';
import { ApiError } from '../../../core/api/errors';
import { toMillimes } from './logic';

/** Organizer space, lot B (spec 2026-10-14 §1.3 items 5–10): the rules the lot B screens share. */

/** Lowercase without accents, so « kefi » finds « Kéfi ». */
export const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Name of a registration or a staff row (`user`) or of a lane (`athlete`): full name, else username. */
export function personName(x: Json): string {
  const p = x.user ?? x.athlete ?? {};
  return p.profile?.fullName || p.fullName || p.username || '—';
}

/** `YYYY-MM-DD` of an instant, in the phone's time zone. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const isInt = (s: string, min: number, max: number) => /^\d+$/.test(s.trim()) && Number(s) >= min && Number(s) <= max;
const optInt = (s: string, min: number, max: number) => !s.trim() || isInt(s, min, max);
const startOf = (h: Json) => (h.startsAt ? Date.parse(h.startsAt) : NaN);
const endOf = (h: Json) => startOf(h) + (h.durationMin ?? 0) * 60_000;

// ───────────── Participants ─────────────

export type PaymentFilter = 'ALL' | 'PENDING' | 'PAID' | 'FREE';

export function filterRegistrations(rows: Json[], f: { q: string; categoryId: string | null; payment: PaymentFilter }): Json[] {
  const q = fold(f.q.trim());
  return rows.filter(
    (r) =>
      (!q || fold(`${personName(r)} ${r.user?.username ?? ''}`).includes(q)) &&
      (!f.categoryId || r.categoryId === f.categoryId) &&
      (f.payment === 'ALL' || r.paymentStatus === f.payment),
  );
}

/** « À encaisser »: payment pending, registration neither cancelled nor refunded, oldest first. */
export function toCollect(rows: Json[]): Json[] {
  return rows
    .filter((r) => r.paymentStatus === 'PENDING' && r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED')
    .sort((a, b) => Date.parse(a.registeredAt) - Date.parse(b.registeredAt));
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Spreadsheet export: one line per registration; amounts in currency units (3 decimals for TND, 2 otherwise), dates in ISO. */
export function registrationsCsv(rows: Json[]): string {
  const head = 'name,username,category,registration,payment,amount,currency,registered_at';
  const lines = rows.map((r) => {
    const digits = r.currency === 'TND' ? 3 : 2;
    return [personName(r), r.user?.username ?? '', r.category?.name ?? '', r.registrationStatus, r.paymentStatus, (Number(r.finalPrice ?? 0) / 10 ** digits).toFixed(digits), r.currency, r.registeredAt].map(csvCell).join(',');
  });
  return [head, ...lines].join('\n');
}

// ───────────── Planning ─────────────

/** The free lane numbers of a heat: 1 … laneCount minus the taken ones. */
export function freeLanes(heat: Json): number[] {
  const taken = new Set((heat.lanes ?? []).map((l: Json) => l.lane));
  return Array.from({ length: heat.laneCount ?? 0 }, (_, i) => i + 1).filter((n) => !taken.has(n));
}

/** Who can still go in this heat (the server's rules): confirmed, of the heat's category when it has one, not already in it. */
export function laneCandidates(heat: Json, registrations: Json[]): Json[] {
  const inHeat = new Set((heat.lanes ?? []).map((l: Json) => l.registrationId));
  return registrations.filter((r) => r.registrationStatus === 'CONFIRMED' && (!heat.category?.id || r.categoryId === heat.category.id) && !inHeat.has(r.id));
}

export type HeatFilter = { day: string | null; categoryId: string | null; workoutId: string | null; q: string };

export const heatDays = (heats: Json[]) => [...new Set(heats.filter((h) => h.startsAt).map((h) => localDay(h.startsAt)))].sort();

export function filterHeats(heats: Json[], f: HeatFilter): Json[] {
  const q = fold(f.q.trim());
  return heats.filter(
    (h) =>
      (!f.day || (h.startsAt && localDay(h.startsAt) === f.day)) &&
      (!f.categoryId || h.category?.id === f.categoryId) &&
      (!f.workoutId || h.workout?.id === f.workoutId) &&
      (!q || (h.lanes ?? []).some((l: Json) => fold(`${personName(l)} ${l.athlete?.username ?? ''}`).includes(q))),
  );
}

export type Timetable = { current: Json | null; next: Json | null; done: number; total: number };

/** The clock of the event day: the heat running now, the next one to start, how many have ended. Heats without a start time are not counted; a heat without a duration ends when it starts. */
export function timetable(heats: Json[], now: number): Timetable {
  const timed = heats.filter((h) => !Number.isNaN(startOf(h))).sort((a, b) => startOf(a) - startOf(b));
  return {
    current: timed.find((h) => startOf(h) <= now && now < endOf(h)) ?? null,
    next: timed.find((h) => startOf(h) > now) ?? null,
    done: timed.filter((h) => endOf(h) <= now).length,
    total: timed.length,
  };
}

/** « Retard »: the heats that start after now, in running order (started heats and heats without a time stay where they are). */
export function delayTargets(heats: Json[], now: number): Json[] {
  return heats.filter((h) => startOf(h) > now).sort((a, b) => startOf(a) - startOf(b));
}

export const shiftedStart = (h: Json, minutes: number) => new Date(startOf(h) + minutes * 60_000).toISOString();

/** Minutes of a delay: a whole number from 1 to 600 (the server's longest heat), else null. */
export const delayMinutes = (s: string): number | null => (isInt(s, 1, 600) ? Number(s) : null);

/** Moves each heat in order, one `PUT` each, and goes on after a failure; returns the heats that did not move. */
export async function runDelay(targets: Json[], minutes: number, put: (heatId: string, startsAt: string) => Promise<unknown>): Promise<Json[]> {
  const failed: Json[] = [];
  for (const h of targets) {
    try {
      await put(h.id, shiftedStart(h, minutes));
    } catch {
      failed.push(h);
    }
  }
  return failed;
}

export type HeatDraft = { id?: string; name: string; workoutId: string | null; categoryId: string | null; start: Date | null; duration: string; lanes: string };

export function heatDraft(h: Json | null): HeatDraft {
  if (!h) return { name: '', workoutId: null, categoryId: null, start: null, duration: '15', lanes: '8' };
  return {
    id: h.id,
    name: h.name ?? '',
    workoutId: h.workout?.id ?? null,
    categoryId: h.category?.id ?? null,
    start: h.startsAt ? new Date(h.startsAt) : null,
    duration: h.durationMin == null ? '' : String(h.durationMin),
    lanes: String(h.laneCount ?? ''),
  };
}

/** The server's heat rules: name up to 80, duration 1 to 600 minutes, 1 to 40 lanes. */
export const heatValid = (d: HeatDraft) => d.name.trim().length <= 80 && optInt(d.duration, 1, 600) && isInt(d.lanes, 1, 40);

/** Only what is filled is sent: the server keeps the fields a `PUT` leaves out. */
export function heatBody(d: HeatDraft): Json {
  return {
    ...(d.name.trim() ? { name: d.name.trim() } : {}),
    ...(d.workoutId ? { workoutId: d.workoutId } : {}),
    ...(d.categoryId ? { categoryId: d.categoryId } : {}),
    ...(d.start ? { startsAt: d.start.toISOString() } : {}),
    ...(d.duration.trim() ? { durationMin: Number(d.duration) } : {}),
    laneCount: Number(d.lanes),
  };
}

export type AutoDraft = { categoryId: string | null; workoutId: string | null; lanes: string; start: Date | null; interval: string };

export const autoValid = (d: AutoDraft) => !!d.categoryId && isInt(d.lanes, 1, 40) && optInt(d.interval, 1, 600);

export function autoBody(d: AutoDraft): Json {
  return {
    categoryId: d.categoryId,
    ...(d.workoutId ? { workoutId: d.workoutId } : {}),
    laneCount: Number(d.lanes),
    ...(d.start ? { startsAt: d.start.toISOString() } : {}),
    ...(d.interval.trim() ? { intervalMin: Number(d.interval) } : {}),
  };
}

// ───────────── Team ─────────────

export const STAFF_ORDER = ['ORGANIZER', 'HEAD_JUDGE', 'JUDGE'] as const;
export type StaffRole = (typeof STAFF_ORDER)[number];

export function staffByRole(rows: Json[]): Record<StaffRole, Json[]> {
  const out: Record<StaffRole, Json[]> = { ORGANIZER: [], HEAD_JUDGE: [], JUDGE: [] };
  for (const s of rows) out[s.role as StaffRole]?.push(s);
  for (const k of STAFF_ORDER) out[k].sort((a, b) => personName(a).localeCompare(personName(b)));
  return out;
}

// ───────────── Promo codes ─────────────

export type CouponKind = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE';
export type CouponDraft = { code: string; type: CouponKind; value: string; categoryId: string | null; maxUses: string; expires: Date | null; quantity: string };

export const couponDraft = (): CouponDraft => ({ code: '', type: 'PERCENTAGE', value: '10', categoryId: null, maxUses: '', expires: null, quantity: '1' });

/** Codes are upper case, spaces become dashes. */
export const normalizeCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '-');

export const MAX_BATCH = 50;

/** `CODE` alone, or `CODE-1` … `CODE-N` for a batch. */
export const batchCodes = (code: string, quantity: number) => (quantity <= 1 ? [code] : Array.from({ length: quantity }, (_, i) => `${code}-${i + 1}`));

/** The server's rules (every code of the batch included): A–Z 0–9 _ - from 3 to 32, 1 to 100 %, an amount above 0, max uses ≥ 1; a batch of 1 to 50. */
export function couponValid(d: CouponDraft): boolean {
  if (!optInt(d.quantity, 1, MAX_BATCH)) return false;
  const quantity = d.quantity.trim() ? Number(d.quantity) : 1;
  if (!batchCodes(normalizeCode(d.code), quantity).every((c) => /^[A-Z0-9_-]{3,32}$/.test(c))) return false;
  if (d.type === 'PERCENTAGE' && !isInt(d.value, 1, 100)) return false;
  if (d.type === 'FIXED_AMOUNT' && !((toMillimes(d.value) ?? 0) > 0)) return false;
  return optInt(d.maxUses, 1, Number.MAX_SAFE_INTEGER);
}

export function couponBody(d: CouponDraft, code: string): Json {
  return {
    code,
    type: d.type,
    ...(d.type === 'PERCENTAGE' ? { value: Number(d.value) } : d.type === 'FIXED_AMOUNT' ? { value: toMillimes(d.value) } : {}),
    ...(d.categoryId ? { categoryId: d.categoryId } : {}),
    ...(d.maxUses.trim() ? { maxUses: Number(d.maxUses) } : {}),
    ...(d.expires ? { expiresAt: d.expires.toISOString() } : {}),
  };
}

export type BatchResult = { created: string[]; taken: string[]; error: unknown };

/** Creates the codes one at a time: a code already taken is skipped and reported; any other error stops the batch. */
export async function createCoupons(codes: string[], post: (code: string) => Promise<unknown>): Promise<BatchResult> {
  const r: BatchResult = { created: [], taken: [], error: null };
  for (const code of codes) {
    try {
      await post(code);
      r.created.push(code);
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.some((f) => f.field === 'code' && f.code === 'TAKEN')) {
        r.taken.push(code);
      } else {
        r.error = e;
        break;
      }
    }
  }
  return r;
}

export const topUsed = (coupons: Json[], n = 5) => coupons.filter((c) => (c.usedCount ?? 0) > 0).sort((a, b) => b.usedCount - a.usedCount).slice(0, n);

// ───────────── Announcements ─────────────

export function announcementValid(title: string, body: string): boolean {
  const t = title.trim().length;
  const b = body.trim().length;
  return t >= 3 && t <= 120 && b >= 1 && b <= 5000;
}

// ───────────── Dashboard ─────────────

export type Distribution = { byCategory: { id: string; name: string; count: number }[]; women: number; men: number; mixed: number; perDay: { day: string; count: number }[] };

/** Registrations still standing, per category (in the event's order), women / men / mixed from the category, and per day of registration. */
export function distribution(rows: Json[], categories: Json[]): Distribution {
  const live = rows.filter((r) => r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED');
  const perCategory = new Map<string, number>();
  const perDay = new Map<string, number>();
  for (const r of live) {
    perCategory.set(r.categoryId, (perCategory.get(r.categoryId) ?? 0) + 1);
    const day = localDay(r.registeredAt);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const gender = new Map(categories.map((k) => [k.id, k.gender]));
  const count = (g: string) => live.filter((r) => gender.get(r.categoryId) === g).length;
  return {
    byCategory: categories.filter((k) => perCategory.has(k.id)).map((k) => ({ id: k.id, name: k.name, count: perCategory.get(k.id)! })),
    women: count('FEMALE'),
    men: count('MALE'),
    mixed: count('MIXED'),
    perDay: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => ({ day, count: n })),
  };
}
```

- [ ] **Step 5: Add the lot B routes and hooks to the client**

In `apps/mobile-rn/src/features/competitions/organizer/api.ts`, inside `organizerApi`, after the `reorderWods` line, add:
```ts
  registrations: (id: string) => api.get<Json[]>(`/competitions/${id}/registrations`),
  markPaid: (id: string, registrationId: string) => api.post<Json>(`/competitions/${id}/registrations/${registrationId}/mark-paid`),
  addHeat: (id: string, body: Json) => api.post<Json>(`/competitions/${id}/heats`, body),
  autoHeats: (id: string, body: Json) => api.post<Json>(`/competitions/${id}/heats/auto`, body),
  updateHeat: (id: string, heatId: string, body: Json) => api.put<Json>(`/competitions/${id}/heats/${heatId}`, body),
  removeHeat: (id: string, heatId: string) => api.delete<void>(`/competitions/${id}/heats/${heatId}`),
  assignLane: (id: string, heatId: string, registrationId: string, lane: number) => api.post<Json>(`/competitions/${id}/heats/${heatId}/lanes`, { registrationId, lane }),
  freeLane: (id: string, heatId: string, lane: number) => api.delete<void>(`/competitions/${id}/heats/${heatId}/lanes/${lane}`),
  staff: (id: string) => api.get<Json[]>(`/competitions/${id}/staff`),
  addOrganizer: (id: string, userId: string) => api.post<Json>(`/competitions/${id}/staff`, { userId, role: 'ORGANIZER' }),
  removeStaff: (id: string, staffId: string) => api.delete<void>(`/competitions/${id}/staff/${staffId}`),
  coupons: (id: string) => api.get<Json[]>(`/competitions/${id}/coupons`),
  addCoupon: (id: string, body: Json) => api.post<Json>(`/competitions/${id}/coupons`, body),
  setCouponActive: (id: string, couponId: string, active: boolean) => api.post<Json>(`/competitions/${id}/coupons/${couponId}/${active ? 'activate' : 'deactivate'}`),
  announcements: (id: string) => api.get<Json[]>(`/competitions/${id}/announcements`),
  announce: (id: string, body: { title: string; body: string }) => api.post<Json>(`/competitions/${id}/announcements`, body),
```
and at the end of the file:
```ts
/** Lot B lists: their keys sit under ['competitions', id], so useRefreshCompetition() reloads them after a change. */
export const orgKeys = {
  registrations: (id: string) => ['competitions', id, 'org-registrations'] as const,
  staff: (id: string) => ['competitions', id, 'org-staff'] as const,
  coupons: (id: string) => ['competitions', id, 'org-coupons'] as const,
  announcements: (id: string) => ['competitions', id, 'announcements'] as const,
};

export function useRegistrations(id: string) {
  const api = useApi();
  return useQuery({ queryKey: orgKeys.registrations(id), queryFn: () => organizerApi(api).registrations(id) });
}

export function useStaff(id: string) {
  const api = useApi();
  return useQuery({ queryKey: orgKeys.staff(id), queryFn: () => organizerApi(api).staff(id) });
}

export function useCoupons(id: string) {
  const api = useApi();
  return useQuery({ queryKey: orgKeys.coupons(id), queryFn: () => organizerApi(api).coupons(id) });
}

export function useAnnouncements(id: string) {
  const api = useApi();
  return useQuery({ queryKey: orgKeys.announcements(id), queryFn: () => organizerApi(api).announcements(id) });
}
```

- [ ] **Step 6: Add every lot B text**

Save this file as `<scratchpad>/org-b-i18n.json` (scratchpad = the session's scratchpad directory):
```json
{
  "en": {
    "orgTabPlanning": "Planning", "orgTabParticipants": "Participants", "orgTabTeam": "Team", "orgTabLeaderboard": "Leaderboard", "orgTabAnnouncements": "Announcements", "orgTabCoupons": "Promo codes",
    "orgAllCategories": "All categories", "orgAllWods": "All WODs", "orgAllDays": "All days", "orgNone": "None", "orgBack": "Back", "orgClose": "Close", "orgShareReceipt": "Share",
    "orgHeatNew": "New heat", "orgHeatAuto": "Generate heats", "orgHeatSearch": "Find an athlete", "orgHeatNone": "No heat yet. Create one, or generate them from a category.", "orgHeatNoMatch": "No heat matches these filters.", "orgHeatNoTime": "No start time", "orgHeatLanes": "{used}/{count} lanes", "orgHeatEdit": "Edit the heat", "orgHeatName": "Name", "orgHeatNameHint": "Heat 1 when empty", "orgHeatWod": "WOD", "orgHeatCategory": "Category", "orgHeatStart": "Start", "orgHeatDuration": "Duration (min)", "orgHeatLaneCount": "Lanes", "orgHeatDelete": "Delete the heat", "orgHeatDeleteConfirm": "Delete {name} and its lanes?",
    "orgAutoIntro": "The category's confirmed athletes fill new heats in leaderboard order, the leaders in the last heat.", "orgAutoStart": "First heat starts", "orgAutoInterval": "Minutes between two heats", "orgAutoDone": "Heats created: {heats}, athletes placed: {athletes}.",
    "orgLane": "Lane {lane}", "orgLaneEmpty": "Free", "orgLaneFree": "Free the lane", "orgLanePick": "Who goes in lane {lane}?", "orgLaneNobody": "No confirmed athlete left for this heat.", "orgLaneFull": "Every lane is taken.",
    "errorHeatsExist": "This category already has heats for this WOD.", "errorLaneTaken": "This lane is already taken.", "errorAlreadyInHeat": "This athlete is already in this heat.",
    "orgNowRunning": "Now: {name}", "orgNothingRunning": "No heat running.", "orgNextHeat": "Next: {name} at {time}", "orgHeatsDone": "{done} of {total} heats done", "orgDelay": "Delay", "orgDelayAsk": "Move the {count} heats that have not started by how many minutes?", "orgDelayMinutes": "Minutes (1 to 600)", "orgDelayConfirm": "Move", "orgDelayTitle": "Schedule moved by {minutes} min", "orgDelayBody": "Every heat that has not started yet starts {minutes} minutes later.", "orgDelayDone": "{count} heats moved by {minutes} min, announcement posted.", "orgDelayFailed": "Not moved: {names}.",
    "orgRegAll": "All ({count})", "orgRegToCollect": "To collect ({count})", "orgRegSearch": "Search by name", "orgRegAnyPayment": "Any payment", "orgPayPending": "To pay", "orgPayPaid": "Paid", "orgPayFree": "Free", "orgPayFailed": "Failed", "orgPayRefunded": "Refunded", "orgRegExport": "Share as CSV", "orgRegCollectHint": "Registrations waiting for payment, oldest first.", "orgRegNone": "No registration matches.", "orgRegNothingToCollect": "Nothing to collect.", "orgRegCancelled": "Cancelled", "orgMarkPaid": "Mark paid", "orgMarkPaidConfirm": "Did {name} pay {amount}?", "orgAlreadyPaid": "This registration was already settled. The list is up to date.", "orgReceiptTitle": "Receipt", "orgReceipt": "Fitness League receipt\n{title}\n{name} · {category}\n{amount} paid on {date}",
    "orgTeamOrganizers": "Organizers", "orgTeamHeadJudges": "Head judges", "orgTeamJudges": "Judges", "orgTeamNone": "Nobody yet.", "orgTeamYou": "You", "orgTeamRemove": "Remove from the organizers", "orgTeamRemoveConfirm": "{name} will no longer manage this event.", "orgTeamJudgesHint": "Judges and head judges are managed by the Fitness League team in the admin panel.", "orgTeamAdd": "Add a co-organizer", "orgTeamAddHint": "A co-organizer can change everything in this event, like you.", "orgTeamAlready": "Already an organizer",
    "orgBoardProvisional": "Provisional", "orgBoardFinal": "Final", "orgBoardEmpty": "No score in this category yet.", "orgBoardPoints": "{points} pts", "orgBoardPending": "{count} to judge", "orgBoardPublishTitle": "Final leaderboard", "orgBoardPublishHint": "The head judge publishes the final leaderboard from the admin panel, once every appeal is settled.",
    "orgAnnHint": "Shown on the event page. No notification is sent.", "orgAnnTitle": "Title", "orgAnnBody": "Message", "orgAnnPost": "Post", "orgAnnPosted": "Announcement posted", "orgAnnList": "Posted", "orgAnnNone": "No announcement yet.", "compAnnouncements": "Announcements",
    "orgCouponNew": "New code", "orgCouponTop": "Most used", "orgCouponAll": "All codes", "orgCouponNone": "No promo code yet.", "orgCouponFree": "Free", "orgCouponPercent": "Percentage", "orgCouponAmount": "Amount", "orgCouponPercentValue": "Discount (%)", "orgCouponAmountValue": "Discount (TND)", "orgCouponCode": "Code", "orgCouponMaxUses": "Max uses (empty = unlimited)", "orgCouponExpires": "Expires", "orgCouponNoExpiry": "Never", "orgCouponQuantity": "Quantity", "orgCouponBatchHint": "Creates {first} … {last}", "orgCouponCreate": "Create", "orgCouponCreated": "Codes created: {count}", "orgCouponTaken": "Already taken, skipped: {codes}", "orgCouponUses": "{used}/{max} uses", "orgCouponUntil": "until {date}",
    "orgBreakdown": "By category", "orgSplitGender": "Women {women} · Men {men} · Mixed {mixed}", "orgPerDay": "Registrations per day",
    "orgVariants": "Per category", "orgVariantsHint": "A category can get its own description, standards and time cap; the others use the WOD's.", "orgVariantRemove": "Remove this version", "orgRelease": "Release", "orgReleaseAt": "Visible to athletes from", "orgReleaseNow": "As soon as it is saved", "orgReleaseNowButton": "Show it now"
  },
  "fr": {
    "orgTabPlanning": "Planning", "orgTabParticipants": "Participants", "orgTabTeam": "Équipe", "orgTabLeaderboard": "Classement", "orgTabAnnouncements": "Annonces", "orgTabCoupons": "Codes promo",
    "orgAllCategories": "Toutes les catégories", "orgAllWods": "Tous les WODs", "orgAllDays": "Tous les jours", "orgNone": "Aucun", "orgBack": "Retour", "orgClose": "Fermer", "orgShareReceipt": "Partager",
    "orgHeatNew": "Nouveau heat", "orgHeatAuto": "Générer les heats", "orgHeatSearch": "Chercher un athlète", "orgHeatNone": "Aucun heat pour l'instant. Crée-en un, ou génère-les depuis une catégorie.", "orgHeatNoMatch": "Aucun heat ne correspond à ces filtres.", "orgHeatNoTime": "Sans heure de début", "orgHeatLanes": "{used}/{count} couloirs", "orgHeatEdit": "Modifier le heat", "orgHeatName": "Nom", "orgHeatNameHint": "Heat 1 si vide", "orgHeatWod": "WOD", "orgHeatCategory": "Catégorie", "orgHeatStart": "Début", "orgHeatDuration": "Durée (min)", "orgHeatLaneCount": "Couloirs", "orgHeatDelete": "Supprimer le heat", "orgHeatDeleteConfirm": "Supprimer {name} et ses couloirs ?",
    "orgAutoIntro": "Les athlètes confirmés de la catégorie remplissent de nouveaux heats dans l'ordre du classement, les premiers dans le dernier heat.", "orgAutoStart": "Début du premier heat", "orgAutoInterval": "Minutes entre deux heats", "orgAutoDone": "Heats créés : {heats}, athlètes placés : {athletes}.",
    "orgLane": "Couloir {lane}", "orgLaneEmpty": "Libre", "orgLaneFree": "Libérer le couloir", "orgLanePick": "Qui va dans le couloir {lane} ?", "orgLaneNobody": "Plus aucun athlète confirmé pour ce heat.", "orgLaneFull": "Tous les couloirs sont pris.",
    "errorHeatsExist": "Cette catégorie a déjà des heats pour ce WOD.", "errorLaneTaken": "Ce couloir est déjà pris.", "errorAlreadyInHeat": "Cet athlète est déjà dans ce heat.",
    "orgNowRunning": "En cours : {name}", "orgNothingRunning": "Aucun heat en cours.", "orgNextHeat": "Suivant : {name} à {time}", "orgHeatsDone": "{done} heats terminés sur {total}", "orgDelay": "Retard", "orgDelayAsk": "De combien de minutes décaler les {count} heats pas encore commencés ?", "orgDelayMinutes": "Minutes (1 à 600)", "orgDelayConfirm": "Décaler", "orgDelayTitle": "Planning décalé de {minutes} min", "orgDelayBody": "Tous les heats pas encore commencés démarrent {minutes} minutes plus tard.", "orgDelayDone": "{count} heats décalés de {minutes} min, annonce publiée.", "orgDelayFailed": "Non décalés : {names}.",
    "orgRegAll": "Tous ({count})", "orgRegToCollect": "À encaisser ({count})", "orgRegSearch": "Rechercher un nom", "orgRegAnyPayment": "Tous paiements", "orgPayPending": "À payer", "orgPayPaid": "Payé", "orgPayFree": "Gratuit", "orgPayFailed": "Échoué", "orgPayRefunded": "Remboursé", "orgRegExport": "Partager en CSV", "orgRegCollectHint": "Inscriptions en attente de paiement, les plus anciennes d'abord.", "orgRegNone": "Aucune inscription ne correspond.", "orgRegNothingToCollect": "Rien à encaisser.", "orgRegCancelled": "Annulée", "orgMarkPaid": "Marquer payé", "orgMarkPaidConfirm": "{name} a bien payé {amount} ?", "orgAlreadyPaid": "Cette inscription était déjà réglée. La liste est à jour.", "orgReceiptTitle": "Reçu", "orgReceipt": "Reçu Fitness League\n{title}\n{name} · {category}\n{amount} payé le {date}",
    "orgTeamOrganizers": "Organisateurs", "orgTeamHeadJudges": "Juges principaux", "orgTeamJudges": "Juges", "orgTeamNone": "Personne pour l'instant.", "orgTeamYou": "Toi", "orgTeamRemove": "Retirer des organisateurs", "orgTeamRemoveConfirm": "{name} ne pourra plus gérer cet événement.", "orgTeamJudgesHint": "Les juges et juges principaux sont gérés par l'équipe Fitness League dans le panneau d'administration.", "orgTeamAdd": "Ajouter un co-organisateur", "orgTeamAddHint": "Un co-organisateur peut tout modifier dans cet événement, comme toi.", "orgTeamAlready": "Déjà organisateur",
    "orgBoardProvisional": "Provisoire", "orgBoardFinal": "Final", "orgBoardEmpty": "Aucun score dans cette catégorie pour l'instant.", "orgBoardPoints": "{points} pts", "orgBoardPending": "{count} à juger", "orgBoardPublishTitle": "Classement final", "orgBoardPublishHint": "Le juge principal publie le classement final depuis le panneau d'administration, une fois tous les appels traités.",
    "orgAnnHint": "Visible sur la page de l'événement, sans notification.", "orgAnnTitle": "Titre", "orgAnnBody": "Message", "orgAnnPost": "Publier", "orgAnnPosted": "Annonce publiée", "orgAnnList": "Publiées", "orgAnnNone": "Aucune annonce pour l'instant.", "compAnnouncements": "Annonces",
    "orgCouponNew": "Nouveau code", "orgCouponTop": "Les plus utilisés", "orgCouponAll": "Tous les codes", "orgCouponNone": "Aucun code promo pour l'instant.", "orgCouponFree": "Gratuit", "orgCouponPercent": "Pourcentage", "orgCouponAmount": "Montant", "orgCouponPercentValue": "Réduction (%)", "orgCouponAmountValue": "Réduction (TND)", "orgCouponCode": "Code", "orgCouponMaxUses": "Utilisations max (vide = illimité)", "orgCouponExpires": "Expire le", "orgCouponNoExpiry": "Jamais", "orgCouponQuantity": "Quantité", "orgCouponBatchHint": "Crée {first} … {last}", "orgCouponCreate": "Créer", "orgCouponCreated": "Codes créés : {count}", "orgCouponTaken": "Déjà pris, ignorés : {codes}", "orgCouponUses": "{used}/{max} utilisations", "orgCouponUntil": "jusqu'au {date}",
    "orgBreakdown": "Par catégorie", "orgSplitGender": "Femmes {women} · Hommes {men} · Mixtes {mixed}", "orgPerDay": "Inscriptions par jour",
    "orgVariants": "Spécifique par catégorie", "orgVariantsHint": "Une catégorie peut avoir sa propre description, ses standards et son time cap ; les autres gardent ceux du WOD.", "orgVariantRemove": "Retirer cette version", "orgRelease": "Publication du WOD", "orgReleaseAt": "Visible par les athlètes à partir du", "orgReleaseNow": "Dès l'enregistrement", "orgReleaseNowButton": "Le montrer maintenant"
  },
  "ar": {
    "orgTabPlanning": "الجدول", "orgTabParticipants": "المشاركون", "orgTabTeam": "الفريق", "orgTabLeaderboard": "الترتيب", "orgTabAnnouncements": "الإعلانات", "orgTabCoupons": "رموز الخصم",
    "orgAllCategories": "كل الفئات", "orgAllWods": "كل التمارين", "orgAllDays": "كل الأيام", "orgNone": "لا شيء", "orgBack": "رجوع", "orgClose": "إغلاق", "orgShareReceipt": "مشاركة",
    "orgHeatNew": "دفعة جديدة", "orgHeatAuto": "توليد الدفعات", "orgHeatSearch": "ابحث عن رياضي", "orgHeatNone": "لا توجد دفعات بعد. أنشئ واحدة أو ولّدها من فئة.", "orgHeatNoMatch": "لا توجد دفعة تطابق هذه المرشحات.", "orgHeatNoTime": "بدون وقت بداية", "orgHeatLanes": "{used}/{count} ممرات", "orgHeatEdit": "تعديل الدفعة", "orgHeatName": "الاسم", "orgHeatNameHint": "الدفعة 1 إن تُرك فارغاً", "orgHeatWod": "التمرين", "orgHeatCategory": "الفئة", "orgHeatStart": "البداية", "orgHeatDuration": "المدة (دقيقة)", "orgHeatLaneCount": "الممرات", "orgHeatDelete": "حذف الدفعة", "orgHeatDeleteConfirm": "حذف {name} وممراتها؟",
    "orgAutoIntro": "يملأ الرياضيون المؤكَّدون في الفئة دفعات جديدة حسب الترتيب، والمتصدرون في الدفعة الأخيرة.", "orgAutoStart": "بداية الدفعة الأولى", "orgAutoInterval": "الدقائق بين دفعتين", "orgAutoDone": "الدفعات المنشأة: {heats}، الرياضيون الموزَّعون: {athletes}.",
    "orgLane": "الممر {lane}", "orgLaneEmpty": "شاغر", "orgLaneFree": "إخلاء الممر", "orgLanePick": "من يأخذ الممر {lane}؟", "orgLaneNobody": "لم يتبقَّ رياضي مؤكَّد لهذه الدفعة.", "orgLaneFull": "كل الممرات مشغولة.",
    "errorHeatsExist": "لهذه الفئة دفعات لهذا التمرين بالفعل.", "errorLaneTaken": "هذا الممر مشغول.", "errorAlreadyInHeat": "هذا الرياضي موجود في هذه الدفعة.",
    "orgNowRunning": "الآن: {name}", "orgNothingRunning": "لا توجد دفعة جارية.", "orgNextHeat": "التالي: {name} على {time}", "orgHeatsDone": "انتهت {done} من {total} دفعات", "orgDelay": "تأخير", "orgDelayAsk": "بكم دقيقة تُؤخَّر الدفعات الـ{count} التي لم تبدأ؟", "orgDelayMinutes": "الدقائق (1 إلى 600)", "orgDelayConfirm": "تأخير", "orgDelayTitle": "تأخير الجدول {minutes} دقيقة", "orgDelayBody": "كل دفعة لم تبدأ بعد ستبدأ متأخرة {minutes} دقيقة.", "orgDelayDone": "تم تأخير {count} دفعات {minutes} دقيقة ونُشر إعلان.", "orgDelayFailed": "لم تُؤخَّر: {names}.",
    "orgRegAll": "الكل ({count})", "orgRegToCollect": "للتحصيل ({count})", "orgRegSearch": "ابحث بالاسم", "orgRegAnyPayment": "كل حالات الدفع", "orgPayPending": "غير مدفوع", "orgPayPaid": "مدفوع", "orgPayFree": "مجاني", "orgPayFailed": "فشل", "orgPayRefunded": "مسترجع", "orgRegExport": "مشاركة بصيغة CSV", "orgRegCollectHint": "تسجيلات بانتظار الدفع، الأقدم أولاً.", "orgRegNone": "لا يوجد تسجيل مطابق.", "orgRegNothingToCollect": "لا شيء للتحصيل.", "orgRegCancelled": "ملغاة", "orgMarkPaid": "تسجيل الدفع", "orgMarkPaidConfirm": "هل دفع {name} مبلغ {amount}؟", "orgAlreadyPaid": "هذا التسجيل مسدَّد مسبقاً. القائمة محدَّثة.", "orgReceiptTitle": "إيصال", "orgReceipt": "إيصال Fitness League\n{title}\n{name} · {category}\n{amount} مدفوع بتاريخ {date}",
    "orgTeamOrganizers": "المنظِّمون", "orgTeamHeadJudges": "الحكام الرئيسيون", "orgTeamJudges": "الحكام", "orgTeamNone": "لا أحد بعد.", "orgTeamYou": "أنت", "orgTeamRemove": "إزالة من المنظِّمين", "orgTeamRemoveConfirm": "لن يتمكن {name} من إدارة هذا الحدث.", "orgTeamJudgesHint": "يدير فريق Fitness League الحكام والحكام الرئيسيين من لوحة الإدارة.", "orgTeamAdd": "إضافة منظِّم مشارك", "orgTeamAddHint": "يمكن للمنظِّم المشارك تعديل كل شيء في هذا الحدث، مثلك.", "orgTeamAlready": "منظِّم بالفعل",
    "orgBoardProvisional": "مؤقت", "orgBoardFinal": "نهائي", "orgBoardEmpty": "لا توجد نتائج في هذه الفئة بعد.", "orgBoardPoints": "{points} نقطة", "orgBoardPending": "{count} للتحكيم", "orgBoardPublishTitle": "الترتيب النهائي", "orgBoardPublishHint": "ينشر الحكم الرئيسي الترتيب النهائي من لوحة الإدارة بعد البتّ في كل الاعتراضات.",
    "orgAnnHint": "تظهر في صفحة الحدث، بدون إشعار.", "orgAnnTitle": "العنوان", "orgAnnBody": "الرسالة", "orgAnnPost": "نشر", "orgAnnPosted": "تم نشر الإعلان", "orgAnnList": "المنشورة", "orgAnnNone": "لا توجد إعلانات بعد.", "compAnnouncements": "الإعلانات",
    "orgCouponNew": "رمز جديد", "orgCouponTop": "الأكثر استعمالاً", "orgCouponAll": "كل الرموز", "orgCouponNone": "لا توجد رموز خصم بعد.", "orgCouponFree": "مجاني", "orgCouponPercent": "نسبة مئوية", "orgCouponAmount": "مبلغ", "orgCouponPercentValue": "الخصم (%)", "orgCouponAmountValue": "الخصم (د.ت)", "orgCouponCode": "الرمز", "orgCouponMaxUses": "أقصى عدد استعمالات (فارغ = غير محدود)", "orgCouponExpires": "ينتهي في", "orgCouponNoExpiry": "أبداً", "orgCouponQuantity": "الكمية", "orgCouponBatchHint": "ينشئ {first} … {last}", "orgCouponCreate": "إنشاء", "orgCouponCreated": "الرموز المنشأة: {count}", "orgCouponTaken": "مأخوذة مسبقاً وتم تجاوزها: {codes}", "orgCouponUses": "{used}/{max} استعمالات", "orgCouponUntil": "حتى {date}",
    "orgBreakdown": "حسب الفئة", "orgSplitGender": "نساء {women} · رجال {men} · مختلط {mixed}", "orgPerDay": "التسجيلات يومياً",
    "orgVariants": "حسب الفئة", "orgVariantsHint": "يمكن أن يكون لفئة وصف ومعايير ووقت أقصى خاص بها؛ وتستعمل الفئات الأخرى ما في التمرين.", "orgVariantRemove": "إزالة هذه النسخة", "orgRelease": "نشر التمرين", "orgReleaseAt": "يظهر للرياضيين ابتداءً من", "orgReleaseNow": "فور الحفظ", "orgReleaseNowButton": "إظهاره الآن"
  }
}
```
Merge it into the three catalogs (the files are 2-space pretty JSON; new keys go at the end):
```bash
cd /mnt/c/Users/GIGABYTE/fitness-league/apps/mobile-rn && node -e '
const fs = require("fs");
const add = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const lang of ["en", "fr", "ar"]) {
  const p = `src/core/i18n/${lang}.json`;
  const cur = JSON.parse(fs.readFileSync(p, "utf8"));
  const clash = Object.keys(add[lang]).filter((k) => k in cur);
  if (clash.length) throw new Error(`${lang}: keys already exist: ${clash.join(", ")}`);
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...add[lang] }, null, 2) + "\n");
}
console.log("ok");' <scratchpad>/org-b-i18n.json
```
Expected: `ok`, and `git diff --stat src/core/i18n` shows only added lines (if a whole file changes, its layout was different: restore it with `git show HEAD:<path> > <path>` and insert the keys by hand before the closing brace instead).

- [ ] **Step 7: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/core/organizer-logic-b.test.ts test/core/i18n.test.ts test/core/i18n-usage.test.ts && npx tsc --noEmit`
Expected: PASS, no type error.

- [ ] **Step 8: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/api.ts apps/mobile-rn/src/features/competitions/organizer/logic-b.ts apps/mobile-rn/test/organizer-fixtures.ts apps/mobile-rn/test/core/organizer-logic-b.test.ts apps/mobile-rn/src/core/i18n/en.json apps/mobile-rn/src/core/i18n/fr.json apps/mobile-rn/src/core/i18n/ar.json
git diff --cached --stat
git commit -m "feat(mobile): organizer space lot B rules, API client and texts (EN/FR/AR)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: « Planning » — heats, filters, automatic heats, lanes

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/planning.tsx`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/logic.ts` (`ManageTab`), `organizer/manage.tsx` (new tab)
- Modify: `apps/mobile-rn/src/core/widgets/error.tsx` (`CONFLICT` reasons of the heats)
- Test: `apps/mobile-rn/test/screens/organizer-planning.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`organizerApi(api).addHeat / updateHeat / removeHeat / autoHeats / assignLane / freeLane`, `useRegistrations`, `heatDraft`, `heatValid`, `heatBody`, `autoValid`, `autoBody`, `filterHeats`, `heatDays`, `freeLanes`, `laneCandidates`, `personName`, fixtures `orgBackend`, `regs`); `useHeats(id)` from `../api` (key `['competitions', id, 'heats']`); lot A `useRefreshCompetition`.
- Produces: `PlanningTab({ c })`; `ManageTab` gains `'planning'`. Task 3 adds `<TimetableCard c={c} heats={all} />` as the first child of the list view's `<Screen>`.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-planning.test.tsx`:
```tsx
import { fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend, regs } from '../organizer-fixtures';

const lane = (n: number, r: (typeof regs)[number]) => ({ lane: n, registrationId: r.id, athlete: { id: r.userId, fullName: r.user.profile.fullName, username: r.user.username }, mine: false });
const heats = [
  { id: 'h1', number: 1, name: 'RX Men · Heat 1', startsAt: '2026-12-12T10:00:00.000Z', durationMin: 12, laneCount: 4, workout: { id: 'w1', name: 'WOD 1', number: 1 }, category: { id: 'k1', name: 'RX Men' }, lanes: [lane(1, regs[2])] },
  { id: 'h2', number: 2, name: 'RX Women · Heat 1', startsAt: '2026-12-13T10:00:00.000Z', durationMin: 12, laneCount: 4, workout: { id: 'w2', name: 'WOD 2', number: 2 }, category: { id: 'k2', name: 'RX Women' }, lanes: [lane(1, regs[1])] },
];
const planning = () => orgBackend().on('GET', '/competitions/c9/heats', [200, heats]);
const open = () => <ManageScreen id="c9" initialTab="planning" />;

describe('organizer space: planning', () => {
  it('lists the heats with their time, WOD, category and lanes', async () => {
    const screen = await renderScreen(open, planning());
    expect(await screen.findByText('RX Men · Heat 1')).toBeTruthy();
    expect(screen.getByText('RX Women · Heat 1')).toBeTruthy();
    expect(screen.getAllByText(/WOD 1 · RX Men · 1\/4 lanes/)).toHaveLength(1);
  });

  it('says so when there is no heat yet', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/heats', [200, []]));
    expect(await screen.findByText('No heat yet. Create one, or generate them from a category.')).toBeTruthy();
  });

  it('filters by athlete and by day', async () => {
    const screen = await renderScreen(open, planning());
    await fireEvent.changeText(await screen.findByTestId('heat-search'), 'kefi');
    expect(screen.getByText('RX Men · Heat 1')).toBeTruthy();
    expect(screen.queryByText('RX Women · Heat 1')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('heat-search'), '');
    await fireEvent.press(screen.getByTestId('heat-day-2026-12-13'));
    expect(screen.queryByText('RX Men · Heat 1')).toBeNull();
    expect(screen.getByText('RX Women · Heat 1')).toBeTruthy();
  });

  it('creates a heat with what was filled', async () => {
    const backend = planning().on('POST', '/competitions/c9/heats', [201, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('heat-new'));
    await fireEvent.changeText(screen.getByTestId('heat-name'), 'Final');
    await fireEvent.changeText(screen.getByTestId('heat-duration'), '20');
    await fireEvent.changeText(screen.getByTestId('heat-lanes'), '6');
    await fireEvent.press(screen.getByTestId('heat-save'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/heats')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/heats')[0].body).toEqual({ name: 'Final', durationMin: 20, laneCount: 6 });
    expect(await screen.findByTestId('heat-new')).toBeTruthy();
  });

  it('edits a heat, then deletes it after confirmation', async () => {
    const backend = planning().on('PUT', '/competitions/c9/heats/h1', [200, {}]).on('DELETE', '/competitions/c9/heats/h1', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press((await screen.findAllByLabelText('Edit the heat'))[0]);
    await fireEvent.changeText(screen.getByTestId('heat-lanes'), '5');
    await fireEvent.press(screen.getByTestId('heat-save'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/heats/h1')).toHaveLength(1));
    expect(backend.calls('PUT', '/competitions/c9/heats/h1')[0].body).toEqual({ name: 'RX Men · Heat 1', workoutId: 'w1', categoryId: 'k1', startsAt: '2026-12-12T10:00:00.000Z', durationMin: 12, laneCount: 5 });
    await fireEvent.press((await screen.findAllByLabelText('Edit the heat'))[0]);
    await fireEvent.press(screen.getByTestId('heat-delete'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('DELETE', '/competitions/c9/heats/h1')).toHaveLength(1));
  });

  it('generates the heats of a category and says how many', async () => {
    const backend = planning().on('POST', '/competitions/c9/heats/auto', [201, { heats: 2, athletes: 7 }]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('heat-auto'));
    await fireEvent.press(screen.getByTestId('auto-run'));
    expect(await screen.findByText('Heats created: 2, athletes placed: 7.')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c9/heats/auto')[0].body).toEqual({ categoryId: 'k1', laneCount: 8, intervalMin: 15 });
  });

  it('says when the category already has heats for this WOD', async () => {
    const backend = planning().on('POST', '/competitions/c9/heats/auto', [409, { code: 'CONFLICT', status: 409, reason: 'HEATS_EXIST' }]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('heat-auto'));
    await fireEvent.press(screen.getByTestId('auto-run'));
    expect(await screen.findByText('This category already has heats for this WOD.')).toBeTruthy();
  });

  it('fills a free lane with a confirmed athlete of the heat category, and frees a lane', async () => {
    const karim = { ...regs[0], id: 'r6', registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', user: { username: 'karim', profile: { fullName: 'Karim Mansour' } } };
    const backend = planning()
      .on('GET', '/competitions/c9/registrations', [200, [...regs, karim]])
      .on('POST', '/competitions/c9/heats/h1/lanes', [201, {}])
      .on('DELETE', '/competitions/c9/heats/h1/lanes/1', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('heat-h1'));
    expect(screen.getByText('Hédi Kéfi')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lane-2'));
    // Amira is in RX Women, Sami and Yasmine are not confirmed, Omar cancelled, Hédi already in the heat.
    expect(await screen.findByTestId('lane-cand-r6')).toBeTruthy();
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) expect(screen.queryByTestId(`lane-cand-${id}`)).toBeNull();
    await fireEvent.press(screen.getByTestId('lane-cand-r6'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/heats/h1/lanes')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/heats/h1/lanes')[0].body).toEqual({ registrationId: 'r6', lane: 2 });
    await fireEvent.press(screen.getByLabelText('Free the lane'));
    await waitFor(() => expect(backend.calls('DELETE', '/competitions/c9/heats/h1/lanes/1')).toHaveLength(1));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-planning.test.tsx`
Expected: FAIL — TypeScript rejects `initialTab="planning"` (not a `ManageTab`), or no `heat-*` element is found.

- [ ] **Step 3: Write the planning tab**

`apps/mobile-rn/src/features/competitions/organizer/planning.tsx`:
```tsx
import { useRef, useState } from 'react';
import { FlatList, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { EmptyState, Loading, SectionHeader } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Card, Chip, Dialog, IconButton, ListGroup, ListRow, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { DateField, Select, type Option } from '../../../core/widgets/pickers';
import { useHeats } from '../api';
import { organizerApi, useRefreshCompetition, useRegistrations } from './api';
import { autoBody, autoValid, filterHeats, freeLanes, heatBody, heatDays, heatDraft, heatValid, laneCandidates, personName, type AutoDraft, type HeatDraft, type HeatFilter } from './logic-b';

const when = (iso: string, locale: string) => formatDate(iso, locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** « Planning » (spec §1.3 item 5): heats with their lanes, filters, automatic heats. */
export function PlanningTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const heats = useHeats(c.id);
  const regs = useRegistrations(c.id);
  const [filter, setFilter] = useState<HeatFilter>({ day: null, categoryId: null, workoutId: null, q: '' });
  const [edit, setEdit] = useState<HeatDraft | null>(null);
  const [auto, setAuto] = useState<AutoDraft | null>(null);
  const [lanesOf, setLanesOf] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(fn: () => Promise<unknown>, after?: (result: Json) => void) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      after?.((await fn()) as Json);
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  if (heats.isError) return <ErrorView error={heats.error} onRetry={() => heats.refetch()} />;
  if (!heats.data) return <Loading />;
  const all: Json[] = heats.data;
  const categories: Json[] = c.categories ?? [];
  const catOptions: Option[] = categories.map((k) => ({ value: k.id, label: k.name }));
  const wodOptions: Option[] = (c.workouts ?? []).map((w: Json) => ({ value: w.id, label: `${w.number}. ${w.name}` }));
  const org = organizerApi(api);

  if (edit) {
    return (
      <HeatForm
        draft={edit}
        busy={busy}
        error={error}
        catOptions={catOptions}
        wodOptions={wodOptions}
        onSave={(d) => run(() => (d.id ? org.updateHeat(c.id, d.id, heatBody(d)) : org.addHeat(c.id, heatBody(d))), () => setEdit(null))}
        onDelete={(d) => run(() => org.removeHeat(c.id, d.id!), () => setEdit(null))}
        onCancel={() => setEdit(null)}
      />
    );
  }
  if (auto) {
    return (
      <AutoForm
        draft={auto}
        busy={busy}
        error={error}
        catOptions={catOptions}
        wodOptions={wodOptions}
        onRun={(d) =>
          run(
            () => org.autoHeats(c.id, autoBody(d)),
            (r) => {
              setAuto(null);
              setNotice(t('orgAutoDone', { heats: r.heats, athletes: r.athletes }));
            },
          )
        }
        onCancel={() => setAuto(null)}
      />
    );
  }
  const open = lanesOf ? all.find((h) => h.id === lanesOf) : undefined;
  if (open) {
    return <LanesView heat={open} registrations={regs.data ?? []} busy={busy} error={error} onAssign={(rid, lane) => run(() => org.assignLane(c.id, open.id, rid, lane))} onFree={(lane) => run(() => org.freeLane(c.id, open.id, lane))} onClose={() => setLanesOf(null)} />;
  }

  const days = heatDays(all);
  const shown = filterHeats(all, filter);
  return (
    <Screen>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button testID="heat-new" icon="add" label={t('orgHeatNew')} onPress={() => setEdit(heatDraft(null))} />
        </View>
        <View style={{ flex: 1 }}>
          <Button testID="heat-auto" kind="outlined" icon="auto-fix-high" label={t('orgHeatAuto')} disabled={categories.length === 0} onPress={() => setAuto({ categoryId: categories[0]?.id ?? null, workoutId: null, lanes: '8', start: null, interval: '15' })} />
        </View>
      </View>
      {notice ? (
        <Txt testID="heat-notice" color={colors.primary}>
          {notice}
        </Txt>
      ) : null}
      <ErrorText error={error} />
      {all.length === 0 ? (
        <EmptyState icon="event-note" message={t('orgHeatNone')} />
      ) : (
        <>
          <TextField testID="heat-search" icon="search" placeholder={t('orgHeatSearch')} value={filter.q} onChangeText={(q) => setFilter({ ...filter, q })} autoCapitalize="none" />
          {days.length > 1 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Chip testID="heat-day-all" label={t('orgAllDays')} selected={!filter.day} onPress={() => setFilter({ ...filter, day: null })} />
              {days.map((d) => (
                <Chip key={d} testID={`heat-day-${d}`} label={formatDate(`${d}T12:00:00`, locale, { weekday: 'short', day: 'numeric', month: 'short' })} selected={filter.day === d} onPress={() => setFilter({ ...filter, day: d })} />
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Select testID="heat-filter-cat" label={t('orgHeatCategory')} value={filter.categoryId ?? ''} options={[{ value: '', label: t('orgAllCategories') }, ...catOptions]} onChange={(v) => setFilter({ ...filter, categoryId: v || null })} />
            </View>
            <View style={{ flex: 1 }}>
              <Select testID="heat-filter-wod" label={t('orgHeatWod')} value={filter.workoutId ?? ''} options={[{ value: '', label: t('orgAllWods') }, ...wodOptions]} onChange={(v) => setFilter({ ...filter, workoutId: v || null })} />
            </View>
          </View>
          {shown.length === 0 ? (
            <Txt color={colors.outline}>{t('orgHeatNoMatch')}</Txt>
          ) : (
            <ListGroup>
              {shown.map((h) => (
                <ListRow
                  key={h.id}
                  testID={`heat-${h.id}`}
                  title={h.name}
                  subtitle={[h.startsAt ? when(h.startsAt, locale) : t('orgHeatNoTime'), h.workout?.name, h.category?.name, t('orgHeatLanes', { used: (h.lanes ?? []).length, count: h.laneCount })].filter(Boolean).join(' · ')}
                  onPress={() => setLanesOf(h.id)}
                  trailing={<IconButton icon="edit" label={t('orgHeatEdit')} onPress={() => setEdit(heatDraft(h))} />}
                />
              ))}
            </ListGroup>
          )}
        </>
      )}
    </Screen>
  );
}

function HeatForm({ draft, busy, error, catOptions, wodOptions, onSave, onDelete, onCancel }: { draft: HeatDraft; busy: boolean; error: unknown; catOptions: Option[]; wodOptions: Option[]; onSave: (d: HeatDraft) => void; onDelete: (d: HeatDraft) => void; onCancel: () => void }) {
  const t = useT();
  const [d, setD] = useState(draft);
  const [deleting, setDeleting] = useState(false);
  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <TextField testID="heat-name" label={t('orgHeatName')} placeholder={t('orgHeatNameHint')} value={d.name} onChangeText={(name) => setD({ ...d, name })} maxLength={80} />
        <Select testID="heat-wod" label={t('orgHeatWod')} value={d.workoutId ?? ''} options={[{ value: '', label: t('orgNone') }, ...wodOptions]} onChange={(v) => setD({ ...d, workoutId: v || null })} />
        <Select testID="heat-cat" label={t('orgHeatCategory')} value={d.categoryId ?? ''} options={[{ value: '', label: t('orgNone') }, ...catOptions]} onChange={(v) => setD({ ...d, categoryId: v || null })} />
        <DateField testID="heat-start" mode="datetime" label={t('orgHeatStart')} value={d.start} placeholder={t('orgHeatNoTime')} onChange={(start) => setD({ ...d, start })} />
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <TextField testID="heat-duration" label={t('orgHeatDuration')} value={d.duration} onChangeText={(duration) => setD({ ...d, duration })} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField testID="heat-lanes" label={t('orgHeatLaneCount')} value={d.lanes} onChangeText={(lanes) => setD({ ...d, lanes })} keyboardType="number-pad" />
          </View>
        </View>
        <ErrorText error={error} />
        <Button testID="heat-save" label={t('save')} busy={busy} disabled={!heatValid(d)} onPress={() => onSave(d)} />
        {d.id ? <Button testID="heat-delete" kind="outlined" icon="delete" label={t('orgHeatDelete')} busy={busy} onPress={() => setDeleting(true)} /> : null}
        <Button kind="text" label={t('cancel')} onPress={onCancel} />
      </Card>
      <Dialog
        visible={deleting}
        title={t('orgHeatDelete')}
        message={t('orgHeatDeleteConfirm', { name: d.name })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={() => {
          setDeleting(false);
          onDelete(d);
        }}
        onCancel={() => setDeleting(false)}
      />
    </Screen>
  );
}

function AutoForm({ draft, busy, error, catOptions, wodOptions, onRun, onCancel }: { draft: AutoDraft; busy: boolean; error: unknown; catOptions: Option[]; wodOptions: Option[]; onRun: (d: AutoDraft) => void; onCancel: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const [d, setD] = useState(draft);
  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <Txt color={colors.outline}>{t('orgAutoIntro')}</Txt>
        <Select testID="auto-cat" label={t('orgHeatCategory')} value={d.categoryId} options={catOptions} onChange={(v) => setD({ ...d, categoryId: v })} />
        <Select testID="auto-wod" label={t('orgHeatWod')} value={d.workoutId ?? ''} options={[{ value: '', label: t('orgNone') }, ...wodOptions]} onChange={(v) => setD({ ...d, workoutId: v || null })} />
        <TextField testID="auto-lanes" label={t('orgHeatLaneCount')} value={d.lanes} onChangeText={(lanes) => setD({ ...d, lanes })} keyboardType="number-pad" />
        <DateField testID="auto-start" mode="datetime" label={t('orgAutoStart')} value={d.start} placeholder={t('orgHeatNoTime')} onChange={(start) => setD({ ...d, start })} />
        <TextField testID="auto-interval" label={t('orgAutoInterval')} value={d.interval} onChangeText={(interval) => setD({ ...d, interval })} keyboardType="number-pad" />
        <ErrorText error={error} />
        <Button testID="auto-run" label={t('orgHeatAuto')} busy={busy} disabled={!autoValid(d)} onPress={() => onRun(d)} />
        <Button kind="text" label={t('cancel')} onPress={onCancel} />
      </Card>
    </Screen>
  );
}

/** The lanes of one heat: who is in each, free one, fill one with an athlete the server will accept. */
function LanesView({ heat, registrations, busy, error, onAssign, onFree, onClose }: { heat: Json; registrations: Json[]; busy: boolean; error: unknown; onAssign: (registrationId: string, lane: number) => void; onFree: (lane: number) => void; onClose: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const [picking, setPicking] = useState<number | null>(null);
  const byLane = new Map<number, Json>((heat.lanes ?? []).map((l: Json) => [l.lane, l]));
  if (picking != null) {
    return (
      <FlatList
        data={laneCandidates(heat, registrations)}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        ListHeaderComponent={<SectionHeader title={t('orgLanePick', { lane: picking })} />}
        ListEmptyComponent={<Txt color={colors.outline}>{t('orgLaneNobody')}</Txt>}
        ListFooterComponent={<Button kind="text" label={t('cancel')} onPress={() => setPicking(null)} />}
        renderItem={({ item: r }) => (
          <ListRow
            testID={`lane-cand-${r.id}`}
            title={personName(r)}
            subtitle={r.category?.name}
            onPress={() => {
              setPicking(null);
              onAssign(r.id, picking);
            }}
          />
        )}
      />
    );
  }
  return (
    <Screen>
      <Txt variant="title">{heat.name}</Txt>
      <ListGroup>
        {Array.from({ length: heat.laneCount }, (_, i) => i + 1).map((n) => {
          const l = byLane.get(n);
          return l ? (
            <ListRow key={n} testID={`lane-${n}`} title={t('orgLane', { lane: n })} subtitle={personName(l)} trailing={<IconButton icon="close" label={t('orgLaneFree')} onPress={() => onFree(n)} />} />
          ) : (
            <ListRow key={n} testID={`lane-${n}`} title={t('orgLane', { lane: n })} subtitle={t('orgLaneEmpty')} chevron onPress={() => setPicking(n)} />
          );
        })}
      </ListGroup>
      {freeLanes(heat).length === 0 ? <Txt color={colors.outline}>{t('orgLaneFull')}</Txt> : null}
      <ErrorText error={error} />
      <Button testID="lanes-back" kind="outlined" label={t('orgBack')} busy={busy} onPress={onClose} />
    </Screen>
  );
}
```

- [ ] **Step 4: Name the heat conflicts**

In `apps/mobile-rn/src/core/widgets/error.tsx`, replace:
```ts
        case 'CONFLICT':
          return error.extra.reason === 'QUEUE_CLOSED' ? t('errorDuelQueueClosed') : t('errorGeneric');
```
with:
```ts
        case 'CONFLICT':
          switch (error.extra.reason) {
            case 'QUEUE_CLOSED':
              return t('errorDuelQueueClosed');
            case 'HEATS_EXIST':
              return t('errorHeatsExist');
            case 'LANE_TAKEN':
              return t('errorLaneTaken');
            case 'ALREADY_IN_HEAT':
              return t('errorAlreadyInHeat');
            default:
              return t('errorGeneric');
          }
```

- [ ] **Step 5: Open the tab in the organizer space**

In `apps/mobile-rn/src/features/competitions/organizer/logic.ts`, replace:
```ts
export type ManageTab = 'dashboard' | 'general' | 'categories' | 'wods';
```
with:
```ts
export type ManageTab = 'dashboard' | 'general' | 'categories' | 'wods' | 'planning';
```
In `apps/mobile-rn/src/features/competitions/organizer/manage.tsx`:
- add `import { PlanningTab } from './planning';` after `import type { ManageTab } from './logic';`;
- replace the `TABS` comment and line with:
```tsx
/** Tabs of the organizer space, in display order. */
const TABS: ManageTab[] = ['dashboard', 'general', 'categories', 'wods', 'planning'];
```
- in `labels`, add `planning: t('orgTabPlanning')` after `wods: t('orgTabWods')`;
- after `{tab === 'wods' && <WodsTab c={c} />}`, add `{tab === 'planning' && <PlanningTab c={c} />}`.

- [ ] **Step 6: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-planning.test.tsx test/screens/organizer.test.tsx && npx tsc --noEmit`
Expected: PASS, no type error.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/planning.tsx apps/mobile-rn/src/features/competitions/organizer/logic.ts apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/src/core/widgets/error.tsx apps/mobile-rn/test/screens/organizer-planning.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer planning: heats, filters, automatic heats, lanes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: « Planning » — the clock and « Retard »

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/timetable.tsx`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/planning.tsx` (show the card)
- Test: `apps/mobile-rn/test/screens/organizer-timetable.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`timetable`, `delayTargets`, `delayMinutes`, `runDelay`, `organizerApi(api).updateHeat / announce`, fixtures `orgBackend`); Task 2 (`PlanningTab` list view); `Dialog` with `input` (`src/core/widgets/kit.tsx`: the field's `testID`, `valid`, `keyboardType`; `onConfirm(text)`).
- Produces: `TimetableCard({ c, heats })`, shown at the top of the planning list when at least one heat has a start time.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-timetable.test.tsx`:
```tsx
import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const heat = (id: string, startsAt: string | null) => ({ id, number: 1, name: `Heat ${id.toUpperCase()}`, startsAt, durationMin: 12, laneCount: 4, workout: null, category: null, lanes: [] });
// At 09:05: A has ended, B is running, C and E have not started, D has no time.
const day = [heat('a', '2026-12-12T08:00:00.000Z'), heat('b', '2026-12-12T09:00:00.000Z'), heat('c', '2026-12-12T10:00:00.000Z'), heat('e', '2026-12-12T11:00:00.000Z'), heat('d', null)];
const open = () => <ManageScreen id="c9" initialTab="planning" />;

async function delayBy(screen: Awaited<ReturnType<typeof renderScreen>>, minutes: string) {
  await fireEvent.press(await screen.findByTestId('delay'));
  await fireEvent.changeText(screen.getByTestId('delay-minutes'), minutes);
  // A double tap on « Move » still moves each heat once.
  await act(async () => {
    fireEvent.press(screen.getByTestId('dialog-confirm'));
    fireEvent.press(screen.getByTestId('dialog-confirm'));
  });
}

describe('organizer space: clock and delay', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-12T09:05:00Z')));
  afterEach(() => jest.restoreAllMocks());

  it('shows the heat running, the next one and how many are done', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/heats', [200, day]));
    expect(await screen.findByText('Now: Heat B')).toBeTruthy();
    expect(screen.getByText(/^Next: Heat C at /)).toBeTruthy();
    expect(screen.getByText('1 of 4 heats done')).toBeTruthy();
  });

  it('« Delay » moves only the heats not started yet, then posts one announcement', async () => {
    const backend = orgBackend()
      .on('GET', '/competitions/c9/heats', [200, day])
      .on('PUT', '/competitions/c9/heats/c', [200, {}])
      .on('PUT', '/competitions/c9/heats/e', [200, {}])
      .on('POST', '/competitions/c9/announcements', [201, {}]);
    const screen = await renderScreen(open, backend);
    await delayBy(screen, '15');
    expect(await screen.findByText('2 heats moved by 15 min, announcement posted.')).toBeTruthy();
    expect(backend.calls('PUT', '/competitions/c9/heats/c').map((r) => r.body)).toEqual([{ startsAt: '2026-12-12T10:15:00.000Z' }]);
    expect(backend.calls('PUT', '/competitions/c9/heats/e').map((r) => r.body)).toEqual([{ startsAt: '2026-12-12T11:15:00.000Z' }]);
    for (const id of ['a', 'b', 'd']) expect(backend.calls('PUT', `/competitions/c9/heats/${id}`)).toHaveLength(0);
    expect(backend.calls('POST', '/competitions/c9/announcements').map((r) => r.body)).toEqual([{ title: 'Schedule moved by 15 min', body: 'Every heat that has not started yet starts 15 minutes later.' }]);
  });

  it('lists the heats that did not move and retries only those; the announcement waits for all', async () => {
    let tries = 0;
    const backend = orgBackend()
      .on('GET', '/competitions/c9/heats', [200, day])
      .on('PUT', '/competitions/c9/heats/c', () => (++tries === 1 ? [500, { code: 'INTERNAL', status: 500 }] : [200, {}]))
      .on('PUT', '/competitions/c9/heats/e', [200, {}])
      .on('POST', '/competitions/c9/announcements', [201, {}]);
    const screen = await renderScreen(open, backend);
    await delayBy(screen, '15');
    expect(await screen.findByText('Not moved: Heat C.')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c9/announcements')).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('delay-retry'));
    expect(await screen.findByText('2 heats moved by 15 min, announcement posted.')).toBeTruthy();
    expect(backend.calls('PUT', '/competitions/c9/heats/c').map((r) => r.body)).toEqual([{ startsAt: '2026-12-12T10:15:00.000Z' }, { startsAt: '2026-12-12T10:15:00.000Z' }]);
    expect(backend.calls('PUT', '/competitions/c9/heats/e')).toHaveLength(1);
    expect(backend.calls('POST', '/competitions/c9/announcements')).toHaveLength(1);
  });

  it('refuses a delay that is not 1 to 600 minutes', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/heats', [200, day]));
    await fireEvent.press(await screen.findByTestId('delay'));
    await fireEvent.changeText(screen.getByTestId('delay-minutes'), '0');
    expect(screen.getByTestId('dialog-confirm').props.accessibilityState?.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-timetable.test.tsx`
Expected: FAIL — « Now: Heat B » is not found.

- [ ] **Step 3: Write the card**

`apps/mobile-rn/src/features/competitions/organizer/timetable.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Dialog, Txt } from '../../../core/widgets/kit';
import { organizerApi, useRefreshCompetition } from './api';
import { delayMinutes, delayTargets, runDelay, timetable } from './logic-b';

/** The current time, read again every 30 seconds. */
function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

type Failure = { heats: Json[]; minutes: number; total: number };

/** Clock of the event day (spec §1.3 item 5): the heat running, the next one, how many are done; « Retard » moves every heat not started yet, then posts one announcement. */
export function TimetableCard({ c, heats }: { c: Json; heats: Json[] }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const now = useNow();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<Failure | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tt = timetable(heats, now);
  const targets = delayTargets(heats, now);
  const hour = (iso: string) => formatDate(iso, locale, { hour: '2-digit', minute: '2-digit' });

  /** Moves `todo` by `minutes`; `total` counts every heat of this delay, retries included. */
  async function delay(todo: Json[], minutes: number, total: number) {
    if (sending.current || todo.length === 0) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const left = await runDelay(todo, minutes, (heatId, startsAt) => organizerApi(api).updateHeat(c.id, heatId, { startsAt }));
      if (left.length > 0) {
        setFailed({ heats: left, minutes, total });
      } else {
        setFailed(null);
        await organizerApi(api).announce(c.id, { title: t('orgDelayTitle', { minutes }), body: t('orgDelayBody', { minutes }) });
        setDone(t('orgDelayDone', { count: total, minutes }));
      }
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  if (tt.total === 0) return null;
  return (
    <Card testID="timetable" style={{ gap: space.sm }}>
      <Txt variant="headline">{formatDate(new Date(now), locale, { hour: '2-digit', minute: '2-digit' })}</Txt>
      <Txt>{tt.current ? t('orgNowRunning', { name: tt.current.name }) : t('orgNothingRunning')}</Txt>
      {tt.next ? <Txt color={colors.outline}>{t('orgNextHeat', { name: tt.next.name, time: hour(tt.next.startsAt) })}</Txt> : null}
      <Txt color={colors.outline}>{t('orgHeatsDone', { done: tt.done, total: tt.total })}</Txt>
      {failed ? (
        <>
          <Txt color={colors.error}>{t('orgDelayFailed', { names: failed.heats.map((h) => h.name).join(', ') })}</Txt>
          <Button testID="delay-retry" kind="outlined" label={t('retry')} busy={busy} onPress={() => delay(failed.heats, failed.minutes, failed.total)} />
        </>
      ) : null}
      {done ? <Txt color={colors.primary}>{done}</Txt> : null}
      <ErrorText error={error} />
      <Button testID="delay" kind="outlined" icon="schedule" label={t('orgDelay')} busy={busy} disabled={targets.length === 0} onPress={() => setAsking(true)} />
      <Dialog
        visible={asking}
        title={t('orgDelay')}
        message={t('orgDelayAsk', { count: targets.length })}
        confirmLabel={t('orgDelayConfirm')}
        cancelLabel={t('cancel')}
        input={{ label: t('orgDelayMinutes'), keyboardType: 'number-pad', testID: 'delay-minutes', valid: (s) => delayMinutes(s) != null }}
        onConfirm={(s) => {
          setAsking(false);
          const minutes = delayMinutes(s);
          // The heats to move are taken at the moment of the confirmation, not when the dialog opened.
          const todo = delayTargets(heats, Date.now());
          if (minutes != null) void delay(todo, minutes, todo.length);
        }}
        onCancel={() => setAsking(false)}
      />
    </Card>
  );
}
```

- [ ] **Step 4: Show it at the top of the planning list**

In `apps/mobile-rn/src/features/competitions/organizer/planning.tsx`:
- add `import { TimetableCard } from './timetable';` after the `./logic-b` import;
- in the list view (the last `return` of `PlanningTab`), insert as the first child of `<Screen>`:
```tsx
      <TimetableCard c={c} heats={all} />
```

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-timetable.test.tsx test/screens/organizer-planning.test.tsx && npx tsc --noEmit`
Expected: PASS, no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/timetable.tsx apps/mobile-rn/src/features/competitions/organizer/planning.tsx apps/mobile-rn/test/screens/organizer-timetable.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer planning: clock of the day and « Retard » with announcement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: « Participants » — search, « À encaisser », mark paid, receipt, CSV

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/participants.tsx`
- Modify: `organizer/logic.ts` (`ManageTab`), `organizer/manage.tsx` (new tab)
- Test: `apps/mobile-rn/test/screens/organizer-participants.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`useRegistrations`, `organizerApi(api).markPaid`, `filterRegistrations`, `toCollect`, `registrationsCsv`, `personName`, `PaymentFilter`, fixtures `orgBackend`, `regs`); `formatMoney` from `../api`; `Segmented`, `Dialog`, `StatusPill`.
- Produces: `ParticipantsTab({ c })`; `ManageTab` gains `'participants'`.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-participants.test.tsx`:
```tsx
import { Share } from 'react-native';
import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend, regs } from '../organizer-fixtures';

const open = () => <ManageScreen id="c9" initialTab="participants" />;

describe('organizer space: participants', () => {
  let share: jest.SpyInstance;
  beforeEach(() => {
    share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  });
  afterEach(() => jest.restoreAllMocks());

  it('lists every registration; the search ignores accents and case', async () => {
    const screen = await renderScreen(open, orgBackend());
    expect(await screen.findByText('Sami Ben Ali')).toBeTruthy();
    expect(screen.getByText('All (5)')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('reg-search'), 'KEFI');
    expect(screen.getByText('Hédi Kéfi')).toBeTruthy();
    expect(screen.queryByText('Sami Ben Ali')).toBeNull();
  });

  it('filters by payment and by category', async () => {
    const screen = await renderScreen(open, orgBackend());
    await fireEvent.press(await screen.findByTestId('reg-pay-PAID'));
    expect(screen.getByText('Amira Trabelsi')).toBeTruthy();
    expect(screen.queryByText('Sami Ben Ali')).toBeNull();
    await fireEvent.press(screen.getByTestId('reg-pay-ALL'));
    await fireEvent.press(screen.getByTestId('reg-cat-k2'));
    expect(screen.getByText('Yasmine Jaziri')).toBeTruthy();
    expect(screen.queryByText('Hédi Kéfi')).toBeNull();
  });

  it('« To collect »: pending payments of registrations still standing, oldest first', async () => {
    const screen = await renderScreen(open, orgBackend());
    await fireEvent.press(await screen.findByText('To collect (2)'));
    expect(screen.getAllByTestId(/^reg-r\d$/).map((e) => e.props.testID)).toEqual(['reg-r4', 'reg-r1']);
  });

  it('marks paid once after confirmation, even on a double tap, then shares the receipt', async () => {
    const backend = orgBackend().on('POST', '/competitions/c9/registrations/r1/mark-paid', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('reg-paid-r1'));
    expect(screen.getByText(/^Did Sami Ben Ali pay /)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('dialog-confirm'));
      fireEvent.press(screen.getByTestId('dialog-confirm'));
    });
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/registrations/r1/mark-paid')).toHaveLength(1));
    expect(await screen.findByText('Receipt')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].message).toMatch(/^Fitness League receipt\nSousse Summer Throwdown\nSami Ben Ali · RX Men\n/);
  });

  it('a registration already settled elsewhere: says so and reloads the list', async () => {
    const backend = orgBackend().on('POST', '/competitions/c9/registrations/r1/mark-paid', [409, { code: 'CONFLICT', status: 409, detail: 'Nothing to pay' }]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('reg-paid-r1'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('This registration was already settled. The list is up to date.')).toBeTruthy();
    expect(screen.queryByText('Receipt')).toBeNull();
    await waitFor(() => expect(backend.calls('GET', '/competitions/c9/registrations').length).toBeGreaterThanOrEqual(2));
  });

  it('shares the list shown as CSV', async () => {
    const screen = await renderScreen(open, orgBackend());
    await fireEvent.press(await screen.findByTestId('reg-csv'));
    const csv: string = share.mock.calls[0][0].message;
    expect(csv.split('\n')[0]).toBe('name,username,category,registration,payment,amount,currency,registered_at');
    expect(csv.split('\n')).toHaveLength(regs.length + 1);
  });

  it('finds one athlete among 300', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ ...regs[0], id: `m${i}`, user: { username: `athlete${i}`, profile: { fullName: `Athlète ${i}` } } }));
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/registrations', [200, many]));
    await fireEvent.changeText(await screen.findByTestId('reg-search'), 'athlete 287');
    expect(await screen.findByText('Athlète 287')).toBeTruthy();
    expect(screen.getByTestId('reg-list')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-participants.test.tsx`
Expected: FAIL — `initialTab="participants"` is not a `ManageTab`, or « Sami Ben Ali » is not found.

- [ ] **Step 3: Write the participants tab**

`apps/mobile-rn/src/features/competitions/organizer/participants.tsx`:
```tsx
import { useRef, useState } from 'react';
import { FlatList, Share, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { ApiError } from '../../../core/api/errors';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { EmptyState, Loading, StatusPill } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Chip, Dialog, ListRow, Segmented, TextField, Txt } from '../../../core/widgets/kit';
import { formatMoney } from '../api';
import { organizerApi, useRefreshCompetition, useRegistrations } from './api';
import { filterRegistrations, personName, registrationsCsv, toCollect, type PaymentFilter } from './logic-b';

const PAYMENTS: PaymentFilter[] = ['ALL', 'PENDING', 'PAID', 'FREE'];
const standing = (r: Json) => r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED';

/** « Participants » (spec §1.3 item 6): every registration with search and filters, « À encaisser », mark paid with a receipt, CSV. */
export function ParticipantsTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const regs = useRegistrations(c.id);
  const [mode, setMode] = useState<'all' | 'collect'>('all');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentFilter>('ALL');
  const [paying, setPaying] = useState<Json | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const money = (r: Json) => formatMoney(r.finalPrice ?? 0, r.currency ?? c.currency, locale);
  const payLabel: Record<string, string> = { PENDING: t('orgPayPending'), PAID: t('orgPayPaid'), FREE: t('orgPayFree'), FAILED: t('orgPayFailed'), REFUNDED: t('orgPayRefunded') };

  async function markPaid(r: Json) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await organizerApi(api).markPaid(c.id, r.id);
      setReceipt(t('orgReceipt', { title: c.title, name: personName(r), category: r.category?.name ?? '', amount: money(r), date: formatDate(new Date(), locale) }));
    } catch (e) {
      // A co-organizer settled it first: the reload below shows the real state.
      if (e instanceof ApiError && e.status === 409) setInfo(t('orgAlreadyPaid'));
      else setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  if (regs.isError) return <ErrorView error={regs.error} onRetry={() => regs.refetch()} />;
  if (!regs.data) return <Loading />;
  const all: Json[] = regs.data;
  const collect = toCollect(all);
  const rows = mode === 'collect' ? collect : filterRegistrations(all, { q, categoryId, payment });

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      <Segmented
        flush
        options={[
          { key: 'all', label: t('orgRegAll', { count: all.length }) },
          { key: 'collect', label: t('orgRegToCollect', { count: collect.length }) },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'all' ? (
        <>
          <TextField testID="reg-search" icon="search" placeholder={t('orgRegSearch')} value={q} onChangeText={setQ} autoCapitalize="none" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {PAYMENTS.map((p) => (
              <Chip key={p} testID={`reg-pay-${p}`} label={p === 'ALL' ? t('orgRegAnyPayment') : payLabel[p]} selected={payment === p} onPress={() => setPayment(p)} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Chip testID="reg-cat-all" label={t('orgAllCategories')} selected={categoryId == null} onPress={() => setCategoryId(null)} />
            {(c.categories ?? []).map((k: Json) => (
              <Chip key={k.id} testID={`reg-cat-${k.id}`} label={k.name} selected={categoryId === k.id} onPress={() => setCategoryId(k.id)} />
            ))}
          </View>
          <Button testID="reg-csv" kind="outlined" icon="file-download" label={t('orgRegExport')} disabled={rows.length === 0} onPress={() => void Share.share({ message: registrationsCsv(rows) })} />
        </>
      ) : (
        <Txt color={colors.outline}>{t('orgRegCollectHint')}</Txt>
      )}
      {info ? <Txt color={colors.primary}>{info}</Txt> : null}
      <ErrorText error={error} />
    </View>
  );

  return (
    <>
      <FlatList
        testID="reg-list"
        data={rows}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState icon="group" message={mode === 'collect' ? t('orgRegNothingToCollect') : t('orgRegNone')} />}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        refreshing={regs.isRefetching}
        onRefresh={() => regs.refetch()}
        renderItem={({ item: r }) => (
          <ListRow
            testID={`reg-${r.id}`}
            title={personName(r)}
            subtitle={[r.category?.name, money(r), formatDate(r.registeredAt, locale)].filter(Boolean).join(' · ')}
            trailing={
              r.paymentStatus === 'PENDING' && standing(r) ? (
                <Button testID={`reg-paid-${r.id}`} kind="text" label={t('orgMarkPaid')} busy={busy} onPress={() => setPaying(r)} />
              ) : (
                <StatusPill label={standing(r) ? (payLabel[r.paymentStatus] ?? r.paymentStatus) : t('orgRegCancelled')} color={r.paymentStatus === 'PAID' && standing(r) ? colors.primary : colors.outline} />
              )
            }
          />
        )}
      />
      <Dialog
        visible={paying != null}
        title={t('orgMarkPaid')}
        message={paying ? t('orgMarkPaidConfirm', { name: personName(paying), amount: money(paying) }) : undefined}
        confirmLabel={t('orgMarkPaid')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          const r = paying;
          setPaying(null);
          if (r) void markPaid(r);
        }}
        onCancel={() => setPaying(null)}
      />
      <Dialog
        visible={receipt != null}
        title={t('orgReceiptTitle')}
        message={receipt ?? undefined}
        confirmLabel={t('orgShareReceipt')}
        cancelLabel={t('orgClose')}
        onConfirm={() => {
          const text = receipt;
          setReceipt(null);
          if (text) void Share.share({ message: text });
        }}
        onCancel={() => setReceipt(null)}
      />
    </>
  );
}
```

- [ ] **Step 4: Open the tab in the organizer space**

In `organizer/logic.ts`, add `| 'participants'` at the end of the `ManageTab` union. In `organizer/manage.tsx`: `import { ParticipantsTab } from './participants';`; append `'participants'` to `TABS`; add `participants: t('orgTabParticipants')` to `labels`; after the planning line add `{tab === 'participants' && <ParticipantsTab c={c} />}`.

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-participants.test.tsx && npx tsc --noEmit`
Expected: PASS, no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/participants.tsx apps/mobile-rn/src/features/competitions/organizer/logic.ts apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/test/screens/organizer-participants.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer participants: search, to collect, mark paid with receipt, CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: « Équipe » — organizers, judges (read only), add or remove a co-organizer

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/team.tsx`
- Modify: `organizer/logic.ts` (`ManageTab`), `organizer/manage.tsx` (new tab)
- Test: `apps/mobile-rn/test/screens/organizer-team.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`useStaff`, `organizerApi(api).addOrganizer / removeStaff`, `staffByRole`, `STAFF_ORDER`, `personName`, fixtures `orgBackend`, `me`); `useMe()` from `src/features/me/api.ts` (`GET /me` → `{ id, … }`); `socialApi(api).search(q)` from `src/features/social/api.ts` (`GET /search/athletes` → `{ data: [{ id, username, fullName }] }`).
- Produces: `TeamTab({ c })`; `ManageTab` gains `'team'`.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-team.test.tsx`:
```tsx
import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const staff = [
  { id: 's1', userId: 'u-me', role: 'ORGANIZER', user: { username: 'ahmed_rx', profile: { fullName: 'Ahmed Ben Salah' } }, assignments: [] },
  { id: 's2', userId: 'u-2', role: 'ORGANIZER', user: { username: 'bilel', profile: { fullName: 'Bilel Haddad' } }, assignments: [] },
  { id: 's3', userId: 'u-3', role: 'HEAD_JUDGE', user: { username: 'hj_one', profile: { fullName: 'Head Judge One' } }, assignments: [] },
];
const team = () => orgBackend().on('GET', '/competitions/c9/staff', [200, staff]);
const open = () => <ManageScreen id="c9" initialTab="team" />;

describe('organizer space: team', () => {
  it('shows the team by role and never offers to remove yourself', async () => {
    const screen = await renderScreen(open, team());
    expect(await screen.findByText('Ahmed Ben Salah')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Head Judge One')).toBeTruthy();
    expect(screen.getByText('Nobody yet.')).toBeTruthy();
    expect(screen.getByText('Judges and head judges are managed by the Fitness League team in the admin panel.')).toBeTruthy();
    expect(await screen.findAllByLabelText('Remove from the organizers')).toHaveLength(1);
  });

  it('removes a co-organizer after confirmation', async () => {
    const backend = team().on('DELETE', '/competitions/c9/staff/s2', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press((await screen.findAllByLabelText('Remove from the organizers'))[0]);
    expect(screen.getByText('Bilel Haddad will no longer manage this event.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('DELETE', '/competitions/c9/staff/s2')).toHaveLength(1));
  });

  it('adds a co-organizer found by name, once; an organizer already in the team cannot be picked', async () => {
    const backend = team()
      .on('GET', '/search/athletes', [200, { data: [{ id: 'u-7', username: 'amira', fullName: 'Amira Trabelsi' }, { id: 'u-2', username: 'bilel', fullName: 'Bilel Haddad' }], page: {} }])
      .on('POST', '/competitions/c9/staff', [201, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('team-add'));
    await fireEvent.changeText(screen.getByTestId('team-search'), 'ami');
    expect(await screen.findByTestId('team-pick-u-7')).toBeTruthy();
    expect(screen.getByText('Already an organizer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('team-pick-u-2'));
    expect(backend.calls('POST', '/competitions/c9/staff')).toHaveLength(0);
    await act(async () => {
      fireEvent.press(screen.getByTestId('team-pick-u-7'));
      fireEvent.press(screen.getByTestId('team-pick-u-7'));
    });
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/staff')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/staff')[0].body).toEqual({ userId: 'u-7', role: 'ORGANIZER' });
    expect(await screen.findByTestId('team-add')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-team.test.tsx`
Expected: FAIL — `initialTab="team"` is not a `ManageTab`, or « Ahmed Ben Salah » is not found.

- [ ] **Step 3: Write the team tab**

`apps/mobile-rn/src/features/competitions/organizer/team.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { Loading, SectionHeader } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Dialog, IconButton, ListGroup, ListRow, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { useMe } from '../../me/api';
import { socialApi } from '../../social/api';
import { organizerApi, useRefreshCompetition, useStaff } from './api';
import { personName, STAFF_ORDER, staffByRole } from './logic-b';

/** « Équipe » (spec §1.3 item 7): organizers, head judges and judges; co-organizers are added or removed here, judges stay with the admin panel. */
export function TeamTab({ c }: { c: Json }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const staff = useStaff(c.id);
  const me = useMe().data;
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Json | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  if (staff.isError) return <ErrorView error={staff.error} onRetry={() => staff.refetch()} />;
  if (!staff.data) return <Loading />;
  const groups = staffByRole(staff.data);
  if (adding) {
    const organizers = new Set(groups.ORGANIZER.map((s) => s.userId as string));
    return <AddOrganizer organizers={organizers} busy={busy} error={error} onPick={(userId) => run(() => organizerApi(api).addOrganizer(c.id, userId), () => setAdding(false))} onCancel={() => setAdding(false)} />;
  }
  const titles = { ORGANIZER: t('orgTeamOrganizers'), HEAD_JUDGE: t('orgTeamHeadJudges'), JUDGE: t('orgTeamJudges') };
  return (
    <Screen>
      {STAFF_ORDER.map((role) => (
        <View key={role} style={{ gap: space.sm }}>
          <SectionHeader title={titles[role]} />
          {groups[role].length === 0 ? (
            <Txt color={colors.outline}>{t('orgTeamNone')}</Txt>
          ) : (
            <ListGroup>
              {groups[role].map((s) => (
                <ListRow
                  key={s.id}
                  testID={`staff-${s.id}`}
                  icon={role === 'ORGANIZER' ? 'manage-accounts' : 'gavel'}
                  title={personName(s)}
                  subtitle={s.userId === me?.id ? t('orgTeamYou') : s.user?.username ? `@${s.user.username}` : null}
                  trailing={role === 'ORGANIZER' && me && s.userId !== me.id ? <IconButton icon="person-remove" label={t('orgTeamRemove')} onPress={() => setRemoving(s)} /> : null}
                />
              ))}
            </ListGroup>
          )}
        </View>
      ))}
      <Txt color={colors.outline}>{t('orgTeamJudgesHint')}</Txt>
      <ErrorText error={error} />
      <Button testID="team-add" icon="person-add" label={t('orgTeamAdd')} busy={busy} onPress={() => setAdding(true)} />
      <Dialog
        visible={removing != null}
        title={t('orgTeamRemove')}
        message={removing ? t('orgTeamRemoveConfirm', { name: personName(removing) }) : undefined}
        confirmLabel={t('orgTeamRemove')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={() => {
          const s = removing;
          setRemoving(null);
          if (s) void run(() => organizerApi(api).removeStaff(c.id, s.id));
        }}
        onCancel={() => setRemoving(null)}
      />
    </Screen>
  );
}

/** Athlete search (2 characters or more, debounced, same as the app's search screen); people already organizing cannot be picked. */
function AddOrganizer({ organizers, busy, error, onPick, onCancel }: { organizers: Set<string>; busy: boolean; error: unknown; onPick: (userId: string) => void; onCancel: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ q: string; rows: Json[] } | { q: string; error: unknown } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    if (q.length < 2) {
      setResults(null);
      return;
    }
    let live = true;
    socialApi(api)
      .search(q)
      .then((page) => live && setResults({ q, rows: page.data ?? [] }))
      .catch((e) => live && setResults({ q, error: e }));
    return () => {
      live = false;
    };
  }, [q, api]);

  return (
    <Screen>
      <Txt color={colors.outline}>{t('orgTeamAddHint')}</Txt>
      <TextField testID="team-search" icon="search" placeholder={t('searchAthletesHint')} value={text} onChangeText={setText} autoCapitalize="none" autoFocus />
      {q.length < 2 ? null : results == null || results.q !== q ? (
        <Loading />
      ) : 'error' in results ? (
        <ErrorView error={results.error} />
      ) : results.rows.length === 0 ? (
        <Txt color={colors.outline}>{t('noAthleteFound')}</Txt>
      ) : (
        <ListGroup>
          {results.rows.map((a) => (
            <ListRow key={a.id} testID={`team-pick-${a.id}`} icon="person" title={a.fullName || a.username} subtitle={organizers.has(a.id) ? t('orgTeamAlready') : `@${a.username}`} onPress={organizers.has(a.id) ? undefined : () => onPick(a.id)} />
          ))}
        </ListGroup>
      )}
      <ErrorText error={error} />
      <Button kind="text" label={t('cancel')} busy={busy} onPress={onCancel} />
    </Screen>
  );
}
```

- [ ] **Step 4: Open the tab in the organizer space**

In `organizer/logic.ts`, add `| 'team'` at the end of the `ManageTab` union. In `organizer/manage.tsx`: `import { TeamTab } from './team';`; append `'team'` to `TABS`; add `team: t('orgTabTeam')` to `labels`; after the participants line add `{tab === 'team' && <TeamTab c={c} />}`.

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-team.test.tsx && npx tsc --noEmit`
Expected: PASS, no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/team.tsx apps/mobile-rn/src/features/competitions/organizer/logic.ts apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/test/screens/organizer-team.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer team: roles, add or remove a co-organizer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: « Classement » — read-only leaderboard per category

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/leaderboard.tsx`
- Modify: `organizer/logic.ts` (`ManageTab`), `organizer/manage.tsx` (new tab)
- Test: `apps/mobile-rn/test/screens/organizer-leaderboard.test.tsx`

**Interfaces:**
- Consumes: `useCompLeaderboard(id, categoryId?)` from `../api` (`GET /competitions/:id/leaderboard?categoryId=`); `RankRow`, `StatusPill` (`src/core/widgets/common.tsx`); fixtures `orgBackend`.
- Produces: `LeaderboardTab({ c })`; `ManageTab` gains `'leaderboard'`. No publish button (Global Constraints ruling).

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-leaderboard.test.tsx`:
```tsx
import { fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const board = {
  status: 'REGISTRATION_OPEN',
  provisional: true,
  maximumPoints: 200,
  workouts: [],
  rows: [
    { rank: 1, athlete: { id: 'u-r3', fullName: 'Hédi Kéfi', username: 'hedi' }, wodPoints: {}, totalPoints: 180, pending: 0 },
    { rank: 2, athlete: { id: 'u-r6', fullName: 'Karim Mansour', username: 'karim' }, wodPoints: {}, totalPoints: 150, pending: 1 },
  ],
  podium: null,
  prizes: [],
};
const open = () => <ManageScreen id="c9" initialTab="leaderboard" />;

describe('organizer space: leaderboard', () => {
  it('shows the provisional ranking of a category and who publishes the final one', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board]));
    expect(await screen.findByText('Hédi Kéfi')).toBeTruthy();
    expect(screen.getByText('180 pts')).toBeTruthy();
    expect(screen.getByText('1 to judge')).toBeTruthy();
    expect(screen.getByText('Provisional')).toBeTruthy();
    expect(screen.getByText('The head judge publishes the final leaderboard from the admin panel, once every appeal is settled.')).toBeTruthy();
  });

  it('reads the leaderboard of the category picked', async () => {
    const backend = orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('board-cat-k2'));
    await waitFor(() => expect(backend.calls('GET', '/competitions/c9/leaderboard').map((r) => r.query.get('categoryId'))).toContain('k2'));
    expect(backend.calls('GET', '/competitions/c9/leaderboard')[0].query.get('categoryId')).toBe('k1');
  });

  it('says when nobody has a score yet', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/leaderboard', [200, { ...board, rows: [] }]));
    expect(await screen.findByText('No score in this category yet.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-leaderboard.test.tsx`
Expected: FAIL — `initialTab="leaderboard"` is not a `ManageTab`, or « Hédi Kéfi » is not found.

- [ ] **Step 3: Write the leaderboard tab**

`apps/mobile-rn/src/features/competitions/organizer/leaderboard.tsx`:
```tsx
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { EmptyState, Loading, RankRow, StatusPill } from '../../../core/widgets/common';
import { ErrorView } from '../../../core/widgets/error';
import { Card, Chip, ListGroup, Screen, Txt } from '../../../core/widgets/kit';
import { useCompLeaderboard } from '../api';

/** « Classement » (spec §1.3 item 8): the ranking per category. Read only: the server lets only the head judge (admin panel) publish the final leaderboard. */
export function LeaderboardTab({ c }: { c: Json }) {
  const t = useT();
  const { colors } = useTheme();
  const categories: Json[] = (c.categories ?? []).filter((k: Json) => k.active !== false);
  const [categoryId, setCategoryId] = useState<string | undefined>(categories[0]?.id);
  const board = useCompLeaderboard(c.id, categoryId);
  return (
    <Screen>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {categories.map((k) => (
          <Chip key={k.id} testID={`board-cat-${k.id}`} label={k.name} selected={categoryId === k.id} onPress={() => setCategoryId(k.id)} />
        ))}
      </View>
      {board.isError ? (
        <ErrorView error={board.error} onRetry={() => board.refetch()} />
      ) : !board.data ? (
        <Loading />
      ) : (
        <>
          <StatusPill testID="board-status" label={board.data.provisional ? t('orgBoardProvisional') : t('orgBoardFinal')} color={board.data.provisional ? colors.outline : colors.primary} />
          {board.data.rows.length === 0 ? (
            <EmptyState icon="leaderboard" message={t('orgBoardEmpty')} />
          ) : (
            <ListGroup>
              {board.data.rows.map((r: Json) => (
                <RankRow key={r.athlete.id} testID={`board-${r.athlete.id}`} rank={r.rank} name={r.athlete.fullName || r.athlete.username || '—'} value={t('orgBoardPoints', { points: r.totalPoints })} subtitle={r.pending ? t('orgBoardPending', { count: r.pending }) : undefined} />
              ))}
            </ListGroup>
          )}
        </>
      )}
      <Card style={{ gap: space.sm }}>
        <Txt variant="title">{t('orgBoardPublishTitle')}</Txt>
        <Txt color={colors.outline}>{t('orgBoardPublishHint')}</Txt>
      </Card>
    </Screen>
  );
}
```

- [ ] **Step 4: Open the tab in the organizer space**

In `organizer/logic.ts`, add `| 'leaderboard'` at the end of the `ManageTab` union. In `organizer/manage.tsx`: `import { LeaderboardTab } from './leaderboard';`; append `'leaderboard'` to `TABS`; add `leaderboard: t('orgTabLeaderboard')` to `labels`; after the team line add `{tab === 'leaderboard' && <LeaderboardTab c={c} />}`.

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-leaderboard.test.tsx && npx tsc --noEmit`
Expected: PASS, no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/leaderboard.tsx apps/mobile-rn/src/features/competitions/organizer/logic.ts apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/test/screens/organizer-leaderboard.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer leaderboard per category, read only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: « Annonces » — post, list, and show them on the event page

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/announcements.tsx`
- Modify: `apps/mobile-rn/src/features/competitions/screens.tsx` (latest announcements on the event page), `organizer/logic.ts` (`ManageTab`), `organizer/manage.tsx` (new tab)
- Test: `apps/mobile-rn/test/screens/organizer-announcements.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`useAnnouncements`, `organizerApi(api).announce`, `announcementValid`, fixtures `orgBackend`, `event`); `CompetitionScreen` (`screens.tsx`, where `<HeatSchedule id={id} />` sits in the « Event info » tab).
- Produces: `AnnouncementsTab({ c })`, `AnnouncementList({ items })`, `CompetitionAnnouncements({ id })`; `ManageTab` gains `'announcements'`. Spec §1.3 item 9 says the announcement is « visible sur la page de l'événement »: the event page did not show announcements yet, so this task adds them there (read with the public `GET …/announcements`).

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-announcements.test.tsx`:
```tsx
import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { CompetitionScreen } from '../../src/features/competitions/screens';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

const posted = [{ id: 'a1', title: 'Heat 3 moved', body: 'Heat 3 now starts at 15:30.', createdAt: '2026-12-12T09:00:00.000Z' }];
const open = () => <ManageScreen id="c9" initialTab="announcements" />;

describe('organizer space: announcements', () => {
  it('lists what was posted and says that no notification is sent', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/announcements', [200, posted]));
    expect(await screen.findByText('Heat 3 moved')).toBeTruthy();
    expect(screen.getByText('Heat 3 now starts at 15:30.')).toBeTruthy();
    expect(screen.getByText('Shown on the event page. No notification is sent.')).toBeTruthy();
  });

  it('posts once, trimmed, even on a double tap', async () => {
    const backend = orgBackend().on('GET', '/competitions/c9/announcements', [200, []]).on('POST', '/competitions/c9/announcements', [201, {}]);
    const screen = await renderScreen(open, backend);
    expect(await screen.findByText('No announcement yet.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('ann-title'), '  Parking ');
    await fireEvent.changeText(screen.getByTestId('ann-body'), ' Use the north gate. ');
    await act(async () => {
      fireEvent.press(screen.getByTestId('ann-post'));
      fireEvent.press(screen.getByTestId('ann-post'));
    });
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/announcements')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/announcements')[0].body).toEqual({ title: 'Parking', body: 'Use the north gate.' });
  });

  it('keeps « Post » off until the title has 3 characters', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/announcements', [200, []]));
    await fireEvent.changeText(await screen.findByTestId('ann-title'), 'Hi');
    await fireEvent.changeText(screen.getByTestId('ann-body'), 'Welcome!');
    expect(screen.getByTestId('ann-post').props.accessibilityState?.disabled).toBe(true);
  });

  it('the event page shows the latest announcements', async () => {
    const backend = orgBackend({ ...event, myRoles: [] }).on('GET', '/competitions/c9/announcements', [200, posted]);
    const screen = await renderScreen(() => <CompetitionScreen id="c9" />, backend);
    expect(await screen.findByText('Heat 3 moved')).toBeTruthy();
    expect(screen.getByText('Announcements')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-announcements.test.tsx`
Expected: FAIL — `initialTab="announcements"` is not a `ManageTab`, or « Heat 3 moved » is not found.

- [ ] **Step 3: Write the announcements tab and the event-page section**

`apps/mobile-rn/src/features/competitions/organizer/announcements.tsx`:
```tsx
import { useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { Loading, SectionHeader } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Card, Screen, TextField, Txt, toast } from '../../../core/widgets/kit';
import { organizerApi, useAnnouncements, useRefreshCompetition } from './api';
import { announcementValid } from './logic-b';

/** « Annonces » (spec §1.3 item 9): post an announcement; it shows on the event page, without a notification. */
export function AnnouncementsTab({ c }: { c: Json }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const list = useAnnouncements(c.id);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ok = announcementValid(title, body);

  async function post() {
    if (sending.current || !ok) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await organizerApi(api).announce(c.id, { title: title.trim(), body: body.trim() });
      setTitle('');
      setBody('');
      toast(t('orgAnnPosted'));
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <Txt color={colors.outline}>{t('orgAnnHint')}</Txt>
        <TextField testID="ann-title" label={t('orgAnnTitle')} value={title} onChangeText={setTitle} maxLength={120} />
        <TextField testID="ann-body" label={t('orgAnnBody')} value={body} onChangeText={setBody} maxLength={5000} multiline />
        <ErrorText error={error} />
        <Button testID="ann-post" icon="campaign" label={t('orgAnnPost')} busy={busy} disabled={!ok} onPress={post} />
      </Card>
      <SectionHeader title={t('orgAnnList')} />
      {list.isError ? (
        <ErrorView error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <Txt color={colors.outline}>{t('orgAnnNone')}</Txt>
      ) : (
        <AnnouncementList items={list.data} />
      )}
    </Screen>
  );
}

export function AnnouncementList({ items }: { items: Json[] }) {
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {items.map((a) => (
        <Card key={a.id} testID={`ann-${a.id}`} style={{ gap: space.xs }}>
          <Txt variant="title">{a.title}</Txt>
          <Txt variant="small" color={colors.outline}>
            {formatDate(a.createdAt, locale, { dateStyle: 'medium', timeStyle: 'short' })}
          </Txt>
          <Txt>{a.body}</Txt>
        </Card>
      ))}
    </View>
  );
}

/** Event page: the organizers' three latest announcements; nothing when there is none (it is extra information, the page works without it). */
export function CompetitionAnnouncements({ id }: { id: string }) {
  const t = useT();
  const list = useAnnouncements(id);
  const items: Json[] = (list.data ?? []).slice(0, 3);
  if (items.length === 0) return null;
  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title={t('compAnnouncements')} />
      <AnnouncementList items={items} />
    </View>
  );
}
```
In `apps/mobile-rn/src/features/competitions/screens.tsx`:
- add `import { CompetitionAnnouncements } from './organizer/announcements';` after `import { publicationState } from './organizer/logic';`;
- replace `<HeatSchedule id={id} />` with:
```tsx
              <HeatSchedule id={id} />
              <CompetitionAnnouncements id={id} />
```

- [ ] **Step 4: Open the tab in the organizer space**

In `organizer/logic.ts`, add `| 'announcements'` at the end of the `ManageTab` union. In `organizer/manage.tsx`: `import { AnnouncementsTab } from './announcements';`; append `'announcements'` to `TABS`; add `announcements: t('orgTabAnnouncements')` to `labels`; after the leaderboard line add `{tab === 'announcements' && <AnnouncementsTab c={c} />}`.

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-announcements.test.tsx test/screens/competitions.test.tsx && npx tsc --noEmit`
Expected: PASS (the competition page tests do not stub the announcements: the 404 hides the section), no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/announcements.tsx apps/mobile-rn/src/features/competitions/screens.tsx apps/mobile-rn/src/features/competitions/organizer/logic.ts apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/test/screens/organizer-announcements.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer announcements, shown on the event page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: « Codes promo » — list, top 5, create one or a batch, activate

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/coupons.tsx`
- Modify: `organizer/logic.ts` (`ManageTab`), `organizer/manage.tsx` (new tab)
- Test: `apps/mobile-rn/test/screens/organizer-coupons.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`useCoupons`, `organizerApi(api).addCoupon / setCouponActive`, `couponDraft`, `couponValid`, `couponBody`, `normalizeCode`, `batchCodes`, `createCoupons`, `topUsed`, `CouponDraft`, `CouponKind`, `BatchResult`, fixtures `orgBackend`); `formatMoney` from `../api`; lot A keys `orgActivate`, `orgDeactivate`, `orgInactive`.
- Produces: `CouponsTab({ c })`; `ManageTab` gains `'coupons'`.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-coupons.test.tsx`:
```tsx
import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const coupons = [
  { id: 'p1', code: 'EARLY', type: 'PERCENTAGE', value: 20, categoryId: null, maxUses: 50, usedCount: 12, expiresAt: '2026-11-01T22:00:00.000Z', active: true },
  { id: 'p2', code: 'FREE2026', type: 'FREE', value: 0, categoryId: 'k2', maxUses: null, usedCount: 3, expiresAt: null, active: false },
  { id: 'p3', code: 'TEN', type: 'FIXED_AMOUNT', value: 10000, categoryId: null, maxUses: 10, usedCount: 0, expiresAt: null, active: true },
];
const promo = () => orgBackend().on('GET', '/competitions/c9/coupons', [200, coupons]);
const open = () => <ManageScreen id="c9" initialTab="coupons" />;

describe('organizer space: promo codes', () => {
  it('lists the codes with their discount, category, uses and state; the most used on top', async () => {
    const screen = await renderScreen(open, promo());
    expect(await screen.findByText('Most used')).toBeTruthy();
    // EARLY and FREE2026 are in the top list and in the full list; TEN was never used.
    expect(screen.getAllByText('EARLY')).toHaveLength(2);
    expect(screen.getAllByText('FREE2026')).toHaveLength(2);
    expect(screen.getAllByText('TEN')).toHaveLength(1);
    expect(screen.getByText(/^-20 % · 12\/50 uses · until /)).toBeTruthy();
    expect(screen.getByText('Free · RX Women · 3/∞ uses · Inactive')).toBeTruthy();
  });

  it('creates one code with a percentage', async () => {
    const backend = promo().on('POST', '/competitions/c9/coupons', [201, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('coupon-new'));
    await fireEvent.changeText(screen.getByTestId('coupon-code'), 'summer20');
    await fireEvent.changeText(screen.getByTestId('coupon-value'), '20');
    await fireEvent.press(screen.getByTestId('coupon-save'));
    expect(await screen.findByText('Codes created: 1')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c9/coupons').map((r) => r.body)).toEqual([{ code: 'SUMMER20', type: 'PERCENTAGE', value: 20 }]);
  });

  it('sends an amount in millimes', async () => {
    const backend = promo().on('POST', '/competitions/c9/coupons', [201, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('coupon-new'));
    await fireEvent.changeText(screen.getByTestId('coupon-code'), 'ten5');
    await fireEvent.press(screen.getByTestId('coupon-type-FIXED_AMOUNT'));
    await fireEvent.changeText(screen.getByTestId('coupon-value'), '12,5');
    await fireEvent.press(screen.getByTestId('coupon-save'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/coupons')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/coupons')[0].body).toEqual({ code: 'TEN5', type: 'FIXED_AMOUNT', value: 12500 });
  });

  it('a batch skips a code already taken and names it; a double tap starts one batch', async () => {
    const backend = promo().on('POST', '/competitions/c9/coupons', (req) => (req.body.code === 'VIP-2' ? [422, { code: 'VALIDATION_FAILED', status: 422, errors: [{ field: 'code', code: 'TAKEN' }] }] : [201, {}]));
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('coupon-new'));
    await fireEvent.changeText(screen.getByTestId('coupon-code'), 'vip');
    await fireEvent.press(screen.getByTestId('coupon-type-FREE'));
    await fireEvent.changeText(screen.getByTestId('coupon-qty'), '3');
    expect(screen.getByText('Creates VIP-1 … VIP-3')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('coupon-save'));
      fireEvent.press(screen.getByTestId('coupon-save'));
    });
    expect(await screen.findByText('Codes created: 2 · Already taken, skipped: VIP-2')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c9/coupons').map((r) => r.body.code)).toEqual(['VIP-1', 'VIP-2', 'VIP-3']);
  });

  it('deactivates a code', async () => {
    const backend = promo().on('POST', '/competitions/c9/coupons/p1/deactivate', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('coupon-toggle-p1'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/coupons/p1/deactivate')).toHaveLength(1));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-coupons.test.tsx`
Expected: FAIL — `initialTab="coupons"` is not a `ManageTab`, or « Most used » is not found.

- [ ] **Step 3: Write the promo codes tab**

`apps/mobile-rn/src/features/competitions/organizer/coupons.tsx`:
```tsx
import { useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { Loading, SectionHeader } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Card, Chip, ListGroup, ListRow, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { DateField, Select } from '../../../core/widgets/pickers';
import { formatMoney } from '../api';
import { organizerApi, useCoupons, useRefreshCompetition } from './api';
import { batchCodes, couponBody, couponDraft, couponValid, createCoupons, normalizeCode, topUsed, type BatchResult, type CouponDraft, type CouponKind } from './logic-b';

const KINDS: CouponKind[] = ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE'];
type Report = Pick<BatchResult, 'created' | 'taken'>;

/** « Codes promo » (spec §1.3 item 10): every code with its uses, the 5 most used, create one or a batch (CODE-1 … CODE-N), activate / deactivate. */
export function CouponsTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const list = useCoupons(c.id);
  const [form, setForm] = useState<CouponDraft | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function guarded(fn: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  const create = (d: CouponDraft) =>
    guarded(async () => {
      setReport(null);
      const codes = batchCodes(normalizeCode(d.code), d.quantity.trim() ? Number(d.quantity) : 1);
      const r = await createCoupons(codes, (code) => organizerApi(api).addCoupon(c.id, couponBody(d, code)));
      setReport({ created: r.created, taken: r.taken });
      // Another error stopped the batch: the form stays open with the summary and the error.
      if (r.error) setError(r.error);
      else setForm(null);
    });
  const toggle = (k: Json) =>
    guarded(async () => {
      await organizerApi(api).setCouponActive(c.id, k.id, !k.active);
    });

  const kindLabel: Record<CouponKind, string> = { PERCENTAGE: t('orgCouponPercent'), FIXED_AMOUNT: t('orgCouponAmount'), FREE: t('orgCouponFree') };
  const discount = (k: Json) => (k.type === 'FREE' ? t('orgCouponFree') : k.type === 'PERCENTAGE' ? `-${k.value} %` : `-${formatMoney(k.value, c.currency, locale)}`);
  const categoryName = (id: string | null) => (c.categories ?? []).find((x: Json) => x.id === id)?.name;
  const summary = report ? [t('orgCouponCreated', { count: report.created.length }), report.taken.length ? t('orgCouponTaken', { codes: report.taken.join(', ') }) : null].filter(Boolean).join(' · ') : null;

  if (form) {
    return (
      <CouponForm
        draft={form}
        categories={c.categories ?? []}
        kindLabel={kindLabel}
        busy={busy}
        error={error}
        summary={summary}
        onSave={create}
        onCancel={() => {
          setForm(null);
          setReport(null);
          setError(null);
        }}
      />
    );
  }
  if (list.isError) return <ErrorView error={list.error} onRetry={() => list.refetch()} />;
  if (!list.data) return <Loading />;
  const top = topUsed(list.data);
  return (
    <Screen>
      {summary ? (
        <Card testID="coupon-report">
          <Txt>{summary}</Txt>
        </Card>
      ) : null}
      <Button
        testID="coupon-new"
        icon="add"
        label={t('orgCouponNew')}
        onPress={() => {
          setReport(null);
          setError(null);
          setForm(couponDraft());
        }}
      />
      <ErrorText error={error} />
      {top.length > 0 ? (
        <>
          <SectionHeader title={t('orgCouponTop')} />
          <ListGroup>
            {top.map((k) => (
              <ListRow key={k.id} icon="trending-up" title={k.code} trailing={<Txt variant="title">{String(k.usedCount)}</Txt>} />
            ))}
          </ListGroup>
        </>
      ) : null}
      <SectionHeader title={t('orgCouponAll')} />
      {list.data.length === 0 ? (
        <Txt color={colors.outline}>{t('orgCouponNone')}</Txt>
      ) : (
        <ListGroup>
          {list.data.map((k: Json) => (
            <ListRow
              key={k.id}
              testID={`coupon-${k.id}`}
              icon="sell"
              title={k.code}
              subtitle={[discount(k), categoryName(k.categoryId), t('orgCouponUses', { used: k.usedCount ?? 0, max: k.maxUses ?? '∞' }), k.expiresAt ? t('orgCouponUntil', { date: formatDate(k.expiresAt, locale) }) : null, k.active ? null : t('orgInactive')].filter(Boolean).join(' · ')}
              trailing={<Button testID={`coupon-toggle-${k.id}`} kind="text" label={k.active ? t('orgDeactivate') : t('orgActivate')} busy={busy} onPress={() => toggle(k)} />}
            />
          ))}
        </ListGroup>
      )}
    </Screen>
  );
}

function CouponForm({ draft, categories, kindLabel, busy, error, summary, onSave, onCancel }: { draft: CouponDraft; categories: Json[]; kindLabel: Record<CouponKind, string>; busy: boolean; error: unknown; summary: string | null; onSave: (d: CouponDraft) => void; onCancel: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const [d, setD] = useState(draft);
  const code = normalizeCode(d.code);
  const quantity = Number(d.quantity);
  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <TextField testID="coupon-code" label={t('orgCouponCode')} value={d.code} onChangeText={(v) => setD({ ...d, code: v.toUpperCase() })} autoCapitalize="characters" maxLength={32} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {KINDS.map((k) => (
            <Chip key={k} testID={`coupon-type-${k}`} label={kindLabel[k]} selected={d.type === k} onPress={() => setD({ ...d, type: k })} />
          ))}
        </View>
        {d.type !== 'FREE' ? <TextField testID="coupon-value" label={d.type === 'PERCENTAGE' ? t('orgCouponPercentValue') : t('orgCouponAmountValue')} value={d.value} onChangeText={(value) => setD({ ...d, value })} keyboardType="decimal-pad" /> : null}
        <Select testID="coupon-cat" label={t('orgHeatCategory')} value={d.categoryId ?? ''} options={[{ value: '', label: t('orgAllCategories') }, ...categories.map((k) => ({ value: k.id as string, label: k.name as string }))]} onChange={(v) => setD({ ...d, categoryId: v || null })} />
        <TextField testID="coupon-max" label={t('orgCouponMaxUses')} value={d.maxUses} onChangeText={(maxUses) => setD({ ...d, maxUses })} keyboardType="number-pad" />
        <DateField testID="coupon-expires" mode="datetime" label={t('orgCouponExpires')} value={d.expires} placeholder={t('orgCouponNoExpiry')} onChange={(expires) => setD({ ...d, expires })} />
        <TextField testID="coupon-qty" label={t('orgCouponQuantity')} value={d.quantity} onChangeText={(q) => setD({ ...d, quantity: q })} keyboardType="number-pad" />
        {Number.isInteger(quantity) && quantity > 1 && code ? (
          <Txt variant="small" color={colors.outline}>
            {t('orgCouponBatchHint', { first: `${code}-1`, last: `${code}-${quantity}` })}
          </Txt>
        ) : null}
        {summary ? <Txt>{summary}</Txt> : null}
        <ErrorText error={error} />
        <Button testID="coupon-save" label={t('orgCouponCreate')} busy={busy} disabled={!couponValid(d)} onPress={() => onSave(d)} />
        <Button kind="text" label={t('cancel')} onPress={onCancel} />
      </Card>
    </Screen>
  );
}
```

- [ ] **Step 4: Open the tab in the organizer space**

In `organizer/logic.ts`, add `| 'coupons'` at the end of the `ManageTab` union. In `organizer/manage.tsx`: `import { CouponsTab } from './coupons';`; append `'coupons'` to `TABS`; add `coupons: t('orgTabCoupons')` to `labels`; after the announcements line add `{tab === 'coupons' && <CouponsTab c={c} />}`.

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-coupons.test.tsx && npx tsc --noEmit`
Expected: PASS, no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/coupons.tsx apps/mobile-rn/src/features/competitions/organizer/logic.ts apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/test/screens/organizer-coupons.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer promo codes: top 5, one code or a batch, activate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Dashboard — registrations per category, women / men, per day

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/breakdown.tsx`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx` (show it under the figures)
- Modify: `apps/mobile-rn/test/screens/organizer.test.tsx` (lot A fixture answers the registrations)
- Test: `apps/mobile-rn/test/screens/organizer-dashboard-b.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`useRegistrations`, `distribution`, fixtures `orgBackend`); lot A `DashboardTab`.
- Produces: `RegistrationsBreakdown({ c })` — nothing while no registration stands; the registrations' error shows as a line (the figures above keep their own error state).

- [ ] **Step 1: Write the failing screen test**

`apps/mobile-rn/test/screens/organizer-dashboard-b.test.tsx`:
```tsx
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

describe('organizer space: dashboard breakdown', () => {
  it('counts the registrations still standing per category, women / men, and per day', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" />, orgBackend());
    expect(await screen.findByText('By category')).toBeTruthy();
    expect(screen.getByTestId('split-k1')).toBeTruthy();
    expect(screen.getByTestId('split-k2')).toBeTruthy();
    expect(screen.getByText('Women 2 · Men 2 · Mixed 0')).toBeTruthy();
    for (const day of ['2026-10-19', '2026-10-20', '2026-10-21']) expect(screen.getByTestId(`day-${day}`)).toBeTruthy();
    // Omar's registration of 22 October was cancelled.
    expect(screen.queryByTestId('day-2026-10-22')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-dashboard-b.test.tsx`
Expected: FAIL — « By category » is not found.

- [ ] **Step 3: Write the breakdown and show it**

`apps/mobile-rn/src/features/competitions/organizer/breakdown.tsx`:
```tsx
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Card, ListGroup, ListRow, Txt } from '../../../core/widgets/kit';
import { useRegistrations } from './api';
import { distribution } from './logic-b';

/** Dashboard, lot B (spec §1.3 item 1): registrations per category, women / men, and per day, computed from the registration list. */
export function RegistrationsBreakdown({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  if (regs.isError) return <ErrorText error={regs.error} />;
  if (!regs.data) return null;
  const d = distribution(regs.data, c.categories ?? []);
  if (d.byCategory.length === 0) return null;
  const busiest = Math.max(...d.perDay.map((x) => x.count));
  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title={t('orgBreakdown')} />
      <ListGroup>
        {d.byCategory.map((k) => (
          <ListRow key={k.id} testID={`split-${k.id}`} title={k.name} trailing={<Txt variant="title">{String(k.count)}</Txt>} />
        ))}
      </ListGroup>
      <Txt color={colors.outline}>{t('orgSplitGender', { women: d.women, men: d.men, mixed: d.mixed })}</Txt>
      <SectionHeader title={t('orgPerDay')} />
      <Card style={{ gap: space.xs }}>
        {d.perDay.map((x) => (
          <View key={x.day} testID={`day-${x.day}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Txt variant="small" style={{ width: 64 }}>
              {formatDate(`${x.day}T12:00:00`, locale, { day: 'numeric', month: 'short' })}
            </Txt>
            {/* The bar: the day's count against the busiest day. */}
            <View style={{ flex: 1, flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.surfaceHigh }}>
              <View style={{ flex: x.count, backgroundColor: colors.primary }} />
              <View style={{ flex: busiest - x.count }} />
            </View>
            <Txt variant="small" style={{ width: 28, textAlign: 'right' }}>
              {String(x.count)}
            </Txt>
          </View>
        ))}
      </Card>
    </View>
  );
}
```
In `apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx`:
- add `import { RegistrationsBreakdown } from './breakdown';` after the `./api` import;
- replace:
```tsx
        <Loading />
      )}
    </Screen>
```
with:
```tsx
        <Loading />
      )}
      <RegistrationsBreakdown c={c} />
    </Screen>
```
In `apps/mobile-rn/test/screens/organizer.test.tsx` (lot A tests), make the shared backend answer the registrations, so its dashboards stay without an error line; replace:
```tsx
const organizerBackend = (c: object) => new FakeBackend().on('GET', '/competitions/c9', [200, c]).on('GET', '/competitions/c9/dashboard', [200, figures]);
```
with:
```tsx
const organizerBackend = (c: object) => new FakeBackend().on('GET', '/competitions/c9', [200, c]).on('GET', '/competitions/c9/dashboard', [200, figures]).on('GET', '/competitions/c9/registrations', [200, []]);
```

- [ ] **Step 4: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-dashboard-b.test.tsx test/screens/organizer.test.tsx && npx tsc --noEmit`
Expected: PASS, no type error.

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/breakdown.tsx apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx apps/mobile-rn/test/screens/organizer.test.tsx apps/mobile-rn/test/screens/organizer-dashboard-b.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer dashboard: registrations per category, women / men and per day

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: WODs — a version per category and a release date

**Files:**
- Modify: `apps/mobile-rn/src/features/competitions/organizer/logic.ts` (`WodDraft`, `wodDraft`, `wodValid`, `wodBody`)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/wods.tsx` (`WodsTab`, `WodForm`)
- Modify: `apps/mobile-rn/test/core/organizer-logic.test.ts` (lot A expectation + new cases)
- Test: `apps/mobile-rn/test/screens/organizer-wods-b.test.tsx`

**Interfaces:**
- Consumes: lot A `WodsTab`, `WodForm`, `wodDraft(w, defaults)`, `wodValid`, `wodBody`; server `variants` / `releaseAt` rules (Global Constraints); fixtures `orgBackend`, `event`.
- Produces: `WodVariant = { categoryId: string; description: string; standards: string; capMin: string }`; `WodDraft` gains `variants: WodVariant[]` and `releaseAt: Date | null`; `wodBody` always sends `variants` (an empty list clears them) and sends `releaseAt` only when set.

- [ ] **Step 1: Write the failing tests**

In `apps/mobile-rn/test/core/organizer-logic.test.ts`, in the lot A test « needs movements worth points for reps per movement », add `variants: [],` to the object of `expect(wodBody(ok)).toEqual({ … })` (after `videoUrl: '',`). Then append at the end of the file:
```ts
describe('WOD versions per category and release date', () => {
  const defaults = { number: 1, start: new Date('2026-12-12T08:00:00Z'), end: new Date('2026-12-13T18:00:00Z') };
  const w = {
    id: 'w1', number: 1, name: 'WOD 1', description: 'AMRAP 12', standards: null, scoreType: 'REPS', scoringMethod: 'DIRECT_POINTS', maximumPoints: 100, minimumPoints: 0, placementTable: [], timeCapS: null, videoUrl: null, movements: [],
    submissionStart: '2026-12-12T08:00:00.000Z', submissionDeadline: '2026-12-13T18:00:00.000Z', releaseAt: '2026-12-11T18:00:00.000Z',
    variants: [{ id: 'v1', workoutId: 'w1', categoryId: 'k2', description: 'AMRAP 12, lighter', standards: null, timeCapS: 600 }],
  };

  it('reads the versions and the release date of a WOD', () => {
    const d = wodDraft(w, defaults);
    expect(d.variants).toEqual([{ categoryId: 'k2', description: 'AMRAP 12, lighter', standards: '', capMin: '10' }]);
    expect(d.releaseAt?.toISOString()).toBe('2026-12-11T18:00:00.000Z');
    expect(wodDraft(null, defaults)).toMatchObject({ variants: [], releaseAt: null });
  });

  it('a version needs its description, and a time cap of at least a minute', () => {
    const d = wodDraft(w, defaults);
    expect(wodValid(d)).toBe(true);
    expect(wodValid({ ...d, variants: [{ ...d.variants[0], description: ' ' }] })).toBe(false);
    expect(wodValid({ ...d, variants: [{ ...d.variants[0], capMin: '0,5' }] })).toBe(false);
  });

  it('sends every version (an empty list clears them) and the release date only when there is one', () => {
    const d = wodDraft(w, defaults);
    expect(wodBody(d)).toMatchObject({ variants: [{ categoryId: 'k2', description: 'AMRAP 12, lighter', timeCapS: 600 }], releaseAt: '2026-12-11T18:00:00.000Z' });
    const plain = wodBody({ ...d, variants: [], releaseAt: null });
    expect(plain.variants).toEqual([]);
    expect(plain).not.toHaveProperty('releaseAt');
  });
});
```
`apps/mobile-rn/test/screens/organizer-wods-b.test.tsx`:
```tsx
import { fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

const w1 = {
  id: 'w1', number: 1, name: 'WOD 1', description: 'AMRAP 12', standards: null, scoreType: 'REPS', scoringMethod: 'DIRECT_POINTS', maximumPoints: 100, minimumPoints: 0, placementTable: [], timeCapS: null, videoUrl: null, movements: [],
  submissionStart: '2026-12-12T08:00:00.000Z', submissionDeadline: '2026-12-13T18:00:00.000Z', releaseAt: null, variants: [],
};
const open = () => <ManageScreen id="c9" initialTab="wods" />;
const sent = (backend: ReturnType<typeof orgBackend>) => backend.calls('PUT', '/competitions/c9/wods/w1')[0].body;

describe('organizer space: WOD versions and release', () => {
  it('adds a version for a category, prefilled from the WOD, and saves it', async () => {
    const backend = orgBackend({ ...event, workouts: [w1] }).on('PUT', '/competitions/c9/wods/w1', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('wod-w1'));
    await fireEvent.press(screen.getByTestId('wod-variant-add-k2'));
    expect(screen.getByTestId('wod-variant-desc-k2').props.value).toBe('AMRAP 12');
    await fireEvent.changeText(screen.getByTestId('wod-variant-desc-k2'), 'AMRAP 12, 6 kg wall balls');
    await fireEvent.changeText(screen.getByTestId('wod-variant-cap-k2'), '12');
    await fireEvent.press(screen.getByTestId('wod-save'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/wods/w1')).toHaveLength(1));
    expect(sent(backend).variants).toEqual([{ categoryId: 'k2', description: 'AMRAP 12, 6 kg wall balls', timeCapS: 720 }]);
    expect(sent(backend)).not.toHaveProperty('releaseAt');
  });

  it('removes a version: the WOD is sent without any', async () => {
    const backend = orgBackend({ ...event, workouts: [{ ...w1, variants: [{ id: 'v1', categoryId: 'k2', description: 'Scaled', standards: null, timeCapS: null }] }] }).on('PUT', '/competitions/c9/wods/w1', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('wod-w1'));
    await fireEvent.press(screen.getByLabelText('Remove this version'));
    await fireEvent.press(screen.getByTestId('wod-save'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/wods/w1')).toHaveLength(1));
    expect(sent(backend).variants).toEqual([]);
  });

  it('« Show it now » sends the current time as the release date', async () => {
    const backend = orgBackend({ ...event, workouts: [{ ...w1, releaseAt: '2026-12-20T08:00:00.000Z' }] }).on('PUT', '/competitions/c9/wods/w1', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('wod-w1'));
    const before = Date.now();
    await fireEvent.press(screen.getByTestId('wod-release-now'));
    await fireEvent.press(screen.getByTestId('wod-save'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/wods/w1')).toHaveLength(1));
    const at = Date.parse(sent(backend).releaseAt);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/core/organizer-logic.test.ts test/screens/organizer-wods-b.test.tsx`
Expected: FAIL — `wodBody` has no `variants`, `wodDraft` has no `variants` / `releaseAt`, `wod-variant-add-k2` is not found.

- [ ] **Step 3: Extend the WOD rules**

In `apps/mobile-rn/src/features/competitions/organizer/logic.ts`:
- before `export type WodDraft = {`, add:
```ts
/** A category's own version of a WOD (server `variants`): description, standards and time cap. */
export type WodVariant = { categoryId: string; description: string; standards: string; capMin: string };
```
- in `WodDraft`, after `end: Date;`, add:
```ts
  variants: WodVariant[];
  releaseAt: Date | null;
```
- in `wodDraft`, in the object returned for a new WOD (`if (!w) { return { … } }`), add `variants: [], releaseAt: null` after `end: defaults.end`; in the object returned for an existing WOD, after `end: new Date(w.submissionDeadline ?? defaults.end),`, add:
```ts
    variants: (w.variants ?? []).map((v: Json) => ({ categoryId: v.categoryId, description: v.description ?? '', standards: v.standards ?? '', capMin: v.timeCapS ? String(v.timeCapS / 60) : '' })),
    releaseAt: w.releaseAt ? new Date(w.releaseAt) : null,
```
- in `wodValid`, before the final `return true;`, add:
```ts
  if (d.variants.some((v) => !v.description.trim() || v.description.trim().length > 5000 || (v.capMin.trim() && !(num(v.capMin) >= 1)))) return false;
```
- in `wodBody`, after `submissionDeadline: d.end.toISOString(),`, add:
```ts
    // Sent every time: the server replaces the WOD's versions with this list (an empty one clears them).
    variants: d.variants.map((v) => ({
      categoryId: v.categoryId,
      description: v.description.trim(),
      ...(v.standards.trim() ? { standards: v.standards.trim() } : {}),
      ...(v.capMin.trim() ? { timeCapS: Math.round(num(v.capMin) * 60) } : {}),
    })),
    // The server keeps a release date it is not sent; it cannot be cleared, only moved (« Show it now »).
    ...(d.releaseAt ? { releaseAt: d.releaseAt.toISOString() } : {}),
```

- [ ] **Step 4: Add the versions and the release date to the WOD form**

In `apps/mobile-rn/src/features/competitions/organizer/wods.tsx`:
- in `WodsTab`, replace `if (edit) return <WodForm draft={edit} ` with `if (edit) return <WodForm draft={edit} categories={c.categories ?? []} ` (the rest of the line unchanged);
- replace the `WodForm` signature line with:
```tsx
function WodForm({ draft, categories, busy, error, labels, onSave, onDelete, onCancel }: { draft: WodDraft; categories: Json[]; busy: boolean; error: unknown; labels: Record<string, string>; onSave: (d: WodDraft) => void; onDelete: (d: WodDraft) => void; onCancel: () => void }) {
```
- after the line `const setMove = …;` add:
```tsx
  const setVariant = (i: number, k: 'description' | 'standards' | 'capMin', v: string) => setD({ ...d, variants: d.variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const withoutVersion = categories.filter((k) => !d.variants.some((v) => v.categoryId === k.id));
```
- after `<DateField mode="datetime" label={t('orgSubmissionEnd')} value={d.end} onChange={(v) => setD({ ...d, end: v })} />`, insert:
```tsx
        <SectionHeader title={t('orgVariants')} />
        <Txt variant="small" color={colors.outline}>
          {t('orgVariantsHint')}
        </Txt>
        {d.variants.map((v, i) => (
          <Card key={v.categoryId} testID={`wod-variant-${v.categoryId}`} style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Txt variant="title">{categories.find((k) => k.id === v.categoryId)?.name ?? '—'}</Txt>
              <IconButton icon="close" label={t('orgVariantRemove')} onPress={() => setD({ ...d, variants: d.variants.filter((_, j) => j !== i) })} />
            </View>
            <TextField testID={`wod-variant-desc-${v.categoryId}`} label={t('orgWodDescription')} value={v.description} onChangeText={(x) => setVariant(i, 'description', x)} maxLength={5000} multiline />
            <TextField testID={`wod-variant-standards-${v.categoryId}`} label={t('orgStandards')} value={v.standards} onChangeText={(x) => setVariant(i, 'standards', x)} maxLength={5000} multiline />
            <TextField testID={`wod-variant-cap-${v.categoryId}`} label={t('orgTimeCap')} value={v.capMin} onChangeText={(x) => setVariant(i, 'capMin', x)} keyboardType="decimal-pad" />
          </Card>
        ))}
        {withoutVersion.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {withoutVersion.map((k) => (
              <Chip key={k.id} testID={`wod-variant-add-${k.id}`} icon="add" label={k.name} onPress={() => setD({ ...d, variants: [...d.variants, { categoryId: k.id, description: d.description, standards: d.standards, capMin: d.capMin }] })} />
            ))}
          </View>
        ) : null}
        <SectionHeader title={t('orgRelease')} />
        <DateField testID="wod-release" mode="datetime" label={t('orgReleaseAt')} value={d.releaseAt} placeholder={t('orgReleaseNow')} onChange={(releaseAt) => setD({ ...d, releaseAt })} />
        {d.releaseAt ? <Button testID="wod-release-now" kind="text" icon="visibility" label={t('orgReleaseNowButton')} onPress={() => setD({ ...d, releaseAt: new Date() })} /> : null}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/core/organizer-logic.test.ts test/screens/organizer-wods-b.test.tsx test/screens/organizer.test.tsx && npx tsc --noEmit`
Expected: PASS, no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/logic.ts apps/mobile-rn/src/features/competitions/organizer/wods.tsx apps/mobile-rn/test/core/organizer-logic.test.ts apps/mobile-rn/test/screens/organizer-wods-b.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer WODs: a version per category and a release date

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Offline demo, visual check, docs

**Files:**
- Modify: `apps/mobile-rn/assets/demo/api.json` (lot B answers for the demo draft)
- Test: `apps/mobile-rn/test/core/demo.test.ts`
- Modify: `README.md`, `handoff.md`
- Create (not committed): `<scratchpad>/organizer-shots-b.cjs`; output in `Desktop/organizer-space-lot-b/`

**Interfaces:**
- Consumes: the demo draft of lot A, id `01a10804-0000-7000-8000-00000000d001`, its category `01a10804-0000-7000-8000-00000000d101`; the demo backend answers a `GET` with the recorded answer of the same path (query ignored when no exact match); `GET /me` of the demo.
- Produces: demo answers for `registrations`, `heats`, `staff`, `coupons`, `announcements`, `leaderboard` of the demo draft.

- [ ] **Step 1: Write the failing demo test**

Append to `apps/mobile-rn/test/core/demo.test.ts`, inside its `describe`:
```ts
  it('answers the organizer lists of the demo draft', async () => {
    const id = '01a10804-0000-7000-8000-00000000d001';
    for (const path of ['registrations', 'heats', 'staff', 'coupons', 'announcements']) {
      const rows = await api().get<unknown[]>(`/competitions/${id}/${path}`);
      expect(Array.isArray(rows) && rows.length > 0).toBe(true);
    }
    expect(await api().get(`/competitions/${id}/leaderboard`, { categoryId: '01a10804-0000-7000-8000-00000000d101' })).toMatchObject({ provisional: true, rows: [] });
  });
```

- [ ] **Step 2: Run it to see it fail**

Run (in `apps/mobile-rn`): `npx jest test/core/demo.test.ts`
Expected: FAIL — the demo has no recorded answer for these paths.

- [ ] **Step 3: Add the demo answers**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league/apps/mobile-rn && node -e '
const fs = require("fs");
const p = "assets/demo/api.json";
const raw = fs.readFileSync(p, "utf8");
const d = JSON.parse(raw);
const id = "01a10804-0000-7000-8000-00000000d001";
const cat = "01a10804-0000-7000-8000-00000000d101";
const me = d["GET /me"] ?? { id: "demo-athlete", username: "ahmed_rx", profile: { fullName: "Ahmed Ben Salah" } };
const people = [["Sami Ben Ali", "sami_rx", "CONFIRMED", "PAID"], ["Hédi Kéfi", "hedi", "CONFIRMED", "PAID"], ["Karim Mansour", "karim", "CONFIRMED", "FREE"], ["Yassine Gharbi", "yassine", "PENDING", "PENDING"], ["Omar Zid", "omar", "PENDING", "PENDING"], ["Walid Ayari", "walid", "CANCELLED", "PENDING"]];
const regs = people.map(([fullName, username, registrationStatus, paymentStatus], i) => ({ id: `01a10804-0000-7000-8000-00000000d2${String(i).padStart(2, "0")}`, competitionId: id, categoryId: cat, userId: `01a10804-0000-7000-8000-00000000d3${String(i).padStart(2, "0")}`, registrationStatus, paymentStatus, originalPrice: 40000, discount: 0, finalPrice: paymentStatus === "FREE" ? 0 : 40000, currency: "TND", registeredAt: `2026-10-${String(20 + i).padStart(2, "0")}T09:00:00.000Z`, category: { name: "RX Male Division 18-35" }, user: { username, profile: { fullName } } }));
const lane = (n, r) => ({ lane: n, registrationId: r.id, athlete: { id: r.userId, fullName: r.user.profile.fullName, username: r.user.username }, mine: false });
d[`GET /competitions/${id}/registrations`] = regs;
d[`GET /competitions/${id}/heats`] = [
  { id: "01a10804-0000-7000-8000-00000000d401", number: 1, name: "RX Male · Heat 1", startsAt: "2026-12-12T09:00:00.000Z", durationMin: 12, laneCount: 4, workout: null, category: { id: cat, name: "RX Male Division 18-35" }, lanes: [lane(1, regs[0]), lane(2, regs[1])] },
  { id: "01a10804-0000-7000-8000-00000000d402", number: 2, name: "RX Male · Heat 2", startsAt: "2026-12-12T09:30:00.000Z", durationMin: 12, laneCount: 4, workout: null, category: { id: cat, name: "RX Male Division 18-35" }, lanes: [lane(1, regs[2])] },
];
d[`GET /competitions/${id}/staff`] = [{ id: "01a10804-0000-7000-8000-00000000d501", competitionId: id, userId: me.id, role: "ORGANIZER", createdAt: "2026-10-14T10:00:00.000Z", assignments: [], user: { username: me.username ?? "ahmed_rx", profile: { fullName: me.profile?.fullName ?? me.fullName ?? "Ahmed Ben Salah" } } }];
d[`GET /competitions/${id}/coupons`] = [
  { id: "01a10804-0000-7000-8000-00000000d601", competitionId: id, categoryId: null, code: "EARLY", type: "PERCENTAGE", value: 20, maxUses: 50, usedCount: 12, expiresAt: "2026-11-01T22:00:00.000Z", minimumAmount: null, active: true, createdAt: "2026-10-14T10:00:00.000Z" },
  { id: "01a10804-0000-7000-8000-00000000d602", competitionId: id, categoryId: cat, code: "COACH", type: "FREE", value: 0, maxUses: 5, usedCount: 1, expiresAt: null, minimumAmount: null, active: true, createdAt: "2026-10-14T10:00:00.000Z" },
];
d[`GET /competitions/${id}/announcements`] = [{ id: "01a10804-0000-7000-8000-00000000d701", competitionId: id, title: "Parking", body: "Use the north gate of Bodynade on both days.", createdById: me.id, createdAt: "2026-10-14T10:00:00.000Z" }];
d[`GET /competitions/${id}/leaderboard`] = { status: "DRAFT", provisional: true, maximumPoints: 0, workouts: [], rows: [], podium: null, prizes: [] };
const indent = /\n( +)"/.exec(raw)?.[1].length ?? 0;
fs.writeFileSync(p, JSON.stringify(d, null, indent || undefined) + (raw.endsWith("\n") ? "\n" : ""));
console.log("demo lot B added");'
```
Expected: « demo lot B added », and `git diff --stat assets/demo/api.json` shows a small change (if the whole file changes, its original layout was different: restore with `git show HEAD:apps/mobile-rn/assets/demo/api.json > assets/demo/api.json` and match its layout in the `JSON.stringify` call).

- [ ] **Step 4: Run every app check**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes (lot A's 20 suites / 129 tests plus the lot B ones), no type error. Do not run `npx expo lint`.

- [ ] **Step 5: Visual check in the offline demo**

Start the web preview in demo mode in the background: `cd apps/mobile-rn && EXPO_PUBLIC_DEMO=true CI=1 npx expo start --web --port 8081` and wait for `curl -s -o /dev/null -w "%{http_code}" --retry 90 --retry-connrefused --retry-delay 2 http://localhost:8081` to print 200. Browser: the cached `playwright-core` (`~/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`) and `chrome-headless-shell` (`~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`); if the shell does not start (`libnspr4.so` missing), `apt-get download libnspr4 libnss3 libasound2t64` and `dpkg -x` each into `<scratchpad>/libs`, then run with `LD_LIBRARY_PATH=<scratchpad>/libs/usr/lib/x86_64-linux-gnu`.

`<scratchpad>/organizer-shots-b.cjs`:
```js
// Usage: node organizer-shots-b.cjs <playwright-core dir> <chrome-headless-shell> <output dir>
const [pwDir, chrome, out] = process.argv.slice(2);
const { chromium } = require(pwDir);
require('node:fs').mkdirSync(out, { recursive: true });

const DRAFT = '01a10804-0000-7000-8000-00000000d001';

/** Home or Profile holds the entry; hidden copies exist, so try the visible matches from the last. */
async function openCompetitions(page, label) {
  for (const tab of [null, 'Profil', 'الملف الشخصي', 'Profile']) {
    if (tab) await page.getByText(tab, { exact: true }).last().click().catch(() => {});
    await page.waitForTimeout(800);
    const items = page.getByText(label, { exact: true });
    for (let i = (await items.count()) - 1; i >= 0; i--) {
      const it = items.nth(i);
      if (!(await it.isVisible())) continue;
      await it.scrollIntoViewIfNeeded().catch(() => {});
      await it.click().catch(() => {});
      await page.waitForTimeout(1200);
      if (await page.getByTestId('comp-create').isVisible().catch(() => false)) return;
    }
  }
  throw new Error('competitions page not reached');
}

(async () => {
  const browser = await chromium.launch({ executablePath: chrome });
  for (const lang of ['fr', 'ar']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: lang });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // The first bundle can take more than 30 s.
    await page.goto('http://localhost:8081', { waitUntil: 'load', timeout: 300000 });
    await page.getByTestId('login-email').waitFor({ timeout: 300000 });
    await page.getByTestId('login-email').fill('ahmed_rx@demo.fitnessleague.test');
    await page.getByTestId('login-password').fill('demo-password-2026');
    await page.getByTestId('login-submit').click();
    await page.waitForTimeout(3000);
    await openCompetitions(page, lang === 'ar' ? 'المسابقات' : 'Compétitions');
    await page.getByTestId('comp-mine').click();
    await page.waitForTimeout(1500);
    await page.getByTestId(`comp-${DRAFT}`).click();
    await page.waitForTimeout(2000);
    const overflow = {};
    for (const tab of ['dashboard', 'wods', 'planning', 'participants', 'team', 'leaderboard', 'announcements', 'coupons']) {
      await page.getByTestId(`org-tab-${tab}`).scrollIntoViewIfNeeded().catch(() => {});
      await page.getByTestId(`org-tab-${tab}`).click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/${lang}-${tab}.png`, fullPage: true });
      overflow[tab] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    }
    console.log(lang, 'horizontal overflow:', JSON.stringify(overflow), 'page errors:', errors.length ? errors : 'none');
    await page.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```
Run: `node <scratchpad>/organizer-shots-b.cjs <playwright-core dir> <chrome-headless-shell> /mnt/c/Users/GIGABYTE/Desktop/organizer-space-lot-b`
Expected: 16 PNG files, every overflow 0, `page errors: none`. Open the French and Arabic planning, participants, team and coupons screenshots with the Read tool and check: nothing cut, the timetable card and the lanes count readable, the CSV and « Mark paid » buttons visible. On the web preview the rows are not mirrored in Arabic (the app skips `forceRTL` on web on purpose; phones mirror). Fix what is wrong, re-run. Stop the preview afterwards (kill the PID listening on 8081).

- [ ] **Step 6: Docs**

`README.md`, in the « What exists today » table, replace the row that starts with `| Organizer space (2026-10-14):` with:
```markdown
| Organizer space (2026-10-14): any app user creates an event as a draft (Compétitions → « Créer un événement »), prepares it in the app (dashboard with the publication checklist and the registrations per category, women / men and per day; general info and banner; categories; WODs with a version per category and a release date) and asks for publication; an admin publishes it or sends it back with a note (admin panel → Compétitions). Then the organizer runs it from the app: planning (heats, lanes, automatic heats, clock of the day, « Retard » that moves the heats not started and posts an announcement), participants (search, « À encaisser », mark paid with a receipt to share, CSV), team (co-organizers; judges stay in the admin panel), leaderboard (read only: the head judge publishes it from the admin panel), announcements (shown on the event page, no notification) and promo codes (one or a batch, top 5, activate) | Lots A and B done, tested |
```
`handoff.md` (restore the committed bytes first: `git show HEAD:handoff.md > handoff.md`, then edit):
- §1 Goal: under the « Organizer space in the app » bullet, add that lot B was asked on 2026-10-14 (« oui j'accepte, continue avec le lot B »; the owner accepted the 4th backend change of lot A) and the three rulings of this plan's Global Constraints (leaderboard read only, CSV through the share sheet, release date not clearable).
- §2 Current state: a new « Update » bullet at the top: branch `feat/organizer-space-lot-b` (from `feat/organizer-space` `da155c1`), the checks of Step 4, the screenshots folder `Desktop/organizer-space-lot-b/`, push state.
- §3 Active files: the lot B files (`organizer/logic-b.ts`, `planning.tsx`, `timetable.tsx`, `participants.tsx`, `team.tsx`, `leaderboard.tsx`, `announcements.tsx`, `coupons.tsx`, `breakdown.tsx`, the changes to `api.ts`, `logic.ts`, `wods.tsx`, `dashboard.tsx`, `manage.tsx`, `screens.tsx`, `core/widgets/error.tsx`, the demo answers, the test files and `test/organizer-fixtures.ts`).
- §4 Changes made: the lot B commits.
- §6 Next steps: open the PR of lot B after lot A's; the « sur place » phase (check-in, waiver, lane scoring by judges, online payment, notifications for announcements and delays, competition logo) needs backend; an organizer who should publish the leaderboard needs a server change (today head judge or admin only); the CSV as a real file needs `expo-sharing` + `expo-file-system` (a new dependency, owner's call).

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/assets/demo/api.json apps/mobile-rn/test/core/demo.test.ts README.md handoff.md
git diff --cached --stat
git commit -m "feat(mobile): organizer lot B in the offline demo; docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

