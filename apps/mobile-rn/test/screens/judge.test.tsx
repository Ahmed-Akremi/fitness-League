import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { pendingScores } from '../../src/features/competitions/judge/api';
import { FloorJudgeCard, JudgeHomeScreen, JudgeLaneScreen } from '../../src/features/competitions/judge/screens';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

// Each validation gets its own idempotency key.
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `client-${++mockUuid}` }));

/** Floor judging (spec 2026-10-21): the invited user, the judge's lanes and the scoring screen. */
const fran = { id: 'w1', number: 1, name: 'Fran', description: '21-15-9 thrusters, pull-ups', standards: null, timeCapS: 600, scoreType: 'TIME', scoringMethod: 'PLACEMENT_POINTS', maximumPoints: 100, movements: [] };
const cindy = { ...fran, id: 'w2', number: 2, name: 'Cindy', timeCapS: null, scoreType: 'REPS' };
const lane = (heatId: string, workout: object, over: object = {}) => ({
  heat: { id: heatId, number: 1, name: `Heat ${heatId}`, startsAt: '2026-12-12T09:00:00.000Z', durationMin: 15, startedAt: null },
  lane: 3,
  athlete: { id: 'u-sami', fullName: 'Sami Ben Ali', username: 'sami_rx' },
  category: { id: 'k1', name: 'RX Men' },
  workout,
  score: null,
  ...over,
});
const lanesOf = (lanes: object[], over: object = {}) => () => [200, { serverTime: new Date().toISOString(), competition: { id: 'c9', title: 'Sfax Throwdown', locked: false }, staffId: 's1', lanes, ...over }] as [number, unknown];

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('floor judging: the invitation', () => {
  const c = { id: 'c9', title: 'Sfax Throwdown', myFloorJudge: { staffId: 's1', acceptedAt: null } };

  it('accepts the invitation', async () => {
    const backend = new FakeBackend().on('POST', '/competitions/c9/floor-judging/accept', [200, { staffId: 's1', acceptedAt: '2026-10-21T10:00:00Z' }]);
    const screen = await renderScreen(() => <FloorJudgeCard c={c} />, backend);
    expect(screen.getByText('Judge invitation')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('floor-accept'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/floor-judging/accept')).toHaveLength(1));
  });

  it('declines only after confirmation', async () => {
    const backend = new FakeBackend().on('POST', '/competitions/c9/floor-judging/decline', [204, undefined]);
    const screen = await renderScreen(() => <FloorJudgeCard c={c} />, backend);
    await fireEvent.press(screen.getByTestId('floor-decline'));
    expect(backend.calls('POST', '/competitions/c9/floor-judging/decline')).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/floor-judging/decline')).toHaveLength(1));
  });

  it('once accepted, opens the judge space', async () => {
    const screen = await renderScreen(() => <FloorJudgeCard c={{ ...c, myFloorJudge: { staffId: 's1', acceptedAt: '2026-10-21T10:00:00Z' } }} />, new FakeBackend());
    expect(screen.getByText('You are a judge of this event.')).toBeTruthy();
    expect(screen.getByTestId('floor-open')).toBeTruthy();
  });

  it('shows nothing to someone who is not invited', async () => {
    const screen = await renderScreen(() => <FloorJudgeCard c={{ id: 'c9', myFloorJudge: null }} />, new FakeBackend());
    expect(screen.queryByTestId('floor-invitation')).toBeNull();
  });
});

describe('floor judging: my lanes', () => {
  it('lists each heat with the athlete, the WOD and whether the score is sent', async () => {
    const backend = new FakeBackend().on('GET', '/competitions/c9/floor-judging/lanes', lanesOf([lane('h2', cindy, { score: { status: 'FINAL', raw: { reps: 400 } } }), lane('h1', fran)]));
    const screen = await renderScreen(() => <JudgeHomeScreen id="c9" />, backend);
    expect(await screen.findByTestId('judge-lane-h1')).toBeTruthy();
    expect(screen.getAllByText('Sami Ben Ali')).toHaveLength(2);
    expect(screen.getByText('To judge')).toBeTruthy();
    expect(screen.getByText('Sent')).toBeTruthy();
  });

  it('says when the organizer has not placed the judge yet', async () => {
    const backend = new FakeBackend().on('GET', '/competitions/c9/floor-judging/lanes', lanesOf([]));
    const screen = await renderScreen(() => <JudgeHomeScreen id="c9" />, backend);
    expect(await screen.findByText('No athlete to judge yet. The organizer puts you on a lane for each heat.')).toBeTruthy();
  });
});

describe('floor judging: the scoring screen', () => {
  it('starts the heat when nobody has', async () => {
    const backend = new FakeBackend()
      .on('GET', '/competitions/c9/floor-judging/lanes', lanesOf([lane('h1', fran)]))
      .on('POST', '/competitions/c9/heats/h1/start', [200, { startedAt: new Date().toISOString() }]);
    const screen = await renderScreen(() => <JudgeLaneScreen id="c9" heatId="h1" />, backend);
    expect(await screen.findByText('The heat has not started.')).toBeTruthy();
    expect(screen.getByTestId('judge-finish')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('judge-start'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/heats/h1/start')).toHaveLength(1));
  });

  it('For Time: « DONE » stops the athlete at the heat clock, the athlete confirms, the time is sent', async () => {
    // The heat started 4 min 5.5 s ago on the server's clock.
    const started = () => new Date(Date.now() - 245_500).toISOString();
    const backend = new FakeBackend()
      .on('GET', '/competitions/c9/floor-judging/lanes', () => lanesOf([lane('h1', fran, { heat: { ...lane('h1', fran).heat, startedAt: started() } })])())
      .on('PUT', '/competitions/c9/heats/h1/lanes/3/score', [200, { status: 'FINAL' }]);
    const screen = await renderScreen(() => <JudgeLaneScreen id="c9" heatId="h1" />, backend);
    expect(await screen.findByTestId('judge-clock-time')).toBeTruthy();
    expect(screen.getByTestId('judge-validate')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('judge-tiebreak'));
    await fireEvent.press(screen.getByTestId('judge-finish'));
    await fireEvent.press(screen.getByTestId('judge-norep'));
    await fireEvent.press(screen.getByTestId('judge-validate'));
    // The athlete sees their name and the score before confirming.
    expect(screen.getByText('Hand the phone to Sami Ben Ali. Score: 4:05.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/heats/h1/lanes/3/score')).toHaveLength(1));
    const body = backend.calls('PUT', '/competitions/c9/heats/h1/lanes/3/score')[0].body;
    expect(body).toMatchObject({ raw: { timeS: 245, tieBreakS: 245, noReps: 1 }, athleteConfirmed: true });
    expect(body.clientId).toMatch(/^client-/);
    expect(await screen.findByTestId('judge-sent')).toBeTruthy();
  });

  it('For Time past the cap: the screen counts the reps done instead', async () => {
    const started = () => new Date(Date.now() - 601_000).toISOString();
    const backend = new FakeBackend()
      .on('GET', '/competitions/c9/floor-judging/lanes', () => lanesOf([lane('h1', fran, { heat: { ...lane('h1', fran).heat, startedAt: started() } })])())
      .on('PUT', '/competitions/c9/heats/h1/lanes/3/score', [200, { status: 'FINAL' }]);
    const screen = await renderScreen(() => <JudgeLaneScreen id="c9" heatId="h1" />, backend);
    expect(await screen.findByTestId('judge-capped')).toBeTruthy();
    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByTestId('judge-reps-plus'));
    expect(screen.getByTestId('judge-reps-value')).toHaveTextContent('3');
    await fireEvent.press(screen.getByTestId('judge-validate'));
    expect(screen.getByText('Hand the phone to Sami Ben Ali. Score: CAP + 3 reps.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/heats/h1/lanes/3/score')[0]?.body.raw).toEqual({ capped: true, reps: 3 }));
  });

  it('For Time: a finish on the buzzer is typed after switching the cap off, and typing keeps the field', async () => {
    const started = () => new Date(Date.now() - 601_000).toISOString();
    const backend = new FakeBackend()
      .on('GET', '/competitions/c9/floor-judging/lanes', () => lanesOf([lane('h1', fran, { heat: { ...lane('h1', fran).heat, startedAt: started() } })])())
      .on('PUT', '/competitions/c9/heats/h1/lanes/3/score', [200, { status: 'FINAL' }]);
    const screen = await renderScreen(() => <JudgeLaneScreen id="c9" heatId="h1" />, backend);
    expect(await screen.findByTestId('judge-capped')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('judge-capped-toggle'));
    // The cap is not switched on again by the clock (the effect runs right after the press).
    expect(screen.queryByTestId('judge-capped')).toBeNull();
    const field = screen.getByTestId('judge-time');
    await fireEvent.changeText(field, '9:5');
    await fireEvent.changeText(screen.getByTestId('judge-time'), '9:59');
    expect(screen.getByTestId('judge-time')).toBe(field);
    await fireEvent.press(screen.getByTestId('judge-validate'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/heats/h1/lanes/3/score')[0]?.body.raw).toEqual({ timeS: 599 }));
  });

  it('AMRAP: + counts each rep, − corrects, never under zero', async () => {
    const backend = new FakeBackend()
      .on('GET', '/competitions/c9/floor-judging/lanes', lanesOf([lane('h2', cindy)]))
      .on('PUT', '/competitions/c9/heats/h2/lanes/3/score', [200, { status: 'FINAL' }]);
    const screen = await renderScreen(() => <JudgeLaneScreen id="c9" heatId="h2" />, backend);
    expect(await screen.findByTestId('judge-reps-value')).toHaveTextContent('0');
    expect(screen.getByTestId('judge-reps-minus')).toBeDisabled();
    for (let i = 0; i < 4; i++) await fireEvent.press(screen.getByTestId('judge-reps-plus'));
    await fireEvent.press(screen.getByTestId('judge-reps-minus'));
    expect(screen.getByTestId('judge-reps-value')).toHaveTextContent('3');
    await fireEvent.press(screen.getByTestId('judge-validate'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('dialog-confirm'));
      fireEvent.press(screen.getByTestId('dialog-confirm'));
    });
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/heats/h2/lanes/3/score')).toHaveLength(1));
    expect(backend.calls('PUT', '/competitions/c9/heats/h2/lanes/3/score')[0].body.raw).toEqual({ reps: 3 });
  });

  it('without network the score waits on the phone and the screen says so', async () => {
    const backend = new FakeBackend().on('GET', '/competitions/c9/floor-judging/lanes', lanesOf([lane('h2', cindy)]));
    const screen = await renderScreen(() => <JudgeLaneScreen id="c9" heatId="h2" />, backend);
    await fireEvent.press(await screen.findByTestId('judge-reps-plus'));
    backend.offline = true;
    await fireEvent.press(screen.getByTestId('judge-validate'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('Waiting to send')).toBeTruthy();
    expect(await pendingScores()).toEqual([expect.objectContaining({ competitionId: 'c9', heatId: 'h2', lane: 3, body: expect.objectContaining({ raw: { reps: 1 } }) })]);
  });

  it('a score already sent shows read-only until « Correct »', async () => {
    const backend = new FakeBackend().on('GET', '/competitions/c9/floor-judging/lanes', lanesOf([lane('h2', cindy, { score: { status: 'FINAL', raw: { reps: 412 } } })]));
    const screen = await renderScreen(() => <JudgeLaneScreen id="c9" heatId="h2" />, backend);
    expect(await screen.findByText('412 reps')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('judge-correct'));
    expect(screen.getByTestId('judge-reps-value')).toHaveTextContent('412');
  });
});
