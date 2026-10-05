import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClockService } from '../src/common/clock/clock.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { JobsService } from '../src/modules/jobs/jobs.service';
import { registerUser, setupTestApp } from './helpers';

/**
 * Gym Wars (docs §6.2) for the week starting Monday 2026-10-26 (Tunis = UTC+1, so Sunday 23:00Z): paired on Monday,
 * scored after the weekly close (end + 24 h grace).
 */
describe('Gym Wars (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clock: jest.SpyInstance<Date, []>;
  let ids: { powerlifting: string; squat: string };
  const api = () => request(app.getHttpServer());
  const setNow = (iso: string) => clock.mockReturnValue(new Date(iso));
  const auth = async (userId: string, role: Role = 'USER') => ({ authorization: `Bearer ${(await app.get(TokenService).signAccess({ sub: userId, role, sv: 1 })).token}` });

  async function gymWithMembers(name: string, size: number) {
    const template = await prisma.gym.findUniqueOrThrow({ where: { slug: 'sahel-iron-club' } });
    const gym = await prisma.gym.create({
      data: { id: randomUUID(), name, slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${randomUUID().slice(0, 6)}`, governorateId: template.governorateId, cityId: template.cityId, status: 'VERIFIED', verifiedAt: new Date('2026-09-01T00:00:00Z') },
    });
    const members: string[] = [];
    for (let i = 0; i < size; i++) {
      const { session } = await registerUser(app, prisma);
      const userId = session.userId as string;
      await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date('2026-08-01T00:00:00Z') } });
      await prisma.profile.update({ where: { userId }, data: { calibrationEndsAt: new Date('2026-08-01T00:00:00Z'), plannedTrainingDaysPerWeek: 3, primaryGymId: gym.id } });
      await prisma.gymMember.create({ data: { id: randomUUID(), gymId: gym.id, userId, status: 'APPROVED', approvedAt: new Date('2026-09-01T00:00:00Z') } });
      members.push(userId);
    }
    return { id: gym.id, members };
  }

  async function train(userId: string, performedAtIso: string) {
    setNow(performedAtIso);
    const body = { clientId: randomUUID(), sportId: ids.powerlifting, workoutType: 'STRENGTH', performedAt: performedAtIso, durationS: 3600, exercises: [{ exerciseId: ids.squat, sets: [{ reps: 5, weightKg: 100 }] }] };
    await api().post('/api/v1/workouts').set(await auth(userId)).set('idempotency-key', body.clientId).send(body).expect(201);
    await app.get(OutboxDispatcher).drainAll();
  }

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    clock = jest.spyOn(app.get(ClockService), 'now');
    setNow('2026-10-20T08:00:00Z');
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

  it('pairs gyms of the same bracket, scores the week, pays the winners and moves the ratings', async () => {
    // Any gym left over from other suites must not join this week's draw.
    await prisma.gym.updateMany({ data: { warsOptOut: true } });
    const a = await gymWithMembers('Atlas Box', 8);
    const b = await gymWithMembers('Carthage Barbell', 8);
    const c = await gymWithMembers('Kairouan Strength', 8);
    await prisma.gym.updateMany({ where: { id: { in: [a.id, b.id, c.id] } }, data: { warsOptOut: false } });
    // c's admin opts out: only a and b are drawn.
    await prisma.gym.update({ where: { id: c.id }, data: { ownerUserId: c.members[0] } });
    await prisma.user.update({ where: { id: c.members[0] }, data: { role: 'GYM_ADMIN' } });
    await api().post(`/api/v1/gyms/${c.id}/wars/registration`).set(await auth(c.members[1]!)).send({ enrolled: false }).expect(403);
    await api().post(`/api/v1/gyms/${c.id}/wars/registration`).set(await auth(c.members[0]!, 'GYM_ADMIN')).send({ enrolled: false }).expect(200, { enrolled: false });

    // Monday of the war week.
    setNow('2026-10-26T08:00:00Z');
    await app.get(JobsService).runDue();
    const wars = await prisma.gymWar.findMany({ where: { weekStart: new Date('2026-10-26T00:00:00Z') }, include: { participants: true } });
    expect(wars).toHaveLength(1);
    expect(wars[0]).toMatchObject({ status: 'ACTIVE', bracket: 'S' });
    expect(wars[0]!.participants.map((p) => p.gymId).sort()).toEqual([a.id, b.id].sort());
    expect(wars[0]!.participants.every((p) => p.eligibleMemberCount === 8)).toBe(true);
    const warId = wars[0]!.id;
    const started = await api().get('/api/v1/notifications').set(await auth(a.members[0]!)).expect(200);
    expect(started.body.data[0]).toMatchObject({ type: 'GYM_WAR_STARTED', payload: { warId, opponentGymId: b.id } });
    // Idempotent.
    await app.get(JobsService).runDue();
    expect(await prisma.gymWar.count({ where: { weekStart: new Date('2026-10-26T00:00:00Z') } })).toBe(1);

    // During the week: 4 of a's members train, 1 of b's.
    for (const u of a.members.slice(0, 4)) await train(u, '2026-10-27T08:00:00Z');
    await train(b.members[0]!, '2026-10-28T08:00:00Z');

    setNow('2026-10-29T12:00:00Z');
    const current = await api().get('/api/v1/gym-wars/current').set(await auth(a.members[0]!)).expect(200);
    expect(current.body.gymId).toBe(a.id);
    expect(current.body.war).toMatchObject({ id: warId, status: 'ACTIVE', live: true, weekStart: '2026-10-26' });
    const mine = current.body.war.gyms.find((g: { gymId: string }) => g.gymId === a.id);
    const theirs = current.body.war.gyms.find((g: { gymId: string }) => g.gymId === b.id);
    expect(mine).toMatchObject({ isMine: true, eligibleMembers: 8, activeMembers: 4 });
    expect(theirs).toMatchObject({ isMine: false, activeMembers: 1 });
    expect(mine.score).toBeGreaterThan(theirs.score);

    // After the weekly close (end + 24 h grace) the war is scored.
    setNow('2026-11-03T12:00:00Z');
    await app.get(JobsService).runDue();
    const closed = await prisma.gymWar.findUniqueOrThrow({ where: { id: warId }, include: { participants: true } });
    expect(closed.status).toBe('COMPLETED');
    expect(closed.result).toMatchObject({ winnerGymId: a.id });
    const pa = closed.participants.find((p) => p.gymId === a.id)!;
    const pb = closed.participants.find((p) => p.gymId === b.id)!;
    expect(pa).toMatchObject({ outcome: 'WIN', activeMemberCount: 4 });
    expect(pb).toMatchObject({ outcome: 'LOSS', activeMemberCount: 1 });
    const [ga, gb] = [await prisma.gym.findUniqueOrThrow({ where: { id: a.id } }), await prisma.gym.findUniqueOrThrow({ where: { id: b.id } })];
    expect(Number(ga.rating)).toBeGreaterThan(1500);
    expect(Number(gb.rating)).toBeLessThan(1500);

    // Only the winner's active members earn the war XP.
    const xp = await prisma.xpTransaction.findMany({ where: { reason: 'GYM_WAR_WIN', sourceId: warId } });
    expect(xp.map((x) => x.userId).sort()).toEqual(a.members.slice(0, 4).sort());
    expect(xp.every((x) => x.amount === 500)).toBe(true);
    const result = await api().get('/api/v1/notifications').set(await auth(b.members[3]!)).expect(200);
    expect(result.body.data.find((n: { type: string }) => n.type === 'GYM_WAR_RESULT')).toMatchObject({ payload: { warId, outcome: 'LOSS' } });

    // History, record and the closed view.
    const history = await api().get(`/api/v1/gyms/${a.id}/wars`).set(await auth(a.members[0]!)).expect(200);
    expect(history.body).toMatchObject({ enrolled: true, record: { wins: 1, losses: 0, draws: 0 } });
    expect(history.body.data.find((w: { id: string }) => w.id === warId)).toMatchObject({ outcome: 'WIN', opponent: { gymId: b.id, name: 'Carthage Barbell' } });
    const view = await api().get(`/api/v1/gym-wars/${warId}`).set(await auth(b.members[0]!)).expect(200);
    expect(view.body).toMatchObject({ status: 'COMPLETED', live: false });
    expect(view.body.gyms.find((g: { gymId: string }) => g.gymId === b.id)).toMatchObject({ isMine: true, outcome: 'LOSS' });

    // Closing again pays nothing twice.
    await app.get(JobsService).runDue();
    expect(await prisma.xpTransaction.count({ where: { reason: 'GYM_WAR_WIN', sourceId: warId } })).toBe(4);
  });
});
