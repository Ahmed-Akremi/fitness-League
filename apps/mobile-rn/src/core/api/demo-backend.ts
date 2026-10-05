import type { Fetch } from './client';

type Recorded = Record<string, unknown>;

const IGNORED_QUERY = new Set(['limit', 'cursor']);
const EMPTY_PAGE = { data: [] as unknown[], page: { nextCursor: null, hasMore: false } };

/**
 * Offline demo (EXPO_PUBLIC_DEMO=true): answers every request from responses recorded against the local API
 * with demo data (assets/demo/api.json), so the app can be tried on a phone without any server.
 * Any email/password signs in as the demo athlete; writes succeed but change nothing.
 */
export function demoFetch(recorded: Recorded, delayMs = 150): Fetch {
  return async (url, init) => {
    await new Promise((r) => setTimeout(r, delayMs));
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api\/v1/, '');
    const [status, body] = answer(recorded, (init.method ?? 'GET').toUpperCase(), path, u.searchParams);
    return new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
}

function key(method: string, path: string, query: URLSearchParams): string {
  const q = [...query.entries()].filter(([k]) => !IGNORED_QUERY.has(k)).map(([k, v]) => `${k}=${v}`).sort();
  return `${method} ${path}${q.length ? `?${q.join('&')}` : ''}`;
}

function answer(recorded: Recorded, method: string, path: string, query: URLSearchParams): [number, unknown] {
  if (path.startsWith('/auth/')) {
    return ['/auth/login', '/auth/register', '/auth/refresh', '/auth/google', '/auth/apple'].includes(path)
      ? [200, recorded['POST /auth/login']]
      : [204, null];
  }
  if (method === 'GET') {
    if (path === '/search/athletes') return [200, search(recorded, (query.get('q') ?? '').toLowerCase())];
    const exact = recorded[key(method, path, query)];
    if (exact != null) return [200, exact];
    // Same path with other filters (sort, search text…): the closest recorded answer.
    const prefix = `GET ${path}`;
    for (const [k, v] of Object.entries(recorded)) if (k === prefix || k.startsWith(`${prefix}?`)) return [200, v];
    return [404, { code: 'NOT_FOUND', title: 'Not available in the offline demo', status: 404 }];
  }
  // Writes: accepted but not stored.
  if (method === 'POST' && path === '/workouts') return [201, firstWorkout(recorded)];
  if (method === 'POST' && path === '/workouts/sync') return [200, { results: [] }];
  return [200, {}];
}

function search(recorded: Recorded, q: string) {
  const seen = new Set<string>();
  const hits: unknown[] = [];
  for (const [k, v] of Object.entries(recorded)) {
    if (!k.startsWith('GET /search/athletes')) continue;
    for (const a of (v as { data: Record<string, unknown>[] }).data) {
      const text = `${a.username} ${a.fullName}`.toLowerCase();
      if (text.includes(q) && !seen.has(String(a.id))) {
        seen.add(String(a.id));
        hits.push(a);
      }
    }
  }
  return { ...EMPTY_PAGE, data: hits };
}

function firstWorkout(recorded: Recorded) {
  for (const [k, v] of Object.entries(recorded)) if (/^GET \/workouts\/[^/]+$/.test(k)) return v;
  return {};
}
