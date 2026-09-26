import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { uuidv7 } from '../ids/uuid';

export type DomainEventType = 'WorkoutAccepted' | 'WorkoutUpdated' | 'WorkoutDeleted' | 'WorkoutReviewed';

/**
 * Transactional outbox (docs §2.3): events are written in the same DB transaction as the change that caused
 * them, then dispatched by the worker. "Workout saved" and "points computed" can therefore never diverge.
 */
@Injectable()
export class OutboxService {
  async enqueue(tx: Prisma.TransactionClient, type: DomainEventType, payload: Prisma.InputJsonObject): Promise<void> {
    await tx.domainEventOutbox.create({ data: { id: uuidv7(), type, payload } });
  }
}

@Global()
@Module({ providers: [OutboxService], exports: [OutboxService] })
export class OutboxModule {}
