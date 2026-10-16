# Organizer Space — Lot Web 3 (feedback, loading, live refresh, search, optimistic toggle, keyboard and contrast) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the organizer space with lot Web 3 of the analysis:
- a translated toast after every action;
- skeletons while lists load;
- the heats and the leaderboard re-read every 30 s while their page is open;
- a search on the leaderboard and a per-category export name;
- an optimistic promo-code toggle;
- on a computer, a visible keyboard focus, 24 px targets and secondary texts at 4.5:1.

It also closes the lot Web 2 review's minors that touch the same code.

**Architecture:** No new screen.
- The tabs' `run` helpers take a done message.
- `SkeletonList` replaces the spinners inside the organizer lists.
- `useHeats` and `useCompLeaderboard` accept a `refetchInterval`.
- The coupon toggle writes the React Query cache first and puts it back on error.
- A small keyboard-modality store (`core/focus.ts`) and `useFocusRing()` draw a focus ring only after a key press, only inside the computer's `ThemeScope dense`.
- Inside that scope, the light palette is darkened so every text reaches WCAG AA.

**Tech Stack:** Expo / React Native + react-native-web 0.21 (`Pressable` passes `focused` / `hovered`), React Query v5, Jest + `expo-router/testing-library` (its `renderRouter` installs jest's fake timers), `FakeBackend` (`test/fake-api.ts`), `renderScreen` (`test/harness.tsx`), fixtures `test/organizer-fixtures.ts`, `test/wide-web.ts`.

**Spec:**
- `docs/superpowers/specs/2026-10-15-organizer-dashboard-circle21-analysis.md` §3 items 4, 5, 11, 12 and §4 « Lot web 3 ».
- The owner's choices of 2026-10-16:
  - « Comportements partout » means the toasts, skeletons, 30 s refresh, leaderboard search and optimistic toggle apply on the phone too, while the keyboard focus, targets and contrast pass stay on the computer;
  - « Pousser maintenant » means lots B, Web 1 and Web 2 are on `origin/feat/organizer-space` up to `655be20`.
- Lot Web 2 review minors: `handoff.md` §6 « 0-web2 ». Earlier conventions: `docs/superpowers/plans/2026-10-16-organizer-web-lot-2.md`.

## Global Constraints

- **Branch and commits:**
  - Work on branch `feat/organizer-space`, one commit per task in the repo's style (`feat(mobile): …`, `fix(mobile): …`).
  - Stage files **by name**. Never use `git commit -a` / `git add -A`. Line-ending-only « modified » files exist (`.gitignore`, `apps/admin/tsconfig.tsbuildinfo`, `apps/mobile-rn/package-lock.json`, `infra/docker-compose.yml`, `infra/mariadb/init/01-accounts.sql`, three Rust plan / spec docs). `docs/prompts/` and `.archify/` stay untracked.
  - Check `git diff --cached --stat` before each commit.
  - End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No `git stash`.** An old, unrelated `stash@{0}` exists. To re-prove a failing test, copy the file aside, then copy it back.
- **Frontend only.** Change nothing under `apps/api`, `apps/backend`, `apps/admin`, and add no endpoint or package. Do not run `npx expo lint`; the lint is `npx tsc --noEmit`.
- **Behaviors apply everywhere; the keyboard and contrast pass applies on the computer only.**
  - Toasts, skeletons, the 30 s refresh, the leaderboard search and the optimistic toggle change the phone too (owner's choice).
  - The focus ring, the 24 px targets and the darker light palette apply only inside `ThemeScope dense`, which only the computer layout sets, so the phone keeps its look.
  - The phone comparison of Task 8 may therefore differ on Leaderboard (the new search field) and Planning (the clock, and the plural fix of « heats terminés »), nowhere else.
- **Texts:** every string goes in `src/core/i18n/{en,fr,ar}.json` with the same keys and placeholders, and Task 1 adds or changes them all. French uses « tu ». Counts use ICU plurals; Arabic also uses `=2`, `few` and `many`.
- **Tests:**
  - Put two taps inside one `await act(async () => { … })`.
  - A held request is a `FakeBackend` handler returning a promise (Task 1). Release it inside `act`.
  - `renderRouter` installs fake timers, so a spy on timers goes after the first render, and `jest.advanceTimersByTime` drives `refetchInterval`.
  - `@testing-library/react-native` 14 has no `UNSAFE_*` queries: use host props through `testID`.
  - Restore a file with `git show HEAD:<path> > <path>`.
- **After each task:** `cd apps/mobile-rn && npx jest --maxWorkers=2 && npx tsc --noEmit`, then the commit. The full suite takes about 6 min on this disk; run it in the background and wait for it.
- **Preview:** Expo `CI=1` does not watch files. Restart the demo server before any screenshot (kill the PID on 8081, then `EXPO_PUBLIC_DEMO=true CI=1 npx expo start --web --port 8081 --clear`).

## Review Focus

1. **A toggle that fails after the screen already moved** (network drop, server error). The code shows its old state again, the page says which code did not change, and a quick double click sends one request. → Task 5 tests « the toggle shows at once, and a failure puts it back and says which code » and « a double click toggles once ».
2. **The 30 s refresh must stop when the page closes,** and must not run on other pages. A forgotten interval keeps polling the API for as long as the organizer space is open. → Task 4 tests « heats are read again every 30 s on the time table, and no more once the page is left » and « … leaderboard … ».
3. **A failed action must not show a success toast:** the error text alone. → Task 2 test « a failed save shows the error, not a toast ».
4. **A search on the leaderboard that matches nobody** says so, and the export then has nothing to send. The file name carries the category, so two categories exported on the same day stay apart. → Task 5 tests « the leaderboard search ignores accents and says when nobody matches » and « the export is named after the category ».
5. **A single « Marquer payé » while a batch is running** (panel or row menu) is not offered, so one registration is never paid twice by the two flows. → Task 7 test « while a batch runs, a single « Mark paid » is not offered, and the batch waits for a single payment ».

---

### Task 1: Rules, texts, held requests, phone baseline

**Files:**
- Modify: `apps/mobile-rn/test/fake-api.ts` (a handler may return a promise: a held request)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/logic-web.ts` (`LIVE_REFRESH_MS`, `filterBoard`, `toSlug`, `boardFileName`, `setActive`)
- Modify: `apps/mobile-rn/src/core/i18n/en.json`, `fr.json`, `ar.json` (17 new keys, 4 plural fixes)
- Test: `apps/mobile-rn/test/core/organizer-web3.test.ts`

**Interfaces:**
- Consumes: lot B `fold`, `csvFileName` (`logic-b.ts`); lot Web 2 `finance` (`logic-web.ts`).
- Produces:
  - `FakeBackend.on(method, path, handler)` where `handler` may return `Promise<[number, unknown]>`.
  - `LIVE_REFRESH_MS = 30_000`.
  - `filterBoard(rows: Json[], q: string): Json[]`.
  - `toSlug(s: string): string`.
  - `boardFileName(c: Json, category: string): string`.
  - `setActive(list: Json[], id: string, active: boolean): Json[]`.
  - The keys of Step 5.

- [ ] **Step 1: Write the failing tests**

`apps/mobile-rn/test/core/organizer-web3.test.ts`:
```ts
import { boardFileName, filterBoard, finance, LIVE_REFRESH_MS, setActive, toSlug } from '../../src/features/competitions/organizer/logic-web';
import { FakeBackend } from '../fake-api';

describe('lot Web 3 rules', () => {
  const rows = [
    { rank: 1, athlete: { fullName: 'Hédi Kéfi', username: 'hedi' } },
    { rank: 2, athlete: { fullName: null, username: 'karim_m' } },
  ];

  it('the leaderboard search ignores accents and case, and looks at the username too', () => {
    expect(filterBoard(rows, 'KEFI').map((r) => r.rank)).toEqual([1]);
    expect(filterBoard(rows, 'karim').map((r) => r.rank)).toEqual([2]);
    expect(filterBoard(rows, '  ')).toBe(rows);
    expect(filterBoard(rows, 'zz')).toEqual([]);
  });

  it('file names carry the category, Arabic names fall back to the plain list name', () => {
    expect(toSlug('RX Femmes 18-35')).toBe('rx-femmes-18-35');
    expect(toSlug('Élite ')).toBe('elite');
    expect(boardFileName({ slug: 'sousse-2026' }, 'RX Men')).toBe('sousse-2026-leaderboard-rx-men.csv');
    expect(boardFileName({}, 'رجال')).toBe('event-leaderboard.csv');
  });

  it('switches one code on or off and leaves the others', () => {
    const list = [{ id: 'a', active: true }, { id: 'b', active: true }];
    expect(setActive(list, 'a', false)).toEqual([{ id: 'a', active: false }, { id: 'b', active: true }]);
    expect(list[0].active).toBe(true);
  });

  it('live pages read again every 30 s', () => {
    expect(LIVE_REFRESH_MS).toBe(30_000);
  });

  // Lot Web 2 review: the invariant on every payment × registration status the API can send (passes at once: it covers code that exists).
  it('the money adds up for every payment and registration status the API can send', () => {
    const pays = ['PENDING', 'PAID', 'FREE', 'FAILED', 'REFUNDED'];
    const statuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED'];
    const all = pays.flatMap((p, i) =>
      statuses.map((s, j) => ({
        id: `${p}-${s}`,
        paymentStatus: p,
        registrationStatus: s,
        originalPrice: 40000,
        discount: p === 'FREE' ? 40000 : 5000 * j,
        finalPrice: p === 'FREE' ? 0 : 40000 - 5000 * j,
        currency: 'TND',
        registeredAt: `2026-10-${10 + i}T0${j}:00:00.000Z`,
        user: { username: `u${i}${j}` },
      })),
    );
    const f = finance(all);
    const amounts = f.rows.reduce((sum, r) => sum + r.finalPrice, 0);
    expect(amounts).toBe(f.gross - f.discounts);
    expect(amounts).toBe(f.collected + f.toCollect + f.refunded);
    expect(f.rows.some((r) => r.paymentStatus === 'FAILED')).toBe(false);
    expect(f.rows.filter((r) => r.paymentStatus === 'PENDING').map((r) => r.registrationStatus).sort()).toEqual(['CONFIRMED', 'PENDING']);
  });
});

describe('test backend', () => {
  it('a handler can hold its answer until the test releases it', async () => {
    let release!: (answer: [number, unknown]) => void;
    const b = new FakeBackend().on('GET', '/x', () => new Promise<[number, unknown]>((r) => (release = r)));
    let done = false;
    const call = b.fetch('http://test/x', {}).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    release([200, { ok: true }]);
    await call;
    expect(done).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/core/organizer-web3.test.ts`
Expected: FAIL. `filterBoard` (and the other new rules) are not exported, and the held handler's promise is used as a `[status, body]` pair.

- [ ] **Step 3: Held requests in the test backend**

In `apps/mobile-rn/test/fake-api.ts`, replace `type Handler = (req: FakeRequest) => [number, unknown];` with:
```ts
/** A handler answers at once, or returns a promise to hold the request until the test releases it. */
type Handler = (req: FakeRequest) => [number, unknown] | Promise<[number, unknown]>;
```
and replace `const [status, body] = handler ? handler(req) : [404, { code: 'NOT_FOUND' }];` with `const [status, body] = handler ? await handler(req) : [404, { code: 'NOT_FOUND' }];`.

- [ ] **Step 4: The rules**

In `apps/mobile-rn/src/features/competitions/organizer/logic-web.ts`, add `csvFileName` to the import from `./logic-b`, and add at the end of the file:
```ts
// ───────────── Live pages, leaderboard, promo codes (lot Web 3) ─────────────

/** The time table and the leaderboard read their data again this often while they are open. */
export const LIVE_REFRESH_MS = 30_000;

/** Leaderboard rows whose athlete's name or username contains the search, accents and case aside. */
export function filterBoard(rows: Json[], q: string): Json[] {
  const s = fold(q.trim());
  return s ? rows.filter((r) => fold(`${r.athlete?.fullName ?? ''} ${r.athlete?.username ?? ''}`).includes(s)) : rows;
}

/** Lowercase ASCII words joined by dashes, for file names: « RX Femmes 18-35 » → « rx-femmes-18-35 ». */
export const toSlug = (s: string) =>
  fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** `<event>-leaderboard-<category>.csv`, so two categories exported the same day stay apart; a name without Latin letters keeps `<event>-leaderboard.csv`. */
export const boardFileName = (c: Json, category: string) => csvFileName(c, toSlug(category) ? `leaderboard-${toSlug(category)}` : 'leaderboard');

/** The promo-code list with one code switched on or off (the optimistic toggle). */
export const setActive = (list: Json[], id: string, active: boolean) => list.map((k) => (k.id === id ? { ...k, active } : k));
```

- [ ] **Step 5: Texts**

Save as `<scratchpad>/org-web3-i18n.json`:
```json
{
  "add": {
    "en": {
      "orgToastDeleted": "Deleted.",
      "orgToastOrder": "Order updated.",
      "orgToastTemplates": "Categories added.",
      "orgToastActivated": "Activated.",
      "orgToastDeactivated": "Deactivated.",
      "orgToastBanner": "Banner updated.",
      "orgToastBannerRemoved": "Banner removed.",
      "orgToastStatus": "Status updated: {status}.",
      "orgToastLaneSet": "Lane {lane} assigned.",
      "orgToastLaneFreed": "Lane {lane} freed.",
      "orgToastOrganizerAdded": "{name} is now a co-organizer.",
      "orgToastStaffRemoved": "{name} left the team.",
      "orgBoardNoMatch": "No athlete matches.",
      "orgFinNoMatch": "No payment matches.",
      "orgCouponToggleFailed": "« {code} » did not change: try again.",
      "orgKpiUnavailable": "Not available right now",
      "orgLoading": "Loading"
    },
    "fr": {
      "orgToastDeleted": "Supprimé.",
      "orgToastOrder": "Ordre mis à jour.",
      "orgToastTemplates": "Catégories ajoutées.",
      "orgToastActivated": "Activé.",
      "orgToastDeactivated": "Désactivé.",
      "orgToastBanner": "Bannière mise à jour.",
      "orgToastBannerRemoved": "Bannière retirée.",
      "orgToastStatus": "Statut mis à jour : {status}.",
      "orgToastLaneSet": "Couloir {lane} attribué.",
      "orgToastLaneFreed": "Couloir {lane} libéré.",
      "orgToastOrganizerAdded": "{name} est maintenant co-organisateur.",
      "orgToastStaffRemoved": "{name} ne fait plus partie de l'équipe.",
      "orgBoardNoMatch": "Aucun athlète ne correspond.",
      "orgFinNoMatch": "Aucun paiement ne correspond.",
      "orgCouponToggleFailed": "« {code} » n'a pas changé : réessaie.",
      "orgKpiUnavailable": "Indisponible pour l'instant",
      "orgLoading": "Chargement"
    },
    "ar": {
      "orgToastDeleted": "تم الحذف.",
      "orgToastOrder": "تم تحديث الترتيب.",
      "orgToastTemplates": "تمت إضافة الفئات.",
      "orgToastActivated": "تم التفعيل.",
      "orgToastDeactivated": "تم التعطيل.",
      "orgToastBanner": "تم تحديث اللافتة.",
      "orgToastBannerRemoved": "تمت إزالة اللافتة.",
      "orgToastStatus": "تم تحديث الحالة: {status}.",
      "orgToastLaneSet": "تم تعيين الممر {lane}.",
      "orgToastLaneFreed": "تم تحرير الممر {lane}.",
      "orgToastOrganizerAdded": "أصبح {name} منظِّمًا مشاركًا.",
      "orgToastStaffRemoved": "لم يعد {name} ضمن الفريق.",
      "orgBoardNoMatch": "لا يوجد رياضي مطابق.",
      "orgFinNoMatch": "لا توجد دفعة مطابقة.",
      "orgCouponToggleFailed": "لم يتغيّر « {code} »: أعد المحاولة.",
      "orgKpiUnavailable": "غير متوفر حاليًا",
      "orgLoading": "جارٍ التحميل"
    }
  },
  "replace": {
    "en": {
      "orgDelayDone": "{count, plural, =1{1 heat moved by {minutes} min, announcement posted.} other{{count} heats moved by {minutes} min, announcement posted.}}",
      "orgHeatsDone": "{done} of {total, plural, =1{1 heat} other{{total} heats}} done",
      "orgHeatsProgress": "{done} of {total, plural, =1{1 heat} other{{total} heats}} done · {left, plural, =0{none left} other{{left} left}}",
      "orgBatchSummary": "{paid, plural, =0{None marked paid} =1{1 marked paid} other{{paid} marked paid}} · {already, plural, =0{none already settled} =1{1 already settled} other{{already} already settled}}"
    },
    "fr": {
      "orgDelayDone": "{count, plural, =1{1 heat décalé de {minutes} min, annonce publiée.} other{{count} heats décalés de {minutes} min, annonce publiée.}}",
      "orgHeatsDone": "{done, plural, =0{Aucun heat terminé} =1{1 heat terminé} other{{done} heats terminés}} sur {total}",
      "orgHeatsProgress": "{done} sur {total, plural, =1{1 heat terminé} other{{total} heats terminés}} · {left, plural, =0{aucun restant} =1{1 restant} other{{left} restants}}",
      "orgBatchSummary": "{paid, plural, =0{Aucune payée} =1{1 payée} other{{paid} payées}} · {already, plural, =0{aucune déjà réglée} =1{1 déjà réglée} other{{already} déjà réglées}}"
    },
    "ar": {
      "orgDelayDone": "{count, plural, =1{تم تأخير دفعة واحدة {minutes} دقيقة ونُشر إعلان.} =2{تم تأخير دفعتين {minutes} دقيقة ونُشر إعلان.} few{تم تأخير {count} دفعات {minutes} دقيقة ونُشر إعلان.} many{تم تأخير {count} دفعة {minutes} دقيقة ونُشر إعلان.} other{تم تأخير {count} دفعة {minutes} دقيقة ونُشر إعلان.}}",
      "orgHeatsDone": "انتهت {done} من {total, plural, =1{دفعة واحدة} =2{دفعتين} few{{total} دفعات} many{{total} دفعة} other{{total} دفعة}}",
      "orgHeatsProgress": "انتهت {done} من {total, plural, =1{دفعة واحدة} =2{دفعتين} few{{total} دفعات} many{{total} دفعة} other{{total} دفعة}} · {left, plural, =0{لا شيء متبقٍّ} =1{واحدة متبقية} =2{اثنتان متبقيتان} few{{left} متبقية} many{{left} متبقية} other{{left} متبقية}}",
      "orgBatchSummary": "{paid, plural, =0{لم يُعلَّم أي تسجيل كمدفوع} =1{تسجيل واحد مدفوع} =2{تسجيلان مدفوعان} few{{paid} تسجيلات مدفوعة} many{{paid} تسجيلًا مدفوعًا} other{{paid} تسجيل مدفوع}} · {already, plural, =0{لا شيء مسدَّد مسبقًا} =1{واحد مسدَّد مسبقًا} =2{اثنان مسدَّدان مسبقًا} few{{already} مسدَّدة مسبقًا} many{{already} مسدَّدًا مسبقًا} other{{already} مسدَّد مسبقًا}}"
    }
  }
}
```
The leaderboard search reuses `orgHeatSearch` (« Chercher un athlète »).

Merge it (in `apps/mobile-rn`):
```bash
node -e '
const fs = require("fs");
const x = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const part of ["add", "replace"]) {
  const keys = Object.keys(x[part].en);
  for (const lang of ["fr", "ar"]) if (Object.keys(x[part][lang]).join() !== keys.join()) throw new Error(`${part} ${lang}: not the same keys as en`);
}
for (const lang of ["en", "fr", "ar"]) {
  const p = `src/core/i18n/${lang}.json`;
  const cur = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const k of Object.keys(x.add[lang])) if (k in cur) throw new Error(`${lang}: ${k} already exists`);
  for (const k of Object.keys(x.replace[lang])) if (!(k in cur)) throw new Error(`${lang}: ${k} is missing`);
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...x.replace[lang], ...x.add[lang] }, null, 2) + "\n");
}
console.log("ok", Object.keys(x.add.en).length, "added", Object.keys(x.replace.en).length, "replaced");' <scratchpad>/org-web3-i18n.json
```
Expected: `ok 17 added 4 replaced`. The English `orgBatchSummary` is unchanged (the key is replaced only for Arabic's `already` forms; replacing en / fr with the same text keeps the three files in step).

- [ ] **Step 6: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes (the lot B clock test still reads « 1 of 4 heats done »), no type error.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/test/fake-api.ts apps/mobile-rn/src/features/competitions/organizer/logic-web.ts apps/mobile-rn/src/core/i18n/en.json apps/mobile-rn/src/core/i18n/fr.json apps/mobile-rn/src/core/i18n/ar.json apps/mobile-rn/test/core/organizer-web3.test.ts
git diff --cached --stat
git commit -m "feat(mobile): organizer web lot 3 rules and texts: leaderboard search, per-category file names, optimistic toggle, toasts, plural fixes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Phone baseline**

Restart the demo server (Global Constraints), then run lot Web 2's script `<scratchpad>/organizer-web-shots.cjs` in `phone` mode into `/mnt/c/Users/GIGABYTE/Desktop/organizer-web-3/phone-before`. If the scratchpad copy is gone, take the script from lot Web 2's plan, Task 11 Step 2.
Expected: 20 PNG files, overflow 0. Nothing is committed.

---

### Task 2: A toast after every organizer action (phone and computer)

**Files:**
- Modify: `apps/mobile-rn/src/features/competitions/organizer/categories.tsx`, `wods.tsx`, `planning.tsx`, `team.tsx` (their `run` takes a done message)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/general.tsx` (banner and status get their message; `run` already takes one)
- Test: `apps/mobile-rn/test/screens/organizer-toasts.test.tsx`

**Interfaces:**
- Consumes: Task 1 keys `orgToast*`; lot A `orgSaved`; `toast` (`kit.tsx`); `statusLabelForCompetition` (`../screens`); `personName` (`logic-b.ts`).
- Produces:
  - Categories, WODs and team: `run(fn, after?, done?: string)`.
  - Planning: `run(fn, after?: (result) => void, done?: string)`.
  - The toast appears only once the request has succeeded; after an error the page keeps its error text and shows no toast.
  - These already give their own feedback, and get no extra toast:
    - publication request: `orgRequested`;
    - announcement: `orgAnnPosted`;
    - automatic heats: the notice;
    - « Retard »: the done line;
    - promo codes created: the report;
    - « Marquer payé »: the receipt;
    - batch: the summary.
  - The promo-code toggle gets its toast in Task 5.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-toasts.test.tsx`:
```tsx
import { fireEvent } from 'expo-router/testing-library';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
// No category: any confirmed registration can take lane 1 (r2).
const heat = { id: 'h1', number: 1, name: 'Heat 1', startsAt: '2026-12-12T10:00:00.000Z', durationMin: 12, laneCount: 2, workout: null, category: null, lanes: [{ lane: 2, registrationId: 'r3', athlete: { id: 'u-r3', fullName: 'Hédi Kéfi', username: 'hedi' } }] };

describe('organizer space: a toast after every action', () => {
  it('categories: deactivate one, then change the order', async () => {
    const b = orgBackend().on('PUT', '/competitions/c9/categories/k1', [200, {}]).on('PUT', '/competitions/c9/categories/k2', [200, {}]);
    const screen = await renderScreen(open('categories'), b);
    await fireEvent.press(await screen.findByTestId('cat-k1'));
    await fireEvent.press(screen.getByTestId('cat-toggle'));
    expect(await screen.findByText('Deactivated.')).toBeTruthy();
    await fireEvent.press(await screen.findByLabelText('Move up'));
    expect(await screen.findByText('Order updated.')).toBeTruthy();
  });

  it('WODs: delete one', async () => {
    const b = orgBackend().on('DELETE', '/competitions/c9/wods/w1', [200, {}]);
    const screen = await renderScreen(open('wods'), b);
    await fireEvent.press(await screen.findByTestId('wod-w1'));
    await fireEvent.press(screen.getByTestId('wod-delete'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('Deleted.')).toBeTruthy();
  });

  it('heats: free a lane, then fill one', async () => {
    const b = orgBackend().on('GET', '/competitions/c9/heats', [200, [heat]]).on('DELETE', '/competitions/c9/heats/h1/lanes/2', [200, {}]).on('POST', '/competitions/c9/heats/h1/lanes', [200, {}]);
    const screen = await renderScreen(open('planning'), b);
    await fireEvent.press(await screen.findByTestId('heat-h1'));
    await fireEvent.press(await screen.findByLabelText('Free the lane'));
    expect(await screen.findByText('Lane 2 freed.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lane-1'));
    await fireEvent.press(await screen.findByTestId('lane-cand-r2'));
    expect(await screen.findByText('Lane 1 assigned.')).toBeTruthy();
  });

  it('team: remove a co-organizer', async () => {
    const staff = [
      { id: 's1', userId: 'u-me', role: 'ORGANIZER', user: { username: 'ahmed_rx' } },
      { id: 's2', userId: 'u-2', role: 'ORGANIZER', user: { username: 'amel', profile: { fullName: 'Amel' } } },
    ];
    const b = orgBackend().on('GET', '/competitions/c9/staff', [200, staff]).on('DELETE', '/competitions/c9/staff/s2', [200, {}]);
    const screen = await renderScreen(open('team'), b);
    await fireEvent.press(await screen.findByLabelText('Remove from the organizers'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('Amel left the team.')).toBeTruthy();
  });

  it('event details: the banner removed, then the next status', async () => {
    const b = orgBackend().on('DELETE', '/competitions/c9/cover', [200, {}]).on('PATCH', '/competitions/c9/status', [200, {}]);
    const screen = await renderScreen(open('general'), b);
    await fireEvent.press(await screen.findByTestId('org-banner-remove'));
    expect(await screen.findByText('Banner removed.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-next-REGISTRATION_CLOSED'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText(/^Status updated: .+\.$/)).toBeTruthy();
  });

  it('a failed save shows the error, not a toast', async () => {
    const b = orgBackend().on('PUT', '/competitions/c9/categories/k1', [500, { code: 'INTERNAL' }]);
    const screen = await renderScreen(open('categories'), b);
    await fireEvent.press(await screen.findByTestId('cat-k1'));
    await fireEvent.press(screen.getByTestId('cat-toggle'));
    expect(await screen.findByText('Something went wrong on our side. Try again later.')).toBeTruthy();
    expect(screen.queryByText('Deactivated.')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-toasts.test.tsx`
Expected: 5 FAIL (no toast text) and « a failed save… » PASS. It guards against a regression and passes before and after.

- [ ] **Step 3: The `run` helpers take a done message**

In `categories.tsx`, `wods.tsx` and `team.tsx`, the helper reads `async function run(fn: () => Promise<unknown>, after?: () => void) {` and, in its `try`, `await fn();` then `after?.();`. Make it:
```tsx
  async function run(fn: () => Promise<unknown>, after?: () => void, done?: string) {
```
and in the `try`:
```tsx
      await fn();
      after?.();
      // Only once the request has succeeded: an error keeps its text, with no toast.
      if (done) toast(done);
```
Add `toast` to the `kit` import of each file.

In `planning.tsx`, the helper is `async function run(fn: () => Promise<unknown>, after?: (result: Json) => void) {`. Make it `async function run(fn: () => Promise<unknown>, after?: (result: Json) => void, done?: string) {`, add `if (done) toast(done);` after `after?.(result);`, and add `toast` to its `kit` import.

- [ ] **Step 4: Pass the messages**

- `categories.tsx`:
  - `save`: add `t('orgSaved')` as the third argument of its `run(…)`.
  - `toggle`: `run(() => organizerApi(api).updateCategory(c.id, d.id!, { active: !d.active }), () => setEdit(null), d.active ? t('orgToastDeactivated') : t('orgToastActivated'))`.
  - `move`: the `void run(async () => { … })` gets `, undefined, t('orgToastOrder')` after the function.
  - `cat-templates`: `run(() => organizerApi(api).addTemplates(c.id), undefined, t('orgToastTemplates'))`.
- `wods.tsx`:
  - `save`: add `t('orgSaved')` as the third argument.
  - `remove`: `run(() => organizerApi(api).removeWod(c.id, d.id!), () => setEdit(null), t('orgToastDeleted'))`.
  - `move`: `void run(() => organizerApi(api).reorderWods(c.id, order), undefined, t('orgToastOrder'));`.
- `planning.tsx`:
  - `HeatForm` `onSave`: add `t('orgSaved')` as the third argument of `run`.
  - `onDelete`: add `t('orgToastDeleted')` as the third argument.
  - `LanesView`:
    - `onAssign={(rid, lane) => run(() => org.assignLane(c.id, open.id, rid, lane), undefined, t('orgToastLaneSet', { lane }))}`
    - `onFree={(lane) => run(() => org.freeLane(c.id, open.id, lane), undefined, t('orgToastLaneFreed', { lane }))}`
- `team.tsx`:
  - the add confirmation: `if (p) void run(() => organizerApi(api).addOrganizer(c.id, p.id), () => setAdding(false), t('orgToastOrganizerAdded', { name: p.name }));`
  - the removal: `if (s) void run(() => organizerApi(api).removeStaff(c.id, s.id), undefined, t('orgToastStaffRemoved', { name: personName(s) }));`
- `general.tsx`:
  - `pickBanner`: `await run('cover', () => organizerApi(api).uploadCover(c.id, picked.file), t('orgToastBanner'));`
  - `org-banner-remove`: `run('cover', () => organizerApi(api).removeCover(c.id), t('orgToastBannerRemoved'))`.
  - The status confirmation: `void run(s, () => organizerApi(api).setStatus(c.id, s), t('orgToastStatus', { status: statusLabelForCompetition(t, s) }));`. `general.tsx` imports `statusLabelForCompetition` from `'../screens'` if it does not already (it imports `DEFAULT_COVER` from there).

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes, no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/categories.tsx apps/mobile-rn/src/features/competitions/organizer/wods.tsx apps/mobile-rn/src/features/competitions/organizer/planning.tsx apps/mobile-rn/src/features/competitions/organizer/team.tsx apps/mobile-rn/src/features/competitions/organizer/general.tsx apps/mobile-rn/test/screens/organizer-toasts.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): a translated toast after every organizer action (categories, WODs, heats and lanes, team, banner, status)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Skeletons while organizer lists load (phone and computer)

**Files:**
- Modify: `apps/mobile-rn/src/core/widgets/common.tsx` (`SkeletonList` reads `dense`, takes a `label`)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/participants.tsx`, `participants-web.tsx`, `finances.tsx`, `planning.tsx`, `schedule.tsx`, `team.tsx`, `coupons.tsx`, `leaderboard.tsx`, `announcements.tsx`, `dashboard.tsx`
- Test: `apps/mobile-rn/test/screens/organizer-skeletons.test.tsx`

**Interfaces:**
- Consumes: Task 1 held requests and key `orgLoading`.
- Produces: `SkeletonList({ count?, height?, label? })`. In the dense scope the default height is 44 and the corner radius 6; outside it, 76 and 18 as before. `label` becomes the skeleton's `accessibilityLabel` (`role="progressbar"`). Each organizer list shows `<SkeletonList label={t('orgLoading')} />` (`count={2}` for the dashboard figures) instead of `<Loading />`. `manage.tsx` keeps its spinner while the event itself loads, and the team search keeps its spinner too.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-skeletons.test.tsx`:
```tsx
import { act } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend, regs } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;

/** The registrations stay on the way until the test lets them through. */
function held() {
  let release!: () => void;
  const b = orgBackend().on('GET', '/competitions/c9/registrations', () => new Promise<[number, unknown]>((r) => (release = () => r([200, regs]))));
  return { b, release: () => release() };
}

describe('organizer lists: skeletons while they load', () => {
  it('phone: participants show a skeleton, then the list', async () => {
    setWide(false);
    const { b, release } = held();
    const screen = await renderScreen(open('participants'), b);
    expect((await screen.findByTestId('skeleton')).props.accessibilityLabel).toBe('Loading');
    expect(StyleSheet.flatten(screen.getAllByTestId('skeleton-row')[0].props.style)).toMatchObject({ height: 76, borderRadius: 18 });
    await act(async () => release());
    expect(await screen.findByTestId('reg-r1')).toBeTruthy();
    expect(screen.queryByTestId('skeleton')).toBeNull();
  });

  it('computer: finances show dense skeleton rows', async () => {
    setWide(true);
    const { b, release } = held();
    const screen = await renderScreen(open('finances'), b);
    await screen.findByTestId('skeleton');
    expect(StyleSheet.flatten(screen.getAllByTestId('skeleton-row')[0].props.style)).toMatchObject({ height: 44, borderRadius: 6 });
    await act(async () => release());
    expect(await screen.findByTestId('fin-table')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-skeletons.test.tsx`
Expected: FAIL. `skeleton` is not found (the spinner shows).

- [ ] **Step 3: The skeleton reads the scope**

In `apps/mobile-rn/src/core/widgets/common.tsx`, replace the `SkeletonList` function header and its rendered tree:
```tsx
export function SkeletonList({ count = 6, height = 76 }: { count?: number; height?: number }) {
  const { colors } = useTheme();
```
becomes:
```tsx
export function SkeletonList({ count = 6, height, label }: { count?: number; height?: number; label?: string }) {
  const { colors, dense } = useTheme();
  // On a computer: table-row sized placeholders.
  const h = height ?? (dense ? 44 : 76);
  const r = dense ? webDense.radius.field : 18;
```
and its return:
```tsx
    <View testID="skeleton" style={{ padding: 16, gap: 10 }}>
      {Array.from({ length: count }, (_, i) => (
        <Animated.View key={i} style={{ height, borderRadius: 18, backgroundColor: colors.surfaceHigh, opacity: pulse }} />
      ))}
    </View>
```
becomes:
```tsx
    <View testID="skeleton" role="progressbar" accessibilityLabel={label} style={{ padding: 16, gap: 10 }}>
      {Array.from({ length: count }, (_, i) => (
        <Animated.View key={i} testID="skeleton-row" style={{ height: h, borderRadius: r, backgroundColor: colors.surfaceHigh, opacity: pulse }} />
      ))}
    </View>
```
Check the other callers of `SkeletonList` with `grep -rn "SkeletonList" src`. They pass at most `count` and `height`, so outside the dense scope they render as before; the `testID="skeleton-row"` and `role` are invisible.

- [ ] **Step 4: Use it in the organizer lists**

In each file below, add `SkeletonList` to the `common` import, drop `Loading` from it where nothing else uses it, and replace the list's `<Loading />` with `<SkeletonList label={t('orgLoading')} />`:
- `participants.tsx`: `if (!regs.data) return <Loading />;`
- `participants-web.tsx` and `finances.tsx`: the `: <Loading />` of `if (!regs.data) return regs.isError ? … : <Loading />;`
- `planning.tsx` and `schedule.tsx`: `if (!heats.data) return <Loading />;`
- `team.tsx`: `if (!staff.data) return <Loading />;` only. The search results keep their spinner.
- `coupons.tsx`: `if (!list.data) return <Loading />;`
- `leaderboard.tsx` and `announcements.tsx`: the `<Loading />` inside the list.
- `dashboard.tsx`: the figures' `<Loading />` becomes `<SkeletonList count={2} label={t('orgLoading')} />`.

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes, no type error. If an older test waits for a spinner (`ActivityIndicator`) inside one of these lists, it now waits for the skeleton. Update that test to look for `skeleton` and say so in the commit message.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/core/widgets/common.tsx apps/mobile-rn/src/features/competitions/organizer/participants.tsx apps/mobile-rn/src/features/competitions/organizer/participants-web.tsx apps/mobile-rn/src/features/competitions/organizer/finances.tsx apps/mobile-rn/src/features/competitions/organizer/planning.tsx apps/mobile-rn/src/features/competitions/organizer/schedule.tsx apps/mobile-rn/src/features/competitions/organizer/team.tsx apps/mobile-rn/src/features/competitions/organizer/coupons.tsx apps/mobile-rn/src/features/competitions/organizer/leaderboard.tsx apps/mobile-rn/src/features/competitions/organizer/announcements.tsx apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx apps/mobile-rn/test/screens/organizer-skeletons.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer lists show skeletons while they load (table-row sized on a computer)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The heats and the leaderboard read again every 30 s while their page is open

**Files:**
- Modify: `apps/mobile-rn/src/features/competitions/api.ts` (`useHeats` and `useCompLeaderboard` take a `refetchInterval`)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/schedule.tsx`, `planning.tsx`, `leaderboard.tsx`
- Test: `apps/mobile-rn/test/screens/organizer-live.test.tsx`

**Interfaces:**
- Consumes: Task 1 `LIVE_REFRESH_MS`.
- Produces: `useHeats(id: string, refetchInterval?: number)`, `useCompLeaderboard(id, categoryId?, workoutId?, refetchInterval?: number)`. Other callers keep today's behaviour (no interval).
- Where it polls:
  - Horaire du jour (computer).
  - Planning, which holds the phone's clock and, on a computer, the heats list.
  - Classement.
- React Query stops the interval when the page unmounts, and pauses it while the browser tab is hidden (`refetchIntervalInBackground` stays `false`).

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-live.test.tsx`:
```tsx
import { act, fireEvent, waitFor } from 'expo-router/testing-library';

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
const heats = [{ id: 'h1', number: 1, name: 'Heat 1', startsAt: '2026-12-12T10:00:00.000Z', durationMin: 12, laneCount: 4, workout: null, category: null, lanes: [] }];
const board = { status: 'REGISTRATION_OPEN', provisional: true, rows: [{ rank: 1, athlete: { id: 'u-r3', fullName: 'Hédi Kéfi', username: 'hedi' }, totalPoints: 180, pending: 0 }] };
// renderRouter installs jest's fake timers: React Query's interval moves with jest.advanceTimersByTime.
const wait = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

describe('live pages: read again every 30 s', () => {
  it('heats are read again every 30 s on the time table, and no more once the page is left', async () => {
    setWide(true);
    const b = orgBackend().on('GET', '/competitions/c9/heats', [200, heats]);
    const screen = await renderScreen(open('timetable'), b);
    await screen.findByTestId('sched-clock');
    const calls = () => b.calls('GET', '/competitions/c9/heats').length;
    const first = calls();
    await wait(30_000);
    await waitFor(() => expect(calls()).toBe(first + 1));
    await fireEvent.press(screen.getByTestId('org-menu-wods'));
    const left = calls();
    await wait(90_000);
    expect(calls()).toBe(left);
  });

  it('phone: Planning, where the clock is, reads the heats again too', async () => {
    setWide(false);
    const b = orgBackend().on('GET', '/competitions/c9/heats', [200, heats]);
    const screen = await renderScreen(open('planning'), b);
    await screen.findByTestId('heat-h1');
    const first = b.calls('GET', '/competitions/c9/heats').length;
    await wait(30_000);
    await waitFor(() => expect(b.calls('GET', '/competitions/c9/heats').length).toBe(first + 1));
  });

  it('the leaderboard is read again every 30 s, and no more once the page is left', async () => {
    setWide(false);
    const b = orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board]);
    const screen = await renderScreen(open('leaderboard'), b);
    await screen.findByText('Hédi Kéfi');
    const calls = () => b.calls('GET', '/competitions/c9/leaderboard').length;
    const first = calls();
    await wait(30_000);
    await waitFor(() => expect(calls()).toBe(first + 1));
    await fireEvent.press(screen.getByTestId('org-tab-team'));
    const left = calls();
    await wait(90_000);
    expect(calls()).toBe(left);
  });
});
```
`org-tab-team` needs a `staff` route; the 404 it gets without one is harmless here (the team page shows its error, the test only counts leaderboard calls).

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-live.test.tsx`
Expected: FAIL. No second call arrives after 30 s.

- [ ] **Step 3: The hooks take an interval**

In `apps/mobile-rn/src/features/competitions/api.ts`, replace:
```ts
export function useCompLeaderboard(id: string, categoryId?: string, workoutId?: string) {
  const api = useApi();
  return useQuery({ queryKey: compKeys.board(id, categoryId, workoutId), queryFn: () => competitionsApi(api).leaderboard(id, categoryId, workoutId) });
}
```
with:
```ts
/** `refetchInterval`: read again this often while the screen is shown (the organizer's live pages). */
export function useCompLeaderboard(id: string, categoryId?: string, workoutId?: string, refetchInterval?: number) {
  const api = useApi();
  return useQuery({ queryKey: compKeys.board(id, categoryId, workoutId), queryFn: () => competitionsApi(api).leaderboard(id, categoryId, workoutId), refetchInterval });
}
```
and:
```ts
export function useHeats(id: string) {
  const api = useApi();
  return useQuery({ queryKey: compKeys.heats(id), queryFn: () => competitionsApi(api).heats(id) });
}
```
with:
```ts
export function useHeats(id: string, refetchInterval?: number) {
  const api = useApi();
  return useQuery({ queryKey: compKeys.heats(id), queryFn: () => competitionsApi(api).heats(id), refetchInterval });
}
```

- [ ] **Step 4: The live pages ask for it**

- `schedule.tsx` and `planning.tsx`: `const heats = useHeats(c.id);` becomes `const heats = useHeats(c.id, LIVE_REFRESH_MS);`, with `LIVE_REFRESH_MS` imported from `./logic-web` (`schedule.tsx` already imports from it).
- `leaderboard.tsx`: `const board = useCompLeaderboard(c.id, categoryId);` becomes `const board = useCompLeaderboard(c.id, categoryId, undefined, LIVE_REFRESH_MS);`, and add `import { LIVE_REFRESH_MS } from './logic-web';`.
- Above each call, one comment line: `// Read again every 30 s while this page is open (analysis §3 item 11).`

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes, no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/api.ts apps/mobile-rn/src/features/competitions/organizer/schedule.tsx apps/mobile-rn/src/features/competitions/organizer/planning.tsx apps/mobile-rn/src/features/competitions/organizer/leaderboard.tsx apps/mobile-rn/test/screens/organizer-live.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): the time table, Planning and the leaderboard read their data again every 30 s while open

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Leaderboard search and per-category export, optimistic promo-code toggle

**Files:**
- Modify: `apps/mobile-rn/src/features/competitions/organizer/leaderboard.tsx` (rewritten)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/coupons.tsx` (optimistic toggle)
- Modify: `apps/mobile-rn/test/screens/organizer-export.test.tsx` (the leaderboard file name now carries the category)
- Test: `apps/mobile-rn/test/screens/organizer-board-coupons.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1 `filterBoard`, `boardFileName`, `setActive`, keys `orgBoardNoMatch`, `orgCouponToggleFailed`, `orgToastActivated` / `orgToastDeactivated`.
  - Task 3 `SkeletonList`; Task 4 `LIVE_REFRESH_MS`.
  - Lot Web 2 `SearchField`, `ExportButton`, `OrgPageHeader`; lot B `orgKeys.coupons`.
- Produces:
  - Leaderboard: testID `board-search` (filled search in the header on a computer, `TextField` above the list on a phone). The list and the export follow the search. The export file is `boardFileName(c, category)`.
  - Promo codes:
    - `coupon-toggle-<id>` switches at once through `setQueryData`.
    - An error puts the list back and shows `coupon-toggle-failed` with the error under it.
    - A second click on the same code while its request runs does nothing.
    - Success shows the toast.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-board-coupons.test.tsx`:
```tsx
import { act, fireEvent, waitFor, within } from 'expo-router/testing-library';
import { Share } from 'react-native';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const board = {
  status: 'REGISTRATION_OPEN',
  provisional: true,
  rows: [
    { rank: 1, athlete: { id: 'u-r3', fullName: 'Hédi Kéfi', username: 'hedi' }, totalPoints: 180, pending: 0 },
    { rank: 2, athlete: { id: 'u-r6', fullName: 'Karim Mansour', username: 'karim' }, totalPoints: 150, pending: 1 },
  ],
};
const coupons = [{ id: 'p1', code: 'EARLY', type: 'PERCENTAGE', value: 20, categoryId: null, maxUses: 50, usedCount: 12, expiresAt: null, active: true }];

describe('leaderboard: search and export', () => {
  afterEach(() => jest.restoreAllMocks());

  it('the leaderboard search ignores accents and says when nobody matches', async () => {
    const screen = await renderScreen(open('leaderboard'), orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board]));
    await fireEvent.changeText(await screen.findByTestId('board-search'), 'KEFI');
    expect(screen.getByTestId('board-u-r3')).toBeTruthy();
    expect(screen.queryByTestId('board-u-r6')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('board-search'), 'zz');
    expect(screen.getByText('No athlete matches.')).toBeTruthy();
    expect(screen.getByTestId('board-export').props.accessibilityState?.disabled).toBe(true);
  });

  it('the export is named after the category', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const screen = await renderScreen(open('leaderboard'), orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board]));
    await fireEvent.press(await screen.findByTestId('board-cat-k2'));
    await waitFor(() => expect(screen.getByTestId('board-cat-k2').props.accessibilityState?.selected).toBe(true));
    await fireEvent.press(await screen.findByTestId('board-export'));
    expect(share.mock.calls[0][0].title).toBe('event-leaderboard-rx-women.csv');
  });
});

describe('promo codes: optimistic toggle', () => {
  it('the toggle shows at once, and a failure puts it back and says which code', async () => {
    let answer!: (a: [number, unknown]) => void;
    const b = orgBackend()
      .on('GET', '/competitions/c9/coupons', [200, coupons])
      .on('POST', '/competitions/c9/coupons/p1/deactivate', () => new Promise<[number, unknown]>((r) => (answer = r)));
    const screen = await renderScreen(open('coupons'), b);
    await fireEvent.press(await screen.findByTestId('coupon-toggle-p1'));
    // Before the server answers: already « Activate ».
    expect(within(screen.getByTestId('coupon-toggle-p1')).getByText('Activate')).toBeTruthy();
    await act(async () => answer([500, { code: 'INTERNAL' }]));
    expect(await screen.findByText('« EARLY » did not change: try again.')).toBeTruthy();
    expect(within(screen.getByTestId('coupon-toggle-p1')).getByText('Deactivate')).toBeTruthy();
  });

  it('a success says so; a double click toggles once', async () => {
    const b = orgBackend().on('GET', '/competitions/c9/coupons', [200, coupons]).on('POST', '/competitions/c9/coupons/p1/deactivate', [200, {}]);
    const screen = await renderScreen(open('coupons'), b);
    await screen.findByTestId('coupon-toggle-p1');
    await act(async () => {
      fireEvent.press(screen.getByTestId('coupon-toggle-p1'));
      fireEvent.press(screen.getByTestId('coupon-toggle-p1'));
    });
    expect(await screen.findByText('Deactivated.')).toBeTruthy();
    expect(b.calls('POST', '/competitions/c9/coupons/p1/deactivate')).toHaveLength(1);
  });
});
```
In `apps/mobile-rn/test/screens/organizer-export.test.tsx`, in « leaderboard of the category shown », replace `title: 'event-leaderboard.csv'` with `title: 'event-leaderboard-rx-men.csv'`.

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-board-coupons.test.tsx test/screens/organizer-export.test.tsx`
Expected: FAIL. `board-search` is not found, the file name has no category, and the toggle waits for the server.

- [ ] **Step 3: The leaderboard**

Replace the whole content of `apps/mobile-rn/src/features/competitions/organizer/leaderboard.tsx` with (it keeps Task 3's skeleton and Task 4's interval):
```tsx
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { EmptyState, RankRow, SkeletonList, StatusPill } from '../../../core/widgets/common';
import { ErrorView } from '../../../core/widgets/error';
import { Card, Chip, ListGroup, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { SearchField } from '../../../core/widgets/web';
import { useCompLeaderboard } from '../api';
import { exportCsv } from './export';
import { Guide } from './guide';
import type { ManageTab } from './logic';
import { csvSeparator, leaderboardCsv } from './logic-b';
import { boardFileName, filterBoard, LIVE_REFRESH_MS } from './logic-web';
import { ExportButton, OrgPageHeader } from './page';
import { useWideWeb } from './web';

/** « Classement » (spec §1.3 item 8, lot Web 3 item 12): the ranking per category, searched by name, exported per category. Read only: the head judge publishes the final leaderboard (admin panel). */
export function LeaderboardTab({ c, onGo }: { c: Json; onGo?: (tab: ManageTab) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const categories: Json[] = (c.categories ?? []).filter((k: Json) => k.active !== false);
  const [categoryId, setCategoryId] = useState<string | undefined>(categories[0]?.id);
  const [q, setQ] = useState('');
  // Read again every 30 s while this page is open (analysis §3 item 11).
  const board = useCompLeaderboard(c.id, categoryId, undefined, LIVE_REFRESH_MS);
  const wide = useWideWeb();
  const category = categories.find((k) => k.id === categoryId)?.name ?? '';
  const all: Json[] = board.data?.rows ?? [];
  const rows = filterBoard(all, q);
  const exportBtn = <ExportButton testID="board-export" disabled={rows.length === 0} onPress={() => exportCsv(boardFileName(c, category), leaderboardCsv(rows, category, csvSeparator(locale)))} />;
  const search = wide ? (
    <SearchField testID="board-search" placeholder={t('orgHeatSearch')} value={q} onChangeText={setQ} />
  ) : (
    <TextField testID="board-search" icon="search" placeholder={t('orgHeatSearch')} value={q} onChangeText={setQ} autoCapitalize="none" />
  );
  return (
    <>
      <OrgPageHeader
        tab="leaderboard"
        actions={
          board.data ? (
            <>
              {all.length ? search : null}
              {exportBtn}
            </>
          ) : undefined
        }
      />
      <Screen>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {categories.map((k) => (
            <Chip key={k.id} testID={`board-cat-${k.id}`} label={k.name} selected={categoryId === k.id} onPress={() => setCategoryId(k.id)} />
          ))}
        </View>
        {categories.length === 0 ? (
          <Guide testID="guide-categories" message={t('orgNeedCategory')} action={t('orgGoCategories')} onPress={onGo && (() => onGo('categories'))} />
        ) : !(c.workouts ?? []).length ? (
          <Guide testID="guide-wods" message={t('orgNeedWod')} action={t('orgGoWods')} onPress={onGo && (() => onGo('wods'))} />
        ) : board.isError ? (
          <ErrorView error={board.error} onRetry={() => board.refetch()} />
        ) : !board.data ? (
          <SkeletonList label={t('orgLoading')} />
        ) : (
          <>
            <StatusPill testID="board-status" label={board.data.provisional ? t('orgBoardProvisional') : t('orgBoardFinal')} color={board.data.provisional ? colors.outline : colors.primary} />
            {wide ? null : exportBtn}
            {all.length === 0 ? (
              <EmptyState icon="leaderboard" message={t('orgBoardEmpty')} />
            ) : (
              <>
                {wide ? null : search}
                {rows.length === 0 ? (
                  <Txt color={colors.outline}>{t('orgBoardNoMatch')}</Txt>
                ) : (
                  <ListGroup>
                    {rows.map((r: Json) => (
                      <RankRow key={r.athlete.id} testID={`board-${r.athlete.id}`} rank={r.rank} name={r.athlete.fullName || r.athlete.username || '—'} value={t('orgBoardPoints', { points: r.totalPoints })} subtitle={r.pending ? t('orgBoardPending', { count: r.pending }) : undefined} />
                    ))}
                  </ListGroup>
                )}
              </>
            )}
          </>
        )}
        <Card style={{ gap: space.sm }}>
          <Txt variant="title">{t('orgBoardPublishTitle')}</Txt>
          <Txt color={colors.outline}>{t('orgBoardPublishHint')}</Txt>
        </Card>
      </Screen>
    </>
  );
}
```

- [ ] **Step 4: The optimistic toggle**

In `apps/mobile-rn/src/features/competitions/organizer/coupons.tsx`:
- Imports:
  - add `import { useQueryClient } from '@tanstack/react-query';`;
  - add `orgKeys` to the `./api` import, `toast` to the `kit` import and `ErrorText` to the `error` import if it is missing;
  - add `import { setActive } from './logic-web';`.
- With the hooks at the top of `CouponsTab`, add:
```tsx
  const qc = useQueryClient();
  const toggling = useRef(new Set<string>());
  const [toggleFailed, setToggleFailed] = useState<{ code: string; error: unknown } | null>(null);
```
- Replace:
```tsx
  const toggle = (k: Json) =>
    guarded(async () => {
      await organizerApi(api).setCouponActive(c.id, k.id, !k.active);
    });
```
with:
```tsx
  /** Optimistic (analysis §3 item 12): the row shows its new state at once; a failure puts it back and names the code. */
  async function toggle(k: Json) {
    if (toggling.current.has(k.id)) return;
    toggling.current.add(k.id);
    setToggleFailed(null);
    const key = orgKeys.coupons(c.id);
    // A reload already on its way would overwrite the new state when it lands.
    await qc.cancelQueries({ queryKey: key });
    const before = qc.getQueryData<Json[]>(key);
    qc.setQueryData<Json[]>(key, (list) => (list ? setActive(list, k.id, !k.active) : list));
    try {
      await organizerApi(api).setCouponActive(c.id, k.id, !k.active);
      toast(k.active ? t('orgToastDeactivated') : t('orgToastActivated'));
    } catch (e) {
      qc.setQueryData(key, before);
      setToggleFailed({ code: k.code, error: e });
    } finally {
      toggling.current.delete(k.id);
      void refresh();
    }
  }
```
- Under `<SectionHeader title={t('orgCouponAll')} />`, add:
```tsx
        {toggleFailed ? (
          <View style={{ gap: space.xs }}>
            <Txt testID="coupon-toggle-failed" color={colors.error}>
              {t('orgCouponToggleFailed', { code: toggleFailed.code })}
            </Txt>
            <ErrorText error={toggleFailed.error} />
          </View>
        ) : null}
```
- In the row's trailing button, drop `busy={busy}`: `<Button testID={`coupon-toggle-${k.id}`} kind="text" label={k.active ? t('orgDeactivate') : t('orgActivate')} onPress={() => toggle(k)} />`. The shared `busy` stays for « Créer ».

- [ ] **Step 5: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes (lot B's « deactivates a code » included), no type error.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/leaderboard.tsx apps/mobile-rn/src/features/competitions/organizer/coupons.tsx apps/mobile-rn/test/screens/organizer-export.test.tsx apps/mobile-rn/test/screens/organizer-board-coupons.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): leaderboard search and per-category export name; promo-code toggle switches at once and rolls back on error

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Keyboard focus, 24 px targets and 4.5:1 contrast on a computer

**Files:**
- Create: `apps/mobile-rn/src/core/focus.ts` (keyboard-or-pointer store, `useFocusRing`, `isFocused`)
- Modify: `apps/mobile-rn/src/core/theme/index.ts` (`denseLight`: the light palette on a computer)
- Modify: `apps/mobile-rn/src/core/widgets/kit.tsx` (`Button`, `IconButton`, `Chip`, `ListRow`, `LinkButton`, `Checkbox`, `Menu` trigger: the ring; `TextField`: accent border while focused on a computer; `LinkButton`: 24 px tall on a computer)
- Modify: `apps/mobile-rn/src/core/widgets/pickers.tsx` (`FieldButton`: the ring)
- Modify: `apps/mobile-rn/src/core/widgets/web.tsx` (`SquareButton`: the ring; `SearchField`: accent border while focused; `SegmentedInline`: radio group, 24 px options, the ring)
- Modify: `apps/mobile-rn/src/core/widgets/table.tsx` (row and checkbox: the ring; checkbox 24 px tall)
- Modify: `apps/mobile-rn/src/core/widgets/panel.tsx` (`role="dialog"` named after its title)
- Modify: `apps/mobile-rn/src/core/widgets/chart.tsx` (`BarChart`: one accessible image with its values)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/web-shell.tsx` (menu entries: the ring)
- Modify: `apps/mobile-rn/test/core/web-widgets.test.tsx`, `apps/mobile-rn/test/screens/organizer-overview.test.tsx` (the inline switch is now a radio group: `checked`, not `selected`)
- Test: `apps/mobile-rn/test/core/focus-contrast.test.tsx`

**Interfaces:**
- Consumes: lot Web 2 `ThemeScope`, `webDense`, `palettes`.
- Produces:
  - `core/focus.ts`: `setKeyboardModality(on: boolean)`, `useKeyboardModality(): boolean`, `useFocusRing(): (focused?: boolean) => ViewStyle | null`, `isFocused(pressableState): boolean`.
  - `core/theme`: `denseLight(accent: string): Colors` = `palettes.light` with `primary: darken(accent, 0.55)` (`#596e16` for the default accent), `onPrimary: '#FFFFFF'`, `outline: '#62666F'`. `useTheme()` returns it for a light theme inside `ThemeScope dense`.
  - The ring is `{ outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.primary, outlineOffset: 2 }`, only when `dense`, after a key press, on the focused control. On a phone `useFocusRing()` always returns `null`.
  - Tab order is the DOM order: top bar, then menu, then page. No change is needed; Task 8 checks it in a real browser.

- [ ] **Step 1: Write the failing tests**

`apps/mobile-rn/test/core/focus-contrast.test.tsx`:
```tsx
import { act } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { isFocused, setKeyboardModality, useFocusRing } from '../../src/core/focus';
import { denseLight, palettes, ThemeScope, useTheme } from '../../src/core/theme';
import { BarChart } from '../../src/core/widgets/chart';
import { LinkButton, Txt } from '../../src/core/widgets/kit';
import { SidePanel } from '../../src/core/widgets/panel';
import { DataTable } from '../../src/core/widgets/table';
import { SegmentedInline } from '../../src/core/widgets/web';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [16, 8, 0].map((s) => channel(((n >> s) & 255) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two #RRGGBB colours. */
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const ACCENT = '#C6F432';

describe('contrast on a computer (WCAG AA, 4.5:1)', () => {
  for (const [name, p] of [
    ['dark', palettes.dark(ACCENT)],
    ['light on a computer', denseLight(ACCENT)],
  ] as const) {
    it(`${name}: every text on every surface`, () => {
      for (const bg of [p.background, p.surface, p.surfaceHigh]) {
        expect(ratio(p.text, bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(p.outline, bg)).toBeGreaterThanOrEqual(4.5);
      }
      for (const bg of [p.background, p.surface]) {
        expect(ratio(p.primary, bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(p.error, bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('the computer’s light palette is the one the light side panel uses; the phone keeps its own', async () => {
    function Probe() {
      const { colors } = useTheme();
      return <Txt testID="primary">{colors.primary}</Txt>;
    }
    const screen = await renderScreen(
      () => (
        <>
          <ThemeScope scheme="light">
            <Probe />
          </ThemeScope>
          <ThemeScope dense scheme="light">
            <Probe />
          </ThemeScope>
        </>
      ),
      new FakeBackend(),
    );
    const [phone, computer] = screen.getAllByTestId('primary').map((n) => n.props.children);
    expect(phone).toBe(palettes.light(ACCENT).primary);
    expect(computer).toBe('#596e16');
  });
});

describe('keyboard focus on a computer', () => {
  afterEach(() => setKeyboardModality(false));

  it('the ring shows only on a computer, only after a key press, only on the focused control', async () => {
    function Probe({ focused }: { focused: boolean }) {
      const ring = useFocusRing();
      return <Txt testID="ring">{JSON.stringify(ring(focused))}</Txt>;
    }
    setKeyboardModality(true);
    const screen = await renderScreen(
      () => (
        <>
          <Probe focused />
          <ThemeScope dense>
            <Probe focused />
            <Probe focused={false} />
          </ThemeScope>
        </>
      ),
      new FakeBackend(),
    );
    const read = () => screen.getAllByTestId('ring').map((n) => n.props.children);
    expect(read()[0]).toBe('null');
    expect(JSON.parse(read()[1])).toMatchObject({ outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2 });
    expect(read()[2]).toBe('null');
    await act(async () => setKeyboardModality(false));
    expect(read()[1]).toBe('null');
    expect(isFocused({ focused: true })).toBe(true);
    expect(isFocused({ pressed: true })).toBe(false);
  });

  it('targets are at least 24 px tall on a computer', async () => {
    const screen = await renderScreen(
      () => (
        <ThemeScope dense>
          <LinkButton testID="link" label="See all" onPress={() => {}} />
          <SegmentedInline testID="as" label="Show as:" value="a" options={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} onChange={() => {}} />
          <DataTable testID="t" rows={[{ id: 'x' }]} keyOf={(r) => r.id} nameOf={() => 'X'} columns={[{ key: 'n', label: 'N', render: () => 'x' }]} selection={{ selected: new Set(), onToggle: () => {}, onToggleAll: () => {}, label: (n) => n, allLabel: 'All' }} />
        </ThemeScope>
      ),
      new FakeBackend(),
    );
    expect(flat(screen.getByTestId('link'))).toMatchObject({ minHeight: 24 });
    expect(flat(screen.getByTestId('as-b'))).toMatchObject({ minHeight: 24 });
    expect(flat(screen.getByTestId('t-check-x'))).toMatchObject({ height: 24 });
  });
});

describe('names for screen readers', () => {
  it('the inline switch is a radio group; the panel is a dialog named after its title; the chart reads its values', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <SegmentedInline testID="as" label="Show as:" value="a" options={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} onChange={() => {}} />
          <BarChart label="Registrations per day" data={[{ key: 'd1', label: '19 Oct', value: 1 }, { key: 'd2', label: '20 Oct', value: 3 }]} />
          <SidePanel visible title="Sami Ben Ali" closeLabel="Close" onClose={() => {}}>
            <Txt>body</Txt>
          </SidePanel>
        </>
      ),
      new FakeBackend(),
    );
    expect(screen.getByTestId('as').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByTestId('as-a').props.accessibilityRole).toBe('radio');
    expect(screen.getByTestId('as-a').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText('Registrations per day: 19 Oct 1, 20 Oct 3')).toBeTruthy();
    expect(screen.getByTestId('side-panel').props.role).toBe('dialog');
    expect(screen.getByTestId('side-panel').props.accessibilityLabel).toBe('Sami Ben Ali');
  });
});
```
In `apps/mobile-rn/test/core/web-widgets.test.tsx` (« inline switch… ») and `apps/mobile-rn/test/screens/organizer-overview.test.tsx` (« gender in percentages… »), replace the `accessibilityState` expectations `{ selected: true }` / `{ selected: false }` with `{ checked: true }` / `{ checked: false }`.

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/core/focus-contrast.test.tsx`
Expected: FAIL with `Cannot find module '../../src/core/focus'`.

- [ ] **Step 3: The keyboard store and the ring**

`apps/mobile-rn/src/core/focus.ts`:
```ts
import { useSyncExternalStore } from 'react';
import { Platform, type ViewStyle } from 'react-native';

import { useTheme } from './theme';

/**
 * Keyboard or pointer (lot Web 3): the focus ring shows after a key press and goes away with a click, as CSS
 * `:focus-visible` does (react-native-web cannot say it). Only the computer layout draws it (`ThemeScope dense`).
 */
let keyboard = false;
const listeners = new Set<() => void>();

export function setKeyboardModality(on: boolean) {
  if (keyboard === on) return;
  keyboard = on;
  listeners.forEach((l) => l());
}

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (e) => {
      if (!e.metaKey && !e.ctrlKey && !e.altKey) setKeyboardModality(true);
    },
    true,
  );
  document.addEventListener('pointerdown', () => setKeyboardModality(false), true);
}

export function useKeyboardModality(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => keyboard,
    () => false,
  );
}

/** The ring of a focused control, or null: only on a computer, only after a key press. */
export function useFocusRing() {
  const { colors, dense } = useTheme();
  const keyboardOn = useKeyboardModality();
  return (focused?: boolean): ViewStyle | null => (dense && keyboardOn && focused ? { outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.primary, outlineOffset: 2 } : null);
}

/** `focused` from a Pressable's state: react-native-web passes it, the phones do not. */
export const isFocused = (state: unknown) => !!(state as { focused?: boolean }).focused;
```

- [ ] **Step 4: The light palette on a computer**

In `apps/mobile-rn/src/core/theme/index.ts`, after `export const palettes = { … };`, add:
```ts
/**
 * The light palette on a computer (lot Web 3): a darker accent with white on it, and darker secondary text, so every
 * text reaches 4.5:1 (WCAG AA) on each light surface — the light side panel included. Phones keep `palettes.light`.
 */
export const denseLight = (accent: string): Colors => ({ ...palettes.light(accent), primary: darken(accent, 0.55), onPrimary: '#FFFFFF', outline: '#62666F' });
```
and in `useTheme`, replace `colors: dark ? palettes.dark(config.accent) : palettes.light(config.accent)` with `colors: dark ? palettes.dark(config.accent) : scope.dense ? denseLight(config.accent) : palettes.light(config.accent)`.

- [ ] **Step 5: The ring in the widgets**

In each widget below, add `import { isFocused, useFocusRing } from '../focus';` (`'../../../core/focus'` in `web-shell.tsx`), call `const ring = useFocusRing();` with the other hooks, and turn the `Pressable`'s `style` into a function of its state that ends with `ring(isFocused(state))`:

- `kit.tsx` `Button`:
  - `style={({ pressed }) => [` becomes `style={(state) => [`;
  - in the array, `pressed` becomes `state.pressed`;
  - add `ring(isFocused(state)),` just before `style,`.
- `kit.tsx` `IconButton`: `style={{ padding: 8 }}` becomes `style={(state) => [{ padding: 8 }, ring(isFocused(state))]}`. `IconButton` needs `useFocusRing`, so it calls the hook (it has no `useTheme` today).
- `kit.tsx` `Chip`: `style={[styles.chip, …]}` becomes `style={(state) => [styles.chip, …, ring(isFocused(state))]}`.
- `kit.tsx` `ListRow`: `style={({ pressed }) => [styles.row, dense && { minHeight: 40, paddingVertical: 6 }, pressed && { opacity: 0.7 }]}` becomes `style={(state) => [styles.row, dense && { minHeight: 40, paddingVertical: 6 }, state.pressed && { opacity: 0.7 }, ring(isFocused(state))]}`.
- `kit.tsx` `LinkButton`:
  - add `const { colors, dense } = useTheme();` (replacing `const { colors } = useTheme();`);
  - its style becomes `style={(state) => [{ opacity: state.pressed ? 0.6 : 1 }, dense && { minHeight: 24, justifyContent: 'center' }, ring(isFocused(state))]}`.
- `kit.tsx` `Checkbox`: its style becomes `style={(state) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }, ring(isFocused(state))]}`.
- `kit.tsx` `Menu` trigger: `style={{ padding: 8 }}` becomes `style={(state) => [{ padding: 8 }, ring(isFocused(state))]}`.
- `pickers.tsx` `FieldButton`: the `style={[ … ]}` array becomes `style={(state) => [ …, ring(isFocused(state))]}`.
- `web.tsx`:
  - `SquareButton`: its style function `({ pressed }) => ({ … })` becomes `(state) => [{ …same object with state.pressed… }, ring(isFocused(state))]`.
  - `SegmentedInline`:
    - the outer `View` gets `accessibilityRole="radiogroup"`;
    - each option `Pressable` gets `accessibilityRole="radio"`, `accessibilityState={{ checked: on }}` (instead of `accessibilityRole="button"` and `accessibilityState={{ selected: on }}`) and `style={(state) => [{ minHeight: 24, justifyContent: 'center' }, ring(isFocused(state))]}`.
- `table.tsx`:
  - the row's style function adds `ring(isFocused(state))` (return `[row, ring(isFocused(state))]`);
  - `Check`: `style={{ width: 24, alignItems: 'center' }}` becomes `style={(state) => [{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }, ring(isFocused(state))]}`, with `const ring = useFocusRing();` in `Check`.
- `web-shell.tsx` `MenuItem`: its style function returns `[item, ring(isFocused(state))]`.

Then the fields, which are focused by a click as well, so their accent border shows whenever they have the focus (on a computer only):
- `kit.tsx` `TextField`:
  - add `const [focused, setFocused] = useState(false);`;
  - the field `View`'s style array gets `dense && focused && { borderColor: colors.primary }` after the colour object;
  - the `TextInput` gets, after `{...props}`:
    - `onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}`
    - `onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}`
- `web.tsx` `SearchField`: the same `focused` state, and its container style becomes `[{ …same… }, focused && { borderWidth: 1, borderColor: colors.primary }]`.

In `panel.tsx`, the drawer's `Animated.View` gets `role="dialog"` and `accessibilityLabel={title}`.

In `chart.tsx`, `BarChart`'s outer `View` becomes:
```tsx
    <View accessible accessibilityRole="image" accessibilityLabel={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`} style={{ gap: 6 }}>
```

- [ ] **Step 6: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes, no type error. If TypeScript refuses `outlineStyle` / `outlineOffset` on `ViewStyle`, check `node_modules/react-native/Libraries/StyleSheet/StyleSheetTypes.d.ts` (React Native 0.86 declares them). If they are missing there, type the ring as `ViewStyle & Record<string, unknown>`, with a one-line comment that react-native-web reads these properties.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/core/focus.ts apps/mobile-rn/src/core/theme/index.ts apps/mobile-rn/src/core/widgets/kit.tsx apps/mobile-rn/src/core/widgets/pickers.tsx apps/mobile-rn/src/core/widgets/web.tsx apps/mobile-rn/src/core/widgets/table.tsx apps/mobile-rn/src/core/widgets/panel.tsx apps/mobile-rn/src/core/widgets/chart.tsx apps/mobile-rn/src/features/competitions/organizer/web-shell.tsx apps/mobile-rn/test/core/focus-contrast.test.tsx apps/mobile-rn/test/core/web-widgets.test.tsx apps/mobile-rn/test/screens/organizer-overview.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): computer keyboard and contrast pass: focus ring after a key press, 24 px targets, light palette at 4.5:1, named dialog, radio switch, readable chart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Lot Web 2 review minors on the same pages

**Files:**
- Modify: `apps/mobile-rn/src/features/competitions/organizer/participants-web.tsx` (a single payment and a batch never run together)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/finances.tsx` (« Aucun paiement ne correspond » after a search)
- Modify: `apps/mobile-rn/src/features/competitions/organizer/overview.tsx` (Judges card when the team cannot be read)
- Test: `apps/mobile-rn/test/screens/organizer-web3-minors.test.tsx`

**Interfaces:**
- Consumes: Task 1 held requests, keys `orgFinNoMatch`, `orgKpiUnavailable`; lot Web 2 `useMarkPaid`, `useMarkPaidBatch`.
- Produces:
  - While a batch runs, the panel's « Marquer payé » is disabled and the row menu offers no « Marquer payé ». While a single payment runs, « Marquer payé (n) » is disabled.
  - Finances' empty table says `orgFinNoMatch` when the event has transactions but the search or filter hides them all.
  - The Judges card's caption becomes `orgKpiUnavailable` when the staff request fails.

- [ ] **Step 1: Write the failing screen tests**

`apps/mobile-rn/test/screens/organizer-web3-minors.test.tsx`:
```tsx
import { act, fireEvent } from 'expo-router/testing-library';

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

describe('lot Web 2 review minors', () => {
  beforeEach(() => setWide(true));

  it('while a batch runs, a single « Mark paid » is not offered, and the batch waits for a single payment', async () => {
    let answer!: (a: [number, unknown]) => void;
    const b = orgBackend()
      .on('GET', '/competitions/c9/heats', [200, []])
      .on('POST', '/competitions/c9/registrations/r4/mark-paid', () => new Promise<[number, unknown]>((r) => (answer = r)))
      .on('POST', '/competitions/c9/registrations/r1/mark-paid', [200, {}]);
    const screen = await renderScreen(open('participants'), b);
    await fireEvent.press(await screen.findByTestId('tab-collect'));
    await fireEvent.press(screen.getByTestId('reg-table-check-r4'));
    await fireEvent.press(screen.getByTestId('reg-batch'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    // r4 is on its way: r1 cannot be paid on its own meanwhile.
    await fireEvent.press(screen.getByTestId('reg-r1'));
    expect((await screen.findByTestId('reg-panel-pay')).props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('reg-panel-close'));
    await fireEvent.press(screen.getByTestId('reg-table-menu-r1'));
    expect(screen.queryByTestId('reg-paid-r1')).toBeNull();
    await act(async () => answer([200, {}]));
  });

  it('a search that hides every payment says so', async () => {
    const screen = await renderScreen(open('finances'), orgBackend());
    await fireEvent.changeText(await screen.findByTestId('fin-search'), 'zzz');
    expect(screen.getByText('No payment matches.')).toBeTruthy();
  });

  it('the Judges card says when the team cannot be read', async () => {
    const screen = await renderScreen(open('dashboard'), orgBackend().on('GET', '/competitions/c9/staff', [500, { code: 'INTERNAL' }]));
    expect(await screen.findByText('Not available right now')).toBeTruthy();
    expect(screen.getByTestId('ov-kpi-judges-value').props.children).toBe('—');
  });
});
```
In the first test the row menu is open after the last press, and the menu's sheet lists its items. `reg-paid-r1` must be missing from it.

- [ ] **Step 2: Run them to see them fail**

Run (in `apps/mobile-rn`): `npx jest test/screens/organizer-web3-minors.test.tsx`
Expected: 3 FAIL. The panel's button is enabled, there is no « no match » text, and the caption still reads « Judges and head judges ».

- [ ] **Step 3: The fixes**

`participants-web.tsx`:
- `AthletePanel` gets a new prop `locked: boolean`, passed as `locked={batch.busy}` from `ParticipantsWeb`, and its pay button is disabled while it is set (`Button` is also off while `busy`):
```tsx
            <Button testID="reg-panel-pay" label={t('orgMarkPaid')} busy={pay.busy} disabled={locked} onPress={() => pay.ask(r)} style={{ flex: 1 }} />
```
- In `rowActions`, the « Marquer payé » item needs `!batch.busy` as well: `...(r.paymentStatus === 'PENDING' && standing(r) && !batch.busy ? [ … ] : [])`.
- `reg-batch`: `disabled={chosen.length === 0 || pay.busy}`.
- Comment above `rowActions`: `// One flow at a time: a single payment and a batch could otherwise both pay the same registration.`

`finances.tsx`: `empty={<EmptyState icon="payments" message={f.rows.length ? t('orgFinNoMatch') : t('orgFinNone')} />}`.

`overview.tsx`: the Judges card's `caption={t('orgKpiJudgesHint')}` becomes `caption={staff.isError ? t('orgKpiUnavailable') : t('orgKpiJudgesHint')}`.

- [ ] **Step 4: Run the tests and the typecheck**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes, no type error.

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/participants-web.tsx apps/mobile-rn/src/features/competitions/organizer/finances.tsx apps/mobile-rn/src/features/competitions/organizer/overview.tsx apps/mobile-rn/test/screens/organizer-web3-minors.test.tsx
git diff --cached --stat
git commit -m "fix(mobile): organizer lot Web 2 review minors (no single payment during a batch, Finances « no match », Judges card when the team cannot be read)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Visual check — computer (dark, light, keyboard) and the phone comparison

**Files:**
- Create (not committed): `<scratchpad>/organizer-web3-extra.cjs`. Output goes to `/mnt/c/Users/GIGABYTE/Desktop/organizer-web-3/` (`computer/`, `computer-light/`, `keyboard/`, `phone-before/` from Task 1, `phone-after/`).

**Interfaces:**
- Consumes: lot Web 2's `<scratchpad>/organizer-web-shots.cjs` (computer and phone modes, overflow, page and console errors), the offline demo draft, and the `prefs` key the app keeps in `localStorage` (`{"state":{"locale":"fr","themeMode":"light"},"version":0}`).
- Produces: screenshots, overflow and error reports, the light-theme and keyboard checks, and the phone comparison.

- [ ] **Step 1: Run every app check**

Run (in `apps/mobile-rn`): `npx jest --maxWorkers=2 && npx tsc --noEmit`
Expected: every suite passes: the 45 suites before this lot, plus `organizer-web3`, `organizer-toasts`, `organizer-skeletons`, `organizer-live`, `organizer-board-coupons`, `focus-contrast` and `organizer-web3-minors`. No type error.

- [ ] **Step 2: Computer and phone screenshots**

Restart the demo server (Global Constraints). With the cached browser (lot Web 2 plan, Task 11 Step 2), run:
- `node <scratchpad>/organizer-web-shots.cjs <playwright-core dir> <chrome-headless-shell> /mnt/c/Users/GIGABYTE/Desktop/organizer-web-3/computer computer`
- `node <scratchpad>/organizer-web-shots.cjs <playwright-core dir> <chrome-headless-shell> /mnt/c/Users/GIGABYTE/Desktop/organizer-web-3/phone-after phone`

Expected: overflow `0` everywhere, `page errors: none`. The console errors list only the Heats row + edit icon nesting from lot B (on `planning`).

- [ ] **Step 3: Light theme and keyboard**

`<scratchpad>/organizer-web3-extra.cjs`:
```js
// Usage: node organizer-web3-extra.cjs <playwright-core dir> <chrome-headless-shell> <output dir>
const [pwDir, chrome, out] = process.argv.slice(2);
const { chromium } = require(pwDir);
const fs = require('node:fs');
const MANAGE = 'http://localhost:8081/competitions/01a10804-0000-7000-8000-00000000d001/manage';

async function signedIn(browser, theme) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'fr' });
  // The app keeps its preferences under « prefs » (AsyncStorage → localStorage on the web).
  await page.addInitScript((t) => localStorage.setItem('prefs', JSON.stringify({ state: { locale: 'fr', themeMode: t }, version: 0 })), theme);
  await page.goto('http://localhost:8081', { waitUntil: 'load', timeout: 300000 });
  await page.getByTestId('login-email').waitFor({ timeout: 300000 });
  await page.getByTestId('login-email').fill('ahmed_rx@demo.fitnessleague.test');
  await page.getByTestId('login-password').fill('demo-password-2026');
  await page.getByTestId('login-submit').click();
  await page.waitForTimeout(3000);
  await page.goto(MANAGE, { waitUntil: 'load', timeout: 300000 });
  await page.getByTestId('org-menu').waitFor({ timeout: 60000 });
  return page;
}

(async () => {
  const browser = await chromium.launch({ executablePath: chrome });
  for (const dir of ['computer-light', 'keyboard']) fs.mkdirSync(`${out}/${dir}`, { recursive: true });
  const light = await signedIn(browser, 'light');
  for (const p of ['dashboard', 'finances', 'participants']) {
    await light.getByTestId(`org-menu-${p}`).click();
    await light.waitForTimeout(1200);
    await light.screenshot({ path: `${out}/computer-light/fr-${p}.png` });
  }
  await light.getByTestId('reg-01a10804-0000-7000-8000-00000000d200').click();
  await light.getByTestId('reg-panel').waitFor({ timeout: 10000 });
  await light.waitForTimeout(400);
  await light.screenshot({ path: `${out}/computer-light/fr-participants-panel.png` });
  await light.close();

  const dark = await signedIn(browser, 'dark');
  // Tab order: top bar, then menu, then page. Record where the focus goes.
  const order = [];
  for (let i = 0; i < 14; i++) {
    await dark.keyboard.press('Tab');
    order.push(await dark.evaluate(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName));
    if (i === 5 || i === 13) await dark.screenshot({ path: `${out}/keyboard/fr-tab-${i + 1}.png` });
  }
  console.log('tab order:', JSON.stringify(order));
  await dark.mouse.click(700, 500);
  await dark.waitForTimeout(300);
  await dark.screenshot({ path: `${out}/keyboard/fr-after-click.png` });
  await dark.close();
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```
Run: `node <scratchpad>/organizer-web3-extra.cjs <playwright-core dir> <chrome-headless-shell> /mnt/c/Users/GIGABYTE/Desktop/organizer-web-3`
Expected:
- The tab order starts with the top bar (`org-top-back`, `org-top-preview`, …) and reaches the menu (`org-menu-dashboard`, …) before the page.
- `fr-tab-6.png` and `fr-tab-14.png` show a 2 px accent ring around the focused control.
- `fr-after-click.png` shows no ring.
- The light screenshots show the darker accent (`#596e16`) with white text on the filled buttons, and secondary texts that read clearly.

Open each picture with the Read tool. Fix what is wrong with a test that fails first, and re-run.

- [ ] **Step 4: The phone comparison**

```bash
cd /mnt/c/Users/GIGABYTE/Desktop/organizer-web-3
for f in phone-before/*.png; do cmp -s "$f" "phone-after/$(basename "$f")" || echo "differs: $(basename "$f")"; done
```
Expected: only `fr/ar-leaderboard.png` (the new search field) and `fr/ar-planning.png` (the clock; in French, « Aucun heat terminé sur 2 ») may differ. Open each differing pair with the Read tool. Any other difference is a regression of the phone render: fix it with a test that fails first.

Leave the preview running and open the direct link in the owner's browser (`cmd.exe /c start "" "<MANAGE link>"`). Nothing is committed in this task.

---

### Task 9: Whole-branch review, fixes, docs, push

**Files:**
- Modify: `README.md` (the organizer space row), `handoff.md` (title, §2, §3, §4, §6)
- Modify: whatever the review's important findings touch, each with its test

- [ ] **Step 1: The review**

Dispatch one fresh reviewer on the strongest model (Agent tool, `subagent_type: "code-reviewer"`, `model: "opus"`), on the range from this plan's commit to `HEAD`, restricted to `apps/mobile-rn`. Give it this plan's Global Constraints and Review Focus verbatim. Ask it also to check:
- the phone: only the planned behaviours changed, and no `dense`-only look leaked;
- the keyboard ring never shows after a click;
- `refetchInterval` cannot pile up requests (a slow answer, a page left and opened again);
- the optimistic toggle against a reload landing in the middle;
- i18n keys and placeholders;
- nothing outside `apps/mobile-rn` and `docs`.

It is read only (no `git stash`, no checkout), dispatches no subagent, grades its findings and lists what it declined to judge.

- [ ] **Step 2: Fix the important findings**

For each critical or important finding (graded by its effect on a person using the app): first a test that fails because of it, then the fix, then `npx jest --maxWorkers=2 && npx tsc --noEmit`, then one `fix(mobile): organizer web lot 3 review fixes (…)` commit. Write the minors in handoff §6 without fixing them.

- [ ] **Step 3: Docs**

`README.md`, row `| Organizer space (2026-10-14): …`: insert before ` | Lots A and B + web lots 1 and 2 done, tested |` the sentence:
` Lot Web 3 adds a toast after every organizer action, skeletons while lists load, the time table, Planning and the leaderboard read again every 30 s while open, a leaderboard search with per-category export names, an optimistic promo-code toggle, and on a computer a keyboard focus ring, 24 px targets and a light palette at 4.5:1.`
Then replace ` | Lots A and B + web lots 1 and 2 done, tested |` with ` | Lots A and B + web lots 1 to 3 done, tested |`.

`handoff.md`:
- The title line names lot Web 3.
- §2 gets a new « Update » bullet at the top. It covers:
  - lot Web 3: the plan, what changed on phone and computer, and the owner's choices (behaviours everywhere, keyboard and contrast on the computer);
  - the review verdict and the fixes;
  - the checks (suites / tests);
  - the screenshots folder `Desktop/organizer-web-3/` and the phone comparison result;
  - the push state: lots B, Web 1 and Web 2 were pushed on 2026-10-16 (`da155c1..655be20`); say whether lot Web 3 is pushed.
- §3 gets the lot Web 3 files: `core/focus.ts`, `denseLight`, the `SkeletonList` change, `useHeats` / `useCompLeaderboard` intervals, `logic-web.ts` additions, `test/fake-api.ts` held requests and the new test files.
- §4 gets the lot Web 3 commits.
- §6 `0-web2` becomes `0-web3`: the review's deferred minors, the minors of lot Web 2 still open (the overview « À encaisser » that follows `/dashboard`), and what stays for later (the proposals from the recording; the « needs backend » list).

- [ ] **Step 4: Commit and push**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add README.md handoff.md
git diff --cached --stat
git commit -m "docs: organizer space, lot Web 3: README and handoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin feat/organizer-space
git status -sb | head -1
```
Expected: the push lists `655be20..<new head>`, and the branch is level with `origin/feat/organizer-space`. The owner asked on 2026-10-16 to see the commits on GitHub, and this plan's approval covers this push. It is not a merge and opens no PR.
