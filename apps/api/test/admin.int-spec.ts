import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { adminBearer, registerUser, setupTestApp } from './helpers';

describe('Admin API: 2FA sign-in, users, rule sets, seasons, ledger (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());

  async function staff(role: 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN') {
    const r = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: r.session.userId }, data: { role } });
    return { ...r, auth: await adminBearer(app, prisma, r.session.userId) };
  }

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('signs staff in with email + password only, in a session separate from the app', async () => {
    const { body, session } = await registerUser(app, prisma);
    const creds = { email: body.email, password: body.password };
    // A regular athlete can't use the admin panel at all.
    expect((await api().post('/api/v1/admin/auth/login').send(creds).expect(403)).body.code).toBe('FORBIDDEN');

    await prisma.user.update({ where: { id: session.userId }, data: { role: 'ADMIN' } });
    await api().post('/api/v1/admin/auth/login').send({ ...creds, password: 'wrong password!' }).expect(401);
    const first = await api().post('/api/v1/admin/auth/login').send(creds).expect(200);
    expect(first.body.totpSetup).toBeUndefined();
    const adminAccess = first.body.session.accessToken as string;
    // No second step: the former enrolment route is gone.
    await api().post('/api/v1/admin/auth/totp/confirm').send({ setupToken: 'x'.repeat(30), code: '000000' }).expect(404);
    const second = await api().post('/api/v1/admin/auth/login').send(creds).expect(200);

    // Audiences never mix.
    await api().get('/api/v1/admin/stats/overview').set({ authorization: `Bearer ${adminAccess}` }).expect(200);
    await api().get('/api/v1/me').set({ authorization: `Bearer ${adminAccess}` }).expect(401);
    await api().get('/api/v1/admin/stats/overview').set({ authorization: `Bearer ${session.accessToken}` }).expect(401);
    await api().post('/api/v1/auth/refresh').send({ refreshToken: second.body.session.refreshToken }).expect(401);
    await api().post('/api/v1/admin/auth/refresh').send({ refreshToken: second.body.session.refreshToken }).expect(200);
    expect(await prisma.auditLog.count({ where: { actorId: session.userId, action: 'ADMIN_LOGIN' } })).toBe(2);
  });


  it('enforces the RBAC matrix on user sanctions and roles', async () => {
    const mod = await staff('MODERATOR');
    const admin = await staff('ADMIN');
    const superAdmin = await staff('SUPER_ADMIN');
    const athlete = await registerUser(app, prisma);
    const id = athlete.session.userId;

    const list = await api().get(`/api/v1/admin/users?q=${athlete.body.username}`).set(mod.auth).expect(200);
    expect(list.body.data.map((u: { id: string }) => u.id)).toEqual([id]);

    // Moderators suspend, but only admins ban.
    await api().patch(`/api/v1/admin/users/${id}/status`).set(mod.auth).send({ status: 'BANNED', reason: 'cheating' }).expect(403);
    await api().patch(`/api/v1/admin/users/${id}/status`).set(mod.auth).send({ status: 'SUSPENDED', until: new Date(Date.now() + 86_400_000).toISOString(), reason: 'fake PRs' }).expect(200);
    expect((await api().get('/api/v1/me').set({ authorization: `Bearer ${athlete.session.accessToken}` })).status).toBe(401); // signed out everywhere
    await api().patch(`/api/v1/admin/users/${id}/status`).set(admin.auth).send({ status: 'BANNED', reason: 'repeated cheating' }).expect(200);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: { in: ['USER_SUSPENDED', 'USER_BANNED'] } } })).toBe(2);

    // Nobody acts on themselves or on an equal/higher role; admins grant up to moderator only.
    const other = await registerUser(app, prisma);
    await api().patch(`/api/v1/admin/users/${mod.session.userId}/role`).set(mod.auth).send({ role: 'ADMIN' }).expect(403);
    await api().patch(`/api/v1/admin/users/${admin.session.userId}/role`).set(admin.auth).send({ role: 'SUPER_ADMIN' }).expect(403);
    await api().patch(`/api/v1/admin/users/${other.session.userId}/role`).set(admin.auth).send({ role: 'ADMIN' }).expect(403);
    await api().patch(`/api/v1/admin/users/${other.session.userId}/role`).set(admin.auth).send({ role: 'MODERATOR' }).expect(200);
    await api().patch(`/api/v1/admin/users/${superAdmin.session.userId}/status`).set(admin.auth).send({ status: 'SUSPENDED', reason: 'x x x' }).expect(403);
    await api().patch(`/api/v1/admin/users/${other.session.userId}/role`).set(superAdmin.auth).send({ role: 'ADMIN' }).expect(200);
  });

  it('edits rule sets as drafts, validates with a dry run, and lets only super admins activate', async () => {
    const admin = await staff('ADMIN');
    const superAdmin = await staff('SUPER_ADMIN');
    // The seed ships v1 then v2 (v2 active); a new draft is based on whatever is active.
    const base = (await prisma.scoringRuleSet.findFirstOrThrow({ where: { status: 'ACTIVE' } })).version;
    const v = base + 1;
    const draft = await api().post('/api/v1/admin/rule-sets').set(admin.auth).send({ changeNote: 'Double the workout base XP' }).expect(201);
    expect(draft.body).toMatchObject({ version: v, status: 'DRAFT', basedOnVersion: base });

    const config = { ...draft.body.config, lp_weights: { progress: 0.5, consistency: 0.25, performance: 0.2, challenge: 0.15 } };
    const invalid = await api().put(`/api/v1/admin/rule-sets/${v}`).set(admin.auth).send({ config }).expect(422);
    expect(invalid.body.errors[0]).toMatchObject({ field: 'config.lp_weights', code: 'INVALID' });

    await api().put(`/api/v1/admin/rule-sets/${v}`).set(admin.auth).send({ config: { ...draft.body.config, workout_base_xp: 20 } }).expect(200);
    const check = await api().post(`/api/v1/admin/rule-sets/${v}/validate`).set(admin.auth).expect(200);
    expect(check.body).toMatchObject({ valid: true, dryRun: { users: expect.any(Number) } });

    await api().post(`/api/v1/admin/rule-sets/${v}/activate`).set(admin.auth).expect(403);
    await api().post(`/api/v1/admin/rule-sets/${v}/activate`).set(superAdmin.auth).expect(200);
    const list = await api().get('/api/v1/admin/rule-sets').set(admin.auth).expect(200);
    expect(list.body.map((r: { version: number; status: string }) => `${r.version}:${r.status}`)).toEqual([`${v}:ACTIVE`, ...Array.from({ length: base }, (_, i) => `${base - i}:ARCHIVED`)]);
    await api().put(`/api/v1/admin/rule-sets/${v}`).set(admin.auth).send({ config: draft.body.config }).expect(409); // published = immutable

    // New workouts are scored with the new version (base 20 + 60 min / 3 = 40), and the entry records the version.
    const athlete = await registerUser(app, prisma);
    const sport = await prisma.sport.findUniqueOrThrow({ where: { code: 'POWERLIFTING' } });
    const squat = await prisma.exercise.findUniqueOrThrow({ where: { code: 'BACK_SQUAT' } });
    const w = { clientId: randomUUID(), sportId: sport.id, workoutType: 'STRENGTH', performedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), durationS: 3600, exercises: [{ exerciseId: squat.id, sets: [{ reps: 5, weightKg: 80 }] }] };
    await api().post('/api/v1/workouts').set({ authorization: `Bearer ${athlete.session.accessToken}` }).set('idempotency-key', w.clientId).send(w).expect(201);
    await app.get(OutboxDispatcher).drainAll();
    const xp = await prisma.xpTransaction.findFirstOrThrow({ where: { userId: athlete.session.userId, reason: 'WORKOUT' } });
    expect(xp).toMatchObject({ amount: 40, ruleSetVersion: v });
    expect(await prisma.auditLog.count({ where: { action: 'RULESET_ACTIVATED' } })).toBe(1);
  });

  it('schedules seasons without overlap and adjusts ledgers with an audit trail', async () => {
    const admin = await staff('ADMIN');
    await api().post('/api/v1/admin/seasons').set(admin.auth).send({ name: 'Overlap', startsAt: '2026-11-01T00:00:00Z', endsAt: '2027-02-01T00:00:00Z' }).expect(409);
    await api().post('/api/v1/admin/seasons').set(admin.auth).send({ name: 'Season 2027 Q1', startsAt: '2026-12-31T23:00:00Z', endsAt: '2027-03-31T23:00:00Z' }).expect(201);
    const seasons = await api().get('/api/v1/admin/seasons').set(admin.auth).expect(200);
    expect(seasons.body.map((s: { name: string }) => s.name)).toContain('Season 2027 Q1');

    const athlete = await registerUser(app, prisma);
    const res = await api().post('/api/v1/admin/ledger/adjustments').set(admin.auth).send({ userId: athlete.session.userId, kind: 'XP', amount: 50, reason: 'Compensation for outage' }).expect(201);
    expect(res.body).toMatchObject({ xpTotal: 50 });
    await api().post('/api/v1/admin/ledger/adjustments').set(admin.auth).send({ userId: athlete.session.userId, kind: 'LP', amount: 0, reason: 'nothing at all' }).expect(422);
    const logs = await api().get('/api/v1/admin/audit-logs?action=LEDGER_XP_ADJUSTED').set(admin.auth).expect(200);
    expect(logs.body.data[0]).toMatchObject({ actorId: admin.session.userId, entityId: athlete.session.userId, after: { amount: 50 } });
  });
});
