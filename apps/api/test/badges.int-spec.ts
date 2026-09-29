import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClockService } from '../src/common/clock/clock.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { BadgesService } from '../src/modules/badges/badges.service';
import { registerUser, setupTestApp } from './helpers';

/** Badge engine (docs §3.10): data-driven rules, awarded on events and by the daily sweep. */
describe('Badges (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clock: jest.SpyInstance<Date, []>;
  let ids: { powerlifting: string; squat: string };
  const api = () => request(app.getHttpServer());
  const setNow = (iso: string) => clock.mockReturnValue(new Date(iso));
  const auth = async (userId: string) => ({ authorization: `Bearer ${(await app.get(TokenService).signAccess({ sub: userId, role: 'USER', sv: 1 })).token}` });

  async function athlete() {
    const { session } = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: session.userId }, data: { emailVerifiedAt: new Date('2026-08-01T00:00:00Z') } });
    return session.userId as string;
  }

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    clock = jest.spyOn(app.get(ClockService), 'now');
    setNow('2026-11-10T08:00:00Z');
    ids = {
      powerlifting: (await prisma.sport.findUniqueOrThrow({ where: { code: 'POWERLIFTING' } })).id,
      squat: (await prisma.exercise.findUniqueOrThrow({ where: { code: 'BACK_SQUAT' } })).id,
    };
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await prisma?.$disconnect();
  });

  it('awards First Step on the first workout, shows progress, and the sweep catches friendships', async () => {
    const [a, b] = [await athlete(), await athlete()];
    const before = await api().get('/api/v1/badges').set(await auth(a)).expect(200);
    const ten = before.body.find((x: { code: string }) => x.code === 'TEN_WORKOUTS');
    expect(ten).toMatchObject({ category: 'PROGRESS', awardedAt: null, progress: { current: 0, target: 10, met: false } });
    expect(before.body.length).toBeGreaterThanOrEqual(20);

    const body = { clientId: randomUUID(), sportId: ids.powerlifting, workoutType: 'STRENGTH', performedAt: '2026-11-10T07:00:00Z', durationS: 3600, exercises: [{ exerciseId: ids.squat, sets: [{ reps: 5, weightKg: 100 }] }] };
    await api().post('/api/v1/workouts').set(await auth(a)).set('idempotency-key', body.clientId).send(body).expect(201);
    await app.get(OutboxDispatcher).drainAll();

    const mine = await api().get('/api/v1/me/badges').set(await auth(a)).expect(200);
    expect(mine.body.map((x: { code: string }) => x.code)).toContain('FIRST_STEP');
    const after = await api().get('/api/v1/badges').set(await auth(a)).expect(200);
    expect(after.body.find((x: { code: string }) => x.code === 'TEN_WORKOUTS').progress).toEqual({ current: 1, target: 10, met: false });
    const notif = await api().get('/api/v1/notifications').set(await auth(a)).expect(200);
    expect(notif.body.data.some((n: { type: string; payload: { badge: string } }) => n.type === 'BADGE_AWARDED' && n.payload.badge === 'FIRST_STEP')).toBe(true);
    expect(await prisma.activityEvent.count({ where: { userId: a, type: 'BADGE' } })).toBeGreaterThanOrEqual(1);

    // Friendship: no event hook, the sweep awards it (row timestamps use the real clock, hence the wide window).
    await api().post('/api/v1/friends/requests').set(await auth(a)).send({ userId: b }).expect(201);
    await api().post(`/api/v1/friends/requests/${a}/accept`).set(await auth(b)).expect(200);
    const swept = await app.get(BadgesService).sweep(new Date('2000-01-01T00:00:00Z'));
    expect(swept.awarded).toBeGreaterThanOrEqual(2);
    for (const u of [a, b]) {
      const r = await api().get('/api/v1/me/badges').set(await auth(u)).expect(200);
      expect(r.body.map((x: { code: string }) => x.code)).toContain('FIRST_FRIEND');
    }
    // Idempotent.
    expect((await app.get(BadgesService).sweep(new Date('2000-01-01T00:00:00Z'))).awarded).toBe(0);
  });
});
