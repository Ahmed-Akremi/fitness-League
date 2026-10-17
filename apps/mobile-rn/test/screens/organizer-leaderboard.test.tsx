import { fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const board = {
  status: 'REGISTRATION_OPEN',
  provisional: true,
  maximumPoints: 200,
  workouts: [],
  rows: [
    { rank: 1, athlete: { id: 'u-r3', fullName: 'Hédi Kéfi', username: 'hedi' }, wodPoints: {}, totalPoints: 180, pending: 0 },
    { rank: 2, athlete: { id: 'u-r6', fullName: 'Karim Mansour', username: 'karim' }, wodPoints: {}, totalPoints: 150, pending: 1 },
  ],
  podium: null,
  prizes: [],
};
const open = () => <ManageScreen id="c9" initialTab="leaderboard" />;

describe('organizer space: leaderboard', () => {
  it('shows the provisional ranking of a category and who publishes the final one', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board]));
    expect(await screen.findByText('Hédi Kéfi')).toBeTruthy();
    expect(screen.getByText('180 pts')).toBeTruthy();
    expect(screen.getByText('1 to judge')).toBeTruthy();
    expect(screen.getByText('Provisional')).toBeTruthy();
    expect(screen.getByText('The head judge publishes the final leaderboard from the admin panel, once every appeal is settled.')).toBeTruthy();
  });

  it('reads the leaderboard of the category picked', async () => {
    const backend = orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('board-cat-k2'));
    await waitFor(() => expect(backend.calls('GET', '/competitions/c9/leaderboard').map((r) => r.query.get('categoryId'))).toContain('k2'));
    expect(backend.calls('GET', '/competitions/c9/leaderboard')[0].query.get('categoryId')).toBe('k1');
  });

  it('says when nobody has a score yet', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/leaderboard', [200, { ...board, rows: [] }]));
    expect(await screen.findByText('No score in this category yet.')).toBeTruthy();
  });
});
