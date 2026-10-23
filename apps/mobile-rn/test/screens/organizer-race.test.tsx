import { fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

const hybrid = { ...event, eventStyle: 'HYBRID_RACE', hybridTemplate: 'HYROX_STYLE', workouts: [] };

describe('race (phase 7)', () => {
  it('builds the HYROX-style race, keeps it on the device and creates the race WOD once', async () => {
    const backend = orgBackend(hybrid).on('POST', '/competitions/c9/wods', [201, { id: 'w-race' }]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="race" />, backend);
    await fireEvent.press(await screen.findByTestId('race-template-HYROX_STYLE'));
    expect(screen.getAllByTestId(/^race-stage-\d+$/)).toHaveLength(16);
    expect(screen.getByText('The HYROX-style stages are fixed.')).toBeTruthy();
    expect(screen.queryByTestId('race-up-1')).toBeNull();
    await fireEvent.press(screen.getByTestId('race-save'));

    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/wods')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/wods')[0].body).toMatchObject({ scoreType: 'TIME', name: 'Race' });
    const saved = await screen.services.api.get<{ flow: { template: string; stages: unknown[] } }>('/competitions/c9');
    expect(saved.flow.template).toBe('HYROX_STYLE');
    expect(saved.flow.stages).toHaveLength(16);
  });

  it('builds a custom race: a station and a run, reordered, with a +5 s rule', async () => {
    const backend = orgBackend(hybrid).on('POST', '/competitions/c9/wods', [201, { id: 'w-race' }]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="race" />, backend);
    await fireEvent.press(await screen.findByTestId('race-template-CUSTOM'));
    await fireEvent.press(screen.getByTestId('race-add-station'));
    await fireEvent.changeText(screen.getByTestId('race-stage-name-0'), 'Row 500 m');
    await fireEvent.changeText(screen.getByTestId('race-stage-target-0'), '500');
    await fireEvent.press(screen.getByTestId('race-add-run'));
    await fireEvent.press(screen.getByTestId('race-up-1'));
    await fireEvent.press(screen.getByTestId('race-rule-ADD'));
    await fireEvent.changeText(screen.getByTestId('race-rule-value'), '5');
    await fireEvent.press(screen.getByTestId('race-save'));

    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/wods')).toHaveLength(1));
    const { flow } = await screen.services.api.get<{ flow: { stages: { kind: string; name: string }[]; scoringRule: object } }>('/competitions/c9');
    expect(flow.stages.map((s) => s.kind)).toEqual(['TRANSITION', 'STATION']);
    expect(flow.scoringRule).toEqual({ op: 'ADD', value: 5, unit: 'SEC' });
  });

  it('explains that the race page is for hybrid events', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="race" />, orgBackend(event));
    expect(await screen.findByText('This page is for hybrid races. Change the event type in General.')).toBeTruthy();
  });
});

describe('waves (phase 7)', () => {
  it('creates waves, then starts and stops the selected one with a live event', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="waves" />, orgBackend(hybrid));
    const started: unknown[] = [];
    screen.services.live.subscribe('event.c9', 'wave_started', (p) => started.push(p));
    await fireEvent.press(await screen.findByTestId('wave-cat-k1'));
    await fireEvent.changeText(screen.getByTestId('wave-per'), '1');
    await fireEvent.press(screen.getByTestId('wave-run'));
    expect(await screen.findByText('0 racing · 2 waves')).toBeTruthy();

    const [first] = await screen.services.api.get<{ id: string }[]>('/competitions/c9/waves');
    await fireEvent.press(screen.getByTestId(`wave-select-${first.id}`));
    await fireEvent.press(screen.getByTestId('wave-start'));
    expect(await screen.findByText('1 racing · 2 waves')).toBeTruthy();
    expect(started).toEqual([expect.objectContaining({ waveId: first.id })]);

    await fireEvent.press(screen.getByTestId(`wave-select-${first.id}`));
    await fireEvent.press(screen.getByTestId('wave-stop'));
    expect(await screen.findByText('0 racing · 2 waves')).toBeTruthy();
  });
});
