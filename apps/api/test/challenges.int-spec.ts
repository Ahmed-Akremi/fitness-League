import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClockService } from '../src/common/clock/clock.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { ChallengesService } from '../src/modules/challenges/challenges.service';
import { registerUser, setupTestApp } from './helpers';

/** Challenges (docs §3.10): visibility by scope, progress from workouts, completion XP, badge. */
describe('Challenges (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clock: jest.SpyInstance<Date, []>;
  let ids: { powerlifting: string; squat: string };
  const api = () => request(app.getHttpServer());
  const setNow = (iso: string) => clock.mockReturnValue(new Date(iso));
  const auth = async (userId: string, role: Role = 'USER') => ({ authorization: `Bearer ${(await app.get(TokenService).signAccess({ sub: userId, role, sv: 1 })).token}` });

  async function athlete(role: Role = 'USER') {
    const { session } = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: session.userId }, data: { emailVerifiedAt: new Date('2026-08-01T00:00:00Z'), role } });
    return session.userId as string;
  }

  async function train(userId: string, performedAtIso: string) {
    setNow(performedAtIso);
    const body = { clientId: randomUUID(), sportId: ids.powerlifting, workoutType: 'STRENGTH', performedAt: performedAtIso, durationS: 3600, exercises: [{ exerciseId: ids.squat, sets: [{ reps: 5, weightKg: 100 }] }] };
    const r = await api().post('/api/v1/workouts').set(await auth(userId)).set('idempotency-key', body.clientId).send(body).expect(201);
    await app.get(OutboxDispatcher).drainAll();
    return r.body.id as string;
  }

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    clock = jest.spyOn(app.get(ClockService), 'now');
    setNow('2026-12-01T08:00:00Z');
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

  it('community challenge: staff creates, athletes join, reaching the target pays XP once', async () => {
    const [staff, a, b] = [await athlete('ADMIN'), await athlete(), await athlete()];
    const window = { startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-12-15T00:00:00Z' };
    await api().post('/api/v1/challenges').set(await auth(a)).send({ scope: 'COMMUNITY', title: 'Nope', metric: 'WORKOUTS', targetValue: 2, ...window }).expect(403);
    const created = await api().post('/api/v1/challenges').set(await auth(staff, 'ADMIN')).send({ scope: 'COMMUNITY', title: 'Two sessions', metric: 'WORKOUTS', targetValue: 2, ...window }).expect(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({ scope: 'COMMUNITY', target: 2, xpReward: 250, joined: false, participants: 0 });

    // Workouts before joining still count: progress covers the whole window.
    await train(a, '2026-12-01T09:00:00Z');
    setNow('2026-12-01T10:00:00Z');
    const joined = await api().post(`/api/v1/challenges/${id}/join`).set(await auth(a)).expect(200);
    expect(joined.body).toMatchObject({ joined: true, myProgress: 1, completedAt: null });
    await api().post(`/api/v1/challenges/${id}/join`).set(await auth(b)).expect(200);

    await train(a, '2026-12-02T09:00:00Z');
    const done = await api().get(`/api/v1/challenges/${id}`).set(await auth(a)).expect(200);
    expect(done.body).toMatchObject({ myProgress: 2, completedAt: expect.any(String) });
    expect(done.body.leaderboard[0]).toMatchObject({ userId: a, progress: 2, completed: true });
    expect(await prisma.xpTransaction.count({ where: { userId: a, reason: 'CHALLENGE', sourceId: id } })).toBe(1);
    const badges = await api().get('/api/v1/me/badges').set(await auth(a)).expect(200);
    expect(badges.body.map((x: { code: string }) => x.code)).toContain('CHALLENGER');

    // More workouts or a deletion never pay twice nor un-complete.
    const third = await train(a, '2026-12-03T09:00:00Z');
    await api().delete(`/api/v1/workouts/${third}`).set(await auth(a)).expect(204);
    await app.get(OutboxDispatcher).drainAll();
    expect(await prisma.xpTransaction.count({ where: { userId: a, reason: 'CHALLENGE', sourceId: id } })).toBe(1);

    const list = await api().get('/api/v1/challenges').query({ mine: 'true' }).set(await auth(b)).expect(200);
    expect(list.body.map((c: { id: string }) => c.id)).toContain(id);
  });

  it('friend and personal challenges: visibility follows friendship, no XP', async () => {
    const [a, friend, stranger] = [await athlete(), await athlete(), await athlete()];
    await api().post('/api/v1/friends/requests').set(await auth(a)).send({ userId: friend }).expect(201);
    await api().post(`/api/v1/friends/requests/${a}/accept`).set(await auth(friend)).expect(200);
    setNow('2026-12-05T08:00:00Z');
    const window = { startsAt: '2026-12-05T00:00:00Z', endsAt: '2026-12-20T00:00:00Z' };
    const fc = await api().post('/api/v1/challenges').set(await auth(a)).send({ scope: 'FRIEND', title: 'Squad days', metric: 'TRAINING_DAYS', targetValue: 1, ...window }).expect(201);
    expect(fc.body).toMatchObject({ joined: true, xpReward: 0, participants: 1 });
    const pc = await api().post('/api/v1/challenges').set(await auth(a)).send({ scope: 'PERSONAL', title: 'Me only', metric: 'DURATION_MIN', targetValue: 30, ...window }).expect(201);

    await api().get(`/api/v1/challenges/${fc.body.id}`).set(await auth(friend)).expect(200);
    await api().get(`/api/v1/challenges/${fc.body.id}`).set(await auth(stranger)).expect(404);
    await api().get(`/api/v1/challenges/${pc.body.id}`).set(await auth(friend)).expect(404);
    await api().post(`/api/v1/challenges/${pc.body.id}/join`).set(await auth(a)).expect(403);

    await train(a, '2026-12-06T09:00:00Z');
    const after = await api().get(`/api/v1/challenges/${pc.body.id}`).set(await auth(a)).expect(200);
    expect(after.body).toMatchObject({ myProgress: 60, completedAt: expect.any(String) });
    expect(await prisma.xpTransaction.count({ where: { userId: a, reason: 'CHALLENGE' } })).toBe(0);

    // The author deletes it; ended challenges close after the late-log grace.
    await api().delete(`/api/v1/challenges/${fc.body.id}`).set(await auth(friend)).expect(403);
    await api().delete(`/api/v1/challenges/${fc.body.id}`).set(await auth(a)).expect(204);
    await api().get(`/api/v1/challenges/${fc.body.id}`).set(await auth(a)).expect(404);
    setNow('2026-12-24T00:00:00Z');
    expect((await app.get(ChallengesService).closeDue()).closed).toBeGreaterThanOrEqual(1);
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: pc.body.id } })).status).toBe('ENDED');
  });
});
