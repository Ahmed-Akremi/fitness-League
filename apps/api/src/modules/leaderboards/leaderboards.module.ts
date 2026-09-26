import { Module } from '@nestjs/common';
import { LeaderboardsController, MyRanksController } from './leaderboards.controller';
import { LeaderboardsService } from './leaderboards.service';

@Module({ controllers: [LeaderboardsController, MyRanksController], providers: [LeaderboardsService], exports: [LeaderboardsService] })
export class LeaderboardsModule {}
