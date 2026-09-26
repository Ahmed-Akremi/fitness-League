import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { DomainEventType } from './outbox.service';

type Handler = (payload: Record<string, unknown>) => Promise<void>;

const MAX_ATTEMPTS = 10;

/**
 * Drains the outbox in creation order. Handlers must be idempotent (an event may be delivered again after a
 * crash). Single consumer by design (ASSUMPTION: one worker instance in Phase 1).
 */
@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private readonly handlers = new Map<DomainEventType, Handler[]>();

  constructor(private readonly prisma: PrismaService) {}

  on(type: DomainEventType, handler: Handler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  /** Processes up to `batch` events; returns how many were handled. */
  async drain(batch = 100): Promise<number> {
    const events = await this.prisma.domainEventOutbox.findMany({
      where: { processedAt: null, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batch,
    });
    for (const e of events) {
      try {
        for (const h of this.handlers.get(e.type as DomainEventType) ?? []) await h(e.payload as Record<string, unknown>);
        await this.prisma.domainEventOutbox.update({ where: { id: e.id }, data: { processedAt: new Date(), attempts: { increment: 1 } } });
      } catch (err) {
        this.logger.error({ err, eventId: e.id, type: e.type }, 'Outbox handler failed');
        await this.prisma.domainEventOutbox.update({ where: { id: e.id }, data: { attempts: { increment: 1 }, lastError: String(err).slice(0, 2000) } });
        // Later events of the same user may depend on this one: stop the batch and retry next tick.
        return events.indexOf(e);
      }
    }
    return events.length;
  }

  /** Drains until empty (tests, and the worker after a burst). */
  async drainAll(): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.drain();
      total += n;
      if (n === 0) return total;
    }
  }
}
