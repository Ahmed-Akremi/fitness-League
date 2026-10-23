import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, waitFor } from 'expo-router/testing-library';
import { View } from 'react-native';

import { DisplayScreen } from '../../src/features/competitions/displays/screens';
import { JudgeRaceScreen } from '../../src/features/competitions/judge/race';
import { JudgeLaneScreen } from '../../src/features/competitions/judge/screens';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

/**
 * The demo script (docs/organisation-demo-script.md) as a test: the organizer, judge and TV screens side by side
 * share one device, as tabs of one browser do (local data and live bus).
 */
beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('organisation demo, end to end', () => {
  it('hybrid race: race set up, wave started, a judge records splits, the TV and the results follow', async () => {
    const backend = orgBackend({ ...event, eventStyle: 'HYBRID_RACE', hybridTemplate: 'HYROX_STYLE', workouts: [] }).on('POST', '/competitions/c9/wods', [201, { id: 'w-race' }]);
    const screen = await renderScreen(
      () => (
        <View>
          <ManageScreen id="c9" initialTab="race" />
          <JudgeRaceScreen id="c9" />
          <DisplayScreen id="c9" kind="race" params={{}} />
        </View>
      ),
      backend,
    );

    // Organizer: the HYROX-style race.
    await fireEvent.press(await screen.findByTestId('race-template-HYROX_STYLE'));
    await fireEvent.press(screen.getByTestId('race-save'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/wods')).toHaveLength(1));

    // Organizer: one wave for RX Men, started.
    await fireEvent.press(screen.getByTestId('org-tab-waves'));
    await fireEvent.press(await screen.findByTestId('wave-cat-k1'));
    await fireEvent.press(screen.getByTestId('wave-run'));
    expect(await screen.findByText('0 racing · 1 waves')).toBeTruthy();
    const [wave] = await screen.services.api.get<{ id: string }[]>('/competitions/c9/waves');
    await fireEvent.press(screen.getByTestId(`wave-select-${wave.id}`));
    await fireEvent.press(screen.getByTestId('wave-start'));
    expect(await screen.findByText('1 racing · 1 waves')).toBeTruthy();

    // Judge: follows Sami through three stages.
    await fireEvent.press(await screen.findByTestId(`race-wave-${wave.id}`));
    await fireEvent.press(await screen.findByTestId('race-ath-r1'));
    expect(await screen.findByTestId('race-current')).toHaveTextContent('1 km run');
    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByTestId('race-next'));
    expect(screen.getByTestId('race-current')).toHaveTextContent('50m Sled Push');

    // TV: the race view shows his progress.
    await waitFor(() => expect(screen.getByTestId('display-race-r1')).toHaveTextContent(/3 \/ 16/));

    // Organizer: the results rank him, still racing.
    await fireEvent.press(screen.getByTestId('org-tab-results'));
    await fireEvent.press(await screen.findByTestId('res-cat-k1'));
    expect(await screen.findByTestId('res-row-r1')).toHaveTextContent(/Racing/);
  });

  it('functional fitness: the floor judge counts, the heat display follows; the timer reaches the TV', async () => {
    const lanes = () =>
      [
        200,
        {
          serverTime: new Date().toISOString(),
          competition: { id: 'c9', title: 'Sousse Summer Throwdown', locked: false },
          staffId: 's1',
          lanes: [{ heat: { id: 'h1', number: 1, name: 'Heat 1', startsAt: null, durationMin: 15, startedAt: new Date().toISOString() }, lane: 3, athlete: { id: 'u-r3', fullName: 'Hédi Kéfi' }, category: { id: 'k1', name: 'RX Men' }, workout: { id: 'w1', number: 1, name: 'WOD 1', description: 'Max reps', scoreType: 'REPS', timeCapS: null, movements: [] }, score: null }],
        },
      ] as [number, unknown];
    const heats = [{ id: 'h1', number: 1, name: 'Heat 1', startsAt: null, durationMin: 15, lanes: [{ lane: 3, athlete: { fullName: 'Hédi Kéfi' } }] }];
    const backend = orgBackend(event).on('GET', '/competitions/c9/floor-judging/lanes', lanes).on('GET', '/competitions/c9/heats', [200, heats]);
    const screen = await renderScreen(
      () => (
        <View>
          <JudgeLaneScreen id="c9" heatId="h1" />
          <DisplayScreen id="c9" kind="heat" params={{ heat: 'h1' }} />
          <ManageScreen id="c9" initialTab="live" />
          <DisplayScreen id="c9" kind="timer" params={{}} />
        </View>
      ),
      backend,
    );

    // Judge: 3 reps; the heat display shows them.
    await screen.findByTestId('judge-reps-plus');
    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByTestId('judge-reps-plus'));
    await waitFor(() => expect(screen.getByTestId('display-lane-3-value')).toHaveTextContent('3'));
    expect(screen.getByText('Heat 1 · lane 3 · 3 reps')).toBeTruthy();

    // Organizer: a 12-minute AMRAP; the TV timer starts from it.
    await fireEvent.press(await screen.findByTestId('timer-type-AMRAP'));
    await fireEvent.changeText(screen.getByTestId('timer-cap'), '12');
    await fireEvent.press(screen.getByTestId('timer-start'));
    await waitFor(() => expect(screen.getByTestId('display-status')).toHaveTextContent('Running'));
    expect(screen.getByTestId('display-clock')).toHaveTextContent('12:00');
  });
});
