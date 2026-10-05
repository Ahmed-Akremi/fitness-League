import { Module, OnModuleInit } from '@nestjs/common';
import { ENV } from '../../common/config/config.module';
import type { Env } from '../../common/config/env.schema';
import { OutboxDispatcher } from '../../common/outbox/outbox-dispatcher';
import { FcmPushSender, LogPushSender, PUSH_SENDER } from './push-sender';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  controllers: [PushController],
  providers: [
    PushService,
    {
      provide: PUSH_SENDER,
      inject: [ENV],
      useFactory: (env: Env) => (env.PUSH_DRIVER === 'fcm' ? new FcmPushSender(env.FCM_PROJECT_ID!, env.FCM_CLIENT_EMAIL!, env.FCM_PRIVATE_KEY!.replace(/\\n/g, '\n')) : new LogPushSender()),
    },
  ],
  exports: [PushService],
})
export class PushModule implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxDispatcher,
    private readonly push: PushService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('NotificationCreated', async (p) => {
      await this.push.deliver(String(p.notificationId));
    });
  }
}
