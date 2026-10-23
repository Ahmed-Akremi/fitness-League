import { ApiClient } from '../../src/core/api/client';
import { LocalStore, memoryPersistence } from '../../src/core/api/local-store';
import { orgLocalEnabled, withOrgLocal } from '../../src/core/api/org-local';
import { MemoryTokenStorage } from '../../src/core/auth/token-storage';
import { FakeBackend } from '../fake-api';

describe('organizer local layer (what the app keeps on the device for now)', () => {
  const backend = () => new FakeBackend().on('POST', '/competitions', [201, { id: 'c1', title: 'Open' }]);
  const client = (b: FakeBackend, on: boolean) =>
    new ApiClient('http://test', new MemoryTokenStorage(), () => {}, withOrgLocal(b.fetch, on, new LocalStore(memoryPersistence())));

  it('keeps the event style on the device when the layer is on', async () => {
    const b = backend();
    const created = await client(b, true).post('/competitions', { title: 'Open', eventStyle: 'HYBRID_RACE' });
    expect(b.calls('POST', '/competitions')[0].body).toEqual({ title: 'Open' });
    expect(created).toMatchObject({ id: 'c1', eventStyle: 'HYBRID_RACE' });
  });

  it('sends everything to the server when the layer is off', async () => {
    const b = backend();
    await client(b, false).post('/competitions', { title: 'Open', eventStyle: 'HYBRID_RACE' });
    expect(b.calls('POST', '/competitions')[0].body).toEqual({ title: 'Open', eventStyle: 'HYBRID_RACE' });
  });

  it('is on unless EXPO_PUBLIC_ORG_LOCAL is « false »', () => {
    expect(orgLocalEnabled(undefined)).toBe(true);
    expect(orgLocalEnabled('true')).toBe(true);
    expect(orgLocalEnabled('false')).toBe(false);
  });
});

describe('waiting list (phase 4, answered on the device)', () => {
  it('adds an athlete, lists the list and removes them', async () => {
    const api = new ApiClient('http://test', new MemoryTokenStorage(), () => {}, withOrgLocal(new FakeBackend().fetch, true, new LocalStore(memoryPersistence())));
    const entry = await api.post<{ id: string }>('/competitions/c1/waiting-list', { categoryId: 'k1', name: 'Sami', email: 'sami@box.tn' });
    expect(entry.id).toMatch(/^loc_/);
    await expect(api.get('/competitions/c1/waiting-list')).resolves.toEqual([expect.objectContaining({ categoryId: 'k1', name: 'Sami', email: 'sami@box.tn' })]);
    await api.delete(`/competitions/c1/waiting-list/${entry.id}`);
    await expect(api.get('/competitions/c1/waiting-list')).resolves.toEqual([]);
  });

  it('refuses an entry without a category or an email', async () => {
    const api = new ApiClient('http://test', new MemoryTokenStorage(), () => {}, withOrgLocal(new FakeBackend().fetch, true, new LocalStore(memoryPersistence())));
    await expect(api.post('/competitions/c1/waiting-list', { name: 'Sami' })).rejects.toMatchObject({ status: 422 });
  });
});

describe('services (the app as built)', () => {
  const saved = process.env.EXPO_PUBLIC_DEMO;
  afterEach(() => {
    process.env.EXPO_PUBLIC_DEMO = saved;
  });

  it('puts the layer in front of the demo build: a draft keeps its event style', async () => {
    let services!: import('../../src/core/services').Services;
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_DEMO = 'true';
      services = (require('../../src/core/services') as typeof import('../../src/core/services')).createServices();
    });
    const created = await services.api.post<{ id: string }>('/competitions', { title: 'Open', eventStyle: 'HYBRID_RACE' });
    await expect(services.api.get(`/competitions/${created.id}`)).resolves.toMatchObject({ eventStyle: 'HYBRID_RACE' });
  });

  it('gives every screen the live bus', () => {
    let services!: import('../../src/core/services').Services;
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_DEMO = 'true';
      services = (require('../../src/core/services') as typeof import('../../src/core/services')).createServices();
    });
    const got: unknown[] = [];
    services.live.subscribe('timer.loc1', 'timer_start', (p) => got.push(p));
    services.live.publish('timer.loc1', 'timer_start', { at: 1 });
    expect(got).toEqual([{ at: 1 }]);
  });
});
