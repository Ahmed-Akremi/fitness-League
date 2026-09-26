import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC = 'isPublic';
export const REQUIRED_ROLES = 'requiredRoles';
export const REQUIRES_VERIFIED_EMAIL = 'requiresVerifiedEmail';

/** Routes are authenticated by default; this opts a route out. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);
/** Competitive features (leaderboards, battles, gym creation) need a verified email (docs §9.1). */
export const RequiresVerifiedEmail = () => SetMetadata(REQUIRES_VERIFIED_EMAIL, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
