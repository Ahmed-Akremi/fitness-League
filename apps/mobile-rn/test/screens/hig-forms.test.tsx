import { act, fireEvent, waitFor } from 'expo-router/testing-library';
import { AccessibilityInfo } from 'react-native';

import { translate } from '../../src/core/i18n';
import { MemoryOutboxStore } from '../../src/core/offline/outbox';
import { DateField } from '../../src/core/widgets/pickers';
import { Txt, toast } from '../../src/core/widgets/kit';
import { RegisterScreen } from '../../src/features/auth/screens';
import { greetingKey, HomeScreen } from '../../src/features/home/screen';
import { LeaderboardList, LeagueScreen } from '../../src/features/league/screen';
import { NotificationSettingsSection, PreferencesSection, PrivacySection } from '../../src/features/settings/screen';
import { LogWorkoutScreen } from '../../src/features/workouts/log-workout';
import { TrainScreen } from '../../src/features/workouts/screens';
import { FakeBackend } from '../fake-api';
import { page, renderScreen, sports, squat } from '../harness';

const registration = () => new FakeBackend().on('GET', '/ref/governorates', [200, []]);

describe('registration (HIG Entering data)', () => {
  it('asks the system for autofill, including a strong new password', async () => {
    const screen = await renderScreen(RegisterScreen, registration());
    const props = (id: string) => screen.getByTestId(id).props;
    expect([props('reg-username').autoComplete, props('reg-username').textContentType]).toEqual(['username', 'username']);
    expect([props('reg-fullname').autoComplete, props('reg-fullname').textContentType]).toEqual(['name', 'name']);
    expect([props('reg-email').autoComplete, props('reg-email').textContentType]).toEqual(['email', 'emailAddress']);
    expect([props('reg-password').autoComplete, props('reg-password').textContentType]).toEqual(['new-password', 'newPassword']);
  });

  it('checks a field when it loses focus with a value, not while typing, and leaves empty untouched fields alone', async () => {
    const screen = await renderScreen(RegisterScreen, registration());
    await fireEvent.changeText(screen.getByTestId('reg-email'), 'sami');
    expect(screen.queryByText('Invalid email')).toBeNull();
    await fireEvent(screen.getByTestId('reg-email'), 'blur');
    expect(screen.getByText('Invalid email')).toBeTruthy();
    await fireEvent(screen.getByTestId('reg-fullname'), 'blur');
    expect(screen.queryByText('Required')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('reg-email'), 'sami@example.tn');
    expect(screen.queryByText('Invalid email')).toBeNull();
  });

  it('opens the birth date as wheels on iOS; other dates keep the calendar', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <RegisterScreen />
          <DateField testID="other-date" label="Date" value={null} onChange={() => {}} />
        </>
      ),
      registration(),
    );
    await fireEvent.press(screen.getByTestId('reg-dob'));
    expect(screen.getByTestId('reg-dob-picker').props.displayIOS).toBe('spinner');
    await fireEvent.press(screen.getByTestId('other-date'));
    expect(screen.getByTestId('other-date-picker').props.displayIOS).toBe('inline');
  });
});

describe('settings', () => {
  const prefs = () =>
    new FakeBackend()
      .on('GET', '/me/notification-preferences', [200, { categories: {}, quietHours: null }])
      .on('PUT', '/me/notification-preferences', (req) => [200, { categories: {}, ...req.body }]);

  it('quiet hours: a 24-hour time picker for the start, then the end, saved as HH:MM', async () => {
    const backend = prefs();
    const screen = await renderScreen(() => <NotificationSettingsSection />, backend);
    await fireEvent.press(await screen.findByText('Quiet hours'));
    expect(screen.queryByText('HH:MM →')).toBeNull();
    expect(screen.getByText('Start')).toBeTruthy();
    const start = screen.getByTestId('quiet-picker');
    expect([start.props.mode, start.props.locale]).toEqual(['time', 'en_GB']);
    await fireEvent(start, 'onChange', { nativeEvent: { timestamp: new Date(2026, 0, 1, 23, 15).getTime() } });
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(screen.getByText('End')).toBeTruthy();
    await fireEvent(screen.getByTestId('quiet-picker'), 'onChange', { nativeEvent: { timestamp: new Date(2026, 0, 1, 6, 5).getTime() } });
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('PUT', '/me/notification-preferences')).toHaveLength(1));
    expect(backend.calls('PUT', '/me/notification-preferences')[0].body).toEqual({ quietHours: { start: '23:15', end: '06:05' } });
  });

  it('a failed notification save stays on screen under its section', async () => {
    const backend = prefs().on('PUT', '/me/notification-preferences', [500, {}]);
    const screen = await renderScreen(() => <NotificationSettingsSection />, backend);
    await fireEvent(await screen.findByTestId('push-SOCIAL'), 'valueChange', false);
    expect(await screen.findByTestId('notifications-error')).toBeTruthy();
  });

  it('a failed privacy save stays on screen under its section', async () => {
    const backend = new FakeBackend().on('GET', '/me', [200, { id: 'u1', settings: {} }]).on('PATCH', '/me/settings', [500, {}]);
    const screen = await renderScreen(PrivacySection, backend);
    await fireEvent(await screen.findByLabelText('Show my age bracket'), 'valueChange', true);
    expect(await screen.findByTestId('privacy-error')).toBeTruthy();
  });

  it('a failed training-days save stays on screen under its section', async () => {
    const backend = new FakeBackend().on('GET', '/me', [200, { id: 'u1', profile: { plannedTrainingDaysPerWeek: 3 } }]).on('PATCH', '/me/profile', [500, {}]);
    const screen = await renderScreen(PreferencesSection, backend);
    // iOS: the system pop-up menu.
    await fireEvent(await screen.findByTestId('settings-days'), 'selectionChange', { nativeEvent: { selection: '4' } });
    expect(await screen.findByTestId('preferences-error')).toBeTruthy();
  });
});

describe('toasts (HIG: minimise time-boxed elements)', () => {
  it('announce themselves to screen readers', async () => {
    // React Native's jest setup already mocks AccessibilityInfo: read the calls, never restore (that would drop its defaults).
    await renderScreen(() => <Txt>page</Txt>, new FakeBackend());
    await act(async () => toast('Workout saved'));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Workout saved');
  });

  it('stay 10 s while a screen reader is on (3.5 s otherwise)', async () => {
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockReturnValueOnce(Promise.resolve(true));
    const screen = await renderScreen(() => <Txt>page</Txt>, new FakeBackend());
    await act(async () => toast('Saved for later'));
    await act(async () => jest.advanceTimersByTime(4000));
    expect(screen.getByText('Saved for later')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(6100));
    expect(screen.queryByText('Saved for later')).toBeNull();
  });
});

describe('ask before losing typed work', () => {
  const catalog = () =>
    new FakeBackend()
      .on('GET', '/ref/sports', [200, sports])
      .on('GET', '/ref/exercises', [200, [squat]])
      .on('GET', '/me', [200, {}])
      .on('GET', '/workouts', [200, page([])]);

  async function addSquat(screen: Awaited<ReturnType<typeof renderScreen>>) {
    await fireEvent.press(await screen.findByTestId('log-sport'));
    await fireEvent.press(await screen.findByTestId('log-sport-sp-bb'));
    await fireEvent.press(await screen.findByTestId('log-add-exercise'));
    await fireEvent.press(await screen.findByTestId('pick-BACK_SQUAT'));
  }

  it('removing an exercise with entered sets asks first', async () => {
    const screen = await renderScreen(LogWorkoutScreen, catalog());
    await addSquat(screen);
    await fireEvent.changeText(await screen.findByTestId('set-0-reps'), '5');
    await fireEvent.press(screen.getByTestId('exercise-0-remove'));
    expect(screen.getByText('Remove Back squat?')).toBeTruthy();
    expect(screen.getByText('The sets you entered will be lost.')).toBeTruthy();
    expect(screen.getByTestId('exercise-0')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(screen.queryByTestId('exercise-0')).toBeNull());
  });

  it('removing an empty exercise does not ask', async () => {
    const screen = await renderScreen(LogWorkoutScreen, catalog());
    await addSquat(screen);
    await fireEvent.press(await screen.findByTestId('exercise-0-remove'));
    expect(screen.queryByText('Remove Back squat?')).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('exercise-0')).toBeNull());
  });

  it('deleting a workout that was never sent asks first', async () => {
    const backend = new FakeBackend().on('GET', '/workouts', [200, page([])]).on('GET', '/ref/sports', [200, sports]);
    const store = new MemoryOutboxStore();
    await store.put({ clientId: 'c-1', payload: { performedAt: '2026-10-01T08:00:00Z' }, status: 'rejected', attempts: 1, createdAt: '2026-10-01T08:00:00Z' });
    const screen = await renderScreen(TrainScreen, backend, { store });
    await fireEvent.press(await screen.findByTestId('queued-c-1-delete'));
    expect(screen.getByText('Delete this workout?')).toBeTruthy();
    expect(await store.all()).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(async () => expect(await store.all()).toHaveLength(0));
  });
});

describe('empty states offer a next step', () => {
  it('no friends yet: find athletes', async () => {
    const backend = new FakeBackend().on('GET', '/leaderboards/friends', [200, page([])]);
    const screen = await renderScreen(() => <LeaderboardList scope="friends" />, backend, { routes: { search: () => <Txt>search page</Txt> } });
    await fireEvent.press(await screen.findByText('Find athletes'));
    expect(await screen.findByText('search page')).toBeTruthy();
  });

  it('no gym yet: find a gym', async () => {
    const backend = new FakeBackend().on('GET', '/me', [200, { id: 'u1', profile: {} }]).on('GET', '/leaderboards/national', [200, page([])]);
    const screen = await renderScreen(LeagueScreen, backend, { routes: { gyms: () => <Txt>gyms page</Txt> } });
    await fireEvent.press(await screen.findByTestId('tab-gym'));
    await fireEvent.press(await screen.findByText('Find a gym'));
    expect(await screen.findByText('gyms page')).toBeTruthy();
  });
});

describe('writing', () => {
  it('greets by the time of day', () => {
    expect([9, 11, 12, 17, 18, 23].map(greetingKey)).toEqual(['greetingMorning', 'greetingMorning', 'greetingAfternoon', 'greetingAfternoon', 'greetingEvening', 'greetingEvening']);
    expect(translate('en', 'greetingAfternoon', { name: 'Sami' })).toBe('Good afternoon, Sami');
  });

  it('the Goals tab is named Challenges (owner, Q6)', () => {
    expect([translate('en', 'navChallenges'), translate('fr', 'navChallenges'), translate('ar', 'navChallenges')]).toEqual(['Challenges', 'Challenges', 'التحديات']);
  });

  it('the Home « Log workout » button reads like everywhere else, not in capitals', async () => {
    const backend = new FakeBackend()
      .on('GET', '/me', [200, { id: 'u1', username: 'a', emailVerified: true, profile: { fullName: 'Ahmed', onboardingCompleted: true }, stats: {}, streak: {} }])
      .on('GET', '/goals', [200, []])
      .on('GET', '/notifications', [200, { ...page([]), unread: 0 }]);
    const screen = await renderScreen(HomeScreen, backend);
    // Lot 8 moved it into the top bar as « + »: its name is the same words.
    expect((await screen.findByTestId('home-log-workout')).props.accessibilityLabel).toBe('Log workout');
    expect(screen.queryByText('LOG WORKOUT')).toBeNull();
  });
});
