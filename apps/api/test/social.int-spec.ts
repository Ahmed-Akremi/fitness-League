import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClockService } from '../src/common/clock/clock.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { JobsService } from '../src/modules/jobs/jobs.service';
import { registerUser, setupTestApp } from './helpers';

describe('Friends, blocks & Friend Battles (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clock: jest.SpyInstance<Date, []>;
  let ids: { powerlifting: string; squat: string };
  const api = () => request(app.getHttpServer());
  const setNow = (iso: string) => clock.mockReturnValue(new Date(iso));
  const auth = async (userId: string) => ({ authorization: `Bearer ${(await app.get(TokenService).signAccess({ sub: userId, role: 'USER', sv: 1 })).token}` });

  async function verifiedAthlete(plannedDays = 3) {
    const { session, body } = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: session.userId }, data: { emailVerifiedAt: new Date('2026-08-01T00:00:00Z') } });
    await prisma.profile.update({ where: { userId: session.userId }, data: { calibrationEndsAt: new Date('2026-08-01T00:00:00Z'), plannedTrainingDaysPerWeek: plannedDays } });
    return { id: session.userId, username: body.username as string };
  }

  async function befriend(a: string, b: string) {
    await api().post('/api/v1/friends/requests').set(await auth(a)).send({ userId: b }).expect(201);
    await api().post(`/api/v1/friends/requests/${a}/accept`).set(await auth(b)).expect(200);
  }

  async function train(userId: string, performedAtIso: string, kg: number) {
    setNow(performedAtIso);
    const body = { clientId: randomUUID(), sportId: ids.powerlifting, workoutType: 'STRENGTH', performedAt: performedAtIso, durationS: 3600, exercises: [{ exerciseId: ids.squat, sets: [{ reps: 5, weightKg: kg }] }] };
    await api().post('/api/v1/workouts').set(await auth(userId)).set('idempotency-key', body.clientId).send(body).expect(201);
    await app.get(OutboxDispatcher).drainAll();
  }

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    clock = jest.spyOn(app.get(ClockService), 'now');
    setNow('2026-09-01T08:00:00Z');
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

  it('handles friend requests, mutual requests, profiles and blocks', async () => {
    const a = await verifiedAthlete();
    const b = await verifiedAthlete();
    const c = await verifiedAthlete();

    await api().post('/api/v1/friends/requests').set(await auth(a.id)).send({ userId: b.id }).expect(201);
    await api().post('/api/v1/friends/requests').set(await auth(a.id)).send({ userId: b.id }).expect(409);
    const incoming = await api().get('/api/v1/friends/requests?direction=in').set(await auth(b.id)).expect(200);
    expect(incoming.body.map((u: { id: string }) => u.id)).toEqual([a.id]);
    const notif = await api().get('/api/v1/notifications').set(await auth(b.id)).expect(200);
    expect(notif.body).toMatchObject({ unread: 1, data: [{ type: 'FRIEND_REQUEST', payload: { userId: a.id } }] });
    await api().post(`/api/v1/friends/requests/${b.id}/accept`).set(await auth(a.id)).expect(404); // the requester can't accept
    await api().post(`/api/v1/friends/requests/${a.id}/accept`).set(await auth(b.id)).expect(200);
    expect((await api().get('/api/v1/friends').set(await auth(a.id))).body.map((u: { id: string }) => u.id)).toEqual([b.id]);

    // Asking back someone who asked you means yes.
    await api().post('/api/v1/friends/requests').set(await auth(c.id)).send({ userId: a.id }).expect(201);
    expect((await api().post('/api/v1/friends/requests').set(await auth(a.id)).send({ userId: c.id }).expect(201)).body.status).toBe('ACCEPTED');

    const profile = await api().get(`/api/v1/users/${b.username}`).set(await auth(a.id)).expect(200);
    expect(profile.body).toMatchObject({ username: b.username, friendship: 'FRIENDS', ageBracket: null });
    expect(JSON.stringify(profile.body)).not.toMatch(/dateOfBirth|1998-04-12|email/);

    // Blocking removes the friendship and makes each invisible to the other.
    await api().post(`/api/v1/blocks/${c.id}`).set(await auth(a.id)).expect(204);
    await api().get(`/api/v1/users/${a.username}`).set(await auth(c.id)).expect(404);
    await api().post('/api/v1/friends/requests').set(await auth(c.id)).send({ userId: a.id }).expect(404);
    expect((await api().get('/api/v1/friends').set(await auth(a.id))).body.map((u: { id: string }) => u.id)).toEqual([b.id]);
    const search = await api().get(`/api/v1/search/athletes?q=${a.username.slice(0, 8)}`).set(await auth(c.id)).expect(200);
    expect(search.body.data.map((u: { id: string }) => u.id)).not.toContain(a.id);
  });

  it('runs a Friend Battle: invite → accept → live score → close with LP, XP and anti-collusion', async () => {
    setNow('2026-09-07T08:00:00Z');
    const sami = await verifiedAthlete(3);
    const karim = await verifiedAthlete(3);
    const stranger = await verifiedAthlete();
    await befriend(sami.id, karim.id);

    await api().post('/api/v1/battles').set(await auth(sami.id)).send({ opponentId: stranger.id }).expect(403);
    const created = await api().post('/api/v1/battles').set(await auth(sami.id)).send({ opponentId: karim.id, durationDays: 7 }).expect(201);
    expect(created.body).toMatchObject({ status: 'PENDING', startsAt: null, components: ['progress', 'consistency', 'performance'] });
    await api().post(`/api/v1/battles/${created.body.id}/accept`).set(await auth(sami.id)).expect(409); // creator can't accept
    await api().post('/api/v1/battles').set(await auth(sami.id)).send({ opponentId: karim.id }).expect(409); // one open battle per pair

    setNow('2026-09-07T09:00:00Z');
    const accepted = await api().post(`/api/v1/battles/${created.body.id}/accept`).set(await auth(karim.id)).expect(200);
    expect(accepted.body).toMatchObject({ status: 'ACTIVE', startsAt: '2026-09-07T09:00:00.000Z', endsAt: '2026-09-14T09:00:00.000Z' });

    // Sami trains 3 days (his full plan), Karim once.
    await train(sami.id, '2026-09-08T07:00:00Z', 60);
    await train(sami.id, '2026-09-10T07:00:00Z', 62.5);
    await train(sami.id, '2026-09-12T07:00:00Z', 65);
    await train(karim.id, '2026-09-09T17:00:00Z', 100);

    setNow('2026-09-12T20:00:00Z');
    const live = await api().get(`/api/v1/battles/${created.body.id}`).set(await auth(karim.id)).expect(200);
    const liveScore = (id: string) => live.body.participants.find((p: { userId: string }) => p.userId === id);
    expect(liveScore(sami.id).breakdown.trainingDays).toBe(3);
    expect(liveScore(sami.id).score).toBeGreaterThan(liveScore(karim.id).score);

    // Not closed during the 24 h grace, closed after it.
    setNow('2026-09-15T08:00:00Z');
    await app.get(JobsService).runDue();
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe('ACTIVE');
    setNow('2026-09-15T10:00:00Z');
    await app.get(JobsService).runDue();
    const done = await api().get(`/api/v1/battles/${created.body.id}`).set(await auth(sami.id)).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.result).toMatchObject({ winnerId: sami.id, draw: false });

    const lp = async (userId: string) => (await prisma.leaguePointTransaction.findMany({ where: { userId, sourceId: created.body.id } })).map((x) => `${x.reason}:${x.amount}`);
    expect(await lp(sami.id)).toEqual(['BATTLE_WIN:25']);
    expect(await lp(karim.id)).toEqual(['BATTLE_PARTICIPATION:5']); // trained, so participation counts
    const xp = await prisma.xpTransaction.findMany({ where: { userId: sami.id, sourceType: 'battle' } });
    expect(xp.map((x) => x.reason).sort()).toEqual(['BATTLE', 'BATTLE_WIN']);
    expect(await prisma.xpTransaction.count({ where: { userId: karim.id, reason: 'BATTLE' } })).toBe(1); // effort XP in defeat
    expect(await prisma.notification.count({ where: { userId: karim.id, type: 'BATTLE_RESULT' } })).toBe(1);
    await app.get(JobsService).runDue(); // idempotent
    expect(await lp(sami.id)).toEqual(['BATTLE_WIN:25']);

    // A second battle between the same friends in the same week earns XP but no LP (anti-collusion).
    setNow('2026-09-15T11:00:00Z');
    const second = await api().post('/api/v1/battles').set(await auth(karim.id)).send({ opponentId: sami.id, durationDays: 3, components: ['consistency'] }).expect(201);
    await api().post(`/api/v1/battles/${second.body.id}/accept`).set(await auth(sami.id)).expect(200);
    await train(karim.id, '2026-09-16T07:00:00Z', 102.5);
    setNow('2026-09-19T12:00:00Z');
    await app.get(JobsService).runDue();
    const secondDone = await prisma.battle.findUniqueOrThrow({ where: { id: second.body.id }, include: { participants: true } });
    expect(secondDone.status).toBe('COMPLETED');
    const karimP = secondDone.participants.find((p) => p.userId === karim.id)!;
    expect(karimP.outcome).toBe('WIN');
    expect((karimP.breakdown as { lpSkippedReason: string | null }).lpSkippedReason).toBe('WEEKLY_FRIEND_BATTLE_LP_LIMIT');
    expect(karimP.lpTransactionId).toBeNull();
  });

  it('expires unanswered invitations after 48 h', async () => {
    setNow('2026-09-20T08:00:00Z');
    const a = await verifiedAthlete();
    const b = await verifiedAthlete();
    await befriend(a.id, b.id);
    const inv = await api().post('/api/v1/battles').set(await auth(a.id)).send({ opponentId: b.id }).expect(201);
    await prisma.battle.update({ where: { id: inv.body.id }, data: { createdAt: new Date('2026-09-17T08:00:00Z') } });
    await app.get(JobsService).runDue();
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: inv.body.id } })).status).toBe('EXPIRED');
  });
});
