import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { registerUser, setupTestApp } from './helpers';

describe('Gyms: verification & memberships (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('runs the whole gym workflow', async () => {
    const owner = await registerUser(app, prisma);
    const athlete = await registerUser(app, prisma);
    const stranger = await registerUser(app, prisma);
    const admin = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: admin.session.userId }, data: { role: 'ADMIN' } });
    const sousse = await prisma.governorate.findUniqueOrThrow({ where: { code: 'TN-51' }, include: { cities: true } });
    const gymBody = {
      name: 'Kalâa Strength Club',
      governorateId: sousse.id,
      cityId: sousse.cities[0]!.id,
      contactPhone: '+21673000000',
      socialLinks: { instagram: 'https://instagram.com/kalaa.strength' },
      proofOfOwnership: 'RNE 1234567A, website kalaa-strength.tn',
    };

    // Creating a gym needs a verified email.
    expect((await api().post('/api/v1/gyms').set(bearer(owner.session.accessToken)).send(gymBody).expect(403)).body.code).toBe('EMAIL_NOT_VERIFIED');
    await prisma.user.update({ where: { id: owner.session.userId }, data: { emailVerifiedAt: new Date() } });
    await api().post('/api/v1/gyms').set(bearer(owner.session.accessToken)).send({ ...gymBody, socialLinks: { instagram: 'javascript:alert(1)' } }).expect(422);
    const created = await api().post('/api/v1/gyms').set(bearer(owner.session.accessToken)).send(gymBody).expect(201);
    expect(created.body).toMatchObject({ status: 'PENDING', slug: 'kalaa-strength-club' });

    // Not public until verified; a normal user can't see the queue.
    await api().get(`/api/v1/gyms/${created.body.id}`).set(bearer(athlete.session.accessToken)).expect(404);
    await api().get('/api/v1/admin/gyms/verification-requests').set(bearer(owner.session.accessToken)).expect(403);

    const queue = await api().get('/api/v1/admin/gyms/verification-requests?limit=100').set(bearer(admin.session.accessToken)).expect(200);
    const req = queue.body.data.find((r: { gym: { id: string } }) => r.gym.id === created.body.id);
    expect(req.proofText).toContain('RNE');
    await api().post(`/api/v1/admin/gyms/verification-requests/${req.id}/review`).set(bearer(admin.session.accessToken)).send({ decision: 'APPROVE', note: 'RNE checked' }).expect(200);

    const ownerRow = await prisma.user.findUniqueOrThrow({ where: { id: owner.session.userId }, include: { profile: true } });
    expect(ownerRow.role).toBe('GYM_ADMIN');
    expect(ownerRow.profile?.primaryGymId).toBe(created.body.id);
    expect(await prisma.auditLog.count({ where: { entityId: created.body.id, action: 'GYM_VERIFIED' } })).toBe(1);

    // An athlete asks to join; only this gym's admin can approve.
    await api().post(`/api/v1/gyms/${created.body.id}/membership`).set(bearer(athlete.session.accessToken)).expect(201);
    await api().post(`/api/v1/gyms/${created.body.id}/membership`).set(bearer(athlete.session.accessToken)).expect(409);
    await api().post(`/api/v1/gyms/${created.body.id}/members/${athlete.session.userId}/approve`).set(bearer(stranger.session.accessToken)).expect(403);
    const pending = await api().get(`/api/v1/gyms/${created.body.id}/membership-requests`).set(bearer(owner.session.accessToken)).expect(200);
    expect(pending.body.map((p: { userId: string }) => p.userId)).toEqual([athlete.session.userId]);
    await api().post(`/api/v1/gyms/${created.body.id}/members/${athlete.session.userId}/approve`).set(bearer(owner.session.accessToken)).expect(200);

    const profile = await api().get(`/api/v1/gyms/${created.body.id}`).set(bearer(stranger.session.accessToken)).expect(200);
    expect(profile.body).toMatchObject({ name: 'Kalâa Strength Club', verified: true, membersCount: 2, warRecord: null });
    expect(JSON.stringify(profile.body)).not.toContain('+21673000000'); // contact details stay private
    const me = await api().get('/api/v1/me').set(bearer(athlete.session.accessToken)).expect(200);
    expect(me.body.profile.gym).toMatchObject({ id: created.body.id });

    // Search, then leave.
    const found = await api().get('/api/v1/gyms?q=kal%C3%A2a').set(bearer(stranger.session.accessToken)).expect(200);
    expect(found.body.data.map((g: { id: string }) => g.id)).toContain(created.body.id);
    await api().delete('/api/v1/gyms/me/membership').set(bearer(athlete.session.accessToken)).expect(204);
    expect((await api().get('/api/v1/gyms/me/membership').set(bearer(athlete.session.accessToken)).expect(200)).body).toEqual({});
  });
});
