import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { uuidv7 } from '../src/common/ids/uuid';
import { registerUser, setupTestApp } from './helpers';

describe('Gym directory (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  let token: string;

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    token = (await registerUser(app, prisma)).session.accessToken;
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('filters by sport, searches without accents and escapes LIKE wildcards', async () => {
    const byPl = await api().get('/api/v1/gyms?sport=POWERLIFTING&limit=50').set(bearer(token)).expect(200);
    expect(byPl.body.data.map((g: { slug: string }) => g.slug).sort()).toEqual(['carthage-strength-lab', 'sahel-iron-club']);
    expect(byPl.body.data[0].sports.map((s: { code: string }) => s.code)).toContain('POWERLIFTING');

    const gov = await prisma.governorate.findUniqueOrThrow({ where: { code: 'TN-51' }, include: { cities: true } });
    await prisma.gym.create({ data: { id: uuidv7(), name: 'Kalâa Box', slug: 'kalaa-box', governorateId: gov.id, cityId: gov.cities[0]!.id, status: 'VERIFIED' } });
    expect((await api().get('/api/v1/gyms?q=kalaa').set(bearer(token)).expect(200)).body.data.map((g: { slug: string }) => g.slug)).toEqual(['kalaa-box']);
    expect((await api().get('/api/v1/gyms?q=%25').set(bearer(token)).expect(200)).body.data).toEqual([]);
    expect((await api().get('/api/v1/gyms?q=_').set(bearer(token)).expect(200)).body.data).toEqual([]);
    await api().get('/api/v1/gyms?sport=NOPE').set(bearer(token)).expect(422);
  });

  it('sorts by members with a stable cursor across pages', async () => {
    const first = await api().get('/api/v1/gyms?sort=members&limit=2').set(bearer(token)).expect(200);
    const second = await api().get(`/api/v1/gyms?sort=members&limit=2&cursor=${encodeURIComponent(first.body.page.nextCursor)}`).set(bearer(token)).expect(200);
    const all = [...first.body.data, ...second.body.data];
    expect(all).toHaveLength(4);
    expect(new Set(all.map((g: { id: string }) => g.id)).size).toBe(all.length);
    const counts = all.map((g: { membersCount: number }) => g.membersCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it('returns membership state, manage flag and no private contact details', async () => {
    const athlete = await registerUser(app, prisma);
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: 'sahel-iron-club' } });
    await prisma.gym.update({ where: { id: gym.id }, data: { contactPhone: '+21673111111', addressLine: '12 rue de la Plage' } });
    const before = await api().get(`/api/v1/gyms/${gym.id}`).set(bearer(athlete.session.accessToken)).expect(200);
    expect(before.body).toMatchObject({ myMembership: { status: 'NONE', role: null }, canManage: false, addressLine: '12 rue de la Plage', rank: null });
    expect(JSON.stringify(before.body)).not.toContain('+21673111111');
    await api().post(`/api/v1/gyms/${gym.id}/membership`).set(bearer(athlete.session.accessToken)).expect(201);
    const after = await api().get(`/api/v1/gyms/${gym.id}`).set(bearer(athlete.session.accessToken)).expect(200);
    expect(after.body.myMembership).toEqual({ status: 'PENDING', role: null });
  });

  it('lets the gym admin set the sports offered', async () => {
    const owner = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: owner.session.userId }, data: { role: 'GYM_ADMIN' } });
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: 'ariana-fit-house' } });
    await prisma.gym.update({ where: { id: gym.id }, data: { ownerUserId: owner.session.userId } });
    const crossfit = await prisma.sport.findUniqueOrThrow({ where: { code: 'CROSSFIT' } });
    const res = await api().patch(`/api/v1/gyms/${gym.id}`).set(bearer(owner.session.accessToken)).send({ sportIds: [crossfit.id] }).expect(200);
    expect(res.body.sports.map((s: { code: string }) => s.code)).toEqual(['CROSSFIT']);
    expect(res.body.canManage).toBe(true);
    await api().patch(`/api/v1/gyms/${gym.id}`).set(bearer(owner.session.accessToken)).send({ sportIds: [uuidv7()] }).expect(422);
  });
});
