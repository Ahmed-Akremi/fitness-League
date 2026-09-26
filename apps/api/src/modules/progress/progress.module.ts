import { Module } from '@nestjs/common';
import { PrivacyModule } from '../users/privacy.module';
import { ProgressQueryService } from './progress-query.service';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

@Module({
  imports: [PrivacyModule],
  controllers: [ProgressController],
  providers: [ProgressService, ProgressQueryService],
  exports: [ProgressService],
})
export class ProgressModule {}
