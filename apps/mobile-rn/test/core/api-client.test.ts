import { ApiError } from '../../src/core/api/errors';
import { MemoryTokenStorage } from '../../src/core/auth/token-storage';
import { FakeBackend, fakeClient, session } from '../fake-api';

describe('ApiClient', () => {
  it('refreshes once for concurrent 401s and retries both requests', async () => {
    const backend = new FakeBackend();
    const tokens = new MemoryTokenStorage();
    const api = fakeClient(backend, { tokens });
    await api.setSession(session('old'));

    backend.on('GET', '/me', (req) => (req.headers.Authorization === 'Bearer access-new' ? [200, { ok: true }] : [401, { code: 'TOKEN_EXPIRED' }]));
    backend.on('POST', '/auth/refresh', (req) => {
      expect(req.body).toEqual({ refreshToken: 'refresh-old' });
      return [200, session('new')];
    });

    const results = await Promise.all([api.get('/me'), api.get('/me')]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    // Refresh tokens are single use on the server: two refreshes would be flagged as token theft.
    expect(backend.calls('POST', '/auth/refresh')).toHaveLength(1);
    expect(await tokens.readRefreshToken()).toBe('refresh-new');
  });

  it('signals session expiry when the refresh token is refused', async () => {
    const backend = new FakeBackend();
    let expired = 0;
    const api = fakeClient(backend, { onExpired: () => expired++ });
    await api.setSession(session());
    backend.on('GET', '/me', [401, { code: 'TOKEN_EXPIRED' }]);
    backend.on('POST', '/auth/refresh', [401, { code: 'TOKEN_REUSED' }]);

    await expect(api.get('/me')).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(expired).toBe(1);
    expect(await api.tokens.readRefreshToken()).toBeNull();
  });

  it('keeps the refresh token when the refresh fails for lack of network', async () => {
    const backend = new FakeBackend();
    const tokens = new MemoryTokenStorage('refresh-1');
    const api = fakeClient(backend, { tokens });
    backend.offline = true;
    expect(await api.restore()).toBe(false);
    expect(await tokens.readRefreshToken()).toBe('refresh-1');
  });

  it('never retries /auth/* requests', async () => {
    const backend = new FakeBackend();
    const api = fakeClient(backend);
    await api.setSession(session());
    backend.on('POST', '/auth/logout', [401, { code: 'TOKEN_EXPIRED' }]);
    await expect(api.post('/auth/logout', {})).rejects.toBeInstanceOf(ApiError);
    expect(backend.calls('POST', '/auth/refresh')).toHaveLength(0);
  });

  it('maps problem+json to typed errors without leaking server text', async () => {
    const backend = new FakeBackend();
    const api = fakeClient(backend);
    backend.on('POST', '/auth/register', [422, { code: 'VALIDATION_FAILED', errors: [{ field: 'username', code: 'MATCHES' }], title: 'internal detail' }]);
    const e = await api.post('/auth/register', {}).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiError);
    const err = e as ApiError;
    expect(err.kind).toBe('client');
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fieldCode('username')).toBe('MATCHES');

    backend.offline = true;
    await expect(api.get('/me')).rejects.toMatchObject({ kind: 'network' });
  });

  it('sends the chosen language and skips null query values', async () => {
    const backend = new FakeBackend().on('GET', '/workouts', [200, {}]);
    const api = fakeClient(backend);
    api.language = 'ar';
    await api.get('/workouts', { limit: 20, cursor: undefined });
    const req = backend.requests[0];
    expect(req.headers['Accept-Language']).toBe('ar');
    expect(req.query.get('limit')).toBe('20');
    expect(req.query.has('cursor')).toBe(false);
  });
});
