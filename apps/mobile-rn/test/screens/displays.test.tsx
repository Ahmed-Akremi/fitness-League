import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { act, fireEvent, waitFor } from 'expo-router/testing-library';
import { useEffect, useState, type ReactElement } from 'react';

import type { ApiClient } from '../../src/core/api/client';
import { useApi } from '../../src/core/services';
import { palettes } from '../../src/core/theme';
import { DisplayScreen } from '../../src/features/competitions/displays/screens';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

beforeEach(async () => {
  await AsyncStorage.clear();
});

/** Saves local data first, like the organizer tab did before the TV opened the display. */
function Seeded({ seed, children }: { seed: (api: ApiClient) => Promise<unknown>; children: ReactElement }) {
  const api = useApi();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void seed(api).then(() => setReady(true));
  }, [api, seed]);
  return ready ? children : null;
}

const hybridFlow = {
  template: 'CUSTOM',
  timeCapSec: null,
  totalScoring: 'TIME',
  stages: [
    { id: 's1', name: 'Row', kind: 'STATION', scoring: 'TIME', target: 500, unit: 'M' },
    { id: 's2', name: 'Run', kind: 'TRANSITION', scoring: 'NONE', target: 400, unit: 'M' },
  ],
  breaks: [],
  scoringRule: null,
};

describe('displays (phase 9)', () => {
  it('timer: starts from the saved state, follows the organizer, and has a transparent overlay', async () => {
    const seed = (api: ApiClient) => api.post('/competitions/c9/timers', { id: 'c9', config: { type: 'AMRAP', capSec: 720, intervalSec: 60, rounds: 8, workSec: 20, restSec: 10 }, startTimestamp: new Date(Date.now() - 60_000).toISOString(), pausedAt: null, pausedMs: 0 });
    const screen = await renderScreen(() => <Seeded seed={seed}><DisplayScreen id="c9" kind="timer" params={{ overlay: '1' }} /></Seeded>, orgBackend(event));
    expect(await screen.findByTestId('display-clock')).toHaveTextContent('11:00');
    expect(screen.getByTestId('display-status')).toHaveTextContent('Running');
    expect(screen.getByTestId('display-root')).toHaveStyle({ backgroundColor: 'transparent' });
    await act(async () => screen.services.live.publish('timer.c9', 'timer_pause', { config: { type: 'AMRAP', capSec: 720, intervalSec: 60, rounds: 8, workSec: 20, restSec: 10 }, startTimestamp: new Date(Date.now() - 60_000).toISOString(), pausedAt: new Date().toISOString(), pausedMs: 0, seq: 9 }));
    expect(await screen.findByText('Paused')).toBeTruthy();
  });

  it('heat: the lanes from the snapshot, then the judges’ counts in order', async () => {
    const backend = orgBackend(event).on('GET', '/competitions/c9/heats', [200, [{ id: 'h1', number: 1, name: 'Heat 1', startsAt: null, durationMin: 15, workout: { name: 'Fran' }, lanes: [{ lane: 3, athlete: { fullName: 'Sami Ben Ali' } }] }]]);
    const screen = await renderScreen(() => <DisplayScreen id="c9" kind="heat" params={{ heat: 'h1' }} />, backend);
    expect(await screen.findByText('Sami Ben Ali')).toBeTruthy();
    expect(screen.getByTestId('display-root')).toHaveStyle({ backgroundColor: palettes.dark('').background });
    await act(async () => screen.services.live.publish('heat.h1', 'score_update', { lane: 3, reps: 42, seq: 2 }));
    await act(async () => screen.services.live.publish('heat.h1', 'score_update', { lane: 3, reps: 5, seq: 1 }));
    expect(await screen.findByTestId('display-lane-3-value')).toHaveTextContent('42');
  });

  it('race: athletes by progress, updated by each split', async () => {
    let waveId = '';
    const seed = async (api: ApiClient) => {
      const w = await api.post<{ id: string }>('/competitions/c9/waves', { number: 1, name: 'RX · wave 1', categoryId: 'k1', startsAt: new Date().toISOString(), registrationIds: ['r1', 'r2'], athletes: [{ registrationId: 'r1', name: 'Sami Ben Ali' }, { registrationId: 'r2', name: 'Hédi Kéfi' }], liveStart: new Date(Date.now() - 90_000).toISOString() });
      waveId = w.id;
      await api.post('/competitions/c9/race-results', { id: `${w.id}:r1`, waveId: w.id, registrationId: 'r1', splits: [60_000], adjustments: [], dnf: false, finished: false });
    };
    const screen = await renderScreen(() => <Seeded seed={seed}><DisplayScreen id="c9" kind="race" params={{}} /></Seeded>, orgBackend({ ...event, eventStyle: 'HYBRID_RACE', flow: hybridFlow }));
    expect(await screen.findByTestId('display-race-r1')).toHaveTextContent(/1 \/ 2/);
    await act(async () => screen.services.live.publish(`wave.${waveId}`, 'split', { registrationId: 'r2', stageIndex: 0, atMs: 58_000, seq: 3 }));
    await act(async () => screen.services.live.publish(`wave.${waveId}`, 'split', { registrationId: 'r2', stageIndex: 1, atMs: 120_000, seq: 4 }));
    await waitFor(() => expect(screen.getByTestId('display-race-r2')).toHaveTextContent(/2 \/ 2/));
  });

  it('leaderboard: turns through the divisions', async () => {
    const row = (id: string, name: string) => ({ rank: 1, athlete: { id, fullName: name }, totalPoints: 100 });
    const backend = orgBackend(event).on('GET', '/competitions/c9/leaderboard', (req) => [200, { rows: req.query.get('categoryId') === 'k2' ? [row('u2', 'Lina Trabelsi')] : [row('u1', 'Sami Ben Ali')] }]);
    const screen = await renderScreen(() => <DisplayScreen id="c9" kind="leaderboard" params={{ rotate: '10' }} />, backend);
    expect(await screen.findByText('Sami Ben Ali')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(10_500));
    expect(await screen.findByText('Lina Trabelsi')).toBeTruthy();
  });

  it('call screen: shows the call the organizer sends', async () => {
    const screen = await renderScreen(() => <DisplayScreen id="c9" kind="call" params={{}} />, orgBackend(event));
    expect(await screen.findByText('No call right now.')).toBeTruthy();
    await act(async () => screen.services.live.publish('event.c9', 'call_corral', { label: 'Heat 2', seq: 5 }));
    expect(await screen.findByText('Heat 2')).toBeTruthy();
    expect(screen.getByText('To the corral')).toBeTruthy();
  });
});

describe('tools (phase 9)', () => {
  it('lists the displays with their links, overlay included', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="tools" />, orgBackend(event).on('GET', '/competitions/c9/heats', [200, []]));
    expect(await screen.findByTestId('tool-timer')).toBeTruthy();
    expect(screen.getByTestId('tool-url-timer')).toHaveTextContent(/\/display\/c9\/timer$/);
    await fireEvent.press(screen.getByTestId('tool-overlay-timer'));
    expect(screen.getByTestId('tool-url-timer')).toHaveTextContent(/\/display\/c9\/timer\?overlay=1$/);
    await fireEvent.press(screen.getByTestId('tool-copy-timer'));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('/display/c9/timer')));
  });

  it('sends a call from the live page', async () => {
    const backend = orgBackend(event).on('GET', '/competitions/c9/heats', [200, [{ id: 'h1', number: 1, name: 'Heat 1', lanes: [] }]]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="live" />, backend);
    const calls: unknown[] = [];
    screen.services.live.subscribe('event.c9', 'call_warm_up', (p) => calls.push(p));
    await fireEvent.press(await screen.findByTestId('call-target-h1'));
    await fireEvent.press(screen.getByTestId('call-warmup'));
    expect(calls).toEqual([expect.objectContaining({ label: 'Heat 1' })]);
  });
});
