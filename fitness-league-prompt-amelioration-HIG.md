# Prompt: Apple HIG improvements for the phone app (iOS first)

> Paste everything below the line into Claude Code, run from the `fitness-league` repo root.
>
> **Sources:**
> - the design audit of `apps/mobile-rn` against Apple's Human Interface Guidelines, made on 2026-10-18 with the `apple-design` skill;
> - the HIG pages the audit cites, in `~/.claude/skills/apple-design/references/hig/` (`accessibility.md`, `color.md`, `dark-mode.md`, `typography.md`, `layout.md`, `tab-bars.md`, `branding.md`, `entering-data.md`, `pickers.md`, `onboarding.md`, `design-principles.md`, `designing-for-iphone-duo.md`) and `references/code-audit.md`.
>
> Every contrast ratio below was computed with the WCAG formula from the hex values in `src/core/theme/index.ts`. Paths are relative to `apps/mobile-rn/`.

---

## Role and goal

You are improving the **phone app** in `apps/mobile-rn` (Expo SDK 57, React Native 0.86, expo-router). It runs on iPhone, iPad (declared), Android, and in the browser for the organizer space.

The audit rated the app **Critical issues**:

- light mode fails contrast across the tier and status colors;
- some information is carried by color alone;
- one touch target is below Apple's minimum;
- VoiceOver misses information;
- on iPhone the app uses Android (Material) conventions throughout: Material icons, floating action buttons, a three-dot menu, full-screen pickers, a JavaScript tab bar.

Your job: fix the accessibility failures first, then the forms and feedback, then text sizing, then the iOS conventions. Keep the brand: the name, `config.accent`, the Barlow Condensed / Inter fonts, our texts, and the dark graphite look.

**Before you write anything, read these:**

- `apps/mobile-rn/AGENTS.md` (Expo rules: versioned docs, `npx expo install`, no hand edits in native folders);
- `src/core/theme/index.ts`, `src/core/prefs.ts`, `src/core/focus.ts`;
- `src/core/widgets/{kit,common,pickers,error}.tsx`;
- `src/app/(tabs)/_layout.tsx`, `src/features/shell/root.tsx`;
- `src/features/{home/screen.tsx,league/screen.tsx,workouts/screens.tsx,workouts/log-workout.tsx,onboarding/screen.tsx,auth/screens.tsx,settings/screen.tsx,notifications/screens.tsx,challenges/screens.tsx,badges/screen.tsx,announcements/news.tsx}`;
- `src/core/i18n/index.ts` (placeholder and plural format) and `src/core/i18n/{en,fr,ar}.json`;
- the tests in `test/` (harness, fake API, screen tests) so your changes keep them green.

## Rules (do not break them)

- **Phones only.** The organizer space on a computer (`ThemeScope dense`, `webDense`, `denseLight`, `useWideWeb()`) must look exactly as it does today. Check it after Lot 1, because `denseLight` spreads `palettes.light`.
- **Android:** Lots 1–4 (accessibility, contrast, forms, copy, text size) apply to both platforms. Lot 5 and later iOS-specific changes go behind `Platform.OS === 'ios'`, and Android keeps today's look pixel for pixel.
- **Frontend only.** Change nothing under `apps/api`, `apps/backend`, `apps/admin` or `apps/landing`, and add no endpoint.
- **Expo:** before touching any Expo or React Native API, read the SDK 57 versioned docs (`https://docs.expo.dev/versions/v57.0.0/`) and `https://docs.expo.dev/llms.txt`, and never answer from memory. Add packages only with `npx expo install`, and only if Q7 allows them. Configure native behavior in `app.json` or config plugins; never edit `ios/` or `android/` by hand.
- **Texts:** every new string goes in `en.json`, `fr.json` and `ar.json` with the same keys and placeholders. French uses « tu », as the existing strings do. Counts use the ICU plurals the app already supports, for example `{count, plural, =0{…} =1{…} other{{count} …}}` as in `weekStreak`. Phones mirror the layout in Arabic; keep using `marginStart` / `end` and never `left` / `right`.
- **Colors stay 6-digit hex strings.** The code appends alpha suffixes (`divisionColor(division) + '59'`, `colors.primary + '24'`), so an 8-digit value or a color object would break it.
- **Keep every existing `testID`**, and give new controls one.
- **No unrelated refactors.** Change what the item describes and nothing more.
- **Local only:** work on a new branch `feat/hig-phone`, make one commit per lot, and never push.

## Ask the owner first

Ask these seven questions **at the start, all at once** (AskUserQuestion). Lots 1–4 don't depend on the answers, so start them right after asking. Lots 5–8 follow the answers.

| # | Question | Options (recommended first) | Used in |
|---|---|---|---|
| Q1 | Appearance | **Follow the system and remove the Dark / Light / System switch** (HIG `dark-mode.md › Best practices`: "Avoid offering an app-specific appearance setting") · keep the dark-first default and the switch | Lot 6 |
| Q2 | iPad | **A: turn off iPad support for version 1** (`supportsTablet: false`) · B: design for iPad (content column, rotation, sidebar) | Lot 7 |
| Q3 | Body text size | **17 pt** (Apple's default) · 16 pt · keep 15 pt | Lot 3.6 |
| Q4 | Elite division color (today it's the same lime as every button) | **Violet `#C084FC` dark / `#7E3FBF` light** · magenta `#F472B6` / `#B0306E` · keep lime | Lot 8 |
| Q5 | Home order | **Remove the Shortcuts row** (it repeats Profile links) **and move "Log workout" right under the main card** · keep the order | Lot 8 |
| Q6 | The "Goals" tab opens on the "Challenges" segment | **Open on Goals and put Goals first** · rename the tab to Challenges | Lot 2.6 |
| Q7 | New packages | **Allow `expo-symbols` (SF Symbols) and `@expo/ui` (native menus and pickers)** · `expo-symbols` only · no new package | Lot 5 |

---

## Lot 1: accessibility failures (Critical, both platforms)

### 1.1 Theme-aware tier, status and badge colors

**Problem.** The tier, medal, movement, status, rarity and like colors are fixed hex values chosen for the dark theme. Light mode uses them unchanged on its `#F6F7F9` surface:

| Element | Contrast | Needed |
|---|---|---|
| Gold `#FFD166` | 1.35:1 | 3:1 (bold text) |
| Silver `#C0C4CC` | 1.63:1 | 3:1 |
| Bronze `#E09F6B` | 2.10:1 | 3:1 |
| Elite `#C6F432` | 1.20:1 | 3:1 |
| Platinum `#7FDBDA` | 1.50:1 | 3:1 |
| Diamond `#3DA9FC` | 2.37:1 | 3:1 |
| Rank up `#3DDC84` | 1.66:1 | 3:1 |
| Rank down `#FF6B6B` | 2.59:1 | 3:1 |
| "Under review" `#FFB020` | 1.71:1 (1.57:1 in its pill) | 3:1 |
| Rarity Legendary `#FFC107` / Rare `#40C4FF` (icons) | 1.52 / 1.86:1 | 3:1 |
| Light accent `#6D861C` as text (links, active tab label) | 4.14:1 on white, 3.86:1 on surface | 4.5:1 |

In dark mode, the white number on the red unread badge (`#FF6B6B`) is 2.78:1, under 3:1.

HIG `accessibility.md › Vision`: "If your app supports Dark Mode, make sure to check the minimum contrast in both light and dark appearances."

**Change.**

1. Extend `Colors` in `src/core/theme/index.ts`:

   ```ts
   warning: string;   // "Under review"
   badge: string;     // unread count bubble, white text on it
   heart: string;     // news like
   flame: string;     // streak icon
   tier: Record<'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND' | 'ELITE', string>;
   rarity: Record<'RARE' | 'EPIC' | 'LEGENDARY', string>;
   ```

2. Use these values. Dark keeps today's values except `badge`. Every light value was checked against `#F6F7F9`.

   | Token | Dark | Light | Light contrast |
   |---|---|---|---|
   | `tier.BRONZE` | `#E09F6B` | `#9A5A2B` | 5.06 |
   | `tier.SILVER` | `#C0C4CC` | `#626872` | 5.23 |
   | `tier.GOLD` | `#FFD166` | `#8A6400` | 5.02 |
   | `tier.PLATINUM` | `#7FDBDA` | `#1C7A79` | 4.77 |
   | `tier.DIAMOND` | `#3DA9FC` | `#1D6FB5` | 4.91 |
   | `tier.ELITE` | `#C6F432` (Lot 8 may change it) | `#596E16` | 5.34 |
   | `warning` | `#FFB020` | `#9A5B00` | 5.06 |
   | `badge` | `#E5484D` (white on it 3.91) | `#C62828` (white on it 5.62) | — |
   | `rarity.LEGENDARY` | `#FFC107` | `#8A6400` | 5.02 |
   | `rarity.EPIC` | `#E040FB` | `#9C27B0` | 5.88 |
   | `rarity.RARE` | `#40C4FF` | `#0B6FA4` | 5.12 |
   | `heart` | `#FF4D6D` | `#C2185B` | 5.48 |
   | `flame` | `#FF8A3D` | `#B4531A` | 4.67 |

3. Fix the light accent on phones. `palettes.light` gets `primary: darken(accent, 0.55)` (`#596E16`: 5.73:1 on white, 5.34:1 on surface), `onPrimary: '#FFFFFF'` (5.73:1), and `outline: '#62666F'` (4.82:1 on `surfaceHigh`; today's `#6B7079` is 4.17:1 there and fails). These are the values `denseLight` already uses, so the computer layout doesn't change. You may simplify `denseLight`, but its output must stay identical. Black on `#596E16` is only 3.67:1, which is why `onPrimary` must become white.

4. Replace every hard-coded color with the tokens:
   - `divisionColor()` in `src/core/widgets/common.tsx:135` becomes `divisionColor(code, colors)`. Update its callers (`common.tsx:157`, `src/features/home/screen.tsx:93,102` and any others you find with grep).
   - The medal colors in `RankRow` (`common.tsx:168`) and in `src/features/league/screen.tsx:140` reuse `tier.GOLD`, `tier.SILVER` and `tier.BRONZE`.
   - `MovementBadge` (`common.tsx:100`) uses `colors.success` and `colors.error`. Light success `#1E8E4E` is 3.89:1, enough for its bold text.
   - `src/features/workouts/screens.tsx:92` uses `colors.warning`.
   - `CountBadge` (`src/core/widgets/kit.tsx:253`) uses `colors.badge`.
   - The rarity colors in `src/features/badges/screen.tsx:81` use `colors.rarity`.
   - `HEART` in `src/features/announcements/news.tsx:13` uses `colors.heart`.
   - The streak flame `#FF8A3D` in `home/screen.tsx:110` uses `colors.flame`.
   - The login logo's bolt icon in `src/features/auth/screens.tsx:50` uses `colors.onPrimary` instead of `#0E0F12`.
   - Leave `GYM_PALETTE` and the `GymLogo` initials alone: dark text on a fixed bright tile works in both modes.

5. **Add a test** in `test/` (follow the existing conventions) that computes WCAG contrast for both `palettes.dark(config.accent)` and `palettes.light(config.accent)` and asserts:
   - `text` on `background`, `surface` and `surfaceHigh`: at least 4.5;
   - `outline` on `surface` and `surfaceHigh`: at least 4.5;
   - `primary` on `background` and `surface`: at least 4.5;
   - `onPrimary` on `primary`: at least 4.5;
   - `error` on `surface`: at least 4.5;
   - every `tier`, `rarity`, `warning`, `heart` and `flame` value on `surface`: at least 3 (they are bold text or icons);
   - `#FFFFFF` on `badge`: at least 3.

**Accept when** the test passes, no hex value remains in the files listed above (grep `'#[0-9A-Fa-f]{6}'` in `src/features` returns only `GYM_PALETTE`-style fixed tiles), and the computer organizer layout looks unchanged.

### 1.2 Never rely on color alone

**Problem.**
- Leaderboard rows show an athlete's division only as the color of the ring around their initials (`league/screen.tsx:159`), and the screen-reader label doesn't mention it (`:146`).
- Your own row is marked only by a tinted background (`:153`).
- The division is printed as a raw code ("GOLD") in every language (`home/screen.tsx:102,244`).

HIG `color.md › Inclusive color`: "Avoid relying solely on color to differentiate between objects… or communicate essential information."

**Change.**
- Add keys `divisionBronze`, `divisionSilver`, `divisionGold`, `divisionPlatinum`, `divisionDiamond` and `divisionElite`:
  - en: Bronze, Silver, Gold, Platinum, Diamond, Elite;
  - fr: Bronze, Argent, Or, Platine, Diamant, Élite;
  - ar: برونزي, فضي, ذهبي, بلاتيني, ماسي, النخبة.
- Add a helper `divisionLabel(t, code)` and use it wherever a division is shown.
- In each leaderboard row, show the division name as a small bold label in its tier color under the name, next to the existing subtitle.
- On your own row, add a "You" pill (`t('you')`, new key: en "You", fr "Toi", ar "أنت").
- Use this `accessibilityLabel`: `#{rank}, {name}, {division}, {lp} LP` plus `, {you}` on your own row.

**Accept when** a grayscale screenshot of the League tab still shows each division and which row is yours, and VoiceOver reads both.

### 1.3 Warm-up checkbox target

**Problem.** The tap area at `src/features/workouts/log-workout.tsx:228-237` is 24 × 36 pt with no extra hit area, and nothing on screen says it means "warm-up." HIG `accessibility.md › Mobility`: 44 × 44 pt by default, 28 × 28 pt minimum.

**Change.** Use `hitSlop={10}`, `minWidth: 44`, `minHeight: 44` and center the icon. Above the first set row of each exercise, show a short column label with `t('warmup')` over the checkbox column.

**Accept when** the target measures at least 44 × 44 pt and the label is visible.

### 1.4 VoiceOver and TalkBack gaps

- **Notification bell** (`src/features/notifications/screens.tsx:20`): its label replaces the child text, so the unread count is never read. Use a label like `notificationsUnread`: `{count, plural, =0{Notifications} =1{Notifications, 1 unread} other{Notifications, {count} unread}}` in all three languages.
- **`XpBar`** (`common.tsx:54`): add `accessible`, `accessibilityRole="progressbar"` and the existing `accessibilityValue`. In onboarding (`src/features/onboarding/screen.tsx:103`), give it the label `t('stepOf', { current: step + 1, total: 3 })`, a new key (en "Step {current} of {total}", fr "Étape {current} sur {total}", ar "الخطوة {current} من {total}").
- **Main-sport chip** (`onboarding/screen.tsx:81`): the star is unlabeled. Add `accessibilityLabel` = `{sport}, {mainSport}` when it is the main sport, using a new key `mainSport` (en "main sport", fr "sport principal", ar "الرياضة الأساسية").
- **Home tiles** (`home/screen.tsx:188`): add `accessibilityRole="button"` when `onPress` is set, plus a label `{label}, {value}`.
- **Picker close button** (`src/core/widgets/pickers.tsx:25`): the label `"close"` is hard-coded English. Use `t('cancel')`.
- **iOS date picker confirm button** (`pickers.tsx:133`): `"OK"` is hard-coded. Use an i18n key (reuse one if `ok` or `done` exists, otherwise add `done`: en "Done", fr "OK", ar "تم").

**Accept when** a VoiceOver walk through Home, League, Onboarding and Log workout reads every count, state and progress value.

---

## Lot 2: forms, feedback and writing (both platforms)

1. **Registration autofill** (`src/features/auth/screens.tsx:159-162` and the email and full-name fields): set `autoComplete` to `username`, `name`, `email` and `new-password`, plus the matching `textContentType` on iOS (`username`, `name`, `emailAddress`, `newPassword`) so iCloud Keychain suggests a strong password. HIG `entering-data.md`: "Get information from the system whenever possible."
2. **Check fields as people fill them in.** Today the registration errors appear only after submit. Show a field's error once it loses focus with a value (keep the submit-time check for empty fields). HIG `entering-data.md`: "Dynamically validate field values."
3. **Birth date picker.** Add an optional `display` prop to `DateField` (`pickers.tsx:101`). Registration passes `'spinner'` on iOS so people don't page month by month back 30 years. The workout date keeps `'inline'`. HIG `pickers.md`: the wheels style "supports data entry through built-in or external keyboards."
4. **Quiet hours** (`src/features/settings/screen.tsx:208-224`): replace the two text dialogs ("HH:MM →", then "→ HH:MM") with a time picker for start, then end (`@react-native-community/datetimepicker`, `mode="time"`, 24-hour). Keep storing `HH:MM`. Remove the `'HH:MM →'` labels. HIG `entering-data.md`: "When possible, offer choices instead of requiring text entry."
5. **Messages that disappear on a timer.** Toasts close after 3.5 s (`kit.tsx:368`) but carry errors and results. HIG `accessibility.md › Cognitive`: "Minimize use of time-boxed interface elements."
   - Errors from Settings saves (privacy, notifications, training days) show inline under their section with `ErrorText`, not in a toast.
   - Every toast also calls `AccessibilityInfo.announceForAccessibility(message)`.
   - When a screen reader is on, the toast stays for 10 s.
6. **Goals tab** (Q6): follow the owner's answer. The recommended version puts `goals` first in the segment at `src/features/challenges/screens.tsx:37` and selects it by default.
7. **Ask before losing typed work.**
   - Removing an exercise that has any filled set (`log-workout.tsx:212`) opens the existing `Dialog` (destructive). Its text uses new keys, for example en "Remove {exercise}?" / "The sets you entered will be lost."
   - Deleting a queued workout (`workouts/screens.tsx:45-52`) asks the same way.
8. **Empty states should offer a next step** (`league/screen.tsx:50,126`):
   - "Invite your training partners." gets a "Find athletes" button (`t('findAthletes')`) that goes to `/search`;
   - "Join a gym to see its ranking." gets "Find a gym" (`t('findGym')`), which goes to `/gyms`.
9. **Greeting and capitalization.**
   - `home/screen.tsx:77` says "Good morning" until 5 pm. Use morning before 12, afternoon from 12 to 18, evening from 18. Add `greetingAfternoon` (en "Good afternoon, {name}", fr "Bonjour, {name}", ar "مساء الخير يا {name}").
   - Remove `.toUpperCase()` on the Home "Log workout" button (`home/screen.tsx:162`) so it matches the Train tab's "Log workout."

---

## Lot 3: text size and touch targets (both platforms)

1. **Large display numbers.** In `Txt` (`kit.tsx:18`), when the flattened style's `fontFamily` is `fonts.display` or `fonts.displaySemi`, default `maxFontSizeMultiplier` to `1.4`. Those numbers are already 20–72 pt; body text keeps scaling without a cap. Don't set `allowFontScaling={false}` anywhere.
2. **Home tiles** (`home/screen.tsx:122-126,185-193`): when `useWindowDimensions().fontScale >= 1.5`, stack the three tiles vertically. Let tile labels use two lines instead of `numberOfLines={1}`. HIG `typography.md`: "Keep text truncation to a minimum as font size increases."
3. **Fixed widths:** the duration field at `log-workout.tsx:160` (`width: 130`) becomes `flex: 1` with a sensible `minWidth`.
4. **Chip targets:** chips are 32 pt tall (`kit.tsx:387`). Keep the look and add `hitSlop={{ top: 6, bottom: 6 }}` so the target reaches 44 pt (onboarding days, league scopes, filters).
5. **Picker close button** (`pickers.tsx:25`): set `hitSlop` to 11 so it reaches 44 pt.
6. **Body size** (Q3): `Txt` body is 15 pt (`kit.tsx:21`), under Apple's 17 pt default (`accessibility.md › Vision`). Apply the owner's choice to `body`, and scale `small` and `title` in proportion (for example 17 → small 15, title 19). Check that no screen overflows.

**Accept when** the iOS simulator at Settings › Accessibility › Display & Text Size › Larger Text, largest size, shows Home, League, Log workout and Settings with no clipped or overlapping text.

---

## Lot 4: Increase Contrast (both platforms)

Hairline borders are 8% white (`border: '#FFFFFF14'`), and field outlines are 1.12:1 against their surface, so they disappear for people who turned on Increase Contrast. HIG `color.md › Best practices`: "supply… an increased contrast option for each variant."

- Look in the React Native 0.86 docs for how to read Increase Contrast: `AccessibilityInfo` on iOS and `isHighTextContrastEnabled` on Android. Don't guess an API name.
- Add `highContrast: boolean` to what `useTheme()` returns. When it is on:
  - `border` rises to `#FFFFFF33` in dark and `#00000029` in light;
  - field borders (`TextField`, `TimeField`, `FieldButton`) use `colors.outline` instead of `surfaceHigh`.
- If no reliable API exists, apply the stronger border only through `DynamicColorIOS` with `highContrastDark` and `highContrastLight` on `border`. Grep first that no code concatenates a suffix to `colors.border`.

---

## Lot 5: iOS conventions (iOS only, Android unchanged; follow Q7)

HIG `branding.md › Best practices`: "Express your brand with familiar components." `cross-platform.md`: decide per component for iOS and Android.

1. **Native tab bar.** The `Tabs` in `src/app/(tabs)/_layout.tsx` is drawn in JavaScript. It misses iOS Liquid Glass, the iPad tab bar or sidebar, and the side placement on iPhone Duo (`code-audit.md`: High).
   - Move iOS to expo-router's **native tabs**. Read the SDK 57 docs for the current import path and API.
   - Keep the same five tabs, order, labels and URLs (`/`, `/train`, `/league`, `/goals`, `/profile`), because the code calls `router.navigate('/league')` and similar.
   - If native tabs need a `Stack` per tab for headers, add one per tab folder and keep every title and `headerRight`.
   - Use filled SF Symbols on iOS (`tab-bars.md`: "Prefer filled symbols or icons for consistency with the platform."): `house.fill`, `dumbbell.fill`, `trophy.fill`, `flag.fill`, `person.fill`.
   - Android and the web build keep today's tabs. The organizer web layout must still work, so check with `npx expo start --web`.
2. **SF Symbols for icons** (if Q7 allows `expo-symbols`). In `Icon` (`kit.tsx:13`), on iOS, look the Material name up in a map and render a `SymbolView`; fall back to Material when the name has no entry. Grep every icon name used in `src/`. Starting map:

   | Material | SF Symbol |
   |---|---|
   | `home` | `house` |
   | `fitness-center` | `dumbbell` |
   | `emoji-events` | `trophy` |
   | `outlined-flag` / `flag` | `flag` / `flag.fill` |
   | `person` / `person-outline` | `person.fill` / `person` |
   | `notifications-none` | `bell` |
   | `settings` | `gearshape` |
   | `chevron-right` | `chevron.forward` |
   | `close` | `xmark` |
   | `add` | `plus` |
   | `more-vert` | `ellipsis.circle` |
   | `delete-outline` | `trash` |
   | `delete-forever` | `trash.fill` |
   | `check` | `checkmark` |
   | `check-box` / `check-box-outline-blank` | `checkmark.square.fill` / `square` |
   | `timer` | `timer` |
   | `event` / `calendar-month` | `calendar` |
   | `place` | `mappin.and.ellipse` |
   | `local-fire-department` | `flame.fill` |
   | `my-location` | `location.fill` |
   | `group` | `person.2` |
   | `insights` | `chart.line.uptrend.xyaxis` |
   | `military-tech` | `medal` |
   | `cloud-upload` | `icloud.and.arrow.up` |
   | `error-outline` | `exclamationmark.circle` |
   | `hourglass-top` | `hourglass` |
   | `download` | `square.and.arrow.down` |
   | `logout` | `rectangle.portrait.and.arrow.right` |
   | `bedtime` | `moon.fill` |
   | `arrow-drop-down` | `chevron.up.chevron.down` |
   | `done-all` | `checkmark.circle` |
   | `sports-mma` | `figure.boxing` |
   | `directions-run` | `figure.run` |
   | `directions-bike` | `figure.outdoor.cycle` |
   | `pool` | `figure.pool.swim` |
   | `directions-walk` | `figure.walk` |
   | `bolt` | `bolt.fill` |
   | `tune` | `slider.horizontal.3` |
   | `monitor-weight` | `scalemass` |

   Type the map with the package's symbol-name type, so `tsc` rejects any name that doesn't exist.
3. **Floating action buttons become a "+" in the navigation bar on iOS.** Affected: the Train tab (`workouts/screens.tsx:74-82`) and every `<Fab>` (`battles/screens.tsx:44`, `challenges/screens.tsx:77`, `goals/screen.tsx:70`, `leagues/screens.tsx:70`, `progress/screens.tsx:147`).
   - On iOS, render a `headerRight` `IconButton` (`add` / `plus`) with the same `testID` and an `accessibilityLabel` equal to the FAB label.
   - The League "jump to my rank" button (`league/screen.tsx:173-181`) becomes a `headerRight` button (`location.fill`) on the League tab. Lift its handler out of `LeaderboardList` so it acts on the visible scope.
   - Android keeps the FABs.
4. **Overflow menu** (`kit.tsx:288-319`): on iOS, open `ActionSheetIOS.showActionSheetWithOptions` (built into React Native, no package) with a Cancel button. If Q7 allows `@expo/ui`, prefer its native menu. Android keeps the bottom sheet.
5. **Short lists in `Select`** (`pickers.tsx:18-71`):
   - On iOS, lists of 7 options or fewer (theme, training days, visibility, language) open a native pop-up menu if Q7 allows `@expo/ui` (HIG `pickers.md`: "If you need to display a fairly short list of choices, consider using a pull-down button instead of a picker").
   - Otherwise present the existing modal with `presentationStyle="pageSheet"` on iOS, so it is a system sheet that closes with a swipe.
   - Long lists (governorates, cities, sports) stay as they are.

---

## Lot 6: appearance (follow Q1)

If the owner chose **follow the system**:
- the default `themeMode` becomes `'system'` (`src/core/prefs.ts:23`);
- remove the Segmented control in `src/features/settings/screen.tsx:98-106` and its now-unused strings;
- bump the persisted store's `version` and add a `migrate` that resets a stored `'dark'` to `'system'` once, because most existing installs saved `'dark'` as the old default;
- keep the `ThemeScope` forced schemes the computer layout uses.

If the owner keeps the switch, change nothing in this lot. Lot 1 already makes light mode legible.

## Lot 7: iPad (follow Q2)

- **A:** set `ios.supportsTablet` to `false` in `app.json`. Nothing else changes.
- **B:**
  - cap the content column at 640 pt and center it in `Screen` (`kit.tsx:153`), on Home and in lists, using `useWindowDimensions()`, never the device type (HIG `layout.md`: "Determine layout based on size classes, not device type or orientation");
  - set `orientation` to `default`;
  - let the native tabs from Lot 5 convert to a sidebar;
  - check Split View and Slide Over widths.

## Lot 8: identity (follow Q4 and Q5)

- **Elite color** (Q4): set `tier.ELITE` to the chosen pair, for example `#C084FC` (6.65:1 on the dark surface) and `#7E3FBF` (5.85:1 on the light surface). Lime then means action only (HIG `color.md`: "Avoid using the same color to mean different things").
- **Division as the signature:** give `XpBar` an optional `color` prop and fill the home card's progress bar with the athlete's division color instead of lime. Check whether the `/me/lp` response (see `src/core/api/demo-backend.ts`) has a next-division threshold. If it does, show "{n} LP to {division}" under the bar (new key, plural-aware). If it doesn't, add nothing: no new endpoint.
- **Home order** (Q5): remove the Shortcuts row (`home/screen.tsx:144-161`); every target is still reachable from Profile or the carousel. Move the "Log workout" button directly under the main card.

---

## Out of scope (list them in your final report, don't do them)

- **App icon:** `assets/icon.png` and `assets/android-icon-foreground.png` are Expo's placeholder icon (the blue "A" on a grid), and `src/features/announcements/news.tsx:12` uses the same file as the news author avatar. A designer has to make the real icon, and App Store Review Guideline 2.1 asks for placeholder content to be removed before submission. Don't draw one.
- **iPhone Duo:** after Lots 5 and 7, the layout has to be tested in Xcode's Device Hub (outer display, inner display, partial fold, Split View). Code review can't confirm it.
- Anything under `apps/api`, `apps/backend`, `apps/admin`, `apps/landing`, and the organizer computer layout.

## Verification

Run from `apps/mobile-rn` after each lot:

```bash
npx tsc --noEmit
npx jest
npx expo-doctor        # only if you added a package
```

Then check manually on an iOS simulator (dev build) and an Android emulator, and write down what you saw:

1. light and dark appearance on Home, League, Train, Goals, Profile, Settings and Badges;
2. Increase Contrast on, in both appearances;
3. the largest Larger Text size;
4. a VoiceOver walk through Onboarding, Home, League, Log workout and Notifications (and TalkBack on Android for Lots 1–2);
5. Reduce Motion on (the progress bar and loading placeholders stay still, as today);
6. Arabic: the layout is mirrored and numbers still read left to right;
7. the computer organizer layout (`npx expo start --web`, window at least 1024 px wide) looks unchanged;
8. Android after Lot 5: no visual change.

## Final report

For each lot, give:
- what changed and which files;
- which tests you added or updated and their result;
- which manual checks you did and which you couldn't do;
- what you skipped and why (including an owner answer that removed a lot);
- the out-of-scope items above, still open.
