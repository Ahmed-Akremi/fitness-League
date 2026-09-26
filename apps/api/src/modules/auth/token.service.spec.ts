import { generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { loadEnv } from '../../common/config/env.schema';
import { InvalidTokenError, TokenService } from './token.service';

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    JWT_PRIVATE_KEY_B64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64'),
    JWT_PUBLIC_KEY_B64: Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }).toString()).toString('base64'),
    raw: privateKey,
  };
}

function service(now: () => Date, k = keys()) {
  const env = loadEnv({ DATABASE_URL: 'postgresql://u:p@h/d', CURSOR_HMAC_SECRET: 'x'.repeat(32), JWT_PRIVATE_KEY_B64: k.JWT_PRIVATE_KEY_B64, JWT_PUBLIC_KEY_B64: k.JWT_PUBLIC_KEY_B64, HEALTH_DATA_KEYS: `k1:${Buffer.alloc(32).toString('base64')}` });
  return new TokenService(env, { now });
}

describe('TokenService', () => {
  const t0 = new Date('2026-09-26T10:00:00Z');

  it('signs and verifies access tokens', async () => {
    const svc = service(() => t0);
    const { token, expiresIn } = await svc.signAccess({ sub: 'u1', role: 'USER', sv: 3 });
    expect(expiresIn).toBe(900);
    await expect(svc.verifyAccess(token)).resolves.toEqual({ sub: 'u1', role: 'USER', sv: 3 });
  });

  it('rejects expired tokens as expired', async () => {
    let now = t0;
    const svc = service(() => now);
    const { token } = await svc.signAccess({ sub: 'u1', role: 'USER', sv: 1 });
    now = new Date(t0.getTime() + 901_000);
    await expect(svc.verifyAccess(token)).rejects.toEqual(new InvalidTokenError(true));
  });

  it('refuses an app token on the admin audience', async () => {
    const svc = service(() => t0);
    const { token } = await svc.signAccess({ sub: 'u1', role: 'ADMIN', sv: 1 }, 'app');
    await expect(svc.verifyAccess(token, 'admin')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('refuses tokens signed by another key or tampered', async () => {
    const svc = service(() => t0);
    const other = keys();
    const forged = await new SignJWT({ role: 'SUPER_ADMIN', sv: 1 })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject('u1').setIssuer('fitness-league').setAudience('app').setExpirationTime('1h')
      .sign(other.raw);
    await expect(svc.verifyAccess(forged)).rejects.toBeInstanceOf(InvalidTokenError);

    const { token } = await svc.signAccess({ sub: 'u1', role: 'USER', sv: 1 });
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    payload.role = 'SUPER_ADMIN';
    const tampered = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    await expect(svc.verifyAccess(tampered)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('refuses "alg: none" tokens', async () => {
    const svc = service(() => t0);
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'u1', role: 'SUPER_ADMIN', sv: 1, aud: 'app', iss: 'fitness-league', exp: 9999999999 })).toString('base64url');
    await expect(svc.verifyAccess(`${header}.${body}.`)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('creates opaque tokens whose hash is stable', () => {
    const svc = service(() => t0);
    const { token, hash } = svc.newOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(TokenService.hash(token).equals(hash)).toBe(true);
  });
});
