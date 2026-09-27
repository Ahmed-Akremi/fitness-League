import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { registerUser, setupTestApp } from './helpers';

describe('Reference catalog: CrossFit & Hyrox (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('exposes the Hyrox sport and exercise groups with descriptions', async () => {
    const { session } = await registerUser(app, prisma);
    const auth = { authorization: `Bearer ${session.accessToken}` };
    const sports = await api().get('/api/v1/ref/sports').set(auth).expect(200);
    const hyrox = sports.body.find((s: { code: string }) => s.code === 'HYROX');
    expect(hyrox).toBeDefined();
    const exercises = await api().get(`/api/v1/ref/exercises?sportId=${hyrox.id}`).set(auth).expect(200);
    const race = exercises.body.find((e: { code: string }) => e.code === 'HYROX_OPEN');
    expect(race).toMatchObject({ group: 'HYROX_RACE', trackedMetrics: ['FINISH_TIME'] });
    expect(race.description.fr).toContain('SkiErg');
    expect(exercises.body.filter((e: { group: string }) => e.group === 'HYROX_STATION')).toHaveLength(9);
  });
});
