import { ApiClient, type Fetch } from '../../src/core/api/client';
import { withLocalRoutes, type LocalLayer } from '../../src/core/api/local-routes';
import { LocalStore, memoryPersistence } from '../../src/core/api/local-store';
import { MemoryTokenStorage } from '../../src/core/auth/token-storage';

type Call = { method: string; path: string; body: unknown };

/** A fake server: answers `METHOD /path` from a table (404 otherwise) and records what it received. */
function fakeServer(answers: Record<string, [number, unknown]>) {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    const path = new URL(url).pathname.replace(/^\/api\/v1/, '');
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ method, path, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    const [status, body] = answers[`${method} ${path}`] ?? [404, { code: 'NOT_FOUND', status: 404 }];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetch };
}

const layer: LocalLayer = {
  competitionFields: ['eventStyle'],
  categoryFields: ['type', 'earlyPrice'],
  routes: [
    {
      method: 'GET',
      path: '/competitions/:id/flow',
      handle: ({ params }, store) => ({ status: 200, body: store.competition(params.id).collections.flow ?? [] }),
    },
    {
      method: 'PUT',
      path: '/competitions/:id/flow',
      handle: () => ({ status: 422, body: { code: 'VALIDATION', status: 422, errors: [{ field: 'stages', code: 'REQUIRED' }] } }),
    },
  ],
};

function setup(answers: Record<string, [number, unknown]> = {}) {
  const server = fakeServer(answers);
  const store = new LocalStore(memoryPersistence());
  const api = new ApiClient('http://test/api/v1', new MemoryTokenStorage(), () => {}, withLocalRoutes(server.fetch, store, layer));
  return { api, store, calls: server.calls };
}

describe('local routes (new organizer features answered on the device)', () => {
  it('sends a request it does not know to the server unchanged', async () => {
    const { api, calls } = setup({ 'GET /me': [200, { id: 'u1' }] });
    await expect(api.get('/me')).resolves.toEqual({ id: 'u1' });
    expect(calls).toEqual([{ method: 'GET', path: '/me', body: undefined }]);
  });

  it('answers a local route from the device without calling the server', async () => {
    const { api, store, calls } = setup();
    await store.update('c1', (c) => {
      c.collections.flow = [{ id: 'st1' }];
    });
    await expect(api.get('/competitions/c1/flow')).resolves.toEqual([{ id: 'st1' }]);
    expect(calls).toHaveLength(0);
  });

  it('turns a local route error into an API error', async () => {
    const { api } = setup();
    await expect(api.put('/competitions/c1/flow', {})).rejects.toMatchObject({ status: 422 });
  });

  it('keeps the new competition fields on the device when an event is created', async () => {
    const { api, store, calls } = setup({ 'POST /competitions': [201, { id: 'c9', title: 'Open' }] });
    const created = await api.post('/competitions', { title: 'Open', eventStyle: 'HYBRID_RACE' });
    expect(calls[0].body).toEqual({ title: 'Open' });
    expect(created).toEqual({ id: 'c9', title: 'Open', eventStyle: 'HYBRID_RACE' });
    expect(store.competition('c9').fields).toEqual({ eventStyle: 'HYBRID_RACE' });
  });

  it('saves an update of local fields only without calling the server', async () => {
    const { api, store, calls } = setup();
    await expect(api.put('/competitions/c1', { eventStyle: 'HYBRID_RACE' })).resolves.toEqual({ id: 'c1', eventStyle: 'HYBRID_RACE' });
    expect(calls).toHaveLength(0);
    expect(store.competition('c1').fields).toEqual({ eventStyle: 'HYBRID_RACE' });
  });

  it('sends the other fields of an update to the server and keeps the local ones', async () => {
    const { api, store, calls } = setup({ 'PUT /competitions/c1': [200, { id: 'c1', title: 'New' }] });
    const updated = await api.put('/competitions/c1', { title: 'New', eventStyle: 'FUNCTIONAL_FITNESS' });
    expect(calls[0].body).toEqual({ title: 'New' });
    expect(updated).toEqual({ id: 'c1', title: 'New', eventStyle: 'FUNCTIONAL_FITNESS' });
    expect(store.competition('c1').fields).toEqual({ eventStyle: 'FUNCTIONAL_FITNESS' });
  });

  it('adds the local fields to a competition read from the server', async () => {
    const { api, store } = setup({ 'GET /competitions/c1': [200, { id: 'c1', title: 'Open' }] });
    await store.update('c1', (c) => {
      c.fields.eventStyle = 'HYBRID_RACE';
    });
    await expect(api.get('/competitions/c1')).resolves.toEqual({ id: 'c1', title: 'Open', eventStyle: 'HYBRID_RACE' });
  });

  it('adds the local fields to each competition of a list', async () => {
    const { api, store } = setup({ 'GET /competitions': [200, [{ id: 'c1' }, { id: 'c2' }]] });
    await store.update('c1', (c) => {
      c.fields.eventStyle = 'HYBRID_RACE';
    });
    await expect(api.get('/competitions', { filter: 'ALL' })).resolves.toEqual([{ id: 'c1', eventStyle: 'HYBRID_RACE' }, { id: 'c2' }]);
  });

  it('leaves a server error untouched and keeps nothing', async () => {
    const { api, store } = setup({ 'POST /competitions': [422, { code: 'VALIDATION', status: 422, errors: [] }] });
    await expect(api.post('/competitions', { title: '', eventStyle: 'HYBRID_RACE' })).rejects.toMatchObject({ status: 422 });
    expect(store.competition('c9').fields).toEqual({});
  });

  it('does not treat a page of the competition as the competition itself', async () => {
    const { api, store } = setup({ 'GET /competitions/c1/dashboard': [200, { participants: 3 }] });
    await store.update('c1', (c) => {
      c.fields.eventStyle = 'HYBRID_RACE';
    });
    await expect(api.get('/competitions/c1/dashboard')).resolves.toEqual({ participants: 3 });
  });

  it('keeps the new category fields on the device when a category is created', async () => {
    const { api, store, calls } = setup({ 'POST /competitions/c1/categories': [201, { id: 'k9', name: 'RX Teams' }] });
    const created = await api.post('/competitions/c1/categories', { name: 'RX Teams', type: 'TEAM' });
    expect(calls[0].body).toEqual({ name: 'RX Teams' });
    expect(created).toEqual({ id: 'k9', name: 'RX Teams', type: 'TEAM' });
    expect(store.competition('c1').categories.k9).toEqual({ type: 'TEAM' });
  });

  it('saves a category update of local fields only without calling the server', async () => {
    const { api, store, calls } = setup();
    await expect(api.put('/competitions/c1/categories/k1', { earlyPrice: 30000 })).resolves.toEqual({ id: 'k1', earlyPrice: 30000 });
    expect(calls).toHaveLength(0);
    expect(store.competition('c1').categories.k1).toEqual({ earlyPrice: 30000 });
  });

  it('adds the local category fields to the categories of a competition read from the server', async () => {
    const { api, store } = setup({ 'GET /competitions/c1': [200, { id: 'c1', categories: [{ id: 'k1', name: 'RX' }, { id: 'k2', name: 'Scaled' }] }] });
    await store.update('c1', (c) => {
      c.categories.k1 = { type: 'TEAM' };
    });
    await expect(api.get('/competitions/c1')).resolves.toEqual({ id: 'c1', categories: [{ id: 'k1', name: 'RX', type: 'TEAM' }, { id: 'k2', name: 'Scaled' }] });
  });
});
