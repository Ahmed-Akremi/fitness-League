# Prompt: Circle21 look and lot Web 2 for the organizer space on a computer

> Paste everything below the line into Claude Code, run from the `fitness-league` repo root, on branch `feat/organizer-space`.
>
> **Sources:**
> - a screen recording of the Circle21 organizer back-office (circle21.events/myevent), captured on 2026-10-14 and broken into frames on 2026-10-15; the key frames are in `ref/` next to this file;
> - the owner's gap analysis, `docs/superpowers/specs/2026-10-15-organizer-dashboard-circle21-analysis.md`.

---

## Role and goal

You are continuing the **organizer space on a computer** in `apps/mobile-rn` (Expo / React Native, running in the browser through react-native-web, route `/competitions/:id/manage`).

Lot Web 1 is built and reviewed (commits `fb1725a`…`c368735`):

- the wide layout (`useWideWeb`, ≥ 1024 px);
- the grouped left menu (`ORG_MENU`, `web-shell.tsx`);
- the top bar and the centered column;
- the CSV export on every list;
- the guiding empty pages.

Your job has two parts:

1. **Build lot Web 2** from the analysis (items 7, 8, 9 and 10 of its §3).
2. **Make the computer layout look and feel like the Circle21 back-office** in the recording. Copy its density, its page anatomy (section header, KPI cards, tables, toolbar, side panel, empty states) and its interaction patterns, but keep **our** brand: name, `config.accent`, the Barlow Condensed / Inter fonts and our texts.

**Before you write anything, read these:**

- `docs/superpowers/specs/2026-10-15-organizer-dashboard-circle21-analysis.md` (the decisions and the backlog);
- `docs/superpowers/plans/2026-10-15-organizer-web-lot-1.md` (the conventions lot 1 followed);
- `handoff.md` §6 (deferred minors);
- `apps/mobile-rn/src/features/competitions/organizer/{web.ts,web-shell.tsx,manage.tsx,dashboard.tsx,breakdown.tsx,participants.tsx,planning.tsx,timetable.tsx,logic-b.ts}`;
- `src/core/widgets/{kit,common,chart,pickers}.tsx` and `src/core/theme/index.ts`;
- **every image in `docs/prompts/circle21-style-upgrade/ref/`**, opened with the Read tool. The table at the end says what each one shows.

## Decisions already made by the owner (do not reopen them)

- **Frontend only.** Change nothing under `apps/api`, `apps/backend` or `apps/admin`, and add no new endpoint. Anything the analysis marks **B** stays out.
- **Changes apply only to the computer layout**, i.e. `useWideWeb()` is true. Phones and narrow windows keep the 11 chips and today's screens, pixel for pixel. Every new page or panel must be reachable only from the computer layout, or be shared code that leaves the phone render unchanged.
- **Approach A:** keep the grouped **left menu**. Circle21's top tab bar is not adopted. Restyle the menu (§2), but don't move it.
- **No new packages.** `expo-sharing` and `expo-file-system` are the owner's call; charts are built from `View`s or the existing `chart.tsx`.
- **Local only:** nothing is pushed or published.
- **Texts:** every string goes in `src/core/i18n/{en,fr,ar}.json` with the same keys and placeholders in all three, French uses « tu », and the ICU plurals the app supports are used for counts. On the web the layout is not mirrored in Arabic; phones mirror it.

## 1. Look: computer-only density tokens

Circle21 is a dense desktop tool: flat cards, small radii, 30px controls, uppercase section titles, big light numbers. Phones keep `radius = { card: 20, field: 14 }`.

Add a `webDense` token set in `core/theme` and use it **only** in the computer layout:

| Token | Value | Circle21 equivalent |
|---|---|---|
| card radius | 10 | flat 8px cards, no border, no shadow (refs 01, 02) |
| field / button radius | 6 | 4px inputs and buttons (refs 06, 12) |
| control height | 32 | 30px buttons, inputs and icon squares |
| card padding | 16 | 16px |
| grid gap | 12 | 12px |
| section title | 13 / 700 / UPPERCASE / letter-spacing 0.5 | `EVENT OVERVIEW`, `PROMO CODES` (refs 01, 12) |
| card title | 14 / 700 | `Gross Revenue`, `Total Judges` |
| card caption | 12, `colors.outline` | `Total revenue`, `Since October 14, 2026` (refs 01, 16) |
| KPI value | `displayText(36)` (our Barlow) | 32px light number |
| table header label | 12, `colors.outline` | ref 12 |

**Colors:** keep `palettes.dark` and `palettes.light`; they already match Circle21's contrast. Use `colors.primary` (our accent) everywhere Circle21 uses orange (the active menu item, focus, progress), and `colors.success` for "on" switches, as Circle21's green toggles do (refs 09, 15).

## 2. Shell restyle (`web-shell.tsx`)

- **Top bar** becomes one compact row, about 56px tall (ref 01):
  - Left:
    - a back icon button (← `/competitions/:id`);
    - a 32px round cover thumbnail, falling back to `GymLogo`-style initials;
    - the title (16 / 700, one line) with a lock icon while unpublished;
    - under the title, one 12px muted line `{format} · {status}`.
  - Center: `orgTopDates` ("Inscriptions du … au …").
  - Right:
    - Aperçu (outlined);
    - Demander la publication / Partager (filled), exactly as today;
    - a `Menu` (`⋯`) for the rarer actions already on the dashboard.
  - Keep every existing `testID`.
- **Left menu** keeps the same sections and marks, restyled like Circle21's sub-navigation (refs 01, 05):
  - Items are 36px tall: an 18px icon (pick one per page from the existing `IconName`s) plus a 14px label, radius 6.
  - The selected item gets `surfaceHigh` plus a **3px accent bar on its leading edge**; hover gets `surface`.
  - Section headers stay as uppercase muted 12px labels.
  - Width goes from 248 to **220**.
- **Page anatomy:** every page on the computer starts with a **section header row**: the uppercase title on the left, the page's actions on the right (filters, search, primary button, export icon), and a hairline underneath (refs 01, 12, 20). The CSV export from lot 1 moves into this row as a square icon button with an `accessibilityLabel`.

## 3. Lot Web 2 pages (analysis §3, items 7–10)

### 7. Vue d'ensemble enriched (refs 01, 02, 03, 04)

- **A row of 4 KPI cards:** Participants, Payées, À encaisser, Revenu.
  - Each card has a title, a muted caption (date context like "Aujourd'hui, 15 octobre", or what the figure means), and the big number.
- **A second row:** Juges (count from `staff`, role JUDGE + HEAD_JUDGE), À juger, Validés, Refusés.
- **A wide card "{n} inscriptions"** charting `perDay` from `distribution()` as `LineChart` or bars, with the day axis.
- **A 3-column row:**
  - "Par catégorie": top 5, then « Voir tout » opens Participants filtered by category;
  - "Scores": a ring of to-judge / validated / refused;
  - "Genre": women / men / mixed with a **« Afficher en : Pourcentages (%) | Nombres »** switch (ref 03).
- Empty cards show a centered muted "Aucune donnée pour l'instant".
- Acceptance: the figures match `/dashboard` and the registrations, and the % / numbers switch works. The publication checklist and state card stay, above the KPIs.

### 8. Finances: a new computer page under Tableau de bord (ref 01)

- **A row of KPI cards:** Brut, Remises (codes), Encaissé, À encaisser, Gratuits, Remboursé.
  - Each has a caption, plus a footnote with an info icon where useful, e.g. "Paiement manuel, pas de frais en ligne".
- **Under the section header "TRANSACTIONS"**, with search, a payment filter and export, a table with these columns: date, nom, catégorie, prix, remise, montant, paiement.
- Empty state: "Aucun paiement".
- Acceptance: on the demo data, the sum of the amounts equals encaissé + à encaisser + remboursé.

### 9. Participants as a table, with a detail panel and batch payment (refs 12, 14, 08)

- **Table on the computer.** The header row is its own rounded `surface` strip with 12px muted labels.
  - Columns: a checkbox (only in the « À encaisser » filter), `#`, an UPPERCASE bold name, catégorie, paiement pill, montant, date, and a trailing `⋯` row menu.
  - Keep the `FlatList` virtualization.
- **Detail panel.** Clicking a row opens a **right side panel**.
  - Size and behavior: 420px wide, sliding in over 200ms, Esc or a backdrop click closes it, focus moves into it and comes back to the row.
  - Content: catégorie, prix, remise, paiement, date, and the athlete's heats and lanes.
  - Actions: « Marquer payé » and the receipt.
  - Sticky footer like Circle21's drawer: [Fermer] outlined, [Marquer payé] filled.
  - The panel uses the **light** palette (`palettes.light(config.accent)`) even in dark mode, as Circle21's drawer is light on a dark page (refs 08, 13).
- **Batch payment.** Selecting several rows in « À encaisser » offers « Marquer payé (n) ».
  - It sends one request at a time and ends with a summary: payées, déjà réglées, and the error that stopped it.
  - A 409 in the middle counts as « déjà réglée » and the rest continue.
  - Two quick clicks start only one batch.

### 10. Heats and Time Table as separate computer pages (refs 18, 19)

- **Planning** in the menu becomes three items: WODs, Heats, Horaire du jour.
- **Horaire du jour** has a toolbar row (day, catégorie, WOD, search) and 3 cards:
  - the **clock card**: weekday and date in 12px uppercase muted, `HH:MM:SS` in `displayText(28)` ticking every second **only on this page**, then "Fin du programme à HH:MM";
  - the **heat-en-cours card**: the heat running, or "Aucun heat actif";
  - a **progress ring**: "X sur Y heats terminés · Z restants".
- Below the cards: the day's heats as a list (terminé / en cours / à venir), and « Retard » as today. Reuse `timetable()`, `delayTargets`, `runDelay` and `TimetableCard`'s rules.
- When the day has no heat, show the guide card with a button to Heats (lot 1 pattern, ref 18).
- Acceptance: the list follows the same day rule as « Retard ».

### Menu and phone fallback for the new pages

- Finances and Horaire du jour are **computer-only** menu entries: extend `ORG_MENU`, but not the phone chips.
- If the window narrows below 1024px while one of them is open, show the nearest phone tab (Finances → dashboard, Horaire → planning), and don't leave a blank page. Add a test next to lot 1's « a narrow window keeps the page that was open ».

## 4. Shared pieces to build once, for the computer layout

Put these in `src/core/widgets/web.tsx`, or next to `web-shell.tsx` if they're organizer-only. Each gets a focused test.

| Piece | Look (ref) | Notes |
|---|---|---|
| `PageHeader` | 01, 12, 20 | uppercase title, right-side actions slot, hairline |
| `KpiCard` | 01, 16 | title, caption, big number, optional footnote with info icon; 4 / 2 / 1 columns |
| `DataTable` | 12, 14 | header strip, 44px rows, optional checkbox column, `⋯` menu, `FlatList` inside |
| `Toolbar` + `SearchField` | 12, 19, 20 | filled search with magnifier; dropdown filters (`Select`); export icon button |
| `SidePanel` | 08, 13 | right drawer described in §3.9; reusable for later lots |
| `Ring` | 04, 19 | progress / split ring built from two half-`View`s or an SVG already shipped by react-native-web; no new package |
| `SegmentedInline` | 03 | « Pourcentages (%) \| Nombres » text switch |

`SkeletonList`, `EmptyState`, `StatusPill`, `Menu`, `Dialog` and `toast` already exist, so reuse them.

## 5. Not in this lot

Lot Web 3 covers toasts on every mutation, skeletons, the keyboard and contrast pass, the 30s refresh on Time Table and leaderboard, the leaderboard search and the optimistic promo-code toggle. Leave those alone, apart from the clock tick that §3.10 needs.

The recording also shows patterns the backlog doesn't list yet. **Write them as proposals at the end of your plan and don't build them:**

- create forms in the same `SidePanel` (refs 08, 13);
- the bottom-left notice card (refs 16, 17);
- setting cards with inline ✓ save (refs 05, 06);
- radio cards (refs 10, 21);
- the « Voir tout » card grid (ref 02).

Everything the analysis marks **B** is out of scope: clubs and countries, Stripe fees, waivers, chat, live overlays, ticketing, shop, forms and so on.

## 6. How to work (same discipline as lots A, B and Web 1)

1. **Write the plan first** at `docs/superpowers/plans/2026-10-16-organizer-web-lot-2.md` in lot 1's format: global constraints, a review-focus list of risky edge cases each tied to a test, then numbered tasks with files, steps and commits. Task 1 adds every new i18n key in all three languages. **Stop and show me the plan before coding.**
2. **Tests first** for every task. Check the shared rules (finance sums, batch results, the timetable day, % rounding that adds up to 100) with unit tests in `test/core/`, and the screens in `test/screens/` with the existing harness and `organizer-fixtures.ts`.
3. **After each task:** `cd apps/mobile-rn && npx jest && npx tsc --noEmit`, then one commit in the repo's message style (`feat(mobile): …`).
4. **At the end:**
   - Run the offline demo on :8081 and screenshot every computer page in FR and AR at 1440×900. Measure horizontal overflow (it must be 0) and check for page errors.
   - Set the screenshots side by side with `ref/` and list the differences you kept on purpose.
   - Check that the phone render is unchanged (390×844) on the pages you touched.
5. Ask a fresh reviewer on the strongest model to review the whole branch, fix the important findings with tests that failed first, then update `handoff.md` and the README section, as lot 1 did.

## Reference screenshots (`docs/prompts/circle21-style-upgrade/ref/`)

| File | What to study |
|---|---|
| `01-event-header-kpis.jpg` | Compact event header (back, avatar, name + lock, subtitle, gear, centered registration date, bell / Preview / Publish / ⋯); sub-nav active state; section header with actions; 4 KPI cards |
| `02-scrolled-sticky-tabs-cards.jpg` | Chart card; 3-column cards with « See All »; "No data available" |
| `03-donut-split-footer.jpg` | Two-way split card with « Display stats as: Percentages (%) \| Numbers »; footer |
| `04-status-donuts.jpg` | "N / total" numbers with rings and dot legends |
| `05-setting-card-richtext.jpg` | Setting card: title, description, required note, editor, Save |
| `06-inline-save-fields.jpg` | Filled inputs with square ✓ inline-save buttons |
| `07-empty-state.jpg` | Empty state + header actions |
| `08-drawer-create.jpg` | Light right drawer on a dark page: header + X, sections, segmented choice, sticky Cancel / Save |
| `09-drawer-swatches-toggle.jpg` | Editor toolbar, color swatches, green "on" switch |
| `10-radio-cards.jpg` | Radio-card options, dropdown button, switch + inputs row |
| `11-dropzones.jpg` | Dashed upload zones |
| `12-toolbar-table.jpg` | Section header with filter / search / primary / export; table header strip; "+ Add" row |
| `13-drawer-promo.jpg` | Drawer with switch and a [quantity · discount · % ⌄] row |
| `14-table-rows.jpg` | Row styling (bold uppercase name) |
| `15-toggle-settings.jpg` | Stack of setting cards with switches |
| `16-kpis-notice-toast.jpg` | KPI cards with "Since …" captions; bottom-left notice card |
| `17-notice-collapsed.jpg` | Notice collapsed to a pill |
| `18-empty-state-planning.jpg` | Two-line empty-state title + text + button |
| `19-timetable-live.jpg` | Live clock card, "No active heat", progress ring, filter toolbar |
| `20-leaderboard-toolbar.jpg` | Refresh button, selects, search, ⋯; leaderboard header |
| `21-radio-card-expanded.jpg` | Selected radio card expanded with nested switch |
| `22-messaging-tags.jpg` | 3-column page; colored outline tag chips |
| `23-modal-skeleton.jpg` | Centered modal with search and skeleton list |
| `24-modal-choice-tiles.jpg` | Modal with two choice tiles |
| `25-link-fields.jpg` | Read-only link fields with copy / settings icon buttons |
