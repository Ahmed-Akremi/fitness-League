import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './common/config/config.module';
import { LoggerModule } from './common/logging/logger.module';
import { PrismaModule } from './common/prisma/prisma.module';

@Module({
  imports: [ConfigModule, LoggerModule, PrismaModule, CommonModule],
})
export class WorkerModule {}
