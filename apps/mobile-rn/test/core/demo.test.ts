import { ApiClient } from '../../src/core/api/client';
import { demoFetch } from '../../src/core/api/demo-backend';
import { MemoryTokenStorage } from '../../src/core/auth/token-storage';

const recorded = require('../../assets/demo/api.json') as Record<string, unknown>;

describe('demo backend (offline build)', () => {
  const api = () => new ApiClient('http://demo/api/v1', new MemoryTokenStorage(), () => {}, demoFetch(recorded, 0));

  it('signs in with any credentials as the demo athlete', async () => {
    const client = api();
    const s = await client.post<{ accessToken: string }>('/auth/login', { email: 'x@y.z', password: 'whatever' });
    expect(s.accessToken).toBeTruthy();
  });

  it('answers recorded GETs and ignores paging parameters', async () => {
    const me = await api().get<{ id: string }>('/me');
    expect(me.id).toBeTruthy();
    const board = await api().get<{ data: unknown[] }>('/leaderboards/national', { limit: 30, cursor: 'abc' });
    expect(Array.isArray(board.data)).toBe(true);
  });

  it('accepts writes without storing them and 404s the unknown', async () => {
    await expect(api().post('/workouts/sync', { items: [] })).resolves.toEqual({ results: [] });
    await expect(api().get('/nowhere')).rejects.toMatchObject({ status: 404 });
  });
});
