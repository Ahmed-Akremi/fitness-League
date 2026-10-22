import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Json } from './client';

/**
 * Organizer data that the API does not store yet (design 2026-10-22, « local mock layer »), kept on this device:
 * AsyncStorage on a phone, localStorage in the web build. One versioned key; ids made here start with `loc_` so a
 * later import to the server can tell them apart.
 */

export const LOCAL_STORE_KEY = 'org-local:v1';
const VERSION = 1;

/** Per competition: extra fields of the competition, extra fields per category id, and whole new lists. */
export type CompetitionLocal = { fields: Json; categories: Record<string, Json>; collections: Record<string, Json[]> };
type Saved = { version: number; competitions: Record<string, CompetitionLocal> };

export interface Persistence {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export const memoryPersistence = (initial: string | null = null): Persistence => {
  let value = initial;
  return {
    read: async () => value,
    write: async (v) => void (value = v),
  };
};

export const asyncStoragePersistence = (key = LOCAL_STORE_KEY): Persistence => ({
  read: () => AsyncStorage.getItem(key),
  write: (v) => AsyncStorage.setItem(key, v),
});

const empty = (): CompetitionLocal => ({ fields: {}, categories: {}, collections: {} });

let counter = 0;

export class LocalStore {
  private data: Saved = { version: VERSION, competitions: {} };
  private loading: Promise<void> | null = null;

  constructor(private readonly persistence: Persistence) {}

  /** Loads the saved data once; unreadable data or another schema version starts empty. */
  ready(): Promise<void> {
    return (this.loading ??= this.persistence.read().then((text) => {
      const saved = parse(text);
      if (saved) this.data = saved;
    }));
  }

  /** A copy: changes go through `update`, which saves them. */
  competition(id: string): CompetitionLocal {
    return structuredClone(this.data.competitions[id] ?? empty());
  }

  async update(id: string, change: (c: CompetitionLocal) => void): Promise<void> {
    await this.ready();
    const next = this.competition(id);
    change(next);
    this.data.competitions[id] = next;
    await this.persistence.write(JSON.stringify(this.data));
  }

  newId(): string {
    counter += 1;
    return `loc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${counter.toString(36)}`;
  }
}

function parse(text: string | null): Saved | null {
  if (!text) return null;
  try {
    const saved = JSON.parse(text) as Saved;
    return saved?.version === VERSION && saved.competitions && typeof saved.competitions === 'object' ? saved : null;
  } catch {
    return null;
  }
}
