import { Module } from '@nestjs/common';
import { GoalsModule } from '../goals/goals.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SeasonsController } from './seasons.controller';
import { SeasonsService } from './seasons.service';
import { WeeklyScoreService } from './weekly-score.service';

@Module({
  imports: [LedgerModule, GoalsModule],
  controllers: [SeasonsController],
  providers: [SeasonsService, WeeklyScoreService],
  exports: [SeasonsService, WeeklyScoreService],
})
export class SeasonsModule {}
