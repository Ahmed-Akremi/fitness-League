import { fireEvent, waitFor } from 'expo-router/testing-library';

import { BadgesScreen } from '../../src/features/badges/screen';
import { ChallengeScreen } from '../../src/features/challenges/screens';
import { HomeScreen } from '../../src/features/home/screen';
import { NotificationsScreen } from '../../src/features/notifications/screens';
import { BodyScreen } from '../../src/features/progress/screens';
import { PrivacySection } from '../../src/features/settings/screen';
import { ProofsSection } from '../../src/features/workouts/proofs';
import { FakeBackend } from '../fake-api';
import { page, renderScreen } from '../harness';

const me = {
  id: 'u1',
  username: 'ahmed',
  emailVerified: true,
  profile: { fullName: 'Ahmed Akremi', onboardingCompleted: true, governorate: { id: 'g', name: { en: 'Sousse' } }, gym: null },
  stats: { level: 7, xpIntoLevel: 40, xpForNextLevel: 100, division: 'SILVER' },
  streak: { currentWeeks: 3 },
  settings: { defaultVisibility: 'FRIENDS', showAgeBracket: false, showOnLeaderboards: true },
};

describe('home', () => {
  it('shows the hero LP, the streak and the unread bell', async () => {
    const backend = new FakeBackend()
      .on('GET', '/me', [200, me])
      .on('GET', '/me/lp', [200, { lp: 1234, division: 'GOLD' }])
      .on('GET', '/me/ranks', [200, { national: 12, governorate: 3 }])
      .on('GET', '/me/weekly-scores/current', [200, { total: 71.6, trainingDays: 2, plannedDays: 3 }])
      .on('GET', '/goals', [200, []])
      .on('GET', '/notifications', [200, { ...page([]), unread: 4 }]);
    const screen = await renderScreen(HomeScreen, backend);
    expect(await screen.findByText('1234')).toBeTruthy();
    expect(await screen.findByText('#12')).toBeTruthy();
    expect(screen.getByText('72')).toBeTruthy();
    expect(screen.getByText('2/3')).toBeTruthy();
    expect(screen.getByText('3-week streak')).toBeTruthy();
    expect(await screen.findByText('4')).toBeTruthy();
  });
});

describe('settings', () => {
  it('toggles privacy options through PATCH /me/settings', async () => {
    const backend = new FakeBackend().on('GET', '/me', [200, me]).on('PATCH', '/me/settings', [200, {}]);
    const screen = await renderScreen(PrivacySection, backend);
    const toggle = await screen.findByLabelText('Show my age bracket');
    await fireEvent(toggle, 'valueChange', true);
    await waitFor(() => expect(backend.calls('PATCH', '/me/settings')).toHaveLength(1));
    expect(backend.calls('PATCH', '/me/settings')[0].body).toEqual({ showAgeBracket: true });
  });
});

describe('badges', () => {
  it('counts the earned badges and shows progress on locked ones', async () => {
    const backend = new FakeBackend().on('GET', '/badges', [
      200,
      [
        { id: 'b1', category: 'PROGRESS', icon: 'trophy', rarity: 'RARE', name: { en: 'First PR' }, description: { en: 'Beat a record' }, awardedAt: '2026-09-01T00:00:00Z' },
        { id: 'b2', category: 'CONSISTENCY', icon: 'flame', rarity: 'COMMON', name: { en: 'Streak 4' }, description: { en: '4 weeks' }, awardedAt: null, progress: { current: 2, target: 4 } },
      ],
    ]);
    const screen = await renderScreen(BadgesScreen, backend);
    expect(await screen.findByText('1 of 2 earned')).toBeTruthy();
    expect(screen.getByText('2/4')).toBeTruthy();
  });
});

describe('notifications', () => {
  it('lists readable texts and marks a notification read when opened', async () => {
    const backend = new FakeBackend()
      .on('GET', '/notifications', [200, { ...page([{ id: 'n1', type: 'BADGE_AWARDED', read: false, createdAt: '2026-09-30T10:00:00Z', payload: { name: { en: 'Iron' } } }]), unread: 1 }])
      .on('POST', '/notifications/read', [204, undefined]);
    const screen = await renderScreen(NotificationsScreen, backend);
    expect(await screen.findByText('New badge: Iron')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('notification-n1'));
    await waitFor(() => expect(backend.calls('POST', '/notifications/read')[0]?.body).toEqual({ ids: ['n1'] }));
  });
});

describe('challenges', () => {
  it('joins a community challenge and sees the leaderboard', async () => {
    let joined = false;
    const challenge = () => ({
      id: 'c1',
      title: 'October 20',
      scope: 'COMMUNITY',
      metric: 'WORKOUTS',
      target: 20,
      status: 'ACTIVE',
      endsAt: '2099-01-01T00:00:00Z',
      joined,
      myProgress: joined ? 0 : null,
      xpReward: 50,
      participants: 1,
      leaderboard: [{ rank: 1, userId: 'u2', fullName: 'Sami', progress: 12, completed: false }],
    });
    const backend = new FakeBackend()
      .on('GET', '/me', [200, me])
      .on('GET', '/challenges/c1', () => [200, challenge()])
      .on('POST', '/challenges/c1/join', () => {
        joined = true;
        return [200, {}];
      });
    const screen = await renderScreen(() => <ChallengeScreen id="c1" />, backend);
    expect(await screen.findByText('Sami')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('challenge-join'));
    await waitFor(() => expect(backend.calls('POST', '/challenges/c1/join')).toHaveLength(1));
    expect(await screen.findByTestId('challenge-leave')).toBeTruthy();
  });
});

describe('body and proofs', () => {
  it('adds a weigh-in', async () => {
    const backend = new FakeBackend().on('GET', '/me/body-measurements', [200, []]).on('POST', '/me/body-measurements', [201, {}]);
    const screen = await renderScreen(BodyScreen, backend);
    await fireEvent.press(await screen.findByTestId('body-add'));
    await fireEvent.changeText(await screen.findByTestId('weight-input'), '81,5');
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('POST', '/me/body-measurements')[0]?.body).toEqual({ weightKg: 81.5 }));
  });

  it('explains proofs when there are none', async () => {
    const backend = new FakeBackend().on('GET', '/workouts/w1/proofs', [200, { status: 'NONE', proofs: [] }]);
    const screen = await renderScreen(() => <ProofsSection workoutId="w1" />, backend);
    expect(await screen.findByText(/Add a photo or a screenshot/)).toBeTruthy();
  });
});
