import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClockService } from '../src/common/clock/clock.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { BehaviourService } from '../src/modules/anticheat/behaviour.service';
import { RuleSetService } from '../src/modules/scoring/rule-set.service';
import { adminBearer, registerUser, setupTestApp } from './helpers';

/** Behavioural anti-cheat (docs §7.3): weekly scan raises flags, moderators review them. */
describe('Behavioural anti-cheat (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clock: jest.SpyInstance<Date, []>;
  const api = () => request(app.getHttpServer());
  const setNow = (iso: string) => clock.mockReturnValue(new Date(iso));

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    clock = jest.spyOn(app.get(ClockService), 'now');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await prisma?.$disconnect();
  });

  it('flags minimum-duration farming once, and a moderator clears it', async () => {
    setNow('2026-11-01T08:00:00Z');
    const { config } = await app.get(RuleSetService).getActive();
    const min = config.workout_min_duration_min * 60;
    const { session } = await registerUser(app, prisma);
    const athlete = session.userId as string;
    const sport = (await prisma.sport.findUniqueOrThrow({ where: { code: 'POWERLIFTING' } })).id;
    const squat = (await prisma.exercise.findUniqueOrThrow({ where: { code: 'BACK_SQUAT' } })).id;
    // Week of Monday 2026-11-09: seven workouts just above the minimum duration.
    for (let i = 0; i < 7; i++) {
      const at = new Date(Date.UTC(2026, 10, 9 + i, 8)).toISOString();
      setNow(at);
      const token = (await app.get(TokenService).signAccess({ sub: athlete, role: 'USER', sv: 1 })).token;
      const body = { clientId: randomUUID(), sportId: sport, workoutType: 'STRENGTH', performedAt: at, durationS: min + 60, exercises: [{ exerciseId: squat, sets: [{ reps: 5 + (i % 3), weightKg: 60 + i * 2.5 }] }] };
      await api().post('/api/v1/workouts').set({ authorization: `Bearer ${token}` }).set('idempotency-key', body.clientId).send(body).expect(201);
      await app.get(OutboxDispatcher).drainAll();
    }
    const week = new Date('2026-11-08T23:00:00Z'); // Monday 00:00 in Tunis
    const first = await app.get(BehaviourService).scanWeek(week);
    expect(first.FARMING).toBe(1);
    expect((await app.get(BehaviourService).scanWeek(week)).FARMING).toBe(0); // idempotent

    const mod = (await registerUser(app, prisma)).session.userId as string;
    await prisma.user.update({ where: { id: mod }, data: { role: 'MODERATOR' } });
    const flags = await api().get('/api/v1/admin/anticheat/flags').set(await adminBearer(app, prisma, mod)).expect(200);
    const f = flags.body.find((x: { userId: string }) => x.userId === athlete);
    expect(f).toMatchObject({ kind: 'FARMING', weekStart: '2026-11-09', details: { count: 7, nearMinimum: 7 } });
    await api().post(`/api/v1/admin/anticheat/flags/${f.id}/review`).set(await adminBearer(app, prisma, mod)).send({ status: 'CLEARED', note: 'Short sessions by plan' }).expect(200);
    await api().post(`/api/v1/admin/anticheat/flags/${f.id}/review`).set(await adminBearer(app, prisma, mod)).send({ status: 'CLEARED', note: 'Again' }).expect(409);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: athlete } })).toMatchObject({ status: 'ACTIVE' }); // flags never punish
  });
});
