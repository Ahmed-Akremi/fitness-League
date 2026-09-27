import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { adminBearer, registerUser, setupTestApp } from './helpers';

describe('Gym submission with logo, reviewed by staff (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const png = readFileSync(join(__dirname, 'fixtures/logo.png'));

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp({ STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'fl-media-')) }));
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('owner submits a gym with sports and a logo, follows it, and a super admin approves it', async () => {
    const owner = await registerUser(app, prisma);
    const stranger = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: owner.session.userId }, data: { emailVerifiedAt: new Date() } });
    const tunis = await prisma.governorate.findUniqueOrThrow({ where: { code: 'TN-11' }, include: { cities: true } });
    const crossfit = await prisma.sport.findUniqueOrThrow({ where: { code: 'CROSSFIT' } });
    const hyrox = await prisma.sport.findUniqueOrThrow({ where: { code: 'HYROX' } });

    const created = await api()
      .post('/api/v1/gyms')
      .set(bearer(owner.session.accessToken))
      .send({ name: 'Lac Hybrid Club', governorateId: tunis.id, cityId: tunis.cities[0]!.id, sportIds: [crossfit.id, hyrox.id], proofOfOwnership: 'RNE 7654321B, contrat de bail' })
      .expect(201);

    // The submitter adds the gym photo while the request is pending; nobody else can.
    await api().put(`/api/v1/gyms/${created.body.id}/logo`).set(bearer(stranger.session.accessToken)).attach('file', png, 'logo.png').expect(403);
    const logo = await api().put(`/api/v1/gyms/${created.body.id}/logo`).set(bearer(owner.session.accessToken)).attach('file', png, 'logo.png').expect(200);

    const mine = await api().get('/api/v1/gyms/mine').set(bearer(owner.session.accessToken)).expect(200);
    expect(mine.body).toEqual([expect.objectContaining({ id: created.body.id, name: 'Lac Hybrid Club', status: 'PENDING', logoUrl: logo.body.logoUrl })]);

    const admin = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: admin.session.userId }, data: { role: 'SUPER_ADMIN' } });
    const adminAuth = await adminBearer(app, prisma, admin.session.userId);
    const queue = await api().get('/api/v1/admin/gyms/verification-requests?limit=100').set(adminAuth).expect(200);
    const req = queue.body.data.find((r: { gym: { id: string } }) => r.gym.id === created.body.id);
    expect(req.gym).toMatchObject({ logoUrl: logo.body.logoUrl, sports: ['CROSSFIT', 'HYROX'] });
    await api().post(`/api/v1/admin/gyms/verification-requests/${req.id}/review`).set(adminAuth).send({ decision: 'APPROVE' }).expect(200);

    expect((await api().get('/api/v1/gyms/mine').set(bearer(owner.session.accessToken)).expect(200)).body[0].status).toBe('VERIFIED');
    // Once verified, the owner (now GYM_ADMIN after a fresh sign-in) can still change the logo.
    const relog = await api().post('/api/v1/auth/login').send({ email: owner.body.email, password: owner.body.password }).expect(200);
    await api().put(`/api/v1/gyms/${created.body.id}/logo`).set(bearer(relog.body.accessToken)).attach('file', png, 'logo.png').expect(200);
  });
});
