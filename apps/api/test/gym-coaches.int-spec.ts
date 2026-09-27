import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { uuidv7 } from '../src/common/ids/uuid';
import { registerUser, setupTestApp } from './helpers';

describe('Gym coaches (integration)', () => {
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

  it('lets the gym admin appoint and remove a coach among approved members only', async () => {
    const owner = await registerUser(app, prisma);
    const member = await registerUser(app, prisma);
    const outsider = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: owner.session.userId }, data: { role: 'GYM_ADMIN' } });
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: 'sahel-iron-club' } });
    await prisma.gym.update({ where: { id: gym.id }, data: { ownerUserId: owner.session.userId } });
    await prisma.gymMember.create({ data: { id: uuidv7(), gymId: gym.id, userId: member.session.userId, status: 'APPROVED', approvedAt: new Date() } });
    const url = (u: string) => `/api/v1/gyms/${gym.id}/members/${u}/coach`;

    await api().post(url(member.session.userId)).set(bearer(member.session.accessToken)).expect(403);
    await api().post(url(outsider.session.userId)).set(bearer(owner.session.accessToken)).expect(404);
    await api().post(url(member.session.userId)).set(bearer(owner.session.accessToken)).expect(200);

    const profile = await api().get(`/api/v1/gyms/${gym.id}`).set(bearer(member.session.accessToken)).expect(200);
    expect(profile.body.myMembership).toEqual({ status: 'APPROVED', role: 'COACH' });
    const members = await api().get(`/api/v1/gyms/${gym.id}/members?limit=50`).set(bearer(owner.session.accessToken)).expect(200);
    expect(members.body.data.find((m: { id: string }) => m.id === member.session.userId).role).toBe('COACH');
    expect(await prisma.auditLog.count({ where: { action: 'GYM_COACH_APPOINTED' } })).toBe(1);

    await api().delete(url(member.session.userId)).set(bearer(owner.session.accessToken)).expect(204);
    expect((await prisma.gymMember.findFirstOrThrow({ where: { userId: member.session.userId, gymId: gym.id } })).role).toBe('MEMBER');
    expect((await api().get(`/api/v1/gyms/${gym.id}`).set(bearer(member.session.accessToken)).expect(200)).body.myMembership).toEqual({ status: 'APPROVED', role: 'MEMBER' });
  });
});
