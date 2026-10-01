import { fireEvent, waitFor } from 'expo-router/testing-library';

import { BattleScreen, BattlesScreen, NewBattleScreen } from '../../src/features/battles/screens';
import { LeaguesTab, NewLeagueScreen } from '../../src/features/leagues/screens';
import { FakeBackend } from '../fake-api';
import { page, renderScreen } from '../harness';

const me = { id: 'u1', username: 'ahmed', profile: {} };

const battle = (status: string, extra: object = {}) => ({
  id: 'b1',
  type: 'FRIEND',
  status,
  createdById: 'u2',
  endsAt: '2099-01-01T00:00:00Z',
  components: ['progress', 'consistency'],
  participants: [
    { userId: 'u1', fullName: 'Ahmed', score: 61.5 },
    { userId: 'u2', fullName: 'Karim', score: 48 },
  ],
  ...extra,
});

describe('battle', () => {
  it('shows both live scores and lets the invited friend accept', async () => {
    let current = battle('PENDING');
    const backend = new FakeBackend()
      .on('GET', '/me', [200, me])
      .on('GET', '/battles/b1', () => [200, current])
      .on('POST', '/battles/b1/accept', () => {
        current = battle('ACTIVE');
        return [200, {}];
      });
    const screen = await renderScreen(() => <BattleScreen id="b1" />, backend);
    expect(await screen.findByText('61.5')).toBeTruthy();
    expect(screen.getByText('48.0')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('battle-accept'));
    await waitFor(() => expect(backend.calls('POST', '/battles/b1/accept')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('battle-accept')).toBeNull());
  });

  it('shows the final result', async () => {
    const done = battle('COMPLETED', { participants: [{ userId: 'u1', fullName: 'Ahmed', score: 70, outcome: 'WIN' }, { userId: 'u2', fullName: 'Karim', score: 50, outcome: 'LOSS' }] });
    const backend = new FakeBackend().on('GET', '/me', [200, me]).on('GET', '/battles/b1', [200, done]);
    const screen = await renderScreen(() => <BattleScreen id="b1" />, backend);
    expect(await screen.findByText('You won!')).toBeTruthy();
  });

  it('creates a battle against a friend with a duration (all components = none sent)', async () => {
    const backend = new FakeBackend()
      .on('GET', '/friends', [200, [{ id: 'u2', username: 'karim', fullName: 'Karim' }]])
      .on('POST', '/battles', [201, { id: 'b2' }]);
    const screen = await renderScreen(() => <NewBattleScreen />, backend);
    await fireEvent.press(await screen.findByTestId('opponent-u2'));
    await fireEvent.press(screen.getByTestId('tab-14'));
    await fireEvent.press(screen.getByTestId('battle-send'));
    await waitFor(() => expect(backend.calls('POST', '/battles')[0]?.body).toEqual({ opponentId: 'u2', durationDays: 14 }));
  });
});

describe('weekly duel', () => {
  const hub = (queue: object) =>
    new FakeBackend()
      .on('GET', '/duels/queue', [200, queue])
      .on('GET', '/gym-wars/current', [200, { war: null }])
      .on('GET', '/battles', [200, page([])])
      .on('POST', '/duels/queue', [200, { rating: { rating: 1000, games: 0 }, queueOpen: true, entry: { status: 'WAITING' } }]);

  it('joins the open queue', async () => {
    const backend = hub({ rating: { rating: 1000, games: 0 }, queueOpen: true, entry: null, currentDuel: null });
    const screen = await renderScreen(BattlesScreen, backend);
    await fireEvent.press(await screen.findByTestId('duel-join'));
    await waitFor(() => expect(backend.calls('POST', '/duels/queue')).toHaveLength(1));
    expect(await screen.findByTestId('duel-leave')).toBeTruthy();
  });

  it('says when the queue is closed', async () => {
    const screen = await renderScreen(BattlesScreen, hub({ rating: { rating: 1012, games: 3 }, queueOpen: false, entry: null, currentDuel: null }));
    expect(await screen.findByText('Sign-ups open on Friday')).toBeTruthy();
    expect(screen.getByText('MMR 1012 · 3 duels')).toBeTruthy();
  });
});

describe('leagues', () => {
  it('lists my leagues and joins one with an invite code', async () => {
    const backend = new FakeBackend()
      .on('GET', '/leagues', [200, { mine: [{ id: 'l1', name: 'Box crew', visibility: 'PRIVATE', scoringPreset: 'STANDARD', members: 4, maxMembers: 50, status: 'ACTIVE' }], public: [] }])
      .on('POST', '/leagues/join-by-code', [200, { id: 'l2' }]);
    const screen = await renderScreen(LeaguesTab, backend, { routes: { 'leagues/[id]': () => <></> } });
    expect(await screen.findByText('Box crew')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('league-code'), 'AB12CD');
    await fireEvent.press(screen.getByTestId('league-code-join'));
    await waitFor(() => expect(backend.calls('POST', '/leagues/join-by-code')[0]?.body).toEqual({ code: 'AB12CD' }));
  });

  it('creates a private league ranked on progress', async () => {
    const backend = new FakeBackend().on('POST', '/leagues', [201, { id: 'l3' }]);
    const screen = await renderScreen(NewLeagueScreen, backend, { routes: { 'leagues/[id]': () => <></> } });
    await fireEvent.changeText(screen.getByTestId('league-name'), 'Morning crew');
    await fireEvent.press(screen.getByTestId('tab-PROGRESS'));
    await fireEvent.press(screen.getByTestId('league-create'));
    await waitFor(() => expect(backend.calls('POST', '/leagues')).toHaveLength(1));
    const body = backend.calls('POST', '/leagues')[0].body;
    expect(body).toMatchObject({ name: 'Morning crew', visibility: 'PRIVATE', scoringPreset: 'PROGRESS' });
    expect(new Date(body.endsAt).getTime()).toBeGreaterThan(Date.now() + 55 * 86400_000);
  });
});
