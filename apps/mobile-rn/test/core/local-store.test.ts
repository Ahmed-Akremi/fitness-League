import { LocalStore, memoryPersistence } from '../../src/core/api/local-store';

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
});
