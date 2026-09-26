import { Module, OnModuleInit } from '@nestjs/common';
import { OutboxDispatcher } from '../../common/outbox/outbox-dispatcher';
import { LedgerModule } from '../ledger/ledger.module';
import { ProgressModule } from '../progress/progress.module';
import { PrivacyModule } from '../users/privacy.module';
import { ScoringController } from './scoring.controller';
import { WorkoutScoringService } from './workout-scoring.service';

@Module({
  imports: [LedgerModule, ProgressModule, PrivacyModule],
  controllers: [ScoringController],
  providers: [WorkoutScoringService],
  exports: [WorkoutScoringService],
})
export class ScoringModule implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxDispatcher,
    private readonly scoring: WorkoutScoringService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('WorkoutAccepted', (p) => this.scoring.onAccepted(String(p.workoutId)));
    this.outbox.on('WorkoutUpdated', (p) => this.scoring.onChanged(String(p.workoutId)));
    this.outbox.on('WorkoutDeleted', (p) => this.scoring.onChanged(String(p.workoutId)));
  }
}
