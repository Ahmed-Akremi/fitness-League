import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { InMemoryMailSender } from '../src/common/mail/mail-sender';
import { TokenService } from '../src/modules/auth/token.service';
import { adminBearer, registerUser, setupTestApp } from './helpers';

/** Reports, sanctions, appeals and the public moderation log (docs §3.12). */
describe('Moderation (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let mail: InMemoryMailSender;
  const api = () => request(app.getHttpServer());
  const auth = async (userId: string) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { authorization: `Bearer ${(await app.get(TokenService).signAccess({ sub: u.id, role: u.role, sv: u.sessionVersion })).token}` };
  };

  beforeAll(async () => {
    ({ app, prisma, mail } = await setupTestApp());
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  async function staff(role: 'MODERATOR' | 'ADMIN') {
    const id = (await registerUser(app, prisma)).session.userId as string;
    await prisma.user.update({ where: { id }, data: { role } });
    return { id, bearer: () => adminBearer(app, prisma, id) };
  }

  it('report → suspension (signed out, emailed appeal link) → appeal by link → overturned by another moderator', async () => {
    const reporter = (await registerUser(app, prisma)).session.userId as string;
    const target = (await registerUser(app, prisma)).session.userId as string;
    await api().post('/api/v1/reports').set(await auth(reporter)).send({ targetType: 'USER', targetId: reporter, reason: 'SPAM' }).expect(422);
    const r = await api().post('/api/v1/reports').set(await auth(reporter)).send({ targetType: 'USER', targetId: target, reason: 'HARASSMENT', details: 'Insults in comments' }).expect(201);
    const again = await api().post('/api/v1/reports').set(await auth(reporter)).send({ targetType: 'USER', targetId: target, reason: 'HARASSMENT' }).expect(201);
    expect(again.body.id).toBe(r.body.id);

    const mod = await staff('MODERATOR');
    const queue = await api().get('/api/v1/admin/reports').set(await mod.bearer()).expect(200);
    expect(queue.body.find((q: { id: string }) => q.id === r.body.id)).toMatchObject({ reason: 'HARASSMENT', reporter: expect.any(String), target: { userId: target, reportsTotal: 1, sanctionsTotal: 0 } });
    await api().post(`/api/v1/admin/reports/${r.body.id}/decide`).set(await mod.bearer()).send({ action: 'BAN', note: 'Repeated insults' }).expect(403);
    await api().post(`/api/v1/admin/reports/${r.body.id}/decide`).set(await mod.bearer()).send({ action: 'SUSPEND', note: 'Repeated insults' }).expect(422);
    const targetAuthBefore = await auth(target);
    const decided = await api().post(`/api/v1/admin/reports/${r.body.id}/decide`).set(await mod.bearer()).send({ action: 'SUSPEND', days: 7, note: 'Repeated insults' }).expect(200);
    expect(decided.body).toMatchObject({ status: 'ACTIONED', sanctionId: expect.any(String) });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target } })).toMatchObject({ status: 'SUSPENDED' });
    await api().get('/api/v1/me').set(targetAuthBefore).expect(401); // signed out everywhere
    expect((await api().get('/api/v1/me/reports').set(await auth(reporter)).expect(200)).body[0]).toMatchObject({ status: 'HANDLED' });

    // The suspended athlete appeals through the emailed link.
    const email = mail.outbox.find((m) => m.tag === 'SANCTION')!;
    const token = decodeURIComponent(/token=([^\s]+)/.exec(email.text)![1]!);
    const seen = await api().get('/api/v1/appeals').query({ token }).expect(200);
    expect(seen.body).toMatchObject({ kind: 'SUSPENSION', reason: 'HARASSMENT', note: 'Repeated insults', appeal: { status: 'NONE' } });
    await api().post('/api/v1/appeals').query({ token: `${token}x` }).send({ text: 'This was a misunderstanding.' }).expect(422);
    await api().post('/api/v1/appeals').query({ token }).send({ text: 'This was a misunderstanding with a friend.' }).expect(200);
    await api().post('/api/v1/appeals').query({ token }).send({ text: 'Second try is not allowed.' }).expect(409);

    // The deciding moderator cannot judge the appeal; another one overturns it.
    await api().post(`/api/v1/admin/sanctions/${decided.body.sanctionId}/appeal/decide`).set(await mod.bearer()).send({ decision: 'OVERTURN', note: 'Context checked' }).expect(403);
    const other = await staff('MODERATOR');
    const appeals = await api().get('/api/v1/admin/appeals').set(await other.bearer()).expect(200);
    expect(appeals.body.map((a: { id: string }) => a.id)).toContain(decided.body.sanctionId);
    await api().post(`/api/v1/admin/sanctions/${decided.body.sanctionId}/appeal/decide`).set(await other.bearer()).send({ decision: 'OVERTURN', note: 'Context checked' }).expect(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target } })).toMatchObject({ status: 'ACTIVE' });
    const mine = await api().get('/api/v1/me/sanctions').set(await auth(target)).expect(200);
    expect(mine.body[0]).toMatchObject({ kind: 'SUSPENSION', revoked: true, appeal: { status: 'OVERTURNED' } });

    // Public log: anonymised.
    const log = await api().get('/api/v1/moderation-log').set(await auth(reporter)).expect(200);
    expect(log.body[0]).toEqual({ date: expect.any(String), kind: 'SUSPENSION', reason: 'HARASSMENT', days: 7, appeal: 'OVERTURNED' });
    expect(JSON.stringify(log.body)).not.toContain(target);
  });

  it('warnings are appealed from the app; staff cannot be sanctioned through reports', async () => {
    const reporter = (await registerUser(app, prisma)).session.userId as string;
    const target = (await registerUser(app, prisma)).session.userId as string;
    const mod = await staff('MODERATOR');
    const r = await api().post('/api/v1/reports').set(await auth(reporter)).send({ targetType: 'USER', targetId: target, reason: 'SPAM' }).expect(201);
    const d = await api().post(`/api/v1/admin/reports/${r.body.id}/decide`).set(await mod.bearer()).send({ action: 'WARN', note: 'Stop posting links' }).expect(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target } })).toMatchObject({ status: 'ACTIVE' });
    await api().post(`/api/v1/me/sanctions/${d.body.sanctionId}/appeal`).set(await auth(target)).send({ text: 'short' }).expect(422);
    const a = await api().post(`/api/v1/me/sanctions/${d.body.sanctionId}/appeal`).set(await auth(target)).send({ text: 'Those links were to my own gym page.' }).expect(200);
    expect(a.body.appeal.status).toBe('PENDING');

    const admin = await staff('ADMIN');
    const r2 = await api().post('/api/v1/reports').set(await auth(reporter)).send({ targetType: 'USER', targetId: mod.id, reason: 'OTHER' }).expect(201);
    await api().post(`/api/v1/admin/reports/${r2.body.id}/decide`).set(await admin.bearer()).send({ action: 'WARN', note: 'Should not be possible' }).expect(403);
    await api().post(`/api/v1/admin/reports/${r2.body.id}/decide`).set(await admin.bearer()).send({ action: 'DISMISS', note: 'Not a moderation matter' }).expect(200);
  });
});
