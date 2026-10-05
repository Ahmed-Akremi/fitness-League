import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClockService } from '../src/common/clock/clock.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { BattlesService } from '../src/modules/battles/battles.service';
import { JobsService } from '../src/modules/jobs/jobs.service';
import { registerUser, setupTestApp } from './helpers';

/**
 * Weekly Duels (docs §6.1) for the week starting Monday 2026-10-05 (Tunis = UTC+1, so Sunday 23:00Z):
 * queue Friday 2026-10-02 → Monday 12:00, hourly pairing from Sunday 12:00, ghost duels after Monday 12:00.
 */
describe('Weekly Duels (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clock: jest.SpyInstance<Date, []>;
  let ids: { powerlifting: string; squat: string };
  const api = () => request(app.getHttpServer());
  const setNow = (iso: string) => clock.mockReturnValue(new Date(iso));
  const auth = async (userId: string) => ({ authorization: `Bearer ${(await app.get(TokenService).signAccess({ sub: userId, role: 'USER', sv: 1 })).token}` });

  async function athlete(calibrated = true) {
    const { session } = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: session.userId }, data: { emailVerifiedAt: new Date('2026-08-01T00:00:00Z') } });
    await prisma.profile.update({ where: { userId: session.userId }, data: { calibrationEndsAt: calibrated ? new Date('2026-08-01T00:00:00Z') : new Date('2026-12-01T00:00:00Z'), plannedTrainingDaysPerWeek: 3 } });
    return session.userId as string;
  }

  async function train(userId: string, performedAtIso: string, kg = 100) {
    setNow(performedAtIso);
    const body = { clientId: randomUUID(), sportId: ids.powerlifting, workoutType: 'STRENGTH', performedAt: performedAtIso, durationS: 3600, exercises: [{ exerciseId: ids.squat, sets: [{ reps: 5, weightKg: kg }] }] };
    await api().post('/api/v1/workouts').set(await auth(userId)).set('idempotency-key', body.clientId).send(body).expect(201);
    await app.get(OutboxDispatcher).drainAll();
  }

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    clock = jest.spyOn(app.get(ClockService), 'now');
    setNow('2026-09-28T08:00:00Z');
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

  it('queues, pairs strangers, gives the odd one out a ghost duel, then rates the duel', async () => {
    const [a, b, c, e] = [await athlete(), await athlete(), await athlete(), await athlete()];
    const rookie = await athlete(false);
    for (const u of [a, b, c, e]) await train(u, '2026-10-01T08:00:00Z');
    // a and b are friends: they must never meet in a duel.
    await api().post('/api/v1/friends/requests').set(await auth(a)).send({ userId: b }).expect(201);
    await api().post(`/api/v1/friends/requests/${a}/accept`).set(await auth(b)).expect(200);

    // Wednesday: the queue is closed.
    setNow('2026-09-30T10:00:00Z');
    const closed = await api().get('/api/v1/duels/queue').set(await auth(a)).expect(200);
    expect(closed.body).toMatchObject({ queueOpen: false, entry: null, rating: { rating: 1500, rd: 350, games: 0 } });
    await api().post('/api/v1/duels/queue').set(await auth(a)).expect(409);

    // Friday: open for the week of 2026-10-05.
    setNow('2026-10-02T09:00:00Z');
    for (const u of [a, b, c, e]) {
      const r = await api().post('/api/v1/duels/queue').set(await auth(u)).expect(200);
      expect(r.body).toMatchObject({ queueOpen: true, weekStart: '2026-10-05', entry: { status: 'WAITING' } });
    }
    const refused = await api().post('/api/v1/duels/queue').set(await auth(rookie)).expect(422);
    expect(refused.body.errors).toEqual([{ field: 'user', code: 'CALIBRATION' }]);
    // e changes their mind.
    expect((await api().delete('/api/v1/duels/queue').set(await auth(e)).expect(200)).body.entry).toBeNull();

    // Saturday: no batch yet.
    setNow('2026-10-03T10:00:00Z');
    await app.get(JobsService).runDue();
    expect(await prisma.battle.count({ where: { type: 'DUEL' } })).toBe(0);

    // Sunday 12:00 local: first batch pairs c with a or b (a–b are friends); e left.
    setNow('2026-10-04T11:05:00Z');
    await app.get(JobsService).runDue();
    const duels = await prisma.battle.findMany({ where: { type: 'DUEL' }, include: { participants: true } });
    expect(duels).toHaveLength(1);
    const duel = duels[0]!;
    const pair = duel.participants.map((p) => p.userId).sort();
    expect(pair).toContain(c);
    expect(pair).not.toContain(e);
    expect(pair.includes(a) && pair.includes(b)).toBe(false);
    expect(duel).toMatchObject({ status: 'ACTIVE', isGhost: false, durationDays: 7, startsAt: new Date('2026-10-04T23:00:00Z'), endsAt: new Date('2026-10-11T23:00:00Z') });
    const leftOver = [a, b].find((u) => !pair.includes(u))!;
    const matchedFriend = [a, b].find((u) => pair.includes(u))!;
    const notif = await api().get('/api/v1/notifications').set(await auth(c)).expect(200);
    expect(notif.body.data[0]).toMatchObject({ type: 'DUEL_MATCHED', payload: { battleId: duel.id, opponentId: matchedFriend } });
    // Same hour again: idempotent.
    await app.get(JobsService).runDue();
    expect(await prisma.battle.count({ where: { type: 'DUEL' } })).toBe(1);

    // Monday 12:00: the one still waiting gets a ghost duel against last week.
    setNow('2026-10-05T11:30:00Z');
    await app.get(JobsService).runDue();
    const ghost = await prisma.battle.findFirstOrThrow({ where: { type: 'DUEL', isGhost: true }, include: { participants: true } });
    expect(ghost.participants.map((p) => p.userId)).toEqual([leftOver]);
    const status = await api().get('/api/v1/duels/queue').set(await auth(leftOver)).expect(200);
    expect(status.body.currentDuel).toMatchObject({ battleId: ghost.id, isGhost: true, opponentId: null });
    const ghostView = await api().get(`/api/v1/battles/${ghost.id}`).set(await auth(leftOver)).expect(200);
    expect(ghostView.body).toMatchObject({ type: 'DUEL', isGhost: true, ghostTarget: expect.any(Number) });

    // The week: c trains three times, the friend once, the ghost athlete twice.
    for (const day of ['06', '08', '10']) await train(c, `2026-10-${day}T08:00:00Z`, 102.5);
    await train(matchedFriend, '2026-10-07T08:00:00Z');
    for (const day of ['06', '09']) await train(leftOver, `2026-10-${day}T08:00:00Z`);

    // After the end + grace, duels close like battles and MMR moves for the real duel only.
    setNow('2026-10-14T12:00:00Z');
    await app.get(BattlesService).closeDue();
    const closedDuel = await prisma.battle.findUniqueOrThrow({ where: { id: duel.id }, include: { participants: true } });
    expect(closedDuel.status).toBe('COMPLETED');
    const winner = closedDuel.participants.find((p) => p.outcome === 'WIN');
    const ratings = await prisma.mmrRating.findMany({ where: { userId: { in: pair } } });
    expect(ratings).toHaveLength(2);
    for (const r of ratings) {
      expect(r.games).toBe(1);
      expect(Number(r.rd)).toBeLessThan(350);
      if (winner) expect(Number(r.rating) > 1500).toBe(r.userId === winner.userId);
    }
    expect(await prisma.mmrRating.findUnique({ where: { userId: leftOver } })).toBeNull();
    expect(await prisma.leaguePointTransaction.count({ where: { sourceType: 'duel', sourceId: duel.id } })).toBeGreaterThan(0);
    const ghostClosed = await prisma.battle.findUniqueOrThrow({ where: { id: ghost.id } });
    expect(ghostClosed).toMatchObject({ status: 'COMPLETED', result: expect.objectContaining({ ghost: true }) });

    const after = await api().get('/api/v1/duels/queue').set(await auth(c)).expect(200);
    expect(after.body.rating.games).toBe(1);
    expect(after.body.currentDuel).toBeNull();
  });
});
