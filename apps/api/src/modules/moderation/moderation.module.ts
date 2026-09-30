import { Module } from '@nestjs/common';
import { AdminModerationController, ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

@Module({ controllers: [ModerationController, AdminModerationController], providers: [ModerationService] })
export class ModerationModule {}
