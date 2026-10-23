import { fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

const withWod = {
  ...event,
  workouts: [{ id: 'w1', number: 1, name: 'WOD 1', description: 'AMRAP 12', scoreType: 'REPS', scoringMethod: 'DIRECT_POINTS', maximumPoints: 100, minimumPoints: 0, submissionStart: event.eventStart, submissionDeadline: event.eventEnd, variants: [] }],
};

describe('WOD scorecard, penalties and tie-break (phase 6)', () => {
  it('builds a scorecard and keeps it, with the tie-break, on the device', async () => {
    const backend = orgBackend(withWod).on('PUT', '/competitions/c9/wods/w1', [200, withWod.workouts[0]]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="wods" />, backend);
    await fireEvent.press(await screen.findByTestId('wod-w1'));
    await fireEvent.press(screen.getByTestId('sc-set-add'));
    await fireEvent.press(screen.getByTestId('sc-move-add-0'));
    await fireEvent.changeText(screen.getByTestId('sc-move-name-0-0'), 'Thrusters');
    await fireEvent.changeText(screen.getByTestId('sc-move-reps-0-0'), '21');
    expect(screen.getByText('Total: 21 reps')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('wod-tb-TIME'));
    await fireEvent.press(screen.getByTestId('wod-save'));

    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/wods/w1')).toHaveLength(1));
    expect(backend.calls('PUT', '/competitions/c9/wods/w1')[0].body).not.toHaveProperty('scorecard');
    const saved = (await screen.services.api.get<{ workouts: { id: string }[] }>('/competitions/c9')).workouts[0];
    expect(saved).toMatchObject({ tieBreak: 'TIME', scorecard: { sets: [{ movements: [{ name: 'Thrusters', reps: 21, countEvery: 1 }] }] } });
  });
});

describe('locations and the heat generator (phase 6)', () => {
  const backend = () =>
    orgBackend(withWod)
      .on('GET', '/competitions/c9/heats', [200, []])
      .on('GET', '/competitions/c9/staff', [200, []])
      .on('POST', '/competitions/c9/heats', [201, { id: 'h1' }])
      .on('POST', '/competitions/c9/heats/h1/lanes', [201, {}]);

  it('adds a location', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="planning" />, backend());
    await fireEvent.changeText(await screen.findByTestId('loc-name'), 'Main floor');
    await fireEvent.press(screen.getByTestId('loc-add'));
    expect(await screen.findByText('Main floor')).toBeTruthy();
  });

  it('creates the heats it plans: alphabetical order, best placed in the middle lanes, on a location', async () => {
    const b = backend();
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="planning" />, b);
    await fireEvent.changeText(await screen.findByTestId('loc-name'), 'Main floor');
    await fireEvent.press(screen.getByTestId('loc-add'));
    const [loc] = await screen.services.api.get<{ id: string }[]>('/competitions/c9/locations');
    await fireEvent.press(await screen.findByTestId('heat-gen-open'));
    await fireEvent.press(screen.getByTestId('gen-cat-k1'));
    await fireEvent.press(screen.getByTestId(`gen-loc-${loc.id}`));
    await fireEvent.press(screen.getByTestId('gen-sort-ALPHABET'));
    await fireEvent.press(screen.getByTestId('gen-place-MIDDLE'));
    await fireEvent.changeText(screen.getByTestId('gen-lanes'), '4');
    await fireEvent.changeText(screen.getByTestId('gen-per-heat'), '4');
    expect(await screen.findByText('1 heats · 2 athletes')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('gen-run'));

    await waitFor(() => expect(b.calls('POST', '/competitions/c9/heats/h1/lanes')).toHaveLength(2));
    expect(b.calls('POST', '/competitions/c9/heats')[0].body).toMatchObject({ categoryId: 'k1', laneCount: 4 });
    // Hédi (r3) comes before Sami (r1) alphabetically: lanes 2 then 3 from the middle.
    expect(b.calls('POST', '/competitions/c9/heats/h1/lanes').map((x) => x.body)).toEqual([
      { registrationId: 'r3', lane: 2 },
      { registrationId: 'r1', lane: 3 },
    ]);
    await expect(screen.services.api.get('/competitions/c9/heat-locations')).resolves.toEqual([expect.objectContaining({ id: 'h1', locationId: loc.id })]);
  });
});
