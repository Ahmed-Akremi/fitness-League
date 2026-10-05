import { MemoryOutboxStore } from '../../src/core/offline/outbox';
import { WorkoutSyncService } from '../../src/core/offline/workout-sync';
import { FakeBackend, fakeClient } from '../fake-api';

const workout = (clientId: string) => ({
  clientId,
  sportId: 's',
  workoutType: 'STRENGTH',
  performedAt: '2026-09-25T07:00:00Z',
  durationS: 3600,
  exercises: [{ exerciseId: 'e', sets: [{ reps: 5, weightKg: 100 }] }],
});

describe('WorkoutSyncService (offline-first, spec §10)', () => {
  it('sends online with the clientId as Idempotency-Key', async () => {
    const backend = new FakeBackend().on('POST', '/workouts', [201, { id: 'w1', status: 'ACCEPTED' }]);
    const sync = new WorkoutSyncService(fakeClient(backend), new MemoryOutboxStore());
    const [outcome, body] = await sync.save(workout('c1'));
    expect(outcome).toBe('saved');
    expect((body as { id: string }).id).toBe('w1');
    expect(backend.requests[0].headers['Idempotency-Key']).toBe('c1');
  });

  it('queues when offline, then flushes in a batch and keeps conflicts for the user', async () => {
    const backend = new FakeBackend();
    backend.offline = true;
    const store = new MemoryOutboxStore();
    const sync = new WorkoutSyncService(fakeClient(backend), store);

    for (const id of ['a', 'b', 'c']) expect((await sync.save(workout(id)))[0]).toBe('queuedOffline');
    expect(await store.all()).toHaveLength(3);

    // Still offline: nothing lost, attempts counted.
    expect(await sync.flush()).toBe(0);
    expect((await store.all()).every((i) => i.attempts === 1)).toBe(true);

    backend.offline = false;
    backend.on('POST', '/workouts/sync', (req) => {
      expect(req.body.items.map((i: { clientId: string }) => i.clientId)).toEqual(['a', 'b', 'c']);
      return [200, { results: [{ clientId: 'a', result: 'CREATED' }, { clientId: 'b', result: 'REPLAYED' }, { clientId: 'c', result: 'CONFLICT' }] }];
    });
    expect(await sync.flush()).toBe(2);
    const left = await store.all();
    expect(left).toHaveLength(1);
    expect(left[0].clientId).toBe('c');
    expect(left[0].status).toBe('conflict');
  });

  it('sends in batches of 50', async () => {
    const backend = new FakeBackend();
    const store = new MemoryOutboxStore();
    for (let i = 0; i < 120; i++) {
      await store.put({ clientId: `w${i}`, payload: workout(`w${i}`), status: 'pending', attempts: 0, createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString() });
    }
    backend.on('POST', '/workouts/sync', (req) => [200, { results: req.body.items.map((i: { clientId: string }) => ({ clientId: i.clientId, result: 'CREATED' })) }]);
    const sync = new WorkoutSyncService(fakeClient(backend), store);
    expect(await sync.flush()).toBe(120);
    expect(backend.calls('POST', '/workouts/sync').map((r) => r.body.items.length)).toEqual([50, 50, 20]);
  });

  it('marks rejected and invalid items with their reason', async () => {
    const backend = new FakeBackend().on('POST', '/workouts/sync', [
      200,
      { results: [{ clientId: 'r', result: 'REJECTED' }, { clientId: 'i', result: 'INVALID', error: { code: 'VALIDATION_FAILED' } }] },
    ]);
    const store = new MemoryOutboxStore();
    await store.put({ clientId: 'r', payload: workout('r'), status: 'pending', attempts: 0, createdAt: '2026-01-01T00:00:00Z' });
    await store.put({ clientId: 'i', payload: workout('i'), status: 'pending', attempts: 0, createdAt: '2026-01-01T00:00:01Z' });
    await new WorkoutSyncService(fakeClient(backend), store).flush();
    expect((await store.all()).map((i) => [i.clientId, i.status, i.lastError])).toEqual([
      ['r', 'rejected', 'WORKOUT_REJECTED'],
      ['i', 'rejected', 'VALIDATION_FAILED'],
    ]);
  });

  it('rethrows server refusals so the form can show them (not queued)', async () => {
    const backend = new FakeBackend().on('POST', '/workouts', [422, { code: 'WORKOUT_REJECTED' }]);
    const store = new MemoryOutboxStore();
    const sync = new WorkoutSyncService(fakeClient(backend), store);
    await expect(sync.save(workout('x'))).rejects.toMatchObject({ code: 'WORKOUT_REJECTED' });
    expect(await store.all()).toHaveLength(0);
  });

  it('concurrent flushes share one request', async () => {
    const backend = new FakeBackend().on('POST', '/workouts/sync', [200, { results: [{ clientId: 'a', result: 'CREATED' }] }]);
    const store = new MemoryOutboxStore();
    await store.put({ clientId: 'a', payload: workout('a'), status: 'pending', attempts: 0, createdAt: '2026-01-01T00:00:00Z' });
    const sync = new WorkoutSyncService(fakeClient(backend), store);
    await Promise.all([sync.flush(), sync.flush()]);
    expect(backend.calls('POST', '/workouts/sync')).toHaveLength(1);
  });
});
