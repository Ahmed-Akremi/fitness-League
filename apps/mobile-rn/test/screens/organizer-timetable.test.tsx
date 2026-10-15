import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const heat = (id: string, startsAt: string | null) => ({ id, number: 1, name: `Heat ${id.toUpperCase()}`, startsAt, durationMin: 12, laneCount: 4, workout: null, category: null, lanes: [] });
// At 09:05: A has ended, B is running, C and E have not started, D has no time.
const day = [heat('a', '2026-12-12T08:00:00.000Z'), heat('b', '2026-12-12T09:00:00.000Z'), heat('c', '2026-12-12T10:00:00.000Z'), heat('e', '2026-12-12T11:00:00.000Z'), heat('d', null)];
const open = () => <ManageScreen id="c9" initialTab="planning" />;

async function delayBy(screen: Awaited<ReturnType<typeof renderScreen>>, minutes: string) {
  await fireEvent.press(await screen.findByTestId('delay'));
  await fireEvent.changeText(screen.getByTestId('delay-minutes'), minutes);
  // A double tap on « Move » still moves each heat once.
  await act(async () => {
    fireEvent.press(screen.getByTestId('dialog-confirm'));
    fireEvent.press(screen.getByTestId('dialog-confirm'));
  });
}

describe('organizer space: clock and delay', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-12T09:05:00Z')));
  afterEach(() => jest.restoreAllMocks());

  it('shows the heat running, the next one and how many are done', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/heats', [200, day]));
    expect(await screen.findByText('Now: Heat B')).toBeTruthy();
    expect(screen.getByText(/^Next: Heat C at /)).toBeTruthy();
    expect(screen.getByText('1 of 4 heats done')).toBeTruthy();
  });

  it('« Delay » moves only the heats not started yet, then posts one announcement', async () => {
    const backend = orgBackend()
      .on('GET', '/competitions/c9/heats', [200, day])
      .on('PUT', '/competitions/c9/heats/c', [200, {}])
      .on('PUT', '/competitions/c9/heats/e', [200, {}])
      .on('POST', '/competitions/c9/announcements', [201, {}]);
    const screen = await renderScreen(open, backend);
    await delayBy(screen, '15');
    expect(await screen.findByText('2 heats moved by 15 min, announcement posted.')).toBeTruthy();
    expect(backend.calls('PUT', '/competitions/c9/heats/c').map((r) => r.body)).toEqual([{ startsAt: '2026-12-12T10:15:00.000Z' }]);
    expect(backend.calls('PUT', '/competitions/c9/heats/e').map((r) => r.body)).toEqual([{ startsAt: '2026-12-12T11:15:00.000Z' }]);
    for (const id of ['a', 'b', 'd']) expect(backend.calls('PUT', `/competitions/c9/heats/${id}`)).toHaveLength(0);
    expect(backend.calls('POST', '/competitions/c9/announcements').map((r) => r.body)).toEqual([{ title: 'Schedule moved by 15 min', body: 'Every heat of Saturday, December 12 that has not started yet starts 15 minutes later.' }]);
  });

  it('lists the heats that did not move and retries only those; the announcement waits for all', async () => {
    let tries = 0;
    const backend = orgBackend()
      .on('GET', '/competitions/c9/heats', [200, day])
      .on('PUT', '/competitions/c9/heats/c', () => (++tries === 1 ? [500, { code: 'INTERNAL', status: 500 }] : [200, {}]))
      .on('PUT', '/competitions/c9/heats/e', [200, {}])
      .on('POST', '/competitions/c9/announcements', [201, {}]);
    const screen = await renderScreen(open, backend);
    await delayBy(screen, '15');
    expect(await screen.findByText('Not moved: Heat C.')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c9/announcements')).toHaveLength(0);
    // « Delay » again would move E a second time: only « Retry » is offered.
    expect(screen.getByTestId('delay').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('delay-retry'));
    expect(await screen.findByText('2 heats moved by 15 min, announcement posted.')).toBeTruthy();
    expect(backend.calls('PUT', '/competitions/c9/heats/c').map((r) => r.body)).toEqual([{ startsAt: '2026-12-12T10:15:00.000Z' }, { startsAt: '2026-12-12T10:15:00.000Z' }]);
    expect(backend.calls('PUT', '/competitions/c9/heats/e')).toHaveLength(1);
    expect(backend.calls('POST', '/competitions/c9/announcements')).toHaveLength(1);
  });

  it('the announcement failed after every heat moved: it is posted alone, the heats never move twice', async () => {
    let posts = 0;
    const backend = orgBackend()
      .on('GET', '/competitions/c9/heats', [200, day])
      .on('PUT', '/competitions/c9/heats/c', [200, {}])
      .on('PUT', '/competitions/c9/heats/e', [200, {}])
      .on('POST', '/competitions/c9/announcements', () => (++posts === 1 ? [500, { code: 'INTERNAL', status: 500 }] : [201, {}]));
    const screen = await renderScreen(open, backend);
    await delayBy(screen, '15');
    expect(await screen.findByText('2 heats moved by 15 min, but the announcement was not posted.')).toBeTruthy();
    expect(screen.getByTestId('delay').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('delay-announce'));
    expect(await screen.findByText('2 heats moved by 15 min, announcement posted.')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c9/announcements')).toHaveLength(2);
    expect(backend.calls('PUT', '/competitions/c9/heats/c')).toHaveLength(1);
    expect(backend.calls('PUT', '/competitions/c9/heats/e')).toHaveLength(1);
  });

  it('moves the heats from their latest start times, read again before the delay', async () => {
    // A co-organizer already moved C and E by 20 minutes from another phone.
    const moved = day.map((h) => (h.id === 'c' ? { ...h, startsAt: '2026-12-12T10:20:00.000Z' } : h.id === 'e' ? { ...h, startsAt: '2026-12-12T11:20:00.000Z' } : h));
    let reads = 0;
    const backend = orgBackend()
      .on('GET', '/competitions/c9/heats', () => [200, ++reads === 1 ? day : moved])
      .on('PUT', '/competitions/c9/heats/c', [200, {}])
      .on('PUT', '/competitions/c9/heats/e', [200, {}])
      .on('POST', '/competitions/c9/announcements', [201, {}]);
    const screen = await renderScreen(open, backend);
    await delayBy(screen, '15');
    expect(await screen.findByText('2 heats moved by 15 min, announcement posted.')).toBeTruthy();
    expect(backend.calls('PUT', '/competitions/c9/heats/c').map((r) => r.body)).toEqual([{ startsAt: '2026-12-12T10:35:00.000Z' }]);
    expect(backend.calls('PUT', '/competitions/c9/heats/e').map((r) => r.body)).toEqual([{ startsAt: '2026-12-12T11:35:00.000Z' }]);
  });

  it('refuses a delay that is not 1 to 600 minutes', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/heats', [200, day]));
    await fireEvent.press(await screen.findByTestId('delay'));
    await fireEvent.changeText(screen.getByTestId('delay-minutes'), '0');
    expect(screen.getByTestId('dialog-confirm').props.accessibilityState?.disabled).toBe(true);
  });
});
