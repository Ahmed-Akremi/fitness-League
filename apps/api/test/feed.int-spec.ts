import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClockService } from '../src/common/clock/clock.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { registerUser, setupTestApp } from './helpers';

/** Activity feed (docs §3.9): friends' activity, reactions, comments, mutes, blocks, deleted workouts. */
describe('Activity feed (integration)', () => {
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

  async function train(userId: string, performedAtIso: string, visibility = 'FRIENDS') {
    setNow(performedAtIso);
    const body = { clientId: randomUUID(), sportId: ids.powerlifting, workoutType: 'STRENGTH', performedAt: performedAtIso, durationS: 3600, visibility, exercises: [{ exerciseId: ids.squat, sets: [{ reps: 5, weightKg: 100 }] }] };
    const r = await api().post('/api/v1/workouts').set(await auth(userId)).set('idempotency-key', body.clientId).send(body).expect(201);
    await app.get(OutboxDispatcher).drainAll();
    return r.body.id as string;
  }

  async function befriend(a: string, b: string) {
    await api().post('/api/v1/friends/requests').set(await auth(a)).send({ userId: b }).expect(201);
    await api().post(`/api/v1/friends/requests/${a}/accept`).set(await auth(b)).expect(200);
  }

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    clock = jest.spyOn(app.get(ClockService), 'now');
    setNow('2027-02-01T08:00:00Z');
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

  it('shows friends activity with reactions and comments, and respects privacy, mutes and deletions', async () => {
    const [me, friend, stranger] = [await athlete(), await athlete(), await athlete()];
    await befriend(me, friend);
    const w1 = await train(friend, '2027-02-01T09:00:00Z');
    await train(friend, '2027-02-01T12:00:00Z', 'PRIVATE');
    await train(stranger, '2027-02-01T10:00:00Z', 'PUBLIC');

    const feed = await api().get('/api/v1/feed').set(await auth(me)).expect(200);
    const items = feed.body.data as { id: string; type: string; user: { id: string }; details: Record<string, unknown> }[];
    expect(items.every((i) => i.user.id === friend)).toBe(true);
    const workout = items.find((i) => i.type === 'WORKOUT')!;
    expect(workout.details).toMatchObject({ durationS: 3600, sport: { code: 'POWERLIFTING' } });
    expect(items.filter((i) => i.type === 'WORKOUT')).toHaveLength(1); // the private one stays hidden
    expect(items.some((i) => i.type === 'BADGE')).toBe(true);

    // Reactions: one per athlete; changing it keeps a single one and notifies once.
    await api().put(`/api/v1/activities/${workout.id}/reactions`).set(await auth(me)).send({ type: 'FIRE' }).expect(200);
    const changed = await api().put(`/api/v1/activities/${workout.id}/reactions`).set(await auth(me)).send({ type: 'STRONG' }).expect(200);
    expect(changed.body).toEqual({ reactions: { LIKE: 0, FIRE: 0, STRONG: 1 }, myReaction: 'STRONG' });
    await api().put(`/api/v1/activities/${workout.id}/reactions`).set(await auth(stranger)).send({ type: 'LIKE' }).expect(404);

    const c = await api().post(`/api/v1/activities/${workout.id}/comments`).set(await auth(me)).send({ body: '  Beast mode  ' }).expect(201);
    expect(c.body).toMatchObject({ body: 'Beast mode', isMine: true });
    const thread = await api().get(`/api/v1/activities/${workout.id}/comments`).set(await auth(friend)).expect(200);
    expect(thread.body.data).toEqual([expect.objectContaining({ body: 'Beast mode', user: expect.objectContaining({ id: me }), isMine: false })]);
    const notes = await api().get('/api/v1/notifications').set(await auth(friend)).expect(200);
    const types = notes.body.data.map((n: { type: string }) => n.type);
    expect(types.filter((t: string) => t === 'ACTIVITY_REACTION')).toHaveLength(1);
    expect(types).toContain('ACTIVITY_COMMENT');

    const again = await api().get('/api/v1/feed').set(await auth(me)).expect(200);
    expect(again.body.data.find((i: { id: string }) => i.id === workout.id)).toMatchObject({ reactions: { STRONG: 1 }, myReaction: 'STRONG', comments: 1 });

    // The activity's author can delete a comment on it; a stranger cannot.
    await api().delete(`/api/v1/activities/${workout.id}/comments/${c.body.id}`).set(await auth(stranger)).expect(403);
    await api().delete(`/api/v1/activities/${workout.id}/comments/${c.body.id}`).set(await auth(friend)).expect(204);

    // Mute hides the friend; deleting the workout removes its item.
    await api().put(`/api/v1/me/mutes/${friend}`).set(await auth(me)).expect(204);
    expect((await api().get('/api/v1/feed').set(await auth(me)).expect(200)).body.data).toHaveLength(0);
    await api().delete(`/api/v1/me/mutes/${friend}`).set(await auth(me)).expect(204);
    await api().delete(`/api/v1/workouts/${w1}`).set(await auth(friend)).expect(204);
    await app.get(OutboxDispatcher).drainAll();
    const after = await api().get('/api/v1/feed').set(await auth(me)).expect(200);
    expect(after.body.data.find((i: { id: string }) => i.id === workout.id)).toBeUndefined();
  });
});
