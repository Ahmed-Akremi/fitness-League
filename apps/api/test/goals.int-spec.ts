import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { registerUser, setupTestApp } from './helpers';

describe('Goals & suggestions (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ids: { powerlifting: string; squat: string };
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const drain = () => app.get(OutboxDispatcher).drainAll();
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

  const squat = async (token: string, performedAt: string, weightKg: number) => {
    const body = { clientId: randomUUID(), sportId: ids.powerlifting, workoutType: 'STRENGTH', performedAt, durationS: 3600, exercises: [{ exerciseId: ids.squat, sets: [{ reps: 5, weightKg }] }] };
    const res = await api().post('/api/v1/workouts').set(bearer(token)).set('idempotency-key', body.clientId).send(body).expect(201);
    await drain();
    return res.body as { id: string };
  };

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    ids = {
      powerlifting: (await prisma.sport.findUniqueOrThrow({ where: { code: 'POWERLIFTING' } })).id,
      squat: (await prisma.exercise.findUniqueOrThrow({ where: { code: 'BACK_SQUAT' } })).id,
    };
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('suggests targets from the current best and the expected progression, with a disclaimer', async () => {
    const { session } = await registerUser(app, prisma);
    const t = session.accessToken;
    const none = await api().post('/api/v1/goals/suggestions').set(bearer(t)).send({ type: 'STRENGTH', exerciseId: ids.squat, metricCode: 'E1RM' }).expect(422);
    expect(none.body.errors).toEqual([{ field: 'targetValue', code: 'NO_CURRENT_VALUE' }]);

    await squat(t, hoursAgo(20), 100); // e1RM 116.67 → derived level INTERMEDIATE (3 %/month)
    const res = await api().post('/api/v1/goals/suggestions').set(bearer(t)).send({ type: 'STRENGTH', exerciseId: ids.squat, metricCode: 'E1RM' }).expect(200);
    expect(res.body).toMatchObject({ current: 116.67, expectedPctPer28Days: 3, disclaimerKey: 'goals.disclaimer' });
    expect(res.body.suggestions.map((s: { targetValue: number }) => s.targetValue)).toEqual([120, 125, 135]);
  });

  it('plans milestones, refuses bad targets, softens unrealistic dates, and credits milestones from workouts', async () => {
    const { session } = await registerUser(app, prisma);
    const t = session.accessToken;
    await squat(t, hoursAgo(40), 100);
    const goal = (body: Record<string, unknown>) => api().post('/api/v1/goals').set(bearer(t)).send({ type: 'STRENGTH', exerciseId: ids.squat, metricCode: 'E1RM', ...body });

    expect((await goal({ targetValue: 110 }).expect(422)).body.errors[0].code).toBe('TARGET_NOT_BETTER');
    expect((await goal({ targetValue: 400 }).expect(422)).body.errors[0].code).toBe('UNREALISTIC_TARGET');

    const created = await goal({ targetValue: 130, targetDate: inDays(7) }).expect(201);
    expect(created.body).toMatchObject({
      startValue: 116.67,
      targetValue: 130,
      status: 'ACTIVE',
      safetyAdjustment: { reason: 'TOO_FAST' },
      disclaimerKey: 'goals.disclaimer',
    });
    expect(created.body.milestones.map((m: { targetValue: number }) => m.targetValue)).toEqual([120, 122.5, 127.5, 130]);
    expect(created.body.targetDate > inDays(7)).toBe(true);
    await goal({ targetValue: 140 }).expect(409); // one active goal per metric

    // 105 × 5 → e1RM 122.5 reaches the first two milestones: 2 × 150 XP.
    const w = await squat(t, hoursAgo(10), 105);
    const after = await api().get(`/api/v1/goals/${created.body.id}`).set(bearer(t)).expect(200);
    expect(after.body.milestonesReached).toBe(2);
    expect(await prisma.xpTransaction.count({ where: { userId: session.userId, reason: 'GOAL_MILESTONE' } })).toBe(2);

    // Deleting the workout takes the milestones (and their XP) back.
    await api().delete(`/api/v1/workouts/${w.id}`).set(bearer(t)).expect(204);
    await drain();
    expect((await api().get(`/api/v1/goals/${created.body.id}`).set(bearer(t)).expect(200)).body.milestonesReached).toBe(0);
    const live = await prisma.xpTransaction.findMany({ where: { userId: session.userId, reason: 'GOAL_MILESTONE', reversal: null } });
    expect(live).toHaveLength(0);

    await api().delete(`/api/v1/goals/${created.body.id}`).set(bearer(t)).expect(204);
    expect((await api().get(`/api/v1/goals/${created.body.id}`).set(bearer(t)).expect(200)).body.status).toBe('ABANDONED');
  });

  it('requires a rest day in habit goals', async () => {
    const { session } = await registerUser(app, prisma);
    const res = await api().post('/api/v1/goals').set(bearer(session.accessToken)).send({ type: 'HABIT', metricCode: 'WORKOUTS_PER_WEEK', targetValue: 7 }).expect(422);
    expect(res.body.errors[0].code).toBe('REST_DAY_REQUIRED');
    const ok = await api().post('/api/v1/goals').set(bearer(session.accessToken)).send({ type: 'HABIT', metricCode: 'WORKOUTS_PER_WEEK', targetValue: 3 }).expect(201);
    expect(ok.body.milestones.map((m: { targetValue: number }) => m.targetValue)).toEqual([2, 4, 8, 12]);
  });

  it('keeps weight goals private and encrypted, limits the pace to 1 %/week and never rewards faster loss', async () => {
    const { session } = await registerUser(app, prisma);
    const t = session.accessToken;
    const weightGoal = { type: 'WEIGHT', metricCode: 'BODY_WEIGHT', targetValue: 80, targetDate: inDays(28), visibility: 'PUBLIC' };
    expect((await api().post('/api/v1/goals').set(bearer(t)).send(weightGoal).expect(422)).body.errors[0].code).toBe('NO_CURRENT_VALUE');

    await api().post('/api/v1/me/consents').set(bearer(t)).send({ type: 'HEALTH_DATA', granted: true, documentVersion: '2026-09' }).expect(201);
    await api().post('/api/v1/me/body-measurements').set(bearer(t)).send({ weightKg: 90 }).expect(201);
    expect((await api().post('/api/v1/goals').set(bearer(t)).send({ ...weightGoal, targetValue: 60 }).expect(422)).body.errors[0].code).toBe('UNSAFE_TARGET');

    const created = await api().post('/api/v1/goals').set(bearer(t)).send(weightGoal).expect(201);
    expect(created.body).toMatchObject({ visibility: 'PRIVATE', direction: 'DECREASE', startValue: 90, targetValue: 80, safetyAdjustment: { reason: 'WEIGHT_RATE_LIMIT', maxPctPerWeek: 1 } });
    expect(created.body.targetDate >= inDays(12 * 7)).toBe(true); // 10 kg at 0.9 kg/week → 12 weeks
    const raw = await prisma.goal.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(raw.targetValue).toBeNull();
    expect(raw.targetValueEnc).not.toBeNull();

    // −3 kg on day one: faster than safe, so nothing is credited.
    await api().post('/api/v1/me/body-measurements').set(bearer(t)).send({ weightKg: 87 }).expect(201);
    await drain();
    expect((await api().get(`/api/v1/goals/${created.body.id}`).set(bearer(t))).body.milestonesReached).toBe(0);

    // Four weeks later the same −3 kg is within 1 %/week: the first milestone (88 kg) is reached.
    await prisma.goal.update({ where: { id: created.body.id }, data: { startDate: new Date(Date.now() - 28 * 86_400_000) } });
    await api().post('/api/v1/me/body-measurements').set(bearer(t)).send({ weightKg: 87 }).expect(201);
    await drain();
    expect((await api().get(`/api/v1/goals/${created.body.id}`).set(bearer(t))).body.milestonesReached).toBe(1);
  });
});
