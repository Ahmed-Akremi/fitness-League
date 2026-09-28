import { Module } from '@nestjs/common';
import { BattlesModule } from '../battles/battles.module';
import { DuelsModule } from '../duels/duels.module';
import { LeaderboardsModule } from '../leaderboards/leaderboards.module';
import { SeasonsModule } from '../seasons/seasons.module';
import { PrivacyModule } from '../users/privacy.module';
import { JobsService } from './jobs.service';

@Module({ imports: [SeasonsModule, LeaderboardsModule, PrivacyModule, BattlesModule, DuelsModule], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
