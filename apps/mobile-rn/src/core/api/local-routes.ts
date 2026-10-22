import type { Fetch, Json } from './client';
import type { LocalStore } from './local-store';

/**
 * The local mock layer (design 2026-10-22): a fetch wrapper in front of the real server (or the offline demo).
 * - Local routes: new organizer resources the API does not have yet, answered from the device.
 * - Competition overlay: new fields of a competition are kept on the device. They are taken out of the body sent
 *   to the server and added back to what the server returns, so screens already use the final shape.
 * When a route or a field moves to the server, its entry leaves the layer; screens do not change.
 */

export type LocalRequest = { method: string; path: string; params: Record<string, string>; query: URLSearchParams; body: any };
export type LocalAnswer = { status: number; body?: unknown };
export type LocalRoute = {
  method: string;
  /** `/competitions/:id/flow`: segments starting with « : » are parameters. */
  path: string;
  handle: (req: LocalRequest, store: LocalStore) => LocalAnswer | Promise<LocalAnswer>;
};
export type LocalLayer = { routes: LocalRoute[]; competitionFields: string[] };

const API_PREFIX = /^\/api\/v1/;

export function withLocalRoutes(inner: Fetch, store: LocalStore, layer: LocalLayer): Fetch {
  return async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace(API_PREFIX, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = jsonBody(init);

    for (const route of layer.routes) {
      const params = route.method === method ? match(route.path, path) : null;
      if (!params) continue;
      await store.ready();
      const answer = await route.handle({ method, path, params, query: u.searchParams, body }, store);
      return json(answer.status, answer.body);
    }

    const fields = layer.competitionFields;
    if (!fields.length) return inner(url, init);
    const detail = match('/competitions/:id', path);

    if (path === '/competitions' && method === 'POST' && body !== undefined) {
      const { rest, local } = split(body, fields);
      if (!Object.keys(local).length) return inner(url, init);
      const res = await inner(url, { ...init, body: JSON.stringify(rest) });
      if (!res.ok) return res;
      const created = await readJson(res);
      if (typeof created?.id === 'string') await keep(store, created.id, local);
      return json(res.status, { ...created, ...local });
    }

    if (detail && (method === 'PUT' || method === 'PATCH') && body !== undefined) {
      const { rest, local } = split(body, fields);
      if (!Object.keys(local).length) return inner(url, init);
      if (!Object.keys(rest).length) {
        await keep(store, detail.id, local);
        return json(200, { id: detail.id, ...local });
      }
      const res = await inner(url, { ...init, body: JSON.stringify(rest) });
      if (!res.ok) return res;
      const updated = await readJson(res);
      await keep(store, detail.id, local);
      return json(res.status, { ...updated, ...local });
    }

    if (method === 'GET' && (detail || path === '/competitions')) {
      const res = await inner(url, init);
      if (!res.ok) return res;
      const data = await readJson(res);
      await store.ready();
      const add = (item: unknown) => withFields(store, fields, item);
      if (detail) return json(res.status, add(data));
      if (Array.isArray(data)) return json(res.status, data.map(add));
      if (Array.isArray(data?.data)) return json(res.status, { ...data, data: data.data.map(add) });
      return json(res.status, data);
    }

    return inner(url, init);
  };
}

/** `{ id }` when `/competitions/:id` matches `/competitions/c1`; null when the segments differ. */
function match(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/');
  const got = path.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) params[want[i].slice(1)] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

/** The JSON body of a request; uploads (FormData) and empty bodies give undefined. */
function jsonBody(init: RequestInit): any {
  if (typeof init.body !== 'string') return undefined;
  try {
    return JSON.parse(init.body);
  } catch {
    return undefined;
  }
}

function split(body: unknown, fields: string[]): { rest: Json; local: Json } {
  const rest: Json = {};
  const local: Json = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { rest: body as Json, local };
  for (const [k, v] of Object.entries(body)) (fields.includes(k) ? local : rest)[k] = v;
  return { rest, local };
}

function keep(store: LocalStore, id: string, local: Json) {
  return store.update(id, (c) => {
    Object.assign(c.fields, local);
  });
}

function withFields(store: LocalStore, fields: string[], item: unknown): unknown {
  if (!item || typeof item !== 'object' || typeof (item as Json).id !== 'string') return item;
  const saved = store.competition((item as Json).id).fields;
  const picked = Object.fromEntries(fields.filter((f) => f in saved).map((f) => [f, saved[f]]));
  return { ...item, ...picked };
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
