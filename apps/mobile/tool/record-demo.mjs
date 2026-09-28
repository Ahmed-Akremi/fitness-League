// Records real GET responses from the local API (demo data, user ahmed) for the offline demo APK.
// Usage (API running with `pnpm demo-data`): node tool/record-demo.mjs assets/demo/api.json
import { writeFileSync } from 'node:fs';

const API = 'http://localhost:3000/api/v1';
const out = {};
let token;

const key = (path, q = {}) => {
  const qs = Object.entries(q).filter(([k, v]) => v != null && k !== 'limit' && k !== 'cursor').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  return `GET ${path}${qs ? '?' + qs : ''}`;
};

async function get(path, q = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(q)) if (v != null) url.searchParams.set(k, v);
  let res;
  for (;;) {
    res = await fetch(url, { headers: { authorization: `Bearer ${token}`, 'accept-language': 'fr' } });
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 1000 * Number(res.headers.get('retry-after') ?? 5)));
  }
  if (!res.ok) { console.warn('skip', res.status, path, JSON.stringify(q)); return undefined; }
  const body = await res.json();
  out[key(path, q)] = body;
  return body;
}
const items = (b) => (Array.isArray(b) ? b : b?.data ?? b?.items ?? []);

const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ahmed@demo.fitnessleague.test', password: 'demo-password-2026' }) });
const session = await login.json();
token = session.accessToken;
// The demo never checks tokens: keep real ones out of the repository.
out['POST /auth/login'] = { ...session, accessToken: 'demo-access-token', refreshToken: 'demo-refresh-token' };

const me = await get('/me');
for (const p of ['/me/ranks', '/me/lp', '/me/weekly-scores/current', '/goals', '/me/body-measurements', '/gyms/mine', '/friends', '/notifications', '/workouts']) await get(p);
for (const d of ['in', 'out']) await get('/friends/requests', { direction: d });

const records = await get('/me/records');
for (const period of ['7d', '30d', '90d', '1y', 'week', 'all']) {
  if (!(await get('/me/progress', { period }))) continue;
  for (const r of items(records)) {
    const ex = r.exerciseId ?? r.exercise?.id;
    const metric = r.metricCode ?? r.metric;
    if (ex && metric) await get(`/me/progress/metrics/${ex}/${metric}`, { period });
  }
}

const govs = await get('/ref/governorates');
for (const g of items(govs)) await get('/ref/cities', { governorateId: g.id });
const sports = await get('/ref/sports');
for (const s of items(sports)) await get('/ref/exercises', { sportId: s.id });

for (const sort of ['members', 'name', 'rank', undefined]) await get('/gyms', { sort });
const gyms = items(out[key('/gyms')] ?? out[key('/gyms', { sort: 'members' })]);
for (const g of gyms) {
  await get(`/gyms/${g.id}`);
  await get(`/gyms/${g.id}/members`);
  await get(`/gyms/${g.id}/membership-requests`);
  for (const when of ['open', 'upcoming', 'past', 'current']) {
    const wods = await get(`/gyms/${g.id}/wods`, { when });
    for (const w of items(wods)) {
      await get(`/gyms/${g.id}/wods/${w.id}`);
      for (const division of ['RX', 'SCALED']) await get(`/gyms/${g.id}/wods/${w.id}/leaderboard`, { division });
    }
  }
  await get(`/leaderboards/gyms/${g.id}`);
  await get(`/leaderboards/gyms/${g.id}/me`);
}

await get('/leaderboards/national');
await get('/leaderboards/national/me');
await get('/leaderboards/friends');
await get('/leaderboards/friends/me');
for (const g of items(govs)) {
  await get(`/leaderboards/governorates/${g.id}`);
  await get(`/leaderboards/governorates/${g.id}/me`);
}

for (const status of [undefined, 'ACTIVE', 'PENDING', 'COMPLETED']) {
  const b = await get('/battles', { status });
  for (const x of items(b)) await get(`/battles/${x.id}`);
}
for (const w of items(out[key('/workouts')])) {
  await get(`/workouts/${w.id}`);
  await get(`/workouts/${w.id}/points`);
}
for (const u of ['ahmed', 'yassine', 'nour', 'sami', 'karim']) await get(`/users/${u}`);
for (const q of ['ah', 'ya', 'no', 'sa', 'ka', 'de']) await get('/search/athletes', { q });

// Media URLs point at the recording machine: drop them so the app shows its initials fallback.
writeFileSync(process.argv[2], JSON.stringify(out).replace(/"(logoUrl|avatarUrl|photoUrl)":"http[^"]*"/g, '"$1":null'));
console.log(Object.keys(out).length, 'responses; user', me?.username ?? me?.profile?.username);
