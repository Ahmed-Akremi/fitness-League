import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth-user';
import { IS_PUBLIC, REQUIRED_ROLES, REQUIRES_VERIFIED_EMAIL } from '../../common/auth/decorators';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InvalidTokenError, TokenService } from './token.service';

/**
 * Global guard: every route requires a valid access token unless marked @Public().
 * The user row is re-read on each request so bans, role changes and password resets apply immediately
 * (ASSUMPTION: cached in Redis once traffic justifies it).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw AppException.unauthenticated();

    let claims;
    try {
      claims = await this.tokens.verifyAccess(header.slice(7));
    } catch (err) {
      const expired = err instanceof InvalidTokenError && err.expired;
      throw AppException.unauthenticated(expired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID, 'Invalid access token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, role: true, status: true, sessionVersion: true, emailVerifiedAt: true, suspendedUntil: true },
    });
    if (!user || user.status === 'DELETED' || user.sessionVersion !== claims.sv) {
      throw AppException.unauthenticated(ErrorCode.TOKEN_INVALID, 'Invalid access token');
    }
    if (user.status === 'BANNED') throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.ACCOUNT_BANNED, 'Account banned');
    if (user.status === 'SUSPENDED' && (!user.suspendedUntil || user.suspendedUntil > this.clock.now())) {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.ACCOUNT_SUSPENDED, 'Account suspended');
    }

    req.user = { id: user.id, role: user.role, emailVerified: user.emailVerifiedAt !== null };

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    if (roles && !roles.includes(user.role)) throw AppException.forbidden();
    if (this.reflector.getAllAndOverride<boolean>(REQUIRES_VERIFIED_EMAIL, targets) && !req.user.emailVerified) {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.EMAIL_NOT_VERIFIED, 'Email address not verified');
    }
    return true;
  }
}
