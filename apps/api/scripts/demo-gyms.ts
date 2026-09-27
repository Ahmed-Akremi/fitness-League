/**
 * Demo extension (NEVER in production): fictional gyms with generated logos, Bodynade with coaches and WODs,
 * CrossFit & Hyrox sessions. Idempotent: skipped when Bodynade already exists. Runs after the base demo users exist.
 * Writes go through the public API, except demo shortcuts (roles, gym rows, memberships), written directly.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { uuidv7 } from '../src/common/ids/uuid';
import { Motif, renderLogoPng } from './demo-logos';

type Call = <T>(method: string, path: string, token?: string, body?: unknown, headers?: Record<string, string>) => Promise<T>;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

export async function demoGyms(prisma: PrismaClient, api: string, call: Call, password: string): Promise<void> {
  if (await prisma.gym.findUnique({ where: { slug: 'bodynade' } })) {
    console.log('Demo gyms already present.');
    return;
  }
  const user = async (username: string) => prisma.user.findUniqueOrThrow({ where: { username } });
  const login = async (username: string) =>
    (await call<{ accessToken: string }>('POST', '/auth/login', undefined, { email: `${username}@demo.fitnessleague.test`, password })).accessToken;

  // Demo shortcut: gym owners (a verified gym's owner is a GYM_ADMIN). Log in again so the token carries the role.
  for (const u of ['ahmed', 'karim']) await prisma.user.update({ where: { username: u }, data: { role: 'GYM_ADMIN' } });
  const tok: Record<string, string> = {};
  for (const u of ['ahmed', 'yassine', 'nour', 'sami', 'karim']) tok[u] = await login(u);
  const ids: Record<string, string> = {};
  for (const u of Object.keys(tok)) ids[u] = (await user(u)).id;

  const sportId = new Map((await prisma.sport.findMany()).map((s) => [s.code, s.id]));
  const newGyms: { slug: string; name: string; gov: string; owner: string; sports: string[]; palette: [string, string]; motif: Motif; address: string; instagram: string }[] = [
    { slug: 'bodynade', name: 'Bodynade', gov: 'TN-11', owner: 'ahmed', sports: ['CROSSFIT', 'HYROX', 'BODYBUILDING'], palette: ['#C6F432', '#3DDC97'], motif: 'bolt', address: 'Les Berges du Lac, Tunis', instagram: 'https://instagram.com/bodynade.demo' },
    { slug: 'sfax-hybrid-box', name: 'Sfax Hybrid Box', gov: 'TN-61', owner: 'karim', sports: ['CROSSFIT', 'HYROX'], palette: ['#FF8A3D', '#FF3D71'], motif: 'hex', address: 'Route de Tunis km 3, Sfax', instagram: 'https://instagram.com/sfaxhybrid.demo' },
    { slug: 'nabeul-run-row', name: 'Nabeul Run & Row', gov: 'TN-21', owner: 'karim', sports: ['RUNNING', 'HYROX'], palette: ['#3DA9FC', '#7B61FF'], motif: 'wave', address: 'Avenue Habib Bourguiba, Nabeul', instagram: 'https://instagram.com/nabeulrun.demo' },
    { slug: 'bizerte-barbell', name: 'Bizerte Barbell', gov: 'TN-23', owner: 'karim', sports: ['POWERLIFTING', 'WEIGHT_TRAINING'], palette: ['#F5F5F5', '#9AA0A6'], motif: 'bar', address: 'Corniche, Bizerte', instagram: 'https://instagram.com/bizertebarbell.demo' },
    { slug: 'monastir-move', name: 'Monastir Move', gov: 'TN-52', owner: 'karim', sports: ['FUNCTIONAL', 'CROSSFIT'], palette: ['#FFD166', '#EF476F'], motif: 'ring', address: 'Marina, Monastir', instagram: 'https://instagram.com/monastirmove.demo' },
  ];
  for (const g of newGyms) {
    const gov = await prisma.governorate.findUnique({ where: { code: g.gov }, include: { cities: { orderBy: { code: 'asc' } } } });
    if (!gov) throw new Error(`Unknown governorate ${g.gov}`);
    await prisma.gym.create({
      data: { id: uuidv7(), slug: g.slug, name: g.name, governorateId: gov.id, cityId: gov.cities[0]!.id, addressLine: g.address, socialLinks: { instagram: g.instagram }, status: 'VERIFIED', verifiedAt: new Date(), ownerUserId: ids[g.owner] },
    });
  }
  // Catalog gyms get an owner too, so their logo goes through the same API path.
  const existing: { slug: string; palette: [string, string]; motif: Motif }[] = [
    { slug: 'carthage-strength-lab', palette: ['#9B5DE5', '#00BBF9'], motif: 'peak' },
    { slug: 'ariana-fit-house', palette: ['#06D6A0', '#118AB2'], motif: 'ring' },
    { slug: 'sahel-iron-club', palette: ['#F15BB5', '#FEE440'], motif: 'hex' },
  ];
  await prisma.gym.updateMany({ where: { slug: { in: existing.map((e) => e.slug) } }, data: { ownerUserId: ids.karim } });

  for (const g of [...newGyms.map((g) => ({ slug: g.slug, palette: g.palette, motif: g.motif, sports: g.sports })), ...existing.map((e) => ({ ...e, sports: undefined }))]) {
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: g.slug } });
    const owner = gym.ownerUserId === ids.ahmed ? tok.ahmed! : tok.karim!;
    if (g.sports) await call('PATCH', `/gyms/${gym.id}`, owner, { sportIds: g.sports.map((c) => sportId.get(c)!) });
    const png = await renderLogoPng(gym.name, g.palette, g.motif);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'logo.png');
    const res = await fetch(`${api}/gyms/${gym.id}/logo`, { method: 'PUT', headers: { authorization: `Bearer ${owner}` }, body: form });
    if (!res.ok) throw new Error(`logo upload ${g.slug} → ${res.status} ${await res.text()}`);
  }

  // Memberships (demo shortcut: approved directly). One gym per athlete.
  const bodynade = await prisma.gym.findUniqueOrThrow({ where: { slug: 'bodynade' } });
  const join = async (username: string, slug: string, role: 'MEMBER' | 'COACH') => {
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug } });
    await prisma.gymMember.updateMany({ where: { userId: ids[username], status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'LEFT', leftAt: new Date() } });
    await prisma.gymMember.create({ data: { id: uuidv7(), gymId: gym.id, userId: ids[username]!, status: 'APPROVED', approvedAt: new Date(), role } });
    await prisma.profile.update({ where: { userId: ids[username] }, data: { primaryGymId: gym.id } });
  };
  await join('ahmed', 'bodynade', 'COACH');
  await join('yassine', 'bodynade', 'MEMBER');
  await join('nour', 'bodynade', 'COACH');
  await join('sami', 'sfax-hybrid-box', 'MEMBER');
  await join('karim', 'monastir-move', 'MEMBER');

  // Bodynade WODs. "Friday AMRAP 20" is created open, scored, then closed (the API only takes scores while open).
  const crossfit = sportId.get('CROSSFIT')!;
  const wods = `/gyms/${bodynade.id}/wods`;
  const amrap = await call<{ id: string }>('POST', wods, tok.ahmed, {
    title: 'Friday AMRAP 20',
    description: 'AMRAP 20 min : 10 wall balls (9/6 kg), 10 box jumps (60/50 cm), 200 m de course.',
    scoreType: 'AMRAP',
    timeCapS: 1200,
    startsAt: hoursAgo(8 * 24),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    sportId: crossfit,
  });
  const score = (who: string, wodId: string, body: Record<string, unknown>) =>
    call('PUT', `${wods}/${wodId}/score`, tok[who], { clientId: randomUUID(), ...body });
  await score('yassine', amrap.id, { division: 'RX', rounds: 7, reps: 212, performedAt: hoursAgo(5 * 24 + 3) });
  await score('ahmed', amrap.id, { division: 'RX', rounds: 6, reps: 205, performedAt: hoursAgo(5 * 24 + 2) });
  await score('nour', amrap.id, { division: 'SCALED', rounds: 6, reps: 188, performedAt: hoursAgo(5 * 24 + 1) });
  await call('PATCH', `${wods}/${amrap.id}`, tok.ahmed, { endsAt: hoursAgo(24) });

  const burner = await call<{ id: string }>('POST', wods, tok.ahmed, {
    title: 'Bodynade Burner',
    description: '21-15-9 : thrusters (43/29 kg), burpees au-dessus de la barre, calories rameur.',
    scoreType: 'FOR_TIME',
    timeCapS: 900,
    startsAt: hoursAgo(24),
    endsAt: new Date(Date.now() + 6 * 24 * 3_600_000).toISOString(),
    sportId: crossfit,
  });
  await score('yassine', burner.id, { division: 'RX', timeS: 452, performedAt: hoursAgo(4) });
  await score('nour', burner.id, { division: 'SCALED', timeS: 530, performedAt: hoursAgo(3) });

  // Ahmed's benchmark sessions: Fran and a full Hyrox race (records in m:ss / h:mm:ss).
  const ex = new Map((await prisma.exercise.findMany()).map((e) => [e.code, e.id]));
  const workout = (sport: string, type: string, hAgo: number, durationS: number, exercises: { exerciseId: string; sets: { durationS: number }[] }[]) => {
    const clientId = randomUUID();
    return call('POST', '/workouts', tok.ahmed, { clientId, sportId: sportId.get(sport)!, workoutType: type, performedAt: hoursAgo(hAgo), durationS, exercises }, { 'Idempotency-Key': clientId });
  };
  await workout('CROSSFIT', 'WOD', 216, 1200, [{ exerciseId: ex.get('WOD_FRAN')!, sets: [{ durationS: 355 }] }]);
  await workout('CROSSFIT', 'WOD', 50, 1200, [{ exerciseId: ex.get('WOD_FRAN')!, sets: [{ durationS: 331 }] }]);
  const stations: [string, number][] = [
    ['HYROX_SKIERG_1000', 290],
    ['HYROX_SLED_PUSH', 240],
    ['HYROX_SLED_PULL', 300],
    ['HYROX_BURPEE_BROAD_JUMP', 330],
    ['HYROX_ROW_1000', 290],
    ['HYROX_FARMERS_CARRY', 150],
    ['HYROX_SANDBAG_LUNGES', 320],
    ['HYROX_WALL_BALLS', 360],
  ];
  const race = (total: number, slower: number) => [
    { exerciseId: ex.get('HYROX_OPEN')!, sets: [{ durationS: total }] },
    { exerciseId: ex.get('HYROX_RUN_1K')!, sets: Array.from({ length: 8 }, (_, i) => ({ durationS: 360 + i * 4 + slower })) },
    ...stations.map(([code, s]) => ({ exerciseId: ex.get(code)!, sets: [{ durationS: s + slower }] })),
  ];
  await workout('HYROX', 'RACE', 480, 5520, race(5520, 15));
  await workout('HYROX', 'RACE', 75, 5280, race(5280, 0));

  console.log('Demo gyms ready: Bodynade (Tunis), coaches ahmed & nour; 8 gyms with logos.');
}
