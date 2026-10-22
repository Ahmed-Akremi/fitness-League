import { MyHeatsScreen, myHeatState } from '../../src/features/competitions/my-heats';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

/** « Mon heat »: the athlete's heats, lane, WOD, time and validated score — never who judges them. */
const comp = { id: 'c9', title: 'Sfax Throwdown', workouts: [{ id: 'w1', name: 'Fran', scoreType: 'TIME', movements: [] }, { id: 'w2', name: 'Cindy', scoreType: 'REPS', movements: [] }], categories: [], myRoles: [], myRegistration: { registrationStatus: 'CONFIRMED' } };
const me = { lane: 3, registrationId: 'r1', athlete: { id: 'u-me', fullName: 'Sami Ben Ali' }, mine: true, judge: { staffId: 'f1', id: 'u-j', fullName: 'Nour Gharbi' }, judgedByMe: false };
const other = { lane: 1, registrationId: 'r2', athlete: { id: 'u-2', fullName: 'Karim Mansour' }, mine: false, judge: null, judgedByMe: false };
const heat = (id: string, workout: { id: string; name: string }, lanes: object[], over: object = {}) => ({ id, number: 1, name: `RX Men · ${id}`, startsAt: '2026-12-12T09:00:00.000Z', durationMin: 12, laneCount: 4, startedAt: null, workout: { ...workout, number: 1 }, category: { id: 'k1', name: 'RX Men' }, lanes, ...over });
const backend = (heats: object[], subs: object[] = []) =>
  new FakeBackend()
    .on('GET', '/competitions/c9', [200, comp])
    .on('GET', '/competitions/c9/heats', [200, heats])
    .on('GET', '/competitions/c9/my-submissions', [200, subs]);

describe('my heats', () => {
  it('shows only my heats, with lane, WOD and category, and never the judge', async () => {
    const screen = await renderScreen(() => <MyHeatsScreen id="c9" />, backend([heat('h1', comp.workouts[0], [other, me]), heat('h2', comp.workouts[1], [other])]));
    expect(await screen.findByTestId('my-heat-h1')).toBeTruthy();
    expect(screen.queryByTestId('my-heat-h2')).toBeNull();
    expect(screen.getByText('Lane 3')).toBeTruthy();
    expect(screen.getByText('Fran')).toBeTruthy();
    expect(screen.getByText('RX Men')).toBeTruthy();
    expect(screen.getByText('Upcoming')).toBeTruthy();
    expect(screen.getByText('Score not validated yet')).toBeTruthy();
    expect(screen.queryByText(/Nour Gharbi/)).toBeNull();
  });

  it('shows the validated score and its points', async () => {
    const subs = [
      { id: 's1', status: 'FINAL', raw: { timeS: 245 }, points: '100', workout: { id: 'w1', scoreType: 'TIME' } },
      { id: 's2', status: 'FINAL', raw: { reps: 412 }, points: 90, workout: { id: 'w2', scoreType: 'REPS' } },
    ];
    const screen = await renderScreen(() => <MyHeatsScreen id="c9" />, backend([heat('h1', comp.workouts[0], [me]), heat('h2', comp.workouts[1], [me])], subs));
    expect(await screen.findByText('4:05')).toBeTruthy();
    expect(screen.getByText('100 pts')).toBeTruthy();
    expect(screen.getByText('412 reps')).toBeTruthy();
    expect(screen.getAllByText('Score validated')).toHaveLength(2);
  });

  it('says so when the athlete is in no heat yet', async () => {
    const screen = await renderScreen(() => <MyHeatsScreen id="c9" />, backend([heat('h2', comp.workouts[1], [other])]));
    expect(await screen.findByText('You are not in a heat yet. The organizer publishes the schedule before the event.')).toBeTruthy();
  });

  it('a heat is live once started, scored once the score is FINAL', () => {
    expect(myHeatState({ startedAt: null }, undefined)).toBe('upcoming');
    expect(myHeatState({ startedAt: '2026-12-12T09:00:00Z' }, { status: 'SUBMITTED' })).toBe('live');
    expect(myHeatState({ startedAt: null }, { status: 'FINAL' })).toBe('scored');
  });
});
