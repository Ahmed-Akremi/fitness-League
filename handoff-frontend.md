# Organisation update (branch `organisation-update`, from 2026-10-22)

Design: `docs/superpowers/specs/2026-10-22-organisation-update-design.md` (approved; 12 phases, one review stop
after each). Backend to-do list: `docs/organisation-backend-contract.md`.

- **Phase 1 (foundations): done.**
  - Local store (`core/api/local-store.ts`) and the fetch wrapper (`core/api/local-routes.ts`).
  - The organizer layer and its flag (`core/api/org-local.ts`, `config.orgLocal`).
  - The live bus (`core/live-bus.ts`, `useLive()`) and the `eventStyle` overlay with `eventStyleOf()`.
  - `LocalBadge`.
  - The test harness puts the same layer (in memory) and a bus in `fakeServices`.
- **Run the tests with Windows Node:**
  - `node_modules` was installed by Windows pnpm (store `C:\Users\GIGABYTE\AppData\Local\pnpm\store`). Linux Node in WSL fails on it (`@babel/runtime` not found), and a WSL `pnpm install` would want to rebuild everything.
  - From WSL: `cmd.exe /c "cd /d C:\Users\GIGABYTE\fitness-league\apps\mobile-rn && npx jest --maxWorkers=4"`. That's 71 suites in about 35 s (versus about 9 min under WSL). `npx tsc --noEmit` works the same way.
- **Trap:** Node has a global `BroadcastChannel`. `browserChannel()` opens one only when `Platform.OS === 'web'`; an open channel keeps jest alive.

# Handoff — frontend, phone app (2026-10-21: Apple HIG work, 8 lots built on `feat/hig-phone`, pushed)

The backend handoff stays in `handoff.md`. This file covers `apps/mobile-rn` only: the iPhone-first HIG
improvements from `fitness-league-prompt-amelioration-HIG.md` (repo root), what was built, what the two reviews
found, and what is left.

## 0. Start here (next session)

Opening prompt to paste:

> Read `handoff-frontend.md`, then fix batch 1 of section 6 on `feat/hig-phone`: one test that fails first per
> fix, the full suite at the end, one commit per fix group. Don't touch the backend.

First steps, in order:
1. **Find where things are.** `git fetch && git log --oneline -5 origin/main origin/feat/hig-phone`.
   - `feat/hig-phone` starts at `3a556a6` (`origin/main` on 2026-10-20, PR #26) and holds 10 commits:
     the 8 lots, one review fix, and this handoff. Pushed to `origin/feat/hig-phone`; no PR yet
     (`gh` is not installed in WSL: the owner opens it on GitHub).
   - If `main` moved, rebase on `origin/main` before fixing: the branch only touches `apps/mobile-rn` and
     `pnpm-lock.yaml`.
2. **Check the build.** From `apps/mobile-rn`: `npx tsc --noEmit` (clean) and `npx jest --maxWorkers=2`
   (62 suites, 433 tests, about 9 minutes on `/mnt/c`; the default worker count times out).
3. **Read section 6** (open findings) and section 5 (traps) before writing code.
4. **Stage files by name.** The working tree carries about 10 files that differ only in line endings
   (CRLF noise: `.gitignore`, `README.md`, `handoff.md`, `infra/…`, `docs/…`, `apps/mobile-rn/package-lock.json`).
   Never `git commit -a`. `stash@{0}` is a line-ending-only backup of 4 of them, safe to drop.

## 1. Goal

Make the phone app feel at home on iPhone (Apple Human Interface Guidelines) without losing the brand
(name, `config.accent` lime, Barlow Condensed / Inter, dark graphite look), in 8 lots: accessibility, forms and
feedback, text size, Increase Contrast, iOS conventions, appearance, iPad, identity.

Rules the prompt set (still binding):
- **Phones only.** The organizer space on a computer (`ThemeScope dense`, `webDense`, `denseLight`,
  `useWideWeb()`) must look exactly as before.
- **Android** keeps today's look for every iOS-only change (lot 5 and later).
- **Frontend only**: nothing under `apps/api`, `apps/backend`, `apps/admin`, `apps/landing`; no new endpoint.
- **Expo SDK 57**: read the versioned docs before touching an Expo or React Native API; add packages only with
  `npx expo install --pnpm`; never edit `android/` or `ios/` by hand.
- **Texts** in `en.json`, `fr.json`, `ar.json` with the same keys and placeholders; French uses « tu »; ICU
  plurals; `marginStart`/`end`, never `left`/`right`. **Colors stay 6-digit hex** (the code appends alpha).
- Keep every `testID`, give new controls one. No unrelated refactors.

Owner's answers to the prompt's 7 questions (2026-10-20):

| # | Question | Answer |
|---|---|---|
| Q1 | Appearance | Follow the system, remove the Dark / Light / System switch |
| Q2 | iPad | Off for version 1 (`supportsTablet: false`) |
| Q3 | Body text | 17 pt |
| Q4 | Elite color | Violet `#C084FC` dark / `#7E3FBF` light |
| Q5 | Home order | Own answer: move « Log workout » to the top bar; keep the Shortcuts row; its tile says « Records » (one word) |
| Q6 | Goals tab | Own answer: rename the tab to Challenges (it keeps opening on Challenges) |
| Q7 | Packages | Both `expo-symbols` and `@expo/ui` |

## 2. Current state

| Commit | Lot | What it does |
|---|---|---|
| `c05bba2` | 1 Accessibility | Theme tokens for tier, rarity, warning, badge, heart, flame (light values reach 3:1 / 4.5:1); darker light accent with white on it (`palettes.light` = the old `denseLight`); divisions in words (`divisionLabel`), « You » pill, leaderboard labels; warm-up checkbox 44 × 44; VoiceOver labels (bell count, progress bars, onboarding step, main sport, Home tiles, picker close, Done) |
| `d58ad9a` | 2 Forms | Registration autofill and check-on-blur; iOS wheels for the birth date; quiet hours with a 24 h time picker; Settings errors inline; toasts announced, 10 s with a screen reader; confirmations before losing typed work; empty-state actions; greeting by hour; tab renamed Challenges |
| `1caeaa7` | 3 Text size | Body 17 / small 15 / title 19 on phones; display numbers capped at 1.4×; Home tiles stack at large sizes; chips and picker close at 44 pt |
| `3262cb2` | 4 Increase Contrast | `useTheme().highContrast` (iOS `isDarkerSystemColorsEnabled`, Android `isHighTextContrastEnabled`, followed live); stronger hairlines and field borders |
| `03892e6` | 5 iOS conventions | Native tabs (`expo-router/unstable-native-tabs`) with filled SF Symbols; SF Symbols in `Icon`; floating buttons → « + » in the navigation bar; League jump button in the bar; native pull-down menu and pop-up lists (`@expo/ui`) |
| `b3c205d` | 6 Appearance | Phones follow the system (no switch, prefs store v1 migrates `'dark'` → `'system'`); the web keeps dark + switch |
| `e249226` | 7 iPad | `ios.supportsTablet: false` |
| `1622df1` | 8 Identity | Violet Elite; Home progress bar in the division color; « {n} LP to {division} » from `GET /me/lp`; « + » next to the bell; Shortcuts tile « Records » |
| `a9f3e12` | review fix | The computer layout (`dense`) keeps 15 / 13 / 17 pt |

- Tests: 62 suites / 433 (366 before the branch). New files: `test/core/theme-contrast.test.ts`,
  `test/core/app-config.test.ts`, `test/screens/hig-{a11y,forms,text,contrast,ios,appearance,identity}.test.tsx`.
- Packages added: `expo-symbols ~57.0.3`, `@expo/ui ~57.0.25` (`package.json`, root `pnpm-lock.yaml`).
  `apps/mobile-rn/package-lock.json` (npm, for the owner's second Windows PC) was **not** regenerated: running
  npm here would break the pnpm `node_modules`. `npm install` on that PC adds them.
- Bundles build for web, Android and iOS (`npx expo export --platform … --no-bytecode`, checked 2026-10-21).
- **Nothing was checked on a simulator, emulator or device** (no Mac here). See section 6, « Device checks ».

## 3. Active files

| File | Role |
|---|---|
| `src/core/theme/index.ts` | `Colors` (with `tier`, `rarity`, `warning`, `badge`, `heart`, `flame`), `palettes.dark/light`, `denseLight` (= `palettes.light`), `useTheme()` returning `highContrast` (shared store reading the OS setting) |
| `src/core/prefs.ts` | `defaultThemeMode()` (`'system'` on phones, `'dark'` on web), `migratePrefs` (store version 1) |
| `src/core/widgets/kit.tsx` | `SF_SYMBOLS` map and `Icon` (SymbolView on iOS); `Txt` sizes (dense keeps the old ones) and the 1.4× display cap; `Fab` (header « + » on iOS); `Menu` (native on iOS); `HeaderTarget` + `useHeader`; toasts |
| `src/core/widgets/native.ios.tsx` / `native.tsx` | SwiftUI `NativeMenu` and `NativePicker` (`@expo/ui`), iOS only; the `.tsx` twin returns null so Android and the web never load SwiftUI views |
| `src/core/widgets/pickers.tsx` | `Select` (`menu` prop: native pop-up on iOS), `DateField` (`display` prop, `-picker` testID), `FieldButton` |
| `src/core/widgets/common.tsx` | `divisionColor(code, colors)`, `divisionLabel(t, code)`, `XpBar` (`color`, `testID`), `RankRow` |
| `src/features/shell/tabs.ts` | `TABS`: the five tabs (name, label key, SF Symbol, Material icons) shared by both tab layouts |
| `src/features/shell/tab-stack.tsx` | `TabStack` (iOS: a stack per tab, its own navigation bar) and `TabSlot` (Android/web: hands header options to the JS tab) |
| `src/app/(tabs)/_layout.tsx` / `_layout.ios.tsx` | JS tabs (Android, web) / native tabs (iOS) |
| `src/app/(tabs)/{train,league,goals,profile}/` | `index.tsx` (the old route file, moved) + `_layout.tsx` (TabSlot) + `_layout.ios.tsx` (TabStack) |
| `src/features/league/screen.tsx` | Leaderboard rows (division word, You pill, labels), iOS header actions per scope (`onJumpReady`) |
| `src/features/settings/screen.tsx` | Inline errors, quiet-hours time picker (iOS spinner, Android dialog + native clock, web text field), switch web-only |
| `src/features/home/screen.tsx` | `greetingKey`, tiles (a11y, stacking), « + » in the top bar, « {n} LP to {division} », XP bar in the division color |
| `test/harness.tsx` | `renderScreen(..., { stack: true })` renders real navigation bars |

## 4. Decisions taken during the build (rulings)

1. Top-3 rank colors use the theme tokens on the computer too (visible only in its light theme): the old values
   were 1.35–2.1:1.
2. Lot 6 applies to iOS and Android only; the web keeps the dark default and the switch, so the computer
   layout does not flip on a light OS.
3. Q6: `navChallenges` = « Challenges / Challenges / التحديات »; the Home « Your goal » link keeps that key.
4. Q5: Home has no native bar, so « + » sits in its top row beside the bell (`home-log-workout`).
5. Toast live region on the web only (iOS/Android announce through `announceForAccessibility`; Android would read
   both).
6. Quiet hours on Android: our dialog (Start / End) with a field opening the native 24 h clock; the web keeps an
   HH:MM text field.
7. iOS birth-date wheels stay open until Done (the calendar closes on pick, the wheels would close on the first
   turn).
8. Native pop-up lists are opt-in (`Select menu`) for training days, visibility, language — not « ≤ 7 options »,
   which would also catch small city lists.
9. Button, Chip, Checkbox draw through `Icon`, so one screen never mixes SF Symbols and Material.
10. `Fab` takes `accessibilityLabel` (the icon-only weigh-in Fab needed a name for its header button).
11. « {n} LP to {division} » sits under the LP number, not under the bar (the bar measures level XP).
12. `i18n-usage.test.ts` placeholder scanner taught to skip one-word plural cases (`=0{Notifications}`).

## 5. Traps (still true)

- **Jest runs as iOS** (`Platform.OS === 'ios'`). Android or web cases: `jest.replaceProperty(Platform, 'OS',
  'android')` with `afterEach(() => jest.restoreAllMocks())`.
- **RN's jest mock reports `fontScale: 2`.** Tests that depend on text size set it with `Dimensions.set`.
- **`AccessibilityInfo` is a per-file jest mock.** Never `mockRestore()` it (that drops its default promises and
  later renders crash on `.then`); use `mockReturnValueOnce` or `mockImplementation` for the file.
- **A test that unmounts and renders again in the same `it` breaks the following renders.** One render per test.
- **Hidden elements** (`accessibilityElementsHidden`) need `{ includeHiddenElements: true }` in queries.
- **`@expo/ui` views in jest** are host elements: find them by `testID` and fire `buttonPress` /
  `selectionChange` (`{ nativeEvent: { selection } }`), not `press`.
- **SwiftUI imports only in `.ios.tsx` files.** `@expo/ui/swift-ui` looks its native views up at import time.
- **expo-router `Slot` is a navigator.** A screen inside a Slot sets options on the Slot, not on the tab: that is
  why `TabSlot` provides `HeaderTarget`.
- **`npx expo install` must get `--pnpm`.** The npm `package-lock.json` in `apps/mobile-rn` makes Expo choose npm,
  which would break the pnpm workspace `node_modules`.
- **`expo-doctor` reports 3 failures that predate the branch**: `.expo` not git-ignored, 10 packages a patch
  behind SDK 57, native `android/` folder alongside `app.config.js`.
- Don't run `npx expo lint` in `apps/mobile-rn` (no ESLint config; it edits `package.json`). The lint is `tsc`.

## 6. Next steps

### Batch 1 — bugs from the reviews (recommended next)

From the whole-branch code review (2026-10-21) and the HIG design review (same day):

| # | Where | Problem | Fix |
|---|---|---|---|
| 1 | `src/core/prefs.ts:30` | A phone user who had chosen Light is stuck in light: the switch is web-only now, the migration keeps `'light'` | On phones, migrate every saved mode to `'system'` |
| 2 | `league/screen.tsx:185`, `common.tsx:189` | Grey text on « my » row: 3.88:1 dark, 4.45:1 light (15 pt needs 4.5:1); the lot 1 test only checks against `surface` | Remove the row tint (the « You » pill marks the row; 4.82 / 5.6:1 without it) and test the highlighted row |
| 3 | `league/screen.tsx:45` | iOS « jump to my rank » shows when the list is empty, loading or failed; on an empty Friends list it swaps « Find athletes » for an error | Report the jump only once rows are on screen |
| 4 | `pickers.tsx:156` | Birth date: Done without turning the wheels leaves the field empty | On Done, save the date shown |
| 5 | `workouts/screens.tsx:86` | Delete confirmation says « never sent », but the button only shows for rejected or conflicting items | Reword (« It isn't saved on the server, so it will be lost »), en/fr/ar |
| 6 | `home/screen.tsx:203` | Tile labels drop the « 3/4 » caption; a tile with no governorate reads « , #12 » | Add the caption, skip empty parts |
| 7 | `native.ios.tsx:16` | Unconfirmed: a menu item that opens an RN Modal (Report) while the UIMenu closes may not present | Run item handlers on the next frame; confirm on a device |
| 8 | `kit.tsx:3` | `expo-symbols` is bundled on Android and web (~1 MB font + 112 KB JSON) | Move the SF branch of `Icon` to `icon.ios.tsx` |
| 9 | `kit.tsx:96` | 17 pt body also applies to athlete screens in a desktop browser | 17 / 19 / 15 on iOS and Android only |
| 10 | `tab-stack.tsx:12`, `shell/root.tsx:106` | Solid navigation bars replace Liquid Glass and the scroll edge effect on iOS 26 | iOS: no `headerStyle.backgroundColor`, `headerLargeTitle` on tab roots, Barlow in `headerLargeTitleStyle` |
| 11 | `pickers.tsx:68` | Long lists (governorate, city, sport) open full screen, no swipe to close | `presentationStyle="pageSheet"` on iOS |
| 12 | `kit.tsx:34` | `more-vert` → `ellipsis.circle`; HIG toolbars prefer symbols without a border | `'ellipsis'` |

Smaller ones: changing the sport wipes typed sets without asking (`log-workout.tsx:157`); the Home goal card
opens Challenges on its challenges list; `Select menu` ignores `error`/`placeholder`/`bare`;
`web-table-panel.test.tsx` restores `Platform.OS` only at the end of the test; `useHeader` last-writer-wins
(headerRight never cleared on unmount); the field-border expression is copied in four widgets; Train keeps its
own floating button instead of `Fab`; header screen options are copied in three layouts.

### Batch 2 — HIG behavior changes (owner to confirm)

- Home with a system navigation bar on iOS (large title = greeting, bell and « + » in `headerRight`).
- Confirmations through `Alert.alert` (native on iOS and Android) instead of our `Dialog`; no destructive red on
  an action the person chose deliberately (`alerts.md`); `Alert.prompt` `'secure-text'` for the delete-account
  password on iOS.
- Menus: a single « Report » item becomes a flag button; `destructive` flag on menu items (`role="destructive"`
  in `@expo/ui`).
- Icons grow with Larger Text (`size × min(fontScale, 1.5)`).
- Bold Text: `AccessibilityInfo.isBoldTextEnabled` + `boldTextChanged`, one weight step up in `Txt`.
- Craft: keep lime for primary actions and the selected tab; shortcut and empty-state icons in the text color;
  let the division colors carry the identity.

### Device checks (none done yet)

On an iOS simulator (dev build: the native modules need `npx expo run:ios` or EAS) and an Android emulator:
light and dark on Home, League, Train, Challenges, Profile, Settings, Badges; Increase Contrast in both; the
largest Larger Text size; VoiceOver through Onboarding, Home, League, Log workout, Notifications (TalkBack for
lots 1–2); Reduce Motion; Arabic (mirrored, numbers left to right); the computer organizer layout
(`npx expo start --web`, window ≥ 1024 px); Android unchanged after lot 5. Also: the last rows of Home, Train and
League must scroll clear of the floating iOS 26 tab bar (`contentInsetAdjustmentBehavior="automatic"` if not).

### Out of scope, still open

- App icon: `assets/icon.png` and `assets/android-icon-foreground.png` are Expo's placeholder (also the news
  author avatar). App Store Review Guideline 2.1 rejects placeholder content. A designer makes it.
- iPhone Duo: test in Xcode's Device Hub (outer, inner, partial fold, Split View).
- From `handoff.md`: online payment provider, push notifications (FCM), EAS release config.
