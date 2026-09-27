import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
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
});
