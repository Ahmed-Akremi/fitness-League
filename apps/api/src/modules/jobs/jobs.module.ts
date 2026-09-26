import { Module } from '@nestjs/common';
import { BattlesModule } from '../battles/battles.module';
import { LeaderboardsModule } from '../leaderboards/leaderboards.module';
import { SeasonsModule } from '../seasons/seasons.module';
import { PrivacyModule } from '../users/privacy.module';
import { JobsService } from './jobs.service';

@Module({ imports: [SeasonsModule, LeaderboardsModule, PrivacyModule, BattlesModule], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
