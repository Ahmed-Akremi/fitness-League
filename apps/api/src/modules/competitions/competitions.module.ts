import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.service';
import { CompetitionsController, JudgeController } from './competitions.controller';
import { CompetitionsService } from './competitions.service';
import { JudgingService } from './judging.service';

/** Competitions (CrossFit / functional fitness events): organizers, athletes, judges, leaderboard. */
@Module({ imports: [NotificationsModule], controllers: [CompetitionsController, JudgeController], providers: [CompetitionsService, JudgingService], exports: [CompetitionsService, JudgingService] })
export class CompetitionsModule {}
