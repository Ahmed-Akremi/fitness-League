import { AdminApi, ApiError } from './api';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('AdminApi', () => {
  it('refreshes once for concurrent expired requests and retries them', async () => {
    let refreshes = 0;
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/admin/auth/refresh')) {
        refreshes++;
        return json(200, { accessToken: 'new', refreshToken: 'r2', userId: 'u' });
      }
      const auth = (init?.headers as Record<string, string>).authorization;
      return auth === 'Bearer new' ? json(200, { ok: true }) : json(401, { code: 'TOKEN_EXPIRED' });
    });
    const storage = memoryStorage();
    const api = new AdminApi('/api/v1', fetchFn as typeof fetch, storage);
    api.setSession({ accessToken: 'old', refreshToken: 'r1', userId: 'u' });

    const results = await Promise.all([api.get('/admin/stats/overview'), api.get('/admin/users')]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
    expect(storage.getItem('fl_admin_refresh')).toBe('r2');
  });

  it('throws typed problem errors and reports a lost session', async () => {
    const lost = vi.fn();
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => (String(url).endsWith('/refresh') ? json(401, { code: 'TOKEN_REUSED' }) : json(401, { code: 'TOKEN_EXPIRED' })));
    const api = new AdminApi('/api/v1', fetchFn as typeof fetch, memoryStorage());
    api.onSessionLost = lost;
    api.setSession({ accessToken: 'a', refreshToken: 'r', userId: 'u' });
    await expect(api.get('/admin/users')).rejects.toBeInstanceOf(ApiError);
    expect(lost).toHaveBeenCalledOnce();
    expect(api.signedIn).toBe(false);
  });
});
