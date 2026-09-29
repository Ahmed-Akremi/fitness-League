import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { OutboxDispatcher } from '../src/common/outbox/outbox-dispatcher';
import { TokenService } from '../src/modules/auth/token.service';
import { registerUser, setupTestApp } from './helpers';

/** WebSocket `/ws` (docs §4.5): authenticated sockets receive their notifications in real time. */
describe('Realtime gateway (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let url: string;
  const sockets: Socket[] = [];
  const token = async (userId: string) => (await app.get(TokenService).signAccess({ sub: userId, role: 'USER', sv: 1 })).token;

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    await app.listen(0);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/ws`;
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await app?.close();
    await prisma?.$disconnect();
  });

  const connect = (auth: Record<string, string>) => {
    const s = io(url, { auth, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    return s;
  };
  const next = <T>(s: Socket, event: string) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within 5 s`)), 5000);
    s.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  async function athlete() {
    const { session } = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: session.userId }, data: { emailVerifiedAt: new Date('2026-08-01T00:00:00Z') } });
    return session.userId as string;
  }

  it('pushes a new notification to the recipient socket only', async () => {
    const [a, b] = [await athlete(), await athlete()];
    const sb = connect({ token: await token(b) });
    const sa = connect({ token: await token(a) });
    await Promise.all([next(sb, 'connect'), next(sa, 'connect')]);
    let aGotOne = false;
    sa.on('notification.new', () => (aGotOne = true));

    const incoming = next<{ type: string; unread: number; payload: { fromUserId?: string } }>(sb, 'notification.new');
    await request(app.getHttpServer()).post('/api/v1/friends/requests').set({ authorization: `Bearer ${await token(a)}` }).send({ userId: b }).expect(201);
    await app.get(OutboxDispatcher).drainAll();
    expect(await incoming).toMatchObject({ type: 'FRIEND_REQUEST', unread: 1 });
    expect(aGotOne).toBe(false);
  });

  it('refuses sockets without a valid token and battle rooms of other athletes', async () => {
    const bad = connect({ token: 'not-a-token' });
    await next(bad, 'disconnect');
    const me = await athlete();
    const s = connect({ token: await token(me) });
    await next(s, 'connect');
    const ack = await s.timeout(5000).emitWithAck('battle.subscribe', { battleId: '01900000-0000-7000-8000-000000000000' });
    expect(ack).toEqual({ ok: false, error: 'FORBIDDEN' });
  });
});
