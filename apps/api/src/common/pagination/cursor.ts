import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppException } from '../errors/app-exception';

/**
 * Opaque keyset cursor: base64url(JSON) + "." + HMAC. Signed so clients can't forge positions
 * (e.g. jump into data they shouldn't page through, or inject odd sort keys).
 */
export class CursorCodec {
  constructor(private readonly secret: string) {}

  encode(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  decode<T extends Record<string, unknown>>(cursor: string): T {
    const [body, sig] = cursor.split('.');
    if (!body || !sig) throw invalid();
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    } catch {
      throw invalid();
    }
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url').slice(0, 22);
  }
}

function invalid(): AppException {
  return AppException.validation([{ field: 'cursor', code: 'INVALID_CURSOR' }]);
}
