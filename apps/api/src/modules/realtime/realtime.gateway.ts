import { Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Client } from 'pg';
import type { Namespace, Socket } from 'socket.io';
import { ENV } from '../../common/config/config.module';
import type { Env } from '../../common/config/env.schema';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { REALTIME_CHANNEL, RealtimeMessage } from './realtime.publisher';

/**
 * WebSocket gateway `/ws` (docs §4.5): authenticated with the access token, each socket joins its `user:<id>`
 * room and may subscribe to battles it takes part in. Events come from PostgreSQL LISTEN, so any process can
 * publish them. Only started where an HTTP server exists (the worker never binds it).
 */
@WebSocketGateway({ namespace: '/ws', cors: { origin: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private listener: Client | null = null;

  @WebSocketServer() private server!: Namespace;

  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async afterInit(): Promise<void> {
    this.listener = new Client({ connectionString: this.env.DATABASE_URL });
    this.listener.on('notification', (n) => {
      if (n.channel !== REALTIME_CHANNEL || !n.payload) return;
      try {
        const m = JSON.parse(n.payload) as RealtimeMessage;
        this.server.to(m.room).emit(m.event, m.data);
      } catch (err) {
        this.logger.warn({ err }, 'Bad realtime payload');
      }
    });
    this.listener.on('error', (err) => this.logger.error({ err }, 'Realtime listener error'));
    await this.listener.connect();
    await this.listener.query(`LISTEN ${REALTIME_CHANNEL}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.listener?.end().catch(() => undefined);
  }

  async handleConnection(socket: Socket): Promise<void> {
    const raw = (socket.handshake.auth?.token as string | undefined) ?? socket.handshake.headers.authorization?.replace(/^Bearer /i, '');
    try {
      if (!raw) throw new Error('missing token');
      const claims = await this.tokens.verifyAccess(raw);
      // Same checks as the HTTP guard: a reset password or a ban invalidates live sockets too.
      const user = await this.prisma.user.findUnique({ where: { id: claims.sub }, select: { status: true, sessionVersion: true } });
      if (!user || user.status !== 'ACTIVE' || user.sessionVersion !== claims.sv) throw new Error('stale session');
      socket.data.userId = claims.sub;
      await socket.join(`user:${claims.sub}`);
    } catch {
      socket.emit('error', { code: 'UNAUTHENTICATED' });
      socket.disconnect(true);
    }
  }

  /** Live scores of a battle: only its participants may listen. */
  @SubscribeMessage('battle.subscribe')
  async subscribeBattle(@ConnectedSocket() socket: Socket, @MessageBody() body: { battleId?: string }): Promise<{ ok: boolean; error?: string }> {
    const userId = socket.data.userId as string | undefined;
    const battleId = typeof body?.battleId === 'string' ? body.battleId : '';
    const allowed = userId && /^[0-9a-f-]{36}$/i.test(battleId) && (await this.prisma.battleParticipant.count({ where: { battleId, userId } })) > 0;
    if (!allowed) return { ok: false, error: 'FORBIDDEN' };
    await socket.join(`battle:${battleId}`);
    return { ok: true };
  }

  @SubscribeMessage('battle.unsubscribe')
  async unsubscribeBattle(@ConnectedSocket() socket: Socket, @MessageBody() body: { battleId?: string }): Promise<{ ok: true }> {
    if (typeof body?.battleId === 'string') await socket.leave(`battle:${body.battleId}`);
    return { ok: true };
  }
}
