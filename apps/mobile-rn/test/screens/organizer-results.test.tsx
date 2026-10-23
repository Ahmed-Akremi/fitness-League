import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, waitFor } from 'expo-router/testing-library';
import { useEffect, useState, type ReactElement } from 'react';

import type { ApiClient } from '../../src/core/api/client';
import { useApi } from '../../src/core/services';
import { DisplayScreen } from '../../src/features/competitions/displays/screens';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

beforeEach(async () => {
  await AsyncStorage.clear();
});

function Seeded({ seed, children }: { seed: (api: ApiClient) => Promise<unknown>; children: ReactElement }) {
  const api = useApi();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void seed(api).then(() => setReady(true));
  }, [api, seed]);
  return ready ? children : null;
}

const row = (id: string, name: string, w1: number, w2: number) => ({ rank: 0, athlete: { id, fullName: name }, wodPoints: { w1, w2 }, totalPoints: w1 + w2, pending: 0 });
const board = {
  status: 'IN_PROGRESS',
  provisional: true,
  workouts: [{ id: 'w1' }, { id: 'w2' }],
  rows: [{ ...row('u-r3', 'Hédi Kéfi', 100, 90), rank: 1 }, { ...row('u-r1', 'Sami Ben Ali', 95, 95), rank: 1 }, { ...row('u-r6', 'Karim Saad', 90, 100), rank: 1 }],
};
const ids = (screen: { getAllByTestId: (m: RegExp) => { props: Record<string, unknown> }[] }) => screen.getAllByTestId(/^res-row-/).map((x) => String(x.props.testID).replace('res-row-', ''));

describe('results (phase 10)', () => {
  it('re-ranks with a points table, draws the finalists line, saves the choices and freezes the standings', async () => {
    const backend = orgBackend(event).on('GET', '/competitions/c9/leaderboard', [200, board]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="results" />, backend);
    await fireEvent.press(await screen.findByTestId('res-cat-k1'));
    await screen.findByTestId('res-row-u-r1');
    await fireEvent.press(screen.getByTestId('res-table-RANK'));
    expect(ids(screen)).toEqual(['u-r6', 'u-r3', 'u-r1']);
    await fireEvent.changeText(screen.getByTestId('res-finalists'), '2');
    expect(screen.getByTestId('res-cut')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('res-vis-RANDOM'));
    await fireEvent.press(screen.getByTestId('res-save'));
    await waitFor(async () => expect((await screen.services.api.get<{ resultsSettings: object }>('/competitions/c9')).resultsSettings).toMatchObject({ table: 'RANK', visibility: 'RANDOM', finalists: 2 }));

    await fireEvent.press(screen.getByTestId('res-freeze'));
    expect(await screen.findByTestId('res-unfreeze')).toBeTruthy();
    const freezes = await screen.services.api.get<{ id: string; rows: { name: string }[] }[]>('/competitions/c9/board-freezes');
    expect(freezes.find((f) => f.id === 'k1')?.rows.map((r) => r.name)).toEqual(['Karim Saad', 'Hédi Kéfi', 'Sami Ben Ali']);
  });

  it('hybrid: ranks the race with the stations, then imports a sheet after a dry run', async () => {
    const stage = (id: string, kind: string) => ({ id, name: id === 'r1' ? '1 km run' : id === 's1' ? 'SkiErg' : 'Row', kind, scoring: kind === 'STATION' ? 'TIME' : 'NONE', target: 1000, unit: 'M' });
    const flow = { template: 'CUSTOM', timeCapSec: 600, totalScoring: 'TIME', stages: [stage('r1', 'TRANSITION'), stage('s1', 'STATION'), stage('s2', 'STATION')], breaks: [], scoringRule: null };
    const seed = async (api: ApiClient) => {
      const w = await api.post<{ id: string }>('/competitions/c9/waves', { number: 1, name: 'RX · wave 1', categoryId: 'k1', startsAt: new Date().toISOString(), registrationIds: ['r1'], athletes: [{ registrationId: 'r1', name: 'Sami Ben Ali' }], liveStart: null });
      await api.post('/competitions/c9/race-results', { id: `${w.id}:r1`, waveId: w.id, registrationId: 'r1', splits: [240_000, 420_000, 570_000], adjustments: [], dnf: false, finished: true });
    };
    const screen = await renderScreen(() => <Seeded seed={seed}><ManageScreen id="c9" initialTab="results" /></Seeded>, orgBackend({ ...event, eventStyle: 'HYBRID_RACE', hybridTemplate: 'CUSTOM', flow, workouts: [] }));
    await fireEvent.press(await screen.findByTestId('res-cat-k1'));
    expect(await screen.findByTestId('res-row-r1')).toHaveTextContent(/9:30/);
    expect(screen.getByText('SkiErg')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('res-import-target-race'));
    await fireEvent.changeText(screen.getByTestId('res-csv'), 'Name;Time\nHédi Kéfi;9:10\nNobody;9:00');
    await fireEvent.press(screen.getByTestId('res-check'));
    expect(screen.getByText('1 line ready')).toBeTruthy();
    expect(screen.getByText('Line 3: no athlete with this name')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('res-import'));
    expect(await screen.findByTestId('res-row-r3')).toBeTruthy();
    expect(ids(screen)).toEqual(['r3', 'r1']);
  });

  it('the leaderboard display follows « hidden »', async () => {
    const backend = orgBackend({ ...event, resultsSettings: { visibility: 'HIDDEN' } }).on('GET', '/competitions/c9/leaderboard', [200, board]);
    const screen = await renderScreen(() => <DisplayScreen id="c9" kind="leaderboard" params={{}} />, backend);
    expect(await screen.findByText('Results are hidden for now.')).toBeTruthy();
  });
});
