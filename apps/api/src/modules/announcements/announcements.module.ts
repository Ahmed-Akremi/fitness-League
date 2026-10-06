import { Module } from '@nestjs/common';
import { AdminAnnouncementsController, AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

/** Admin news on the app home screen (text and/or one photo, likes only). */
@Module({ controllers: [AnnouncementsController, AdminAnnouncementsController], providers: [AnnouncementsService] })
export class AnnouncementsModule {}
