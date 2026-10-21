import { fireEvent } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { useT } from '../../src/core/prefs';
import { divisionLabel, XpBar } from '../../src/core/widgets/common';
import { Txt } from '../../src/core/widgets/kit';
import { DateField, Select } from '../../src/core/widgets/pickers';
import { HomeScreen } from '../../src/features/home/screen';
import { LeaderboardList } from '../../src/features/league/screen';
import { NotificationBell } from '../../src/features/notifications/screens';
import { OnboardingScreen } from '../../src/features/onboarding/screen';
import { LogWorkoutScreen } from '../../src/features/workouts/log-workout';
import { FakeBackend } from '../fake-api';
import { page, renderScreen, sports, squat } from '../harness';

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

const row = (rank: number, id: string, name: string, lp: number, division: string) => ({
  rank,
  athlete: { id, username: id, fullName: name },
  gym: null,
  governorate: null,
  lp,
  level: 7,
  division,
  movement: 0,
});

describe('never by colour alone (HIG Inclusive color)', () => {
  it('each leaderboard row names its division, and my row says « You »', async () => {
    const backend = new FakeBackend().on('GET', '/leaderboards/national', [200, page([row(1, 'u1', 'Sami', 88, 'GOLD'), row(2, 'u2', 'Karim', 66, 'BRONZE')])]);
    const screen = await renderScreen(() => <LeaderboardList scope="national" myId="u2" />, backend);
    expect(await screen.findByText('Gold')).toBeTruthy();
    expect(screen.getByText('Bronze')).toBeTruthy();
    expect(screen.getAllByText('You')).toHaveLength(1);
    expect(screen.getByTestId('rank-u1').props.accessibilityLabel).toBe('#1, Sami, Gold, 88 LP');
    expect(screen.getByTestId('rank-u2').props.accessibilityLabel).toBe('#2, Karim, Bronze, 66 LP, You');
  });

  function Divisions() {
    const t = useT();
    return <Txt>{['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'ELITE', null].map((c) => divisionLabel(t, c)).join('|')}</Txt>;
  }

  it('division names are translated (fr)', async () => {
    const screen = await renderScreen(Divisions, new FakeBackend(), { locale: 'fr' });
    expect(screen.getByText('Bronze|Argent|Or|Platine|Diamant|Élite|—')).toBeTruthy();
  });

  it('division names are translated (ar)', async () => {
    const screen = await renderScreen(Divisions, new FakeBackend(), { locale: 'ar' });
    expect(screen.getByText('برونزي|فضي|ذهبي|بلاتيني|ماسي|النخبة|—')).toBeTruthy();
  });
});

describe('touch targets (44 × 44 pt)', () => {
  it('the warm-up checkbox is 44 pt and its column is labelled', async () => {
    const backend = new FakeBackend()
      .on('GET', '/ref/sports', [200, sports])
      .on('GET', '/ref/exercises', [200, [squat]])
      .on('GET', '/me', [200, {}])
      .on('GET', '/workouts', [200, page([])]);
    const screen = await renderScreen(LogWorkoutScreen, backend);
    await fireEvent.press(await screen.findByTestId('log-sport'));
    await fireEvent.press(await screen.findByTestId('log-sport-sp-bb'));
    await fireEvent.press(await screen.findByTestId('log-add-exercise'));
    await fireEvent.press(await screen.findByTestId('pick-BACK_SQUAT'));
    const box = await screen.findByTestId('set-0-warmup');
    expect(flat(box)).toMatchObject({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' });
    expect(box.props.hitSlop).toBe(10);
    // Visual only: VoiceOver reads the checkbox's own « Warm-up » label.
    expect(screen.getByTestId('warmup-label-0', { includeHiddenElements: true })).toHaveTextContent('Warm-up');
  });
});

describe('screen readers hear every count, state and progress', () => {
  it('the bell reads the unread count', async () => {
    const backend = new FakeBackend().on('GET', '/notifications', [200, { ...page([]), unread: 3 }]);
    const screen = await renderScreen(NotificationBell, backend);
    expect(await screen.findByLabelText('Notifications, 3 unread')).toBeTruthy();
  });

  it('the progress bar is a progress bar', async () => {
    const screen = await renderScreen(() => <XpBar value={0.4} label="Level 7" />, new FakeBackend());
    const bar = screen.getByLabelText('Level 7');
    expect(bar.props.accessible).toBe(true);
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 40 });
  });

  it('onboarding reads its step and which sport is the main one', async () => {
    const backend = new FakeBackend().on('GET', '/ref/sports', [200, sports]);
    const screen = await renderScreen(OnboardingScreen, backend);
    expect(await screen.findByLabelText('Step 1 of 3')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('sport-BODYBUILDING'));
    expect(screen.getByTestId('sport-BODYBUILDING').props.accessibilityLabel).toBe('Bodybuilding, main sport');
    await fireEvent.press(screen.getByTestId('sport-RUNNING'));
    expect(screen.getByTestId('sport-RUNNING').props.accessibilityLabel).toBe('Running');
  });

  it('home tiles are buttons that read their label and value', async () => {
    const backend = new FakeBackend()
      .on('GET', '/me', [200, { id: 'u1', username: 'a', emailVerified: true, profile: { fullName: 'Ahmed', onboardingCompleted: true, governorate: { id: 'g', name: { en: 'Sousse' } }, gym: null }, stats: { level: 7 }, streak: {} }])
      .on('GET', '/me/lp', [200, { lp: 10, division: 'GOLD' }])
      .on('GET', '/me/ranks', [200, { national: 12, governorate: 3 }])
      .on('GET', '/me/weekly-scores/current', [200, { total: 71.6, trainingDays: 2, plannedDays: 3 }])
      .on('GET', '/goals', [200, []])
      .on('GET', '/notifications', [200, { ...page([]), unread: 0 }]);
    const screen = await renderScreen(HomeScreen, backend);
    const national = await screen.findByLabelText('Tunisia, #12');
    expect(national.props.accessibilityRole).toBe('button');
    expect(screen.getByLabelText('Sousse, #3').props.accessibilityRole).toBe('button');
    expect(screen.getByLabelText('This week, 72').props.accessibilityRole).toBeUndefined();
    // The division reads as a word, in the reader's language, not as the API code.
    expect(screen.getByText('Gold')).toBeTruthy();
    expect(screen.queryByText('GOLD')).toBeNull();
  });

  it('the picker’s close button is translated', async () => {
    const screen = await renderScreen(() => <Select testID="pick" label="Sport" value={null} options={[{ value: 'a', label: 'A' }]} onChange={() => {}} />, new FakeBackend(), { locale: 'fr' });
    await fireEvent.press(screen.getByTestId('pick'));
    expect(screen.getByLabelText('Annuler')).toBeTruthy();
    expect(screen.queryByLabelText('close')).toBeNull();
  });

  it('the iOS date picker’s confirm button is translated', async () => {
    const screen = await renderScreen(() => <DateField testID="date" label="Date" value={null} onChange={() => {}} />, new FakeBackend());
    await fireEvent.press(screen.getByTestId('date'));
    expect(screen.getByText('Done')).toBeTruthy();
  });
});
