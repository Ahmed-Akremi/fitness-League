import { INestApplication } from '@nestjs/common';
import { ExperienceLevel, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClockService } from '../src/common/clock/clock.service';
import { uuidv7 } from '../src/common/ids/uuid';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { JobsService } from '../src/modules/jobs/jobs.service';
import { registerUser, setupTestApp } from './helpers';

/**
 * Drives a real competitive week with a simulated clock (Africa/Tunis = UTC+1):
 * week of Mon 2026-09-07 → closes Tue 2026-09-15 00:00 local after the 24 h grace.
 */
describe('Weekly LP, leaderboards, seasons & jobs (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clock: jest.SpyInstance<Date, []>;
  let ids: { powerlifting: string; squat: string; e1rm: string };
  const api = () => request(app.getHttpServer());
  const drain = () => app.get(OutboxDispatcher).drainAll();
  const setNow = (iso: string) => clock.mockReturnValue(new Date(iso));
  const token = async (userId: string) => (await app.get(TokenService).signAccess({ sub: userId, role: 'USER', sv: 1 })).token;

  /** Eligible athlete: verified, calibration over, with a final squat baseline at a given level. */
  async function athlete(e1rmBaseline: number, level: ExperienceLevel, plannedDays: number, finalizedAt = new Date('2026-08-01T00:00:00Z')) {
    const { session } = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: session.userId }, data: { emailVerifiedAt: new Date('2026-08-01T00:00:00Z') } });
    await prisma.profile.update({ where: { userId: session.userId }, data: { calibrationEndsAt: new Date('2026-08-01T00:00:00Z'), plannedTrainingDaysPerWeek: plannedDays } });
    await prisma.baseline.create({
      data: { id: uuidv7(), userId: session.userId, exerciseId: ids.squat, metricTypeId: ids.e1rm, effectiveValue: e1rmBaseline, calibratedValue: e1rmBaseline, status: 'FINAL', finalizedAt, experienceLevel: level, logsCounted: 2 },
    });
    return session.userId;
  }

  async function logSingle(userId: string, performedAtIso: string, kg: number) {
    setNow(performedAtIso);
    const body = { clientId: randomUUID(), sportId: ids.powerlifting, workoutType: 'STRENGTH', performedAt: performedAtIso, durationS: 3600, exercises: [{ exerciseId: ids.squat, sets: [{ reps: 1, weightKg: kg }] }] };
    const res = await api().post('/api/v1/workouts').set('authorization', `Bearer ${await token(userId)}`).set('idempotency-key', body.clientId).send(body);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACCEPTED');
    await drain();
  }

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    clock = jest.spyOn(app.get(ClockService), 'now');
    ids = {
      powerlifting: (await prisma.sport.findUniqueOrThrow({ where: { code: 'POWERLIFTING' } })).id,
      squat: (await prisma.exercise.findUniqueOrThrow({ where: { code: 'BACK_SQUAT' } })).id,
      e1rm: (await prisma.metricType.findUniqueOrThrow({ where: { code: 'E1RM' } })).id,
    };
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await prisma?.$disconnect();
  });

  it('corrects a sandbagged baseline and reverses the LP already paid on it (docs §5.10.3)', async () => {
    // Nour: baseline 50 kg (beginner, 8 %/28 d) finalised Mon Aug 3; plausible +2 % in week 1, then 60 kg.
    setNow('2026-08-02T10:00:00Z');
    const nour = await athlete(50, 'BEGINNER', 1, new Date('2026-08-02T23:00:00Z'));
    await logSingle(nour, '2026-08-07T07:00:00Z', 51);
    setNow('2026-08-11T06:00:00Z');
    await app.get(JobsService).once('weekly-close', '2026-08-03', () => app.get(JobsService)['seasons'].closeWeek(new Date('2026-08-02T23:00:00Z')));
    const week1 = await prisma.leaguePointTransaction.findFirstOrThrow({ where: { userId: nour, reason: 'WEEKLY_SCORE' } });

    // Week 2: 60 kg, 20 % above the baseline after 11.3 days — far beyond 2 × 8 % × 11.3/28 = 6.5 %.
    await logSingle(nour, '2026-08-14T07:00:00Z', 60);
    setNow('2026-08-18T06:00:00Z');
    await app.get(JobsService).once('weekly-close', '2026-08-10', () => app.get(JobsService)['seasons'].closeWeek(new Date('2026-08-09T23:00:00Z')));

    const baseline = await prisma.baseline.findFirstOrThrow({ where: { userId: nour, metricTypeId: ids.e1rm } });
    expect(baseline.status).toBe('CORRECTED');
    expect(Number(baseline.correctedFrom)).toBe(50);
    expect(Number(baseline.effectiveValue)).toBeCloseTo(56.35, 1); // 60 / (1 + 2 × 8 % × 11.33/28)

    // Week 1 was re-scored against the corrected baseline: the original entry is reversed.
    const reversal = await prisma.leaguePointTransaction.findFirstOrThrow({ where: { reversesId: week1.id } });
    expect(reversal.amount).toBe(-week1.amount);
    const lpSum = (await prisma.leaguePointTransaction.aggregate({ where: { userId: nour }, _sum: { amount: true } }))._sum.amount;
    expect((await prisma.userStats.findUniqueOrThrow({ where: { userId: nour } })).seasonLp).toBe(lpSum);
  });

  it('turns the week into LP fairly (docs §5.10.1 example), ranks it, and closes the season', async () => {
    setNow('2026-09-06T10:00:00Z');
    // Sami: beginner, 60 → 65 kg, 3 of 3 planned days. Karim: advanced, 200 → 202 kg, 4 of 5 planned days.
    const sami = await athlete(60, 'BEGINNER', 3);
    const karim = await athlete(200, 'ADVANCED', 5);
    for (const [day, kg] of [['07', 61], ['09', 63], ['11', 65]] as const) await logSingle(sami, `2026-09-${day}T07:00:00Z`, kg);
    for (const [day, kg] of [['07', 195], ['08', 198], ['10', 200], ['12', 202]] as const) await logSingle(karim, `2026-09-${day}T17:00:00Z`, kg);

    // Live provisional score during the week.
    setNow('2026-09-12T20:00:00Z');
    const live = await api().get('/api/v1/me/weekly-scores/current').set('authorization', `Bearer ${await token(sami)}`).expect(200);
    expect(live.body).toMatchObject({ status: 'PROVISIONAL', trainingDays: 3, eligible: true });

    // Not closable before the grace period ends (Tue 00:00 local = Mon 23:00Z)…
    setNow('2026-09-14T22:00:00Z');
    await app.get(JobsService).runDue();
    expect(await prisma.weeklyScore.count({ where: { userId: sami, status: 'FINAL' } })).toBe(0);

    // …then it is.
    setNow('2026-09-15T00:30:00Z');
    await app.get(JobsService).runDue();
    const scores = await prisma.weeklyScore.findMany({ where: { userId: { in: [sami, karim] } } });
    const s = scores.find((x) => x.userId === sami)!;
    const k = scores.find((x) => x.userId === karim)!;
    expect(Number(s.progressC)).toBeCloseTo(69.44, 1);
    expect(Number(k.progressC)).toBeCloseTo(66.67, 1);
    expect(Number(k.consistencyC)).toBe(80);
    expect(Number(s.total)).toBeCloseTo(85.62, 1);
    expect(Number(k.total)).toBeCloseTo(78.43, 1);

    const lp = await api().get('/api/v1/me/lp').set('authorization', `Bearer ${await token(sami)}`).expect(200);
    expect(lp.body).toMatchObject({ lp: 86, division: 'BRONZE', nextDivision: 'SILVER', lpToNextDivision: 314 });
    expect((await prisma.userStats.findUniqueOrThrow({ where: { userId: karim } })).seasonLp).toBe(78);
    expect((await prisma.streak.findUniqueOrThrow({ where: { userId: sami } })).currentWeeks).toBe(1);
    expect((await prisma.streak.findUniqueOrThrow({ where: { userId: karim } })).currentWeeks).toBe(0);

    // Idempotent: a second tick changes nothing.
    await app.get(JobsService).runDue();
    expect(await prisma.leaguePointTransaction.count({ where: { userId: sami } })).toBe(1);

    // Leaderboards: the beginner who executed the plan is ahead of the advanced athlete.
    const t = { authorization: `Bearer ${await token(sami)}` };
    const national = await api().get('/api/v1/leaderboards/national?limit=50').set(t).expect(200);
    const order = national.body.data.map((r: { athlete: { id: string } }) => r.athlete.id).filter((id: string) => id === sami || id === karim);
    expect(order).toEqual([sami, karim]);
    const samiRow = national.body.data.find((r: { athlete: { id: string } }) => r.athlete.id === sami);
    expect(samiRow).toMatchObject({ lp: 86, division: 'BRONZE', governorate: { code: 'TN-51' } });
    expect(typeof samiRow.movement === 'number' || samiRow.movement === 'NEW').toBe(true);

    const me = await api().get('/api/v1/leaderboards/national/me?limit=5').set(t).expect(200);
    expect(me.body.me).toMatchObject({ athlete: { id: sami }, lp: 86 });
    const ranks = await api().get('/api/v1/me/ranks').set(t).expect(200);
    expect(ranks.body).toMatchObject({ national: samiRow.rank, gym: null, friends: 1 });
    expect(ranks.body.governorate).toBeLessThanOrEqual(samiRow.rank);

    // Page 2 via cursor never repeats page 1.
    const p1 = await api().get('/api/v1/leaderboards/national?limit=1').set(t).expect(200);
    const p2 = await api().get(`/api/v1/leaderboards/national?limit=1&cursor=${p1.body.page.nextCursor}`).set(t).expect(200);
    expect(p2.body.data[0].athlete.id).not.toBe(p1.body.data[0].athlete.id);

    // Snapshot today, move tomorrow → movement arrows.
    await prisma.userStats.update({ where: { userId: karim }, data: { seasonLp: 120 } });
    setNow('2026-09-16T09:00:00Z');
    const moved = await api().get('/api/v1/leaderboards/national?limit=50').set({ authorization: `Bearer ${await token(sami)}` }).expect(200);
    const row = (id: string) => moved.body.data.find((r: { athlete: { id: string } }) => r.athlete.id === id);
    expect(row(karim).movement).toBeGreaterThan(0);
    expect(row(sami).movement).toBe(-1);
    await prisma.userStats.update({ where: { userId: karim }, data: { seasonLp: 78 } });

    // ── Season end (Q3 ends Oct 1 00:00 local): standings archived, soft reset into Q4.
    setNow('2026-10-02T06:00:00Z');
    await app.get(JobsService).runDue();
    const q3 = await prisma.season.findFirstOrThrow({ where: { name: 'Season 2026 Q3' } });
    expect(q3.status).toBe('CLOSED');
    const standing = await prisma.seasonStanding.findUniqueOrThrow({ where: { seasonId_userId: { seasonId: q3.id, userId: sami } } });
    expect(standing).toMatchObject({ finalLp: 86 });
    expect(standing.rankNational).toBeGreaterThan(0);
    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: sami }, include: { season: true } });
    expect(stats.season?.name).toBe('Season 2026 Q4');
    expect(stats.seasonLp).toBe(43); // Bronze floor 0 + (86 − 0) × 0.5
    const reset = await prisma.leaguePointTransaction.findFirstOrThrow({ where: { userId: sami, reason: 'SEASON_SOFT_RESET' } });
    expect(reset.amount).toBe(43);
    await app.get(JobsService).runDue(); // idempotent
    expect(await prisma.leaguePointTransaction.count({ where: { userId: sami, reason: 'SEASON_SOFT_RESET' } })).toBe(1);
  });
});
