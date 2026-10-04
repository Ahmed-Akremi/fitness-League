import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.service';
import { AdminCompetitionsController, AdminJudgeController, CompetitionsController, JudgeController } from './competitions.controller';
import { CompetitionsService } from './competitions.service';
import { HeatsService } from './heats.service';
import { JudgingService } from './judging.service';

/** Competitions (CrossFit / functional fitness events): organizers, athletes, judges, leaderboard. */
@Module({ imports: [NotificationsModule], controllers: [CompetitionsController, JudgeController, AdminJudgeController, AdminCompetitionsController], providers: [CompetitionsService, JudgingService, HeatsService], exports: [CompetitionsService, JudgingService] })
export class CompetitionsModule {}
