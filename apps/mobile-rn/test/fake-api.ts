import { ApiClient, type Fetch } from '../src/core/api/client';
import { MemoryTokenStorage, type TokenStorage } from '../src/core/auth/token-storage';

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: any;
}

type Handler = (req: FakeRequest) => [number, unknown];

/** Scripted HTTP backend for tests: routes "METHOD /path" to handlers and records every request. */
export class FakeBackend {
  readonly routes = new Map<string, Handler>();
  readonly requests: FakeRequest[] = [];
  offline = false;

  on(method: string, path: string, h: Handler | [number, unknown]) {
    this.routes.set(`${method} ${path}`, typeof h === 'function' ? h : () => h);
    return this;
  }

  readonly fetch: Fetch = async (url, init) => {
    const u = new URL(url);
    const req: FakeRequest = {
      method: init.method ?? 'GET',
      path: u.pathname,
      query: u.searchParams,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    };
    this.requests.push(req);
    if (this.offline) throw new TypeError('Network request failed');
    const handler = this.routes.get(`${req.method} ${req.path}`);
    const [status, body] = handler ? handler(req) : [404, { code: 'NOT_FOUND' }];
    return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };

  calls(method: string, path: string) {
    return this.requests.filter((r) => r.method === method && r.path === path);
  }
}

export function fakeClient(backend: FakeBackend, opts: { tokens?: TokenStorage; onExpired?: () => void } = {}) {
  return new ApiClient('http://test', opts.tokens ?? new MemoryTokenStorage(), opts.onExpired ?? (() => {}), backend.fetch);
}

export const session = (suffix = '1') => ({ accessToken: `access-${suffix}`, refreshToken: `refresh-${suffix}`, userId: 'u1', expiresIn: 900 });
