import { Module, OnModuleInit } from '@nestjs/common';
import { OutboxDispatcher } from '../../common/outbox/outbox-dispatcher';
import { BadgesModule } from '../badges/badges.module';
import { GymsModule } from '../gyms/gyms.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';

@Module({ imports: [LedgerModule, BadgesModule, GymsModule], controllers: [ChallengesController], providers: [ChallengesService], exports: [ChallengesService] })
export class ChallengesModule implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxDispatcher,
    private readonly challenges: ChallengesService,
  ) {}

  onModuleInit(): void {
    // Progress follows the athlete's accepted workouts, including edits and deletions.
    for (const event of ['WorkoutAccepted', 'WorkoutUpdated', 'WorkoutDeleted'] as const) {
      this.outbox.on(event, async (p) => {
        await this.challenges.refreshFor(String(p.userId));
      });
    }
  }
}
