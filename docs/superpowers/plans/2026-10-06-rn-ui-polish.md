# App mobile : espacements et rendu premium — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resserrer les espacements (titres collés à leur contenu, listes regroupées) et donner un rendu plus premium à l'app Expo, sans changer la navigation.

**Architecture:** Les corrections sont faites dans les jetons du thème et les composants partagés (`kit.tsx`, `common.tsx`), que tous les écrans utilisent ; puis une passe par écran remplace les valeurs ad hoc et les `ListRow` isolées par les nouveaux composants.

**Tech Stack:** React Native 0.86 + Expo 57 + expo-router, jest-expo + @testing-library (`expo-router/testing-library`), TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-06-rn-ui-polish-design.md`

## Global Constraints

- Périmètre : `apps/mobile-rn` uniquement ; aucune nouvelle dépendance ; navigation et onglets inchangés.
- Espacements : `space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }`.
- `Colors.border` : sombre `#FFFFFF14`, clair `#0000000F`.
- Dans un `Screen` : 12 px titre de section → contenu, 24 px contenu → titre suivant.
- Les `testID` existants sont conservés ; nouvelles chaînes traduites en en/fr/ar.
- Commandes (depuis `apps/mobile-rn`) : `npx tsc --noEmit`, `npx jest`.

## Review Focus

- Arabe (RTL) : séparateurs de `ListGroup` décalés avec `marginStart` (pas `marginLeft`) pour suivre le sens de lecture.
- Enfants conditionnels de `ListGroup` (`{cond && <ListRow/>}`) : pas de séparateur orphelin ni en double — testé en Task 1.
- `SectionHeader` utilisé hors `Screen` (en-têtes de `FlatList`, `View` sans `gap`) : le titre ne doit pas coller au contenu — vérifié à la passe Task 5 et sur les captures.
- Libellés longs (fr/ar) dans les raccourcis de l'Accueil : 2 lignes max, jamais coupés au milieu d'une ligne unique.
- Thème clair : `border` visible mais discret sur fond blanc ; pastilles de statut lisibles (couleur `primary` foncée du thème clair).

---

### Task 1: Jetons et composants partagés

**Files:**
- Modify: `src/core/theme/index.ts` (interface `Colors`, `palettes`, nouvel export `space`)
- Modify: `src/core/widgets/kit.tsx` (`Screen`, `Card`, `ListRow`, nouveaux `ListGroup`, `LinkButton`)
- Modify: `src/core/widgets/common.tsx` (`SectionHeader`, `StatCard`, nouveau `StatusPill`)
- Test: `test/core/widgets.test.tsx` (nouveau)

**Interfaces:**
- Produces: `space`; `Colors.border`; `ListGroup({ children, style?, testID? })`; `LinkButton({ label, onPress, testID? })`; `StatusPill({ label, color, testID? })`. Séparateur de `ListGroup` : `testID="list-divider"`.

- [ ] **Step 1: Write the failing test** — `test/core/widgets.test.tsx`

```tsx
import { fireEvent } from 'expo-router/testing-library';

import { SectionHeader, StatusPill } from '../../src/core/widgets/common';
import { ListGroup, ListRow } from '../../src/core/widgets/kit';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

describe('shared widgets', () => {
  it('ListGroup puts one divider between rows and skips empty children', async () => {
    const show = false;
    const screen = await renderScreen(
      () => (
        <ListGroup>
          <ListRow title="A" />
          {show && <ListRow title="hidden" />}
          {null}
          <ListRow title="B" />
          <ListRow title="C" />
        </ListGroup>
      ),
      new FakeBackend(),
    );
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.queryByText('hidden')).toBeNull();
    expect(screen.getAllByTestId('list-divider')).toHaveLength(2);
  });

  it('SectionHeader renders its action as a link', async () => {
    const onAction = jest.fn();
    const screen = await renderScreen(() => <SectionHeader title="My gym" actionLabel="Gyms" onAction={onAction} />, new FakeBackend());
    fireEvent.press(screen.getByText('Gyms'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('StatusPill shows its label', async () => {
    const screen = await renderScreen(() => <StatusPill label="Accepted" color="#C6F432" />, new FakeBackend());
    expect(screen.getByText('Accepted')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it** — `npx jest test/core/widgets.test.tsx` → FAIL (`ListGroup` / `StatusPill` not exported).

- [ ] **Step 3: Implement**

`src/core/theme/index.ts` — add `border: string;` to `Colors`, `border: '#FFFFFF14'` (dark) and `border: '#0000000F'` (light), and:

```ts
/** Spacing scale: the only gaps/paddings used by shared widgets and polished screens. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
```

`src/core/widgets/kit.tsx`:

```tsx
// Card: hairline border for relief on the dark surface.
const base = [{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.lg, borderWidth: 1, borderColor: colors.border }, style];

// Screen: content starts close to the header title.
const pad = padded ? { padding: space.lg, paddingTop: space.sm } : null;
// contentContainerStyle={[pad, { gap: space.md, paddingBottom: 32 }]}

/** Compact text action (section headers, inline links): no button height. */
export function LinkButton({ label, onPress, testID }: { label: string; onPress?: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} disabled={!onPress} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

/** Rows grouped in one card with hairline dividers (iOS settings style). Empty children are skipped. */
export function ListGroup({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const { colors } = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <Card testID={testID} style={[{ paddingVertical: space.xs, paddingHorizontal: space.sm }, style]}>
      {rows.map((row, i) => (
        <Fragment key={row.key ?? i}>
          {i > 0 && <View testID="list-divider" style={{ height: 1, backgroundColor: colors.border, marginStart: 48 }} />}
          {row}
        </Fragment>
      ))}
    </Card>
  );
}
```

`ListRow` style: `row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 10, paddingHorizontal: 8, minHeight: 48 }`; default icon colour `colors.outline` (`danger` stays `colors.error`). Imports: `Children, Fragment, isValidElement` from `react`; `space` from `../theme`.

`src/core/widgets/common.tsx`:

```tsx
export function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: space.md, paddingHorizontal: space.xs }}>
      <Txt accessibilityRole="header" variant="label" color={colors.outline} style={{ flex: 1, letterSpacing: 1.4 }}>{title}</Txt>
      {actionLabel && <LinkButton label={actionLabel} onPress={onAction} />}
    </View>
  );
}

/** Small tinted status pill (Accepted, Pending…). */
export function StatusPill({ label, color, testID }: { label: string; color: string; testID?: string }) {
  return (
    <View testID={testID} style={{ backgroundColor: color + '24', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Txt variant="small" color={color} style={{ fontSize: 12, fontWeight: '700' }}>{label}</Txt>
    </View>
  );
}
```

`StatCard`: `padding: space.lg`, `borderWidth: 1, borderColor: colors.border`, label row `marginBottom: 6`.

- [ ] **Step 4: Run** — `npx jest test/core/widgets.test.tsx` → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat(mobile): spacing tokens, ListGroup, StatusPill, compact section headers`

### Task 2: En-têtes et démo Objectifs

**Files:**
- Modify: `src/app/(tabs)/_layout.tsx`, `src/features/shell/root.tsx` (`screenOptions`)
- Modify: `assets/demo/api.json`
- Test: `test/core/demo.test.ts`

- [ ] **Step 1: Failing test** — add to `test/core/demo.test.ts`:

```ts
  it('answers the challenge lists (Goals tab) with an empty list', async () => {
    await expect(api().get('/challenges', { status: 'ACTIVE' })).resolves.toEqual([]);
    await expect(api().get('/challenges', { status: 'ENDED' })).resolves.toEqual([]);
  });
```

- [ ] **Step 2: Run** — `npx jest test/core/demo.test.ts` → FAIL (404).
- [ ] **Step 3: Implement** — add `"GET /challenges?status=ACTIVE": []` and `"GET /challenges?status=ENDED": []` to `assets/demo/api.json` (with a JSON-aware script, keeping the file's formatting); add `headerTitleStyle: { fontFamily: fonts.display, fontSize: 26 }` to both `screenOptions`.
- [ ] **Step 4: Run** — test PASS.
- [ ] **Step 5: Commit** — `feat(mobile): display-font headers; demo answers the Goals tab`

### Task 3: Accueil et Profil

**Files:**
- Modify: `src/features/home/screen.tsx` (raccourcis, `Tile`, `ProfileScreen`)
- Modify: `src/core/i18n/{en,fr,ar}.json` (`profileGroupProgress`, `profileGroupSocial`, `profileGroupAccount`)
- Test: `test/screens/account.test.tsx`

- [ ] **Step 1: Failing test** — add to `test/screens/account.test.tsx`:

```tsx
describe('profile', () => {
  it('groups the menu under Progress, Social and Account', async () => {
    const backend = new FakeBackend().on('GET', '/me', [200, me]).on('GET', '/me/records', [200, []]).on('GET', '/gyms/mine', [200, []]);
    const screen = await renderScreen(ProfileScreen, backend);
    expect(await screen.findByText('Progress')).toBeTruthy();
    expect(screen.getByText('Social')).toBeTruthy();
    expect(screen.getByText('Account')).toBeTruthy();
    expect(screen.getByText('Friends')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
  - i18n en `Progress` / `Social` / `Account`; fr `Progression` / `Social` / `Compte`; ar `التقدّم` / `اجتماعي` / `الحساب`.
  - `ProfileScreen`: header block unchanged; gym card stays; then
    `SectionHeader(profileGroupProgress)` + `ListGroup[myProgress, Expander(records), allRecords, badges]`,
    `SectionHeader(profileGroupSocial)` + `ListGroup[friends, battles, competitions]`,
    `SectionHeader(profileGroupAccount)` + `ListGroup[addMyGym, body, settings]`; navigation rows get `chevron`.
  - Raccourcis : tuile `backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingVertical: space.md, paddingHorizontal: space.xs`, libellé `numberOfLines={2}`, `fontSize: 12`, `textAlign: 'center'`.
  - `Tile` (rangs) : `padding: space.md`, `borderWidth: 1, borderColor: colors.border`.
- [ ] **Step 4: Run** — `npx jest test/screens/account.test.tsx` PASS.
- [ ] **Step 5: Commit** — `feat(mobile): grouped profile menu, untruncated home shortcuts`

### Task 4: Entraînement compact

**Files:**
- Modify: `src/features/workouts/screens.tsx` (`WorkoutsScreen`, `WorkoutTile`)
- Test: `test/screens/workouts.test.tsx` (nouveau)

- [ ] **Step 1: Failing test**

```tsx
import { WorkoutsScreen } from '../../src/features/workouts/screens';
import { FakeBackend } from '../fake-api';
import { page, renderScreen, sports } from '../harness';

describe('train tab', () => {
  it('lists workouts with a status pill', async () => {
    const backend = new FakeBackend()
      .on('GET', '/ref/sports', [200, sports])
      .on('GET', '/workouts', [200, page([{ id: 'w1', status: 'ACCEPTED', performedAt: '2026-09-28T10:00:00Z', durationS: 4800, sportId: 'sp-run', totalDistanceM: 5000 }])]);
    const screen = await renderScreen(WorkoutsScreen, backend);
    expect(await screen.findByTestId('workout-w1')).toBeTruthy();
    expect(screen.getByTestId('workout-w1-status')).toBeTruthy();
    expect(screen.getByText('Accepted')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** → FAIL (no `workout-w1-status`).
- [ ] **Step 3: Implement** — `WorkoutsScreen` reads `useSports()` and passes `sportCode` (code of `w.sportId`) to `WorkoutTile`; list `gap: space.sm`, `padding: space.lg`. `WorkoutTile`: `Card` `padding: space.md`; leading 40 px rounded square `colors.surfaceHigh` with `Icon name={sportCode ? sportIcon(sportCode) : 'fitness-center'} color={colors.primary}`; title `Txt variant="title"` date · durée; subtitle; `StatusPill testID={`workout-${id}-status`}`. Held colour `#FFB020` unchanged.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(mobile): compact workout rows with sport icon and status pill`

### Task 5: Passe sur les autres écrans

**Files (modify):** `src/features/{league,challenges,competitions,gyms,gym-wods,battles,social,feed,settings,progress,badges,notifications,leagues,gym-wars,goals,onboarding,auth}/*.tsx`, `src/features/workouts/log-workout.tsx`

Règle par fichier :
1. Suites de 2+ `ListRow` posées sur le fond ou dans une `Card` → `ListGroup`.
2. Statuts en contour (`borderWidth: 1, borderColor: <couleur de statut>` autour d'un texte) → `StatusPill`.
3. `SectionHeader` hors `Screen` : le conteneur parent reçoit `gap: space.md` (sinon le titre colle).
4. Valeurs d'espacement littérales des conteneurs → `space.*` (ne pas toucher aux tailles d'icônes, rayons ou hauteurs fixes).

- [ ] **Step 1** — apply the rule file by file; after each group of files run `npx tsc --noEmit`.
- [ ] **Step 2** — `npx jest` (whole suite) PASS; fix only tests that looked for a moved label.
- [ ] **Step 3: Commit** — `refactor(mobile): screens use spacing tokens, list groups and status pills`

### Task 6: Vérification visuelle, docs, push

- [ ] **Step 1** — restart the web preview (`EXPO_PUBLIC_DEMO=true CI=1 npx expo start --web --port 8081`, CI mode has no reload), run the screenshot script into `after/`, add Competition and Gym screens, compare with `before/`; fix regressions.
- [ ] **Step 2** — copy `before/` and `after/` to `C:\Users\GIGABYTE\Desktop\ui-avant-apres\`.
- [ ] **Step 3** — `npx tsc --noEmit` + `npx jest` green; update `handoff.md` (state, files, checks); commit `docs: handoff for the RN UI polish`; `git push origin main`.
