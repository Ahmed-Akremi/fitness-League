import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { adminAuth, appBearer, registerUser, setupTestApp } from './helpers';

/** Organizer space (spec 2026-10-14): any app user drafts an event, only an admin publishes it. */
describe('Organizer space (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
  let n = 0;
  const draft = (over: Record<string, unknown> = {}) => ({
    title: 'Sousse Summer Throwdown',
    slug: `sousse-summer-${Date.now()}-${++n}`,
    description: 'Two days on site.',
    format: 'ONSITE',
    city: 'Sousse',
    location: 'Bodynade, Sousse',
    registrationStart: h(-1),
    registrationEnd: h(48),
    eventStart: h(72),
    eventEnd: h(96),
    registrationPrice: 30_000,
    ...over,
  });

  async function athlete(): Promise<{ id: string; token: string }> {
    const u = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: u.session.userId }, data: { emailVerifiedAt: new Date() } });
    const login = await api().post('/api/v1/auth/login').send({ email: u.body.email, password: u.body.password }).expect(200);
    return { id: u.session.userId, token: login.body.accessToken };
  }

  let user: { id: string; token: string };
  let admin: { authorization: string };
  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    user = await athlete();
    admin = await adminAuth(app, prisma);
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('a normal user drafts an event and becomes its organizer', async () => {
    const c = await api().post('/api/v1/competitions').set(bearer(user.token)).send(draft()).expect(201);
    expect(c.body.status).toBe('DRAFT');
    const staff = await prisma.competitionStaff.findMany({ where: { competitionId: c.body.id } });
    expect(staff).toEqual([expect.objectContaining({ userId: user.id, role: 'ORGANIZER' })]);
  });

  it('a judge account cannot create an event', async () => {
    const u = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: u.session.userId }, data: { role: 'JUDGE', emailVerifiedAt: new Date() } });
    const res = await api().post('/api/v1/competitions').set(await appBearer(app, prisma, u.session.userId)).send(draft()).expect(403);
    expect(res.body.detail).toBe('Judge accounts cannot create competitions');
  });

  it('the organizer cannot take the event out of draft; an admin can, then the organizer runs the next steps', async () => {
    const c = (await api().post('/api/v1/competitions').set(bearer(user.token)).send(draft()).expect(201)).body;
    await api().post(`/api/v1/competitions/${c.id}/categories`).set(bearer(user.token)).send({ name: 'RX Mixed', gender: 'MIXED' }).expect(201);
    const denied = await api().patch(`/api/v1/competitions/${c.id}/status`).set(bearer(user.token)).send({ status: 'REGISTRATION_OPEN' }).expect(403);
    expect(denied.body.detail).toBe('An admin publishes the competition');
    await api().patch(`/api/v1/admin/competitions/${c.id}/status`).set(admin).send({ status: 'REGISTRATION_OPEN' }).expect(200);
    await api().patch(`/api/v1/competitions/${c.id}/status`).set(bearer(user.token)).send({ status: 'REGISTRATION_CLOSED' }).expect(200);
  });
});
