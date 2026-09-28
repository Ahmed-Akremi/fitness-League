import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { uuidv7 } from '../src/common/ids/uuid';
import { registerUser, setupTestApp } from './helpers';

describe('Gym WODs (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
  let gymId: string;
  let coach: Awaited<ReturnType<typeof registerUser>>;
  let member: Awaited<ReturnType<typeof registerUser>>;
  let outsider: Awaited<ReturnType<typeof registerUser>>;

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    gymId = (await prisma.gym.findUniqueOrThrow({ where: { slug: 'sahel-iron-club' } })).id;
    coach = await registerUser(app, prisma);
    member = await registerUser(app, prisma);
    outsider = await registerUser(app, prisma);
    for (const [u, role] of [
      [coach, 'COACH'],
      [member, 'MEMBER'],
    ] as const) {
      await prisma.gymMember.create({ data: { id: uuidv7(), gymId, userId: u.session.userId, status: 'APPROVED', approvedAt: new Date(), role } });
      await prisma.profile.update({ where: { userId: u.session.userId }, data: { primaryGymId: gymId } });
    }
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  const wodBody = { title: 'Sahel Burner', description: '21-15-9 thrusters / burpees', scoreType: 'FOR_TIME', timeCapS: 900, startsAt: h(-1), endsAt: h(48) };

  it('lets coaches create and edit WODs; members see published ones only', async () => {
    await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(member.session.accessToken)).send(wodBody).expect(403);
    await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, endsAt: h(-2) }).expect(422);
    await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, endsAt: h(24 * 40) }).expect(422);
    const created = await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send(wodBody).expect(201);
    expect(created.body).toMatchObject({ title: 'Sahel Burner', status: 'PUBLISHED', isOpen: true, myScore: null, scoreType: 'FOR_TIME', timeCapS: 900 });
    await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, title: 'Secret draft', status: 'DRAFT' }).expect(201);

    const memberList = await api().get(`/api/v1/gyms/${gymId}/wods?when=active`).set(bearer(member.session.accessToken)).expect(200);
    expect(memberList.body.data.map((w: { title: string }) => w.title)).toEqual(['Sahel Burner']);
    const coachList = await api().get(`/api/v1/gyms/${gymId}/wods?when=active`).set(bearer(coach.session.accessToken)).expect(200);
    expect(coachList.body.data).toHaveLength(2);
    await api().get(`/api/v1/gyms/${gymId}/wods`).set(bearer(outsider.session.accessToken)).expect(403);

    const edited = await api().patch(`/api/v1/gyms/${gymId}/wods/${created.body.id}`).set(bearer(coach.session.accessToken)).send({ title: 'Sahel Burner v2' }).expect(200);
    expect(edited.body.title).toBe('Sahel Burner v2');
    await api().patch(`/api/v1/gyms/${gymId}/wods/${created.body.id}`).set(bearer(member.session.accessToken)).send({ title: 'Hacked' }).expect(403);
    expect(await prisma.auditLog.count({ where: { action: { in: ['GYM_WOD_CREATED', 'GYM_WOD_UPDATED'] } } })).toBe(3);
  });

  it('accepts member scores inside the window, keeps the best and ranks them', async () => {
    const wod = (await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, title: 'Board test' }).expect(201)).body;
    const submit = (u: typeof member, body: Record<string, unknown>, hAgo = 0.2) =>
      api().put(`/api/v1/gyms/${gymId}/wods/${wod.id}/score`).set(bearer(u.session.accessToken)).send({ division: 'RX', performedAt: h(-hAgo), clientId: randomUUID(), ...body });

    await submit(outsider, { timeS: 400 }).expect(403);
    await submit(member, { timeS: 901 }).expect(422); // over the time cap
    await submit(member, { reps: 100 }).expect(422); // wrong kind of score for FOR_TIME
    expect((await submit(member, { timeS: 420 }).expect(200)).body.myScore).toMatchObject({ value: 420, division: 'RX', status: 'VALID' });
    expect((await submit(member, { timeS: 480 }, 0.5).expect(200)).body.myScore.value).toBe(420); // worse: board keeps 420
    await submit(coach, { timeS: 390 }).expect(200);
    expect(await prisma.workout.count({ where: { userId: member.session.userId, workoutType: 'GYM_WOD' } })).toBe(2); // both sessions logged

    const board = await api().get(`/api/v1/gyms/${gymId}/wods/${wod.id}/leaderboard?division=RX`).set(bearer(member.session.accessToken)).expect(200);
    expect(board.body.data.map((r: { rank: number; value: number }) => [r.rank, r.value])).toEqual([
      [1, 390],
      [2, 420],
    ]);
    expect(board.body.data[1].athlete.id).toBe(member.session.userId);
    const me = await api().get(`/api/v1/gyms/${gymId}/wods/${wod.id}/leaderboard/me?division=RX`).set(bearer(member.session.accessToken)).expect(200);
    expect(me.body).toMatchObject({ rank: 2, value: 420 });
    expect((await api().get(`/api/v1/gyms/${gymId}/wods/${wod.id}/leaderboard?division=SCALED`).set(bearer(member.session.accessToken)).expect(200)).body.data).toEqual([]);
    expect(await prisma.metricObservation.count({ where: { workout: { workoutType: 'GYM_WOD' } } })).toBe(0); // never PRs
  });

  it('refuses scores after the WOD closes and from members who left', async () => {
    const closed = (await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, title: 'Closed', startsAt: h(-5), endsAt: h(-1) }).expect(201)).body;
    const res = await api().put(`/api/v1/gyms/${gymId}/wods/${closed.id}/score`).set(bearer(member.session.accessToken)).send({ division: 'RX', timeS: 300, performedAt: h(-2), clientId: randomUUID() }).expect(409);
    expect(res.body.code).toBe('WOD_CLOSED');

    const open = (await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, title: 'Leaver test' }).expect(201)).body;
    const leaver = await registerUser(app, prisma);
    await prisma.gymMember.create({ data: { id: uuidv7(), gymId, userId: leaver.session.userId, status: 'APPROVED', approvedAt: new Date() } });
    await api().delete('/api/v1/gyms/me/membership').set(bearer(leaver.session.accessToken)).expect(204);
    await api().put(`/api/v1/gyms/${gymId}/wods/${open.id}/score`).set(bearer(leaver.session.accessToken)).send({ division: 'RX', timeS: 300, performedAt: h(-0.1), clientId: randomUUID() }).expect(403);
  });

  it('lets a coach invalidate a score: removed from the board, XP reversed, member notified', async () => {
    const wod = (await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, title: 'Invalidate', scoreType: 'AMRAP', timeCapS: 1200 }).expect(201)).body;
    const sub = await api().put(`/api/v1/gyms/${gymId}/wods/${wod.id}/score`).set(bearer(member.session.accessToken)).send({ division: 'SCALED', rounds: 12, reps: 190, performedAt: h(-0.9), clientId: randomUUID() }).expect(200); // 20 min AMRAP, no overlap with the member's other sessions
    const scoreId = sub.body.myScore.id;
    expect(sub.body.myScore).toMatchObject({ value: 190, rounds: 12, division: 'SCALED' });
    await api().post(`/api/v1/gyms/${gymId}/wods/${wod.id}/scores/${scoreId}/invalidate`).set(bearer(member.session.accessToken)).send({ reason: 'self' }).expect(403);
    await api().post(`/api/v1/gyms/${gymId}/wods/${wod.id}/scores/${scoreId}/invalidate`).set(bearer(coach.session.accessToken)).send({ reason: 'No-rep on pull-ups' }).expect(200);
    await api().post(`/api/v1/gyms/${gymId}/wods/${wod.id}/scores/${scoreId}/invalidate`).set(bearer(coach.session.accessToken)).send({ reason: 'again' }).expect(404);

    const board = await api().get(`/api/v1/gyms/${gymId}/wods/${wod.id}/leaderboard?division=SCALED`).set(bearer(coach.session.accessToken)).expect(200);
    expect(board.body.data).toEqual([]);
    const score = await prisma.gymWodScore.findUniqueOrThrow({ where: { id: scoreId } });
    expect(score).toMatchObject({ status: 'INVALIDATED', invalidationReason: 'No-rep on pull-ups', invalidatedById: coach.session.userId });
    expect((await prisma.workout.findUniqueOrThrow({ where: { id: score.workoutId } })).deletedAt).not.toBeNull();
    const notes = await api().get('/api/v1/notifications').set(bearer(member.session.accessToken)).expect(200);
    expect(notes.body.data[0]).toMatchObject({ type: 'GYM_WOD_SCORE_INVALIDATED', payload: { gymId, wodId: wod.id, wodTitle: 'Invalidate', reason: 'No-rep on pull-ups' } });
    expect(await prisma.auditLog.count({ where: { action: 'GYM_WOD_SCORE_INVALIDATED', entityId: scoreId } })).toBe(1);
    const view = await api().get(`/api/v1/gyms/${gymId}/wods/${wod.id}`).set(bearer(member.session.accessToken)).expect(200);
    expect(view.body.myScore).toMatchObject({ status: 'INVALIDATED', invalidationReason: 'No-rep on pull-ups' });
  });

  it('invalidates cleanly even when the member already deleted the linked workout', async () => {
    const wod = (await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, title: 'Deleted session' }).expect(201)).body;
    const sub = await api().put(`/api/v1/gyms/${gymId}/wods/${wod.id}/score`).set(bearer(member.session.accessToken)).send({ division: 'RX', timeS: 500, performedAt: h(-6), clientId: randomUUID() }).expect(200);
    const score = await prisma.gymWodScore.findUniqueOrThrow({ where: { id: sub.body.myScore.id } });
    await api().delete(`/api/v1/workouts/${score.workoutId}`).set(bearer(member.session.accessToken)).expect(204);
    await api().post(`/api/v1/gyms/${gymId}/wods/${wod.id}/scores/${score.id}/invalidate`).set(bearer(coach.session.accessToken)).send({ reason: 'Late check' }).expect(200);
    expect((await prisma.gymWodScore.findUniqueOrThrow({ where: { id: score.id } })).status).toBe('INVALIDATED');
  });

  it('only approved members post scores (not platform staff from outside the gym)', async () => {
    const wod = (await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, title: 'Staff test' }).expect(201)).body;
    const staff = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: staff.session.userId }, data: { role: 'ADMIN' } });
    await api().put(`/api/v1/gyms/${gymId}/wods/${wod.id}/score`).set(bearer(staff.session.accessToken)).send({ division: 'RX', timeS: 400, performedAt: h(-8), clientId: randomUUID() }).expect(403);
  });
});
