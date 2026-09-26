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
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [ConfigModule, LoggerModule, PrismaModule, CommonModule, AuditModule, MailModule, ScoringModule, AuthModule, UsersModule, ReferenceModule],
})
export class AppModule {}
