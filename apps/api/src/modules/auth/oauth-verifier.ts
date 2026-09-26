import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { OAuthProvider } from '@prisma/client';
import { createRemoteJWKSet, JWTVerifyGetKey, jwtVerify } from 'jose';
import { ClockService } from '../../common/clock/clock.service';
import { ENV } from '../../common/config/config.module';
import type { Env } from '../../common/config/env.schema';
import { AppException, ErrorCode } from '../../common/errors/app-exception';

export interface OAuthIdentityClaims {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

const PROVIDERS: Record<OAuthProvider, { jwks: string; issuers: string[] }> = {
  GOOGLE: { jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuers: ['https://accounts.google.com', 'accounts.google.com'] },
  APPLE: { jwks: 'https://appleid.apple.com/auth/keys', issuers: ['https://appleid.apple.com'] },
};

/**
 * Verifies ID tokens obtained natively by the mobile app (Google Sign-In / Sign in with Apple):
 * signature against the provider JWKS, issuer, audience (our client ids), expiry and optional nonce.
 */
@Injectable()
export class OAuthVerifier {
  private readonly keys = new Map<OAuthProvider, JWTVerifyGetKey>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly clock: ClockService,
  ) {}

  /** Test seam: replace a provider's key set (e.g. with a local JWKS). */
  useKeyResolver(provider: OAuthProvider, resolver: JWTVerifyGetKey): void {
    this.keys.set(provider, resolver);
  }

  async verify(provider: OAuthProvider, idToken: string, nonce?: string): Promise<OAuthIdentityClaims> {
    const audience = provider === 'GOOGLE' ? this.env.GOOGLE_CLIENT_IDS : this.env.APPLE_CLIENT_IDS;
    if (!audience.length) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${provider} sign-in is not enabled`);
    }
    let resolver = this.keys.get(provider);
    if (!resolver) {
      resolver = createRemoteJWKSet(new URL(PROVIDERS[provider].jwks));
      this.keys.set(provider, resolver);
    }
    try {
      const { payload } = await jwtVerify(idToken, resolver, {
        issuer: PROVIDERS[provider].issuers,
        audience,
        currentDate: this.clock.now(),
      });
      if (nonce !== undefined && payload.nonce !== nonce) throw new Error('nonce mismatch');
      if (typeof payload.sub !== 'string') throw new Error('missing sub');
      const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
      // Apple sends email_verified as the string "true".
      const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
      return { subject: payload.sub, email, emailVerified, name: typeof payload.name === 'string' ? payload.name : null };
    } catch {
      throw AppException.unauthenticated(ErrorCode.TOKEN_INVALID, 'Invalid identity token');
    }
  }
}
