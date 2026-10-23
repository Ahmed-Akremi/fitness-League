import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { JudgeRaceScreen } from '../../src/features/competitions/judge/race';
import { JudgeLaneScreen } from '../../src/features/competitions/judge/screens';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `client-${++mockUuid}`, getRandomBytes: (n: number) => new Uint8Array(n) }));

beforeEach(async () => {
  await AsyncStorage.clear();
});

/** Set A: 3 burpees (tie-break after it); set B: a 20 m row counted every 10 m. */
const scorecard = {
  sets: [
    { name: 'A', rounds: 1, increment: 0, movements: [{ name: 'Burpees', reps: 3, unit: 'Reps', countEvery: 1 }] },
    { name: 'B', rounds: 1, increment: 0, movements: [{ name: 'Row', reps: 20, unit: 'M', countEvery: 10 }] },
  ],
  tieBreakAfterSet: 1,
};
const chipper = { id: 'w2', number: 2, name: 'Chipper', description: 'Burpees then row', standards: null, timeCapS: null, scoreType: 'REPS', movements: [], scorecard, penalties: { noRepSeconds: 0, missedRepSeconds: 5, minorPct: 0, majorPct: 0 } };
const lanes = () =>
  [
    200,
    {
      serverTime: new Date().toISOString(),
      competition: { id: 'c9', title: 'Sfax Throwdown', locked: false },
      staffId: 's1',
      lanes: [{ heat: { id: 'h1', number: 1, name: 'Heat 1', startsAt: null, durationMin: 15, startedAt: new Date(Date.now() - 30_000).toISOString() }, lane: 3, athlete: { id: 'u-sami', fullName: 'Sami Ben Ali' }, category: { id: 'k1', name: 'RX Men' }, workout: chipper, score: null }],
    },
  ] as [number, unknown];

describe('floor judging from the scorecard (phase 8)', () => {
  it('walks the scorecard, takes the tie-break at the end of set A and publishes each change', async () => {
    const backend = new FakeBackend().on('GET', '/competitions/c9/floor-judging/lanes', lanes).on('PUT', '/competitions/c9/heats/h1/lanes/3/score', [200, { status: 'FINAL' }]);
    const screen = await renderScreen(() => <JudgeLaneScreen id="c9" heatId="h1" />, backend);
    const updates: any[] = [];
    const done: unknown[] = [];
    screen.services.live.subscribe('heat.h1', 'score_update', (p) => updates.push(p));
    screen.services.live.subscribe('heat.h1', 'done', (p) => done.push(p));

    expect(await screen.findByTestId('judge-sc-name')).toHaveTextContent('Burpees');
    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByTestId('judge-sc-plus'));
    expect(screen.getByTestId('judge-sc-name')).toHaveTextContent('Row');
    expect(screen.getByTestId('judge-tiebreak-at')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('judge-sc-plus'));
    expect(screen.getByTestId('judge-sc-progress')).toHaveTextContent('13 / 23');
    expect(updates.at(-1)).toMatchObject({ lane: 3, reps: 13, seq: expect.any(Number) });

    await fireEvent.press(screen.getByTestId('judge-missed'));
    await fireEvent.press(screen.getByTestId('judge-validate'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/heats/h1/lanes/3/score')).toHaveLength(1));
    expect(backend.calls('PUT', '/competitions/c9/heats/h1/lanes/3/score')[0].body.raw).toEqual({ reps: 13, tieBreakS: expect.any(Number) });
    await waitFor(() => expect(done).toHaveLength(1));
    await expect(screen.services.api.get('/competitions/c9/lane-penalties')).resolves.toEqual([expect.objectContaining({ id: 'h1:3', missedReps: 1 })]);
  });
});

const flow = {
  template: 'CUSTOM',
  timeCapSec: null,
  totalScoring: 'TIME',
  stages: [
    { id: 's1', name: 'Row 500 m', kind: 'STATION', scoring: 'TIME', target: 500, unit: 'M' },
    { id: 's2', name: 'Run', kind: 'TRANSITION', scoring: 'NONE', target: 400, unit: 'M' },
  ],
  breaks: [],
  scoringRule: { op: 'ADD', value: 5, unit: 'SEC' },
};

describe('race judging (phase 8)', () => {
  it('records a split per stage, a penalty and the finish, and publishes them', async () => {
    const screen = await renderScreen(() => <JudgeRaceScreen id="c9" />, orgBackend({ ...event, eventStyle: 'HYBRID_RACE', hybridTemplate: 'CUSTOM', flow, workouts: [] }));
    const wave = await screen.services.api.post<{ id: string }>('/competitions/c9/waves', { number: 1, name: 'RX · wave 1', categoryId: 'k1', startsAt: new Date().toISOString(), registrationIds: ['r1'], athletes: [{ registrationId: 'r1', name: 'Sami Ben Ali' }], liveStart: new Date(Date.now() - 60_000).toISOString() });
    const splits: unknown[] = [];
    const done: unknown[] = [];
    screen.services.live.subscribe(`wave.${wave.id}`, 'split', (p) => splits.push(p));
    screen.services.live.subscribe(`wave.${wave.id}`, 'done', (p) => done.push(p));
    // The organizer starts the wave in another tab: the judge's list reloads.
    await act(async () => screen.services.live.publish('event.c9', 'wave_started', { waveId: wave.id }));

    await fireEvent.press(await screen.findByTestId(`race-wave-${wave.id}`));
    await fireEvent.press(await screen.findByTestId('race-ath-r1'));
    expect(await screen.findByTestId('race-current')).toHaveTextContent('Row 500 m');
    await fireEvent.press(screen.getByTestId('race-penalty'));
    await fireEvent.press(screen.getByTestId('race-next'));
    await waitFor(() => expect(screen.getByTestId('race-current')).toHaveTextContent('Run'));
    await fireEvent.press(screen.getByTestId('race-next'));
    expect(await screen.findByTestId('race-finished')).toBeTruthy();

    await waitFor(() => expect(done).toHaveLength(1));
    await expect(screen.services.api.get('/competitions/c9/race-results')).resolves.toEqual([expect.objectContaining({ registrationId: 'r1', finished: true, adjustments: [5] })]);
    expect(splits).toHaveLength(2);
    expect(done).toEqual([expect.objectContaining({ registrationId: 'r1' })]);
  });

  it('sends the judge of a functional-fitness event back to the lanes', async () => {
    const screen = await renderScreen(() => <JudgeRaceScreen id="c9" />, orgBackend(event));
    expect(await screen.findByText('This page is for hybrid races. Change the event type in General.')).toBeTruthy();
  });
});

describe('live control (phase 8)', () => {
  it('starts, pauses and stops the timer, and shows what the judges send', async () => {
    const backend = orgBackend(event).on('GET', '/competitions/c9/heats', [200, [{ id: 'h1', number: 1, name: 'Heat 1', lanes: [] }]]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="live" />, backend);
    const started: any[] = [];
    const paused: unknown[] = [];
    screen.services.live.subscribe('timer.c9', 'timer_start', (p) => started.push(p));
    screen.services.live.subscribe('timer.c9', 'timer_pause', (p) => paused.push(p));

    await fireEvent.press(await screen.findByTestId('timer-type-AMRAP'));
    await fireEvent.changeText(screen.getByTestId('timer-cap'), '12');
    await fireEvent.press(screen.getByTestId('timer-start'));
    expect(started).toEqual([expect.objectContaining({ startTimestamp: expect.any(String), config: expect.objectContaining({ type: 'AMRAP', capSec: 720 }) })]);
    await fireEvent.press(await screen.findByTestId('timer-pause'));
    expect(paused).toHaveLength(1);
    await expect(screen.services.api.get('/competitions/c9/timers')).resolves.toEqual([expect.objectContaining({ id: 'c9', startTimestamp: expect.any(String), pausedAt: expect.any(String) })]);
    await fireEvent.press(await screen.findByTestId('timer-resume'));
    await fireEvent.press(await screen.findByTestId('timer-stop'));
    expect(await screen.findByTestId('timer-start')).toBeTruthy();

    await act(async () => screen.services.live.publish('heat.h1', 'score_update', { lane: 3, reps: 42, seq: 1 }));
    expect(await screen.findByText('Heat 1 · lane 3 · 42 reps')).toBeTruthy();
  });
});
