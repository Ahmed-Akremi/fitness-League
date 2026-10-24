import { fireEvent } from 'expo-router/testing-library';

import { CompetitionScreen, SubmitScreen } from '../../src/features/competitions/screens';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const day1 = '2026-12-12';
const day2 = '2026-12-13';
const event = { id: 'c1', title: 'Sousse Summer Throwdown', status: 'ACTIVE', format: 'ONSITE', city: 'Sousse', currency: 'TND', registrationPrice: 0, participants: 3, eventStart: `${day1}T08:00:00Z`, eventEnd: `${day2}T18:00:00Z`, deadlines: { registrationEnd: '2026-12-01T00:00:00Z' }, organizer: { fullName: 'Org' }, categories: [], workouts: [], prizes: [], myRoles: [], myRegistration: { registrationStatus: 'CONFIRMED' } };
const heats = [
  { id: 'h1', number: 1, name: 'RX · Heat 1', startsAt: `${day1}T09:00:00`, durationMin: 12, laneCount: 3, lanes: [{ lane: 1, athlete: { fullName: 'Sami Ben Ali' } }] },
  { id: 'h2', number: 2, name: 'RX · Heat 2', startsAt: `${day1}T10:00:00`, durationMin: 12, laneCount: 2, lanes: [{ lane: 2, mine: true, athlete: { fullName: 'Hédi Kéfi' } }] },
  { id: 'h3', number: 3, name: 'Final', startsAt: `${day2}T15:00:00`, durationMin: 10, laneCount: 2, lanes: [] },
];

describe('heats of the day (Schedule tab)', () => {
  it('shows one day, only my heats on demand, a search, and empty lanes', async () => {
    const backend = new FakeBackend().on('GET', '/competitions/c1', [200, event]).on('GET', '/competitions/c1/heats', [200, heats]).on('GET', '/competitions/c1/my-submissions', [200, []]);
    const screen = await renderScreen(() => <CompetitionScreen id="c1" />, backend);
    await fireEvent.press(await screen.findByTestId('comp-tab-schedule'));
    expect(await screen.findByTestId('heat-h1')).toBeTruthy();
    expect(screen.queryByTestId('heat-h3')).toBeNull();
    await fireEvent.press(screen.getByTestId(`heats-day-${day2}`));
    expect(screen.getByTestId('heat-h3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`heats-day-${day1}`));

    await fireEvent.press(screen.getByTestId('heats-mine'));
    expect(screen.queryByTestId('heat-h1')).toBeNull();
    expect(screen.getByText('Hédi Kéfi · you')).toBeTruthy();
    expect(screen.getByTestId('heat-h2-lane-1')).toHaveTextContent(/Empty lane/);
    await fireEvent.press(screen.getByTestId('heats-mine'));

    await fireEvent.changeText(screen.getByTestId('heats-search'), 'sami');
    expect(screen.getByTestId('heat-h1-lane-1')).toHaveTextContent(/Sami Ben Ali/);
    expect(screen.queryByTestId('heat-h2')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('heats-search'), 'nobody');
    expect(screen.getByText('We can’t find “nobody” in the heats of this day.')).toBeTruthy();
  });
});

describe('score submission (Circle21 « Submit score »)', () => {
  it('asks whether the athlete finished within the time cap, and shows the deadline', async () => {
    const comp = { ...event, format: 'ONLINE', workouts: [{ id: 'w1', number: 1, name: 'Fran', description: '21-15-9', scoreType: 'TIME', timeCapS: 600, maximumPoints: 100, submissionDeadline: '2026-12-20T20:00:00Z' }] };
    const backend = new FakeBackend().on('GET', '/competitions/c1', [200, comp]).on('POST', '/competitions/c1/wods/w1/submissions', [201, { id: 's1' }]);
    const screen = await renderScreen(() => <SubmitScreen id="c1" wodId="w1" />, backend);
    expect(await screen.findByText('For time · fastest is better · Time cap 10 min · Max 100 pts')).toBeTruthy();
    expect(screen.getByTestId('sub-deadline')).toHaveTextContent(/Submit your result before/);
    expect(screen.getByTestId('sub-time')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sub-capped'));
    expect(screen.queryByTestId('sub-time')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('sub-reps'), '120');
    expect(screen.getByTestId('sub-send').props.accessibilityState?.disabled).toBe(true);
  });
});
