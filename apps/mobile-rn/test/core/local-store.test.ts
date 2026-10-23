import { LocalStore, memoryPersistence, type Persistence } from '../../src/core/api/local-store';

describe('local store (organizer data kept on the device until the API has it)', () => {
  it('gives an unknown competition empty data', async () => {
    const store = new LocalStore(memoryPersistence());
    await store.ready();
    expect(store.competition('c1')).toEqual({ fields: {}, categories: {}, collections: {} });
  });

  it('keeps an update after a restart', async () => {
    const persistence = memoryPersistence();
    const first = new LocalStore(persistence);
    await first.update('c1', (c) => {
      c.fields.eventStyle = 'HYBRID_RACE';
    });

    const second = new LocalStore(persistence);
    await second.ready();
    expect(second.competition('c1').fields).toEqual({ eventStyle: 'HYBRID_RACE' });
  });

  it('starts empty when the saved data cannot be read', async () => {
    const store = new LocalStore(memoryPersistence('not json'));
    await store.ready();
    expect(store.competition('c1').fields).toEqual({});
  });

  it('starts empty when the saved data comes from another schema version', async () => {
    const saved = JSON.stringify({ version: 99, competitions: { c1: { fields: { eventStyle: 'HYBRID_RACE' }, categories: {}, collections: {} } } });
    const store = new LocalStore(memoryPersistence(saved));
    await store.ready();
    expect(store.competition('c1').fields).toEqual({});
  });

  it('hands out distinct ids marked as local', async () => {
    const store = new LocalStore(memoryPersistence());
    const a = store.newId();
    const b = store.newId();
    expect(a).toMatch(/^loc_/);
    expect(a).not.toBe(b);
  });

  it('reads the latest saved data before a change: two tabs never erase each other', async () => {
    const shared = memoryPersistence();
    const a = new LocalStore(shared);
    const b = new LocalStore(shared);
    await a.ready();
    await b.ready();
    await a.update('c1', (c) => void (c.fields.title = 'A'));
    await b.update('c2', (c) => void (c.fields.title = 'B'));
    const saved = JSON.parse((await shared.read())!);
    expect(saved.competitions.c1.fields.title).toBe('A');
    expect(saved.competitions.c2.fields.title).toBe('B');
  });

  it('follows the writes of another tab (the browser’s storage event)', async () => {
    let value: string | null = null;
    const listeners = new Set<(v: string | null) => void>();
    const tab = (): Persistence => ({
      read: async () => value,
      write: async (v) => void (value = v),
      subscribe: (l) => {
        listeners.add(l);
        return () => void listeners.delete(l);
      },
    });
    const a = new LocalStore(tab());
    const b = new LocalStore(tab());
    await a.ready();
    await b.ready();
    await a.update('c1', (c) => void (c.fields.title = 'A'));
    listeners.forEach((l) => l(value));
    expect(b.competition('c1').fields.title).toBe('A');
  });
});
