import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Machine tag, e.g. EMAIL_VERIFY. Lets tests and logs identify a message without parsing it. */
  tag: string;
}

export abstract class MailSender {
  abstract send(message: MailMessage): Promise<void>;
}

@Injectable()
export class SmtpMailSender extends MailSender {
  private readonly transporter: Transporter;

  constructor(url: string, private readonly from: string) {
    super();
    this.transporter = createTransport(url);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
  }
}

/** Used when SMTP_URL is empty (dev without mailpit, tests). Keeps messages in memory; never logs their content. */
@Injectable()
export class InMemoryMailSender extends MailSender {
  private readonly logger = new Logger('Mail');
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    this.logger.log(`Mail ${message.tag} queued in memory (SMTP_URL not set)`);
  }
}
