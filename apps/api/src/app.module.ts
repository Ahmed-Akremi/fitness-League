import { Module } from '@nestjs/common';
import { AuditModule } from './common/audit/audit.module';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './common/config/config.module';
import { LoggerModule } from './common/logging/logger.module';
import { MailModule } from './common/mail/mail.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ReferenceModule } from './modules/reference/reference.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { RuleSetModule } from './modules/scoring/rule-set.module';
import { UsersModule } from './modules/users/users.module';
import { WorkoutsModule } from './modules/workouts/workouts.module';
import { GoalsModule } from './modules/goals/goals.module';
import { SeasonsModule } from './modules/seasons/seasons.module';
import { LeaderboardsModule } from './modules/leaderboards/leaderboards.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { GymsModule } from './modules/gyms/gyms.module';
import { GymWodsModule } from './modules/gym-wods/gym-wods.module';
import { AdminModule } from './modules/admin/admin.module';
import { SocialModule } from './modules/social/social.module';
import { BattlesModule } from './modules/battles/battles.module';
import { DuelsModule } from './modules/duels/duels.module';
import { GymWarsModule } from './modules/gym-wars/gym-wars.module';
import { BadgesModule } from './modules/badges/badges.module';
import { ChallengesModule } from './modules/challenges/challenges.module';
import { LeaguesModule } from './modules/leagues/leagues.module';
import { FeedModule } from './modules/feed/feed.module';
import { PushModule } from './modules/push/push.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { NotificationsModule } from './modules/notifications/notifications.service';
import { ProgressModule } from './modules/progress/progress.module';
import { SocialAccessModule } from './modules/social/social-access.module';
import { OutboxModule } from './common/outbox/outbox.service';
import { StorageModule } from './common/storage/storage.module';

@Module({
  imports: [ConfigModule, LoggerModule, PrismaModule, CommonModule, StorageModule, AuditModule, MailModule, OutboxModule, SocialAccessModule, RuleSetModule, ScoringModule, AuthModule, UsersModule, ReferenceModule, WorkoutsModule, ProgressModule, GoalsModule, SeasonsModule, LeaderboardsModule, JobsModule, GymsModule, GymWodsModule, NotificationsModule, SocialModule, BattlesModule, DuelsModule, GymWarsModule, BadgesModule, ChallengesModule, LeaguesModule, FeedModule, PushModule, RealtimeModule, AdminModule],
})
export class AppModule {}
