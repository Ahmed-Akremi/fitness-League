import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export const REALTIME_CHANNEL = 'fl_realtime';

export type RealtimeEvent = 'notification.new' | 'battle.score';

export interface RealtimeMessage {
  /** Socket.IO room: `user:<id>` or `battle:<id>`. */
  room: string;
  event: RealtimeEvent;
  data: Record<string, unknown>;
}

/**
 * Publishes real-time events through PostgreSQL NOTIFY, so the worker (which produces most events) reaches the
 * sockets held by the API processes without Redis. Payloads stay small: clients refetch what they need.
 */
@Injectable()
export class RealtimePublisher {
  constructor(private readonly prisma: PrismaService) {}

  async publish(message: RealtimeMessage): Promise<void> {
    await this.prisma.$executeRaw`SELECT pg_notify(${REALTIME_CHANNEL}, ${JSON.stringify(message)})`;
  }
}
