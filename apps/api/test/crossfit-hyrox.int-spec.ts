import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { registerUser, setupTestApp } from './helpers';

describe('CrossFit & Hyrox workouts (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const drain = () => app.get(OutboxDispatcher).drainAll();

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('activates rule set v2 with FINISH_TIME progression', async () => {
    const active = await prisma.scoringRuleSet.findFirstOrThrow({ where: { status: 'ACTIVE' }, include: { expectedProgression: { include: { metricType: true } } } });
    expect(active.version).toBe(2);
    expect(active.basedOnVersion).toBe(1);
    expect(active.expectedProgression.filter((e) => e.metricType.code === 'FINISH_TIME')).toHaveLength(3);
    expect((await prisma.scoringRuleSet.findUniqueOrThrow({ where: { version: 1 } })).status).toBe('ARCHIVED');
  });

  it('turns a faster Hyrox race into a FINISH_TIME record and rejects an impossible one', async () => {
    const { session } = await registerUser(app, prisma);
    const hyrox = await prisma.sport.findUniqueOrThrow({ where: { code: 'HYROX' } });
    const race = await prisma.exercise.findUniqueOrThrow({ where: { code: 'HYROX_OPEN' } });
    const log = (hAgo: number, seconds: number) => {
      const clientId = randomUUID();
      return api()
        .post('/api/v1/workouts')
        .set(bearer(session.accessToken))
        .set('idempotency-key', clientId)
        .send({ clientId, sportId: hyrox.id, workoutType: 'RACE', durationS: seconds, performedAt: hoursAgo(hAgo), exercises: [{ exerciseId: race.id, sets: [{ durationS: seconds }] }] });
    };
    expect((await log(60, 5400).expect(201)).body.status).toBe('ACCEPTED');
    await drain();
    expect((await log(30, 5100).expect(201)).body.status).toBe('ACCEPTED');
    const impossible = await log(3, 2500).expect(422); // faster than the world record
    expect(impossible.body).toMatchObject({ code: 'WORKOUT_REJECTED', workout: { evaluation: { ruleHits: [{ rule: 'FINISH_TIME_S', severity: 'HARD' }] } } });
    await drain();

    const records = await api().get('/api/v1/me/records').set(bearer(session.accessToken)).expect(200);
    const pr = records.body.find((r: { exercise: { code: string }; metric: { code: string } }) => r.exercise.code === 'HYROX_OPEN' && r.metric.code === 'FINISH_TIME');
    expect(pr).toMatchObject({ value: 5100, previousValue: 5400, metric: { unit: 's' } });
  });
});
