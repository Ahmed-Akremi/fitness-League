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
import { SocialAccessModule } from './modules/social/social-access.module';
import { OutboxModule } from './common/outbox/outbox.service';

@Module({
  imports: [ConfigModule, LoggerModule, PrismaModule, CommonModule, AuditModule, MailModule, OutboxModule, SocialAccessModule, RuleSetModule, ScoringModule, AuthModule, UsersModule, ReferenceModule, WorkoutsModule],
})
export class AppModule {}
