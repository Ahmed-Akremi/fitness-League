import type { Fetch, Json } from './client';
import type { LocalStore } from './local-store';

/**
 * The local mock layer (design 2026-10-22): a fetch wrapper in front of the real server (or the offline demo).
 * - Local routes: new organizer resources the API does not have yet, answered from the device.
 * - Overlays: new fields of a competition, and of its categories, are kept on the device. They are taken out of the
 *   body sent to the server and added back to what the server returns, so screens already use the final shape.
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
/**
 * `categoryFields`: new fields of a competition's categories (divisions), kept the same way per category id.
 * `registrationFields`: extras of a registration (answers, team, payment plan…), kept per registration id.
 */
export type LocalLayer = { routes: LocalRoute[]; competitionFields: string[]; categoryFields?: string[]; registrationFields?: string[] };

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
    const catFields = layer.categoryFields ?? [];
    const regFields = layer.registrationFields ?? [];
    if (!fields.length && !catFields.length && !regFields.length) return inner(url, init);
    const detail = match('/competitions/:id', path);
    const categories = match('/competitions/:id/categories', path);
    const category = match('/competitions/:id/categories/:categoryId', path);
    const register = match('/competitions/:id/register', path);
    const registrations = match('/competitions/:id/registrations', path);
    const keepCompetition = (id: string, local: Json) => store.update(id, (c) => void Object.assign(c.fields, local));
    const keepCategory = (competitionId: string) => (id: string, local: Json) =>
      store.update(competitionId, (c) => {
        c.categories[id] = { ...(c.categories[id] ?? {}), ...local };
      });
    const keepRegistration = (competitionId: string) => (id: string, local: Json) =>
      store.update(competitionId, (c) => {
        const list = c.collections.registrations ?? [];
        c.collections.registrations = [...list.filter((r) => r.id !== id), { ...(list.find((r) => r.id === id) ?? {}), id, ...local }];
      });
    const write = (local: string[], id: string | null, keep: (id: string, local: Json) => Promise<void>) => overlayWrite(inner, url, init, body, local, id, keep);

    if (body !== undefined) {
      if (path === '/competitions' && method === 'POST') return write(fields, null, keepCompetition);
      if (detail && (method === 'PUT' || method === 'PATCH')) return write(fields, detail.id, keepCompetition);
      if (categories && method === 'POST') return write(catFields, null, keepCategory(categories.id));
      if (category && (method === 'PUT' || method === 'PATCH')) return write(catFields, category.categoryId, keepCategory(category.id));
      if (register && method === 'POST') return write(regFields, null, keepRegistration(register.id));
    }

    if (method === 'GET' && registrations && regFields.length) {
      const res = await inner(url, init);
      if (!res.ok) return res;
      const data = await readJson(res);
      await store.ready();
      const extras = store.competition(registrations.id).collections.registrations ?? [];
      return json(res.status, Array.isArray(data) ? data.map((r) => withExtras(extras, regFields, r)) : data);
    }

    if (method === 'GET' && (detail || path === '/competitions')) {
      const res = await inner(url, init);
      if (!res.ok) return res;
      const data = await readJson(res);
      await store.ready();
      const add = (item: unknown) => withFields(store, fields, catFields, regFields, item);
      if (detail) return json(res.status, add(data));
      if (Array.isArray(data)) return json(res.status, data.map(add));
      if (Array.isArray(data?.data)) return json(res.status, { ...data, data: data.data.map(add) });
      return json(res.status, data);
    }

    return inner(url, init);
  };
}

/**
 * A write whose body may carry local fields: those are kept on the device and the rest goes to the server.
 * `id` is known for an update (an update of local fields only never reaches the server); a creation takes the id the
 * server gives.
 */
async function overlayWrite(inner: Fetch, url: string, init: RequestInit, body: unknown, fields: string[], id: string | null, keep: (id: string, local: Json) => Promise<void>): Promise<Response> {
  const { rest, local } = split(body, fields);
  if (!Object.keys(local).length) return inner(url, init);
  if (id && !Object.keys(rest).length) {
    await keep(id, local);
    return json(200, { id, ...local });
  }
  const res = await inner(url, { ...init, body: JSON.stringify(rest) });
  if (!res.ok) return res;
  const data = await readJson(res);
  const savedId = id ?? (typeof data?.id === 'string' ? data.id : null);
  if (savedId) await keep(savedId, local);
  return json(res.status, { ...data, ...local });
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

const pick = (saved: Json, fields: string[]) => Object.fromEntries(fields.filter((f) => f in saved).map((f) => [f, saved[f]]));

/** A registration from the server with the extras kept on the device for it. */
function withExtras(extras: Json[], fields: string[], r: unknown): unknown {
  if (!r || typeof r !== 'object' || typeof (r as Json).id !== 'string') return r;
  const saved = extras.find((x) => x.id === (r as Json).id);
  return saved ? { ...r, ...pick(saved, fields) } : r;
}

/** A competition from the server with its local fields, those of each of its categories, and the extras of « my registration ». */
function withFields(store: LocalStore, fields: string[], catFields: string[], regFields: string[], item: unknown): unknown {
  if (!item || typeof item !== 'object' || typeof (item as Json).id !== 'string') return item;
  const saved = store.competition((item as Json).id);
  const out: Json = { ...item, ...pick(saved.fields, fields) };
  if (catFields.length && Array.isArray(out.categories)) {
    out.categories = out.categories.map((k: unknown) => (k && typeof k === 'object' && typeof (k as Json).id === 'string' ? { ...k, ...pick(saved.categories[(k as Json).id] ?? {}, catFields) } : k));
  }
  if (regFields.length && out.myRegistration) out.myRegistration = withExtras(saved.collections.registrations ?? [], regFields, out.myRegistration);
  return out;
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
