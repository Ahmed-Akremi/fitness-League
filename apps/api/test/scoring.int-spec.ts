import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { WorkoutScoringService } from '../src/modules/scoring/workout-scoring.service';
import { registerUser, setupTestApp } from './helpers';

describe('Scoring engine: progress, records, XP ledger (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ids: { powerlifting: string; squat: string };
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const drain = () => app.get(OutboxDispatcher).drainAll();

  const squat = (token: string, performedAt: string, weightKg: number, reps = 5, durationS = 3600) => {
    const body = {
      clientId: randomUUID(),
      sportId: ids.powerlifting,
      workoutType: 'STRENGTH',
      performedAt,
      durationS,
      exercises: [{ exerciseId: ids.squat, sets: [{ reps: 5, weightKg: 40, isWarmup: true }, { reps, weightKg }] }],
    };
    return api().post('/api/v1/workouts').set(bearer(token)).set('idempotency-key', body.clientId).send(body).expect(201);
  };
  const xpTotal = async (userId: string) => Number((await prisma.userStats.findUniqueOrThrow({ where: { userId } })).xpTotal);
  const ledgerSum = async (userId: string) => (await prisma.xpTransaction.aggregate({ where: { userId }, _sum: { amount: true } }))._sum.amount ?? 0;

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

  it('runs the full journey: calibration → rewarded PR (capped) → implausible PR held → deletion reversed', async () => {
    const { session } = await registerUser(app, prisma);
    const token = session.accessToken;
    const userId = session.userId;

    // ── Workout 1, during calibration: 100 kg × 5 (e1RM 116.67).
    const w1 = await squat(token, hoursAgo(60), 100);
    await drain();
    const afterW1 = await prisma.xpTransaction.findMany({ where: { userId }, orderBy: { id: 'asc' } });
    expect(afterW1.map((x) => `${x.reason}:${x.amount}`)).toEqual(['WORKOUT:30', 'CALIBRATION_PR:10', 'QUEST:100']);
    const me = await api().get('/api/v1/me/xp').set(bearer(token)).expect(200);
    expect(me.body).toMatchObject({ xpTotal: 140, level: 2, xpIntoLevel: 40, xpForNextLevel: 283 });
    expect(await prisma.userBadge.count({ where: { userId, badge: { code: 'FIRST_STEP' } } })).toBe(1);
    expect(await prisma.activityEvent.count({ where: { userId, type: 'LEVEL_UP' } })).toBe(1);
    expect((await prisma.baseline.findFirstOrThrow({ where: { userId, metricType: { code: 'E1RM' } } })).status).toBe('PROVISIONAL');

    // Processing the same event again changes nothing (idempotent handlers).
    await app.get(WorkoutScoringService).onAccepted(w1.body.id);
    expect(await xpTotal(userId)).toBe(140);

    // ── Calibration ends.
    await prisma.profile.update({ where: { userId }, data: { calibrationEndsAt: new Date(Date.now() - 50 * 3_600_000) } });

    // ── Workout 2: 105 kg × 5 → e1RM 122.5 (+5.0 %). Derived level INTERMEDIATE (expected 3 %) → ratio 1.67.
    const w2 = await squat(token, hoursAgo(30), 105);
    await drain();
    const baseline = await prisma.baseline.findFirstOrThrow({ where: { userId, metricType: { code: 'E1RM' } } });
    expect(baseline).toMatchObject({ status: 'FINAL', experienceLevel: 'INTERMEDIATE' });
    const pr = await prisma.personalRecord.findFirstOrThrow({ where: { workoutId: w2.body.id, metricType: { code: 'E1RM' } } });
    expect(pr).toMatchObject({ status: 'AWARDED', isCurrent: true });
    expect(Number(pr.value)).toBe(122.5);
    // PR XP would be 425, but the daily cap (400) leaves 370 after the 30 workout XP.
    const w2Points = await api().get(`/api/v1/workouts/${w2.body.id}/points`).set(bearer(token)).expect(200);
    expect(w2Points.body.entries.map((e: { reason: string; amount: number }) => `${e.reason}:${e.amount}`)).toEqual(['WORKOUT:30', 'PR:370']);
    const prEntry = w2Points.body.entries[1];
    expect(prEntry.explanation).toMatchObject({ formula: 'pr_xp', requested: 425, result: 370, inputs: { metric: 'E1RM', value: 122.5, previous: 116.67 } });
    expect(await xpTotal(userId)).toBe(540);

    // ── Workout 3: 150 kg × 5 → e1RM 175 (+43 % = 14× expected): plausible for the anti-cheat, implausible as progress.
    const w3 = await squat(token, hoursAgo(6), 150);
    await drain();
    const held = await prisma.personalRecord.findFirstOrThrow({ where: { workoutId: w3.body.id, metricType: { code: 'E1RM' } } });
    expect(held).toMatchObject({ status: 'HELD', isCurrent: false });
    expect(await xpTotal(userId)).toBe(570); // workout XP only

    const records = await api().get('/api/v1/me/records').set(bearer(token)).expect(200);
    expect(records.body.find((r: { metric: { code: string } }) => r.metric.code === 'E1RM').value).toBe(122.5);

    // ── Delete workout 2: its XP is reversed and the calibration record becomes current again.
    await api().delete(`/api/v1/workouts/${w2.body.id}`).set(bearer(token)).expect(204);
    await drain();
    expect(await xpTotal(userId)).toBe(170);
    const reversals = await prisma.xpTransaction.findMany({ where: { userId, reason: 'REVERSAL' } });
    expect(reversals.map((r) => r.amount).sort((a, b) => a - b)).toEqual([-370, -30]);
    const current = await prisma.personalRecord.findFirstOrThrow({ where: { userId, metricType: { code: 'E1RM' }, isCurrent: true } });
    expect(Number(current.value)).toBe(116.67);

    // The cached balance always equals the ledger.
    expect(await xpTotal(userId)).toBe(await ledgerSum(userId));
  });

  it('re-scores an edited workout as a new version', async () => {
    const { session } = await registerUser(app, prisma);
    const w = await squat(session.accessToken, hoursAgo(20), 80, 5, 45 * 60);
    await drain();
    expect((await prisma.xpTransaction.findFirstOrThrow({ where: { userId: session.userId, reason: 'WORKOUT' } })).amount).toBe(25);

    const { clientId: _c, ...content } = {
      clientId: '',
      sportId: ids.powerlifting,
      workoutType: 'STRENGTH',
      performedAt: w.body.performedAt,
      durationS: 90 * 60,
      exercises: [{ exerciseId: ids.squat, sets: [{ reps: 5, weightKg: 80 }] }],
    };
    await api().patch(`/api/v1/workouts/${w.body.id}`).set(bearer(session.accessToken)).set('if-match', '"1"').send(content).expect(200);
    await drain();
    const live = await prisma.xpTransaction.findMany({ where: { userId: session.userId, reason: 'WORKOUT', reversal: null } });
    expect(live.map((x) => [x.sourceId.endsWith('#v2'), x.amount])).toEqual([[true, 40]]);
    expect(await xpTotal(session.userId)).toBe(await ledgerSum(session.userId));
  });

  it('applies diminishing returns to the 3rd workout of a day', async () => {
    const { session } = await registerUser(app, prisma);
    const day = new Date(Date.now() - 30 * 3_600_000);
    day.setUTCHours(6, 0, 0, 0);
    for (const [i, kg] of [60, 65, 70].entries()) {
      await squat(session.accessToken, new Date(day.getTime() + i * 2 * 3_600_000).toISOString(), kg);
    }
    await drain();
    const workoutXp = await prisma.xpTransaction.findMany({ where: { userId: session.userId, reason: 'WORKOUT' }, orderBy: { effectiveAt: 'asc' } });
    expect(workoutXp.map((x) => x.amount)).toEqual([30, 30, 15]);
  });

  it('gives no points to workouts logged more than 72 h late, but keeps them in progress', async () => {
    const { session } = await registerUser(app, prisma);
    await squat(session.accessToken, hoursAgo(100), 90);
    await drain();
    expect(await prisma.xpTransaction.count({ where: { userId: session.userId } })).toBe(0);
    expect(await prisma.metricObservation.count({ where: { userId: session.userId } })).toBeGreaterThan(0);
  });

  it('shows "My Progress" (you vs you)', async () => {
    const { session } = await registerUser(app, prisma);
    await squat(session.accessToken, hoursAgo(40), 100);
    await squat(session.accessToken, hoursAgo(10), 110);
    await drain();
    const res = await api().get('/api/v1/me/progress?period=7d').set(bearer(session.accessToken)).expect(200);
    const e1rm = res.body.metrics.find((m: { metric: { code: string } }) => m.metric.code === 'E1RM');
    expect(e1rm).toMatchObject({ now: 128.33, sessions: 2 });
    const series = await api().get(`/api/v1/me/progress/metrics/${ids.squat}/E1RM?period=7d`).set(bearer(session.accessToken)).expect(200);
    expect(series.body.points.map((p: { value: number }) => p.value)).toEqual([116.67, 128.33]);
    await api().get('/api/v1/me/progress?period=2w').set(bearer(session.accessToken)).expect(422);
  });
});
