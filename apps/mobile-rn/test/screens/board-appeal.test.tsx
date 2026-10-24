import { fireEvent, waitFor } from 'expo-router/testing-library';

import { AppealScreen } from '../../src/features/competitions/appeal';
import { CompLeaderboard } from '../../src/features/competitions/screens';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const row = (rank: number, id: string, fullName: string) => ({ rank, athlete: { id, fullName }, totalPoints: 300 - rank, wodPoints: { w1: 100 - rank }, pending: 0 });
const board = { provisional: true, rows: [row(1, 'u1', 'Hédi Kéfi'), row(2, 'me', 'Sami Ben Ali')], workouts: [{ id: 'w1', number: 1 }] };
const cats = [{ id: 'k1', name: 'RX Men', active: true }];

describe('athlete leaderboard (Circle21)', () => {
  it('marks my row, finds me, searches, and says when nobody matches', async () => {
    const backend = new FakeBackend().on('GET', '/competitions/c1/leaderboard', [200, board]).on('GET', '/me', [200, { id: 'me', username: 'sami' }]);
    const screen = await renderScreen(() => <CompLeaderboard id="c1" categories={cats} workouts={[{ id: 'w1', name: 'WOD 1' }]} />, backend);
    expect(await screen.findByText('Unofficial leaderboard')).toBeTruthy();
    expect(await screen.findByText('You')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('board-find-me'));
    expect(screen.queryByTestId('board-row-u1')).toBeNull();
    expect(screen.getByTestId('board-row-me')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('board-search'), 'nobody');
    expect(screen.getByText('Can’t find athlete “nobody” in the RX Men division.')).toBeTruthy();
  });
});

const comp = (appeals: object) => ({ id: 'c1', title: 'Online Qualifier', currency: 'TND', categories: [], workouts: [{ id: 'w1', number: 1, name: 'WOD 1' }], settings: { appeals }, deadlines: {} });
const subs = [{ id: 's1', workout: { id: 'w1' }, status: 'FINAL', points: 87 }];

describe('appeal (Circle21 « Submit appeal »)', () => {
  it('shows the rules, waits for a real reason, and sends it', async () => {
    const backend = new FakeBackend()
      .on('GET', '/competitions/c1', [200, comp({ enabled: true, price: 5000, maxPerAthlete: 2, deadline: new Date(Date.now() + 86_400_000).toISOString() })])
      .on('GET', '/competitions/c1/my-submissions', [200, subs])
      .on('POST', '/competitions/c1/submissions/s1/appeals', [201, { id: 'a1' }]);
    const screen = await renderScreen(() => <AppealScreen id="c1" wodId="w1" />, backend);
    expect(await screen.findByTestId('appeal-score')).toHaveTextContent(/87 pts/);
    expect(screen.getByTestId('appeal-rules')).toHaveTextContent(/TND 5/);
    expect(screen.getByText('2 appeals per athlete.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('appeal-reason'), 'Too short');
    expect(screen.getByTestId('appeal-send').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('appeal-reason'), 'At 4:12 my last three reps were full depth.');
    await fireEvent.press(screen.getByTestId('appeal-send'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c1/submissions/s1/appeals')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c1/submissions/s1/appeals')[0].body).toEqual({ reason: 'At 4:12 my last three reps were full depth.' });
  });

  it('says when the time to appeal has passed', async () => {
    const backend = new FakeBackend().on('GET', '/competitions/c1', [200, comp({ enabled: true, deadline: '2020-01-01T00:00:00Z' })]).on('GET', '/competitions/c1/my-submissions', [200, subs]);
    const screen = await renderScreen(() => <AppealScreen id="c1" wodId="w1" />, backend);
    expect(await screen.findByText('The time to submit an appeal has expired.')).toBeTruthy();
    expect(screen.queryByTestId('appeal-send')).toBeNull();
  });
});
