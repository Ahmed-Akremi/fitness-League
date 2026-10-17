import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const heats = [{ id: 'h1', number: 1, name: 'Heat 1', startsAt: '2026-12-12T10:00:00.000Z', durationMin: 12, laneCount: 4, workout: null, category: null, lanes: [] }];
const board = { status: 'REGISTRATION_OPEN', provisional: true, rows: [{ rank: 1, athlete: { id: 'u-r3', fullName: 'Hédi Kéfi', username: 'hedi' }, totalPoints: 180, pending: 0 }] };
// renderRouter installs jest's fake timers: React Query's interval moves with jest.advanceTimersByTime.
const wait = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

describe('live pages: read again every 30 s', () => {
  it('heats are read again every 30 s on the time table, and no more once the page is left', async () => {
    setWide(true);
    const b = orgBackend().on('GET', '/competitions/c9/heats', [200, heats]);
    const screen = await renderScreen(open('timetable'), b);
    await screen.findByTestId('sched-clock');
    const calls = () => b.calls('GET', '/competitions/c9/heats').length;
    const first = calls();
    await wait(30_000);
    await waitFor(() => expect(calls()).toBe(first + 1));
    await fireEvent.press(screen.getByTestId('org-menu-wods'));
    const left = calls();
    await wait(90_000);
    expect(calls()).toBe(left);
  });

  it('phone: Planning, where the clock is, reads the heats again too', async () => {
    setWide(false);
    const b = orgBackend().on('GET', '/competitions/c9/heats', [200, heats]);
    const screen = await renderScreen(open('planning'), b);
    await screen.findByTestId('heat-h1');
    const first = b.calls('GET', '/competitions/c9/heats').length;
    await wait(30_000);
    await waitFor(() => expect(b.calls('GET', '/competitions/c9/heats').length).toBe(first + 1));
  });

  it('the leaderboard is read again every 30 s, and no more once the page is left', async () => {
    setWide(false);
    const b = orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board]);
    const screen = await renderScreen(open('leaderboard'), b);
    await screen.findByText('Hédi Kéfi');
    const calls = () => b.calls('GET', '/competitions/c9/leaderboard').length;
    const first = calls();
    await wait(30_000);
    await waitFor(() => expect(calls()).toBe(first + 1));
    await fireEvent.press(screen.getByTestId('org-tab-team'));
    const left = calls();
    await wait(90_000);
    expect(calls()).toBe(left);
  });
});
