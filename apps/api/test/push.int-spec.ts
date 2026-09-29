import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { ClockService } from '../src/common/clock/clock.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { PUSH_SENDER, PushMessage, PushSender } from '../src/modules/push/push-sender';
import { registerUser, setupTestApp } from './helpers';

/** Push delivery (docs §3.9): devices, category switches, quiet hours, dead tokens. */
describe('Push notifications (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clock: jest.SpyInstance<Date, []>;
  const sent: PushMessage[] = [];
  let reply: 'SENT' | 'INVALID_TOKEN' = 'SENT';
  const api = () => request(app.getHttpServer());
  const setNow = (iso: string) => clock.mockReturnValue(new Date(iso));
  const auth = async (userId: string) => ({ authorization: `Bearer ${(await app.get(TokenService).signAccess({ sub: userId, role: 'USER', sv: 1 })).token}` });

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    const sender = app.get<PushSender>(PUSH_SENDER);
    jest.spyOn(sender, 'send').mockImplementation(async (m) => {
      sent.push(m);
      return reply;
    });
    clock = jest.spyOn(app.get(ClockService), 'now');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await prisma?.$disconnect();
  });

  async function athlete() {
    const { session } = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: session.userId }, data: { emailVerifiedAt: new Date('2026-08-01T00:00:00Z') } });
    return session.userId as string;
  }

  const friendRequest = async (from: string, to: string) => {
    await api().post('/api/v1/friends/requests').set(await auth(from)).send({ userId: to }).expect(201);
    await app.get(OutboxDispatcher).drainAll();
  };

  it('pushes to registered devices, honours categories and quiet hours, forgets dead tokens', async () => {
    const [a, b, c, d] = [await athlete(), await athlete(), await athlete(), await athlete()];
    setNow('2027-03-01T11:00:00Z'); // 12:00 in Tunis
    await api().put('/api/v1/me/devices').set(await auth(b)).send({ installId: 'install-b-0001', platform: 'ANDROID', fcmToken: 'token-b-0123456789abcdef', appVersion: '1.2.0' }).expect(204);

    await friendRequest(a, b);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ token: 'token-b-0123456789abcdef', title: 'Nouvelle demande', data: { type: 'FRIEND_REQUEST', unread: '1' } });

    const prefs = await api().put('/api/v1/me/notification-preferences').set(await auth(b)).send({ categories: { SOCIAL: false }, quietHours: { start: '22:00', end: '07:00' } }).expect(200);
    expect(prefs.body).toEqual({ categories: { SOCIAL: false, BATTLES: true, COMPETITION: true, CHALLENGES: true, BADGES: true, GYM: true }, quietHours: { start: '22:00', end: '07:00' } });
    await friendRequest(c, b);
    expect(sent).toHaveLength(1); // social pushes are off, the in-app list still has it
    const list = await api().get('/api/v1/notifications').set(await auth(b)).expect(200);
    expect(list.body.unread).toBe(2);

    // Quiet hours: 23:30 in Tunis.
    await api().put('/api/v1/me/notification-preferences').set(await auth(b)).send({ categories: { SOCIAL: true } }).expect(200);
    setNow('2027-03-01T22:30:00Z');
    await friendRequest(d, b);
    expect(sent).toHaveLength(1);

    // A dead token is forgotten.
    await api().put('/api/v1/me/notification-preferences').set(await auth(b)).send({ quietHours: null }).expect(200);
    reply = 'INVALID_TOKEN';
    const e = await athlete();
    await friendRequest(e, b);
    expect(sent).toHaveLength(2);
    expect((await prisma.device.findFirstOrThrow({ where: { userId: b } })).fcmToken).toBeNull();

    await api().delete('/api/v1/me/devices/install-b-0001').set(await auth(b)).expect(204);
    expect(await prisma.device.count({ where: { userId: b } })).toBe(0);
  });
});
