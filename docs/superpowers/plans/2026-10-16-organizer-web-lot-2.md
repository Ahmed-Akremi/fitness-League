# Organizer Space on a Computer — Lot Web 2 and the Circle21 Look — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a computer browser the organizer space looks and works like the Circle21 back-office: dense flat cards, a compact top bar, a restyled left menu, a section header row on every page, a richer overview, a Finances page, a participants table with a light side panel and batch payment, and a separate « Horaire du jour ». We keep our own brand, and the phone render does not change.

**Architecture:** Same route, same `ManageScreen`, same tab state. `useWideWeb()` stays the only switch. A `ThemeScope` context (core theme) lets the computer shell turn on a dense look for the shared widgets (`Card`, `Button`, `TextField`, `Select`…) and lets the side panel force the light palette. Phones never set it, so their render is unchanged. New desktop pieces live in `core/widgets/{web,table,panel}.tsx` and `chart.tsx`. New pages are `organizer/{overview,finances,participants-web,schedule}.tsx`. Their pure rules are in `organizer/logic-web.ts`. Finances and Horaire du jour are computer-only `ManageTab`s. When the window gets narrow they show the nearest phone tab (`phoneTab`).

**Tech Stack:** Expo / React Native + react-native-web 0.21 (its `Modal` closes on Esc, traps focus and gives it back), react-native-svg (already a dependency, used by `chart.tsx`), Expo Router, React Query; Jest + `expo-router/testing-library`, `FakeBackend` (`test/fake-api.ts`), `renderScreen` (`test/harness.tsx`), fixtures `test/organizer-fixtures.ts`.

**Spec:** `docs/prompts/circle21-style-upgrade/PROMPT.md` (the owner's decisions, §1–§6, the reference table), `docs/superpowers/specs/2026-10-15-organizer-dashboard-circle21-analysis.md` (§3 items 7, 8, 9, 10), the frames in `docs/prompts/circle21-style-upgrade/ref/`. Earlier conventions: `docs/superpowers/plans/2026-10-15-organizer-web-lot-1.md`.

## Global Constraints

- Branch `feat/organizer-space`. Stage files **by name**. Never use `git commit -a` / `git add -A`: these files show as modified only by line endings or a build cache: `.gitignore`, `apps/admin/tsconfig.tsbuildinfo`, `apps/mobile-rn/package-lock.json`, `infra/docker-compose.yml`, `infra/mariadb/init/01-accounts.sql`, three Rust plan/spec docs. `docs/prompts/` and `.archify/` are untracked and stay so. Check `git diff --cached --stat` before each commit. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Frontend only.** Change nothing under `apps/api`, `apps/backend` or `apps/admin`, and add no new endpoint. Anything the analysis marks **B** stays out (clubs, countries, Stripe fees, waivers, chat, live overlays, ticketing, shop, forms…).
- **Computer layout only**, i.e. `useWideWeb()` is true (browser and window ≥ 1024 px). Phones and narrow windows keep the chips and today's screens, pixel for pixel. Every new page or panel is reachable only from the computer layout, or is shared code that leaves the phone render unchanged.
- **Approach A:** the grouped **left menu** stays where it is. Circle21's top tab bar is not adopted. The menu is restyled, not moved.
- **No new packages.** No `expo-sharing` / `expo-file-system`. Charts are made from `View`s or react-native-svg, which `chart.tsx` already uses. Do not run `npx expo lint`: there is no ESLint config, and it installs a package and edits `package.json`. The app's lint is `npx tsc --noEmit`. Do not touch `android/` or `ios/`.
- **Local only:** nothing is pushed or published.
- **Texts:** every string goes in `src/core/i18n/{en,fr,ar}.json` with the same keys and placeholders in all three, and Task 1 adds all of them. French uses « tu ». Counts use the app's ICU plurals (`{n, plural, =0{…} =1{…} other{…}}`; Arabic also uses `=2`, `few`, `many`). On the web the layout is not mirrored in Arabic; phones mirror it.
- **Dense tokens (computer only)**, `webDense` in `core/theme`: card radius **10**, field / button radius **6**, control height **32**, card padding **16**, grid gap **12**, section title **13 / 700 / UPPERCASE / letter-spacing 0.5**, card title **14 / 700**, caption **12** in `colors.outline`, KPI value **`displayText(36)`**, table header label **12** in `colors.outline`. Phones keep `radius = { card: 20, field: 14 }`.
- **Colours:** `palettes.dark` / `palettes.light` are unchanged. Use `colors.primary` (our accent) wherever Circle21 uses orange (the active menu item, focus, progress), and `colors.success` for "on". Keep our name, `config.accent`, Barlow Condensed / Inter and our texts. No Circle21 images, logo or name in the app.
- **Tests:** put two taps inside one `await act(async () => { … })`. `FakeBackend` cannot answer 204, so stub `DELETE` routes with `[200, {}]`. Restore a file with `git show HEAD:<path> > <path>` (a hook blocks `git checkout --`). The computer layout is chosen in screen tests through `test/wide-web.ts` (Task 5), which also lets a test narrow the window. **After each task:** `cd apps/mobile-rn && npx jest --maxWorkers=2 && npx tsc --noEmit`, then one commit in the repo's style (`feat(mobile): …`).

## Review Focus

1. **A batch payment interrupted halfway.** A co-organizer settles one registration meanwhile (409). It counts as « déjà réglée » and the rest go on. A network error stops the batch: the summary says how many are left, and those stay selected so « Marquer payé (n) » retries only them. → Task 1 tests « one settled meanwhile (409)… » and « any other error stops the batch… »; Task 9 test « an error stops the batch; the ones left stay selected for a retry ».
2. **Two quick clicks on « Marquer payé (n) » or its confirmation** → one batch, one request per registration. → Task 9 test « two quick clicks start one batch ».
3. **The side panel after a payment.** The panel is open, then the payment is recorded (here, or by someone else: 409). It must show the new state from the reloaded list, never a stale copy, and must not offer « Marquer payé » again. → Task 9 tests « « Mark paid » from the panel… shows the new state » and « paid elsewhere meanwhile… ».
4. **The window narrows below 1024 px on a computer-only page** (laptop undocked, window snapped). Finances shows the dashboard and Horaire du jour shows Heats, never a blank page; widening brings the page back. → Task 8 test « a narrow window shows the dashboard instead of Finances… »; Task 10 test « a narrow window shows Heats… ».
5. **The event-day boundary for Horaire du jour.** Cases: the evening before, a heat running past midnight, and the last heat of a day still running while the next day has heats. The page opens on the running heat's day. When nothing runs, it opens on the day « Retard » would move. → Task 1 tests « nothing running: the day « Delay » would move… » and « a heat running past midnight keeps its day… »; Task 10 test « the list follows the day « Delay » would move ».

---

### Task 1: Rules, texts and demo data

**Files:**
- Modify: `apps/mobile-rn/src/features/competitions/organizer/logic.ts` (`ManageTab` gets `finances` and `timetable`)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/logic-b.ts` (export `units`, `standing`; add `HeatState`, `heatState`, `heatEnd`)
- Create: `apps/mobile-rn/src/features/competitions/organizer/logic-web.ts`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/web.ts` (`WIDE_TABS`, `PHONE_FALLBACK`, `phoneTab`, `MENU_ICON`, `Go`)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/manage.tsx` (labels of the two new tabs, the phone fallback)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/web-shell.tsx` (labels of the two new tabs)
- Modify: `apps/mobile-rn/src/core/i18n/en.json`, `fr.json`, `ar.json`
- Modify: `apps/mobile-rn/assets/demo/api.json` (demo draft: dashboard figures that match its registrations, two discounts, one judge)
- Modify: `apps/mobile-rn/test/core/demo.test.ts:59` (the demo draft now has 3 confirmed athletes)
- Test: `apps/mobile-rn/test/core/organizer-web2.test.ts`

**Interfaces:**
- Consumes: lot B `fold`, `personName`, `localDay`, `toCsv`, `timetable`, `delayTargets`, `heatDays`, `Distribution`, the private `startOf` / `endOf` (`logic-b.ts`); `ApiError` (`core/api/errors`); lot 1 `ORG_MENU`, `contentWidth`, `WIDE_WIDTH` (`web.ts`).
- Produces:
  - `logic.ts`: `ManageTab` = lot A's ten tabs + `'finances' | 'timetable'`.
  - `logic-b.ts`: `units(amount, currency): string`, `standing(r: Json): boolean`, `type HeatState = 'done' | 'running' | 'upcoming'`, `heatState(h: Json, now: number): HeatState`, `heatEnd(h: Json): string`.
  - `logic-web.ts`: `percentages(values: number[]): number[]`, `judgeCount(staff: Json[]): number`, `topCategories(byCategory, n = 5)`, `fillDays(perDay)`, `type Finance = { gross; discounts; collected; toCollect; free; refunded; rows: Json[] }`, `finance(rows: Json[]): Finance`, `type TxFilter = 'ALL' | 'PAID' | 'PENDING' | 'FREE' | 'REFUNDED'`, `filterTransactions(rows, { q, payment })`, `transactionsCsv(rows, sep = ',')`, `type PayBatch = { paid: string[]; already: string[]; error: unknown; left: string[] }`, `markPaidBatch(ids, post): Promise<PayBatch>`, `athleteHeats(heats, registrationId): { heat: Json; lane: number }[]`, `scheduleDay(heats, now): string | null`, `daySchedule(heats, day, now): { heat: Json; state: HeatState }[]`, `dayEnd(heats): string | null`.
  - `web.ts`: `PHONE_FALLBACK`, `phoneTab(tab: ManageTab): ManageTab`, `MENU_ICON: Record<ManageTab, IconName>`, `type Go = (tab: ManageTab, focus?: { categoryId: string }) => void`; `contentWidth('finances' | 'timetable') === WIDE_WIDTH`.
  - Every new key (listed in Step 6).

- [ ] **Step 1: Write the failing unit tests**

`apps/mobile-rn/test/core/organizer-web2.test.ts`:
```ts
import { ApiError } from '../../src/core/api/errors';
import { delayTargets, localDay } from '../../src/features/competitions/organizer/logic-b';
import { athleteHeats, dayEnd, daySchedule, fillDays, filterTransactions, finance, judgeCount, markPaidBatch, percentages, scheduleDay, topCategories, transactionsCsv } from '../../src/features/competitions/organizer/logic-web';
import { contentWidth, MENU_ICON, ORG_MENU, phoneTab, WIDE_WIDTH } from '../../src/features/competitions/organizer/web';
import { regs } from '../organizer-fixtures';

/** A registration with the price details the API sends (`originalPrice`, `discount`). */
const priced = (r: object, originalPrice: number, discount: number) => ({ ...r, originalPrice, discount });

describe('overview rules', () => {
  it('percentages are whole and add up to 100; nothing at all stays at 0', () => {
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentages([2, 1, 0])).toEqual([67, 33, 0]);
    expect(percentages([1, 2])).toEqual([33, 67]);
    expect(percentages([0, 0, 0])).toEqual([0, 0, 0]);
    for (const v of [[3, 3, 1], [7, 0, 2], [1, 1, 1, 1, 1, 1, 1]]) expect(percentages(v).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('judges are the judges and head judges of the staff', () => {
    expect(judgeCount([{ role: 'ORGANIZER' }, { role: 'JUDGE' }, { role: 'HEAD_JUDGE' }, { role: 'JUDGE' }])).toBe(3);
  });

  it('the busiest categories first, five at most', () => {
    const by = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, name: id, count: [2, 9, 4, 1, 7, 3][i] }));
    expect(topCategories(by).map((k) => k.id)).toEqual(['b', 'e', 'c', 'f', 'a']);
  });

  it('the days without a registration are on the axis at 0', () => {
    expect(fillDays([{ day: '2026-10-19', count: 1 }, { day: '2026-10-22', count: 2 }])).toEqual([
      { day: '2026-10-19', count: 1 },
      { day: '2026-10-20', count: 0 },
      { day: '2026-10-21', count: 0 },
      { day: '2026-10-22', count: 2 },
    ]);
    expect(fillDays([])).toEqual([]);
    expect(fillDays([{ day: '2026-10-31', count: 1 }, { day: '2026-11-01', count: 1 }]).map((d) => d.day)).toEqual(['2026-10-31', '2026-11-01']);
  });
});

describe('finances', () => {
  const rows = [
    priced(regs[0], 40000, 0), // r1: to collect
    priced(regs[1], 40000, 5000), // r2: paid 35 000 after a code
    priced(regs[2], 40000, 40000), // r3: free with a 100 % code
    priced(regs[3], 35000, 0), // r4: to collect
    priced(regs[4], 40000, 0), // r5: cancelled, never paid: not a transaction
    { ...priced(regs[1], 30000, 0), id: 'r6', paymentStatus: 'REFUNDED', registrationStatus: 'REFUNDED', finalPrice: 30000, registeredAt: '2026-10-23T09:00:00.000Z' },
  ];

  it('gross − discounts = the amounts = collected + to collect + refunded', () => {
    const f = finance(rows);
    expect(f).toMatchObject({ gross: 185000, discounts: 45000, collected: 35000, toCollect: 75000, free: 1, refunded: 30000 });
    expect(f.rows.map((r) => r.id)).toEqual(['r6', 'r3', 'r1', 'r2', 'r4']);
    const amounts = f.rows.reduce((s, r) => s + r.finalPrice, 0);
    expect(amounts).toBe(f.gross - f.discounts);
    expect(amounts).toBe(f.collected + f.toCollect + f.refunded);
  });

  it('an answer without the price details counts the amount as the price', () => {
    expect(finance(regs)).toMatchObject({ gross: 110000, discounts: 0, collected: 35000, toCollect: 75000, free: 1, refunded: 0 });
  });

  it('search ignores accents; the payment filter keeps one status', () => {
    const f = finance(rows);
    expect(filterTransactions(f.rows, { q: 'kefi', payment: 'ALL' }).map((r) => r.id)).toEqual(['r3']);
    expect(filterTransactions(f.rows, { q: '', payment: 'PENDING' }).map((r) => r.id)).toEqual(['r1', 'r4']);
    expect(filterTransactions(f.rows, { q: '', payment: 'REFUNDED' }).map((r) => r.id)).toEqual(['r6']);
  });

  it('the transactions export, amounts in currency units', () => {
    expect(transactionsCsv([rows[1]]).split('\n')).toEqual([
      'registered_at,name,username,category,price,discount,amount,currency,payment',
      '2026-10-20T09:00:00.000Z,Amira Trabelsi,amira,RX Women,40.000,5.000,35.000,TND,PAID',
    ]);
  });
});

describe('mark paid in a batch', () => {
  it('one request at a time; one settled meanwhile (409) is « already settled » and the rest go on', async () => {
    const seen: string[] = [];
    const r = await markPaidBatch(['a', 'b', 'c'], async (id) => {
      seen.push(id);
      if (id === 'b') throw new ApiError('client', 409, 'CONFLICT');
    });
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(r).toEqual({ paid: ['a', 'c'], already: ['b'], error: null, left: [] });
  });

  it('any other error stops the batch and keeps the ones left, the failed one first', async () => {
    const down = new ApiError('server', 500);
    const r = await markPaidBatch(['a', 'b', 'c'], async (id) => {
      if (id === 'b') throw down;
    });
    expect(r).toEqual({ paid: ['a'], already: [], error: down, left: ['b', 'c'] });
  });

  it('waits for each answer before sending the next', async () => {
    let open = 0;
    let most = 0;
    await markPaidBatch(['a', 'b', 'c'], async () => {
      open++;
      most = Math.max(most, open);
      await Promise.resolve();
      open--;
    });
    expect(most).toBe(1);
  });
});

describe('heats of an athlete and the day schedule', () => {
  const heat = (id: string, startsAt: string | null, lanes: object[] = [], durationMin = 12) => ({ id, name: `Heat ${id}`, startsAt, durationMin, laneCount: 4, lanes });
  // Local times: the day rules use the device's time zone.
  const at = (d: number, h: number, m = 0) => new Date(2026, 11, d, h, m).toISOString();
  const t = (d: number, h: number, m = 0) => new Date(2026, 11, d, h, m).getTime();
  const day12 = [heat('a', at(12, 9)), heat('b', at(12, 10)), heat('c', at(12, 11))];
  const day13 = [heat('d', at(13, 9)), heat('e', at(13, 10))];

  it('the heats an athlete is in, with the lane, in running order', () => {
    const hs = [heat('b', at(12, 10), [{ lane: 3, registrationId: 'r2' }]), heat('n', null, [{ lane: 1, registrationId: 'r2' }]), heat('a', at(12, 9), [{ lane: 2, registrationId: 'r2' }, { lane: 1, registrationId: 'r1' }])];
    expect(athleteHeats(hs, 'r2').map((x) => [x.heat.id, x.lane])).toEqual([['a', 2], ['b', 3], ['n', 1]]);
    expect(athleteHeats(hs, 'r9')).toEqual([]);
  });

  it('opens on the day of the heat running now', () => {
    expect(scheduleDay([...day12, ...day13], t(12, 10, 5))).toBe('2026-12-12');
  });

  it('nothing running: the day « Delay » would move, even the evening before', () => {
    const all = [...day12, ...day13];
    expect(scheduleDay(all, t(11, 20))).toBe('2026-12-12');
    expect(scheduleDay(all, t(12, 20))).toBe('2026-12-13');
    expect(scheduleDay(all, t(12, 20))).toBe(localDay(delayTargets(all, t(12, 20))[0].startsAt));
  });

  it('a heat running past midnight keeps its day; after the last heat, the last day; no timed heat, no day', () => {
    expect(scheduleDay([heat('x', at(12, 23, 50), [], 30), ...day13], t(13, 0, 10))).toBe('2026-12-12');
    expect(scheduleDay(day12, t(14, 9))).toBe('2026-12-12');
    expect(scheduleDay([heat('n', null)], t(12, 9))).toBeNull();
  });

  it('the day in running order, each heat done, running or upcoming, and when the day ends', () => {
    const list = daySchedule([...day13, ...day12, heat('n', null)], '2026-12-12', t(12, 10, 5));
    expect(list.map((x) => [x.heat.id, x.state])).toEqual([['a', 'done'], ['b', 'running'], ['c', 'upcoming']]);
    expect(dayEnd(list.map((x) => x.heat))).toBe(new Date(t(12, 11, 12)).toISOString());
    expect(dayEnd([])).toBeNull();
  });
});

describe('computer-only pages', () => {
  it('Finances and the time table fall back to the nearest phone tab', () => {
    expect(phoneTab('finances')).toBe('dashboard');
    expect(phoneTab('timetable')).toBe('planning');
    expect(phoneTab('team')).toBe('team');
  });

  it('they use the wide column; every menu page has an icon', () => {
    expect(contentWidth('finances')).toBe(WIDE_WIDTH);
    expect(contentWidth('timetable')).toBe(WIDE_WIDTH);
    for (const tab of ORG_MENU.flatMap((s) => s.tabs)) expect(MENU_ICON[tab]).toBeTruthy();
    expect(MENU_ICON.finances).toBe('payments');
    expect(MENU_ICON.timetable).toBe('schedule');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/core/organizer-web2.test.ts`
Expected: FAIL with `Cannot find module '../../src/features/competitions/organizer/logic-web'`.

- [ ] **Step 3: Extend the shared rules**

In `apps/mobile-rn/src/features/competitions/organizer/logic.ts`, replace:
```ts
export type ManageTab = 'dashboard' | 'general' | 'categories' | 'wods' | 'planning' | 'participants' | 'team' | 'leaderboard' | 'announcements' | 'coupons';
```
with:
```ts
/** `finances` and `timetable` exist only on a computer (lot Web 2); a phone shows `phoneTab(tab)` instead (`web.ts`). */
export type ManageTab = 'dashboard' | 'finances' | 'general' | 'categories' | 'wods' | 'planning' | 'timetable' | 'participants' | 'team' | 'leaderboard' | 'announcements' | 'coupons';
```

In `apps/mobile-rn/src/features/competitions/organizer/logic-b.ts`:
- Replace `/** « À encaisser »: payment pending, registration neither cancelled nor refunded, oldest first. */` and the `toCollect` function under it with:
```ts
/** A registration still standing: neither cancelled nor refunded. */
export const standing = (r: Json) => r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED';

/** « À encaisser »: payment pending, registration still standing, oldest first. */
export function toCollect(rows: Json[]): Json[] {
  return rows.filter((r) => r.paymentStatus === 'PENDING' && standing(r)).sort((a, b) => Date.parse(a.registeredAt) - Date.parse(b.registeredAt));
}
```
- Replace `const units = (amount: unknown, currency: string) => {` with `export const units = (amount: unknown, currency: string) => {`.
- Right after the `timetable` function, add:
```ts
export type HeatState = 'done' | 'running' | 'upcoming';

/** Where a heat stands at `now`, by the rule of `timetable`: ended, running, or not started. */
export const heatState = (h: Json, now: number): HeatState => (endOf(h) <= now ? 'done' : startOf(h) <= now ? 'running' : 'upcoming');

/** End of a timed heat, ISO (a heat without a duration ends when it starts). */
export const heatEnd = (h: Json) => new Date(endOf(h)).toISOString();
```

- [ ] **Step 4: Write the lot Web 2 rules**

`apps/mobile-rn/src/features/competitions/organizer/logic-web.ts`:
```ts
import type { Json } from '../../../core/api/client';
import { ApiError } from '../../../core/api/errors';
import { delayTargets, fold, heatDays, heatEnd, heatState, localDay, personName, standing, timetable, toCsv, units, type Distribution, type HeatState } from './logic-b';

/** Organizer space on a computer, lot Web 2 (analysis 2026-10-15 §3 items 7–10): the rules its pages share. */

// ───────────── Overview ─────────────

/** Whole percentages that add up to 100 (largest remainder first, then the first one); nothing at all stays at 0. */
export function percentages(values: number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v * 100) / total);
  const out = exact.map((x) => Math.floor(x));
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

/** Judges of the event: the judges and head judges of the staff list. */
export const judgeCount = (staff: Json[]) => staff.filter((s) => s.role === 'JUDGE' || s.role === 'HEAD_JUDGE').length;

/** The `n` categories with the most registrations still standing. */
export const topCategories = (byCategory: Distribution['byCategory'], n = 5) => [...byCategory].sort((a, b) => b.count - a.count).slice(0, n);

/** Every day from the first registration to the last, the days without one at 0, so the chart's axis has no holes. */
export function fillDays(perDay: Distribution['perDay']): Distribution['perDay'] {
  if (perDay.length === 0) return [];
  const counts = new Map(perDay.map((d) => [d.day, d.count]));
  const last = perDay[perDay.length - 1].day;
  const out: Distribution['perDay'] = [];
  // Local noon, one day at a time: a change of clock time never skips or repeats a day.
  const d = new Date(`${perDay[0].day}T12:00:00`);
  for (let i = 0; i < 400; i++) {
    const day = localDay(d.toISOString());
    out.push({ day, count: counts.get(day) ?? 0 });
    if (day >= last) break;
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// ───────────── Finances ─────────────

export type Finance = { gross: number; discounts: number; collected: number; toCollect: number; free: number; refunded: number; rows: Json[] };

const priceOf = (r: Json) => Number(r.originalPrice ?? r.finalPrice ?? 0);
const discountOf = (r: Json) => Number(r.discount ?? 0);
const amountOf = (r: Json) => Number(r.finalPrice ?? 0);

/**
 * The money of the event, from the registrations (payments are recorded by hand, no online fees). The transactions
 * are the paid, free and refunded registrations and the payments still to collect; a cancelled registration that
 * never paid is not one. Amounts in millimes / cents; newest first.
 */
export function finance(rows: Json[]): Finance {
  const tx = rows
    .filter((r) => r.paymentStatus === 'PAID' || r.paymentStatus === 'FREE' || r.paymentStatus === 'REFUNDED' || (r.paymentStatus === 'PENDING' && standing(r)))
    .sort((a, b) => Date.parse(b.registeredAt) - Date.parse(a.registeredAt));
  const sum = (list: Json[], f: (r: Json) => number) => list.reduce((s, r) => s + f(r), 0);
  const withStatus = (status: string) => tx.filter((r) => r.paymentStatus === status);
  return {
    gross: sum(tx, priceOf),
    discounts: sum(tx, discountOf),
    collected: sum(withStatus('PAID'), amountOf),
    toCollect: sum(withStatus('PENDING'), amountOf),
    free: withStatus('FREE').length,
    refunded: sum(withStatus('REFUNDED'), amountOf),
    rows: tx,
  };
}

export type TxFilter = 'ALL' | 'PAID' | 'PENDING' | 'FREE' | 'REFUNDED';

export function filterTransactions(rows: Json[], f: { q: string; payment: TxFilter }): Json[] {
  const q = fold(f.q.trim());
  return rows.filter((r) => (f.payment === 'ALL' || r.paymentStatus === f.payment) && (!q || fold(`${personName(r)} ${r.user?.username ?? ''}`).includes(q)));
}

export function transactionsCsv(rows: Json[], sep = ','): string {
  return toCsv(
    ['registered_at', 'name', 'username', 'category', 'price', 'discount', 'amount', 'currency', 'payment'],
    rows.map((r) => [r.registeredAt, personName(r), r.user?.username ?? '', r.category?.name ?? '', units(priceOf(r), r.currency), units(discountOf(r), r.currency), units(amountOf(r), r.currency), r.currency, r.paymentStatus]),
    sep,
  );
}

// ───────────── Participants ─────────────

export type PayBatch = { paid: string[]; already: string[]; error: unknown; left: string[] };

/**
 * « Marquer payé » for several registrations, one request at a time. One settled meanwhile (409) is counted
 * « déjà réglée » and the rest go on; any other error stops the batch, and `left` keeps the ones not done, the failed one first.
 */
export async function markPaidBatch(ids: string[], post: (id: string) => Promise<unknown>): Promise<PayBatch> {
  const r: PayBatch = { paid: [], already: [], error: null, left: [] };
  for (let i = 0; i < ids.length; i++) {
    try {
      await post(ids[i]);
      r.paid.push(ids[i]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        r.already.push(ids[i]);
      } else {
        r.error = e;
        r.left = ids.slice(i);
        break;
      }
    }
  }
  return r;
}

/** The heats an athlete is placed in, with the lane, in running order (heats without a time last). */
export function athleteHeats(heats: Json[], registrationId: string): { heat: Json; lane: number }[] {
  const out: { heat: Json; lane: number }[] = [];
  for (const h of heats) for (const l of h.lanes ?? []) if (l.registrationId === registrationId) out.push({ heat: h, lane: l.lane });
  const start = (h: Json) => (h.startsAt ? Date.parse(h.startsAt) : Infinity);
  return out.sort((a, b) => start(a.heat) - start(b.heat));
}

// ───────────── Time table ─────────────

/** The day « Horaire du jour » opens on: the day of the heat running now; else the day « Retard » would move; else the last day with heats; null without a timed heat. */
export function scheduleDay(heats: Json[], now: number): string | null {
  const running = timetable(heats, now).current;
  if (running) return localDay(running.startsAt);
  const next = delayTargets(heats, now)[0];
  if (next) return localDay(next.startsAt);
  const days = heatDays(heats);
  return days.length ? days[days.length - 1] : null;
}

/** The timed heats of one day, in running order, each with its state at `now`. */
export function daySchedule(heats: Json[], day: string, now: number): { heat: Json; state: HeatState }[] {
  return heats
    .filter((h) => h.startsAt && localDay(h.startsAt) === day)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .map((heat) => ({ heat, state: heatState(heat, now) }));
}

/** When the program ends: the latest end of the timed heats given. */
export function dayEnd(heats: Json[]): string | null {
  const ends = heats.filter((h) => h.startsAt).map(heatEnd).sort();
  return ends.length ? ends[ends.length - 1] : null;
}
```

- [ ] **Step 5: Computer-only pages in the layout rules**

In `apps/mobile-rn/src/features/competitions/organizer/web.ts`:
- Add `import type { IconName } from '../../../core/widgets/kit';` under the `Json` import.
- Replace `const WIDE_TABS: ManageTab[] = ['dashboard', 'participants', 'planning', 'leaderboard'];` with `const WIDE_TABS: ManageTab[] = ['dashboard', 'finances', 'participants', 'planning', 'timetable', 'leaderboard'];`
- At the end of the file, add:
```ts
/** Pages that exist only on a computer (lot Web 2); a window that gets narrow shows the nearest phone tab instead, and the page comes back when it widens. */
export const PHONE_FALLBACK: Partial<Record<ManageTab, ManageTab>> = { finances: 'dashboard', timetable: 'planning' };
export const phoneTab = (tab: ManageTab): ManageTab => PHONE_FALLBACK[tab] ?? tab;

/** One icon per page in the computer menu, like Circle21's sub-navigation. */
export const MENU_ICON: Record<ManageTab, IconName> = {
  dashboard: 'bar-chart',
  finances: 'payments',
  general: 'info-outline',
  categories: 'category',
  coupons: 'local-offer',
  team: 'groups',
  participants: 'group',
  wods: 'fitness-center',
  planning: 'local-fire-department',
  timetable: 'schedule',
  leaderboard: 'emoji-events',
  announcements: 'campaign',
};

/** Opens a page; the overview can open Participants already filtered on one category. */
export type Go = (tab: ManageTab, focus?: { categoryId: string }) => void;
```

In `apps/mobile-rn/src/features/competitions/organizer/manage.tsx`:
- Replace `import { useWideWeb } from './web';` with `import { phoneTab, useWideWeb } from './web';`
- In `labels`, add `finances: t('orgMenuFinances'), timetable: t('orgMenuTimetable'),` after `dashboard: t('orgTabDashboard'),`.
- Under `if (!(c.myRoles ?? []).includes('ORGANIZER')) return …;`, add:
```ts
  // Finances and the time table exist only on a computer: a narrow window shows the nearest phone tab, and the page comes back when it widens.
  const shown = wide ? tab : phoneTab(tab);
```
- In `page`, replace every `tab === '` with `shown === '`; in the chips, replace `selected={tab === k}` with `selected={shown === k}`.

In `apps/mobile-rn/src/features/competitions/organizer/web-shell.tsx`, in the `label` record of `OrgMenu`, add `finances: t('orgMenuFinances'),` after `dashboard: t('orgTabDashboard'),` and `timetable: t('orgMenuTimetable'),` after `planning: t('orgMenuHeats'),`.

- [ ] **Step 6: Add every new text**

Save as `<scratchpad>/org-web2-i18n.json`:
```json
{
  "en": {
    "orgMenuOverview": "Overview",
    "orgMenuFinances": "Finances",
    "orgMenuTimetable": "Time table",
    "orgBackToEvent": "Back to the event page",
    "orgUnpublished": "Not published yet",
    "orgMoreActions": "More actions",
    "orgMoreChecklist": "Publication checklist",
    "orgMoreEdit": "Edit the event details",
    "orgMoreExport": "Export the participants (CSV)",
    "orgKpiParticipantsHint": "Confirmed registrations",
    "orgKpiPaidHint": "Marked paid",
    "orgKpiToCollectHint": "Payment still pending",
    "orgKpiToday": "Today, {date}",
    "orgKpiJudgesHint": "Judges and head judges",
    "orgKpiToJudgeHint": "Waiting for a judge",
    "orgKpiApprovedHint": "Approved by the judges",
    "orgKpiRejectedHint": "Refused by the judges",
    "orgRegsCount": "{count, plural, =0{No registrations} =1{1 registration} other{{count} registrations}}",
    "orgSeeAll": "See all",
    "orgScores": "Scores",
    "orgGender": "Gender",
    "orgGenderHint": "Women, men and mixed",
    "orgWomen": "Women",
    "orgMen": "Men",
    "orgMixed": "Mixed",
    "orgShowAs": "Show as:",
    "orgShowPercent": "Percentages (%)",
    "orgShowNumbers": "Numbers",
    "orgNoData": "No data yet",
    "orgFinGross": "Gross",
    "orgFinGrossHint": "Registration prices before discounts",
    "orgFinDiscounts": "Discounts (codes)",
    "orgFinDiscountsHint": "Taken off by promo codes",
    "orgFinCollected": "Collected",
    "orgFinCollectedHint": "Marked paid by the organizers",
    "orgFinManual": "Manual payment, no online fees",
    "orgFinFree": "Free",
    "orgFinFreeHint": "Registrations with nothing to pay",
    "orgFinRefunded": "Refunded",
    "orgFinRefundedHint": "Given back to the athletes",
    "orgFinTransactions": "Transactions",
    "orgFinSearch": "Search a name",
    "orgFinNone": "No payment",
    "orgColDate": "Date",
    "orgColName": "Name",
    "orgColCategory": "Category",
    "orgColPrice": "Price",
    "orgColDiscount": "Discount",
    "orgColAmount": "Amount",
    "orgColPayment": "Payment",
    "orgRowActions": "Actions for {name}",
    "orgOpenDetails": "Open the details",
    "orgSelectRow": "Select {name}",
    "orgSelectAll": "Select all",
    "orgMarkPaidBatch": "Mark paid ({count})",
    "orgMarkPaidBatchConfirm": "{count, plural, =1{Mark 1 registration as paid?} other{Mark {count} registrations as paid?}}",
    "orgBatchSummary": "{paid, plural, =0{None marked paid} =1{1 marked paid} other{{paid} marked paid}} · {already, plural, =0{none already settled} =1{1 already settled} other{{already} already settled}}",
    "orgBatchLeft": "{count, plural, =1{1 registration left: try again.} other{{count} registrations left: try again.}}",
    "orgDetailHeats": "Heats and lanes",
    "orgDetailNoHeat": "Not in a heat yet",
    "orgReceiptButton": "Receipt",
    "orgScheduleEnds": "Program ends at {time}",
    "orgCurrentHeat": "Current heat",
    "orgNoActiveHeat": "No active heat",
    "orgHeatsProgress": "{done} of {total} heats done · {left, plural, =0{none left} other{{left} left}}",
    "orgHeatStateDone": "Done",
    "orgHeatStateRunning": "Running",
    "orgHeatStateUpcoming": "Upcoming",
    "orgNeedHeat": "No heat has a start time yet. Plan the heats first.",
    "orgGoHeats": "Go to heats",
    "orgDay": "Day"
  },
  "fr": {
    "orgMenuOverview": "Vue d'ensemble",
    "orgMenuFinances": "Finances",
    "orgMenuTimetable": "Horaire du jour",
    "orgBackToEvent": "Retour à la page de l'événement",
    "orgUnpublished": "Pas encore publié",
    "orgMoreActions": "Plus d'actions",
    "orgMoreChecklist": "Check-list de publication",
    "orgMoreEdit": "Modifier les infos de l'événement",
    "orgMoreExport": "Exporter les participants (CSV)",
    "orgKpiParticipantsHint": "Inscriptions confirmées",
    "orgKpiPaidHint": "Marquées payées",
    "orgKpiToCollectHint": "Paiement encore en attente",
    "orgKpiToday": "Aujourd'hui, {date}",
    "orgKpiJudgesHint": "Juges et juges principaux",
    "orgKpiToJudgeHint": "En attente d'un juge",
    "orgKpiApprovedHint": "Validés par les juges",
    "orgKpiRejectedHint": "Refusés par les juges",
    "orgRegsCount": "{count, plural, =0{Aucune inscription} =1{1 inscription} other{{count} inscriptions}}",
    "orgSeeAll": "Voir tout",
    "orgScores": "Scores",
    "orgGender": "Genre",
    "orgGenderHint": "Femmes, hommes et mixtes",
    "orgWomen": "Femmes",
    "orgMen": "Hommes",
    "orgMixed": "Mixtes",
    "orgShowAs": "Afficher en :",
    "orgShowPercent": "Pourcentages (%)",
    "orgShowNumbers": "Nombres",
    "orgNoData": "Aucune donnée pour l'instant",
    "orgFinGross": "Brut",
    "orgFinGrossHint": "Prix des inscriptions avant remises",
    "orgFinDiscounts": "Remises (codes)",
    "orgFinDiscountsHint": "Retiré par les codes promo",
    "orgFinCollected": "Encaissé",
    "orgFinCollectedHint": "Marqué payé par les organisateurs",
    "orgFinManual": "Paiement manuel, pas de frais en ligne",
    "orgFinFree": "Gratuits",
    "orgFinFreeHint": "Inscriptions sans rien à payer",
    "orgFinRefunded": "Remboursé",
    "orgFinRefundedHint": "Rendu aux athlètes",
    "orgFinTransactions": "Transactions",
    "orgFinSearch": "Chercher un nom",
    "orgFinNone": "Aucun paiement",
    "orgColDate": "Date",
    "orgColName": "Nom",
    "orgColCategory": "Catégorie",
    "orgColPrice": "Prix",
    "orgColDiscount": "Remise",
    "orgColAmount": "Montant",
    "orgColPayment": "Paiement",
    "orgRowActions": "Actions pour {name}",
    "orgOpenDetails": "Ouvrir la fiche",
    "orgSelectRow": "Sélectionner {name}",
    "orgSelectAll": "Tout sélectionner",
    "orgMarkPaidBatch": "Marquer payé ({count})",
    "orgMarkPaidBatchConfirm": "{count, plural, =1{Marquer 1 inscription comme payée ?} other{Marquer {count} inscriptions comme payées ?}}",
    "orgBatchSummary": "{paid, plural, =0{Aucune payée} =1{1 payée} other{{paid} payées}} · {already, plural, =0{aucune déjà réglée} =1{1 déjà réglée} other{{already} déjà réglées}}",
    "orgBatchLeft": "{count, plural, =1{Il reste 1 inscription : réessaie.} other{Il reste {count} inscriptions : réessaie.}}",
    "orgDetailHeats": "Heats et couloirs",
    "orgDetailNoHeat": "Pas encore dans un heat",
    "orgReceiptButton": "Reçu",
    "orgScheduleEnds": "Fin du programme à {time}",
    "orgCurrentHeat": "Heat en cours",
    "orgNoActiveHeat": "Aucun heat actif",
    "orgHeatsProgress": "{done} sur {total} heats terminés · {left, plural, =0{aucun restant} =1{1 restant} other{{left} restants}}",
    "orgHeatStateDone": "Terminé",
    "orgHeatStateRunning": "En cours",
    "orgHeatStateUpcoming": "À venir",
    "orgNeedHeat": "Aucun heat n'a encore d'heure de départ. Planifie d'abord les heats.",
    "orgGoHeats": "Aller aux heats",
    "orgDay": "Jour"
  },
  "ar": {
    "orgMenuOverview": "نظرة عامة",
    "orgMenuFinances": "المالية",
    "orgMenuTimetable": "برنامج اليوم",
    "orgBackToEvent": "العودة إلى صفحة الحدث",
    "orgUnpublished": "لم يُنشر بعد",
    "orgMoreActions": "إجراءات أخرى",
    "orgMoreChecklist": "قائمة التحقق قبل النشر",
    "orgMoreEdit": "تعديل معلومات الحدث",
    "orgMoreExport": "تصدير المشاركين (CSV)",
    "orgKpiParticipantsHint": "تسجيلات مؤكدة",
    "orgKpiPaidHint": "مُعلَّمة كمدفوعة",
    "orgKpiToCollectHint": "الدفع لا يزال معلقًا",
    "orgKpiToday": "اليوم، {date}",
    "orgKpiJudgesHint": "الحكام وكبار الحكام",
    "orgKpiToJudgeHint": "في انتظار حَكَم",
    "orgKpiApprovedHint": "معتمدة من الحكام",
    "orgKpiRejectedHint": "مرفوضة من الحكام",
    "orgRegsCount": "{count, plural, =0{لا توجد تسجيلات} =1{تسجيل واحد} =2{تسجيلان} few{{count} تسجيلات} many{{count} تسجيلًا} other{{count} تسجيل}}",
    "orgSeeAll": "عرض الكل",
    "orgScores": "النتائج",
    "orgGender": "الجنس",
    "orgGenderHint": "نساء، رجال ومختلط",
    "orgWomen": "نساء",
    "orgMen": "رجال",
    "orgMixed": "مختلط",
    "orgShowAs": "العرض بـ:",
    "orgShowPercent": "نسب مئوية (%)",
    "orgShowNumbers": "أعداد",
    "orgNoData": "لا توجد بيانات بعد",
    "orgFinGross": "الإجمالي",
    "orgFinGrossHint": "أسعار التسجيل قبل الخصومات",
    "orgFinDiscounts": "الخصومات (الرموز)",
    "orgFinDiscountsHint": "مخصومة برموز الخصم",
    "orgFinCollected": "المحصَّل",
    "orgFinCollectedHint": "مُعلَّم كمدفوع من المنظمين",
    "orgFinManual": "دفع يدوي، بلا رسوم دفع إلكتروني",
    "orgFinFree": "مجانية",
    "orgFinFreeHint": "تسجيلات بلا مبلغ للدفع",
    "orgFinRefunded": "المسترجَع",
    "orgFinRefundedHint": "أُعيد إلى الرياضيين",
    "orgFinTransactions": "المعاملات",
    "orgFinSearch": "ابحث عن اسم",
    "orgFinNone": "لا توجد مدفوعات",
    "orgColDate": "التاريخ",
    "orgColName": "الاسم",
    "orgColCategory": "الفئة",
    "orgColPrice": "السعر",
    "orgColDiscount": "الخصم",
    "orgColAmount": "المبلغ",
    "orgColPayment": "الدفع",
    "orgRowActions": "إجراءات لـ {name}",
    "orgOpenDetails": "فتح البطاقة",
    "orgSelectRow": "تحديد {name}",
    "orgSelectAll": "تحديد الكل",
    "orgMarkPaidBatch": "تعليم كمدفوع ({count})",
    "orgMarkPaidBatchConfirm": "{count, plural, =1{تعليم تسجيل واحد كمدفوع؟} =2{تعليم تسجيلين كمدفوعين؟} few{تعليم {count} تسجيلات كمدفوعة؟} many{تعليم {count} تسجيلًا كمدفوعًا؟} other{تعليم {count} تسجيل كمدفوع؟}}",
    "orgBatchSummary": "{paid, plural, =0{لم يُعلَّم أي تسجيل كمدفوع} =1{تسجيل واحد مدفوع} =2{تسجيلان مدفوعان} few{{paid} تسجيلات مدفوعة} many{{paid} تسجيلًا مدفوعًا} other{{paid} تسجيل مدفوع}} · {already, plural, =0{لا شيء مسدَّد مسبقًا} =1{واحد مسدَّد مسبقًا} other{{already} مسدَّدة مسبقًا}}",
    "orgBatchLeft": "{count, plural, =1{بقي تسجيل واحد: أعد المحاولة.} =2{بقي تسجيلان: أعد المحاولة.} few{بقيت {count} تسجيلات: أعد المحاولة.} many{بقي {count} تسجيلًا: أعد المحاولة.} other{بقي {count} تسجيل: أعد المحاولة.}}",
    "orgDetailHeats": "الدفعات والممرات",
    "orgDetailNoHeat": "ليس في أي دفعة بعد",
    "orgReceiptButton": "الإيصال",
    "orgScheduleEnds": "ينتهي البرنامج على الساعة {time}",
    "orgCurrentHeat": "الدفعة الجارية",
    "orgNoActiveHeat": "لا توجد دفعة نشطة",
    "orgHeatsProgress": "انتهت {done} من {total} دفعات · {left, plural, =0{لا شيء متبقٍّ} =1{واحدة متبقية} other{{left} متبقية}}",
    "orgHeatStateDone": "انتهت",
    "orgHeatStateRunning": "جارية",
    "orgHeatStateUpcoming": "قادمة",
    "orgNeedHeat": "لا توجد دفعة بوقت بداية بعد. خطّط للدفعات أولًا.",
    "orgGoHeats": "الذهاب إلى الدفعات",
    "orgDay": "اليوم"
  }
}
```
Merge it (in `apps/mobile-rn`):
```bash
node -e '
const fs = require("fs");
const add = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const keys = Object.keys(add.en);
for (const lang of ["en", "fr", "ar"]) {
  if (Object.keys(add[lang]).join() !== keys.join()) throw new Error(`${lang}: not the same keys as en`);
  const p = `src/core/i18n/${lang}.json`;
  const cur = JSON.parse(fs.readFileSync(p, "utf8"));
  const clash = keys.filter((k) => k in cur);
  if (clash.length) throw new Error(`${lang}: keys already exist: ${clash.join(", ")}`);
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...add[lang] }, null, 2) + "\n");
}
console.log("ok", keys.length);' <scratchpad>/org-web2-i18n.json
```
Expected: `ok 72`, and `git diff --stat src/core/i18n` shows 72 added keys per file.

- [ ] **Step 7: Make the demo draft add up**

The offline demo's draft (`01a10804-…d001`) says 0 participants on its dashboard while it has six registrations. Lot B left this on purpose: the demo's create-flow test expects a fresh draft at 0 (handoff §2, 2026-10-15). Its free registration also has no discount, so gross − discounts would not equal the amounts. On the computer, the overview puts the dashboard figures next to charts drawn from those six registrations, so the 0 would show as a contradiction. This plan aligns the figures and updates that one assertion. **Owner's call:** if the create flow must keep showing 0, skip the `dashboard` part of the script below and keep line 59 of `demo.test.ts`; Finances and the screenshots only need the discounts and the judge. Fix the data the screenshots and the Finances acceptance rely on (in `apps/mobile-rn`):
```bash
node -e '
const fs = require("fs");
const p = "assets/demo/api.json";
const d = JSON.parse(fs.readFileSync(p, "utf8"));
const base = "GET /competitions/01a10804-0000-7000-8000-00000000d001";
const regs = d[base + "/registrations"];
const by = (u) => regs.find((r) => r.user.username === u);
// karim registered with a 100 % code, omar with a 20 % code.
Object.assign(by("karim"), { originalPrice: 40000, discount: 40000, finalPrice: 0 });
Object.assign(by("omar"), { originalPrice: 40000, discount: 8000, finalPrice: 32000 });
// The server: participants = confirmed, pending = every pending payment, revenue = paid amounts.
const count = (f) => regs.filter(f).length;
Object.assign(d[base + "/dashboard"], {
  participants: count((r) => r.registrationStatus === "CONFIRMED"),
  paidRegistrations: count((r) => r.paymentStatus === "PAID"),
  freeRegistrations: count((r) => r.paymentStatus === "FREE"),
  pendingPayments: count((r) => r.paymentStatus === "PENDING"),
  revenue: regs.filter((r) => r.paymentStatus === "PAID").reduce((s, r) => s + r.finalPrice, 0),
});
const staff = d[base + "/staff"];
if (!staff.some((s) => s.role === "JUDGE"))
  staff.push({ id: "01a10804-0000-7000-8000-00000000d502", competitionId: "01a10804-0000-7000-8000-00000000d001", userId: "01a10804-0000-7000-8000-00000000d310", role: "JUDGE", createdAt: "2026-10-14T10:00:00.000Z", assignments: [], user: { username: "judge_nour", profile: { fullName: "Nour Gharbi" } } });
fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
console.log(JSON.stringify(d[base + "/dashboard"]));'
```
Expected: `{"participants":3,"paidRegistrations":2,"freeRegistrations":1,"pendingPayments":3,"revenue":80000,…}`. Check with `git diff --stat assets/demo/api.json` that only a few lines changed. If the whole file changed because of different indentation, restore it (`git show HEAD:apps/mobile-rn/assets/demo/api.json > assets/demo/api.json`), read its indentation with `head -c 300 assets/demo/api.json`, and use that indentation in `JSON.stringify(d, null, <indent>)`.

In `apps/mobile-rn/test/core/demo.test.ts`, line 59, replace `toMatchObject({ participants: 0 })` with `toMatchObject({ participants: 3 })`.

- [ ] **Step 8: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes (including `organizer-web2`, `demo`, `i18n`, `i18n-usage`), no type error.

- [ ] **Step 9: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/logic.ts apps/mobile-rn/src/features/competitions/organizer/logic-b.ts apps/mobile-rn/src/features/competitions/organizer/logic-web.ts apps/mobile-rn/src/features/competitions/organizer/web.ts apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/src/features/competitions/organizer/web-shell.tsx apps/mobile-rn/src/core/i18n/en.json apps/mobile-rn/src/core/i18n/fr.json apps/mobile-rn/src/core/i18n/ar.json apps/mobile-rn/assets/demo/api.json apps/mobile-rn/test/core/demo.test.ts apps/mobile-rn/test/core/organizer-web2.test.ts
git diff --cached --stat
git commit -m "feat(mobile): organizer web lot 2 rules: finances, batch payment, day schedule, percentages, texts, demo data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Capture the phone baseline**

Before any screen changes, take the phone screenshots that Task 11 compares against. Write `<scratchpad>/organizer-web-shots.cjs` (Task 11 Step 2), start the demo as in Task 11 Step 2, and run `node <scratchpad>/organizer-web-shots.cjs <playwright-core dir> <chrome-headless-shell> /mnt/c/Users/GIGABYTE/Desktop/organizer-web-2/phone-before phone`.
Expected: 20 PNG files (FR and AR × the 10 phone tabs), `page errors: none`. Nothing is committed.

---

### Task 2: Theme scope and the dense computer look of the shared widgets

**Files:**
- Modify: `apps/mobile-rn/src/core/theme/index.ts` (`webDense`, `ThemeScope`, `useTheme().dense`)
- Modify: `apps/mobile-rn/src/core/widgets/kit.tsx` (`Button`, `TextField`, `Card`, `Chip`, `ListRow`, `SwitchRow`, `Dialog` read `dense`)
- Modify: `apps/mobile-rn/src/core/widgets/common.tsx` (`StatCard`, `SectionHeader` read `dense`)
- Modify: `apps/mobile-rn/src/core/widgets/pickers.tsx` (`FieldButton` and `Select` read `dense`; `bare` drops the label above the field)
- Test: `apps/mobile-rn/test/core/widgets.test.tsx` (new `describe`)

**Interfaces:**
- Consumes: `palettes`, `config.accent`, `usePrefs` (`core/theme`).
- Produces: `webDense = { radius: { card: 10, field: 6 }, control: 32, pad: 16, gap: 12, sectionTitle, cardTitle, caption, kpi: 36 }`; `ThemeScope({ dense?, scheme?, children })`; `useTheme(): { dark, colors, dense }`; `Select` / `FieldButton` prop `bare?: boolean`. Outside a `ThemeScope`, every widget renders exactly as before.

- [ ] **Step 1: Write the failing widget tests**

At the top of `apps/mobile-rn/test/core/widgets.test.tsx`, replace the imports with:
```tsx
import { fireEvent } from 'expo-router/testing-library';
import { StyleSheet, Switch } from 'react-native';

import { ThemeScope, useTheme } from '../../src/core/theme';
import { SectionHeader, StatusPill } from '../../src/core/widgets/common';
import { Button, Card, Chip, ListGroup, ListRow, SwitchRow, TextField, Txt } from '../../src/core/widgets/kit';
import { Select } from '../../src/core/widgets/pickers';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';
```
and add at the end of the file:
```tsx
describe('dense look of the computer layout (ThemeScope)', () => {
  const style = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

  it('cards, buttons and chips get small radii and 32 px controls; outside the scope nothing changes', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <Card testID="phone-card">
            <Txt>a</Txt>
          </Card>
          <Button testID="phone-button" label="Go" onPress={() => {}} />
          <ThemeScope dense>
            <Card testID="dense-card">
              <Txt>b</Txt>
            </Card>
            <Button testID="dense-button" label="Go" onPress={() => {}} />
            <Chip testID="dense-chip" label="All" selected />
          </ThemeScope>
        </>
      ),
      new FakeBackend(),
    );
    expect(style(screen.getByTestId('phone-card'))).toMatchObject({ borderRadius: 20, padding: 16, borderWidth: 1 });
    expect(style(screen.getByTestId('dense-card'))).toMatchObject({ borderRadius: 10, padding: 16, borderWidth: 0 });
    expect(style(screen.getByTestId('phone-button'))).toMatchObject({ minHeight: 50, borderRadius: 999 });
    expect(style(screen.getByTestId('dense-button'))).toMatchObject({ minHeight: 32, borderRadius: 6 });
    expect(style(screen.getByTestId('dense-chip'))).toMatchObject({ borderRadius: 6 });
  });

  it('a field has 14 px text inside the scope, 16 px outside', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <TextField testID="phone-field" value="" onChangeText={() => {}} />
          <ThemeScope dense>
            <TextField testID="dense-field" value="" onChangeText={() => {}} />
          </ThemeScope>
        </>
      ),
      new FakeBackend(),
    );
    expect(style(screen.getByTestId('phone-field'))).toMatchObject({ fontSize: 16, paddingVertical: 12 });
    expect(style(screen.getByTestId('dense-field'))).toMatchObject({ fontSize: 14, paddingVertical: 7 });
  });

  it('the section title is 13 px uppercase with 0.5 letter spacing', async () => {
    const screen = await renderScreen(
      () => (
        <ThemeScope dense>
          <SectionHeader title="Promo codes" />
        </ThemeScope>
      ),
      new FakeBackend(),
    );
    expect(style(screen.getByText('Promo codes'))).toMatchObject({ fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase' });
  });

  it('`scheme` forces the light palette inside a dark page, and the scopes add up', async () => {
    function Probe() {
      const { colors, dark, dense } = useTheme();
      return <Txt testID="probe">{`${dark}-${colors.background}-${dense}`}</Txt>;
    }
    const screen = await renderScreen(
      () => (
        <>
          <Probe />
          <ThemeScope dense>
            <ThemeScope scheme="light">
              <Probe />
            </ThemeScope>
          </ThemeScope>
        </>
      ),
      new FakeBackend(),
    );
    const [page, panel] = screen.getAllByTestId('probe');
    expect(page.props.children).toBe('true-#0E0F12-false');
    expect(panel.props.children).toBe('false-#FFFFFF-true');
  });

  it('an « on » switch is green on a computer (Circle21), in the accent on a phone', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <SwitchRow title="phone" value onChange={() => {}} />
          <ThemeScope dense>
            <SwitchRow title="computer" value onChange={() => {}} />
          </ThemeScope>
        </>
      ),
      new FakeBackend(),
    );
    const [phone, computer] = screen.UNSAFE_getAllByType(Switch);
    expect(phone.props.trackColor.true).not.toBe('#3DDC84');
    expect(computer.props.trackColor.true).toBe('#3DDC84');
  });

  it('a select in a toolbar shows no label above it but keeps it for screen readers', async () => {
    const screen = await renderScreen(
      () => (
        <ThemeScope dense>
          <Select testID="pay" bare label="Payment" value="ALL" options={[{ value: 'ALL', label: 'Any payment' }]} onChange={() => {}} />
        </ThemeScope>
      ),
      new FakeBackend(),
    );
    expect(screen.queryByText('Payment')).toBeNull();
    expect(screen.getByText('Any payment')).toBeTruthy();
    expect(screen.getByTestId('pay').props.accessibilityLabel).toBe('Payment');
    expect(style(screen.getByTestId('pay'))).toMatchObject({ minHeight: 32, borderRadius: 6 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/core/widgets.test.tsx`
Expected: FAIL. `ThemeScope` is not exported from `core/theme`, so the new tests fail to compile; the three lot B tests are not run.

- [ ] **Step 3: Tokens and scope in the theme**

In `apps/mobile-rn/src/core/theme/index.ts`:
- Replace `import { useColorScheme } from 'react-native';` with:
```ts
import { createContext, createElement, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
```
- After `export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;`, add:
```ts
/** Organizer space on a computer (lot Web 2): the dense desktop look of the Circle21 back-office. Phones keep `radius` and the default sizes. */
export const webDense = {
  radius: { card: 10, field: 6 },
  /** Height of buttons, inputs and icon squares. */
  control: 32,
  pad: 16,
  gap: 12,
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  caption: { fontSize: 12 },
  kpi: 36,
} as const;

type Scope = { dense: boolean; scheme: 'light' | 'dark' | null };
const ScopeContext = createContext<Scope>({ dense: false, scheme: null });

/**
 * A part of the screen with its own look (lot Web 2): `dense` for the organizer space on a computer, `scheme` to force
 * a palette (the light side panel on a dark page). Nested scopes add up. Phones never set one.
 */
export function ThemeScope({ dense, scheme, children }: { dense?: boolean; scheme?: 'light' | 'dark'; children: ReactNode }) {
  const outer = useContext(ScopeContext);
  return createElement(ScopeContext.Provider, { value: { dense: dense ?? outer.dense, scheme: scheme ?? outer.scheme } }, children);
}
```
- Replace the `useTheme` function with:
```ts
export function useTheme(): { dark: boolean; colors: Colors; dense: boolean } {
  const mode = usePrefs((s) => s.themeMode);
  const system = useColorScheme();
  const scope = useContext(ScopeContext);
  const dark = scope.scheme ? scope.scheme === 'dark' : mode === 'system' ? system !== 'light' : mode === 'dark';
  return { dark, colors: dark ? palettes.dark(config.accent) : palettes.light(config.accent), dense: scope.dense };
}
```

- [ ] **Step 4: The widgets read `dense`**

In `apps/mobile-rn/src/core/widgets/kit.tsx`:
- Replace `import { fonts, radius, space, useTheme } from '../theme';` with `import { fonts, radius, space, useTheme, webDense } from '../theme';`.
- In `Button`, replace `const { colors } = useTheme();` with `const { colors, dense } = useTheme();`, then replace:
```tsx
        styles.button,
        { backgroundColor: bg, opacity: off && !busy ? 0.45 : pressed ? 0.8 : 1 },
        kind === 'outlined' && { borderWidth: 1, borderColor: colors.outline },
        kind === 'text' && { minHeight: 40, paddingHorizontal: 8 },
```
with:
```tsx
        styles.button,
        dense && styles.buttonDense,
        { backgroundColor: bg, opacity: off && !busy ? 0.45 : pressed ? 0.8 : 1 },
        kind === 'outlined' && { borderWidth: 1, borderColor: colors.outline },
        kind === 'text' && { minHeight: dense ? webDense.control : 40, paddingHorizontal: 8 },
```
and replace:
```tsx
          {icon && <MaterialIcons name={icon} size={18} color={fg} />}
          <Text style={{ color: fg, fontWeight: '700', fontSize: 15, letterSpacing: 0.4 }}>{label}</Text>
```
with:
```tsx
          {icon && <MaterialIcons name={icon} size={dense ? 16 : 18} color={fg} />}
          <Text style={{ color: fg, fontWeight: '700', fontSize: dense ? 13 : 15, letterSpacing: dense ? 0.2 : 0.4 }}>{label}</Text>
```
- In `TextField`, replace the body from `const { colors } = useTheme();` to the end of the `<TextInput … />` element with:
```tsx
  const { colors, dense } = useTheme();
  return (
    <View style={style}>
      {label ? <Txt variant="small" color={colors.outline} style={dense ? { marginBottom: 4, fontSize: 12 } : { marginBottom: 6 }}>{label}</Txt> : null}
      <View style={[styles.field, dense && { borderRadius: webDense.radius.field }, { backgroundColor: colors.surface, borderColor: error ? colors.error : colors.surfaceHigh }]}>
        {icon && <Icon name={icon} size={dense ? 16 : 20} color={colors.outline} />}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.outline}
          style={{ flex: 1, color: colors.text, fontSize: dense ? 14 : 16, paddingVertical: dense ? 7 : 12, textAlign: 'auto' }}
          {...props}
        />
```
(keep the closing `</View>`, the error line and the rest as they are).
- In `Card`, replace:
```tsx
  const { colors } = useTheme();
  // Hairline border: relief on the dark surface without shadows.
  const base = [{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.lg, borderWidth: 1, borderColor: colors.border }, style];
```
with:
```tsx
  const { colors, dense } = useTheme();
  // Hairline border: relief on the dark surface without shadows. On a computer: Circle21's flat card, no border.
  const base = [{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.lg, borderWidth: 1, borderColor: colors.border }, dense && { borderRadius: webDense.radius.card, padding: webDense.pad, borderWidth: 0 }, style];
```
- In `Chip`, replace `const { colors } = useTheme();` with `const { colors, dense } = useTheme();` and `style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.surfaceHigh }]}` with `style={[styles.chip, dense && { borderRadius: webDense.radius.field, paddingVertical: 6 }, { backgroundColor: selected ? colors.primary : colors.surfaceHigh }]}`.
- In `ListRow`, replace `const { colors } = useTheme();` with `const { colors, dense } = useTheme();`, `style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}` with `style={({ pressed }) => [styles.row, dense && { minHeight: 40, paddingVertical: 6 }, pressed && { opacity: 0.7 }]}`, and `style={{ fontSize: 16 }}>{title}` with `style={{ fontSize: dense ? 14 : 16 }}>{title}`.
- In `SwitchRow`, replace `const { colors } = useTheme();` with `const { colors, dense } = useTheme();` and `trackColor={{ true: colors.primary, false: colors.surfaceHigh }}` with `trackColor={{ true: dense ? colors.success : colors.primary, false: colors.surfaceHigh }}` (Circle21's green « on », computer only).
- In `Dialog`, replace `const { colors } = useTheme();` with `const { colors, dense } = useTheme();` and `<View style={{ backgroundColor: colors.surface, borderRadius: 24, padding: 20, gap: 12 }}>` with:
```tsx
        <View style={[{ backgroundColor: colors.surface, borderRadius: 24, padding: 20, gap: 12 }, dense && { width: '100%', maxWidth: 480, alignSelf: 'center', borderRadius: webDense.radius.card }]}>
```
- In `styles`, add after `button: {…},`:
```ts
  buttonDense: { minHeight: webDense.control, borderRadius: webDense.radius.field, paddingHorizontal: space.md, gap: 6 },
```

In `apps/mobile-rn/src/core/widgets/common.tsx`:
- Replace `import { displayText, fonts, radius, space, useTheme } from '../theme';` with `import { displayText, fonts, radius, space, useTheme, webDense } from '../theme';`.
- In `StatCard`, replace `const { colors } = useTheme();` with `const { colors, dense } = useTheme();` and `style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.lg, borderWidth: 1, borderColor: colors.border }}` with `style={[{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.lg, borderWidth: 1, borderColor: colors.border }, dense && { borderRadius: webDense.radius.card, borderWidth: 0 }]}`.
- In `SectionHeader`, replace `const { colors } = useTheme();` with `const { colors, dense } = useTheme();` and `style={{ flex: 1, letterSpacing: 1.4 }}` with `style={[{ flex: 1, letterSpacing: 1.4 }, dense && webDense.sectionTitle]}`.

In `apps/mobile-rn/src/core/widgets/pickers.tsx`:
- Replace `import { radius, useTheme } from '../theme';` with `import { radius, useTheme, webDense } from '../theme';`.
- Replace the whole `Select` function with:
```tsx
/** Field that opens a list (Flutter DropdownButtonFormField): full screen on a phone, a small centered box on a computer. `bare`: no label above (toolbars). */
export function Select({ label, value, options, onChange, error, testID, placeholder, bare }: { label: string; value: string | null | undefined; options: Option[]; onChange: (v: string) => void; error?: string | null; testID?: string; placeholder?: string; bare?: boolean }) {
  const { colors, dense } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const head = (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
      <Txt variant="title" style={{ flex: 1 }}>{label}</Txt>
      <Pressable accessibilityRole="button" accessibilityLabel="close" onPress={() => setOpen(false)} hitSlop={8}>
        <Icon name="close" />
      </Pressable>
    </View>
  );
  const list = (
    <FlatList
      data={options}
      keyExtractor={(o) => o.value}
      renderItem={({ item }) => (
        <Pressable
          testID={`${testID ?? 'option'}-${item.value}`}
          accessibilityRole="button"
          accessibilityState={{ selected: item.value === value }}
          onPress={() => {
            onChange(item.value);
            setOpen(false);
          }}
          style={{ paddingHorizontal: 16, paddingVertical: dense ? 10 : 14, flexDirection: 'row', alignItems: 'center' }}
        >
          <Txt style={{ flex: 1 }}>{item.label}</Txt>
          {item.value === value && <Icon name="check" color={colors.primary} />}
        </Pressable>
      )}
    />
  );
  return (
    <View>
      <FieldButton testID={testID} label={label} bare={bare} value={selected?.label ?? placeholder ?? ''} icon="arrow-drop-down" error={error} onPress={() => setOpen(true)} />
      <Modal visible={open} transparent={dense} animationType={dense ? 'fade' : 'slide'} onRequestClose={() => setOpen(false)}>
        {dense ? (
          <View style={{ flex: 1, backgroundColor: '#00000066', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <View style={{ width: '100%', maxWidth: 360, maxHeight: 480, backgroundColor: colors.surface, borderRadius: webDense.radius.card, overflow: 'hidden' }}>
              {head}
              {list}
            </View>
          </View>
        ) : (
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            {head}
            {list}
          </SafeAreaView>
        )}
      </Modal>
    </View>
  );
}
```
- Replace the whole `FieldButton` function with:
```tsx
/** Tappable read-only field (date, select). `bare`: no label above it (screen readers still read it). */
export function FieldButton({ label, value, icon, error, onPress, testID, bare }: { label: string; value: string; icon: IconName; error?: string | null; onPress: () => void; testID?: string; bare?: boolean }) {
  const { colors, dense } = useTheme();
  return (
    <View>
      {bare ? null : <Txt variant="small" color={error ? colors.error : colors.outline} style={dense ? { marginBottom: 4, fontSize: 12 } : { marginBottom: 6 }}>{label}</Txt>}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={[
          { flexDirection: 'row', alignItems: 'center', borderRadius: radius.field, borderWidth: 1, borderColor: error ? colors.error : colors.surfaceHigh, backgroundColor: colors.surface, paddingHorizontal: 12, minHeight: 48 },
          dense && { borderRadius: webDense.radius.field, minHeight: webDense.control, paddingHorizontal: 10 },
          bare && { minWidth: 150, justifyContent: 'space-between', gap: 4 },
        ]}
      >
        <Txt style={[bare ? { flexShrink: 1 } : { flex: 1 }, dense && { fontSize: 13 }]} numberOfLines={bare ? 1 : undefined} color={value ? colors.text : colors.outline}>{value}</Txt>
        <Icon name={icon} size={dense ? 18 : 22} color={colors.outline} />
      </Pressable>
      {error ? <Txt variant="small" color={colors.error} style={{ marginTop: 4 }}>{error}</Txt> : null}
    </View>
  );
}
```
On a phone (no scope, no `bare`), the field renders exactly as before: `Txt` gets `[{ flex: 1 }, false]` and no line limit, and the icon keeps its 22 px default.

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes (the phone screens render as before), no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/core/theme/index.ts apps/mobile-rn/src/core/widgets/kit.tsx apps/mobile-rn/src/core/widgets/common.tsx apps/mobile-rn/src/core/widgets/pickers.tsx apps/mobile-rn/test/core/widgets.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): dense computer look for the shared widgets (theme scope), light palette on demand

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Page pieces — header, toolbar, search, KPI card, section card, grid, ring, bars

**Files:**
- Create: `apps/mobile-rn/src/core/widgets/web.tsx`
- Modify: `apps/mobile-rn/src/core/widgets/chart.tsx` (`Ring`, `ringArcs`, `BarChart`, `axisStep`)
- Test: `apps/mobile-rn/test/core/web-widgets.test.tsx`

**Interfaces:**
- Consumes: Task 2 `webDense`, `useTheme`; `displayText`, `space` (`core/theme`); `Txt`, `IconName` (`kit.tsx`); `react-native-svg` (`Svg`, `Circle`, `G`, already used by `LineChart`).
- Produces (`web.tsx`): `PageHeader({ title, actions?, flush?, testID? })`, `Toolbar({ children })`, `SearchField({ value, onChangeText, placeholder, testID?, width? })`, `SquareButton({ icon, label, onPress?, disabled?, testID? })`, `SegmentedInline<K>({ label, options: { key: K; label }[], value: K, onChange, testID? })` (option testIDs `${testID}-${key}`), `KpiCard({ title, caption?, value, footnote?, testID? })` (value testID `${testID}-value`), `SectionCard({ title, caption?, action?, empty?, children?, testID? })` (empty text testID `${testID}-empty`), `gridColumns(width, min, counts): number`, `Grid({ min, counts, children, testID? })`.
- Produces (`chart.tsx`): `ringArcs(values, circumference): { length; offset }[]`, `Ring({ parts: { value; color }[], label, size?, thickness?, children?, testID? })`, `axisStep(n, most = 8): number`, `BarChart({ data: { key; label; value }[], label, height? })` (bar testIDs `bar-${key}`).

- [ ] **Step 1: Write the failing tests**

`apps/mobile-rn/test/core/web-widgets.test.tsx`:
```tsx
import { fireEvent } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { axisStep, BarChart, Ring, ringArcs } from '../../src/core/widgets/chart';
import { Txt } from '../../src/core/widgets/kit';
import { gridColumns, KpiCard, PageHeader, SearchField, SectionCard, SegmentedInline, SquareButton } from '../../src/core/widgets/web';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

describe('computer page pieces: rules', () => {
  it('grid: 4 / 2 / 1 KPI columns, 3 / 1 for card rows', () => {
    expect(gridColumns(1168, 180, [4, 2, 1])).toBe(4);
    expect(gridColumns(772, 180, [4, 2, 1])).toBe(4);
    expect(gridColumns(700, 180, [4, 2, 1])).toBe(2);
    expect(gridColumns(300, 180, [4, 2, 1])).toBe(1);
    expect(gridColumns(772, 240, [3, 1])).toBe(3);
    expect(gridColumns(600, 240, [3, 1])).toBe(1);
  });

  it('ring arcs follow each other around the circle; an empty ring has none', () => {
    expect(ringArcs([1, 1, 2], 100)).toEqual([{ length: 25, offset: 0 }, { length: 25, offset: 25 }, { length: 50, offset: 50 }]);
    expect(ringArcs([0, 0], 100)).toEqual([{ length: 0, offset: 0 }, { length: 0, offset: 0 }]);
  });

  it('the day axis writes one label in n when there are many days', () => {
    expect(axisStep(5)).toBe(1);
    expect(axisStep(8)).toBe(1);
    expect(axisStep(9)).toBe(2);
    expect(axisStep(40)).toBe(5);
  });
});

describe('computer page pieces: render', () => {
  it('page header: an uppercase 13 px title and the actions', async () => {
    const onPress = jest.fn();
    const screen = await renderScreen(() => <PageHeader testID="ph" title="Participants" actions={<SquareButton testID="x" icon="file-download" label="Export (CSV)" onPress={onPress} />} />, new FakeBackend());
    expect(flat(screen.getByText('Participants'))).toMatchObject({ fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 });
    expect(screen.getByTestId('x').props.accessibilityLabel).toBe('Export (CSV)');
    expect(flat(screen.getByTestId('x'))).toMatchObject({ width: 32, height: 32, borderRadius: 6 });
    fireEvent.press(screen.getByTestId('x'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a disabled square button says so and does nothing', async () => {
    const onPress = jest.fn();
    const screen = await renderScreen(() => <SquareButton testID="x" icon="file-download" label="Export (CSV)" disabled onPress={onPress} />, new FakeBackend());
    expect(screen.getByTestId('x').props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId('x'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('KPI card: title, caption, the number, a footnote', async () => {
    const screen = await renderScreen(() => <KpiCard testID="k" title="Collected" caption="Marked paid" value="35 TND" footnote="Manual payment, no online fees" />, new FakeBackend());
    expect(screen.getByTestId('k-value').props.children).toBe('35 TND');
    expect(flat(screen.getByTestId('k-value'))).toMatchObject({ fontSize: 36 });
    expect(screen.getByText('Marked paid')).toBeTruthy();
    expect(screen.getByText('Manual payment, no online fees')).toBeTruthy();
  });

  it('section card: « no data » in the middle instead of its content', async () => {
    const screen = await renderScreen(
      () => (
        <SectionCard testID="s" title="Gender" empty="No data yet">
          <Txt>hidden</Txt>
        </SectionCard>
      ),
      new FakeBackend(),
    );
    expect(screen.getByTestId('s-empty').props.children).toBe('No data yet');
    expect(screen.queryByText('hidden')).toBeNull();
  });

  it('inline switch: the chosen option is marked, a press reports the other one', async () => {
    const onChange = jest.fn();
    const screen = await renderScreen(
      () => <SegmentedInline testID="as" label="Show as:" value="percent" options={[{ key: 'percent', label: 'Percentages (%)' }, { key: 'numbers', label: 'Numbers' }]} onChange={onChange} />,
      new FakeBackend(),
    );
    expect(screen.getByTestId('as-percent').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('as-numbers').props.accessibilityState).toMatchObject({ selected: false });
    fireEvent.press(screen.getByTestId('as-numbers'));
    expect(onChange).toHaveBeenCalledWith('numbers');
  });

  it('search field: a filled 32 px box that reports what is typed', async () => {
    const onChangeText = jest.fn();
    const screen = await renderScreen(() => <SearchField testID="q" placeholder="Search a name" value="" onChangeText={onChangeText} />, new FakeBackend());
    fireEvent.changeText(screen.getByTestId('q'), 'kefi');
    expect(onChangeText).toHaveBeenCalledWith('kefi');
    expect(screen.getByTestId('q').props.accessibilityLabel).toBe('Search a name');
  });

  it('the ring says what it shows; each bar carries its value', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <Ring testID="r" label="1 of 4 heats done" parts={[{ value: 1, color: '#FFFFFF' }, { value: 3, color: 'transparent' }]}>
            <Txt>25%</Txt>
          </Ring>
          <BarChart label="Registrations per day" data={[{ key: 'd1', label: '19 Oct', value: 1 }, { key: 'd2', label: '20 Oct', value: 3 }]} />
        </>
      ),
      new FakeBackend(),
    );
    expect(screen.getByTestId('r').props.accessibilityLabel).toBe('1 of 4 heats done');
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByTestId('bar-d2').props.accessibilityLabel).toBe('20 Oct: 3');
    expect(flat(screen.getByTestId('bar-d2'))).toMatchObject({ height: '100%' });
    expect(screen.getByText('19 Oct')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/core/web-widgets.test.tsx`
Expected: FAIL with `Cannot find module '../../src/core/widgets/web'`.

- [ ] **Step 3: Write the page pieces**

`apps/mobile-rn/src/core/widgets/web.tsx`:
```tsx
import { MaterialIcons } from '@expo/vector-icons';
import { Children, Fragment, isValidElement, useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { displayText, space, useTheme, webDense } from '../theme';
import { Txt, type IconName } from './kit';

/** Organizer space on a computer (lot Web 2): the page pieces of the Circle21 back-office, in our colours and fonts. */

/** Section header row (Circle21 refs 01, 12, 20): uppercase title, the page's actions on the right, a hairline under it. `flush`: inside an already padded list. */
export function PageHeader({ title, actions, flush, testID }: { title: string; actions?: ReactNode; flush?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: webDense.gap, minHeight: 56, paddingHorizontal: flush ? 0 : space.lg, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <Txt accessibilityRole="header" style={[webDense.sectionTitle, { flexGrow: 1 }]}>
        {title}
      </Txt>
      {actions ? <Toolbar>{actions}</Toolbar> : null}
    </View>
  );
}

/** A row of filters, search and buttons that wraps when the window is narrow. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm }}>{children}</View>;
}

/** Filled search box with a magnifier (Circle21 refs 12, 19, 20). */
export function SearchField({ value, onChangeText, placeholder, testID, width = 220 }: { value: string; onChangeText: (s: string) => void; placeholder: string; testID?: string; width?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: webDense.control, width, borderRadius: webDense.radius.field, backgroundColor: colors.surfaceHigh, paddingHorizontal: 10 }}>
      <MaterialIcons name="search" size={16} color={colors.outline} />
      <TextInput
        testID={testID}
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.outline}
        autoCapitalize="none"
        style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 0, textAlign: 'auto' }}
      />
    </View>
  );
}

/** 32 px square icon button (export, refresh): the label is what screen readers say. */
export function SquareButton({ icon, label, onPress, disabled, testID }: { icon: IconName; label: string; onPress?: () => void; disabled?: boolean; testID?: string }) {
  const { colors } = useTheme();
  const off = disabled || !onPress;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({ width: webDense.control, height: webDense.control, borderRadius: webDense.radius.field, borderWidth: 1, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center', opacity: off ? 0.45 : pressed ? 0.8 : 1 })}
    >
      <MaterialIcons name={icon} size={18} color={colors.text} />
    </Pressable>
  );
}

/** « Afficher en : Pourcentages (%) | Nombres » (Circle21 ref 03): a caption and text options, the chosen one underlined. */
export function SegmentedInline<K extends string>({ label, options, value, onChange, testID }: { label: string; options: { key: K; label: string }[]; value: K; onChange: (k: K) => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
      <Txt style={webDense.caption} color={colors.outline}>
        {label}
      </Txt>
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <Fragment key={o.key}>
            {i > 0 ? (
              <Txt style={webDense.caption} color={colors.outline}>
                |
              </Txt>
            ) : null}
            <Pressable testID={testID ? `${testID}-${o.key}` : undefined} accessibilityRole="button" accessibilityState={{ selected: on }} hitSlop={6} onPress={() => onChange(o.key)}>
              <Txt style={[webDense.caption, { textDecorationLine: on ? 'underline' : 'none', fontWeight: on ? '700' : '400' }]} color={on ? colors.text : colors.outline}>
                {o.label}
              </Txt>
            </Pressable>
          </Fragment>
        );
      })}
    </View>
  );
}

/** Figure card (Circle21 refs 01, 16): title, caption, big number, an optional footnote with an info icon. */
export function KpiCard({ title, caption, value, footnote, testID }: { title: string; caption?: string; value: string; footnote?: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ backgroundColor: colors.surface, borderRadius: webDense.radius.card, padding: webDense.pad, gap: 2, minHeight: 140 }}>
      <Txt style={webDense.cardTitle}>{title}</Txt>
      {caption ? (
        <Txt style={webDense.caption} color={colors.outline}>
          {caption}
        </Txt>
      ) : null}
      <Txt testID={testID ? `${testID}-value` : undefined} numberOfLines={1} style={[displayText(webDense.kpi), { marginTop: space.md }]}>
        {value}
      </Txt>
      {footnote ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.xs }}>
          <MaterialIcons name="info-outline" size={14} color={colors.outline} />
          <Txt style={webDense.caption} color={colors.outline}>
            {footnote}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

/** Card with a title, a caption and an optional action (Circle21 refs 02, 03); `empty` shows « no data » in the middle instead of the content. */
export function SectionCard({ title, caption, action, empty, children, testID }: { title: string; caption?: string; action?: ReactNode; empty?: string | null; children?: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ backgroundColor: colors.surface, borderRadius: webDense.radius.card, padding: webDense.pad, gap: space.md, minHeight: 200 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={webDense.cardTitle}>{title}</Txt>
          {caption ? (
            <Txt style={webDense.caption} color={colors.outline}>
              {caption}
            </Txt>
          ) : null}
        </View>
        {action}
      </View>
      {empty ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Txt testID={testID ? `${testID}-empty` : undefined} style={{ fontSize: 13 }} color={colors.outline}>
            {empty}
          </Txt>
        </View>
      ) : (
        children
      )}
    </View>
  );
}

/** How many columns fit: the largest of `counts` whose items keep at least `min` px. */
export const gridColumns = (width: number, min: number, counts: number[]) => counts.find((n) => n * min + (n - 1) * webDense.gap <= width) ?? 1;

/** Equal columns (KPI cards 4 / 2 / 1, card rows 3 / 1), measured on the real width. */
export function Grid({ min, counts, children, testID }: { min: number; counts: number[]; children: ReactNode; testID?: string }) {
  const [width, setWidth] = useState(0);
  const items = Children.toArray(children).filter(isValidElement);
  const cols = width > 0 ? gridColumns(width, min, counts) : counts[0];
  // Rounded down: a fraction of a pixel too much would push the last card to the next row.
  const itemWidth = width > 0 ? Math.floor((width - webDense.gap * (cols - 1)) / cols) : undefined;
  return (
    <View testID={testID} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: webDense.gap }}>
      {items.map((child, i) => (
        <View key={child.key ?? i} style={itemWidth ? { width: itemWidth } : { flexGrow: 1, flexBasis: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}
```

In `apps/mobile-rn/src/core/widgets/chart.tsx`:
- Replace the imports with:
```tsx
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { useTheme } from '../theme';
import { Txt } from './kit';
```
- At the end of the file, add:
```tsx
/** Arcs of a ring split in parts: each part's length and where it starts, along a circle of `circumference`. */
export function ringArcs(values: number[], circumference: number): { length: number; offset: number }[] {
  const total = values.reduce((a, b) => a + b, 0);
  let start = 0;
  return values.map((v) => {
    const length = total > 0 ? (v / total) * circumference : 0;
    const arc = { length, offset: start };
    start += length;
    return arc;
  });
}

/** Progress or split ring (Circle21 refs 04, 19): a grey track, one arc per part from the top, something in the middle. */
export function Ring({ parts, label, size = 112, thickness = 10, children, testID }: { parts: { value: number; color: string }[]; label: string; size?: number; thickness?: number; children?: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const arcs = ringArcs(
    parts.map((p) => p.value),
    c,
  );
  return (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceHigh} strokeWidth={thickness} fill="none" />
          {arcs.map((a, i) =>
            a.length > 0 ? <Circle key={i} cx={size / 2} cy={size / 2} r={r} stroke={parts[i].color} strokeWidth={thickness} fill="none" strokeDasharray={`${a.length} ${c - a.length}`} strokeDashoffset={-a.offset} /> : null,
          )}
        </G>
      </Svg>
      {children}
    </View>
  );
}

/** Every n-th label of an axis, so at most `most` labels are written. */
export const axisStep = (n: number, most = 8) => Math.max(1, Math.ceil(n / most));

/** Vertical bars with their axis under them (Circle21 ref 02); with many bars only every n-th label is written. */
export function BarChart({ data, label, height = 160 }: { data: { key: string; label: string; value: number }[]; label: string; height?: number }) {
  const { colors } = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));
  const every = axisStep(data.length);
  return (
    <View accessibilityLabel={label} style={{ gap: 6 }}>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 4 }}>
        {data.map((d) => (
          <View
            key={d.key}
            testID={`bar-${d.key}`}
            accessibilityLabel={`${d.label}: ${d.value}`}
            style={{ flex: 1, maxWidth: 48, height: `${(d.value / max) * 100}%` as `${number}%`, minHeight: d.value > 0 ? 2 : 0, backgroundColor: colors.primary, borderTopLeftRadius: 3, borderTopRightRadius: 3 }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
        {data.map((d, i) => (
          <Txt key={d.key} numberOfLines={1} color={colors.outline} style={{ flex: 1, maxWidth: 48, fontSize: 11, textAlign: 'center' }}>
            {i % every === 0 ? d.label : ''}
          </Txt>
        ))}
      </View>
    </View>
  );
}
```
`chart.tsx` → `kit.tsx` is a new import. `kit.tsx` does not import `chart.tsx`, so there is no cycle.

- [ ] **Step 4: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes, no type error.

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/core/widgets/web.tsx apps/mobile-rn/src/core/widgets/chart.tsx apps/mobile-rn/test/core/web-widgets.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): computer page pieces: page header, toolbar, search, KPI and section cards, grid, ring, bar chart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Table and side panel

**Files:**
- Create: `apps/mobile-rn/src/core/widgets/table.tsx`
- Create: `apps/mobile-rn/src/core/widgets/panel.tsx`
- Modify: `apps/mobile-rn/src/core/widgets/kit.tsx` (`IconButton` takes a `testID`)
- Test: `apps/mobile-rn/test/core/web-table-panel.test.tsx`

**Interfaces:**
- Consumes: Task 2 `ThemeScope`, `webDense`, `useTheme`; `Menu`, `Txt`, `IconButton` (`kit.tsx`); `useReducedMotion` (`common.tsx`); react-native-web `Modal` (Esc → `onRequestClose`, focus kept inside and given back on close).
- Produces:
  - `table.tsx`: `type Column<T> = { key; label; flex?; width?; align?: 'start' | 'end'; render: (row: T, index: number) => ReactNode }`, `type RowAction = { label; onPress; testID? }`, `type Selection = { selected: ReadonlySet<string>; onToggle(key); onToggleAll(); label(name): string; allLabel: string }`, `DataTable<T>({ testID, rows, keyOf, nameOf, columns, rowTestID?, onRowPress?, selection?, rowActions?, menuLabel?, header?, empty? })`. TestIDs: `${testID}-head`, row `rowTestID(row)` (default `${testID}-row-${key}`), `${testID}-check-all`, `${testID}-check-${key}`, `${testID}-menu-${key}`.
  - `panel.tsx`: `PANEL_WIDTH = 420`, `SidePanel({ visible, title, closeLabel, onClose, footer?, children, testID = 'side-panel' })`. TestIDs: `${testID}` (the drawer), `${testID}-modal`, `${testID}-backdrop`, `${testID}-close`.
  - `IconButton({ icon, onPress, label, color?, testID? })`.

- [ ] **Step 1: Write the failing tests**

`apps/mobile-rn/test/core/web-table-panel.test.tsx`:
```tsx
import { act, fireEvent, within } from 'expo-router/testing-library';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { useTheme } from '../../src/core/theme';
import { Txt } from '../../src/core/widgets/kit';
import { SidePanel } from '../../src/core/widgets/panel';
import { DataTable, type Column } from '../../src/core/widgets/table';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

type Row = { id: string; name: string };
const rows: Row[] = [
  { id: 'a', name: 'Amira' },
  { id: 'b', name: 'Hédi' },
];
const columns: Column<Row>[] = [
  { key: 'n', label: '#', width: 32, render: (_, i) => String(i + 1) },
  { key: 'name', label: 'Name', flex: 2, render: (r) => r.name },
];

describe('table', () => {
  it('a header strip, one row each, a press opens the row', async () => {
    const onRowPress = jest.fn();
    const screen = await renderScreen(() => <DataTable testID="t" rows={rows} keyOf={(r) => r.id} nameOf={(r) => r.name} columns={columns} onRowPress={onRowPress} />, new FakeBackend());
    expect(within(screen.getByTestId('t-head')).getByText('Name')).toBeTruthy();
    expect(within(screen.getByTestId('t-row-b')).getByText('2')).toBeTruthy();
    fireEvent.press(screen.getByTestId('t-row-b'));
    expect(onRowPress).toHaveBeenCalledWith(rows[1]);
    expect(StyleSheet.flatten(screen.getByTestId('t-row-a').props.style)).toMatchObject({ minHeight: 44 });
  });

  it('checkboxes: one row, then all; the header box is « mixed » in between', async () => {
    function Host() {
      const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
      const toggle = (k: string) =>
        setSel((s) => {
          const n = new Set(s);
          if (n.has(k)) n.delete(k);
          else n.add(k);
          return n;
        });
      return (
        <DataTable
          testID="t"
          rows={rows}
          keyOf={(r) => r.id}
          nameOf={(r) => r.name}
          columns={columns}
          selection={{ selected: sel, onToggle: toggle, onToggleAll: () => setSel((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))), label: (n) => `Select ${n}`, allLabel: 'Select all' }}
        />
      );
    }
    const screen = await renderScreen(() => <Host />, new FakeBackend());
    await fireEvent.press(screen.getByTestId('t-check-a'));
    expect(screen.getByTestId('t-check-a').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('t-check-all').props.accessibilityState).toMatchObject({ checked: 'mixed' });
    expect(screen.getByLabelText('Select Hédi')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('t-check-all'));
    expect(screen.getByTestId('t-check-b').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('t-check-all').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('the row menu lists the row actions and is named after the row', async () => {
    const pay = jest.fn();
    const screen = await renderScreen(
      () => <DataTable testID="t" rows={rows} keyOf={(r) => r.id} nameOf={(r) => r.name} columns={columns} menuLabel={(n) => `Actions for ${n}`} rowActions={(r) => [{ label: 'Mark paid', testID: `pay-${r.id}`, onPress: pay }]} />,
      new FakeBackend(),
    );
    expect(screen.getByTestId('t-menu-b').props.accessibilityLabel).toBe('Actions for Hédi');
    await fireEvent.press(screen.getByTestId('t-menu-a'));
    await fireEvent.press(screen.getByTestId('pay-a'));
    expect(pay).toHaveBeenCalledTimes(1);
  });

  it('an empty list shows the header strip and the empty element', async () => {
    const screen = await renderScreen(() => <DataTable testID="t" rows={[] as Row[]} keyOf={(r) => r.id} nameOf={(r) => r.name} columns={columns} empty={<Txt>No payment</Txt>} />, new FakeBackend());
    expect(screen.getByTestId('t-head')).toBeTruthy();
    expect(screen.getByText('No payment')).toBeTruthy();
  });
});

describe('side panel', () => {
  function Probe() {
    const { colors } = useTheme();
    return <Txt testID="bg">{colors.background}</Txt>;
  }

  it('light even on a dark page, 420 px at the end of the window, its footer under the content', async () => {
    const screen = await renderScreen(
      () => (
        <SidePanel visible title="Sami Ben Ali" closeLabel="Close" onClose={() => {}} footer={<Txt>footer</Txt>}>
          <Probe />
        </SidePanel>
      ),
      new FakeBackend(),
    );
    expect(screen.getByTestId('bg').props.children).toBe('#FFFFFF');
    expect(screen.getByText('Sami Ben Ali')).toBeTruthy();
    expect(screen.getByText('footer')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('side-panel').props.style)).toMatchObject({ width: 420, right: 0, top: 0, bottom: 0 });
  });

  it('closes with its X, a click on the backdrop, or Esc', async () => {
    const onClose = jest.fn();
    const screen = await renderScreen(
      () => (
        <SidePanel visible title="Sami Ben Ali" closeLabel="Close" onClose={onClose}>
          <Txt>body</Txt>
        </SidePanel>
      ),
      new FakeBackend(),
    );
    expect(screen.getByTestId('side-panel-close').props.accessibilityLabel).toBe('Close');
    await fireEvent.press(screen.getByTestId('side-panel-close'));
    await fireEvent.press(screen.getByTestId('side-panel-backdrop'));
    // Esc: react-native-web's Modal calls onRequestClose.
    await act(async () => screen.UNSAFE_getAllByProps({ testID: 'side-panel-modal' })[0].props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('shows nothing while closed', async () => {
    const screen = await renderScreen(
      () => (
        <SidePanel visible={false} title="Sami Ben Ali" closeLabel="Close" onClose={() => {}}>
          <Txt>body</Txt>
        </SidePanel>
      ),
      new FakeBackend(),
    );
    expect(screen.queryByText('body')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/core/web-table-panel.test.tsx`
Expected: FAIL with `Cannot find module '../../src/core/widgets/panel'`.

- [ ] **Step 3: `IconButton` takes a testID**

In `apps/mobile-rn/src/core/widgets/kit.tsx`, replace:
```tsx
export function IconButton({ icon, onPress, label, color }: { icon: IconName; onPress: () => void; label: string; color?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={{ padding: 8 }}>
```
with:
```tsx
export function IconButton({ icon, onPress, label, color, testID }: { icon: IconName; onPress: () => void; label: string; color?: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={{ padding: 8 }}>
```

- [ ] **Step 4: Write the table**

`apps/mobile-rn/src/core/widgets/table.tsx`:
```tsx
import { MaterialIcons } from '@expo/vector-icons';
import type { ReactElement, ReactNode } from 'react';
import { FlatList, Pressable, View, type ViewStyle } from 'react-native';

import { space, useTheme, webDense } from '../theme';
import { Menu, Txt } from './kit';

export type Column<T> = { key: string; label: string; flex?: number; width?: number; align?: 'start' | 'end'; render: (row: T, index: number) => ReactNode };
export type RowAction = { label: string; onPress: () => void; testID?: string };
export type Selection = { selected: ReadonlySet<string>; onToggle: (key: string) => void; onToggleAll: () => void; label: (name: string) => string; allLabel: string };

const ROW_HEIGHT = 44;

/**
 * Desktop table (Circle21 refs 12, 14): a rounded header strip with 12 px muted labels, 44 px rows, an optional
 * checkbox column and a ⋯ menu per row. A FlatList inside, so a list of hundreds stays fast; `header` scrolls with it.
 */
export function DataTable<T>({ testID, rows, keyOf, nameOf, columns, rowTestID, onRowPress, selection, rowActions, menuLabel, header, empty }: {
  testID: string;
  rows: T[];
  keyOf: (row: T) => string;
  /** What the row is called: read with its checkbox and its menu. */
  nameOf: (row: T) => string;
  columns: Column<T>[];
  rowTestID?: (row: T) => string;
  onRowPress?: (row: T) => void;
  selection?: Selection;
  rowActions?: (row: T) => RowAction[];
  menuLabel?: (name: string) => string;
  header?: ReactElement;
  empty?: ReactElement;
}) {
  const { colors } = useTheme();
  const all = !!selection && rows.length > 0 && rows.every((r) => selection.selected.has(keyOf(r)));
  const some = !!selection && rows.some((r) => selection.selected.has(keyOf(r)));
  const cell = (c: Column<T>): ViewStyle => ({ flex: c.width ? undefined : (c.flex ?? 1), width: c.width, alignItems: c.align === 'end' ? 'flex-end' : 'flex-start', justifyContent: 'center' });
  const strip = (
    <View testID={`${testID}-head`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40, paddingHorizontal: space.md, borderRadius: webDense.radius.field, backgroundColor: colors.surface }}>
      {selection ? <Check testID={`${testID}-check-all`} checked={all} mixed={!all && some} label={selection.allLabel} onPress={selection.onToggleAll} /> : null}
      {columns.map((c) => (
        <View key={c.key} style={cell(c)}>
          <Txt numberOfLines={1} style={webDense.caption} color={colors.outline}>
            {c.label}
          </Txt>
        </View>
      ))}
      {rowActions ? <View style={{ width: webDense.control }} /> : null}
    </View>
  );
  return (
    <FlatList
      testID={testID}
      data={rows}
      keyExtractor={keyOf}
      contentContainerStyle={{ padding: space.lg }}
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.xs }}>
          {header}
          {strip}
        </View>
      }
      ListEmptyComponent={empty}
      renderItem={({ item, index }) => {
        const key = keyOf(item);
        const name = nameOf(item);
        return (
          <Pressable
            testID={rowTestID ? rowTestID(item) : `${testID}-row-${key}`}
            accessibilityRole={onRowPress ? 'button' : undefined}
            disabled={!onRowPress}
            onPress={onRowPress && (() => onRowPress(item))}
            style={(state) => {
              // react-native-web passes `hovered` too.
              const hovered = (state as { hovered?: boolean }).hovered;
              const row: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: ROW_HEIGHT, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: hovered || state.pressed ? colors.surface : 'transparent' };
              return row;
            }}
          >
            {selection ? <Check testID={`${testID}-check-${key}`} checked={selection.selected.has(key)} label={selection.label(name)} onPress={() => selection.onToggle(key)} /> : null}
            {columns.map((c) => {
              const v = c.render(item, index);
              return (
                <View key={c.key} style={cell(c)}>
                  {typeof v === 'string' || typeof v === 'number' ? (
                    <Txt numberOfLines={1} style={{ fontSize: 13 }}>
                      {String(v)}
                    </Txt>
                  ) : (
                    v
                  )}
                </View>
              );
            })}
            {rowActions ? <Menu testID={`${testID}-menu-${key}`} icon="more-horiz" label={menuLabel ? menuLabel(name) : name} items={rowActions(item)} /> : null}
          </Pressable>
        );
      }}
    />
  );
}

function Check({ testID, checked, mixed, label, onPress }: { testID: string; checked: boolean; mixed?: boolean; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: mixed ? 'mixed' : checked }} hitSlop={6} onPress={onPress} style={{ width: 24, alignItems: 'center' }}>
      <MaterialIcons name={checked ? 'check-box' : mixed ? 'indeterminate-check-box' : 'check-box-outline-blank'} size={20} color={checked || mixed ? colors.primary : colors.outline} />
    </Pressable>
  );
}
```

- [ ] **Step 5: Write the side panel**

`apps/mobile-rn/src/core/widgets/panel.tsx`:
```tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { space, ThemeScope, useTheme, webDense } from '../theme';
import { useReducedMotion } from './common';
import { IconButton, Txt } from './kit';

export const PANEL_WIDTH = 420;

/**
 * Right drawer (Circle21 refs 08, 13): 420 px, slides in over 200 ms, light even on a dark page. Esc or a click on the
 * backdrop closes it; react-native-web's Modal keeps the keyboard focus inside and gives it back to what opened it.
 */
export function SidePanel({ visible, title, closeLabel, onClose, footer, children, testID = 'side-panel' }: { visible: boolean; title: string; closeLabel: string; onClose: () => void; footer?: ReactNode; children: ReactNode; testID?: string }) {
  return (
    <Modal testID={`${testID}-modal`} visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <ThemeScope scheme="light">
        <Drawer title={title} closeLabel={closeLabel} onClose={onClose} footer={footer} testID={testID}>
          {children}
        </Drawer>
      </ThemeScope>
    </Modal>
  );
}

function Drawer({ title, closeLabel, onClose, footer, children, testID }: { title: string; closeLabel: string; onClose: () => void; footer?: ReactNode; children: ReactNode; testID: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(PANEL_WIDTH)).current;
  useEffect(() => {
    if (reduced) x.setValue(0);
    else Animated.timing(x, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  }, [reduced, x]);
  return (
    <View style={{ flex: 1 }}>
      {/* Not focusable: the keyboard goes straight to the drawer, Esc closes it. */}
      <Pressable testID={`${testID}-backdrop`} focusable={false} importantForAccessibility="no" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: '#00000066' }]} />
      <Animated.View testID={testID} accessibilityViewIsModal style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: PANEL_WIDTH, maxWidth: '100%', backgroundColor: colors.background, transform: [{ translateX: x }] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, paddingStart: space.xl, paddingEnd: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Txt numberOfLines={1} style={[webDense.cardTitle, { flex: 1, fontSize: 16 }]}>
            {title}
          </Txt>
          <IconButton testID={`${testID}-close`} icon="close" label={closeLabel} onPress={onClose} />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
          {children}
        </ScrollView>
        {footer ? <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg, borderTopWidth: 1, borderTopColor: colors.border }}>{footer}</View> : null}
      </Animated.View>
    </View>
  );
}
```
The `Modal` is not mounted while `visible` is false, so `Drawer` mounts and slides in again each time the panel opens.

- [ ] **Step 6: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes, no type error. If TypeScript refuses `focusable` on `Pressable`, the React Native types in use do not declare it. Then pass it through a spread typed as `{ focusable: false } as object`, with a one-line comment that react-native-web reads it.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/core/widgets/table.tsx apps/mobile-rn/src/core/widgets/panel.tsx apps/mobile-rn/src/core/widgets/kit.tsx apps/mobile-rn/test/core/web-table-panel.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): computer table (header strip, checkboxes, row menu) and light side panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Shell restyle — compact top bar, Circle21 menu, dense scope

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/page.tsx` (`pageTitle`)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/web-shell.tsx` (rewritten)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/manage.tsx` (no stack header on a computer)
- Modify: `apps/mobile-rn/src/core/widgets/common.tsx` (`GymLogo` takes `round`)
- Create: `apps/mobile-rn/test/wide-web.ts` (the window switch for screen tests)
- Test: `apps/mobile-rn/test/screens/organizer-web-shell.test.tsx`

**Interfaces:**
- Consumes: Task 1 `MENU_ICON`, keys `orgMenuOverview`, `orgMenuFinances`, `orgMenuTimetable`, `orgBackToEvent`, `orgUnpublished`, `orgMoreActions`, `orgMoreChecklist`, `orgMoreEdit`, `orgMoreExport`; Task 2 `ThemeScope`, `webDense`; Task 4 `IconButton testID`; lot 1 `usePublication`, `menuMarks`, `ORG_MENU`, `contentWidth`, `exportCsv`, `registrationsCsv`, `csvFileName`, `csvSeparator`, `toCollect`, `statusLabelForCompetition`.
- Produces: `pageTitle(t: T, tab: ManageTab): string` (menu entries and page headers use the same name); `OrganizerWeb({ c, tab, onTab, children })` wraps everything in `<ThemeScope dense>`; `GymLogo({ name, url?, size?, round? })`; `test/wide-web.ts`: `setWide(v: boolean)`, `useWide(): boolean`. TestIDs kept: `org-menu`, `org-menu-<tab>`, `org-mark-<tab>`, `org-top-title`, `org-top-status`, `org-top-preview`, `org-top-request`, `org-top-share`, `org-content`. New: `org-top-back`, `org-top-lock`, `org-top-dates`, `org-top-more`, `org-more-checklist`, `org-more-edit`, `org-more-export`, `org-menu-active`.

- [ ] **Step 1: The window switch for screen tests**

`apps/mobile-rn/test/wide-web.ts`:
```ts
import { useSyncExternalStore } from 'react';

/**
 * Screen tests of the organizer space on a computer. A test file mocks `useWideWeb` with `useWide`:
 *   jest.mock('../../src/features/competitions/organizer/web', () => ({ ...jest.requireActual('../../src/features/competitions/organizer/web'), useWideWeb: () => require('../wide-web').useWide() }));
 * `setWide(false)` then re-renders every screen that asked, like a window crossing 1024 px.
 */
let wide = true;
const listeners = new Set<() => void>();

export function setWide(v: boolean) {
  wide = v;
  listeners.forEach((l) => l());
}

export function useWide(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => wide,
  );
}
```

- [ ] **Step 2: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-web-shell.test.tsx`:
```tsx
import { router } from 'expo-router';
import { fireEvent, within } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import * as exportModule from '../../src/features/competitions/organizer/export';
import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = (tab?: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

describe('computer top bar and menu (Circle21 look)', () => {
  beforeEach(() => setWide(true));
  afterEach(() => jest.restoreAllMocks());

  it('one compact row: back, title with a lock while unpublished, « format · status », registration dates', async () => {
    const navigate = jest.spyOn(router, 'navigate').mockImplementation(() => {});
    const screen = await renderScreen(open(), orgBackend({ ...event, status: 'DRAFT' }));
    expect(await screen.findByTestId('org-top-title')).toBeTruthy();
    expect(screen.getByLabelText('Not published yet')).toBeTruthy();
    expect(screen.getByText(/^On site · Draft$/)).toBeTruthy();
    expect(screen.getByTestId('org-top-status').props.children).toBe('Draft');
    expect(screen.getByTestId('org-top-dates')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-top-back'));
    expect(navigate).toHaveBeenCalledWith('/competitions/c9');
  });

  it('the cover as a 32 px round thumbnail; no lock once published', async () => {
    const screen = await renderScreen(open(), orgBackend());
    expect(await screen.findByTestId('org-top-title')).toBeTruthy();
    expect(screen.queryByLabelText('Not published yet')).toBeNull();
    expect(flat(screen.getByLabelText('Sousse Summer Throwdown'))).toMatchObject({ width: 32, height: 32, borderRadius: 16 });
  });

  it('« ⋯ » holds the rarer actions: the checklist, the event details, the participants export', async () => {
    const download = jest.spyOn(exportModule, 'exportCsv').mockImplementation(() => {});
    const screen = await renderScreen(open('team'), orgBackend().on('GET', '/competitions/c9/staff', [200, []]));
    expect(await screen.findByTestId('org-mark-participants')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-top-more'));
    await fireEvent.press(screen.getByTestId('org-more-checklist'));
    expect(await screen.findByTestId('org-state')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-top-more'));
    await fireEvent.press(screen.getByTestId('org-more-edit'));
    expect(await screen.findByTestId('org-title')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-top-more'));
    await fireEvent.press(screen.getByTestId('org-more-export'));
    expect(download.mock.calls[0][0]).toBe('event-participants.csv');
    expect(download.mock.calls[0][1].split('\n')).toHaveLength(6);
  });

  it('menu: 220 px wide, 36 px entries with an icon, an accent bar on the page open', async () => {
    const screen = await renderScreen(open(), orgBackend().on('GET', '/competitions/c9/staff', [200, []]));
    expect(flat(await screen.findByTestId('org-menu'))).toMatchObject({ width: 220 });
    // Scoped to the menu: from Task 6 on, the page header says « Overview » too.
    expect(within(screen.getByTestId('org-menu')).getByText('Overview')).toBeTruthy();
    expect(within(screen.getByTestId('org-menu-dashboard')).getByTestId('org-menu-active')).toBeTruthy();
    expect(screen.getAllByTestId('org-menu-active')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('org-menu-team'));
    expect(within(screen.getByTestId('org-menu-team')).getByTestId('org-menu-active')).toBeTruthy();
    expect(flat(screen.getByTestId('org-menu-team'))).toMatchObject({ height: 36, borderRadius: 6 });
  });

  it('the dense look reaches the page; the phone keeps its tabs and its cards', async () => {
    const wide = await renderScreen(open(), orgBackend());
    expect(flat(await wide.findByTestId('org-state'))).toMatchObject({ borderRadius: 10 });
    wide.unmount();
    setWide(false);
    const phone = await renderScreen(open(), orgBackend());
    expect(await phone.findByTestId('org-tab-dashboard')).toBeTruthy();
    expect(flat(phone.getByTestId('org-state'))).toMatchObject({ borderRadius: 20 });
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-web-shell.test.tsx`
Expected: FAIL: `org-top-back` is not found and the menu is 248 px.

- [ ] **Step 4: One name per page**

`apps/mobile-rn/src/features/competitions/organizer/page.tsx`:
```tsx
import type { T } from '../../../core/prefs';
import type { ManageTab } from './logic';

/** The name of each page on a computer: the same in the menu and in the page's header row. */
export const pageTitle = (t: T, tab: ManageTab): string =>
  ({
    dashboard: t('orgMenuOverview'),
    finances: t('orgMenuFinances'),
    general: t('orgMenuEventInfo'),
    categories: t('orgTabCategories'),
    coupons: t('orgTabCoupons'),
    team: t('orgTabTeam'),
    participants: t('orgTabParticipants'),
    wods: t('orgTabWods'),
    planning: t('orgMenuHeats'),
    timetable: t('orgMenuTimetable'),
    leaderboard: t('orgTabLeaderboard'),
    announcements: t('orgTabAnnouncements'),
  })[tab];
```

- [ ] **Step 5: A round thumbnail**

In `apps/mobile-rn/src/core/widgets/common.tsx`, replace:
```tsx
/** Gym logo (rounded square). Without a URL, initials on a colour derived from the name. */
export function GymLogo({ name, url, size = 56 }: { name: string; url?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const r = size * 0.24;
```
with:
```tsx
/** Gym logo (rounded square, or a circle with `round`). Without a URL, initials on a colour derived from the name. */
export function GymLogo({ name, url, size = 56, round }: { name: string; url?: string | null; size?: number; round?: boolean }) {
  const [failed, setFailed] = useState(false);
  const r = round ? size / 2 : size * 0.24;
```

- [ ] **Step 6: Rewrite the computer shell**

Replace the whole content of `apps/mobile-rn/src/features/competitions/organizer/web-shell.tsx` with:
```tsx
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View, type ViewStyle } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, ThemeScope, useTheme, webDense } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { GymLogo } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Icon, IconButton, Menu, Txt } from '../../../core/widgets/kit';
import { statusLabelForCompetition } from '../screens';
import { useRegistrations } from './api';
import { exportCsv } from './export';
import type { ManageTab } from './logic';
import { csvFileName, csvSeparator, registrationsCsv, toCollect } from './logic-b';
import { pageTitle } from './page';
import { usePublication } from './publication';
import { contentWidth, MENU_ICON, menuMarks, ORG_MENU, type MenuMark, type MenuSectionKey } from './web';

const MENU_WIDTH = 220;
const TOP_BAR_HEIGHT = 56;

/**
 * Organizer space on a computer (lot Web 1, restyled in lot Web 2 after the Circle21 back-office): a compact top bar
 * over the whole width, the grouped menu on the left, the page in a centered column, all in the dense look.
 */
export function OrganizerWeb({ c, tab, onTab, children }: { c: Json; tab: ManageTab; onTab: (tab: ManageTab) => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <ThemeScope dense>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <TopBar c={c} onTab={onTab} />
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <OrgMenu c={c} tab={tab} onTab={onTab} />
          <View style={{ flex: 1 }}>
            <View testID="org-content" style={{ flex: 1, width: '100%', maxWidth: contentWidth(tab), alignSelf: 'center' }}>
              {children}
            </View>
          </View>
        </View>
      </View>
    </ThemeScope>
  );
}

function OrgMenu({ c, tab, onTab }: { c: Json; tab: ManageTab; onTab: (tab: ManageTab) => void }) {
  const t = useT();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const marks = menuMarks(c, toCollect(regs.data ?? []).length);
  const section: Partial<Record<MenuSectionKey, string>> = { dashboard: t('orgTabDashboard'), general: t('orgTabGeneral'), planning: t('orgTabPlanning') };
  return (
    <View testID="org-menu" accessibilityLabel={t('orgMenuLabel')} style={{ width: MENU_WIDTH, borderRightWidth: 1, borderRightColor: colors.border }}>
      <ScrollView contentContainerStyle={{ padding: space.sm, gap: 2 }}>
        {ORG_MENU.map((s) => (
          <View key={s.key} style={{ gap: 2, marginTop: s.tabs.length > 1 ? space.md : 0 }}>
            {s.tabs.length > 1 ? (
              <Txt variant="label" color={colors.outline} style={{ paddingHorizontal: space.sm, paddingBottom: space.xs, fontSize: 12, letterSpacing: 1 }}>
                {section[s.key] ?? ''}
              </Txt>
            ) : null}
            {s.tabs.map((k) => (
              <MenuItem key={k} tab={k} label={pageTitle(t, k)} selected={tab === k} mark={marks[k]} onPress={() => onTab(k)} />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function MenuItem({ tab, label, selected, mark, onPress }: { tab: ManageTab; label: string; selected: boolean; mark?: MenuMark; onPress: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const spoken = mark === 'todo' ? `${label}, ${t('orgMarkTodo')}` : mark ? `${label}, ${mark}` : label;
  return (
    <Pressable
      testID={`org-menu-${tab}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={spoken}
      onPress={onPress}
      style={(state) => {
        // react-native-web passes `hovered` too.
        const hovered = (state as { hovered?: boolean }).hovered;
        const item: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: 10, height: 36, paddingHorizontal: space.md, borderRadius: webDense.radius.field, backgroundColor: selected ? colors.surfaceHigh : hovered || state.pressed ? colors.surface : 'transparent' };
        return item;
      }}
    >
      {/* Circle21's active item: a 3 px bar in the accent on the leading edge (the web layout is not mirrored). */}
      {selected ? <View testID="org-menu-active" style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: colors.primary }} /> : null}
      <Icon name={MENU_ICON[tab]} size={18} color={selected ? colors.primary : colors.outline} />
      <Txt numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: selected ? '700' : '400' }}>
        {label}
      </Txt>
      {mark === 'todo' ? (
        <View testID={`org-mark-${tab}`} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error }} />
      ) : mark ? (
        <Txt testID={`org-mark-${tab}`} variant="small" color={colors.onPrimary} style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 8, overflow: 'hidden', fontSize: 12 }}>
          {String(mark)}
        </Txt>
      ) : null}
    </Pressable>
  );
}

function TopBar({ c, onTab }: { c: Json; onTab: (tab: ManageTab) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const p = usePublication(c);
  const regs = useRegistrations(c.id);
  const pill = {
    DRAFT: t('orgPillDraft'),
    REQUESTED: t('orgPillRequested'),
    RETURNED: t('orgPillReturned'),
    PUBLISHED: statusLabelForCompetition(t, c.status),
    CANCELLED: t('orgPillCancelled'),
  }[p.state];
  const pillColor = p.state === 'PUBLISHED' ? colors.primary : p.state === 'RETURNED' || p.state === 'CANCELLED' ? colors.error : colors.outline;
  const format = ({ ONSITE: t('orgFormatOnsite'), ONLINE: t('orgFormatOnline'), HYBRID: t('orgFormatHybrid') } as Record<string, string>)[c.format];
  const from = c.deadlines?.registrationStart;
  const rows: Json[] = regs.data ?? [];
  // The rarer actions: an empty list is not exported (lot 1 rule), so the export appears once there is someone.
  const more = [
    { testID: 'org-more-checklist', label: t('orgMoreChecklist'), onPress: () => onTab('dashboard') },
    { testID: 'org-more-edit', label: t('orgMoreEdit'), onPress: () => onTab('general') },
    ...(rows.length ? [{ testID: 'org-more-export', label: t('orgMoreExport'), onPress: () => exportCsv(csvFileName(c, 'participants'), registrationsCsv(rows, csvSeparator(locale))) }] : []),
  ];
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ height: TOP_BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0 }}>
          <IconButton testID="org-top-back" icon="arrow-back" label={t('orgBackToEvent')} onPress={() => router.navigate(`/competitions/${c.id}`)} />
          <GymLogo name={c.title} url={c.coverUrl} size={32} round />
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Txt testID="org-top-title" numberOfLines={1} style={{ fontSize: 16, fontWeight: '700', flexShrink: 1 }}>
                {c.title}
              </Txt>
              {p.state !== 'PUBLISHED' ? (
                <View testID="org-top-lock" accessible accessibilityLabel={t('orgUnpublished')}>
                  <Icon name="lock" size={14} color={colors.outline} />
                </View>
              ) : null}
            </View>
            <Txt numberOfLines={1} style={webDense.caption} color={colors.outline}>
              {format ? `${format} · ` : ''}
              <Txt testID="org-top-status" style={[webDense.caption, { fontWeight: '700' }]} color={pillColor}>
                {pill}
              </Txt>
            </Txt>
          </View>
        </View>
        {from && c.registrationEnd ? (
          <Txt testID="org-top-dates" numberOfLines={1} style={{ fontSize: 14, fontWeight: '600' }}>
            {t('orgTopDates', { from: formatDate(from, locale), to: formatDate(c.registrationEnd, locale) })}
          </Txt>
        ) : null}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.sm }}>
          <Button testID="org-top-preview" kind="outlined" icon="visibility" label={t('orgPreview')} onPress={() => router.push(`/competitions/${c.id}`)} />
          {p.state === 'PUBLISHED' ? (
            <Button testID="org-top-share" icon="share" label={t('orgShare')} onPress={p.share} />
          ) : p.state === 'DRAFT' || p.state === 'RETURNED' ? (
            <Button testID="org-top-request" label={t('orgRequestPublication')} busy={p.busy} disabled={!p.canRequest} onPress={p.request} />
          ) : null}
          <Menu testID="org-top-more" icon="more-horiz" label={t('orgMoreActions')} items={more} />
        </View>
      </View>
      <ErrorText error={p.error} />
    </View>
  );
}
```
The lot 1 test « top bar: an incomplete draft cannot ask for publication yet » looks for the text `Draft`. It still finds the inner `org-top-status` text. Its other tests keep every testID.

- [ ] **Step 7: No stack header on a computer**

In `apps/mobile-rn/src/features/competitions/organizer/manage.tsx`, replace:
```tsx
        {/* The top bar shows the event name: the header keeps the way back. */}
        <Stack.Screen options={{ title: t('orgManage') }} />
```
with:
```tsx
        {/* The top bar shows the event name and has its own way back (Circle21's compact header). */}
        <Stack.Screen options={{ title: t('orgManage'), headerShown: false }} />
```

- [ ] **Step 8: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes (the new shell tests and the lot 1 `organizer-web` tests), no type error.

- [ ] **Step 9: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/page.tsx apps/mobile-rn/src/features/competitions/organizer/web-shell.tsx apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/src/core/widgets/common.tsx apps/mobile-rn/test/wide-web.ts apps/mobile-rn/test/screens/organizer-web-shell.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer computer shell in the Circle21 look: compact top bar, icon menu with accent bar, dense pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: A section header row on every computer page

**Files:**
- Modify: `apps/mobile-rn/src/features/competitions/organizer/page.tsx` (`OrgPageHeader`, `ExportButton`)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx`, `general.tsx`, `announcements.tsx` (title only)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/categories.tsx`, `wods.tsx` (« Nouveau… » in the header)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/coupons.tsx`, `team.tsx` (« Nouveau… » / « Ajouter » and the export in the header)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/leaderboard.tsx` (the export in the header)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/planning.tsx` (« Nouveau heat », « Heats auto » and the export in the header)
- Test: `apps/mobile-rn/test/screens/organizer-web-pages.test.tsx`

Participants gets its header in Task 9, with its table. Finances and Horaire du jour are built with theirs.

**Interfaces:**
- Consumes: Task 3 `PageHeader`, `SquareButton`; Task 5 `pageTitle`, `test/wide-web.ts`; lot 1 `useWideWeb`, `exportCsv` and the CSV builders.
- Produces: `OrgPageHeader({ tab, actions? })`: testID `org-page-header` on a computer, `null` on a phone. `ExportButton({ testID, disabled, onPress })`: a `SquareButton` labelled « Exporter (CSV) » on a computer, lot 1's outlined button on a phone. Every lot 1 testID is kept (`cat-new`, `wod-new`, `coupon-new`, `coupon-export`, `team-add`, `team-export`, `board-export`, `heat-new`, `heat-auto`, `heat-export`).

Pattern used in every tab: build the action once as a variable. Pass it to `OrgPageHeader` (rendered only on a computer), and render it in its old place only on a phone (`{wide ? null : add}`). The phone tree therefore does not change. `const wide = useWideWeb();` goes with the other hooks at the top of the tab component, before any early `return`.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-web-pages.test.tsx`:
```tsx
import { fireEvent, waitFor, within } from 'expo-router/testing-library';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = (tab?: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const staff = [{ id: 's1', userId: 'u-me', role: 'ORGANIZER', user: { username: 'ahmed_rx', profile: { fullName: 'Ahmed Ben Salah' } } }];
const backend = () =>
  orgBackend()
    .on('GET', '/competitions/c9/staff', [200, staff])
    .on('GET', '/competitions/c9/coupons', [200, []])
    .on('GET', '/competitions/c9/heats', [200, []])
    .on('GET', '/competitions/c9/announcements', [200, []])
    .on('GET', '/competitions/c9/leaderboard', [200, { status: 'REGISTRATION_OPEN', provisional: true, rows: [] }]);

const PAGES: [ManageTab, string][] = [
  ['dashboard', 'Overview'],
  ['general', 'Event details'],
  ['categories', 'Categories'],
  ['coupons', 'Promo codes'],
  ['team', 'Team'],
  ['wods', 'WODs'],
  ['planning', 'Heats'],
  ['leaderboard', 'Leaderboard'],
  ['announcements', 'Announcements'],
];

describe('organizer pages on a computer: the header row', () => {
  beforeEach(() => setWide(true));

  it('every page starts with its header row, named like its menu entry', async () => {
    const screen = await renderScreen(open(), backend());
    await screen.findByTestId('org-menu');
    for (const [tab, title] of PAGES) {
      await fireEvent.press(screen.getByTestId(`org-menu-${tab}`));
      await waitFor(() => expect(within(screen.getByTestId('org-page-header')).getByText(title)).toBeTruthy());
    }
  });

  it('create buttons and the export sit in the header; the export is a labelled square', async () => {
    const screen = await renderScreen(open('team'), backend());
    const header = await screen.findByTestId('org-page-header');
    expect(within(header).getByTestId('team-add')).toBeTruthy();
    expect(within(header).getByTestId('team-export').props.accessibilityLabel).toBe('Export (CSV)');
    expect(screen.queryByText('Export (CSV)')).toBeNull();
    await fireEvent.press(screen.getByTestId('org-menu-categories'));
    await waitFor(() => expect(within(screen.getByTestId('org-page-header')).getByTestId('cat-new')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('org-menu-planning'));
    await waitFor(() => expect(within(screen.getByTestId('org-page-header')).getByTestId('heat-new')).toBeTruthy());
    expect(within(screen.getByTestId('org-page-header')).getByTestId('heat-auto')).toBeTruthy();
    expect(screen.getAllByTestId('heat-new')).toHaveLength(1);
  });

  it('the phone has no header row and keeps its buttons where they were', async () => {
    setWide(false);
    const screen = await renderScreen(open('team'), backend());
    expect(await screen.findByTestId('team-export')).toBeTruthy();
    expect(screen.queryByTestId('org-page-header')).toBeNull();
    expect(screen.getByText('Export (CSV)')).toBeTruthy();
    expect(screen.getAllByTestId('team-add')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-web-pages.test.tsx`
Expected: FAIL: `org-page-header` is not found.

- [ ] **Step 3: The header row and the export button**

Replace the whole content of `apps/mobile-rn/src/features/competitions/organizer/page.tsx` with:
```tsx
import type { ReactNode } from 'react';

import { useT, type T } from '../../../core/prefs';
import { Button } from '../../../core/widgets/kit';
import { PageHeader, SquareButton } from '../../../core/widgets/web';
import type { ManageTab } from './logic';
import { useWideWeb } from './web';

/** The name of each page on a computer: the same in the menu and in the page's header row. */
export const pageTitle = (t: T, tab: ManageTab): string =>
  ({
    dashboard: t('orgMenuOverview'),
    finances: t('orgMenuFinances'),
    general: t('orgMenuEventInfo'),
    categories: t('orgTabCategories'),
    coupons: t('orgTabCoupons'),
    team: t('orgTabTeam'),
    participants: t('orgTabParticipants'),
    wods: t('orgTabWods'),
    planning: t('orgMenuHeats'),
    timetable: t('orgMenuTimetable'),
    leaderboard: t('orgTabLeaderboard'),
    announcements: t('orgTabAnnouncements'),
  })[tab];

/** The header row that starts every page on a computer (Circle21 refs 01, 12, 20): the page's name, its actions on the right. Nothing on a phone. */
export function OrgPageHeader({ tab, actions }: { tab: ManageTab; actions?: ReactNode }) {
  const t = useT();
  const wide = useWideWeb();
  if (!wide) return null;
  return <PageHeader testID="org-page-header" title={pageTitle(t, tab)} actions={actions} />;
}

/** « Exporter (CSV) »: a labelled square icon in the header row on a computer, the outlined button on a phone. */
export function ExportButton({ testID, disabled, onPress }: { testID: string; disabled: boolean; onPress: () => void }) {
  const t = useT();
  const wide = useWideWeb();
  return wide ? (
    <SquareButton testID={testID} icon="file-download" label={t('orgExport')} disabled={disabled} onPress={onPress} />
  ) : (
    <Button testID={testID} kind="outlined" icon="file-download" label={t('orgExport')} disabled={disabled} onPress={onPress} />
  );
}
```

- [ ] **Step 4: Title-only pages**

In `dashboard.tsx`, `general.tsx` and `announcements.tsx` (all under `apps/mobile-rn/src/features/competitions/organizer/`):
- add `import { OrgPageHeader } from './page';`;
- wrap the main returned `<Screen>…</Screen>` in a fragment whose first child is the header: `<OrgPageHeader tab="dashboard" />` (`tab="general"`, `tab="announcements"` in the other two). For example, in `announcements.tsx`:
```tsx
  return (
    <>
      <OrgPageHeader tab="announcements" />
      <Screen>
        {/* … unchanged … */}
      </Screen>
    </>
  );
```
The fragment puts the header above the scroll view. In the computer's flex column it stays in place while the page scrolls, as Circle21's does. On a phone `OrgPageHeader` is `null` and the tree is the old one.

- [ ] **Step 5: Categories and WODs: « Nouveau… » in the header**

In `categories.tsx`:
- add `import { OrgPageHeader } from './page';` and `import { useWideWeb } from './web';`;
- add `const wide = useWideWeb();` with the hooks at the top of `CategoriesTab`;
- replace the main `return (` … `);` (the one after `if (edit) return …`) with:
```tsx
  const add = <Button testID="cat-new" icon="add" label={t('orgNewCategory')} onPress={() => setEdit(catDraft(null))} />;
  return (
    <>
      <OrgPageHeader tab="categories" actions={add} />
      <Screen>
        {cats.length === 0 ? (
          <>
            <Txt color={colors.outline}>{t('orgNoCategories')}</Txt>
            <Button testID="cat-templates" kind="outlined" icon="playlist-add" label={t('orgAddTemplates')} busy={busy} onPress={() => run(() => organizerApi(api).addTemplates(c.id))} />
          </>
        ) : (
          <ListGroup>
            {cats.map((x, i) => (
              <ListRow
                key={x.id}
                testID={`cat-${x.id}`}
                title={x.name}
                subtitle={subtitle(x)}
                onPress={() => setEdit(catDraft(x))}
                trailing={
                  <View style={{ flexDirection: 'row' }}>
                    {i > 0 ? <IconButton icon="arrow-upward" label={t('orgMoveUp')} onPress={() => move(i, -1)} /> : null}
                    {i < cats.length - 1 ? <IconButton icon="arrow-downward" label={t('orgMoveDown')} onPress={() => move(i, 1)} /> : null}
                  </View>
                }
              />
            ))}
          </ListGroup>
        )}
        <ErrorText error={error} />
        {wide ? null : add}
      </Screen>
    </>
  );
```

In `wods.tsx`:
- add `import { OrgPageHeader } from './page';` and `import { useWideWeb } from './web';`;
- add `const wide = useWideWeb();` with the hooks at the top of `WodsTab`;
- in the main return, define `const add = <Button testID="wod-new" icon="add" label={t('orgNewWod')} onPress={() => setEdit(wodDraft(null, defaults))} />;` just before `return (`. Wrap the `<Screen>` in a fragment that starts with `<OrgPageHeader tab="wods" actions={add} />`. Replace the last child `<Button testID="wod-new" … />` with `{wide ? null : add}`.

- [ ] **Step 6: Promo codes and team: the create button and the export in the header**

In `coupons.tsx`:
- add `import { ExportButton, OrgPageHeader } from './page';` and `import { useWideWeb } from './web';`;
- add `const wide = useWideWeb();` with the hooks at the top of `CouponsTab`;
- just before the main `return (` (after `const top = topUsed(list.data);`), add:
```tsx
  const add = (
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
  );
  const exportBtn = <ExportButton testID="coupon-export" disabled={list.data.length === 0} onPress={() => exportCsv(csvFileName(c, 'coupons'), couponsCsv(list.data, c.categories ?? [], c.currency, csvSeparator(locale)))} />;
```
- wrap the `<Screen>` in a fragment that starts with:
```tsx
      <OrgPageHeader
        tab="coupons"
        actions={
          <>
            {add}
            {exportBtn}
          </>
        }
      />
```
- in the `<Screen>`, replace the `<Button testID="coupon-new" … />` element with `{wide ? null : add}`, and the `<Button testID="coupon-export" … />` element with `{wide ? null : exportBtn}`.

In `team.tsx`:
- add `import { ExportButton, OrgPageHeader } from './page';` and `import { useWideWeb } from './web';`;
- add `const wide = useWideWeb();` with the hooks at the top of `TeamTab`;
- just before the main `return (` (after `const titles = …`), add:
```tsx
  const add = <Button testID="team-add" icon="person-add" label={t('orgTeamAdd')} busy={busy} onPress={() => setAdding(true)} />;
  const exportBtn = <ExportButton testID="team-export" disabled={staff.data.length === 0} onPress={() => exportCsv(csvFileName(c, 'team'), staffCsv(staff.data, csvSeparator(locale)))} />;
```
- wrap the `<Screen>` in a fragment that starts with `<OrgPageHeader tab="team" actions={<>{add}{exportBtn}</>} />`;
- replace the two `<Button testID="team-add" … />` / `<Button testID="team-export" … />` elements with `{wide ? null : add}` and `{wide ? null : exportBtn}`.

- [ ] **Step 7: Leaderboard and heats**

In `leaderboard.tsx`:
- add `import { ExportButton, OrgPageHeader } from './page';` and `import { useWideWeb } from './web';`;
- add `const wide = useWideWeb();` after `const board = useCompLeaderboard(c.id, categoryId);`;
- just before `return (`, add:
```tsx
  const rows: Json[] = board.data?.rows ?? [];
  const exportBtn = <ExportButton testID="board-export" disabled={rows.length === 0} onPress={() => exportCsv(csvFileName(c, 'leaderboard'), leaderboardCsv(rows, categories.find((k) => k.id === categoryId)?.name ?? '', csvSeparator(locale)))} />;
```
- wrap the `<Screen>` in a fragment that starts with `<OrgPageHeader tab="leaderboard" actions={board.data ? exportBtn : undefined} />`;
- replace the multi-line `<Button testID="board-export" … />` element with `{wide ? null : exportBtn}`. Then remove `Button` from the `kit` import if nothing else in the file uses it.

In `planning.tsx` (`PlanningTab`):
- add `import { ExportButton, OrgPageHeader } from './page';` and `import { useWideWeb } from './web';`;
- add `const wide = useWideWeb();` with the hooks at the top of `PlanningTab` (before `if (heats.isError)`);
- just before the main `return (` (after `const shown = filterHeats(all, filter);`), add:
```tsx
  const create = <Button testID="heat-new" icon="add" label={t('orgHeatNew')} onPress={() => setEdit(heatDraft(null))} />;
  const autoBtn = (
    <Button testID="heat-auto" kind="outlined" icon="auto-fix-high" label={t('orgHeatAuto')} disabled={categories.length === 0} onPress={() => setAuto({ categoryId: categories[0]?.id ?? null, workoutId: null, lanes: '8', start: null, interval: '15' })} />
  );
  const exportBtn = <ExportButton testID="heat-export" disabled={shown.length === 0} onPress={() => exportCsv(csvFileName(c, 'heats'), heatsCsv(shown, csvSeparator(locale)))} />;
```
- wrap the `<Screen>` in a fragment that starts with:
```tsx
      <OrgPageHeader
        tab="planning"
        actions={
          <>
            {create}
            {autoBtn}
            {all.length > 0 ? exportBtn : null}
          </>
        }
      />
```
- replace the `<View style={{ flexDirection: 'row', gap: space.sm }}>` block that holds the two `heat-new` / `heat-auto` buttons with:
```tsx
        {wide ? null : (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>{create}</View>
            <View style={{ flex: 1 }}>{autoBtn}</View>
          </View>
        )}
```
- replace the `<Button testID="heat-export" … />` element with `{wide ? null : exportBtn}`.

- [ ] **Step 8: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes. The phone tests of lots A, B and Web 1 (exports, guides, planning, coupons, team, leaderboard) are unchanged and green. No type error.

- [ ] **Step 9: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/page.tsx apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx apps/mobile-rn/src/features/competitions/organizer/general.tsx apps/mobile-rn/src/features/competitions/organizer/announcements.tsx apps/mobile-rn/src/features/competitions/organizer/categories.tsx apps/mobile-rn/src/features/competitions/organizer/wods.tsx apps/mobile-rn/src/features/competitions/organizer/coupons.tsx apps/mobile-rn/src/features/competitions/organizer/team.tsx apps/mobile-rn/src/features/competitions/organizer/leaderboard.tsx apps/mobile-rn/src/features/competitions/organizer/planning.tsx apps/mobile-rn/test/screens/organizer-web-pages.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): every organizer page on a computer starts with a header row (title, create button, export icon)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Overview on a computer — KPI rows, registrations per day, categories, scores, gender

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/overview.tsx`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx` (the computer shows `OverviewWeb` instead of the phone's figures and breakdown)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/manage.tsx` (`go` opens a page and can filter Participants on one category)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/participants.tsx` (`initialCategoryId`)
- Test: `apps/mobile-rn/test/screens/organizer-overview.test.tsx`

**Interfaces:**
- Consumes: Task 1 `percentages`, `judgeCount`, `topCategories`, `fillDays`, `Go`, keys `orgKpi*`, `orgRegsCount`, `orgSeeAll`, `orgScores`, `orgGender`, `orgGenderHint`, `orgWomen`, `orgMen`, `orgMixed`, `orgShowAs`, `orgShowPercent`, `orgShowNumbers`, `orgNoData`; Task 3 `Grid`, `KpiCard`, `SectionCard`, `SegmentedInline`, `Ring`, `BarChart`; lot B `distribution`, `useRegistrations`, `useStaff`; lot A `useOrganizerDashboard`.
- Produces: `OverviewWeb({ c, d, onGo })`; `DashboardTab({ c, onGo: Go })`; `ParticipantsTab({ c, initialCategoryId?: string | null })`; in `ManageScreen`, `go: Go`, the one function every page, menu entry and chip calls. TestIDs: `ov-kpi-<participants|paid|to-collect|revenue|judges|to-judge|approved|rejected>` (+ `-value`), `ov-per-day`, `ov-categories`, `ov-cat-<categoryId>`, `ov-cat-all`, `ov-scores`, `ov-gender`, `ov-gender-<women|men|mixed>`, `ov-gender-as` (+ `-percent`, `-numbers`); empty cards `ov-…-empty`.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-overview.test.tsx`:
```tsx
import { fireEvent, waitFor } from 'expo-router/testing-library';

import { formatMoney } from '../../src/features/competitions/api';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = () => <ManageScreen id="c9" />;
const staff = [
  { id: 's1', role: 'ORGANIZER', userId: 'u-me', user: { username: 'ahmed_rx' } },
  { id: 's2', role: 'HEAD_JUDGE', userId: 'u-2', user: { username: 'hj' } },
  { id: 's3', role: 'JUDGE', userId: 'u-3', user: { username: 'j' } },
];
const zeros = { participants: 0, paidRegistrations: 0, freeRegistrations: 0, pendingPayments: 0, revenue: 0, pendingSubmissions: 0, pendingJudging: 0, approvedSubmissions: 0, rejectedSubmissions: 0 };
const backend = () => orgBackend().on('GET', '/competitions/c9/staff', [200, staff]);

describe('overview on a computer', () => {
  beforeEach(() => setWide(true));

  it('two rows of figures: the dashboard's, and the judges of the team; the state card stays above', async () => {
    const screen = await renderScreen(open, backend());
    expect((await screen.findByTestId('ov-kpi-participants-value')).props.children).toBe('5');
    expect(screen.getByTestId('ov-kpi-paid-value').props.children).toBe('1');
    expect(screen.getByTestId('ov-kpi-to-collect-value').props.children).toBe('2');
    expect(screen.getByTestId('ov-kpi-revenue-value').props.children).toBe(formatMoney(35000, 'TND', 'en'));
    expect(screen.getByText(/^Today, /)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('ov-kpi-judges-value').props.children).toBe('2'));
    expect(screen.getByTestId('ov-kpi-to-judge-value').props.children).toBe('0');
    expect(screen.getByTestId('org-state')).toBeTruthy();
    expect(screen.queryByText('Figures')).toBeNull();
  });

  it('registrations per day: one bar per day from the first to the last, the cancelled one left out', async () => {
    // r4 on 19 Oct, r2 on 20 Oct, r1 and r3 on 21 Oct; Omar's registration of 22 Oct was cancelled.
    const screen = await renderScreen(open, backend());
    expect(await screen.findByText('4 registrations')).toBeTruthy();
    expect(screen.getByTestId('bar-2026-10-19').props.accessibilityLabel).toMatch(/: 1$/);
    expect(screen.getByTestId('bar-2026-10-20').props.accessibilityLabel).toMatch(/: 1$/);
    expect(screen.getByTestId('bar-2026-10-21').props.accessibilityLabel).toMatch(/: 2$/);
    expect(screen.queryByTestId('bar-2026-10-22')).toBeNull();
  });

  it('a category opens the participants of that category; « See all » opens every one', async () => {
    const screen = await renderScreen(open, backend());
    await fireEvent.press(await screen.findByTestId('ov-cat-k2'));
    expect(await screen.findByTestId('reg-r2')).toBeTruthy();
    expect(screen.getByTestId('reg-r4')).toBeTruthy();
    expect(screen.queryByTestId('reg-r1')).toBeNull();
    expect(screen.getByTestId('org-menu-participants').props.accessibilityState?.selected).toBe(true);
    await fireEvent.press(screen.getByTestId('org-menu-dashboard'));
    await fireEvent.press(await screen.findByTestId('ov-cat-all'));
    expect(await screen.findByTestId('reg-r1')).toBeTruthy();
    expect(screen.getByTestId('reg-r2')).toBeTruthy();
  });

  it('gender in percentages that add up to 100, or in numbers', async () => {
    // Women: r2, r4 (RX Women). Men: r1, r3 (RX Men); r5 is cancelled.
    const screen = await renderScreen(open, backend());
    expect((await screen.findByTestId('ov-gender-women')).props.children).toBe('50%');
    expect(screen.getByTestId('ov-gender-men').props.children).toBe('50%');
    expect(screen.getByTestId('ov-gender-mixed').props.children).toBe('0%');
    await fireEvent.press(screen.getByTestId('ov-gender-as-numbers'));
    expect(screen.getByTestId('ov-gender-women').props.children).toBe('2');
    expect(screen.getByTestId('ov-gender-mixed').props.children).toBe('0');
    expect(screen.getByTestId('ov-gender-as-numbers').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('scores: a ring of to judge / validated / refused with its legend', async () => {
    const screen = await renderScreen(open, backend().on('GET', '/competitions/c9/dashboard', [200, { ...zeros, participants: 5, pendingJudging: 3, approvedSubmissions: 5, rejectedSubmissions: 1 }]));
    expect((await screen.findByLabelText('Scores to judge 3, Validated 5, Rejected 1')).props.accessibilityRole).toBe('image');
    expect(screen.getByText('9')).toBeTruthy();
  });

  it('an event without data: each card says so instead of drawing empty charts', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/dashboard', [200, zeros]).on('GET', '/competitions/c9/registrations', [200, []]).on('GET', '/competitions/c9/staff', [200, []]));
    for (const id of ['ov-per-day', 'ov-categories', 'ov-scores', 'ov-gender']) expect((await screen.findByTestId(`${id}-empty`)).props.children).toBe('No data yet');
    expect(screen.queryByText('NaN%')).toBeNull();
  });

  it('the phone keeps its figures and its breakdown', async () => {
    setWide(false);
    const screen = await renderScreen(open, backend());
    expect(await screen.findByText('Figures')).toBeTruthy();
    expect(await screen.findByTestId('day-2026-10-21')).toBeTruthy();
    expect(screen.queryByTestId('ov-kpi-participants')).toBeNull();
  });
});
```
`Figures` is the English text of lot A's `orgFigures`, the section title the phone keeps.

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-overview.test.tsx`
Expected: FAIL: `ov-kpi-participants-value` is not found.

- [ ] **Step 3: Write the overview**

`apps/mobile-rn/src/features/competitions/organizer/overview.tsx`:
```tsx
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { displayText, space, useTheme, webDense } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { BarChart, Ring } from '../../../core/widgets/chart';
import { ErrorText } from '../../../core/widgets/error';
import { LinkButton, Txt } from '../../../core/widgets/kit';
import { Grid, KpiCard, SectionCard, SegmentedInline } from '../../../core/widgets/web';
import { formatMoney } from '../api';
import { useRegistrations, useStaff } from './api';
import { distribution } from './logic-b';
import { fillDays, judgeCount, percentages, topCategories } from './logic-web';
import type { Go } from './web';

/** « Vue d'ensemble » on a computer (analysis §3 item 7, Circle21 refs 01–04): two rows of figures, registrations per day, then categories, scores and gender. */
export function OverviewWeb({ c, d, onGo }: { c: Json; d: Json; onGo: Go }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const staff = useStaff(c.id);
  const [as, setAs] = useState<'percent' | 'numbers'>('percent');
  const dist = regs.data ? distribution(regs.data, c.categories ?? []) : null;
  const days = dist ? fillDays(dist.perDay) : [];
  const live = dist ? dist.perDay.reduce((s, x) => s + x.count, 0) : 0;
  const top = dist ? topCategories(dist.byCategory) : [];
  const gender = dist ? [dist.women, dist.men, dist.mixed] : [0, 0, 0];
  const pct = percentages(gender);
  const scores = [d.pendingJudging ?? 0, d.approvedSubmissions ?? 0, d.rejectedSubmissions ?? 0];
  // « No data » only once the registrations are in: while they load the cards stay empty.
  const noData = (has: boolean) => (dist && !has ? t('orgNoData') : null);
  const today = t('orgKpiToday', { date: formatDate(new Date(), locale, { day: 'numeric', month: 'long' }) });
  return (
    <View style={{ gap: webDense.gap }}>
      <Grid min={180} counts={[4, 2, 1]}>
        <KpiCard testID="ov-kpi-participants" title={t('orgParticipants')} caption={t('orgKpiParticipantsHint')} value={String(d.participants)} />
        <KpiCard testID="ov-kpi-paid" title={t('orgPaid')} caption={t('orgKpiPaidHint')} value={String(d.paidRegistrations)} />
        <KpiCard testID="ov-kpi-to-collect" title={t('orgToCollect')} caption={t('orgKpiToCollectHint')} value={String(d.pendingPayments)} />
        <KpiCard testID="ov-kpi-revenue" title={t('orgRevenue')} caption={today} value={formatMoney(d.revenue, c.currency, locale)} />
      </Grid>
      <Grid min={180} counts={[4, 2, 1]}>
        <KpiCard testID="ov-kpi-judges" title={t('orgTeamJudges')} caption={t('orgKpiJudgesHint')} value={staff.data ? String(judgeCount(staff.data)) : '—'} />
        <KpiCard testID="ov-kpi-to-judge" title={t('orgToJudge')} caption={t('orgKpiToJudgeHint')} value={String(scores[0])} />
        <KpiCard testID="ov-kpi-approved" title={t('orgApproved')} caption={t('orgKpiApprovedHint')} value={String(scores[1])} />
        <KpiCard testID="ov-kpi-rejected" title={t('orgRejected')} caption={t('orgKpiRejectedHint')} value={String(scores[2])} />
      </Grid>
      <ErrorText error={regs.error} />
      <SectionCard testID="ov-per-day" title={t('orgRegsCount', { count: live })} caption={t('orgPerDay')} empty={noData(days.length > 0)}>
        <BarChart label={t('orgPerDay')} data={days.map((x) => ({ key: x.day, label: formatDate(`${x.day}T12:00:00`, locale, { day: 'numeric', month: 'short' }), value: x.count }))} />
      </SectionCard>
      <Grid min={240} counts={[3, 1]}>
        <SectionCard testID="ov-categories" title={t('orgBreakdown')} action={<LinkButton testID="ov-cat-all" label={t('orgSeeAll')} onPress={() => onGo('participants')} />} empty={noData(top.length > 0)}>
          <View style={{ gap: 2 }}>
            {top.map((k) => (
              <Pressable key={k.id} testID={`ov-cat-${k.id}`} accessibilityRole="button" onPress={() => onGo('participants', { categoryId: k.id })} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36, gap: space.sm }}>
                <Txt numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>
                  {k.name}
                </Txt>
                <Txt style={{ fontSize: 14, fontWeight: '700' }}>{String(k.count)}</Txt>
              </Pressable>
            ))}
          </View>
        </SectionCard>
        <SectionCard testID="ov-scores" title={t('orgScores')} empty={scores.some((n) => n > 0) ? null : t('orgNoData')}>
          <SplitRing labels={[t('orgToJudge'), t('orgApproved'), t('orgRejected')]} values={scores} colors={[colors.outline, colors.success, colors.error]} />
        </SectionCard>
        <SectionCard testID="ov-gender" title={t('orgGender')} caption={t('orgGenderHint')} empty={noData(gender.some((n) => n > 0))}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: space.md }}>
            {(['women', 'men', 'mixed'] as const).map((g, i) => (
              <View key={g} style={{ alignItems: 'center', gap: space.xs }}>
                <Txt testID={`ov-gender-${g}`} style={displayText(28)}>
                  {as === 'percent' ? `${pct[i]}%` : String(gender[i])}
                </Txt>
                <Txt style={webDense.caption} color={colors.outline}>
                  {[t('orgWomen'), t('orgMen'), t('orgMixed')][i]}
                </Txt>
              </View>
            ))}
          </View>
          <SegmentedInline
            testID="ov-gender-as"
            label={t('orgShowAs')}
            value={as}
            onChange={setAs}
            options={[
              { key: 'percent', label: t('orgShowPercent') },
              { key: 'numbers', label: t('orgShowNumbers') },
            ]}
          />
        </SectionCard>
      </Grid>
    </View>
  );
}

/** A ring split in parts, the total in the middle, a legend with a dot per part (Circle21 ref 04). */
function SplitRing({ labels, values, colors }: { labels: string[]; values: number[]; colors: string[] }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xl }}>
      <Ring label={labels.map((l, i) => `${l} ${values[i]}`).join(', ')} parts={values.map((value, i) => ({ value, color: colors[i] }))}>
        <Txt style={displayText(28)}>{String(values.reduce((a, b) => a + b, 0))}</Txt>
      </Ring>
      <View style={{ flex: 1, gap: space.sm }}>
        {labels.map((l, i) => (
          <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors[i] }} />
            <Txt numberOfLines={1} style={{ flex: 1, fontSize: 13 }} color={theme.colors.outline}>
              {l}
            </Txt>
            <Txt style={{ fontSize: 13, fontWeight: '700' }}>{String(values[i])}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}
```
In the scores test, `9` is the ring's center and `5` would also match the legend. That is why the test looks up `9`, which only the center shows.

- [ ] **Step 4: The dashboard uses it on a computer**

Replace the whole content of `apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx` with:
```tsx
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { Loading, SectionHeader, StatCard } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Card, ListGroup, ListRow, Screen, Txt } from '../../../core/widgets/kit';
import { formatMoney } from '../api';
import { statusLabelForCompetition } from '../screens';
import { useOrganizerDashboard } from './api';
import { RegistrationsBreakdown } from './breakdown';
import { CHECKLIST, TAB_FOR, type ChecklistItem } from './logic';
import { OverviewWeb } from './overview';
import { OrgPageHeader } from './page';
import { usePublication } from './publication';
import { useWideWeb, type Go } from './web';

export function DashboardTab({ c, onGo }: { c: Json; onGo: Go }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const wide = useWideWeb();
  const dash = useOrganizerDashboard(c.id);
  const { state, missing, canRequest, busy, error, request, share } = usePublication(c);
  const labels: Record<ChecklistItem, string> = { DESCRIPTION: t('orgCheckDescription'), DATES: t('orgCheckDates'), COVER: t('orgCheckCover'), CATEGORY: t('orgCheckCategory'), WOD: t('orgCheckWod') };
  const stateText = {
    DRAFT: t('orgStateDraft'),
    REQUESTED: t('orgStateRequested'),
    RETURNED: t('orgStateReturned'),
    PUBLISHED: t('orgStatePublished', { status: statusLabelForCompetition(t, c.status) }),
    CANCELLED: t('orgStateCancelled'),
  }[state];

  const d = dash.data;
  return (
    <>
      <OrgPageHeader tab="dashboard" />
      <Screen>
        <Card testID="org-state" style={{ gap: space.sm }}>
          <Txt variant="title">{stateText}</Txt>
          {state === 'RETURNED' ? (
            <Txt testID="org-note" color={colors.error}>
              {c.publicationNote}
            </Txt>
          ) : null}
        </Card>
        {state === 'PUBLISHED' ? (
          <Button testID="org-share" kind="outlined" icon="share" label={t('orgShare')} onPress={share} />
        ) : state === 'CANCELLED' ? null : (
          <>
            <SectionHeader title={t('orgChecklist')} />
            <ListGroup>
              {CHECKLIST.map((item) => {
                const todo = missing.includes(item);
                return (
                  <ListRow
                    key={item}
                    testID={`check-${item}`}
                    icon={todo ? 'radio-button-unchecked' : 'check-circle'}
                    title={labels[item]}
                    subtitle={todo ? t('orgGoTo') : null}
                    chevron={todo}
                    onPress={todo ? () => onGo(TAB_FOR[item]) : undefined}
                  />
                );
              })}
            </ListGroup>
            <ErrorText error={error} />
            <Button testID="org-request" label={t('orgRequestPublication')} busy={busy} disabled={!canRequest} onPress={request} />
          </>
        )}
        {wide ? null : <SectionHeader title={t('orgFigures')} />}
        {dash.isError ? (
          <ErrorView error={dash.error} onRetry={() => dash.refetch()} />
        ) : !d ? (
          <Loading />
        ) : wide ? (
          <OverviewWeb c={c} d={d} onGo={onGo} />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            <Figure label={t('orgParticipants')} value={String(d.participants)} />
            <Figure label={t('orgPaid')} value={String(d.paidRegistrations)} />
            <Figure label={t('orgToCollect')} value={String(d.pendingPayments)} />
            <Figure label={t('orgRevenue')} value={formatMoney(d.revenue, c.currency, locale)} />
            <Figure label={t('orgToJudge')} value={String(d.pendingJudging)} />
            <Figure label={t('orgApproved')} value={String(d.approvedSubmissions)} />
            <Figure label={t('orgRejected')} value={String(d.rejectedSubmissions)} />
          </View>
        )}
        {wide ? null : <RegistrationsBreakdown c={c} />}
      </Screen>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '47%' }}>
      <StatCard label={label}>
        <Txt variant="headline">{value}</Txt>
      </StatCard>
    </View>
  );
}
```
This is the lot B file plus Task 6's header row. The phone tree is the same. The only reorder is that `!d ? <Loading />` is tested before the layout choice, and it renders the same thing as before.

- [ ] **Step 5: One `go` for every page; Participants opens on a category**

In `apps/mobile-rn/src/features/competitions/organizer/manage.tsx`:
- Replace `import { phoneTab, useWideWeb } from './web';` with `import { phoneTab, useWideWeb, type Go } from './web';`.
- Under `const [tab, setTab] = useState<ManageTab>(initialTab);`, add:
```tsx
  const [focus, setFocus] = useState<{ categoryId: string } | null>(null);
  /** Opens a page; only the overview's categories open Participants already filtered. */
  const go: Go = (next, f) => {
    setFocus(f ?? null);
    setTab(next);
  };
```
- In `page`, replace every `onGo={setTab}` with `onGo={go}`, and replace `{shown === 'participants' && <ParticipantsTab c={c} />}` with:
```tsx
      {/* Keyed on the category: a new « filtered on » opens a fresh list. */}
      {shown === 'participants' && <ParticipantsTab key={focus?.categoryId ?? 'all'} c={c} initialCategoryId={focus?.categoryId ?? null} />}
```
- Replace `<OrganizerWeb c={c} tab={tab} onTab={setTab}>` with `<OrganizerWeb c={c} tab={shown} onTab={go}>`, and in the chips `onPress={() => setTab(k)}` with `onPress={() => go(k)}`.

In `apps/mobile-rn/src/features/competitions/organizer/participants.tsx`, replace:
```tsx
export function ParticipantsTab({ c }: { c: Json }) {
```
with:
```tsx
export function ParticipantsTab({ c, initialCategoryId = null }: { c: Json; initialCategoryId?: string | null }) {
```
and `const [categoryId, setCategoryId] = useState<string | null>(null);` with `const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId);`.

- [ ] **Step 6: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes (the lot B dashboard breakdown test runs on the phone layout and is unchanged), no type error.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/overview.tsx apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/src/features/competitions/organizer/participants.tsx apps/mobile-rn/test/screens/organizer-overview.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer overview on a computer: KPI rows with judges, registrations per day, top categories, scores ring, gender in % or numbers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Finances, a computer page under Tableau de bord

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/finances.tsx`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/web.ts` (`ORG_MENU`: the dashboard section holds Vue d'ensemble and Finances)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/manage.tsx` (renders `FinancesTab`)
- Modify: `apps/mobile-rn/test/core/organizer-web.test.ts` (lot 1 « the menu holds every tab exactly once » gets `finances`)
- Test: `apps/mobile-rn/test/screens/organizer-finances.test.tsx`

**Interfaces:**
- Consumes: Task 1 `finance`, `filterTransactions`, `transactionsCsv`, `TxFilter`, `phoneTab`, keys `orgFin*`, `orgCol*`, `orgKpiToCollectHint`; Task 2 `Select bare`; Task 3 `Grid`, `KpiCard`, `PageHeader`, `SearchField`; Task 4 `DataTable`, `Column`; Task 6 `OrgPageHeader`, `ExportButton`; lot B `useRegistrations`, `personName`, `csvFileName`, `csvSeparator`; lot 1 `exportCsv`.
- Produces: `FinancesTab({ c })`. TestIDs: `fin-gross`, `fin-discounts`, `fin-collected`, `fin-to-collect`, `fin-free`, `fin-refunded` (+ `-value`), `fin-header`, `fin-search`, `fin-pay` (options `fin-pay-<ALL|PAID|PENDING|FREE|REFUNDED>`), `fin-export`, `fin-table`, rows `fin-row-<registrationId>`. `ORG_MENU[0] = { key: 'dashboard', tabs: ['dashboard', 'finances'] }`.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-finances.test.tsx`:
```tsx
import { act, fireEvent, within } from 'expo-router/testing-library';

import { formatMoney } from '../../src/features/competitions/api';
import * as exportModule from '../../src/features/competitions/organizer/export';
import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend, regs } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = (tab?: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const priced = (r: object, originalPrice: number, discount: number) => ({ ...r, originalPrice, discount });
// Same money as the Task 1 unit test: gross 185 000, discounts 45 000, collected 35 000, to collect 75 000, 1 free, refunded 30 000.
const rows = [
  priced(regs[0], 40000, 0),
  priced(regs[1], 40000, 5000),
  priced(regs[2], 40000, 40000),
  priced(regs[3], 35000, 0),
  priced(regs[4], 40000, 0),
  { ...priced(regs[1], 30000, 0), id: 'r6', paymentStatus: 'REFUNDED', registrationStatus: 'REFUNDED', finalPrice: 30000, registeredAt: '2026-10-23T09:00:00.000Z' },
];
const backend = () => orgBackend().on('GET', '/competitions/c9/registrations', [200, rows]);
const money = (n: number) => formatMoney(n, 'TND', 'en');
const shownRows = (screen: Awaited<ReturnType<typeof renderScreen>>) => screen.getAllByTestId(/^fin-row-/).map((el) => el.props.testID);

describe('finances on a computer', () => {
  beforeEach(() => setWide(true));
  afterEach(() => jest.restoreAllMocks());

  it('the six figures and the manual-payment note', async () => {
    const screen = await renderScreen(open('finances'), backend());
    expect((await screen.findByTestId('fin-gross-value')).props.children).toBe(money(185000));
    expect(screen.getByTestId('fin-discounts-value').props.children).toBe(money(45000));
    expect(screen.getByTestId('fin-collected-value').props.children).toBe(money(35000));
    expect(screen.getByTestId('fin-to-collect-value').props.children).toBe(money(75000));
    expect(screen.getByTestId('fin-free-value').props.children).toBe('1');
    expect(screen.getByTestId('fin-refunded-value').props.children).toBe(money(30000));
    expect(screen.getByText('Manual payment, no online fees')).toBeTruthy();
  });

  it('transactions: newest first, the cancelled registration left out, the discount shown', async () => {
    const screen = await renderScreen(open('finances'), backend());
    expect(await screen.findByTestId('fin-row-r6')).toBeTruthy();
    expect(shownRows(screen)).toEqual(['fin-row-r6', 'fin-row-r3', 'fin-row-r1', 'fin-row-r2', 'fin-row-r4']);
    expect(within(screen.getByTestId('fin-row-r2')).getByText(`− ${money(5000)}`)).toBeTruthy();
    expect(within(screen.getByTestId('fin-header')).getByText('Transactions')).toBeTruthy();
  });

  it('search without accents, then one payment status', async () => {
    const screen = await renderScreen(open('finances'), backend());
    await fireEvent.changeText(await screen.findByTestId('fin-search'), 'kefi');
    expect(shownRows(screen)).toEqual(['fin-row-r3']);
    await fireEvent.changeText(screen.getByTestId('fin-search'), '');
    await fireEvent.press(screen.getByTestId('fin-pay'));
    await fireEvent.press(screen.getByTestId('fin-pay-PENDING'));
    expect(shownRows(screen)).toEqual(['fin-row-r1', 'fin-row-r4']);
  });

  it('« Export » downloads the transactions shown', async () => {
    const download = jest.spyOn(exportModule, 'exportCsv').mockImplementation(() => {});
    const screen = await renderScreen(open('finances'), backend());
    await fireEvent.changeText(await screen.findByTestId('fin-search'), 'amira');
    await fireEvent.press(screen.getByTestId('fin-export'));
    expect(download.mock.calls[0][0]).toBe('event-transactions.csv');
    const lines = (download.mock.calls[0][1] as string).split('\n');
    expect(lines[0]).toBe('registered_at,name,username,category,price,discount,amount,currency,payment');
    // r2 and the refunded r6 are both Amira's.
    expect(lines).toHaveLength(3);
  });

  it('no payment yet: says so, nothing to export', async () => {
    const screen = await renderScreen(open('finances'), orgBackend().on('GET', '/competitions/c9/registrations', [200, []]));
    expect(await screen.findByText('No payment')).toBeTruthy();
    expect(screen.getByTestId('fin-export').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('a computer menu entry under « Dashboard », next to the overview', async () => {
    const screen = await renderScreen(open(), backend());
    await fireEvent.press(await screen.findByTestId('org-menu-finances'));
    expect(await screen.findByTestId('fin-table')).toBeTruthy();
    expect(within(screen.getByTestId('org-page-header')).getByText('Finances')).toBeTruthy();
    expect(within(screen.getByTestId('org-menu')).getByText('Dashboard')).toBeTruthy();
    expect(screen.getByTestId('org-menu-finances').props.accessibilityState?.selected).toBe(true);
  });

  it('a narrow window shows the dashboard instead of Finances, and Finances again once wide', async () => {
    const screen = await renderScreen(open('finances'), backend());
    expect(await screen.findByTestId('fin-table')).toBeTruthy();
    await act(async () => setWide(false));
    expect(await screen.findByTestId('org-state')).toBeTruthy();
    expect(screen.getByTestId('org-tab-dashboard').props.accessibilityState?.selected).toBe(true);
    expect(screen.queryByTestId('fin-table')).toBeNull();
    expect(screen.queryByTestId('org-tab-finances')).toBeNull();
    await act(async () => setWide(true));
    expect(await screen.findByTestId('fin-table')).toBeTruthy();
  });
});
```

In `apps/mobile-rn/test/core/organizer-web.test.ts`, in « the menu holds every tab of the organizer space exactly once », replace the expected list with `['announcements', 'categories', 'coupons', 'dashboard', 'finances', 'general', 'leaderboard', 'participants', 'planning', 'team', 'wods']`.

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-finances.test.tsx test/core/organizer-web.test.ts`
Expected: FAIL: `fin-gross-value` is not found, and the menu list has no `finances`.

- [ ] **Step 3: Write the page**

`apps/mobile-rn/src/features/competitions/organizer/finances.tsx`:
```tsx
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { EmptyState, Loading, StatusPill } from '../../../core/widgets/common';
import { ErrorView } from '../../../core/widgets/error';
import { Select } from '../../../core/widgets/pickers';
import { DataTable, type Column } from '../../../core/widgets/table';
import { Grid, KpiCard, PageHeader, SearchField } from '../../../core/widgets/web';
import { formatMoney } from '../api';
import { useRegistrations } from './api';
import { exportCsv } from './export';
import { csvFileName, csvSeparator, personName } from './logic-b';
import { filterTransactions, finance, transactionsCsv, type TxFilter } from './logic-web';
import { ExportButton, OrgPageHeader } from './page';

const FILTERS: TxFilter[] = ['ALL', 'PAID', 'PENDING', 'FREE', 'REFUNDED'];

/** « Finances » on a computer (analysis §3 item 8, Circle21 ref 01): the money of the event from the registrations, and every transaction. Payments are recorded by hand: no online fees. */
export function FinancesTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const [q, setQ] = useState('');
  const [payment, setPayment] = useState<TxFilter>('ALL');
  if (regs.isError) return <ErrorView error={regs.error} onRetry={() => regs.refetch()} />;
  if (!regs.data) return <Loading />;
  const f = finance(regs.data);
  const shown = filterTransactions(f.rows, { q, payment });
  const money = (n: number, currency: string = c.currency) => formatMoney(n, currency, locale);
  const payLabel: Record<string, string> = { PENDING: t('orgPayPending'), PAID: t('orgPayPaid'), FREE: t('orgPayFree'), REFUNDED: t('orgPayRefunded') };
  const columns: Column<Json>[] = [
    { key: 'date', label: t('orgColDate'), width: 120, render: (r) => formatDate(r.registeredAt, locale) },
    { key: 'name', label: t('orgColName'), flex: 2, render: (r) => personName(r) },
    { key: 'category', label: t('orgColCategory'), flex: 1.5, render: (r) => r.category?.name ?? '' },
    { key: 'price', label: t('orgColPrice'), width: 110, align: 'end', render: (r) => money(r.originalPrice ?? r.finalPrice ?? 0, r.currency) },
    { key: 'discount', label: t('orgColDiscount'), width: 110, align: 'end', render: (r) => (r.discount ? `− ${money(r.discount, r.currency)}` : '—') },
    { key: 'amount', label: t('orgColAmount'), width: 110, align: 'end', render: (r) => money(r.finalPrice ?? 0, r.currency) },
    {
      key: 'payment',
      label: t('orgColPayment'),
      width: 120,
      render: (r) => <StatusPill label={payLabel[r.paymentStatus] ?? r.paymentStatus} color={r.paymentStatus === 'PAID' ? colors.primary : r.paymentStatus === 'REFUNDED' ? colors.error : colors.outline} />,
    },
  ];
  const header = (
    <View style={{ gap: space.lg }}>
      <Grid min={200} counts={[3, 2, 1]}>
        <KpiCard testID="fin-gross" title={t('orgFinGross')} caption={t('orgFinGrossHint')} value={money(f.gross)} />
        <KpiCard testID="fin-discounts" title={t('orgFinDiscounts')} caption={t('orgFinDiscountsHint')} value={money(f.discounts)} />
        <KpiCard testID="fin-collected" title={t('orgFinCollected')} caption={t('orgFinCollectedHint')} value={money(f.collected)} footnote={t('orgFinManual')} />
        <KpiCard testID="fin-to-collect" title={t('orgToCollect')} caption={t('orgKpiToCollectHint')} value={money(f.toCollect)} />
        <KpiCard testID="fin-free" title={t('orgFinFree')} caption={t('orgFinFreeHint')} value={String(f.free)} />
        <KpiCard testID="fin-refunded" title={t('orgFinRefunded')} caption={t('orgFinRefundedHint')} value={money(f.refunded)} />
      </Grid>
      <PageHeader
        flush
        testID="fin-header"
        title={t('orgFinTransactions')}
        actions={
          <>
            <SearchField testID="fin-search" placeholder={t('orgFinSearch')} value={q} onChangeText={setQ} />
            <Select testID="fin-pay" bare label={t('orgColPayment')} value={payment} options={FILTERS.map((p) => ({ value: p, label: p === 'ALL' ? t('orgRegAnyPayment') : payLabel[p] }))} onChange={(v) => setPayment(v as TxFilter)} />
            <ExportButton testID="fin-export" disabled={shown.length === 0} onPress={() => exportCsv(csvFileName(c, 'transactions'), transactionsCsv(shown, csvSeparator(locale)))} />
          </>
        }
      />
    </View>
  );
  return (
    <>
      <OrgPageHeader tab="finances" />
      <DataTable testID="fin-table" rows={shown} keyOf={(r) => r.id} nameOf={personName} rowTestID={(r) => `fin-row-${r.id}`} columns={columns} header={header} empty={<EmptyState icon="payments" message={t('orgFinNone')} />} />
    </>
  );
}
```

- [ ] **Step 4: In the menu and the organizer screen**

In `apps/mobile-rn/src/features/competitions/organizer/web.ts`, replace `{ key: 'dashboard', tabs: ['dashboard'] },` with `{ key: 'dashboard', tabs: ['dashboard', 'finances'] },`.

In `apps/mobile-rn/src/features/competitions/organizer/manage.tsx`, add `import { FinancesTab } from './finances';`, and in `page` add after the dashboard line:
```tsx
      {shown === 'finances' && <FinancesTab c={c} />}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes, no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/finances.tsx apps/mobile-rn/src/features/competitions/organizer/web.ts apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/test/core/organizer-web.test.ts apps/mobile-rn/test/screens/organizer-finances.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer Finances page on a computer: gross, discounts, collected, to collect, free, refunded, transactions with search, filter and export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Participants as a table, with a side panel and batch payment

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/payments.tsx` (« Marquer payé » shared by phone and computer, and the batch)
- Create: `apps/mobile-rn/src/features/competitions/organizer/participants-web.tsx`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/participants.tsx` (computer → `ParticipantsWeb`; the phone list uses `useMarkPaid`)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/logic-b.ts` (`PAYMENT_FILTERS`)
- Test: `apps/mobile-rn/test/screens/organizer-participants-web.test.tsx`

**Interfaces:**
- Consumes: Task 1 `markPaidBatch`, `PayBatch`, `athleteHeats`, `standing`, keys `orgCol*`, `orgRowActions`, `orgOpenDetails`, `orgSelectRow`, `orgSelectAll`, `orgMarkPaidBatch`, `orgMarkPaidBatchConfirm`, `orgBatchSummary`, `orgBatchLeft`, `orgDetailHeats`, `orgDetailNoHeat`, `orgReceiptButton`; Task 2 `Select bare`; Task 3 `SearchField`; Task 4 `DataTable`, `SidePanel`; Task 6 `OrgPageHeader`, `ExportButton`; Task 7 `initialCategoryId`; lot B `filterRegistrations`, `toCollect`, `registrationsCsv`, `personName`, `useRegistrations`; `useHeats`, `formatMoney` (`../api`).
- Produces:
  - `payments.tsx`: `paymentLabels(t): Record<string, string>`; `useMarkPaid(c)` → `{ busy, error, info, paying, receipt, money(r), ask(r | null), markPaid(r), showReceipt(r), closeReceipt() }`; `type MarkPaid`; `MarkPaidDialogs({ pay })`; `useMarkPaidBatch(c)` → `{ busy, result: PayBatch | null, run(ids): Promise<PayBatch | null>, clear() }`.
  - `logic-b.ts`: `PAYMENT_FILTERS: PaymentFilter[] = ['ALL', 'PENDING', 'PAID', 'FREE']`.
  - `ParticipantsWeb({ c, initialCategoryId })`. TestIDs: `reg-table` (+ `-head`, `-check-all`, `-check-<id>`, `-menu-<id>`), rows `reg-<id>` (same as the phone), `reg-search`, `reg-pay` (options `reg-pay-<ALL|PENDING|PAID|FREE>`), `reg-cat`, `reg-csv`, `reg-batch`, `reg-batch-summary`, menu items `reg-open-<id>` / `reg-paid-<id>`, panel `reg-panel` (+ `-modal`, `-backdrop`, `-close`), `reg-panel-status`, `reg-panel-heat-<heatId>`, `reg-panel-pay`, `reg-panel-receipt`, `reg-panel-close`.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-participants-web.test.tsx`:
```tsx
import { act, fireEvent, waitFor, within } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend, regs } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = () => <ManageScreen id="c9" initialTab="participants" />;
const heats = [
  { id: 'h1', number: 1, name: 'RX Women · Heat 1', startsAt: '2026-12-12T09:00:00.000Z', durationMin: 12, laneCount: 4, workout: null, category: { id: 'k2', name: 'RX Women' }, lanes: [{ lane: 2, registrationId: 'r2', athlete: { id: 'u-r2', fullName: 'Amira Trabelsi', username: 'amira' } }] },
];
const backend = () => orgBackend().on('GET', '/competitions/c9/heats', [200, heats]);
/** Registrations after r1 was marked paid. */
const r1Paid = () => regs.map((r) => (r.id === 'r1' ? { ...r, paymentStatus: 'PAID', registrationStatus: 'CONFIRMED' } : r));

async function selectAllToCollect(screen: Awaited<ReturnType<typeof renderScreen>>) {
  await fireEvent.press(await screen.findByTestId('tab-collect'));
  await fireEvent.press(screen.getByTestId('reg-table-check-all'));
  await fireEvent.press(screen.getByTestId('reg-batch'));
}

describe('participants on a computer', () => {
  beforeEach(() => setWide(true));

  it('a table: header strip, bold uppercase names, filters, search and export in the header row', async () => {
    const screen = await renderScreen(open, backend());
    expect(await screen.findByTestId('reg-table-head')).toBeTruthy();
    expect(StyleSheet.flatten(within(screen.getByTestId('reg-r1')).getByText('Sami Ben Ali').props.style)).toMatchObject({ textTransform: 'uppercase', fontWeight: '700' });
    const header = screen.getByTestId('org-page-header');
    expect(within(header).getByTestId('reg-search')).toBeTruthy();
    expect(within(header).getByTestId('reg-csv').props.accessibilityLabel).toBe('Export (CSV)');
    await fireEvent.press(within(header).getByTestId('reg-pay'));
    await fireEvent.press(screen.getByTestId('reg-pay-PAID'));
    expect(screen.getByTestId('reg-r2')).toBeTruthy();
    expect(screen.queryByTestId('reg-r1')).toBeNull();
    // Checkboxes only in « To collect ».
    expect(screen.queryByTestId('reg-table-check-all')).toBeNull();
  });

  it('the row menu opens the record or asks to mark paid', async () => {
    const screen = await renderScreen(open, backend());
    await fireEvent.press(await screen.findByTestId('reg-table-menu-r1'));
    await fireEvent.press(screen.getByTestId('reg-paid-r1'));
    expect(screen.getByText(/^Did Sami Ben Ali pay /)).toBeTruthy();
  });

  it('a click on a row opens the light side panel: payment, heats and lanes; Esc closes it', async () => {
    const screen = await renderScreen(open, backend());
    await fireEvent.press(await screen.findByTestId('reg-r2'));
    const panel = await screen.findByTestId('reg-panel');
    expect(within(panel).getByText('Amira Trabelsi')).toBeTruthy();
    expect(within(panel).getByTestId('reg-panel-heat-h1')).toBeTruthy();
    expect(within(panel).getByText(/Lane 2$/)).toBeTruthy();
    expect(within(within(panel).getByTestId('reg-panel-status')).getByText('Paid')).toBeTruthy();
    expect(within(panel).getByTestId('reg-panel-receipt')).toBeTruthy();
    expect(screen.queryByTestId('reg-panel-pay')).toBeNull();
    await act(async () => screen.UNSAFE_getAllByProps({ testID: 'reg-panel-modal' })[0].props.onRequestClose());
    expect(screen.queryByTestId('reg-panel')).toBeNull();
  });

  it('an athlete without a heat: the panel says so', async () => {
    const screen = await renderScreen(open, backend());
    await fireEvent.press(await screen.findByTestId('reg-r1'));
    expect(await within(await screen.findByTestId('reg-panel')).findByText('Not in a heat yet')).toBeTruthy();
  });

  it('« Mark paid » from the panel: confirmation, one request even on a double click, the receipt; the panel shows the new state', async () => {
    let paid = false;
    const b = backend()
      .on('GET', '/competitions/c9/registrations', () => [200, paid ? r1Paid() : regs])
      .on('POST', '/competitions/c9/registrations/r1/mark-paid', () => {
        paid = true;
        return [200, {}];
      });
    const screen = await renderScreen(open, b);
    await fireEvent.press(await screen.findByTestId('reg-r1'));
    await fireEvent.press(await screen.findByTestId('reg-panel-pay'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('dialog-confirm'));
      fireEvent.press(screen.getByTestId('dialog-confirm'));
    });
    expect(await screen.findByText(/^Fitness League receipt/)).toBeTruthy();
    expect(b.calls('POST', '/competitions/c9/registrations/r1/mark-paid')).toHaveLength(1);
    await waitFor(() => expect(within(screen.getByTestId('reg-panel-status')).getByText('Paid')).toBeTruthy());
    expect(screen.queryByTestId('reg-panel-pay')).toBeNull();
  });

  it('paid elsewhere meanwhile (409): the panel says so and shows the real state', async () => {
    let settled = false;
    const b = backend()
      .on('GET', '/competitions/c9/registrations', () => [200, settled ? r1Paid() : regs])
      .on('POST', '/competitions/c9/registrations/r1/mark-paid', () => {
        settled = true;
        return [409, { code: 'CONFLICT' }];
      });
    const screen = await renderScreen(open, b);
    await fireEvent.press(await screen.findByTestId('reg-r1'));
    await fireEvent.press(await screen.findByTestId('reg-panel-pay'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await within(screen.getByTestId('reg-panel')).findByText('This registration was already settled. The list is up to date.')).toBeTruthy();
    await waitFor(() => expect(within(screen.getByTestId('reg-panel-status')).getByText('Paid')).toBeTruthy());
    expect(screen.queryByTestId('reg-panel-pay')).toBeNull();
  });

  it('batch: select in « To collect », one request at a time, a 409 counted « already settled », the rest go on', async () => {
    const b = backend().on('POST', '/competitions/c9/registrations/r4/mark-paid', [409, { code: 'CONFLICT' }]).on('POST', '/competitions/c9/registrations/r1/mark-paid', [200, {}]);
    const screen = await renderScreen(open, b);
    await fireEvent.press(await screen.findByTestId('tab-collect'));
    expect(screen.getByTestId('reg-batch').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('reg-table-check-all'));
    expect(within(screen.getByTestId('reg-batch')).getByText('Mark paid (2)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reg-batch'));
    expect(screen.getByText('Mark 2 registrations as paid?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('1 marked paid · 1 already settled')).toBeTruthy();
    // Oldest first, one after the other.
    expect(b.requests.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual(['/competitions/c9/registrations/r4/mark-paid', '/competitions/c9/registrations/r1/mark-paid']);
  });

  it('two quick clicks start one batch', async () => {
    const b = backend().on('POST', '/competitions/c9/registrations/r4/mark-paid', [200, {}]).on('POST', '/competitions/c9/registrations/r1/mark-paid', [200, {}]);
    const screen = await renderScreen(open, b);
    await fireEvent.press(await screen.findByTestId('tab-collect'));
    await fireEvent.press(screen.getByTestId('reg-table-check-all'));
    await fireEvent.press(screen.getByTestId('reg-batch'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('dialog-confirm'));
      fireEvent.press(screen.getByTestId('dialog-confirm'));
    });
    expect(await screen.findByText('2 marked paid · none already settled')).toBeTruthy();
    expect(b.calls('POST', '/competitions/c9/registrations/r4/mark-paid')).toHaveLength(1);
    expect(b.calls('POST', '/competitions/c9/registrations/r1/mark-paid')).toHaveLength(1);
  });

  it('an error stops the batch; the ones left stay selected for a retry', async () => {
    const b = backend().on('POST', '/competitions/c9/registrations/r4/mark-paid', [500, { code: 'INTERNAL' }]).on('POST', '/competitions/c9/registrations/r1/mark-paid', [200, {}]);
    const screen = await renderScreen(open, b);
    await selectAllToCollect(screen);
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('2 registrations left: try again.')).toBeTruthy();
    expect(screen.getByText('None marked paid · none already settled')).toBeTruthy();
    expect(b.calls('POST', '/competitions/c9/registrations/r1/mark-paid')).toHaveLength(0);
    expect(within(screen.getByTestId('reg-batch')).getByText('Mark paid (2)')).toBeTruthy();
    expect(screen.getByTestId('reg-table-check-r4').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('the phone keeps its list and its inline « Mark paid »', async () => {
    setWide(false);
    const screen = await renderScreen(open, backend());
    expect(await screen.findByTestId('reg-r1')).toBeTruthy();
    expect(screen.queryByTestId('reg-table')).toBeNull();
    expect(screen.getByTestId('reg-paid-r1')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-participants-web.test.tsx`
Expected: FAIL: `reg-table-head` is not found (the computer still shows the phone list).

- [ ] **Step 3: « Marquer payé », shared**

In `apps/mobile-rn/src/features/competitions/organizer/logic-b.ts`, under `export type PaymentFilter = 'ALL' | 'PENDING' | 'PAID' | 'FREE';`, add:
```ts
export const PAYMENT_FILTERS: PaymentFilter[] = ['ALL', 'PENDING', 'PAID', 'FREE'];
```

`apps/mobile-rn/src/features/competitions/organizer/payments.tsx`:
```tsx
import { useRef, useState } from 'react';

import type { Json } from '../../../core/api/client';
import { ApiError } from '../../../core/api/errors';
import { useLocale, useT, type T } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { formatDate } from '../../../core/utils/format';
import { Dialog, toast } from '../../../core/widgets/kit';
import { formatMoney } from '../api';
import { organizerApi, useRefreshCompetition } from './api';
import { shareOrCopy } from './export';
import { personName } from './logic-b';
import { markPaidBatch, type PayBatch } from './logic-web';

/** Payment status in words. */
export const paymentLabels = (t: T): Record<string, string> => ({ PENDING: t('orgPayPending'), PAID: t('orgPayPaid'), FREE: t('orgPayFree'), FAILED: t('orgPayFailed'), REFUNDED: t('orgPayRefunded') });

/** « Marquer payé » for one registration (are you sure, the request, the receipt), shared by the phone list and the computer table. */
export function useMarkPaid(c: Json) {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [paying, setPaying] = useState<Json | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const money = (r: Json) => formatMoney(r.finalPrice ?? 0, r.currency ?? c.currency, locale);
  const receiptOf = (r: Json, date: Date | string) => t('orgReceipt', { title: c.title, name: personName(r), category: r.category?.name ?? '', amount: money(r), date: formatDate(date, locale) });

  async function markPaid(r: Json) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await organizerApi(api).markPaid(c.id, r.id);
      setReceipt(receiptOf(r, new Date()));
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

  return {
    busy,
    error,
    info,
    paying,
    receipt,
    money,
    ask: setPaying,
    markPaid,
    /** The receipt of a registration already paid; it was paid when the registration last changed. */
    showReceipt: (r: Json) => setReceipt(receiptOf(r, r.updatedAt ?? r.registeredAt)),
    closeReceipt: () => setReceipt(null),
  };
}

export type MarkPaid = ReturnType<typeof useMarkPaid>;

/** The two dialogs of « Marquer payé »: are you sure, then the receipt to share. */
export function MarkPaidDialogs({ pay }: { pay: MarkPaid }) {
  const t = useT();
  return (
    <>
      <Dialog
        visible={pay.paying != null}
        title={t('orgMarkPaid')}
        message={pay.paying ? t('orgMarkPaidConfirm', { name: personName(pay.paying), amount: pay.money(pay.paying) }) : undefined}
        confirmLabel={t('orgMarkPaid')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          const r = pay.paying;
          pay.ask(null);
          if (r) void pay.markPaid(r);
        }}
        onCancel={() => pay.ask(null)}
      />
      <Dialog
        visible={pay.receipt != null}
        title={t('orgReceiptTitle')}
        message={pay.receipt ?? undefined}
        confirmLabel={t('orgShareReceipt')}
        cancelLabel={t('orgClose')}
        onConfirm={() => {
          const text = pay.receipt;
          pay.closeReceipt();
          if (text)
            void shareOrCopy(text).then((done) => {
              if (done === 'copied') toast(t('orgCopied'));
              else if (done === 'failed') toast(t('errorGeneric'));
            });
        }}
        onCancel={pay.closeReceipt}
      />
    </>
  );
}

/** « Marquer payé (n) »: one request at a time, a summary at the end; a second click while it runs does nothing. */
export function useMarkPaidBatch(c: Json) {
  const api = useApi();
  const refresh = useRefreshCompetition();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PayBatch | null>(null);

  async function run(ids: string[]): Promise<PayBatch | null> {
    if (running.current || ids.length === 0) return null;
    running.current = true;
    setBusy(true);
    setResult(null);
    try {
      const r = await markPaidBatch(ids, (id) => organizerApi(api).markPaid(c.id, id));
      setResult(r);
      return r;
    } finally {
      await refresh();
      running.current = false;
      setBusy(false);
    }
  }

  return { busy, result, run, clear: () => setResult(null) };
}
```

- [ ] **Step 4: The phone list uses it; the computer gets the table**

Replace the whole content of `apps/mobile-rn/src/features/competitions/organizer/participants.tsx` with:
```tsx
import { useState } from 'react';
import { FlatList, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { EmptyState, Loading, StatusPill } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Chip, ListRow, Segmented, TextField, Txt } from '../../../core/widgets/kit';
import { useRegistrations } from './api';
import { exportCsv } from './export';
import { csvFileName, csvSeparator, filterRegistrations, PAYMENT_FILTERS, personName, registrationsCsv, standing, toCollect, type PaymentFilter } from './logic-b';
import { ParticipantsWeb } from './participants-web';
import { MarkPaidDialogs, paymentLabels, useMarkPaid } from './payments';
import { useWideWeb } from './web';

/** « Participants » (spec §1.3 item 6): every registration with search and filters, « À encaisser », mark paid with a receipt, CSV. On a computer: a table, a side panel and batch payment (lot Web 2). */
export function ParticipantsTab({ c, initialCategoryId = null }: { c: Json; initialCategoryId?: string | null }) {
  const wide = useWideWeb();
  return wide ? <ParticipantsWeb c={c} initialCategoryId={initialCategoryId} /> : <ParticipantsPhone c={c} initialCategoryId={initialCategoryId} />;
}

function ParticipantsPhone({ c, initialCategoryId }: { c: Json; initialCategoryId: string | null }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const pay = useMarkPaid(c);
  const [mode, setMode] = useState<'all' | 'collect'>('all');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId);
  const [payment, setPayment] = useState<PaymentFilter>('ALL');
  const payLabel = paymentLabels(t);

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
            {PAYMENT_FILTERS.map((p) => (
              <Chip key={p} testID={`reg-pay-${p}`} label={p === 'ALL' ? t('orgRegAnyPayment') : payLabel[p]} selected={payment === p} onPress={() => setPayment(p)} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Chip testID="reg-cat-all" label={t('orgAllCategories')} selected={categoryId == null} onPress={() => setCategoryId(null)} />
            {(c.categories ?? []).map((k: Json) => (
              <Chip key={k.id} testID={`reg-cat-${k.id}`} label={k.name} selected={categoryId === k.id} onPress={() => setCategoryId(k.id)} />
            ))}
          </View>
          <Button testID="reg-csv" kind="outlined" icon="file-download" label={t('orgExport')} disabled={rows.length === 0} onPress={() => exportCsv(csvFileName(c, 'participants'), registrationsCsv(rows, csvSeparator(locale)))} />
        </>
      ) : (
        <Txt color={colors.outline}>{t('orgRegCollectHint')}</Txt>
      )}
      {pay.info ? <Txt color={colors.primary}>{pay.info}</Txt> : null}
      <ErrorText error={pay.error} />
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
            subtitle={[r.category?.name, pay.money(r), formatDate(r.registeredAt, locale)].filter(Boolean).join(' · ')}
            trailing={
              r.paymentStatus === 'PENDING' && standing(r) ? (
                <Button testID={`reg-paid-${r.id}`} kind="text" label={t('orgMarkPaid')} busy={pay.busy} onPress={() => pay.ask(r)} />
              ) : (
                <StatusPill label={standing(r) ? (payLabel[r.paymentStatus] ?? r.paymentStatus) : t('orgRegCancelled')} color={r.paymentStatus === 'PAID' && standing(r) ? colors.primary : colors.outline} />
              )
            }
          />
        )}
      />
      <MarkPaidDialogs pay={pay} />
    </>
  );
}
```
This is lot B's list with the « Marquer payé » state moved into `useMarkPaid`. The lot B participants tests check it: double tap, 409, receipt, CSV, 300 rows.

`apps/mobile-rn/src/features/competitions/organizer/participants-web.tsx`:
```tsx
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { EmptyState, Loading, SectionHeader, StatusPill } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Dialog, Segmented, Txt } from '../../../core/widgets/kit';
import { SidePanel } from '../../../core/widgets/panel';
import { Select } from '../../../core/widgets/pickers';
import { DataTable, type Column } from '../../../core/widgets/table';
import { SearchField } from '../../../core/widgets/web';
import { formatMoney, useHeats } from '../api';
import { useRegistrations } from './api';
import { exportCsv } from './export';
import { csvFileName, csvSeparator, filterRegistrations, PAYMENT_FILTERS, personName, registrationsCsv, standing, toCollect, type PaymentFilter } from './logic-b';
import { athleteHeats } from './logic-web';
import { ExportButton, OrgPageHeader } from './page';
import { MarkPaidDialogs, paymentLabels, useMarkPaid, useMarkPaidBatch, type MarkPaid } from './payments';

/** « Participants » on a computer (analysis §3 item 9, Circle21 refs 12, 14, 08): a table with its toolbar, a light side panel per athlete, « Marquer payé » for several at once. */
export function ParticipantsWeb({ c, initialCategoryId }: { c: Json; initialCategoryId: string | null }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const heats = useHeats(c.id);
  const pay = useMarkPaid(c);
  const batch = useMarkPaidBatch(c);
  const [mode, setMode] = useState<'all' | 'collect'>('all');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId);
  const [payment, setPayment] = useState<PaymentFilter>('ALL');
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  if (regs.isError) return <ErrorView error={regs.error} onRetry={() => regs.refetch()} />;
  if (!regs.data) return <Loading />;
  const all: Json[] = regs.data;
  const collect = toCollect(all);
  const rows = mode === 'collect' ? collect : filterRegistrations(all, { q, categoryId, payment });
  // Read from the list every time: after a payment, here or elsewhere, the panel shows the reloaded state.
  const open = openId ? (all.find((r) => r.id === openId) ?? null) : null;
  // Only registrations still to collect: one paid meanwhile drops out of the batch.
  const chosen = collect.filter((r) => selected.has(r.id)).map((r) => r.id);
  const labels = paymentLabels(t);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setSelected((s) => (collect.length > 0 && collect.every((r) => s.has(r.id)) ? new Set() : new Set(collect.map((r) => r.id))));

  const columns: Column<Json>[] = [
    { key: 'n', label: '#', width: 36, render: (_, i) => String(i + 1) },
    {
      key: 'name',
      label: t('orgColName'),
      flex: 2,
      render: (r) => (
        <Txt numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', textTransform: 'uppercase' }}>
          {personName(r)}
        </Txt>
      ),
    },
    { key: 'category', label: t('orgColCategory'), flex: 1.5, render: (r) => r.category?.name ?? '' },
    { key: 'payment', label: t('orgColPayment'), width: 120, render: (r) => <PayPill r={r} /> },
    { key: 'amount', label: t('orgColAmount'), width: 110, align: 'end', render: (r) => pay.money(r) },
    { key: 'date', label: t('orgColDate'), width: 120, render: (r) => formatDate(r.registeredAt, locale) },
  ];

  const actions =
    mode === 'all' ? (
      <>
        <SearchField testID="reg-search" placeholder={t('orgRegSearch')} value={q} onChangeText={setQ} />
        <Select testID="reg-pay" bare label={t('orgColPayment')} value={payment} options={PAYMENT_FILTERS.map((p) => ({ value: p, label: p === 'ALL' ? t('orgRegAnyPayment') : labels[p] }))} onChange={(v) => setPayment(v as PaymentFilter)} />
        <Select
          testID="reg-cat"
          bare
          label={t('orgColCategory')}
          value={categoryId ?? ''}
          options={[{ value: '', label: t('orgAllCategories') }, ...(c.categories ?? []).map((k: Json) => ({ value: k.id, label: k.name }))]}
          onChange={(v) => setCategoryId(v || null)}
        />
        <ExportButton testID="reg-csv" disabled={rows.length === 0} onPress={() => exportCsv(csvFileName(c, 'participants'), registrationsCsv(rows, csvSeparator(locale)))} />
      </>
    ) : (
      <Button testID="reg-batch" icon="done-all" label={t('orgMarkPaidBatch', { count: chosen.length })} busy={batch.busy} disabled={chosen.length === 0} onPress={() => setConfirming(true)} />
    );

  const listHeader = (
    <View style={{ gap: space.sm }}>
      <Segmented
        flush
        options={[
          { key: 'all', label: t('orgRegAll', { count: all.length }) },
          { key: 'collect', label: t('orgRegToCollect', { count: collect.length }) },
        ]}
        value={mode}
        onChange={(m) => {
          setMode(m);
          batch.clear();
        }}
      />
      {mode === 'collect' ? <Txt color={colors.outline}>{t('orgRegCollectHint')}</Txt> : null}
      {pay.info ? <Txt color={colors.primary}>{pay.info}</Txt> : null}
      <ErrorText error={pay.error} />
      {batch.result ? (
        <View testID="reg-batch-summary" style={{ gap: space.xs }}>
          <Txt>{t('orgBatchSummary', { paid: batch.result.paid.length, already: batch.result.already.length })}</Txt>
          {batch.result.left.length > 0 ? <Txt color={colors.error}>{t('orgBatchLeft', { count: batch.result.left.length })}</Txt> : null}
          <ErrorText error={batch.result.error} />
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <OrgPageHeader tab="participants" actions={actions} />
      <DataTable
        testID="reg-table"
        rows={rows}
        keyOf={(r) => r.id}
        nameOf={personName}
        rowTestID={(r) => `reg-${r.id}`}
        columns={columns}
        onRowPress={(r) => setOpenId(r.id)}
        selection={mode === 'collect' ? { selected, onToggle: toggle, onToggleAll: toggleAll, label: (name) => t('orgSelectRow', { name }), allLabel: t('orgSelectAll') } : undefined}
        rowActions={(r) => [
          { label: t('orgOpenDetails'), testID: `reg-open-${r.id}`, onPress: () => setOpenId(r.id) },
          ...(r.paymentStatus === 'PENDING' && standing(r) ? [{ label: t('orgMarkPaid'), testID: `reg-paid-${r.id}`, onPress: () => pay.ask(r) }] : []),
        ]}
        menuLabel={(name) => t('orgRowActions', { name })}
        header={listHeader}
        empty={<EmptyState icon="group" message={mode === 'collect' ? t('orgRegNothingToCollect') : t('orgRegNone')} />}
      />
      <AthletePanel c={c} r={open} heats={heats.data ?? []} pay={pay} onClose={() => setOpenId(null)} />
      <Dialog
        visible={confirming}
        title={t('orgMarkPaid')}
        message={t('orgMarkPaidBatchConfirm', { count: chosen.length })}
        confirmLabel={t('orgMarkPaid')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          setConfirming(false);
          void batch.run(chosen).then((r) => {
            // What an error left stays selected: « Marquer payé (n) » retries only those.
            if (r) setSelected(new Set(r.left));
          });
        }}
        onCancel={() => setConfirming(false)}
      />
      <MarkPaidDialogs pay={pay} />
    </>
  );
}

/** Payment pill: the status in words, « Annulée » for a registration no longer standing. */
function PayPill({ r, testID }: { r: Json; testID?: string }) {
  const t = useT();
  const { colors } = useTheme();
  const ok = standing(r);
  return <StatusPill testID={testID} label={ok ? (paymentLabels(t)[r.paymentStatus] ?? r.paymentStatus) : t('orgRegCancelled')} color={r.paymentStatus === 'PAID' && ok ? colors.primary : colors.outline} />;
}

/** The athlete's record in the light side panel, with « Marquer payé » or the receipt in its footer. */
function AthletePanel({ c, r, heats, pay, onClose }: { c: Json; r: Json | null; heats: Json[]; pay: MarkPaid; onClose: () => void }) {
  const t = useT();
  const pending = !!r && r.paymentStatus === 'PENDING' && standing(r);
  return (
    <SidePanel
      testID="reg-panel"
      visible={r != null}
      title={r ? personName(r) : ''}
      closeLabel={t('orgClose')}
      onClose={onClose}
      footer={
        <>
          <Button testID="reg-panel-close" kind="outlined" label={t('orgClose')} onPress={onClose} style={{ flex: 1 }} />
          {r && pending ? (
            <Button testID="reg-panel-pay" label={t('orgMarkPaid')} busy={pay.busy} onPress={() => pay.ask(r)} style={{ flex: 1 }} />
          ) : r && r.paymentStatus === 'PAID' ? (
            <Button testID="reg-panel-receipt" icon="receipt-long" label={t('orgReceiptButton')} onPress={() => pay.showReceipt(r)} style={{ flex: 1 }} />
          ) : null}
        </>
      }
    >
      {r ? <AthleteDetails c={c} r={r} heats={heats} info={pay.info} /> : null}
    </SidePanel>
  );
}

/** Category, price, discount, amount, payment, date, then the heats and lanes. Rendered inside the panel, so in the light palette. */
function AthleteDetails({ c, r, heats, info }: { c: Json; r: Json; heats: Json[]; info: string | null }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const money = (n: number) => formatMoney(n, r.currency ?? c.currency, locale);
  const placed = athleteHeats(heats, r.id);
  const line = (label: string, value: ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, gap: space.md }}>
      <Txt style={{ flex: 1, fontSize: 13 }} color={colors.outline}>
        {label}
      </Txt>
      {typeof value === 'string' ? <Txt style={{ fontSize: 14, fontWeight: '600' }}>{value}</Txt> : value}
    </View>
  );
  return (
    <>
      <View style={{ gap: space.xs }}>
        {line(t('orgColCategory'), r.category?.name ?? '—')}
        {line(t('orgColPrice'), money(r.originalPrice ?? r.finalPrice ?? 0))}
        {line(t('orgColDiscount'), r.discount ? `− ${money(r.discount)}` : '—')}
        {line(t('orgColAmount'), money(r.finalPrice ?? 0))}
        {line(t('orgColPayment'), <PayPill r={r} testID="reg-panel-status" />)}
        {line(t('orgColDate'), formatDate(r.registeredAt, locale, { dateStyle: 'medium', timeStyle: 'short' }))}
      </View>
      {info ? <Txt color={colors.primary}>{info}</Txt> : null}
      <SectionHeader title={t('orgDetailHeats')} />
      {placed.length === 0 ? (
        <Txt color={colors.outline}>{t('orgDetailNoHeat')}</Txt>
      ) : (
        placed.map(({ heat, lane }) => (
          <View key={heat.id} testID={`reg-panel-heat-${heat.id}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, gap: space.md }}>
            <Txt numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>
              {heat.name}
            </Txt>
            <Txt style={{ fontSize: 13 }} color={colors.outline}>
              {[heat.startsAt ? formatDate(heat.startsAt, locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null, t('orgLane', { lane })].filter(Boolean).join(' · ')}
            </Txt>
          </View>
        ))
      )}
    </>
  );
}
```
`participants.tsx` imports `participants-web.tsx`, which does not import `participants.tsx`, so there is no cycle.

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes (the new computer tests, lot B's phone participants tests, Task 7's « a category opens the participants of that category »), no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/payments.tsx apps/mobile-rn/src/features/competitions/organizer/participants-web.tsx apps/mobile-rn/src/features/competitions/organizer/participants.tsx apps/mobile-rn/src/features/competitions/organizer/logic-b.ts apps/mobile-rn/test/screens/organizer-participants-web.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer participants on a computer: table, light side panel with heats and lanes, mark paid in batch with a summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Heats and Horaire du jour as separate computer pages

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/schedule.tsx`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/timetable.tsx` (`useNow` exported; « Retard » moved into `DelayControls`, shared by the phone card and the computer page)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/planning.tsx` (no clock card on a computer)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/web.ts` (`ORG_MENU`: Planning holds WODs, Heats, Horaire du jour)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/manage.tsx` (renders `ScheduleTab`)
- Modify: `apps/mobile-rn/test/core/organizer-web.test.ts` (the menu list gets `timetable`)
- Test: `apps/mobile-rn/test/screens/organizer-schedule.test.tsx`

**Interfaces:**
- Consumes: Task 1 `scheduleDay`, `daySchedule`, `dayEnd`, `heatEnd`, keys `orgScheduleEnds`, `orgCurrentHeat`, `orgNoActiveHeat`, `orgHeatsProgress`, `orgHeatState*`, `orgNeedHeat`, `orgGoHeats`, `orgDay`; Task 2 `Select bare`; Task 3 `Grid`, `SearchField`, `SectionCard`, `Ring`; Task 6 `OrgPageHeader`; lot B `timetable`, `filterHeats`, `heatDays`, `delayTargets`, `runDelay`, `delayMinutes`, `useHeats`; lot 1 `Guide`.
- Produces: `useNow(everyMs = 30_000): number`; `DelayControls({ c, heats, now })`, the whole « Retard » flow of lot B (same testIDs `delay`, `delay-minutes`, `delay-retry`, `delay-announce`); `ScheduleTab({ c, onGo? })`. TestIDs: `sched-day`, `sched-cat`, `sched-wod`, `sched-search`, `sched-clock`, `sched-current`, `sched-progress`, `sched-list`, `sched-heat-<id>`, `guide-heats` (+ `-go`). `ORG_MENU` planning section = `['wods', 'planning', 'timetable']`.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-schedule.test.tsx`:
```tsx
import { act, fireEvent, within } from 'expo-router/testing-library';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const heat = (id: string, startsAt: string | null, extra: object = {}) => ({ id, number: 1, name: `Heat ${id.toUpperCase()}`, startsAt, durationMin: 12, laneCount: 4, workout: null, category: null, lanes: [], ...extra });
// As in the lot B clock test, at 09:05: A has ended, B is running, C and E have not started, D has no time.
const day = [heat('a', '2026-12-12T08:00:00.000Z'), heat('b', '2026-12-12T09:00:00.000Z'), heat('c', '2026-12-12T10:00:00.000Z'), heat('e', '2026-12-12T11:00:00.000Z'), heat('d', null)];
const withHeats = (list: object[]) => orgBackend().on('GET', '/competitions/c9/heats', [200, list]);

describe('time table on a computer', () => {
  beforeEach(() => {
    setWide(true);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-12T09:05:00Z'));
  });
  afterEach(() => jest.restoreAllMocks());

  it('Planning has three entries; Heats no longer shows the clock card', async () => {
    const screen = await renderScreen(open('planning'), withHeats(day));
    expect(await screen.findByTestId('heat-b')).toBeTruthy();
    expect(screen.queryByTestId('timetable')).toBeNull();
    for (const tab of ['wods', 'planning', 'timetable']) expect(screen.getByTestId(`org-menu-${tab}`)).toBeTruthy();
    expect(within(screen.getByTestId('org-menu')).getByText('Time table')).toBeTruthy();
  });

  it('the clock, the heat running and the progress of the day, then the day's heats with their state', async () => {
    const screen = await renderScreen(open('timetable'), withHeats(day));
    expect((await screen.findByTestId('sched-clock')).props.children).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(screen.getByText(/^Program ends at /)).toBeTruthy();
    expect(within(screen.getByTestId('sched-current')).getByText('Heat B')).toBeTruthy();
    expect(screen.getByTestId('sched-progress').props.accessibilityLabel).toBe('1 of 4 heats done · 3 left');
    expect(within(screen.getByTestId('sched-heat-a')).getByText('Done')).toBeTruthy();
    expect(within(screen.getByTestId('sched-heat-b')).getByText('Running')).toBeTruthy();
    expect(within(screen.getByTestId('sched-heat-c')).getByText('Upcoming')).toBeTruthy();
    expect(screen.queryByTestId('sched-heat-d')).toBeNull();
  });

  it('the list follows the day « Delay » would move', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-12T20:00:00Z'));
    const next = [heat('f', '2026-12-13T09:00:00.000Z'), heat('g', '2026-12-13T09:30:00.000Z')];
    const screen = await renderScreen(open('timetable'), withHeats([...day, ...next]));
    expect(await screen.findByTestId('sched-heat-f')).toBeTruthy();
    expect(screen.getByTestId('sched-heat-g')).toBeTruthy();
    expect(screen.queryByTestId('sched-heat-a')).toBeNull();
    expect(within(screen.getByTestId('sched-current')).getByText('No active heat')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('delay'));
    expect(screen.getByText(/^Move the 2 heats of /)).toBeTruthy();
  });

  it('category, WOD and search narrow the list; the cards keep the whole day', async () => {
    const two = [
      heat('a', '2026-12-12T08:00:00.000Z', { category: { id: 'k1', name: 'RX Men' } }),
      heat('b', '2026-12-12T09:00:00.000Z', { category: { id: 'k2', name: 'RX Women' }, lanes: [{ lane: 1, registrationId: 'r2', athlete: { fullName: 'Amira Trabelsi', username: 'amira' } }] }),
    ];
    const screen = await renderScreen(open('timetable'), withHeats(two));
    await fireEvent.press(await screen.findByTestId('sched-cat'));
    await fireEvent.press(screen.getByTestId('sched-cat-k1'));
    expect(screen.getByTestId('sched-heat-a')).toBeTruthy();
    expect(screen.queryByTestId('sched-heat-b')).toBeNull();
    expect(screen.getByTestId('sched-progress').props.accessibilityLabel).toBe('1 of 2 heats done · 1 left');
    await fireEvent.press(screen.getByTestId('sched-cat'));
    await fireEvent.press(screen.getByTestId('sched-cat-'));
    await fireEvent.changeText(screen.getByTestId('sched-search'), 'amira');
    expect(screen.getByTestId('sched-heat-b')).toBeTruthy();
    expect(screen.queryByTestId('sched-heat-a')).toBeNull();
  });

  it('no heat with a start time: a card leads to Heats', async () => {
    const screen = await renderScreen(open('timetable'), withHeats([heat('d', null)]));
    await fireEvent.press(await screen.findByTestId('guide-heats-go'));
    expect(await screen.findByTestId('heat-new')).toBeTruthy();
    expect(screen.getByTestId('org-menu-planning').props.accessibilityState?.selected).toBe(true);
  });

  it('the clock ticks every second only while this page is open', async () => {
    const every = jest.spyOn(global, 'setInterval');
    const stop = jest.spyOn(global, 'clearInterval');
    const screen = await renderScreen(open('planning'), withHeats(day));
    await screen.findByTestId('heat-b');
    expect(every.mock.calls.some(([, ms]) => ms === 1000)).toBe(false);
    await fireEvent.press(screen.getByTestId('org-menu-timetable'));
    await screen.findByTestId('sched-clock');
    const i = every.mock.calls.findIndex(([, ms]) => ms === 1000);
    expect(i).toBeGreaterThanOrEqual(0);
    const id = every.mock.results[i].value;
    await fireEvent.press(screen.getByTestId('org-menu-wods'));
    expect(stop).toHaveBeenCalledWith(id);
  });

  it('a narrow window shows Heats, with the phone's clock card, instead of the time table', async () => {
    const screen = await renderScreen(open('timetable'), withHeats(day));
    expect(await screen.findByTestId('sched-clock')).toBeTruthy();
    await act(async () => setWide(false));
    expect(await screen.findByTestId('timetable')).toBeTruthy();
    expect(screen.getByTestId('org-tab-planning').props.accessibilityState?.selected).toBe(true);
    expect(screen.queryByTestId('sched-clock')).toBeNull();
  });
});
```

In `apps/mobile-rn/test/core/organizer-web.test.ts`, in « the menu holds every tab of the organizer space exactly once », replace the expected list with `['announcements', 'categories', 'coupons', 'dashboard', 'finances', 'general', 'leaderboard', 'participants', 'planning', 'team', 'timetable', 'wods']`.

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-schedule.test.tsx test/core/organizer-web.test.ts`
Expected: FAIL: `org-menu-timetable` is not found.

- [ ] **Step 3: « Retard » becomes its own piece**

Replace the whole content of `apps/mobile-rn/src/features/competitions/organizer/timetable.tsx` with:
```tsx
import { useEffect, useRef, useState } from 'react';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Dialog, Txt } from '../../../core/widgets/kit';
import { competitionsApi } from '../api';
import { organizerApi, useRefreshCompetition } from './api';
import { delayMinutes, delayTargets, runDelay, timetable } from './logic-b';

/** The current time, read again every `everyMs`: 30 s for the phone's clock card, 1 s on the computer's time table. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

type Failure = { heats: Json[]; minutes: number; total: number; day: string };
/** Every heat moved but the announcement did not go out. */
type Unannounced = { minutes: number; total: number; day: string };

/** Clock of the event day (spec §1.3 item 5): the heat running, the next one, how many are done, and « Retard ». The phone shows it on Planning; the computer has a page for it (`schedule.tsx`). */
export function TimetableCard({ c, heats }: { c: Json; heats: Json[] }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const now = useNow();
  const tt = timetable(heats, now);
  const hour = (iso: string) => formatDate(iso, locale, { hour: '2-digit', minute: '2-digit' });
  if (tt.total === 0) return null;
  return (
    <Card testID="timetable" style={{ gap: space.sm }}>
      <Txt variant="headline">{formatDate(new Date(now), locale, { hour: '2-digit', minute: '2-digit' })}</Txt>
      <Txt>{tt.current ? t('orgNowRunning', { name: tt.current.name }) : t('orgNothingRunning')}</Txt>
      {tt.next ? <Txt color={colors.outline}>{t('orgNextHeat', { name: tt.next.name, time: hour(tt.next.startsAt) })}</Txt> : null}
      <Txt color={colors.outline}>{t('orgHeatsDone', { done: tt.done, total: tt.total })}</Txt>
      <DelayControls c={c} heats={heats} now={now} />
    </Card>
  );
}

/** « Retard »: moves every heat of the day being run that has not started, then posts one announcement; what failed is retried alone. */
export function DelayControls({ c, heats, now }: { c: Json; heats: Json[]; now: number }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<Failure | null>(null);
  const [unannounced, setUnannounced] = useState<Unannounced | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const targets = delayTargets(heats, now);
  const dayOf = (iso: string) => formatDate(iso, locale, { weekday: 'long', day: 'numeric', month: 'long' });

  async function guarded(fn: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setDone(null);
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

  async function announce(minutes: number, total: number, day: string) {
    try {
      await organizerApi(api).announce(c.id, { title: t('orgDelayTitle', { minutes }), body: t('orgDelayBody', { minutes, day }) });
    } catch (e) {
      // The heats have moved: only the announcement is left (« Retard » again would move them twice).
      setUnannounced({ minutes, total, day });
      throw e;
    }
    setUnannounced(null);
    setDone(t('orgDelayDone', { count: total, minutes }));
  }

  /** Moves `todo` by `minutes`; `total` counts every heat of this delay, retries included. */
  async function move(todo: Json[], minutes: number, total: number, day: string) {
    const left = await runDelay(todo, minutes, (heatId, startsAt) => organizerApi(api).updateHeat(c.id, heatId, { startsAt }));
    if (left.length > 0) {
      setFailed({ heats: left, minutes, total, day });
      return;
    }
    setFailed(null);
    await announce(minutes, total, day);
  }

  /** The start times are read again first: a co-organizer may have moved the heats from another phone. */
  const delay = (minutes: number) =>
    guarded(async () => {
      const todo = delayTargets(await competitionsApi(api).heats(c.id), Date.now());
      if (todo.length > 0) await move(todo, minutes, todo.length, dayOf(todo[0].startsAt));
    });

  return (
    <>
      {failed ? (
        <>
          <Txt color={colors.error}>{t('orgDelayFailed', { names: failed.heats.map((h) => h.name).join(', ') })}</Txt>
          <Button testID="delay-retry" kind="outlined" label={t('retry')} busy={busy} onPress={() => guarded(() => move(failed.heats, failed.minutes, failed.total, failed.day))} />
        </>
      ) : null}
      {unannounced ? (
        <>
          <Txt color={colors.error}>{t('orgDelayNotAnnounced', { count: unannounced.total, minutes: unannounced.minutes })}</Txt>
          <Button testID="delay-announce" kind="outlined" icon="campaign" label={t('orgDelayPostAnnouncement')} busy={busy} onPress={() => guarded(() => announce(unannounced.minutes, unannounced.total, unannounced.day))} />
        </>
      ) : null}
      {done ? <Txt color={colors.primary}>{done}</Txt> : null}
      <ErrorText error={error} />
      <Button testID="delay" kind="outlined" icon="schedule" label={t('orgDelay')} busy={busy} disabled={targets.length === 0 || failed != null || unannounced != null} onPress={() => setAsking(true)} />
      <Dialog
        visible={asking}
        title={t('orgDelay')}
        message={t('orgDelayAsk', { count: targets.length, day: targets[0] ? dayOf(targets[0].startsAt) : '' })}
        confirmLabel={t('orgDelayConfirm')}
        cancelLabel={t('cancel')}
        input={{ label: t('orgDelayMinutes'), keyboardType: 'number-pad', testID: 'delay-minutes', valid: (s) => delayMinutes(s) != null }}
        onConfirm={(s) => {
          setAsking(false);
          const minutes = delayMinutes(s);
          if (minutes != null) void delay(minutes);
        }}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
```
The code is lot B's, split in two. The phone card renders the same elements in the same order: the fragment's children become the card's children. The lot B `organizer-timetable` tests check it.

- [ ] **Step 4: Write the time table page**

`apps/mobile-rn/src/features/competitions/organizer/schedule.tsx`:
```tsx
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { displayText, space, useTheme, webDense } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { Ring } from '../../../core/widgets/chart';
import { Loading, StatusPill } from '../../../core/widgets/common';
import { ErrorView } from '../../../core/widgets/error';
import { Card, Icon, ListRow, Screen, Txt } from '../../../core/widgets/kit';
import { Select, type Option } from '../../../core/widgets/pickers';
import { Grid, SearchField, SectionCard } from '../../../core/widgets/web';
import { useHeats } from '../api';
import { Guide } from './guide';
import type { ManageTab } from './logic';
import { filterHeats, heatDays, heatEnd, timetable } from './logic-b';
import { dayEnd, daySchedule, scheduleDay } from './logic-web';
import { OrgPageHeader } from './page';
import { DelayControls, useNow } from './timetable';

/** « Horaire du jour » on a computer (analysis §3 item 10, Circle21 ref 19): a clock ticking every second, the heat running, how far the day is, the day's heats and « Retard ». */
export function ScheduleTab({ c, onGo }: { c: Json; onGo?: (tab: ManageTab) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const heats = useHeats(c.id);
  // Every second, and only while this page is open: the interval stops when the page closes.
  const now = useNow(1000);
  const [day, setDay] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  if (heats.isError) return <ErrorView error={heats.error} onRetry={() => heats.refetch()} />;
  if (!heats.data) return <Loading />;
  const all: Json[] = heats.data;
  const days = heatDays(all);
  // Until the organizer picks a day: the day of the heat running, else the one « Retard » would move.
  const shownDay = day ?? scheduleDay(all, now);
  const today = shownDay ? daySchedule(all, shownDay, now) : [];
  const dayHeats = today.map((x) => x.heat);
  const tt = timetable(dayHeats, now);
  const end = dayEnd(dayHeats);
  const visible = new Set(filterHeats(dayHeats, { day: null, categoryId, workoutId, q }).map((h) => h.id));
  const list = today.filter((x) => visible.has(x.heat.id));
  const hour = (iso: string) => formatDate(iso, locale, { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (d: string, long = false) => formatDate(`${d}T12:00:00`, locale, long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
  const stateLabel = { done: t('orgHeatStateDone'), running: t('orgHeatStateRunning'), upcoming: t('orgHeatStateUpcoming') };
  const progress = t('orgHeatsProgress', { done: tt.done, total: tt.total, left: tt.total - tt.done });
  const pct = tt.total ? Math.round((tt.done / tt.total) * 100) : 0;
  const catOptions: Option[] = (c.categories ?? []).map((k: Json) => ({ value: k.id, label: k.name }));
  const wodOptions: Option[] = (c.workouts ?? []).map((w: Json) => ({ value: w.id, label: `${w.number}. ${w.name}` }));
  const tile = { backgroundColor: colors.surface, borderRadius: webDense.radius.card, padding: webDense.pad, minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: space.xs } as const;
  const kicker = [webDense.caption, { textTransform: 'uppercase', letterSpacing: 0.5 }] as const;

  return (
    <>
      <OrgPageHeader
        tab="timetable"
        actions={
          shownDay ? (
            <>
              <Select testID="sched-day" bare label={t('orgDay')} value={shownDay} options={days.map((d) => ({ value: d, label: dayLabel(d) }))} onChange={setDay} />
              <Select testID="sched-cat" bare label={t('orgHeatCategory')} value={categoryId ?? ''} options={[{ value: '', label: t('orgAllCategories') }, ...catOptions]} onChange={(v) => setCategoryId(v || null)} />
              <Select testID="sched-wod" bare label={t('orgHeatWod')} value={workoutId ?? ''} options={[{ value: '', label: t('orgAllWods') }, ...wodOptions]} onChange={(v) => setWorkoutId(v || null)} />
              <SearchField testID="sched-search" placeholder={t('orgHeatSearch')} value={q} onChangeText={setQ} />
            </>
          ) : undefined
        }
      />
      <Screen>
        {!shownDay ? (
          <Guide testID="guide-heats" message={t('orgNeedHeat')} action={t('orgGoHeats')} onPress={onGo && (() => onGo('planning'))} />
        ) : (
          <>
            <Grid min={240} counts={[3, 1]}>
              <View style={tile}>
                <Icon name="schedule" size={22} color={colors.outline} />
                <Txt style={kicker} color={colors.outline}>
                  {formatDate(new Date(now), locale, { weekday: 'long', day: 'numeric', month: 'short' })}
                </Txt>
                <Txt testID="sched-clock" style={displayText(28)}>
                  {formatDate(new Date(now), locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </Txt>
                {end ? (
                  <Txt style={webDense.caption} color={colors.outline}>
                    {t('orgScheduleEnds', { time: hour(end) })}
                  </Txt>
                ) : null}
              </View>
              <View testID="sched-current" style={tile}>
                <Txt style={kicker} color={colors.outline}>
                  {t('orgCurrentHeat')}
                </Txt>
                {tt.current ? (
                  <>
                    <Txt style={{ fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{tt.current.name}</Txt>
                    <Txt style={webDense.caption} color={colors.outline}>{`${hour(tt.current.startsAt)}–${hour(heatEnd(tt.current))}`}</Txt>
                  </>
                ) : (
                  <Txt style={{ fontSize: 16, fontWeight: '600' }}>{t('orgNoActiveHeat')}</Txt>
                )}
              </View>
              <View style={tile}>
                <Ring testID="sched-progress" label={progress} parts={[{ value: tt.done, color: colors.primary }, { value: tt.total - tt.done, color: 'transparent' }]}>
                  <Txt style={displayText(24)}>{`${pct}%`}</Txt>
                </Ring>
                <Txt style={webDense.caption} color={colors.outline}>
                  {progress}
                </Txt>
              </View>
            </Grid>
            <Card style={{ gap: space.sm }}>
              <DelayControls c={c} heats={all} now={now} />
            </Card>
            <SectionCard testID="sched-list" title={dayLabel(shownDay, true)} empty={list.length ? null : t('orgHeatNoMatch')}>
              {list.map(({ heat, state }) => (
                <ListRow
                  key={heat.id}
                  testID={`sched-heat-${heat.id}`}
                  title={heat.name}
                  subtitle={[`${hour(heat.startsAt)}–${hour(heatEnd(heat))}`, heat.workout?.name, heat.category?.name].filter(Boolean).join(' · ')}
                  trailing={<StatusPill label={stateLabel[state]} color={state === 'running' ? colors.primary : state === 'done' ? colors.outline : colors.text} />}
                />
              ))}
            </SectionCard>
          </>
        )}
      </Screen>
    </>
  );
}
```
If TypeScript refuses `kicker` as a `style` (readonly tuple), write it as `const kicker = [webDense.caption, { textTransform: 'uppercase' as const, letterSpacing: 0.5 }];`.

- [ ] **Step 5: Wire it in**

In `apps/mobile-rn/src/features/competitions/organizer/planning.tsx`, replace `<TimetableCard c={c} heats={all} />` with:
```tsx
        {/* On a computer the clock and « Retard » have their own page (Horaire du jour). */}
        {wide ? null : <TimetableCard c={c} heats={all} />}
```

In `apps/mobile-rn/src/features/competitions/organizer/web.ts`, replace `{ key: 'planning', tabs: ['wods', 'planning'] },` with `{ key: 'planning', tabs: ['wods', 'planning', 'timetable'] },`.

In `apps/mobile-rn/src/features/competitions/organizer/manage.tsx`, add `import { ScheduleTab } from './schedule';`, and in `page` add after the planning line:
```tsx
      {shown === 'timetable' && <ScheduleTab c={c} onGo={go} />}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes (the new page, lot B's phone clock and « Retard » tests, lot 1's guides), no type error.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/schedule.tsx apps/mobile-rn/src/features/competitions/organizer/timetable.tsx apps/mobile-rn/src/features/competitions/organizer/planning.tsx apps/mobile-rn/src/features/competitions/organizer/web.ts apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/test/core/organizer-web.test.ts apps/mobile-rn/test/screens/organizer-schedule.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer time table page on a computer: live clock, running heat, day progress ring, the day's heats, delay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Visual check at 1440 px, the phone unchanged, comparison with the references

**Files:**
- Create (not committed): `<scratchpad>/organizer-web-shots.cjs`. Output goes to `/mnt/c/Users/GIGABYTE/Desktop/organizer-web-2/` (`computer/`, `phone-before/` from Task 1 Step 10, `phone-after/`).

**Interfaces:**
- Consumes: the offline demo draft `01a10804-0000-7000-8000-00000000d001` (Task 1 demo data) and the direct-link fix (`5a011eb`). After sign-in, `http://localhost:8081/competitions/01a10804-0000-7000-8000-00000000d001/manage` opens the organizer space.
- Produces: 26 computer screenshots (FR and AR × 12 menu entries + the participant panel), 20 phone screenshots, the overflow and page-error report, and the list of differences kept on purpose.

- [ ] **Step 1: Run every app check**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes: the 35 suites before this lot, plus `organizer-web2`, `web-widgets`, `web-table-panel`, `organizer-web-shell`, `organizer-web-pages`, `organizer-overview`, `organizer-finances`, `organizer-participants-web` and `organizer-schedule`. No type error.

- [ ] **Step 2: Take the screenshots**

Restart the web preview in demo mode: kill the PID listening on 8081 first, then run in the background `cd apps/mobile-rn && EXPO_PUBLIC_DEMO=true CI=1 npx expo start --web --port 8081`. Wait for `curl -s -o /dev/null -w "%{http_code}" --retry 90 --retry-connrefused --retry-delay 2 http://localhost:8081` to print 200. Browser: the cached `playwright-core` (`~/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`) and `chrome-headless-shell` (`~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`), with `LD_LIBRARY_PATH=<scratchpad>/libs/usr/lib/x86_64-linux-gnu`. If `libnspr4 libnss3 libasound2t64` are missing there, extract them with `apt-get download` + `dpkg -x`. If the cached paths have moved, find them with `ls ~/.npm/_npx/*/node_modules/playwright-core ~/.cache/ms-playwright`.

`<scratchpad>/organizer-web-shots.cjs`:
```js
// Usage: node organizer-web-shots.cjs <playwright-core dir> <chrome-headless-shell> <output dir> <computer|phone>
const [pwDir, chrome, out, mode = 'computer'] = process.argv.slice(2);
const { chromium } = require(pwDir);
require('node:fs').mkdirSync(out, { recursive: true });

const MANAGE = 'http://localhost:8081/competitions/01a10804-0000-7000-8000-00000000d001/manage';
const COMPUTER = ['dashboard', 'finances', 'general', 'categories', 'coupons', 'team', 'participants', 'wods', 'planning', 'timetable', 'leaderboard', 'announcements'];
const PHONE = ['dashboard', 'general', 'categories', 'wods', 'planning', 'participants', 'team', 'leaderboard', 'announcements', 'coupons'];
const phone = mode === 'phone';

(async () => {
  const browser = await chromium.launch({ executablePath: chrome });
  for (const lang of ['fr', 'ar']) {
    const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, locale: lang });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8081', { waitUntil: 'load', timeout: 300000 });
    await page.getByTestId('login-email').waitFor({ timeout: 300000 });
    await page.getByTestId('login-email').fill('ahmed_rx@demo.fitnessleague.test');
    await page.getByTestId('login-password').fill('demo-password-2026');
    await page.getByTestId('login-submit').click();
    await page.waitForTimeout(3000);
    await page.goto(MANAGE, { waitUntil: 'load', timeout: 300000 });
    await page.getByTestId(phone ? 'org-tab-dashboard' : 'org-menu').waitFor({ timeout: 60000 });
    const overflow = {};
    for (const p of phone ? PHONE : COMPUTER) {
      await page.getByTestId(phone ? `org-tab-${p}` : `org-menu-${p}`).click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/${lang}-${p}.png` });
      overflow[p] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (!phone && p === 'participants') {
        // The side panel of the first athlete, then Esc.
        await page.getByTestId('reg-01a10804-0000-7000-8000-00000000d200').click();
        await page.getByTestId('reg-panel').waitFor({ timeout: 10000 });
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${out}/${lang}-participants-panel.png` });
        await page.keyboard.press('Escape');
        await page.getByTestId('reg-panel').waitFor({ state: 'detached', timeout: 10000 });
      }
    }
    console.log(lang, mode, 'horizontal overflow:', JSON.stringify(overflow), 'page errors:', errors.length ? errors : 'none');
    await page.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```
Run:
- `node <scratchpad>/organizer-web-shots.cjs <playwright-core dir> <chrome-headless-shell> /mnt/c/Users/GIGABYTE/Desktop/organizer-web-2/computer computer`
- `node <scratchpad>/organizer-web-shots.cjs <playwright-core dir> <chrome-headless-shell> /mnt/c/Users/GIGABYTE/Desktop/organizer-web-2/phone-after phone`

Expected: 26 + 20 PNG files, every overflow `0`, and `page errors: none` in both modes. The Esc step passing proves that Esc closes the panel in a real browser.

- [ ] **Step 3: Look at the computer pages next to the references**

Open each pair below with the Read tool, ours first, then the reference:

| Ours (`computer/`) | Reference (`docs/prompts/circle21-style-upgrade/ref/`) | Check |
|---|---|---|
| `fr-dashboard.png` | `01`, `02`, `03`, `04` | compact top bar (back, round cover, title + lock, « Sur place · Brouillon », dates in the center, Aperçu / Demander la publication / ⋯); 220 px menu with icons and the accent bar; « VUE D'ENSEMBLE » header row; two rows of 4 KPI cards; the per-day bars; the 3 cards |
| `fr-finances.png` | `01`, `16` | six KPI cards (3 + 3), the footnote with the info icon, « TRANSACTIONS » with search, filter, export square; table header strip |
| `fr-participants.png` | `12`, `14` | toolbar in the header row, table strip, bold uppercase names, pills, ⋯ |
| `fr-participants-panel.png` | `08`, `13` | light drawer on the dark page, title + X, details, heats and lanes, sticky footer [Fermer] [Reçu / Marquer payé] |
| `fr-timetable.png` | `19` | toolbar (day, category, WOD, search), clock card, current heat card, ring, the day's list |
| `fr-general.png`, `fr-team.png`, `fr-coupons.png` | `05`, `07`, `12`, `14` | header row with the create button and the export square; flat 10 px cards, 32 px controls; forms ≤ 720 px |
| `ar-dashboard.png`, `ar-participants-panel.png` | same | Arabic texts, nothing cut, the layout not mirrored (web rule) |

Fix what is wrong, re-run the tests and Step 2, then write down the differences kept on purpose. Start from this list and complete it from what you see:
- The grouped menu stays on the left (approach A); there is no top tab bar.
- Our accent (`config.accent`) replaces Circle21's orange highlights and white filled buttons; the panel and the dialogs use our palettes.
- KPI numbers use Barlow Condensed ExtraBold (`displayText(36)`), not Circle21's light weight.
- No bell, gear, « Send Invitation », footer, Stripe fees, clubs / countries, pixels: marked B or out of scope.
- A select opens our small list box, not a native dropdown.
- Arabic is not mirrored on the web (as in lot Web 1).
- No toasts on every action and no skeletons yet (lot Web 3).

- [ ] **Step 4: The phone is unchanged**

Compare the phone screenshots byte for byte:
```bash
cd /mnt/c/Users/GIGABYTE/Desktop/organizer-web-2
for f in phone-before/*.png; do cmp -s "$f" "phone-after/$(basename "$f")" || echo "differs: $(basename "$f")"; done
```
Expected: only `fr-planning.png` and `ar-planning.png` may differ, because the phone's clock card shows the time of the run. For each file listed, open both versions with the Read tool. Any difference other than the clock is a regression of the phone render: find it, fix it with a test that fails first, and re-run Steps 2 and 4.

Leave the preview running for the owner, and open the direct link in their browser: `cmd.exe /c start http://localhost:8081/competitions/01a10804-0000-7000-8000-00000000d001/manage`. Nothing is committed in this task.

---

### Task 12: Whole-branch review, fixes, docs

**Files:**
- Modify: `README.md` (the organizer space row), `handoff.md` (§2, §3, §4, §6)
- Modify: whatever the review's important findings touch, each with its test

**Interfaces:**
- Consumes: every commit of this lot (`git log --oneline ab27532..HEAD`), the screenshots and the list of Task 11.
- Produces: the review verdict, the fixes, the docs commit.

- [ ] **Step 1: Ask for the review**

Dispatch one fresh reviewer on the strongest model (Agent tool, `subagent_type: "code-reviewer"`, `model: "opus"`) with this brief:
> Review the whole lot Web 2 of the organizer space on branch `feat/organizer-space`, `git diff ab27532..HEAD -- apps/mobile-rn` (React Native + react-native-web, Expo). Read the plan `docs/superpowers/plans/2026-10-16-organizer-web-lot-2.md` (Global Constraints and Review Focus first) and the owner's prompt `docs/prompts/circle21-style-upgrade/PROMPT.md`. Check in priority:
> (1) the phone render is unchanged: no `ThemeScope`, `dense` or `bare` effect outside the computer layout, and no phone test changed meaning;
> (2) batch payment: one at a time, 409 counted as already settled, stop on any other error, `left` kept selected, one batch on a double click;
> (3) the side panel reads the reloaded registration, closes with Esc / backdrop / X, gives focus back, and is light on a dark page;
> (4) Finances: gross − discounts = Σ amounts = collected + to collect + refunded, for every payment and registration status the API can send (PENDING, PAID, FREE, FAILED, REFUNDED × PENDING, CONFIRMED, CANCELLED, REFUNDED);
> (5) Horaire du jour: the day rule matches « Retard », the clock ticks only on that page, the narrow-window fallbacks work;
> (6) i18n: the same keys and placeholders in en / fr / ar, French with « tu », plurals right;
> (7) nothing under `apps/api`, `apps/backend`, `apps/admin`; no new package.
> Grade each finding critical / important / minor, with file:line and a concrete failing scenario. Do not edit files.

- [ ] **Step 2: Fix the important findings**

For each critical or important finding: first write a test that fails because of it, then the fix, then `npx jest --maxWorkers=2 && npx tsc --noEmit`, then one commit `fix(mobile): organizer web lot 2 review fixes (…)` that lists the fixes in the message. Write the minors in handoff §6 without fixing them, unless a fix is one line and has a test.

- [ ] **Step 3: Docs**

`README.md`, row `| Organizer space (2026-10-14): …`: insert before ` | Lots A and B + web lot 1 done, tested |` the sentence:
` On a computer the organizer space now looks like a desktop back-office (lot Web 2): dense flat cards, a compact top bar, an icon menu, a header row on every page; an overview with KPI rows, registrations per day, top categories, a scores ring and gender in % or numbers; a Finances page (gross, discounts, collected, to collect, free, refunded, transactions); participants as a table with a light side panel (payment, heats and lanes, receipt) and « Marquer payé » for several at once; Heats and « Horaire du jour » (live clock, current heat, progress ring) as separate pages.`
Then replace ` | Lots A and B + web lot 1 done, tested |` with ` | Lots A and B + web lots 1 and 2 done, tested |`.

`handoff.md`:
- §2 Current state: a new « Update 2026-10-16 » bullet at the top. It covers: lot Web 2 + the Circle21 look on `feat/organizer-space` (prompt `docs/prompts/circle21-style-upgrade/PROMPT.md`, plan `docs/superpowers/plans/2026-10-16-organizer-web-lot-2.md`), what changed on a computer, the review verdict and the fixes, the checks of Task 11 Step 1 (suite and test counts), the screenshots folder `Desktop/organizer-web-2/`, the phone comparison result, the differences kept on purpose, the preview left running with the direct link, and the push state (not pushed). Also state the demo-data change (dashboard figures aligned with the six registrations, two discounts, one judge).
- §3 Active files: `core/theme/index.ts` (`webDense`, `ThemeScope`), `core/widgets/{web,table,panel}.tsx`, `chart.tsx` (`Ring`, `BarChart`), the dense changes in `kit.tsx` / `common.tsx` / `pickers.tsx`, `organizer/{logic-web,page,overview,finances,payments,participants-web,schedule}.ts(x)`, the changes to `web.ts`, `web-shell.tsx`, `manage.tsx`, `timetable.tsx`, `participants.tsx`, `planning.tsx`, the other tabs' header rows, `test/wide-web.ts`, the new test files.
- §4 Changes made: the lot Web 2 commits.
- §6 Next steps, `0-web`: lot Web 2 done. Add the review's deferred minors and the five proposals below (not built). Lot Web 3 stays next (toasts on every mutation, skeletons, keyboard and contrast pass, 30 s refresh on Time Table and leaderboard, leaderboard search, optimistic promo-code toggle).

- [ ] **Step 4: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add README.md handoff.md
git diff --cached --stat
git commit -m "docs: organizer space on a computer, lot Web 2 and the Circle21 look: README and handoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Proposals from the recording (not built in this lot)

The recording shows these patterns, which the backlog does not list yet. Each would reuse a piece this lot builds; each needs the owner's go-ahead and its own plan.

1. **Create forms in the side panel** (refs 08, 13). New category, WOD, heat and promo code would open in `SidePanel` with a sticky [Annuler] [Enregistrer] footer, instead of replacing the page. This is front only. The forms exist (`CategoryForm`, `WodForm`, `HeatForm`, `CouponForm`), so the change is where they render on a computer.
2. **A bottom-left notice card** (refs 16, 17). A dismissible card for one important message (« Ta demande de publication a été renvoyée : voir la note »), which collapses to a pill. It is front only when it shows state the app already has (publication note, payments to collect). Its « seen » state would live on the device.
3. **Setting cards with inline ✓ save** (refs 05, 06). General would become a stack of cards (« Parle-nous de ton événement », dates, prix), each with its own small ✓ that saves only its fields. This is front only (`PUT /competitions/:id` already accepts partial bodies). Watch out: the partial-`PUT` dates bug noted in handoff §5 must be settled first.
4. **Radio cards** (refs 10, 21). Choices like the event format (Sur place / En ligne / Hybride) or the promo code type as bordered cards, the chosen one expanded with its options. Front only, a restyle of today's chips.
5. **The « Voir tout » card grid** (ref 02). Every overview card would get a « Voir tout » that opens the full list (categories → Participants filtered, scores → the judging state, gender → Participants by category gender). This lot does it for the categories card. Scores would need a page the app does not have (judging lives in the admin panel).
