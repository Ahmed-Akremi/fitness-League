import { fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

const w1 = {
  id: 'w1', number: 1, name: 'WOD 1', description: 'AMRAP 12', standards: null, scoreType: 'REPS', scoringMethod: 'DIRECT_POINTS', maximumPoints: 100, minimumPoints: 0, placementTable: [], timeCapS: null, videoUrl: null, movements: [],
  submissionStart: '2026-12-12T08:00:00.000Z', submissionDeadline: '2026-12-13T18:00:00.000Z', releaseAt: null, variants: [],
};
const open = () => <ManageScreen id="c9" initialTab="wods" />;
const sent = (backend: ReturnType<typeof orgBackend>) => backend.calls('PUT', '/competitions/c9/wods/w1')[0].body;

describe('organizer space: WOD versions and release', () => {
  it('adds a version for a category, prefilled from the WOD, and saves it', async () => {
    const backend = orgBackend({ ...event, workouts: [w1] }).on('PUT', '/competitions/c9/wods/w1', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('wod-w1'));
    await fireEvent.press(screen.getByTestId('wod-variant-add-k2'));
    expect(screen.getByTestId('wod-variant-desc-k2').props.value).toBe('AMRAP 12');
    await fireEvent.changeText(screen.getByTestId('wod-variant-desc-k2'), 'AMRAP 12, 6 kg wall balls');
    await fireEvent.changeText(screen.getByTestId('wod-variant-cap-k2'), '12');
    await fireEvent.press(screen.getByTestId('wod-save'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/wods/w1')).toHaveLength(1));
    expect(sent(backend).variants).toEqual([{ categoryId: 'k2', description: 'AMRAP 12, 6 kg wall balls', timeCapS: 720 }]);
    expect(sent(backend)).not.toHaveProperty('releaseAt');
  });

  it('removes a version: the WOD is sent without any', async () => {
    const backend = orgBackend({ ...event, workouts: [{ ...w1, variants: [{ id: 'v1', categoryId: 'k2', description: 'Scaled', standards: null, timeCapS: null }] }] }).on('PUT', '/competitions/c9/wods/w1', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('wod-w1'));
    await fireEvent.press(screen.getByLabelText('Remove this version'));
    await fireEvent.press(screen.getByTestId('wod-save'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/wods/w1')).toHaveLength(1));
    expect(sent(backend).variants).toEqual([]);
  });

  it('« Show it now » sends the current time as the release date', async () => {
    const backend = orgBackend({ ...event, workouts: [{ ...w1, releaseAt: '2026-12-20T08:00:00.000Z' }] }).on('PUT', '/competitions/c9/wods/w1', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('wod-w1'));
    const before = Date.now();
    await fireEvent.press(screen.getByTestId('wod-release-now'));
    await fireEvent.press(screen.getByTestId('wod-save'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/wods/w1')).toHaveLength(1));
    const at = Date.parse(sent(backend).releaseAt);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
