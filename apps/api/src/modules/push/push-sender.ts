import { Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

/** `INVALID_TOKEN`: the device uninstalled the app or the token rotated; the caller forgets it. */
export type PushResult = 'SENT' | 'INVALID_TOKEN' | 'FAILED';

export interface PushSender {
  send(message: PushMessage): Promise<PushResult>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** Development driver: logs what would be sent. */
export class LogPushSender implements PushSender {
  private readonly logger = new Logger('Push');

  async send(m: PushMessage): Promise<PushResult> {
    this.logger.debug({ token: `${m.token.slice(0, 8)}…`, title: m.title, data: m.data }, 'push (log driver)');
    return 'SENT';
  }
}

/**
 * Firebase Cloud Messaging HTTP v1 with a service account (docs §2: FCM). The OAuth token is a self-signed JWT
 * exchanged at Google's token endpoint, cached until shortly before it expires; no SDK needed.
 */
export class FcmPushSender implements PushSender {
  private readonly logger = new Logger('Push');
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly projectId: string,
    private readonly clientEmail: string,
    private readonly privateKey: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  async send(m: PushMessage): Promise<PushResult> {
    const res = await this.http(`https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: m.token, notification: { title: m.title, body: m.body }, data: m.data, android: { priority: 'HIGH' } } }),
    });
    if (res.ok) return 'SENT';
    const text = await res.text();
    if (res.status === 404 || text.includes('UNREGISTERED')) return 'INVALID_TOKEN';
    this.logger.warn({ status: res.status, body: text.slice(0, 300) }, 'FCM send failed');
    return 'FAILED';
  }

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.expiresAt - 60 > now) return this.token.value;
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const claims = { iss: this.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.privateKey).toString('base64url');
    const res = await this.http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
    });
    if (!res.ok) throw new Error(`FCM auth failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: now + json.expires_in };
    return json.access_token;
  }
}
