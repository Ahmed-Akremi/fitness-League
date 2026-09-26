import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { InMemoryMailSender, MailSender, SmtpMailSender } from './mail-sender';

@Global()
@Module({
  providers: [
    {
      provide: MailSender,
      inject: [ENV],
      useFactory: (env: Env): MailSender => (env.SMTP_URL ? new SmtpMailSender(env.SMTP_URL, env.MAIL_FROM) : new InMemoryMailSender()),
    },
  ],
  exports: [MailSender],
})
export class MailModule {}
