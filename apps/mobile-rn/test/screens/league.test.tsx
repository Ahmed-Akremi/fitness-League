import { fireEvent, waitFor } from 'expo-router/testing-library';

import { LeaderboardList } from '../../src/features/league/screen';
import { FakeBackend } from '../fake-api';
import { page, renderScreen } from '../harness';

const row = (rank: number, id: string, name: string, lp: number, movement: unknown) => ({
  rank,
  athlete: { id, username: id, fullName: name },
  gym: null,
  governorate: { id: 'g', code: 'TN-51', name: { fr: 'Sousse', en: 'Sousse', ar: 'سوسة' } },
  lp,
  level: 7,
  division: 'BRONZE',
  movement,
});

const board = () =>
  new FakeBackend()
    .on('GET', '/leaderboards/national', (req) =>
      req.query.get('cursor') == null ? [200, page([row(1, 'u1', 'Sami', 88, 3), row(2, 'u2', 'Karim', 66, -1)], 'c2')] : [200, page([row(3, 'u3', 'Nour', 40, 'NEW')])],
    )
    .on('GET', '/leaderboards/national/me', [200, page([row(2, 'u2', 'Karim', 66, -1)])]);

describe('LeaderboardList', () => {
  it('renders ranks, LP and movement, and pages with the cursor', async () => {
    const backend = board();
    const screen = await renderScreen(() => <LeaderboardList scope="national" myId="u2" />, backend);
    expect(await screen.findByText('#1')).toBeTruthy();
    expect(screen.getByText('88 LP')).toBeTruthy();
    expect(screen.getByText('↑3')).toBeTruthy();
    expect(screen.getByText('↓1')).toBeTruthy();

    await fireEvent(screen.getByTestId('leaderboard'), 'onEndReached');
    expect(await screen.findByText('NEW')).toBeTruthy();
    expect(backend.calls('GET', '/leaderboards/national').at(-1)!.query.get('cursor')).toBe('c2');

    await fireEvent.press(screen.getByLabelText('Jump to my rank'));
    await waitFor(() => expect(screen.queryByText('Sami')).toBeNull());
    expect(screen.getByText('Karim')).toBeTruthy();
  });

  it('shows the Arabic texts', async () => {
    const screen = await renderScreen(() => <LeaderboardList scope="national" />, board(), { locale: 'ar' });
    expect((await screen.findAllByText(/سوسة/)).length).toBeGreaterThan(0);
  });
});
