import { Global, Module, OnModuleInit } from '@nestjs/common';
import { OutboxDispatcher } from '../../common/outbox/outbox-dispatcher';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimePublisher } from './realtime.publisher';

/** Real-time events (docs §4.5): new notifications and live battle scores over `/ws`. */
@Global()
@Module({ imports: [AuthModule], providers: [RealtimeGateway, RealtimePublisher], exports: [RealtimePublisher] })
export class RealtimeModule implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxDispatcher,
    private readonly publisher: RealtimePublisher,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('NotificationCreated', async (p) => {
      const n = await this.prisma.notification.findUnique({ where: { id: String(p.notificationId) } });
      if (!n) return;
      const unread = await this.prisma.notification.count({ where: { userId: n.userId, readAt: null } });
      await this.publisher.publish({ room: `user:${n.userId}`, event: 'notification.new', data: { id: n.id, type: n.type, payload: n.payload as Record<string, unknown>, unread } });
    });
    // A new or changed workout moves the live score of every running battle of its athlete.
    for (const event of ['WorkoutAccepted', 'WorkoutUpdated', 'WorkoutDeleted'] as const) {
      this.outbox.on(event, async (p) => {
        const battles = await this.prisma.battle.findMany({ where: { status: 'ACTIVE', participants: { some: { userId: String(p.userId) } } }, select: { id: true } });
        for (const b of battles) await this.publisher.publish({ room: `battle:${b.id}`, event: 'battle.score', data: { battleId: b.id } });
      });
    }
  }
}
