import { Module, OnModuleInit } from '@nestjs/common';
import { OutboxDispatcher } from '../../common/outbox/outbox-dispatcher';
import { LedgerModule } from '../ledger/ledger.module';
import { PrivacyModule } from '../users/privacy.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({
  imports: [LedgerModule, PrivacyModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxDispatcher,
    private readonly goals: GoalsService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('BodyMeasurementAdded', (p) => this.goals.onBodyMeasurement(String(p.userId)));
  }
}
