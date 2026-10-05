import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { adminBearer, registerUser, setupTestApp } from './helpers';

/** MOVEMENT_REPS WODs: the athlete gives the reps of each movement, the app computes the score (never typed). */
describe('Competition WOD scored from reps per movement (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
  const video = 'https://youtu.be/dQw4w9WgXcQ';

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  async function user(role?: 'GYM_ADMIN') {
    const u = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: u.session.userId }, data: { emailVerifiedAt: new Date(), ...(role ? { role } : {}) } });
    const login = await api().post('/api/v1/auth/login').send({ email: u.body.email, password: u.body.password }).expect(200);
    return { id: u.session.userId, token: login.body.accessToken as string };
  }

  it('computes Σ reps × points per rep, capped at the WOD maximum on the leaderboard', async () => {
    const organizer = await user('GYM_ADMIN');
    const [ahmed, ali] = [await user(), await user()];
    const c = await api()
      .post('/api/v1/competitions')
      .set(bearer(organizer.token))
      .send({ title: 'AMRAP Cup', slug: `amrap-cup-${Date.now()}`, description: 'x', format: 'ONLINE', registrationStart: h(-1), registrationEnd: h(48), eventStart: h(72), eventEnd: h(96), registrationPrice: 0, currency: 'TND' })
      .expect(201);
    const base = `/api/v1/competitions/${c.body.id}`;
    const categoryId = (await api().post(`${base}/categories`).set(bearer(organizer.token)).send({ name: 'Open', gender: 'MIXED' }).expect(201)).body.id;

    const wod = { number: 1, name: 'WOD 2', description: '12 min AMRAP: burpees, wall balls', scoreType: 'MOVEMENT_REPS', scoringMethod: 'DIRECT_POINTS', maximumPoints: 100, submissionStart: h(-1), submissionDeadline: h(24) };
    // Every movement needs its points per rep.
    const missing = await api().post(`${base}/wods`).set(bearer(organizer.token)).send({ ...wod, movements: [{ name: 'Burpees', pointsPerRep: 0 }] }).expect(422);
    expect(missing.body.errors[0]).toMatchObject({ field: 'movements', code: 'POINTS_PER_REP_REQUIRED' });
    const w = await api()
      .post(`${base}/wods`)
      .set(bearer(organizer.token))
      .send({ ...wod, movements: [{ name: 'Burpees', pointsPerRep: 1 }, { name: 'Wall balls', pointsPerRep: 0.5 }] })
      .expect(201);
    expect(w.body.movements).toEqual([{ name: 'Burpees', pointsPerRep: 1 }, { name: 'Wall balls', pointsPerRep: 0.5 }]);

    await api().patch(`${base}/status`).set(bearer(organizer.token)).send({ status: 'REGISTRATION_OPEN' }).expect(200);
    for (const a of [ahmed, ali]) await api().post(`${base}/register`).set(bearer(a.token)).send({ categoryId }).expect(201);
    await api().patch(`${base}/status`).set(bearer(organizer.token)).send({ status: 'REGISTRATION_CLOSED' }).expect(200);
    await api().patch(`${base}/status`).set(bearer(organizer.token)).send({ status: 'SUBMISSION_OPEN' }).expect(200);

    const submit = (token: string, raw: unknown) => api().post(`${base}/wods/${w.body.id}/submissions`).set(bearer(token)).send({ clientId: randomUUID(), raw, videoUrl: video });
    // A typed score is not accepted: one whole rep count per movement.
    expect((await submit(ahmed.token, { value: 100 }).expect(422)).body.errors[0].code).toBe('SCORE_REQUIRED');
    await submit(ahmed.token, { movementReps: [60] }).expect(422);
    await submit(ahmed.token, { movementReps: [60, 7.5] }).expect(422);

    const a = await submit(ahmed.token, { movementReps: [60, 75] }).expect(201); // 60×1 + 75×0.5
    expect(Number(a.body.rawValue)).toBe(97.5);
    const b = await submit(ali.token, { movementReps: [80, 75] }).expect(201); // 117.5: computed, so accepted and capped
    expect(Number(b.body.rawValue)).toBe(117.5);

    const admin = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: admin.session.userId }, data: { role: 'ADMIN' } });
    const judge = await adminBearer(app, prisma, admin.session.userId);
    for (const id of [a.body.id, b.body.id]) await api().post(`/api/v1/admin/judge/submissions/${id}/approve`).set(judge).expect(200);

    const board = await api().get(`${base}/leaderboard?categoryId=${categoryId}`).set(bearer(ahmed.token)).expect(200);
    expect(board.body.rows.map((r: { athlete: { id: string }; totalPoints: number }) => [r.athlete.id, r.totalPoints])).toEqual([
      [ali.id, 100],
      [ahmed.id, 97.5],
    ]);
  });
});
