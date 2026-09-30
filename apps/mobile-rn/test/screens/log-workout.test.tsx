import { fireEvent, waitFor } from 'expo-router/testing-library';

import { MemoryOutboxStore } from '../../src/core/offline/outbox';
import { LogWorkoutScreen } from '../../src/features/workouts/log-workout';
import { FakeBackend } from '../fake-api';
import { page, renderScreen, sports, squat } from '../harness';

const backendWithCatalog = () =>
  new FakeBackend()
    .on('GET', '/ref/sports', [200, sports])
    .on('GET', '/ref/exercises', [200, [squat]])
    .on('GET', '/me', [200, {}])
    .on('GET', '/workouts', [200, page([])]);

async function fillWorkout(screen: Awaited<ReturnType<typeof renderScreen>>) {
  await fireEvent.press(await screen.findByTestId('log-sport'));
  await fireEvent.press(await screen.findByTestId('log-sport-sp-bb'));
  await fireEvent.press(await screen.findByTestId('log-add-exercise'));
  await fireEvent.press(await screen.findByTestId('pick-BACK_SQUAT'));
  await fireEvent.changeText(await screen.findByTestId('set-0-reps'), '5');
  await fireEvent.changeText(screen.getByTestId('set-0-weight'), '100');
}

describe('LogWorkoutScreen', () => {
  it('logs raw sets only (never points) with an idempotency key', async () => {
    const backend = backendWithCatalog().on('POST', '/workouts', [201, { id: 'w1', status: 'ACCEPTED', version: 1 }]);
    const screen = await renderScreen(LogWorkoutScreen, backend);
    await fillWorkout(screen);
    await fireEvent.press(screen.getByTestId('log-save'));

    await waitFor(() => expect(backend.calls('POST', '/workouts')).toHaveLength(1));
    const req = backend.calls('POST', '/workouts')[0];
    expect(req.headers['Idempotency-Key']).toBe(req.body.clientId);
    expect(req.body.exercises).toEqual([{ exerciseId: 'ex-squat', sets: [{ reps: 5, weightKg: 100 }] }]);
    expect(req.body.workoutType).toBe('STRENGTH');
    expect(Object.keys(req.body).some((k) => /xp|point/i.test(k))).toBe(false);
    expect(await screen.findByText('Workout saved')).toBeTruthy();
  });

  it('queues the workout offline and tells the user', async () => {
    const backend = backendWithCatalog();
    const store = new MemoryOutboxStore();
    const screen = await renderScreen(LogWorkoutScreen, backend, { store });
    await fillWorkout(screen);
    backend.offline = true; // the connection drops just as the athlete taps save
    await fireEvent.press(screen.getByTestId('log-save'));

    expect(await screen.findByText('Saved offline. It will sync automatically.')).toBeTruthy();
    const queued = await store.all();
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe('pending');
  });

  it('shows the anti-cheat refusal', async () => {
    const backend = backendWithCatalog().on('POST', '/workouts', [422, { code: 'WORKOUT_REJECTED' }]);
    const screen = await renderScreen(LogWorkoutScreen, backend);
    await fillWorkout(screen);
    await fireEvent.press(screen.getByTestId('log-save'));
    expect(await screen.findByText('This workout exceeds physiological limits or duplicates another one.')).toBeTruthy();
  });

  it('keeps save disabled until a sport and an exercise are chosen', async () => {
    const screen = await renderScreen(LogWorkoutScreen, backendWithCatalog());
    const save = await screen.findByTestId('log-save');
    expect(save.props.accessibilityState.disabled).toBe(true);
  });
});
