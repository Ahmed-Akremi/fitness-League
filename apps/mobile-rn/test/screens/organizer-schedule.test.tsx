import { act, fireEvent, within } from 'expo-router/testing-library';

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
const heat = (id: string, startsAt: string | null, extra: object = {}) => ({ id, number: 1, name: `Heat ${id.toUpperCase()}`, startsAt, durationMin: 12, laneCount: 4, workout: null, category: null, lanes: [], ...extra });
// As in the lot B clock test, at 09:05: A has ended, B is running, C and E have not started, D has no time.
const day = [heat('a', '2026-12-12T08:00:00.000Z'), heat('b', '2026-12-12T09:00:00.000Z'), heat('c', '2026-12-12T10:00:00.000Z'), heat('e', '2026-12-12T11:00:00.000Z'), heat('d', null)];
const withHeats = (list: object[]) => orgBackend().on('GET', '/competitions/c9/heats', [200, list]);

describe('time table on a computer', () => {
  beforeEach(() => {
    setWide(true);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-12T09:05:00Z'));
  });
  afterEach(() => jest.restoreAllMocks());

  it('Planning has three entries; Heats no longer shows the clock card', async () => {
    const screen = await renderScreen(open('planning'), withHeats(day));
    expect(await screen.findByTestId('heat-b')).toBeTruthy();
    expect(screen.queryByTestId('timetable')).toBeNull();
    for (const tab of ['wods', 'planning', 'timetable']) expect(screen.getByTestId(`org-menu-${tab}`)).toBeTruthy();
    expect(within(screen.getByTestId('org-menu')).getByText('Time table')).toBeTruthy();
  });

  it('the clock, the heat running and the progress of the day, then the day’s heats with their state', async () => {
    const screen = await renderScreen(open('timetable'), withHeats(day));
    expect((await screen.findByTestId('sched-clock')).props.children).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(screen.getByText(/^Program ends at /)).toBeTruthy();
    expect(within(screen.getByTestId('sched-current')).getByText('Heat B')).toBeTruthy();
    expect(screen.getByTestId('sched-progress').props.accessibilityLabel).toBe('1 of 4 heats done · 3 left');
    expect(within(screen.getByTestId('sched-heat-a')).getByText('Done')).toBeTruthy();
    expect(within(screen.getByTestId('sched-heat-b')).getByText('Running')).toBeTruthy();
    expect(within(screen.getByTestId('sched-heat-c')).getByText('Upcoming')).toBeTruthy();
    expect(screen.queryByTestId('sched-heat-d')).toBeNull();
  });

  it('the list follows the day « Delay » would move', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-12T20:00:00Z'));
    const next = [heat('f', '2026-12-13T09:00:00.000Z'), heat('g', '2026-12-13T09:30:00.000Z')];
    const screen = await renderScreen(open('timetable'), withHeats([...day, ...next]));
    expect(await screen.findByTestId('sched-heat-f')).toBeTruthy();
    expect(screen.getByTestId('sched-heat-g')).toBeTruthy();
    expect(screen.queryByTestId('sched-heat-a')).toBeNull();
    expect(within(screen.getByTestId('sched-current')).getByText('No active heat')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('delay'));
    expect(screen.getByText(/^Move the 2 heats of /)).toBeTruthy();
  });

  it('category, WOD and search narrow the list; the cards keep the whole day', async () => {
    const two = [
      heat('a', '2026-12-12T08:00:00.000Z', { category: { id: 'k1', name: 'RX Men' } }),
      heat('b', '2026-12-12T09:00:00.000Z', { category: { id: 'k2', name: 'RX Women' }, lanes: [{ lane: 1, registrationId: 'r2', athlete: { fullName: 'Amira Trabelsi', username: 'amira' } }] }),
    ];
    const screen = await renderScreen(open('timetable'), withHeats(two));
    await fireEvent.press(await screen.findByTestId('sched-cat'));
    await fireEvent.press(screen.getByTestId('sched-cat-k1'));
    expect(screen.getByTestId('sched-heat-a')).toBeTruthy();
    expect(screen.queryByTestId('sched-heat-b')).toBeNull();
    expect(screen.getByTestId('sched-progress').props.accessibilityLabel).toBe('1 of 2 heats done · 1 left');
    await fireEvent.press(screen.getByTestId('sched-cat'));
    await fireEvent.press(screen.getByTestId('sched-cat-'));
    await fireEvent.changeText(screen.getByTestId('sched-search'), 'amira');
    expect(screen.getByTestId('sched-heat-b')).toBeTruthy();
    expect(screen.queryByTestId('sched-heat-a')).toBeNull();
  });

  it('no heat with a start time: a card leads to Heats', async () => {
    const screen = await renderScreen(open('timetable'), withHeats([heat('d', null)]));
    await fireEvent.press(await screen.findByTestId('guide-heats-go'));
    expect(await screen.findByTestId('heat-new')).toBeTruthy();
    expect(screen.getByTestId('org-menu-planning').props.accessibilityState?.selected).toBe(true);
  });

  it('the clock ticks every second only while this page is open', async () => {
    const screen = await renderScreen(open('planning'), withHeats(day));
    await screen.findByTestId('heat-b');
    // After the first render: renderRouter installs jest's fake timers, which would replace an earlier spy.
    const every = jest.spyOn(global, 'setInterval');
    const stop = jest.spyOn(global, 'clearInterval');
    await fireEvent.press(screen.getByTestId('org-menu-timetable'));
    await screen.findByTestId('sched-clock');
    const i = every.mock.calls.findIndex(([, ms]) => ms === 1000);
    expect(i).toBeGreaterThanOrEqual(0);
    const id = every.mock.results[i].value;
    await fireEvent.press(screen.getByTestId('org-menu-wods'));
    expect(stop).toHaveBeenCalledWith(id);
    every.mockClear();
    await fireEvent.press(screen.getByTestId('org-menu-planning'));
    await screen.findByTestId('heat-b');
    expect(every.mock.calls.some(([, ms]) => ms === 1000)).toBe(false);
  });

  it('a narrow window shows Heats, with the phone’s clock card, instead of the time table', async () => {
    const screen = await renderScreen(open('timetable'), withHeats(day));
    expect(await screen.findByTestId('sched-clock')).toBeTruthy();
    await act(async () => setWide(false));
    expect(await screen.findByTestId('timetable')).toBeTruthy();
    expect(screen.getByTestId('org-tab-planning').props.accessibilityState?.selected).toBe(true);
    expect(screen.queryByTestId('sched-clock')).toBeNull();
  });
});
