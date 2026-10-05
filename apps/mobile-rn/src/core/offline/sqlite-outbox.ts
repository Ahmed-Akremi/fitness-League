import * as SQLite from 'expo-sqlite';

import type { OutboxItem, OutboxStatus, OutboxStore } from './outbox';

interface Row {
  client_id: string;
  payload: string;
  status: OutboxStatus;
  attempts: number;
  created_at: string;
  last_error: string | null;
}

/** Outbox persisted on the device so queued workouts survive app restarts. */
export class SqliteOutboxStore implements OutboxStore {
  private readonly db = SQLite.openDatabaseSync('offline.db');

  constructor() {
    this.db.execSync(`CREATE TABLE IF NOT EXISTS outbox (
      client_id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_error TEXT
    )`);
  }

  async put(i: OutboxItem) {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO outbox (client_id, payload, status, attempts, created_at, last_error) VALUES (?, ?, ?, ?, ?, ?)',
      i.clientId,
      JSON.stringify(i.payload),
      i.status,
      i.attempts,
      i.createdAt,
      i.lastError ?? null,
    );
  }

  async all() {
    const rows = await this.db.getAllAsync<Row>('SELECT * FROM outbox ORDER BY created_at');
    return rows.map((r) => ({
      clientId: r.client_id,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
      status: r.status,
      attempts: r.attempts,
      createdAt: r.created_at,
      lastError: r.last_error,
    }));
  }

  async remove(clientId: string) {
    await this.db.runAsync('DELETE FROM outbox WHERE client_id = ?', clientId);
  }
}
