import type { ApiClient } from '../api/client';
import { ApiError } from '../api/errors';
import type { OutboxItem, OutboxStore } from './outbox';

export type SaveOutcome = 'saved' | 'queuedOffline';

interface SyncResult {
  clientId: string;
  result: string;
  error?: { code?: string };
}

const BATCH = 50;

/**
 * Offline-first workout saving (docs §10).
 *
 * Every workout carries a client UUID used as the Idempotency-Key: re-sending after a lost response is safe,
 * the server replays the stored result instead of creating a duplicate.
 */
export class WorkoutSyncService {
  private flushing: Promise<number> | null = null;

  constructor(
    private readonly api: ApiClient,
    private readonly store: OutboxStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Tries the network first; on a connectivity problem the workout is queued and sent later.
   * Server-side refusals (validation, anti-cheat) are rethrown so the form can show them.
   */
  async save(workout: Record<string, unknown> & { clientId: string }): Promise<[SaveOutcome, unknown]> {
    const payload = { ...workout, deviceSubmittedAt: this.now().toISOString() };
    try {
      const res = await this.api.post('/workouts', payload, { 'Idempotency-Key': workout.clientId });
      return ['saved', res];
    } catch (e) {
      if (!(e instanceof ApiError) || !e.isConnectivity) throw e;
      await this.store.put({ clientId: workout.clientId, payload: workout, status: 'pending', attempts: 0, createdAt: this.now().toISOString() });
      return ['queuedOffline', null];
    }
  }

  pending(): Promise<OutboxItem[]> {
    return this.store.all();
  }

  /** Sends queued workouts in batches of 50. Concurrent calls share one flush. Returns how many were synced. */
  flush(): Promise<number> {
    return (this.flushing ??= this.doFlush().finally(() => (this.flushing = null)));
  }

  private async doFlush(): Promise<number> {
    const queued = (await this.store.all()).filter((i) => i.status === 'pending');
    let synced = 0;
    for (let i = 0; i < queued.length; i += BATCH) {
      const batch = queued.slice(i, i + BATCH);
      let res: { results: SyncResult[] };
      try {
        res = await this.api.post('/workouts/sync', {
          items: batch.map((item) => ({ ...item.payload, deviceSubmittedAt: this.now().toISOString() })),
        });
      } catch (e) {
        if (e instanceof ApiError && e.isConnectivity) {
          for (const item of batch) await this.store.put({ ...item, attempts: item.attempts + 1 });
          return synced; // still offline: try again on the next trigger
        }
        throw e;
      }
      for (const r of res.results) {
        const item = batch.find((b) => b.clientId === r.clientId);
        if (!item) continue;
        switch (r.result) {
          case 'CREATED':
          case 'REPLAYED':
            await this.store.remove(item.clientId);
            synced++;
            break;
          case 'CONFLICT':
            await this.store.put({ ...item, status: 'conflict', lastError: 'IDEMPOTENCY_CONFLICT' });
            break;
          case 'REJECTED':
            await this.store.put({ ...item, status: 'rejected', lastError: 'WORKOUT_REJECTED' });
            break;
          default:
            await this.store.put({ ...item, status: 'rejected', lastError: r.error?.code ?? 'INVALID' });
        }
      }
    }
    return synced;
  }

  /** The user dismissed a conflicted or rejected item (the server version is kept). */
  discard(clientId: string): Promise<void> {
    return this.store.remove(clientId);
  }
}
