# Organizer Space on a Computer — Lot Web 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a computer browser the organizer space becomes a desktop tool: a left menu grouped like the Circle21 portal, a top bar (status, preview, publication request, share), a centered content column, one CSV export on every list (a downloaded file on the web), and empty pages that say what to do first; the phone keeps its 11 tabs.

**Architecture:** Same route and same tab components as lots A and B. `ManageScreen` asks `useWideWeb()` (browser and window ≥ 1024 px): wide → `OrganizerWeb` (menu + top bar + centered column) around the current tab component; otherwise the existing chips. The tab state stays in `ManageScreen`, so crossing 1024 px keeps the page. Pure rules in `organizer/web.ts` and new CSV builders in `organizer/logic-b.ts`; the platform part of the export in `organizer/export.ts`.

**Tech Stack:** Expo / React Native + react-native-web, Expo Router, React Query; Jest + `expo-router/testing-library`, `FakeBackend` (`test/fake-api.ts`), `renderScreen` (`test/harness.tsx`), fixtures `test/organizer-fixtures.ts`.

**Spec:** `docs/superpowers/specs/2026-10-15-organizer-dashboard-circle21-analysis.md` (§3 items 1, 2, 3 and 6; §4 « Lot web 1 »), plus the design agreed in chat on 2026-10-15 (approach A: same screen, wide layout on a computer, phone unchanged). Earlier conventions: `docs/superpowers/plans/2026-10-14-organizer-space-lot-b.md`.

## Global Constraints

- Branch `feat/organizer-space` (owner, 2026-10-15: « faire amélioration sur les branches organizer-space sans toucher backend »). Stage files **by name**; never `git commit -a` / `git add -A` (eight files show as modified only by line endings or a build cache: `.gitignore`, `apps/admin/tsconfig.tsbuildinfo`, `apps/mobile-rn/package-lock.json`, `infra/docker-compose.yml`, `infra/mariadb/init/01-accounts.sql`, three Rust plan/spec docs). Check `git diff --cached --stat` before each commit. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No change under `apps/api` or `apps/admin`.** No new dependency. Do not run `npx expo lint` (no ESLint config; it installs a package and edits `package.json`); the app's lint is `npx tsc --noEmit`. Do not touch `android/` or `ios/`.
- Wide layout = `Platform.OS === 'web'` **and** window width ≥ **1024** px. Native apps (phones, tablets) and narrow browser windows keep the 11 chips exactly as today.
- Content column on a computer: **752** px for form pages (720 px of fields + 2 × 16 px padding), **1200** px for dashboard, participants, heats and leaderboard.
- Menu (left, 248 px): Tableau de bord · **Général** (Infos de l'événement, Catégories, Codes promo, Équipe) · Participants · **Planning** (WODs, Heats) · Classement · Annonces. A section with one page is one entry with the page's name.
- Every app text in `src/core/i18n/{en,fr,ar}.json`, same keys and placeholders in the three files (French uses « tu »), all new keys added in Task 1. On the web the layout is not mirrored in Arabic (the app skips `forceRTL` on web on purpose); phones mirror.
- Exports: CSV text built by `toCsv` (every cell goes through `csvCell`: cells starting with `= + - @` tab or CR get a leading `'`). On the web a file is downloaded, UTF-8 **with a byte-order mark** (`﻿`) so spreadsheets keep the accents; on a phone the text goes to the share sheet. File name `<competition slug>-<list>.csv` (`event-<list>.csv` when there is no slug).
- Tests: two taps go inside one `await act(async () => { … })`; `FakeBackend` cannot answer 204 → stub `DELETE` routes with `[200, {}]`; restore a file with `git show HEAD:<path> > <path>` (`git checkout --` is blocked by a hook); full suite with `npx jest --maxWorkers=2`.

## Review Focus

1. **Crossing 1024 px while working** (window resized, laptop docked) → the same page stays open; text typed but not saved in a form is reset because the page is rebuilt in the other layout. → Task 4 test « a narrow window keeps the page that was open ».
2. **An organizer who loses access while on the computer layout** (removed by a co-organizer, draft reloaded as 404) → « Accès réservé aux organisateurs », never an empty menu. → Task 4 test « no menu for someone who is not an organizer ».
3. **Exporting an empty list** (no heat shown after filtering, no code, no score) → the export button is disabled, no empty file. → Task 2 test « nothing to export: the button is off ».
4. **Accents and Arabic names in a spreadsheet** → the downloaded file starts with a UTF-8 byte-order mark. → Task 2 test « downloads a UTF-8 file with a byte-order mark ».
5. **A name, username or code that starts like a formula** in any export → kept as text. → Task 1 test « the team by role, and a leaderboard of one category » (`=karim`).

---

### Task 1: Rules and texts — web layout, export builders, every new key

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/web.ts`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/logic-b.ts` (`toCsv`, `registrationsCsv` rewritten on it, `heatsCsv`, `couponsCsv`, `staffCsv`, `leaderboardCsv`, `csvFileName`)
- Modify: `apps/mobile-rn/src/core/i18n/en.json`, `fr.json`, `ar.json`
- Test: `apps/mobile-rn/test/core/organizer-web.test.ts`

**Interfaces:**
- Consumes: lot A `missingForPublication`, `publicationState`, `TAB_FOR`, `ManageTab` (`organizer/logic.ts`); lot B `csvCell` (private), `personName`, `staffByRole`, `STAFF_ORDER` (`organizer/logic-b.ts`); fixtures `event`, `regs`.
- Produces:
  - `web.ts`: `WIDE_WEB_MIN = 1024`, `isWideWeb(os: string, width: number): boolean`, `useWideWeb(): boolean`, `MenuSectionKey`, `MenuSection = { key: MenuSectionKey; tabs: ManageTab[] }`, `ORG_MENU: MenuSection[]`, `FORM_WIDTH = 752`, `WIDE_WIDTH = 1200`, `contentWidth(tab: ManageTab): number`, `MenuMark = 'todo' | number`, `menuMarks(c: Json, toCollect: number): Partial<Record<ManageTab, MenuMark>>`.
  - `logic-b.ts`: `toCsv(head: string[], rows: unknown[][]): string`, `heatsCsv(heats: Json[]): string`, `couponsCsv(coupons: Json[], categories: Json[], currency: string): string`, `staffCsv(rows: Json[]): string`, `leaderboardCsv(rows: Json[], category: string): string`, `csvFileName(c: Json, list: string): string`.
  - Keys `orgMenuEventInfo`, `orgMenuHeats`, `orgMenuLabel`, `orgMarkTodo`, `orgPillDraft`, `orgPillRequested`, `orgPillReturned`, `orgPillCancelled`, `orgTopDates` (`{from}`, `{to}`), `orgPreview`, `orgExport`, `orgNeedCategory`, `orgNeedWod`, `orgGoCategories`, `orgGoWods`.

- [ ] **Step 1: Write the failing unit tests**

`apps/mobile-rn/test/core/organizer-web.test.ts`:
```ts
import { couponsCsv, csvFileName, heatsCsv, leaderboardCsv, registrationsCsv, staffCsv } from '../../src/features/competitions/organizer/logic-b';
import { contentWidth, FORM_WIDTH, isWideWeb, menuMarks, ORG_MENU, WIDE_WIDTH } from '../../src/features/competitions/organizer/web';
import { event, regs } from '../organizer-fixtures';

describe('web layout rules', () => {
  it('the wide layout is for a browser window of 1024 px or more', () => {
    expect(isWideWeb('web', 1024)).toBe(true);
    expect(isWideWeb('web', 1023)).toBe(false);
    expect(isWideWeb('ios', 1366)).toBe(false);
    expect(isWideWeb('android', 1280)).toBe(false);
  });

  it('the menu holds every tab of the organizer space exactly once', () => {
    const tabs = ORG_MENU.flatMap((s) => s.tabs);
    expect([...tabs].sort()).toEqual(['announcements', 'categories', 'coupons', 'dashboard', 'general', 'leaderboard', 'participants', 'planning', 'team', 'wods']);
  });

  it('forms stay narrow, figures and tables use the room', () => {
    expect(contentWidth('general')).toBe(FORM_WIDTH);
    expect(contentWidth('wods')).toBe(FORM_WIDTH);
    for (const tab of ['dashboard', 'participants', 'planning', 'leaderboard'] as const) expect(contentWidth(tab)).toBe(WIDE_WIDTH);
    expect(FORM_WIDTH - 32).toBe(720);
  });

  it('marks what the draft still misses and the number to collect', () => {
    const draft = { ...event, status: 'DRAFT', coverUrl: null, categories: [], workouts: [] };
    expect(menuMarks(draft, 2)).toEqual({ general: 'todo', categories: 'todo', wods: 'todo', participants: 2 });
    expect(menuMarks({ ...draft, publicationRequestedAt: '2026-10-15T08:00:00.000Z' }, 0)).toEqual({});
    expect(menuMarks(event, 0)).toEqual({});
  });
});

describe('exports', () => {
  it('a lane sheet: every lane of every heat, free lanes included', () => {
    const h = { name: 'RX Men · Heat 1', startsAt: '2026-12-12T10:00:00.000Z', laneCount: 3, workout: { name: 'WOD 1' }, category: { name: 'RX Men' }, lanes: [{ lane: 2, athlete: { fullName: 'Hédi Kéfi', username: 'hedi' } }] };
    expect(heatsCsv([h]).split('\n')).toEqual([
      'heat,starts_at,wod,category,lane,athlete,username',
      'RX Men · Heat 1,2026-12-12T10:00:00.000Z,WOD 1,RX Men,1,,',
      'RX Men · Heat 1,2026-12-12T10:00:00.000Z,WOD 1,RX Men,2,Hédi Kéfi,hedi',
      'RX Men · Heat 1,2026-12-12T10:00:00.000Z,WOD 1,RX Men,3,,',
    ]);
  });

  it('promo codes with their value in the event currency', () => {
    const list = [
      { code: 'EARLY', type: 'PERCENTAGE', value: 20, categoryId: null, maxUses: 50, usedCount: 12, expiresAt: '2026-11-01T22:00:00.000Z', active: true },
      { code: 'TEN', type: 'FIXED_AMOUNT', value: 10000, categoryId: 'k2', maxUses: null, usedCount: 0, expiresAt: null, active: false },
      { code: 'GIFT', type: 'FREE', value: 0, categoryId: null, maxUses: 1, usedCount: 1, expiresAt: null, active: true },
    ];
    expect(couponsCsv(list, event.categories, 'TND').split('\n')).toEqual([
      'code,type,value,category,used,max_uses,expires_at,active',
      'EARLY,PERCENTAGE,20,,12,50,2026-11-01T22:00:00.000Z,yes',
      'TEN,FIXED_AMOUNT,10.000,RX Women,0,,,no',
      'GIFT,FREE,,,1,1,,yes',
    ]);
  });

  it('the team by role, and a leaderboard of one category', () => {
    const staff = [
      { role: 'JUDGE', user: { username: 'zed' } },
      { role: 'ORGANIZER', user: { username: 'a', profile: { fullName: 'Amel' } } },
    ];
    expect(staffCsv(staff).split('\n')).toEqual(['role,name,username', 'ORGANIZER,Amel,a', 'JUDGE,zed,zed']);
    const rows = [
      { rank: 1, athlete: { fullName: 'Hédi Kéfi', username: 'hedi' }, totalPoints: 180, pending: 0 },
      { rank: 2, athlete: { fullName: null, username: '=karim' }, totalPoints: 150, pending: 1 },
    ];
    expect(leaderboardCsv(rows, 'RX Men').split('\n')).toEqual(['category,rank,name,username,points,pending', 'RX Men,1,Hédi Kéfi,hedi,180,0', "RX Men,2,'=karim,'=karim,150,1"]);
  });

  it('file names carry the event address name', () => {
    expect(csvFileName({ slug: 'sousse-summer-2026' }, 'heats')).toBe('sousse-summer-2026-heats.csv');
    expect(csvFileName({}, 'team')).toBe('event-team.csv');
  });

  it('registrations still export as before', () => {
    expect(registrationsCsv([regs[0]]).split('\n')).toEqual([
      'name,username,category,registration,payment,amount,currency,registered_at',
      'Sami Ben Ali,sami_rx,RX Men,PENDING,PENDING,40.000,TND,2026-10-21T09:00:00.000Z',
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/core/organizer-web.test.ts`
Expected: FAIL — `Cannot find module '../../src/features/competitions/organizer/web'`.

- [ ] **Step 3: Write the web layout rules**

`apps/mobile-rn/src/features/competitions/organizer/web.ts`:
```ts
import { Platform, useWindowDimensions } from 'react-native';

import type { Json } from '../../../core/api/client';
import { missingForPublication, publicationState, TAB_FOR, type ManageTab } from './logic';

/** Organizer space on a computer (analysis 2026-10-15, lot Web 1): a wide layout in the browser, the phone keeps its tabs. */

export const WIDE_WEB_MIN = 1024;

export const isWideWeb = (os: string, width: number) => os === 'web' && width >= WIDE_WEB_MIN;

/** Read again on every resize: crossing 1024 px switches the layout without a reload. */
export function useWideWeb(): boolean {
  const { width } = useWindowDimensions();
  return isWideWeb(Platform.OS, width);
}

export type MenuSectionKey = 'dashboard' | 'general' | 'participants' | 'planning' | 'leaderboard' | 'messages';
export type MenuSection = { key: MenuSectionKey; tabs: ManageTab[] };

/** Left menu, grouped by stage like the Circle21 portal; a section with one page is a single entry. */
export const ORG_MENU: MenuSection[] = [
  { key: 'dashboard', tabs: ['dashboard'] },
  { key: 'general', tabs: ['general', 'categories', 'coupons', 'team'] },
  { key: 'participants', tabs: ['participants'] },
  { key: 'planning', tabs: ['wods', 'planning'] },
  { key: 'leaderboard', tabs: ['leaderboard'] },
  { key: 'messages', tabs: ['announcements'] },
];

/** Content column: forms stay readable (720 px of fields + padding), figures and tables use the room. */
export const FORM_WIDTH = 752;
export const WIDE_WIDTH = 1200;
const WIDE_TABS: ManageTab[] = ['dashboard', 'participants', 'planning', 'leaderboard'];
export const contentWidth = (tab: ManageTab) => (WIDE_TABS.includes(tab) ? WIDE_WIDTH : FORM_WIDTH);

export type MenuMark = 'todo' | number;

/** Menu marks: « todo » where the publication checklist still misses something (draft or sent back), the number to collect on Participants. */
export function menuMarks(c: Json, toCollect: number): Partial<Record<ManageTab, MenuMark>> {
  const marks: Partial<Record<ManageTab, MenuMark>> = {};
  const state = publicationState(c);
  if (state === 'DRAFT' || state === 'RETURNED') for (const item of missingForPublication(c)) marks[TAB_FOR[item]] = 'todo';
  if (toCollect > 0) marks.participants = toCollect;
  return marks;
}
```

- [ ] **Step 4: Write the export builders**

In `apps/mobile-rn/src/features/competitions/organizer/logic-b.ts`, replace:
```ts
/** Spreadsheet export: one line per registration; amounts in currency units (3 decimals for TND, 2 otherwise), dates in ISO. */
export function registrationsCsv(rows: Json[]): string {
  const head = 'name,username,category,registration,payment,amount,currency,registered_at';
  const lines = rows.map((r) => {
    const digits = r.currency === 'TND' ? 3 : 2;
    return [personName(r), r.user?.username ?? '', r.category?.name ?? '', r.registrationStatus, r.paymentStatus, (Number(r.finalPrice ?? 0) / 10 ** digits).toFixed(digits), r.currency, r.registeredAt].map(csvCell).join(',');
  });
  return [head, ...lines].join('\n');
}
```
with:
```ts
/** One CSV text: the header line, then one line per row; every cell goes through `csvCell`. */
export const toCsv = (head: string[], rows: unknown[][]) => [head.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');

/** Amount in currency units: 3 decimals for TND (millimes), 2 otherwise. */
const units = (amount: unknown, currency: string) => {
  const digits = currency === 'TND' ? 3 : 2;
  return (Number(amount ?? 0) / 10 ** digits).toFixed(digits);
};

/** Spreadsheet export: one line per registration; amounts in currency units, dates in ISO. */
export function registrationsCsv(rows: Json[]): string {
  return toCsv(
    ['name', 'username', 'category', 'registration', 'payment', 'amount', 'currency', 'registered_at'],
    rows.map((r) => [personName(r), r.user?.username ?? '', r.category?.name ?? '', r.registrationStatus, r.paymentStatus, units(r.finalPrice, r.currency), r.currency, r.registeredAt]),
  );
}

/** Lane sheet to print for the floor: one line per lane of every heat, free lanes included. */
export function heatsCsv(heats: Json[]): string {
  const rows: unknown[][] = [];
  for (const h of heats) {
    const byLane = new Map<number, Json>((h.lanes ?? []).map((l: Json) => [l.lane, l]));
    for (let n = 1; n <= (h.laneCount ?? 0); n++) {
      const l = byLane.get(n);
      rows.push([h.name, h.startsAt ?? '', h.workout?.name ?? '', h.category?.name ?? '', n, l ? personName(l) : '', l?.athlete?.username ?? '']);
    }
  }
  return toCsv(['heat', 'starts_at', 'wod', 'category', 'lane', 'athlete', 'username'], rows);
}

export function couponsCsv(coupons: Json[], categories: Json[], currency: string): string {
  const names = new Map(categories.map((k) => [k.id, k.name]));
  return toCsv(
    ['code', 'type', 'value', 'category', 'used', 'max_uses', 'expires_at', 'active'],
    coupons.map((k) => [
      k.code,
      k.type,
      k.type === 'PERCENTAGE' ? k.value : k.type === 'FIXED_AMOUNT' ? units(k.value, currency) : '',
      k.categoryId ? (names.get(k.categoryId) ?? '') : '',
      k.usedCount ?? 0,
      k.maxUses ?? '',
      k.expiresAt ?? '',
      k.active ? 'yes' : 'no',
    ]),
  );
}

export const staffCsv = (rows: Json[]) => {
  const groups = staffByRole(rows);
  return toCsv(['role', 'name', 'username'], STAFF_ORDER.flatMap((role) => groups[role].map((s) => [role, personName(s), s.user?.username ?? ''])));
};

export const leaderboardCsv = (rows: Json[], category: string) =>
  toCsv(['category', 'rank', 'name', 'username', 'points', 'pending'], rows.map((r) => [category, r.rank, r.athlete?.fullName || r.athlete?.username || '', r.athlete?.username ?? '', r.totalPoints, r.pending ?? 0]));

/** `<address name>-<list>.csv`, so the organizer's downloads stay apart. */
export const csvFileName = (c: Json, list: string) => `${c.slug || 'event'}-${list}.csv`;
```
`staffByRole` and `STAFF_ORDER` are declared further down in the same file; a function body that runs later may use them, but if TypeScript reports « used before its declaration » for `STAFF_ORDER`, move `staffCsv` below the « Team » section.

- [ ] **Step 5: Add every new text**

Save as `<scratchpad>/org-web-i18n.json`:
```json
{
  "en": { "orgMenuEventInfo": "Event details", "orgMenuHeats": "Heats", "orgMenuLabel": "Organizer space menu", "orgMarkTodo": "to do", "orgPillDraft": "Draft", "orgPillRequested": "Publication requested", "orgPillReturned": "Sent back", "orgPillCancelled": "Cancelled", "orgTopDates": "Registration {from} → {to}", "orgPreview": "Preview", "orgExport": "Export (CSV)", "orgNeedCategory": "Create a category first: heats and the leaderboard belong to one.", "orgNeedWod": "Add a WOD first: heats and the leaderboard need one.", "orgGoCategories": "Go to categories", "orgGoWods": "Go to WODs" },
  "fr": { "orgMenuEventInfo": "Infos de l'événement", "orgMenuHeats": "Heats", "orgMenuLabel": "Menu de l'espace organisateur", "orgMarkTodo": "à faire", "orgPillDraft": "Brouillon", "orgPillRequested": "Publication demandée", "orgPillReturned": "Renvoyé", "orgPillCancelled": "Annulé", "orgTopDates": "Inscriptions du {from} au {to}", "orgPreview": "Aperçu", "orgExport": "Exporter (CSV)", "orgNeedCategory": "Crée d'abord une catégorie : les heats et le classement s'y rattachent.", "orgNeedWod": "Ajoute d'abord un WOD : les heats et le classement en ont besoin.", "orgGoCategories": "Aller aux catégories", "orgGoWods": "Aller aux WODs" },
  "ar": { "orgMenuEventInfo": "معلومات الحدث", "orgMenuHeats": "الدفعات", "orgMenuLabel": "قائمة فضاء المنظِّم", "orgMarkTodo": "مطلوب", "orgPillDraft": "مسودة", "orgPillRequested": "طُلب النشر", "orgPillReturned": "أُعيد للتعديل", "orgPillCancelled": "ملغى", "orgTopDates": "التسجيل من {from} إلى {to}", "orgPreview": "معاينة", "orgExport": "تصدير (CSV)", "orgNeedCategory": "أنشئ فئة أولاً: الدفعات والترتيب مرتبطة بها.", "orgNeedWod": "أضف تمريناً أولاً: الدفعات والترتيب تحتاج إليه.", "orgGoCategories": "الذهاب إلى الفئات", "orgGoWods": "الذهاب إلى التمارين" }
}
```
Merge it (in `apps/mobile-rn`):
```bash
node -e '
const fs = require("fs");
const add = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const lang of ["en", "fr", "ar"]) {
  const p = `src/core/i18n/${lang}.json`;
  const cur = JSON.parse(fs.readFileSync(p, "utf8"));
  const clash = Object.keys(add[lang]).filter((k) => k in cur);
  if (clash.length) throw new Error(`${lang}: keys already exist: ${clash.join(", ")}`);
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...add[lang] }, null, 2) + "\n");
}
console.log("ok");' <scratchpad>/org-web-i18n.json
```
Expected: `ok`, and `git diff --stat src/core/i18n` shows 15 added keys per file.

- [ ] **Step 6: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/core/organizer-web.test.ts test/core/organizer-logic-b.test.ts test/core/i18n.test.ts test/core/i18n-usage.test.ts && npx tsc --noEmit`
Expected: PASS (the lot B CSV tests unchanged), no type error.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/web.ts apps/mobile-rn/src/features/competitions/organizer/logic-b.ts apps/mobile-rn/test/core/organizer-web.test.ts apps/mobile-rn/src/core/i18n/en.json apps/mobile-rn/src/core/i18n/fr.json apps/mobile-rn/src/core/i18n/ar.json
git diff --cached --stat
git commit -m "feat(mobile): organizer web rules: wide layout, grouped menu, export builders, texts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One export for every organizer list

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/export.ts`
- Modify: `organizer/participants.tsx`, `organizer/planning.tsx`, `organizer/coupons.tsx`, `organizer/team.tsx`, `organizer/leaderboard.tsx` (one button each)
- Test: `apps/mobile-rn/test/core/organizer-export.test.ts`, `apps/mobile-rn/test/screens/organizer-export.test.tsx`

**Interfaces:**
- Consumes: Task 1 `registrationsCsv`, `heatsCsv`, `couponsCsv`, `staffCsv`, `leaderboardCsv`, `csvFileName`, key `orgExport`.
- Produces: `csvFileContent(text: string): string` (adds the byte-order mark), `CsvDoc`, `CsvUrls`, `downloadCsv(fileName: string, text: string, doc?: CsvDoc, urls?: CsvUrls): void`, `exportCsv(fileName: string, text: string): void`. Buttons `reg-csv` (kept), `heat-export`, `coupon-export`, `team-export`, `board-export`.

- [ ] **Step 1: Write the failing tests**

`apps/mobile-rn/test/core/organizer-export.test.ts`:
```ts
import { Share } from 'react-native';

import { csvFileContent, downloadCsv, exportCsv } from '../../src/features/competitions/organizer/export';

describe('organizer export', () => {
  afterEach(() => jest.restoreAllMocks());

  it('downloads a UTF-8 file with a byte-order mark, so a spreadsheet keeps the accents', () => {
    expect(csvFileContent('name\nHédi')).toBe('﻿name\nHédi');
    const a = { href: '', download: '', click: jest.fn() };
    const body = { appendChild: jest.fn(), removeChild: jest.fn() };
    const urls = { createObjectURL: jest.fn(() => 'blob:1'), revokeObjectURL: jest.fn() };
    downloadCsv('event-team.csv', 'name\nHédi', { createElement: () => a, body }, urls);
    expect(urls.createObjectURL).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ href: 'blob:1', download: 'event-team.csv' });
    expect(a.click).toHaveBeenCalledTimes(1);
    expect(body.removeChild).toHaveBeenCalledWith(a);
  });

  it('on a phone the text goes to the share sheet', () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    exportCsv('event-team.csv', 'a,b');
    expect(share).toHaveBeenCalledWith({ title: 'event-team.csv', message: 'a,b' });
  });
});
```
`apps/mobile-rn/test/screens/organizer-export.test.tsx`:
```tsx
import { Share } from 'react-native';
import { fireEvent } from 'expo-router/testing-library';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const heats = [{ id: 'h1', number: 1, name: 'RX Men · Heat 1', startsAt: '2026-12-12T10:00:00.000Z', durationMin: 12, laneCount: 2, workout: { id: 'w1', name: 'WOD 1', number: 1 }, category: { id: 'k1', name: 'RX Men' }, lanes: [] }];
const coupons = [{ id: 'p1', code: 'EARLY', type: 'PERCENTAGE', value: 20, categoryId: null, maxUses: 50, usedCount: 12, expiresAt: null, active: true }];
const staff = [{ id: 's1', userId: 'u-me', role: 'ORGANIZER', user: { username: 'ahmed_rx', profile: { fullName: 'Ahmed Ben Salah' } } }];
const board = (rows: object[]) => ({ status: 'REGISTRATION_OPEN', provisional: true, rows });

describe('organizer space: one export everywhere', () => {
  let share: jest.SpyInstance;
  beforeEach(() => {
    share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  });
  afterEach(() => jest.restoreAllMocks());

  const sent = () => ({ title: share.mock.calls[0][0].title as string, head: (share.mock.calls[0][0].message as string).split('\n')[0] });

  it('participants', async () => {
    const screen = await renderScreen(open('participants'), orgBackend());
    await fireEvent.press(await screen.findByTestId('reg-csv'));
    expect(sent()).toEqual({ title: 'event-participants.csv', head: 'name,username,category,registration,payment,amount,currency,registered_at' });
  });

  it('heats, as a lane sheet', async () => {
    const screen = await renderScreen(open('planning'), orgBackend().on('GET', '/competitions/c9/heats', [200, heats]));
    await fireEvent.press(await screen.findByTestId('heat-export'));
    expect(sent()).toEqual({ title: 'event-heats.csv', head: 'heat,starts_at,wod,category,lane,athlete,username' });
    expect((share.mock.calls[0][0].message as string).split('\n')).toHaveLength(3);
  });

  it('promo codes', async () => {
    const screen = await renderScreen(open('coupons'), orgBackend().on('GET', '/competitions/c9/coupons', [200, coupons]));
    await fireEvent.press(await screen.findByTestId('coupon-export'));
    expect(sent()).toEqual({ title: 'event-coupons.csv', head: 'code,type,value,category,used,max_uses,expires_at,active' });
  });

  it('team', async () => {
    const screen = await renderScreen(open('team'), orgBackend().on('GET', '/competitions/c9/staff', [200, staff]));
    await fireEvent.press(await screen.findByTestId('team-export'));
    expect(sent()).toEqual({ title: 'event-team.csv', head: 'role,name,username' });
  });

  it('leaderboard of the category shown', async () => {
    const rows = [{ rank: 1, athlete: { id: 'u-r3', fullName: 'Hédi Kéfi', username: 'hedi' }, totalPoints: 180, pending: 0 }];
    const screen = await renderScreen(open('leaderboard'), orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board(rows)]));
    await fireEvent.press(await screen.findByTestId('board-export'));
    expect(sent()).toEqual({ title: 'event-leaderboard.csv', head: 'category,rank,name,username,points,pending' });
    expect((share.mock.calls[0][0].message as string).split('\n')[1]).toBe('RX Men,1,Hédi Kéfi,hedi,180,0');
  });

  it('nothing to export: the button is off', async () => {
    const screen = await renderScreen(open('leaderboard'), orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board([])]));
    expect((await screen.findByTestId('board-export')).props.accessibilityState?.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/core/organizer-export.test.ts test/screens/organizer-export.test.tsx`
Expected: FAIL — `Cannot find module '…/organizer/export'`; in the screen file `heat-export` / `coupon-export` / `team-export` / `board-export` are not found and the participants export has no `title`.

- [ ] **Step 3: Write the export**

`apps/mobile-rn/src/features/competitions/organizer/export.ts`:
```ts
import { Platform, Share } from 'react-native';

/** What the download needs from the page and from `URL` (passed in by the tests). */
export type CsvDoc = { createElement(tag: 'a'): { href: string; download: string; click(): void }; body: { appendChild(node: unknown): void; removeChild(node: unknown): void } };
export type CsvUrls = { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };

/** UTF-8 with a byte-order mark: spreadsheets then read the accents and the Arabic names. */
export const csvFileContent = (text: string) => `﻿${text}`;

/** On the web: the CSV is downloaded as a file. */
export function downloadCsv(fileName: string, text: string, doc: CsvDoc = document as unknown as CsvDoc, urls: CsvUrls = URL) {
  const url = urls.createObjectURL(new Blob([csvFileContent(text)], { type: 'text/csv;charset=utf-8' }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  // The browser has the file once the click returns; the address is freed a moment later.
  setTimeout(() => urls.revokeObjectURL(url), 1000);
}

/** One export for every organizer list: a file on the web, the share sheet on a phone (the app has no file library). */
export function exportCsv(fileName: string, text: string) {
  if (Platform.OS === 'web') downloadCsv(fileName, text);
  else void Share.share({ title: fileName, message: text });
}
```

- [ ] **Step 4: Put « Exporter (CSV) » on every list**

`organizer/participants.tsx`:
- add `import { exportCsv } from './export';` after the `./api` import, and `csvFileName` to the `./logic-b` import (`import { csvFileName, filterRegistrations, personName, registrationsCsv, toCollect, type PaymentFilter } from './logic-b';`); `Share` stays imported (the receipt uses it);
- replace the line of the `reg-csv` button with:
```tsx
          <Button testID="reg-csv" kind="outlined" icon="file-download" label={t('orgExport')} disabled={rows.length === 0} onPress={() => exportCsv(csvFileName(c, 'participants'), registrationsCsv(rows))} />
```

`organizer/planning.tsx`:
- add `import { exportCsv } from './export';` after the `./api` import, and `csvFileName, heatsCsv` to the `./logic-b` import;
- in the list view, right after the closing `</View>` of the row that holds the two `Select` filters (`heat-filter-cat`, `heat-filter-wod`), insert:
```tsx
          <Button testID="heat-export" kind="outlined" icon="file-download" label={t('orgExport')} disabled={shown.length === 0} onPress={() => exportCsv(csvFileName(c, 'heats'), heatsCsv(shown))} />
```

`organizer/coupons.tsx`:
- add `import { exportCsv } from './export';` after the `./api` import, and `couponsCsv, csvFileName` to the `./logic-b` import;
- replace:
```tsx
      <SectionHeader title={t('orgCouponAll')} />
```
with:
```tsx
      <SectionHeader title={t('orgCouponAll')} />
      <Button testID="coupon-export" kind="outlined" icon="file-download" label={t('orgExport')} disabled={list.data.length === 0} onPress={() => exportCsv(csvFileName(c, 'coupons'), couponsCsv(list.data, c.categories ?? [], c.currency))} />
```

`organizer/team.tsx`:
- add `import { exportCsv } from './export';` after the `./api` import, and change the `./logic-b` import to `import { csvFileName, personName, STAFF_ORDER, staffByRole, staffCsv } from './logic-b';`;
- replace:
```tsx
      <Button testID="team-add" icon="person-add" label={t('orgTeamAdd')} busy={busy} onPress={() => setAdding(true)} />
```
with:
```tsx
      <Button testID="team-add" icon="person-add" label={t('orgTeamAdd')} busy={busy} onPress={() => setAdding(true)} />
      <Button testID="team-export" kind="outlined" icon="file-download" label={t('orgExport')} disabled={staff.data.length === 0} onPress={() => exportCsv(csvFileName(c, 'team'), staffCsv(staff.data))} />
```

`organizer/leaderboard.tsx`:
- change the kit import to `import { Button, Card, Chip, ListGroup, Screen, Txt } from '../../../core/widgets/kit';`, then add `import { exportCsv } from './export';` and `import { csvFileName, leaderboardCsv } from './logic-b';` after the `../api` import;
- replace:
```tsx
          <StatusPill testID="board-status" label={board.data.provisional ? t('orgBoardProvisional') : t('orgBoardFinal')} color={board.data.provisional ? colors.outline : colors.primary} />
```
with:
```tsx
          <StatusPill testID="board-status" label={board.data.provisional ? t('orgBoardProvisional') : t('orgBoardFinal')} color={board.data.provisional ? colors.outline : colors.primary} />
          <Button
            testID="board-export"
            kind="outlined"
            icon="file-download"
            label={t('orgExport')}
            disabled={board.data.rows.length === 0}
            onPress={() => exportCsv(csvFileName(c, 'leaderboard'), leaderboardCsv(board.data.rows, categories.find((k) => k.id === categoryId)?.name ?? ''))}
          />
```

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/core/organizer-export.test.ts test/screens/organizer-export.test.tsx test/screens/organizer-participants.test.tsx test/screens/organizer-planning.test.tsx test/screens/organizer-coupons.test.tsx test/screens/organizer-team.test.tsx test/screens/organizer-leaderboard.test.tsx && npx tsc --noEmit`
Expected: PASS, no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/export.ts apps/mobile-rn/src/features/competitions/organizer/participants.tsx apps/mobile-rn/src/features/competitions/organizer/planning.tsx apps/mobile-rn/src/features/competitions/organizer/coupons.tsx apps/mobile-rn/src/features/competitions/organizer/team.tsx apps/mobile-rn/src/features/competitions/organizer/leaderboard.tsx apps/mobile-rn/test/core/organizer-export.test.ts apps/mobile-rn/test/screens/organizer-export.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): one CSV export on every organizer list (file on the web, share sheet on phones)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Empty pages that say what to do first

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/guide.tsx`
- Modify: `organizer/wods.tsx`, `organizer/planning.tsx`, `organizer/leaderboard.tsx` (optional `onGo` prop + guide), `organizer/manage.tsx` (passes `onGo={setTab}`)
- Test: `apps/mobile-rn/test/screens/organizer-guides.test.tsx`

**Interfaces:**
- Consumes: keys `orgNeedCategory`, `orgNeedWod`, `orgGoCategories`, `orgGoWods` (Task 1); `ManageTab` (lot A).
- Produces: `Guide({ testID, message, action, onPress })` — a card with the message and, when `onPress` is given, a button `<testID>-go`. `WodsTab`, `PlanningTab`, `LeaderboardTab` accept `onGo?: (tab: ManageTab) => void`. Guide testIDs `guide-categories`, `guide-wods` (buttons `guide-categories-go`, `guide-wods-go`).

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-guides.test.tsx`:
```tsx
import { fireEvent } from 'expo-router/testing-library';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const noCategory = { ...event, categories: [] };
const noWod = { ...event, workouts: [] };

describe('organizer space: empty pages guide the organizer', () => {
  it('heats without a category: create one first, the button opens Categories', async () => {
    const screen = await renderScreen(open('planning'), orgBackend(noCategory).on('GET', '/competitions/c9/heats', [200, []]));
    expect(await screen.findByText('Create a category first: heats and the leaderboard belong to one.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('guide-categories-go'));
    expect(await screen.findByTestId('cat-new')).toBeTruthy();
  });

  it('heats with a category but no WOD: add a WOD first', async () => {
    const screen = await renderScreen(open('planning'), orgBackend(noWod).on('GET', '/competitions/c9/heats', [200, []]));
    expect(await screen.findByText('Add a WOD first: heats and the leaderboard need one.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('guide-wods-go'));
    expect(await screen.findByTestId('wod-new')).toBeTruthy();
  });

  it('heats once categories and WODs exist: the usual empty message', async () => {
    const screen = await renderScreen(open('planning'), orgBackend().on('GET', '/competitions/c9/heats', [200, []]));
    expect(await screen.findByText('No heat yet. Create one, or generate them from a category.')).toBeTruthy();
    expect(screen.queryByTestId('guide-categories')).toBeNull();
  });

  it('the leaderboard without a WOD guides to WODs', async () => {
    const screen = await renderScreen(open('leaderboard'), orgBackend(noWod));
    await fireEvent.press(await screen.findByTestId('guide-wods-go'));
    expect(await screen.findByTestId('wod-new')).toBeTruthy();
  });

  it('the leaderboard without a category guides to Categories', async () => {
    const screen = await renderScreen(open('leaderboard'), orgBackend(noCategory));
    expect(await screen.findByTestId('guide-categories')).toBeTruthy();
  });

  it('WODs without a category: a hint, and a WOD can still be created', async () => {
    const screen = await renderScreen(open('wods'), orgBackend({ ...noCategory, workouts: [] }));
    expect(await screen.findByTestId('guide-categories')).toBeTruthy();
    expect(screen.getByTestId('wod-new')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-guides.test.tsx`
Expected: FAIL — the guide texts and `guide-*` elements are not found.

- [ ] **Step 3: Write the guide card**

`apps/mobile-rn/src/features/competitions/organizer/guide.tsx`:
```tsx
import { space, useTheme } from '../../../core/theme';
import { Button, Card, Txt } from '../../../core/widgets/kit';

/** What to do first, with a button to the page where it is done (Circle21's « Create at least one Division »). */
export function Guide({ testID, message, action, onPress }: { testID: string; message: string; action: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Card testID={testID} style={{ gap: space.sm }}>
      <Txt color={colors.outline}>{message}</Txt>
      {onPress ? <Button testID={`${testID}-go`} kind="outlined" label={action} onPress={onPress} /> : null}
    </Card>
  );
}
```

- [ ] **Step 4: Use it in WODs, Heats and the leaderboard**

`organizer/wods.tsx`:
- add `import { Guide } from './guide';` after the `./api` import, and `type ManageTab` to the `./logic` import (`import { nextWodNumber, SCORE_TYPES, wodBody, wodDraft, wodValid, type ManageTab, type WodDraft } from './logic';`);
- replace `export function WodsTab({ c }: { c: Json }) {` with `export function WodsTab({ c, onGo }: { c: Json; onGo?: (tab: ManageTab) => void }) {`;
- in the list view, replace:
```tsx
    <Screen>
      {workouts.length === 0 ? (
        <Txt color={colors.outline}>{t('orgNoWods')}</Txt>
```
with:
```tsx
    <Screen>
      {(c.categories ?? []).some((k: Json) => k.active) ? null : (
        <Guide testID="guide-categories" message={t('orgNeedCategory')} action={t('orgGoCategories')} onPress={onGo && (() => onGo('categories'))} />
      )}
      {workouts.length === 0 ? (
        <Txt color={colors.outline}>{t('orgNoWods')}</Txt>
```

`organizer/planning.tsx`:
- add `import { Guide } from './guide';` after the `./export` import, and `import type { ManageTab } from './logic';` before the `./logic-b` import;
- replace `export function PlanningTab({ c }: { c: Json }) {` with `export function PlanningTab({ c, onGo }: { c: Json; onGo?: (tab: ManageTab) => void }) {`;
- replace:
```tsx
      {all.length === 0 ? (
        <EmptyState icon="event-note" message={t('orgHeatNone')} />
      ) : (
```
with:
```tsx
      {all.length === 0 ? (
        !categories.some((k) => k.active) ? (
          <Guide testID="guide-categories" message={t('orgNeedCategory')} action={t('orgGoCategories')} onPress={onGo && (() => onGo('categories'))} />
        ) : !(c.workouts ?? []).length ? (
          <Guide testID="guide-wods" message={t('orgNeedWod')} action={t('orgGoWods')} onPress={onGo && (() => onGo('wods'))} />
        ) : (
          <EmptyState icon="event-note" message={t('orgHeatNone')} />
        )
      ) : (
```

`organizer/leaderboard.tsx`:
- add `import { Guide } from './guide';` and `import type { ManageTab } from './logic';` after the `./export` import;
- replace `export function LeaderboardTab({ c }: { c: Json }) {` with `export function LeaderboardTab({ c, onGo }: { c: Json; onGo?: (tab: ManageTab) => void }) {`;
- replace:
```tsx
      {board.isError ? (
```
with:
```tsx
      {categories.length === 0 ? (
        <Guide testID="guide-categories" message={t('orgNeedCategory')} action={t('orgGoCategories')} onPress={onGo && (() => onGo('categories'))} />
      ) : !(c.workouts ?? []).length ? (
        <Guide testID="guide-wods" message={t('orgNeedWod')} action={t('orgGoWods')} onPress={onGo && (() => onGo('wods'))} />
      ) : board.isError ? (
```

`organizer/manage.tsx`: replace
```tsx
      {tab === 'wods' && <WodsTab c={c} />}
      {tab === 'planning' && <PlanningTab c={c} />}
```
with
```tsx
      {tab === 'wods' && <WodsTab c={c} onGo={setTab} />}
      {tab === 'planning' && <PlanningTab c={c} onGo={setTab} />}
```
and replace `{tab === 'leaderboard' && <LeaderboardTab c={c} />}` with `{tab === 'leaderboard' && <LeaderboardTab c={c} onGo={setTab} />}`.

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-guides.test.tsx test/screens/organizer-planning.test.tsx test/screens/organizer-leaderboard.test.tsx test/screens/organizer.test.tsx && npx tsc --noEmit`
Expected: PASS, no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/guide.tsx apps/mobile-rn/src/features/competitions/organizer/wods.tsx apps/mobile-rn/src/features/competitions/organizer/planning.tsx apps/mobile-rn/src/features/competitions/organizer/leaderboard.tsx apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/test/screens/organizer-guides.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer empty pages say what to do first and open that page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The computer layout — grouped menu, top bar, centered column

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/publication.ts`
- Create: `apps/mobile-rn/src/features/competitions/organizer/web-shell.tsx`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx` (uses `usePublication`)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/manage.tsx` (chooses the layout)
- Test: `apps/mobile-rn/test/screens/organizer-web.test.tsx`

**Interfaces:**
- Consumes: Task 1 `useWideWeb`, `ORG_MENU`, `MenuSectionKey`, `MenuMark`, `contentWidth`, `menuMarks`, keys `orgMenu*`, `orgMarkTodo`, `orgPill*`, `orgTopDates`, `orgPreview`; Task 3 `onGo` props; lot A `DashboardTab`, `missingForPublication`, `publicationState`, `organizerApi(api).requestPublication`, `statusLabelForCompetition` (`../screens`); lot B `useRegistrations`, `toCollect`.
- Produces: `usePublication(c) → { state, missing, canRequest, busy, error, request, share }`; `OrganizerWeb({ c, tab, onTab, children })`; testIDs `org-menu`, `org-menu-<tab>`, `org-mark-<tab>`, `org-top-title`, `org-top-status`, `org-top-preview`, `org-top-request`, `org-top-share`, `org-content`.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-web.test.tsx`:
```tsx
import { router } from 'expo-router';
import { act, fireEvent, waitFor } from 'expo-router/testing-library';
import { Share } from 'react-native';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

// The computer layout is chosen by useWideWeb(); the tests pick the answer.
let mockWide = true;
jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => mockWide,
}));

const open = (tab?: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const incomplete = { ...event, status: 'DRAFT', coverUrl: null, workouts: [] };

describe('organizer space on a computer', () => {
  beforeEach(() => {
    mockWide = true;
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows the grouped menu and the top bar instead of the tabs', async () => {
    const screen = await renderScreen(open(), orgBackend());
    expect(await screen.findByTestId('org-menu')).toBeTruthy();
    expect(screen.queryByTestId('org-tab-dashboard')).toBeNull();
    expect(screen.getByTestId('org-top-title')).toBeTruthy();
    expect(screen.getByText('Event details')).toBeTruthy();
    expect(screen.getByText('Heats')).toBeTruthy();
    expect(screen.getByTestId('org-menu-dashboard').props.accessibilityState?.selected).toBe(true);
  });

  it('each menu entry opens its page', async () => {
    const screen = await renderScreen(open(), orgBackend().on('GET', '/competitions/c9/heats', [200, []]));
    await fireEvent.press(await screen.findByTestId('org-menu-participants'));
    expect(await screen.findByTestId('reg-search')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-menu-planning'));
    expect(await screen.findByTestId('heat-new')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-menu-general'));
    expect(await screen.findByTestId('org-title')).toBeTruthy();
    expect(screen.getByTestId('org-menu-general').props.accessibilityState?.selected).toBe(true);
  });

  it('marks what the draft misses and the payments to collect; « Go to… » opens the right page', async () => {
    const screen = await renderScreen(open(), orgBackend(incomplete));
    expect(await screen.findByTestId('org-mark-wods')).toBeTruthy();
    expect(screen.getByTestId('org-mark-general')).toBeTruthy();
    expect(screen.queryByTestId('org-mark-categories')).toBeNull();
    // r1 and r4 wait for payment (r5 is cancelled).
    expect(await screen.findByTestId('org-mark-participants')).toBeTruthy();
    expect(screen.getByTestId('org-mark-participants').props.children).toBe('2');
    await fireEvent.press(screen.getByTestId('check-WOD'));
    expect(await screen.findByTestId('wod-new')).toBeTruthy();
    expect(screen.getByTestId('org-menu-wods').props.accessibilityState?.selected).toBe(true);
  });

  it('top bar: « Preview » opens the public page; a complete draft asks for publication once', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    const backend = orgBackend({ ...event, status: 'DRAFT' }).on('POST', '/competitions/c9/publication-request', [200, {}]);
    const screen = await renderScreen(open(), backend);
    await fireEvent.press(await screen.findByTestId('org-top-preview'));
    expect(push).toHaveBeenCalledWith('/competitions/c9');
    await act(async () => {
      fireEvent.press(screen.getByTestId('org-top-request'));
      fireEvent.press(screen.getByTestId('org-top-request'));
    });
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/publication-request')).toHaveLength(1));
  });

  it('top bar: an incomplete draft cannot ask for publication yet', async () => {
    const screen = await renderScreen(open(), orgBackend(incomplete));
    expect((await screen.findByTestId('org-top-request')).props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('top bar: a published event is shared with its app link', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const screen = await renderScreen(open(), orgBackend());
    await fireEvent.press(await screen.findByTestId('org-top-share'));
    expect(share.mock.calls[0][0].message).toMatch(/fitnessleague:\/\/competitions\/c9$/);
  });

  it('a narrow window keeps the page that was open', async () => {
    const screen = await renderScreen(open(), orgBackend().on('GET', '/competitions/c9/staff', [200, []]));
    await fireEvent.press(await screen.findByTestId('org-menu-participants'));
    expect(await screen.findByTestId('reg-search')).toBeTruthy();
    mockWide = false;
    // The next render of the organizer screen reads the window again: the team entry is still the menu's.
    await fireEvent.press(screen.getByTestId('org-menu-team'));
    expect(await screen.findByTestId('org-tab-team')).toBeTruthy();
    expect(screen.queryByTestId('org-menu')).toBeNull();
    expect(screen.getByTestId('org-tab-team').props.accessibilityState?.selected).toBe(true);
  });

  it('no menu for someone who is not an organizer', async () => {
    const screen = await renderScreen(open(), orgBackend({ ...event, myRoles: [] }));
    expect(await screen.findByText('Only the organizers of this event can open this page.')).toBeTruthy();
    expect(screen.queryByTestId('org-menu')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-web.test.tsx`
Expected: FAIL — `org-menu` is not found (the screen still shows the chips).

- [ ] **Step 3: Share the publication logic**

`apps/mobile-rn/src/features/competitions/organizer/publication.ts`:
```ts
import { useRef, useState } from 'react';
import { Share } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { formatDate } from '../../../core/utils/format';
import { toast } from '../../../core/widgets/kit';
import { organizerApi, useRefreshCompetition } from './api';
import { missingForPublication, publicationState } from './logic';

/** Asking for publication and sharing the event: used by the dashboard and by the top bar on a computer. */
export function usePublication(c: Json) {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const state = publicationState(c);
  const missing = missingForPublication(c);
  const canRequest = (state === 'DRAFT' || state === 'RETURNED') && missing.length === 0;

  async function request() {
    if (sending.current || !canRequest) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await organizerApi(api).requestPublication(c.id);
      toast(t('orgRequested'));
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  function share() {
    const text = t('orgShareText', { title: c.title, date: formatDate(c.eventStart, locale), place: c.city ?? c.location ?? '' });
    void Share.share({ message: `${text}\nfitnessleague://competitions/${c.id}` });
  }

  return { state, missing, canRequest, busy, error, request, share };
}
```
`apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx` — replace the whole file with:
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
import { CHECKLIST, TAB_FOR, type ChecklistItem, type ManageTab } from './logic';
import { usePublication } from './publication';

export function DashboardTab({ c, onGo }: { c: Json; onGo: (tab: ManageTab) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
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
      <SectionHeader title={t('orgFigures')} />
      {dash.isError ? (
        <ErrorView error={dash.error} onRetry={() => dash.refetch()} />
      ) : d ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          <Figure label={t('orgParticipants')} value={String(d.participants)} />
          <Figure label={t('orgPaid')} value={String(d.paidRegistrations)} />
          <Figure label={t('orgToCollect')} value={String(d.pendingPayments)} />
          <Figure label={t('orgRevenue')} value={formatMoney(d.revenue, c.currency, locale)} />
          <Figure label={t('orgToJudge')} value={String(d.pendingJudging)} />
          <Figure label={t('orgApproved')} value={String(d.approvedSubmissions)} />
          <Figure label={t('orgRejected')} value={String(d.rejectedSubmissions)} />
        </View>
      ) : (
        <Loading />
      )}
      <RegistrationsBreakdown c={c} />
    </Screen>
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
Before replacing, diff it against the current `dashboard.tsx`: the only intended change is the move of `sending`, `busy`, `error`, `state`, `missing`, `canRequest`, `request` and `share` into `usePublication`; keep any line the current file has that is not in this listing.

- [ ] **Step 4: Write the computer layout**

`apps/mobile-rn/src/features/competitions/organizer/web-shell.tsx`:
```tsx
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { StatusPill } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Txt } from '../../../core/widgets/kit';
import { statusLabelForCompetition } from '../screens';
import { useRegistrations } from './api';
import type { ManageTab } from './logic';
import { toCollect } from './logic-b';
import { usePublication } from './publication';
import { contentWidth, menuMarks, ORG_MENU, type MenuMark, type MenuSectionKey } from './web';

const MENU_WIDTH = 248;

/** Organizer space on a computer (analysis 2026-10-15, lot Web 1): left menu grouped like Circle21, top bar, centered content column. */
export function OrganizerWeb({ c, tab, onTab, children }: { c: Json; tab: ManageTab; onTab: (tab: ManageTab) => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.background }}>
      <OrgMenu c={c} tab={tab} onTab={onTab} />
      <View style={{ flex: 1 }}>
        <TopBar c={c} />
        <View testID="org-content" style={{ flex: 1, width: '100%', maxWidth: contentWidth(tab), alignSelf: 'center' }}>
          {children}
        </View>
      </View>
    </View>
  );
}

function OrgMenu({ c, tab, onTab }: { c: Json; tab: ManageTab; onTab: (tab: ManageTab) => void }) {
  const t = useT();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const marks = menuMarks(c, toCollect(regs.data ?? []).length);
  const label: Record<ManageTab, string> = {
    dashboard: t('orgTabDashboard'),
    general: t('orgMenuEventInfo'),
    categories: t('orgTabCategories'),
    coupons: t('orgTabCoupons'),
    team: t('orgTabTeam'),
    participants: t('orgTabParticipants'),
    wods: t('orgTabWods'),
    planning: t('orgMenuHeats'),
    leaderboard: t('orgTabLeaderboard'),
    announcements: t('orgTabAnnouncements'),
  };
  const section: Partial<Record<MenuSectionKey, string>> = { general: t('orgTabGeneral'), planning: t('orgTabPlanning') };
  return (
    <ScrollView
      testID="org-menu"
      accessibilityLabel={t('orgMenuLabel')}
      style={{ width: MENU_WIDTH, flexGrow: 0, borderRightWidth: 1, borderRightColor: colors.border }}
      contentContainerStyle={{ padding: space.md, gap: space.xs }}
    >
      {ORG_MENU.map((s) => (
        <View key={s.key} style={{ gap: 2, marginTop: s.tabs.length > 1 ? space.sm : 0 }}>
          {s.tabs.length > 1 ? (
            <Txt variant="label" color={colors.outline} style={{ paddingHorizontal: space.sm, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
              {section[s.key] ?? ''}
            </Txt>
          ) : null}
          {s.tabs.map((k) => (
            <MenuItem key={k} tab={k} label={label[k]} selected={tab === k} mark={marks[k]} indent={s.tabs.length > 1} onPress={() => onTab(k)} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function MenuItem({ tab, label, selected, mark, indent, onPress }: { tab: ManageTab; label: string; selected: boolean; mark?: MenuMark; indent: boolean; onPress: () => void }) {
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
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        minHeight: 40,
        paddingVertical: space.sm,
        paddingLeft: indent ? space.lg : space.sm,
        paddingRight: space.sm,
        borderRadius: 10,
        backgroundColor: selected ? colors.surfaceHigh : pressed ? colors.surface : 'transparent',
      })}
    >
      <Txt style={{ flex: 1, fontWeight: selected ? '700' : '400' }} color={selected ? colors.primary : colors.text}>
        {label}
      </Txt>
      {mark === 'todo' ? (
        <View testID={`org-mark-${tab}`} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error }} />
      ) : mark ? (
        <Txt testID={`org-mark-${tab}`} variant="small" color={colors.onPrimary} style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 8, overflow: 'hidden' }}>
          {String(mark)}
        </Txt>
      ) : null}
    </Pressable>
  );
}

function TopBar({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const p = usePublication(c);
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
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: space.xl, paddingVertical: space.md, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Txt testID="org-top-title" variant="headline" numberOfLines={1}>
            {c.title}
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
            <StatusPill testID="org-top-status" label={pill} color={pillColor} />
            {format ? <StatusPill label={format} color={colors.outline} /> : null}
            {from && c.registrationEnd ? (
              <Txt variant="small" color={colors.outline}>
                {t('orgTopDates', { from: formatDate(from, locale), to: formatDate(c.registrationEnd, locale) })}
              </Txt>
            ) : null}
          </View>
        </View>
        <Button testID="org-top-preview" kind="outlined" icon="visibility" label={t('orgPreview')} onPress={() => router.push(`/competitions/${c.id}`)} />
        {p.state === 'PUBLISHED' ? (
          <Button testID="org-top-share" icon="share" label={t('orgShare')} onPress={p.share} />
        ) : p.state === 'DRAFT' || p.state === 'RETURNED' ? (
          <Button testID="org-top-request" label={t('orgRequestPublication')} busy={p.busy} disabled={!p.canRequest} onPress={p.request} />
        ) : null}
      </View>
      <ErrorText error={p.error} />
    </View>
  );
}
```

- [ ] **Step 5: Choose the layout in the organizer screen**

In `apps/mobile-rn/src/features/competitions/organizer/manage.tsx`:
- add `import { useWideWeb } from './web';` and `import { OrganizerWeb } from './web-shell';` after the `./team` import;
- right after `const comp = useCompetition(id);` add `const wide = useWideWeb();` (before the early returns, so the hooks keep their order);
- change the `TABS` comment to `/** Tabs of the organizer space on a phone, in display order (the computer layout groups them, \`ORG_MENU\`). */`;
- replace everything from `  return (` (the final return) to the end of the function with:
```tsx
  const page = (
    <>
      {tab === 'dashboard' && <DashboardTab c={c} onGo={setTab} />}
      {tab === 'general' && <GeneralTab c={c} />}
      {tab === 'categories' && <CategoriesTab c={c} />}
      {tab === 'wods' && <WodsTab c={c} onGo={setTab} />}
      {tab === 'planning' && <PlanningTab c={c} onGo={setTab} />}
      {tab === 'participants' && <ParticipantsTab c={c} />}
      {tab === 'team' && <TeamTab c={c} />}
      {tab === 'leaderboard' && <LeaderboardTab c={c} onGo={setTab} />}
      {tab === 'announcements' && <AnnouncementsTab c={c} />}
      {tab === 'coupons' && <CouponsTab c={c} />}
    </>
  );

  if (wide) {
    return (
      <>
        {/* The top bar shows the event name: the header keeps the way back. */}
        <Stack.Screen options={{ title: t('orgManage') }} />
        <OrganizerWeb c={c} tab={tab} onTab={setTab}>
          {page}
        </OrganizerWeb>
      </>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: c.title }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {TABS.map((k) => (
          <Chip key={k} testID={`org-tab-${k}`} label={labels[k]} selected={tab === k} onPress={() => setTab(k)} />
        ))}
      </ScrollView>
      {page}
    </View>
  );
}
```
(The ten `tab === …` lines replace the ones the current return holds; they are the same lines with `onGo={setTab}` from Task 3.)

- [ ] **Step 6: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-web.test.tsx test/screens/organizer.test.tsx test/screens/organizer-dashboard-b.test.tsx test/screens/organizer-guides.test.tsx && npx tsc --noEmit`
Expected: PASS (lot A dashboard tests unchanged by the `usePublication` move), no type error.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/publication.ts apps/mobile-rn/src/features/competitions/organizer/web-shell.tsx apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/test/screens/organizer-web.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer space on a computer: grouped menu, top bar, centered column

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Visual check at 1440 px, docs

**Files:**
- Create (not committed): `<scratchpad>/organizer-web-shots.cjs`; output in `Desktop/organizer-web/`
- Modify: `README.md`, `handoff.md`

**Interfaces:**
- Consumes: the offline demo draft `01a10804-0000-7000-8000-00000000d001` (lots A and B demo answers) and the direct-link fix (`5a011eb`): after sign-in, `http://localhost:8081/competitions/01a10804-0000-7000-8000-00000000d001/manage` opens the organizer space.
- Produces: 20 screenshots (FR and AR × 10 menu entries) and the docs.

- [ ] **Step 1: Run every app check**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes (the 30 suites before this lot + `organizer-web` ×2, `organizer-export` ×2, `organizer-guides`), no type error.

- [ ] **Step 2: Take the screenshots**

Restart the web preview in demo mode (kill the PID listening on 8081 first, then in the background): `cd apps/mobile-rn && EXPO_PUBLIC_DEMO=true CI=1 npx expo start --web --port 8081`; wait for `curl -s -o /dev/null -w "%{http_code}" --retry 90 --retry-connrefused --retry-delay 2 http://localhost:8081` to print 200. Browser: cached `playwright-core` (`~/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`) and `chrome-headless-shell` (`~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`), with `LD_LIBRARY_PATH=<scratchpad>/libs/usr/lib/x86_64-linux-gnu` (extract `libnspr4 libnss3 libasound2t64` there with `apt-get download` + `dpkg -x` if missing).

`<scratchpad>/organizer-web-shots.cjs`:
```js
// Usage: node organizer-web-shots.cjs <playwright-core dir> <chrome-headless-shell> <output dir>
const [pwDir, chrome, out] = process.argv.slice(2);
const { chromium } = require(pwDir);
require('node:fs').mkdirSync(out, { recursive: true });

const MANAGE = 'http://localhost:8081/competitions/01a10804-0000-7000-8000-00000000d001/manage';
const PAGES = ['dashboard', 'general', 'categories', 'coupons', 'team', 'participants', 'wods', 'planning', 'leaderboard', 'announcements'];

(async () => {
  const browser = await chromium.launch({ executablePath: chrome });
  for (const lang of ['fr', 'ar']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: lang });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8081', { waitUntil: 'load', timeout: 300000 });
    await page.getByTestId('login-email').waitFor({ timeout: 300000 });
    await page.getByTestId('login-email').fill('ahmed_rx@demo.fitnessleague.test');
    await page.getByTestId('login-password').fill('demo-password-2026');
    await page.getByTestId('login-submit').click();
    await page.waitForTimeout(3000);
    await page.goto(MANAGE, { waitUntil: 'load', timeout: 300000 });
    await page.getByTestId('org-menu').waitFor({ timeout: 60000 });
    const overflow = {};
    for (const p of PAGES) {
      await page.getByTestId(`org-menu-${p}`).click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/${lang}-${p}.png` });
      overflow[p] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
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
Run: `node <scratchpad>/organizer-web-shots.cjs <playwright-core dir> <chrome-headless-shell> /mnt/c/Users/GIGABYTE/Desktop/organizer-web`
Expected: 20 PNG files, every overflow 0, `page errors: none`. Open `fr-dashboard`, `fr-general`, `fr-participants`, `fr-planning`, `ar-dashboard` and `ar-participants` with the Read tool and check: the menu on the left with its two section titles, the top bar with the status pill, the dates, « Aperçu » and « Demander la publication » (the demo draft), the form page no wider than about 720 px of fields, the participants list using the wide column, the « Exporter (CSV) » buttons, nothing cut. Fix what is wrong and re-run. Leave the preview running for the owner (it is the page he asked to open) and open the direct link in his browser (`cmd.exe /c start <MANAGE link>`).

- [ ] **Step 3: Docs**

`README.md`, in the « What exists today » table, in the row that starts with `| Organizer space (2026-10-14):`, add before ` | Lots A and B done, tested |` the sentence ` On a computer (browser window of 1024 px or more) the organizer space has its own layout: a left menu grouped like the Circle21 portal, a top bar with the status, « Aperçu », « Demander la publication » and « Partager », a centered column, an « Exporter (CSV) » button on every list (a downloaded file) and empty pages that point to what must be done first.` and change ` | Lots A and B done, tested |` to ` | Lots A and B + web lot 1 done, tested |`.

`handoff.md`:
- §2 Current state: a new « Update » bullet at the top: lot Web 1 on `feat/organizer-space` (plan `docs/superpowers/plans/2026-10-15-organizer-web-lot-1.md`, analysis `docs/superpowers/specs/2026-10-15-organizer-dashboard-circle21-analysis.md`), the checks of Step 1, the screenshots folder `Desktop/organizer-web/`, the preview left running on 8081 with the direct link, push state (not pushed).
- §3 Active files: `organizer/web.ts`, `web-shell.tsx`, `publication.ts`, `export.ts`, `guide.tsx`, the changes to `logic-b.ts`, `dashboard.tsx`, `manage.tsx`, `participants.tsx`, `planning.tsx`, `coupons.tsx`, `team.tsx`, `leaderboard.tsx`, `wods.tsx`, the i18n keys, the five new test files.
- §4 Changes made: the lot Web 1 commits.
- §6 Next steps: lots Web 2 (overview with judges and % / numbers, Finances page, participants table with detail panel and « Marquer payé » in batch, Heats / Time Table split) and Web 3 (toasts and skeletons, keyboard and contrast pass, refresh every 30 s on Time Table and leaderboard, leaderboard search, optimistic promo-code toggle), each with its own plan; the « needs backend » list of the analysis stays for later.

- [ ] **Step 4: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add README.md handoff.md
git diff --cached --stat
git commit -m "docs: organizer space on a computer (web lot 1), README and handoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
