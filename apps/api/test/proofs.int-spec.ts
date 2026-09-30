import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { verificationFactor } from '../src/modules/seasons/weekly-score.service';
import { adminBearer, registerUser, setupTestApp } from './helpers';

/** Workout proofs (docs §3.5): upload with EXIF stripped, private listing, moderator review. */
describe('Workout proofs (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const auth = async (userId: string) => ({ authorization: `Bearer ${(await app.get(TokenService).signAccess({ sub: userId, role: 'USER', sv: 1 })).token}` });

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('uploads proofs, keeps them private and lets a moderator verify the workout', async () => {
    const { session } = await registerUser(app, prisma);
    const me = session.userId as string;
    const other = (await registerUser(app, prisma)).session.userId as string;
    const sport = (await prisma.sport.findUniqueOrThrow({ where: { code: 'POWERLIFTING' } })).id;
    const squat = (await prisma.exercise.findUniqueOrThrow({ where: { code: 'BACK_SQUAT' } })).id;
    const body = { clientId: randomUUID(), sportId: sport, workoutType: 'STRENGTH', performedAt: new Date(Date.now() - 3_600_000).toISOString(), durationS: 3600, exercises: [{ exerciseId: squat, sets: [{ reps: 5, weightKg: 100 }] }] };
    const w = await api().post('/api/v1/workouts').set(await auth(me)).set('idempotency-key', body.clientId).send(body).expect(201);
    await app.get(OutboxDispatcher).drainAll();
    const workoutId = w.body.id as string;

    const jpeg = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#c33' } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-device' } } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    await api().post(`/api/v1/workouts/${workoutId}/proofs`).set(await auth(me)).attach('file', Buffer.from('not an image'), 'x.jpg').expect(415);
    const added = await api().post(`/api/v1/workouts/${workoutId}/proofs`).query({ kind: 'SCREENSHOT' }).set(await auth(me)).attach('file', jpeg, 'proof.jpg').expect(201);
    expect(added.body).toMatchObject({ status: 'PENDING', proofs: [{ kind: 'SCREENSHOT', width: 2048, height: 1024 }] });

    // Stored image: WebP, resized, no EXIF left.
    const path = new URL(added.body.proofs[0].url).pathname;
    const stored = await api().get(path).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const meta = await sharp(stored.body as Buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();

    await api().get(`/api/v1/workouts/${workoutId}/proofs`).set(await auth(other)).expect(404);
    await api().post(`/api/v1/workouts/${workoutId}/proofs`).set(await auth(other)).attach('file', jpeg, 'p.jpg').expect(404);

    const modId = (await registerUser(app, prisma)).session.userId as string;
    await prisma.user.update({ where: { id: modId }, data: { role: 'MODERATOR' } });
    const mod = await adminBearer(app, prisma, modId);
    const queue = await api().get('/api/v1/admin/proofs/queue').set(mod).expect(200);
    expect(queue.body.find((q: { workoutId: string }) => q.workoutId === workoutId)).toMatchObject({ sport: 'POWERLIFTING', proofs: [{ kind: 'SCREENSHOT' }] });
    await api().post(`/api/v1/admin/proofs/${workoutId}/decide`).set(mod).send({ decision: 'REJECT' }).expect(422);
    await api().post(`/api/v1/admin/proofs/${workoutId}/decide`).set(mod).send({ decision: 'VERIFY' }).expect(200, { workoutId, status: 'VERIFIED' });
    expect(await prisma.workout.findUniqueOrThrow({ where: { id: workoutId } })).toMatchObject({ isVerified: true, proofStatus: 'VERIFIED', proofReviewedById: modId });
    await api().post(`/api/v1/admin/proofs/${workoutId}/decide`).set(mod).send({ decision: 'VERIFY' }).expect(409);

    // Verified proofs stay; the athlete is told.
    await api().delete(`/api/v1/workouts/${workoutId}/proofs/${added.body.proofs[0].id}`).set(await auth(me)).expect(409);
    const notes = await api().get('/api/v1/notifications').set(await auth(me)).expect(200);
    expect(notes.body.data.map((n: { type: string }) => n.type)).toContain('PROOF_VERIFIED');
  });

  it('weighs verified workouts in the performance factor', () => {
    expect(verificationFactor([], 1.25)).toBe(1);
    expect(verificationFactor([{ isVerified: true }, { isVerified: false }], 1.25)).toBe(1.125);
    expect(verificationFactor([{ isVerified: true }], 1.25)).toBe(1.25);
  });
});
