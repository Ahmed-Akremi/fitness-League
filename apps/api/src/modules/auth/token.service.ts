import { Inject, Injectable } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { createHash, createPrivateKey, createPublicKey, KeyObject, randomBytes } from 'node:crypto';
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { ClockService } from '../../common/clock/clock.service';
import { ENV } from '../../common/config/config.module';
import type { Env } from '../../common/config/env.schema';

export type TokenAudience = 'app' | 'admin';

export interface AccessClaims {
  sub: string;
  role: Role;
  /** Session version: bumped on password reset / ban to invalidate every outstanding access token. */
  sv: number;
}

export class InvalidTokenError extends Error {
  constructor(readonly expired: boolean) {
    super(expired ? 'token expired' : 'invalid token');
  }
}

/** Short-lived EdDSA access JWTs + opaque refresh tokens (only their SHA-256 is stored). */
@Injectable()
export class TokenService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly clock: ClockService,
  ) {
    this.privateKey = createPrivateKey(Buffer.from(env.JWT_PRIVATE_KEY_B64, 'base64').toString('utf8'));
    this.publicKey = createPublicKey(Buffer.from(env.JWT_PUBLIC_KEY_B64, 'base64').toString('utf8'));
  }

  async signAccess(claims: AccessClaims, audience: TokenAudience = 'app'): Promise<{ token: string; expiresIn: number }> {
    const now = Math.floor(this.clock.now().getTime() / 1000);
    const token = await new SignJWT({ role: claims.role, sv: claims.sv })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.env.JWT_KEY_ID })
      .setSubject(claims.sub)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + this.env.ACCESS_TOKEN_TTL_S)
      .sign(this.privateKey);
    return { token, expiresIn: this.env.ACCESS_TOKEN_TTL_S };
  }

  async verifyAccess(token: string, audience: TokenAudience = 'app'): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: this.env.JWT_ISSUER,
        audience,
        algorithms: ['EdDSA'],
        currentDate: this.clock.now(),
      });
      if (typeof payload.sub !== 'string' || typeof payload.sv !== 'number' || typeof payload.role !== 'string') {
        throw new InvalidTokenError(false);
      }
      return { sub: payload.sub, sv: payload.sv, role: payload.role as Role };
    } catch (err) {
      if (err instanceof InvalidTokenError) throw err;
      throw new InvalidTokenError(err instanceof joseErrors.JWTExpired);
    }
  }

  /** 256-bit random opaque token for refresh / email / reset links. */
  newOpaqueToken(): { token: string; hash: Buffer } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: TokenService.hash(token) };
  }

  static hash(token: string): Buffer {
    return createHash('sha256').update(token).digest();
  }
}
