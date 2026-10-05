import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClockService } from '../src/common/clock/clock.service';
import { TokenService } from '../src/modules/auth/token.service';
import { registerUser, setupTestApp } from './helpers';

/** User-made leagues (docs §3.10): invite code, member cap, preset-based ranking over the period. */
describe('Private leagues (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clock: jest.SpyInstance<Date, []>;
  const api = () => request(app.getHttpServer());
  const setNow = (iso: string) => clock.mockReturnValue(new Date(iso));
  const auth = async (userId: string) => ({ authorization: `Bearer ${(await app.get(TokenService).signAccess({ sub: userId, role: 'USER', sv: 1 })).token}` });

  async function athlete() {
    const { session } = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: session.userId }, data: { emailVerifiedAt: new Date('2026-08-01T00:00:00Z') } });
    return session.userId as string;
  }

  async function week(userId: string, weekStart: string, total: number, consistency: number, seasonId: string) {
    await prisma.weeklyScore.create({
      data: { id: randomUUID(), userId, weekStart: new Date(`${weekStart}T00:00:00Z`), seasonId, ruleSetVersion: 1, progressC: 50, consistencyC: consistency, performanceC: 50, total, breakdown: {}, status: 'FINAL' },
    });
  }

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    clock = jest.spyOn(app.get(ClockService), 'now');
    setNow('2027-01-06T10:00:00Z');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await prisma?.$disconnect();
  });

  it('owner creates a private league, friends join by code, ranking follows the preset', async () => {
    const [owner, b, c, outsider] = [await athlete(), await athlete(), await athlete(), await athlete()];
    const created = await api()
      .post('/api/v1/leagues')
      .set(await auth(owner))
      .send({ name: 'Lac 2 lifters', scoringPreset: 'CONSISTENCY', maxMembers: 3, startsAt: '2027-01-03T23:00:00Z', endsAt: '2027-02-28T23:00:00Z' })
      .expect(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({ visibility: 'PRIVATE', members: 1, myRole: 'OWNER', inviteCode: expect.stringMatching(/^[A-Z2-9]{8}$/) });
    const code = created.body.inviteCode as string;

    // Private: invisible without the code.
    await api().get(`/api/v1/leagues/${id}`).set(await auth(b)).expect(404);
    await api().post(`/api/v1/leagues/${id}/join`).set(await auth(b)).expect(404);
    await api().post('/api/v1/leagues/join-by-code').set(await auth(b)).send({ code: 'NOPE2345' }).expect(422);
    const joined = await api().post('/api/v1/leagues/join-by-code').set(await auth(b)).send({ code: code.toLowerCase() }).expect(200);
    expect(joined.body).toMatchObject({ id, members: 2, myRole: 'MEMBER' });
    await api().post('/api/v1/leagues/join-by-code').set(await auth(c)).send({ code }).expect(200);
    const full = await api().post('/api/v1/leagues/join-by-code').set(await auth(outsider)).send({ code }).expect(409);
    expect(full.body.reason).toBe('LEAGUE_FULL');

    // Weekly scores: b has the higher totals, c the better consistency; the week before the league does not count.
    const season = await prisma.season.create({ data: { id: randomUUID(), name: 'Test 2027', startsAt: new Date('2027-01-01T00:00:00Z'), endsAt: new Date('2027-03-31T00:00:00Z'), status: 'SCHEDULED' } });
    await week(b, '2026-12-28', 99, 100, season.id);
    await week(b, '2027-01-04', 90, 40, season.id);
    await week(c, '2027-01-04', 60, 100, season.id);
    await week(c, '2027-01-11', 55, 80, season.id);
    const board = await api().get(`/api/v1/leagues/${id}/leaderboard`).set(await auth(owner)).expect(200);
    expect(board.body.data.map((r: { userId: string; points: number; rank: number }) => [r.userId, r.points, r.rank])).toEqual([
      [c, 180, 1],
      [b, 40, 2],
      [owner, 0, 3],
    ]);

    // Owner cannot leave; a member can, and the owner can remove members or delete the league.
    await api().delete(`/api/v1/leagues/${id}/membership`).set(await auth(owner)).expect(409);
    await api().delete(`/api/v1/leagues/${id}/membership`).set(await auth(b)).expect(204);
    await api().delete(`/api/v1/leagues/${id}/members/${c}`).set(await auth(b)).expect(403);
    await api().delete(`/api/v1/leagues/${id}/members/${c}`).set(await auth(owner)).expect(204);
    const list = await api().get('/api/v1/leagues').set(await auth(owner)).expect(200);
    expect(list.body.mine[0]).toMatchObject({ id, members: 1 });
    await api().delete(`/api/v1/leagues/${id}`).set(await auth(owner)).expect(204);
    await api().get(`/api/v1/leagues/${id}`).set(await auth(owner)).expect(404);
  });

  it('public leagues are listed and joinable without a code', async () => {
    const [owner, b] = [await athlete(), await athlete()];
    const pub = await api().post('/api/v1/leagues').set(await auth(owner)).send({ name: 'Open Tunis', visibility: 'PUBLIC', endsAt: '2027-03-01T00:00:00Z' }).expect(201);
    const list = await api().get('/api/v1/leagues').set(await auth(b)).expect(200);
    expect(list.body.public.map((l: { id: string }) => l.id)).toContain(pub.body.id);
    const seen = await api().get(`/api/v1/leagues/${pub.body.id}`).set(await auth(b)).expect(200);
    expect(seen.body).toMatchObject({ isMember: false, inviteCode: null });
    await api().post(`/api/v1/leagues/${pub.body.id}/join`).set(await auth(b)).expect(200);
    const after = await api().get('/api/v1/leagues').set(await auth(b)).expect(200);
    expect(after.body.mine.map((l: { id: string }) => l.id)).toContain(pub.body.id);
  });
});
