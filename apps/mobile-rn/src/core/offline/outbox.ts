/** A workout saved while offline, waiting to be sent (docs §10). */
export interface OutboxItem {
  clientId: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  createdAt: string; // ISO-8601
  lastError?: string | null;
}

/**
 * pending: waiting for connectivity.
 * conflict: the server already has this clientId with different data; the user must choose.
 * rejected: the server refused it (validation or anti-cheat); kept so the user sees why.
 */
export type OutboxStatus = 'pending' | 'conflict' | 'rejected';

/** Persistence of the outbox. SQLite in the app, in-memory in tests and the demo build. */
export interface OutboxStore {
  put(item: OutboxItem): Promise<void>;
  all(): Promise<OutboxItem[]>;
  remove(clientId: string): Promise<void>;
}

export class MemoryOutboxStore implements OutboxStore {
  private items = new Map<string, OutboxItem>();

  async put(item: OutboxItem) {
    this.items.set(item.clientId, item);
  }

  async all() {
    return [...this.items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async remove(clientId: string) {
    this.items.delete(clientId);
  }
}
