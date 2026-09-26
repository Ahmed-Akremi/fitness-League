import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { registerUser, setupTestApp } from './helpers';

describe('Workouts, anti-cheat & offline sync (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ids: { strength: string; running: string; squat: string; bench: string; run: string; pullUp: string };
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  const squatWorkout = (over: Record<string, unknown> = {}) => ({
    clientId: randomUUID(),
    sportId: ids.strength,
    workoutType: 'STRENGTH',
    performedAt: hoursAgo(3),
    durationS: 3600,
    exercises: [{ exerciseId: ids.squat, sets: [{ reps: 5, weightKg: 60, isWarmup: true }, { reps: 5, weightKg: 100 }, { reps: 5, weightKg: 100 }] }],
    ...over,
  });
  const runWorkout = (distanceM: number, durationS: number, over: Record<string, unknown> = {}) => ({
    clientId: randomUUID(),
    sportId: ids.running,
    workoutType: 'EASY_RUN',
    performedAt: hoursAgo(5),
    durationS,
    exercises: [{ exerciseId: ids.run, sets: [{ distanceM, durationS }] }],
    ...over,
  });
  const post = (token: string, body: { clientId: string } & Record<string, unknown>) =>
    api().post('/api/v1/workouts').set(bearer(token)).set('idempotency-key', body.clientId).send(body);

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    const sport = (code: string) => prisma.sport.findUniqueOrThrow({ where: { code } }).then((s) => s.id);
    const ex = (code: string) => prisma.exercise.findUniqueOrThrow({ where: { code } }).then((e) => e.id);
    ids = {
      strength: await sport('POWERLIFTING'),
      running: await sport('RUNNING'),
      squat: await ex('BACK_SQUAT'),
      bench: await ex('BENCH_PRESS'),
      run: await ex('RUN'),
      pullUp: await ex('PULL_UP'),
    };
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('logging', () => {
    it('stores the workout, derives volume and e1RM, and emits a WorkoutAccepted event', async () => {
      const { session } = await registerUser(app, prisma);
      const body = squatWorkout();
      const res = await post(session.accessToken, body).expect(201);
      expect(res.headers.etag).toBe('"1"');
      expect(res.body).toMatchObject({
        clientId: body.clientId,
        status: 'ACCEPTED',
        totalVolumeKg: 1000,
        evaluation: { outcome: 'ACCEPTED', ruleHits: [], countsForCompetition: true },
      });
      expect(res.body.exercises[0].sets.map((s: { e1rmKg: number | null }) => s.e1rmKg)).toEqual([null, 116.67, 116.67]);
      const events = await prisma.domainEventOutbox.findMany({ where: { type: 'WorkoutAccepted' } });
      expect(events.some((e) => (e.payload as { workoutId: string }).workoutId === res.body.id)).toBe(true);
    });

    it('refuses client-sent points and a missing or mismatching Idempotency-Key', async () => {
      const { session } = await registerUser(app, prisma);
      const withXp = { ...squatWorkout(), xp: 500, leaguePoints: 99 };
      const res = await post(session.accessToken, withXp).expect(422);
      expect(res.body.errors).toEqual(expect.arrayContaining([{ field: 'xp', code: 'UNKNOWN_FIELD' }, { field: 'leaguePoints', code: 'UNKNOWN_FIELD' }]));
      await api().post('/api/v1/workouts').set(bearer(session.accessToken)).send(squatWorkout()).expect(422);
      await api().post('/api/v1/workouts').set(bearer(session.accessToken)).set('idempotency-key', randomUUID()).send(squatWorkout()).expect(422);
    });

    it('validates sport/exercise consistency and set shapes', async () => {
      const { session } = await registerUser(app, prisma);
      const wrongSport = squatWorkout({ sportId: ids.running });
      expect((await post(session.accessToken, wrongSport).expect(422)).body.errors).toEqual([{ field: 'exercises[0].exerciseId', code: 'EXERCISE_NOT_IN_SPORT' }]);
      const noWeight = squatWorkout({ exercises: [{ exerciseId: ids.squat, sets: [{ reps: 5 }] }] });
      expect((await post(session.accessToken, noWeight).expect(422)).body.errors).toEqual([{ field: 'exercises[0].sets[0].weightKg', code: 'REQUIRED' }]);
      const pullUps = squatWorkout({ exercises: [{ exerciseId: ids.pullUp, sets: [{ reps: 12 }] }] });
      await post(session.accessToken, pullUps).expect(201);
    });
  });

  describe('offline idempotency', () => {
    it('replays the same submission, and refuses the same clientId with different data', async () => {
      const { session } = await registerUser(app, prisma);
      const body = squatWorkout();
      const first = await post(session.accessToken, body).expect(201);
      const replay = await post(session.accessToken, { ...body, deviceSubmittedAt: new Date().toISOString() }).expect(200);
      expect(replay.body.id).toBe(first.body.id);
      expect(await prisma.workout.count({ where: { clientId: body.clientId } })).toBe(1);

      const changed = { ...body, durationS: 4200 };
      const conflict = await post(session.accessToken, changed).expect(409);
      expect(conflict.body).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', workout: { id: first.body.id, durationS: 3600 } });
    });

    it('syncs a batch with one result per item', async () => {
      const { session } = await registerUser(app, prisma);
      const a = squatWorkout({ performedAt: hoursAgo(30) });
      const b = runWorkout(5000, 1600, { performedAt: hoursAgo(20) });
      const impossible = runWorkout(100_000, 1200, { performedAt: hoursAgo(10) });
      const first = await api().post('/api/v1/workouts/sync').set(bearer(session.accessToken)).send({ items: [a, b, impossible] }).expect(200);
      expect(first.body.results.map((r: { result: string }) => r.result)).toEqual(['CREATED', 'CREATED', 'REJECTED']);

      // The same outbox is flushed again after a lost response: nothing is duplicated.
      const again = await api().post('/api/v1/workouts/sync').set(bearer(session.accessToken)).send({ items: [a, { ...b, durationS: 1700 }] }).expect(200);
      expect(again.body.results.map((r: { result: string }) => r.result)).toEqual(['REPLAYED', 'CONFLICT']);
      expect(await prisma.workout.count({ where: { userId: session.userId } })).toBe(3);
    });
  });

  describe('anti-cheat', () => {
    it('rejects the impossible (100 km in 20 min) with the rule hits, and keeps rejecting on replay', async () => {
      const { session } = await registerUser(app, prisma);
      const body = runWorkout(100_000, 1200);
      const res = await post(session.accessToken, body).expect(422);
      expect(res.body.code).toBe('WORKOUT_REJECTED');
      expect(res.body.workout.evaluation.ruleHits.map((h: { rule: string }) => h.rule)).toContain('RUN_PACE');
      await post(session.accessToken, body).expect(422);
    });

    it('rejects a duplicate of an overlapping workout', async () => {
      const { session } = await registerUser(app, prisma);
      const performedAt = hoursAgo(6);
      await post(session.accessToken, squatWorkout({ performedAt })).expect(201);
      const dup = await post(session.accessToken, squatWorkout({ performedAt })).expect(422);
      expect(dup.body.workout.evaluation.ruleHits).toEqual([expect.objectContaining({ rule: 'DUPLICATE_WORKOUT', severity: 'HARD' })]);
    });

    it('holds exceptional performances for a moderator, who can approve them (audited)', async () => {
      const { session } = await registerUser(app, prisma);
      const heavy = squatWorkout({ exercises: [{ exerciseId: ids.squat, sets: [{ reps: 1, weightKg: 320 }] }] });
      const held = await post(session.accessToken, heavy).expect(201);
      expect(held.body).toMatchObject({ status: 'HELD_FOR_REVIEW', evaluation: { ruleHits: [expect.objectContaining({ rule: 'LIFT_ABSOLUTE_KG', severity: 'SOFT' })] } });

      // A normal user cannot see the queue.
      await api().get('/api/v1/admin/workouts/held').set(bearer(session.accessToken)).expect(403);

      const mod = await registerUser(app, prisma);
      await prisma.user.update({ where: { id: mod.session.userId }, data: { role: 'MODERATOR' } });
      const queue = await api().get('/api/v1/admin/workouts/held?limit=100').set(bearer(mod.session.accessToken)).expect(200);
      expect(queue.body.data.map((w: { id: string }) => w.id)).toContain(held.body.id);

      const approved = await api().post(`/api/v1/admin/workouts/${held.body.id}/approve`).set(bearer(mod.session.accessToken)).send({ note: 'Competition video checked' }).expect(200);
      expect(approved.body.status).toBe('ACCEPTED');
      await api().post(`/api/v1/admin/workouts/${held.body.id}/reject`).set(bearer(mod.session.accessToken)).send({ note: 'twice' }).expect(404);
      expect(await prisma.auditLog.count({ where: { entityId: held.body.id, action: 'WORKOUT_APPROVED', actorId: mod.session.userId } })).toBe(1);
    });
  });

  describe('visibility', () => {
    it('shows public workouts to others without the anti-cheat details, and hides private/friends-only ones', async () => {
      const owner = await registerUser(app, prisma);
      const other = await registerUser(app, prisma);
      const pub = await post(owner.session.accessToken, squatWorkout({ visibility: 'PUBLIC', performedAt: hoursAgo(40) })).expect(201);
      const priv = await post(owner.session.accessToken, squatWorkout({ visibility: 'PRIVATE', performedAt: hoursAgo(50) })).expect(201);
      const friends = await post(owner.session.accessToken, squatWorkout({ visibility: 'FRIENDS', performedAt: hoursAgo(60) })).expect(201);

      const seen = await api().get(`/api/v1/workouts/${pub.body.id}`).set(bearer(other.session.accessToken)).expect(200);
      expect(seen.body.evaluation).toBeUndefined();
      await api().get(`/api/v1/workouts/${priv.body.id}`).set(bearer(other.session.accessToken)).expect(404);
      await api().get(`/api/v1/workouts/${friends.body.id}`).set(bearer(other.session.accessToken)).expect(404);

      // Once blocked, even public workouts disappear.
      await prisma.block.create({ data: { blockerId: owner.session.userId, blockedId: other.session.userId } });
      await api().get(`/api/v1/workouts/${pub.body.id}`).set(bearer(other.session.accessToken)).expect(404);
    });
  });

  describe('edit, delete, list', () => {
    it('edits with optimistic concurrency and re-runs the anti-cheat', async () => {
      const { session } = await registerUser(app, prisma);
      const created = await post(session.accessToken, squatWorkout()).expect(201);
      const { clientId: _c, ...content } = squatWorkout({ performedAt: created.body.performedAt });

      await api().patch(`/api/v1/workouts/${created.body.id}`).set(bearer(session.accessToken)).send(content).expect(422); // no If-Match
      const edited = await api()
        .patch(`/api/v1/workouts/${created.body.id}`)
        .set(bearer(session.accessToken))
        .set('if-match', '"1"')
        .send({ ...content, exercises: [{ exerciseId: ids.squat, sets: [{ reps: 1, weightKg: 330 }] }] })
        .expect(200);
      expect(edited.body).toMatchObject({ version: 2, status: 'HELD_FOR_REVIEW' });
      expect(edited.headers.etag).toBe('"2"');

      const stale = await api().patch(`/api/v1/workouts/${created.body.id}`).set(bearer(session.accessToken)).set('if-match', '"1"').send(content).expect(412);
      expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', workout: { version: 2 } });
      expect(await prisma.domainEventOutbox.count({ where: { type: 'WorkoutUpdated' } })).toBeGreaterThanOrEqual(1);
    });

    it('closes the edit window after 24 hours', async () => {
      const { session } = await registerUser(app, prisma);
      const created = await post(session.accessToken, squatWorkout()).expect(201);
      const { clientId: _c, ...content } = squatWorkout({ performedAt: created.body.performedAt });
      // Age the workout rather than the clock (a moved clock would also expire the access token).
      await prisma.workout.update({ where: { id: created.body.id }, data: { receivedAt: new Date(Date.now() - 25 * 3_600_000) } });
      const res = await api().patch(`/api/v1/workouts/${created.body.id}`).set(bearer(session.accessToken)).set('if-match', '"1"').send(content).expect(409);
      expect(res.body.code).toBe('EDIT_WINDOW_CLOSED');
    });

    it('soft-deletes (with an event) and paginates the history newest first', async () => {
      const { session } = await registerUser(app, prisma);
      const made = [];
      for (const h of [80, 70, 60, 50, 40]) made.push((await post(session.accessToken, squatWorkout({ performedAt: hoursAgo(h) })).expect(201)).body.id);
      await api().delete(`/api/v1/workouts/${made[0]}`).set(bearer(session.accessToken)).expect(204);
      await api().get(`/api/v1/workouts/${made[0]}`).set(bearer(session.accessToken)).expect(404);

      const p1 = await api().get('/api/v1/workouts?limit=2').set(bearer(session.accessToken)).expect(200);
      expect(p1.body.data.map((w: { id: string }) => w.id)).toEqual([made[4], made[3]]);
      const p2 = await api().get(`/api/v1/workouts?limit=2&cursor=${p1.body.page.nextCursor}`).set(bearer(session.accessToken)).expect(200);
      expect(p2.body.data.map((w: { id: string }) => w.id)).toEqual([made[2], made[1]]);
      expect(p2.body.page).toEqual({ nextCursor: null, hasMore: false });
      // Another user never sees someone else's list.
      const other = await registerUser(app, prisma);
      expect((await api().get('/api/v1/workouts').set(bearer(other.session.accessToken)).expect(200)).body.data).toEqual([]);
    });
  });
});
