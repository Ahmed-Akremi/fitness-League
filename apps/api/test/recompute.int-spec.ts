import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClockService } from '../src/common/clock/clock.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { JobsService } from '../src/modules/jobs/jobs.service';
import { adminBearer, registerUser, setupTestApp } from './helpers';

/** Admin "recompute range" (docs §5.2): dry run first, then reversal + new ledger entries, never edits. */
describe('Score recompute (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clock: jest.SpyInstance<Date, []>;
  const api = () => request(app.getHttpServer());
  const setNow = (iso: string) => clock.mockReturnValue(new Date(iso));

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    clock = jest.spyOn(app.get(ClockService), 'now');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await prisma?.$disconnect();
  });

  it('dry run reports, the real run reverses and re-posts, closed weeks only, super admin only', async () => {
    setNow('2026-11-01T08:00:00Z');
    const { session } = await registerUser(app, prisma);
    const athlete = session.userId as string;
    await prisma.user.update({ where: { id: athlete }, data: { emailVerifiedAt: new Date('2026-08-01T00:00:00Z') } });
    await prisma.profile.update({ where: { userId: athlete }, data: { calibrationEndsAt: new Date('2026-08-01T00:00:00Z'), plannedTrainingDaysPerWeek: 2 } });
    const sport = (await prisma.sport.findUniqueOrThrow({ where: { code: 'POWERLIFTING' } })).id;
    const squat = (await prisma.exercise.findUniqueOrThrow({ where: { code: 'BACK_SQUAT' } })).id;
    const auth = async () => ({ authorization: `Bearer ${(await app.get(TokenService).signAccess({ sub: athlete, role: 'USER', sv: 1 })).token}` });
    for (const day of ['2026-11-16T08:00:00Z', '2026-11-18T08:00:00Z']) {
      setNow(day);
      const body = { clientId: randomUUID(), sportId: sport, workoutType: 'STRENGTH', performedAt: day, durationS: 3600, exercises: [{ exerciseId: squat, sets: [{ reps: 5, weightKg: 100 }] }] };
      await api().post('/api/v1/workouts').set(await auth()).set('idempotency-key', body.clientId).send(body).expect(201);
      await app.get(OutboxDispatcher).drainAll();
    }
    setNow('2026-11-24T12:00:00Z');
    await app.get(JobsService).runDue();
    const week = await prisma.weeklyScore.findFirstOrThrow({ where: { userId: athlete, status: 'FINAL' } });
    expect(week.lpTransactionId).not.toBeNull();
    // Simulate a week scored by an older formula.
    await prisma.weeklyScore.update({ where: { id: week.id }, data: { total: 1 } });
    const lpBefore = await prisma.leaguePointTransaction.count({ where: { userId: athlete } });

    const admin = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: admin.session.userId }, data: { role: 'ADMIN' } });
    const body = { from: '2026-11-16', to: '2026-11-23', reason: 'Test of the recompute job' };
    await api().post('/api/v1/admin/recompute').set(await adminBearer(app, prisma, admin.session.userId)).send(body).expect(403);
    await prisma.user.update({ where: { id: admin.session.userId }, data: { role: 'SUPER_ADMIN' } });

    await api().post('/api/v1/admin/recompute').set(await adminBearer(app, prisma, admin.session.userId)).send({ ...body, to: '2026-11-30' }).expect(422); // the running week is not closed
    const dry = await api().post('/api/v1/admin/recompute').set(await adminBearer(app, prisma, admin.session.userId)).send(body).expect(201);
    expect(dry.body).toMatchObject({ dryRun: true, weeks: 1, changed: 1, changes: [{ userId: athlete, weekStart: '2026-11-16', before: { total: 1 } }] });
    expect(await prisma.leaguePointTransaction.count({ where: { userId: athlete } })).toBe(lpBefore);

    const run = await api().post('/api/v1/admin/recompute').set(await adminBearer(app, prisma, admin.session.userId)).send({ ...body, dryRun: false }).expect(201);
    expect(run.body).toMatchObject({ dryRun: false, changed: 1, lpDelta: 0 });
    const ledger = await prisma.leaguePointTransaction.findMany({ where: { userId: athlete }, orderBy: { createdAt: 'asc' } });
    expect(ledger).toHaveLength(lpBefore + 2); // reversal + corrected entry
    expect(ledger.some((l) => l.reason === 'REVERSAL' && l.reversesId === week.lpTransactionId)).toBe(true);
    const after = await prisma.weeklyScore.findUniqueOrThrow({ where: { id: week.id } });
    expect(Number(after.total)).toBeGreaterThan(1);
    expect(after.lpTransactionId).not.toBe(week.lpTransactionId);
    expect(await prisma.auditLog.count({ where: { action: 'SCORES_RECOMPUTED' } })).toBe(1);

    // Nothing left to change.
    expect((await api().post('/api/v1/admin/recompute').set(await adminBearer(app, prisma, admin.session.userId)).send({ ...body, dryRun: false }).expect(201)).body.changed).toBe(0);
  });
});
