import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { registerUser, setupTestApp } from './helpers';

/** Gym admin dashboard (docs §4.5 P3). */
describe('Gym dashboard (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const auth = async (userId: string) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { authorization: `Bearer ${(await app.get(TokenService).signAccess({ sub: u.id, role: u.role, sv: u.sessionVersion })).token}` };
  };

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('shows members, activity and who to nudge to the gym admin only', async () => {
    const template = await prisma.gym.findUniqueOrThrow({ where: { slug: 'sahel-iron-club' } });
    const owner = (await registerUser(app, prisma)).session.userId as string;
    await prisma.user.update({ where: { id: owner }, data: { role: 'GYM_ADMIN' } });
    const gym = await prisma.gym.create({ data: { id: randomUUID(), name: 'Dashboard Box', slug: `dashboard-box-${randomUUID().slice(0, 6)}`, governorateId: template.governorateId, cityId: template.cityId, status: 'VERIFIED', ownerUserId: owner } });
    const [a, b] = [(await registerUser(app, prisma)).session.userId as string, (await registerUser(app, prisma)).session.userId as string];
    for (const u of [a, b]) await prisma.gymMember.create({ data: { id: randomUUID(), gymId: gym.id, userId: u, status: 'APPROVED', approvedAt: new Date() } });
    const pendingUser = (await registerUser(app, prisma)).session.userId as string;
    await prisma.gymMember.create({ data: { id: randomUUID(), gymId: gym.id, userId: pendingUser, status: 'PENDING' } });

    const sport = (await prisma.sport.findUniqueOrThrow({ where: { code: 'POWERLIFTING' } })).id;
    const squat = (await prisma.exercise.findUniqueOrThrow({ where: { code: 'BACK_SQUAT' } })).id;
    const body = { clientId: randomUUID(), sportId: sport, workoutType: 'STRENGTH', performedAt: new Date(Date.now() - 3_600_000).toISOString(), durationS: 3600, exercises: [{ exerciseId: squat, sets: [{ reps: 5, weightKg: 100 }] }] };
    await api().post('/api/v1/workouts').set(await auth(a)).set('idempotency-key', body.clientId).send(body).expect(201);
    await app.get(OutboxDispatcher).drainAll();

    await api().get(`/api/v1/gyms/${gym.id}/dashboard`).set(await auth(a)).expect(403);
    const d = await api().get(`/api/v1/gyms/${gym.id}/dashboard`).set(await auth(owner)).expect(200);
    expect(d.body).toMatchObject({
      gym: { id: gym.id, name: 'Dashboard Box', rating: 1500 },
      members: { approved: 2, pending: 1, activeLast7Days: 1, activeLast28Days: 1 },
      wars: { wins: 0, losses: 0, draws: 0, enrolled: true },
    });
    expect(d.body.trend).toHaveLength(8);
    expect(d.body.toNudge).toEqual([expect.objectContaining({ userId: b, lastWorkoutAt: null })]);
  });
});
