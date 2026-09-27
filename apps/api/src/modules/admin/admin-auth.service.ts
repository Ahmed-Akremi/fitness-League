import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { ClockService } from '../../common/clock/clock.service';
import { ENV } from '../../common/config/config.module';
import type { Env } from '../../common/config/env.schema';
import { HealthDataCipher } from '../../common/crypto/health-data-cipher';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService, RequestContext } from '../auth/auth.service';
import { SessionDto } from '../auth/dto/auth.dto';
import { InvalidTokenError, TokenService } from '../auth/token.service';
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp';

export const STAFF_ROLES: Role[] = ['MODERATOR', 'ADMIN', 'SUPER_ADMIN'];

export type AdminLoginResult = { session: SessionDto } | { totpSetup: { secret: string; otpauthUrl: string; setupToken: string } };

/**
 * Admin panel sign-in (docs §9.1, Q-10): password + mandatory TOTP for moderators and above,
 * then an admin-audience session that app routes refuse (and vice versa).
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly cipher: HealthDataCipher,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {
    if (env.DEV_STATIC_TOTP_CODE) this.logger.warn('DEV_STATIC_TOTP_CODE is set: the admin second factor accepts a fixed code (development only).');
  }

  /** The fixed dev code (never configurable in production, see env.schema). */
  private isDevCode(code: string | undefined): boolean {
    return !!this.env.DEV_STATIC_TOTP_CODE && code === this.env.DEV_STATIC_TOTP_CODE;
  }

  async login(email: string, password: string, code: string | undefined, ctx: RequestContext): Promise<AdminLoginResult> {
    const user = await this.auth.verifyCredentials(email, password, ctx);
    if (!STAFF_ROLES.includes(user.role)) throw AppException.forbidden('Staff accounts only.');

    if (this.isDevCode(code)) {
      this.logger.warn(`Admin sign-in with the static dev 2FA code (user ${user.id})`);
      return { session: await this.open(user, ctx) };
    }
    if (!user.totpSecretEnc) {
      // First staff sign-in: enrol an authenticator before any admin session exists.
      const secret = newTotpSecret();
      const setupToken = await this.tokens.signSetupToken(user.id, this.cipher.encrypt(secret).toString('base64url'));
      return { totpSetup: { secret, otpauthUrl: otpauthUrl(secret, user.email, 'Fitness League Admin'), setupToken } };
    }
    if (!code) throw AppException.unauthenticated(ErrorCode.TOTP_REQUIRED, 'Authenticator code required');
    if (!verifyTotp(this.cipher.decrypt(user.totpSecretEnc), code, this.clock.now())) {
      await this.auth.recordFailedSecondFactor(user, ctx);
      throw AppException.unauthenticated(ErrorCode.INVALID_CREDENTIALS, 'Invalid email, password or code');
    }
    return { session: await this.open(user, ctx) };
  }

  async confirmTotp(setupToken: string, code: string, ctx: RequestContext): Promise<{ session: SessionDto }> {
    let claims;
    try {
      claims = await this.tokens.verifySetupToken(setupToken);
    } catch (err) {
      throw AppException.unauthenticated(err instanceof InvalidTokenError && err.expired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID, 'Invalid setup token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || !STAFF_ROLES.includes(user.role) || user.status !== 'ACTIVE') throw AppException.forbidden();
    if (user.totpSecretEnc) throw AppException.conflict(ErrorCode.CONFLICT, 'Two-factor authentication is already set up.');
    const secret = this.cipher.decrypt(Buffer.from(claims.encryptedSecret, 'base64url'));
    if (!verifyTotp(secret, code, this.clock.now())) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_FAILED, 'Invalid code', { errors: [{ field: 'code', code: 'TOTP_INVALID' }] });
    }
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: this.cipher.encrypt(secret) } });
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'ADMIN_TOTP_ENROLLED', entityType: 'user', entityId: user.id, requestId: ctx.requestId });
    return { session: await this.open(updated, ctx) };
  }

  private async open(user: User, ctx: RequestContext): Promise<SessionDto> {
    const session = await this.auth.startSession(user, 'admin');
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'ADMIN_LOGIN', entityType: 'user', entityId: user.id, requestId: ctx.requestId });
    return session;
  }
}
