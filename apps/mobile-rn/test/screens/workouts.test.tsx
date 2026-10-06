import { TrainScreen } from '../../src/features/workouts/screens';
import { FakeBackend } from '../fake-api';
import { page, renderScreen, sports } from '../harness';

describe('train tab', () => {
  it('lists workouts with a status pill', async () => {
    const backend = new FakeBackend()
      .on('GET', '/ref/sports', [200, sports])
      .on('GET', '/workouts', [200, page([{ id: 'w1', status: 'ACCEPTED', performedAt: '2026-09-28T10:00:00Z', durationS: 4800, sportId: 'sp-run', totalDistanceM: 5000 }])]);
    const screen = await renderScreen(TrainScreen, backend);
    expect(await screen.findByTestId('workout-w1')).toBeTruthy();
    expect(screen.getByTestId('workout-w1-status')).toBeTruthy();
    expect(screen.getByText('Accepted')).toBeTruthy();
  });
});
