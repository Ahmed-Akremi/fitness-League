import { Module, OnModuleInit } from '@nestjs/common';
import { OutboxDispatcher } from '../../common/outbox/outbox-dispatcher';
import { AdminAnnouncementsController, AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

/** Admin news on the app home screen (text and/or one photo, likes only). */
@Module({ controllers: [AnnouncementsController, AdminAnnouncementsController], providers: [AnnouncementsService] })
export class AnnouncementsModule implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxDispatcher,
    private readonly announcements: AnnouncementsService,
  ) {}

  onModuleInit(): void {
    // Runs in the worker: one bell notification per active athlete.
    this.outbox.on('AnnouncementPublished', async (p) => {
      await this.announcements.fanOut(String(p.announcementId));
    });
  }
}
