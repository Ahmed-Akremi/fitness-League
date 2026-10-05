import { Injectable } from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { JUDGE_ROLES } from '../../common/auth/auth-user';
import { AppException } from '../../common/errors/app-exception';
import { AuthService, RequestContext } from '../auth/auth.service';
import { SessionDto } from '../auth/dto/auth.dto';

export const STAFF_ROLES: Role[] = ['MODERATOR', 'ADMIN', 'SUPER_ADMIN'];
/** Everyone who can open the admin panel: staff, and judges (judge space only). */
export const PANEL_ROLES: Role[] = [...STAFF_ROLES, ...JUDGE_ROLES];

/**
 * Admin panel sign-in (docs §9.1): email + password for moderators and above, and for judge accounts (who only
 * get the judge space), no second factor; then an admin-audience session that app routes refuse (and vice
 * versa). Lockout and rate limits are the app's.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, ctx: RequestContext): Promise<{ session: SessionDto }> {
    const user = await this.auth.verifyCredentials(email, password, ctx);
    if (!PANEL_ROLES.includes(user.role)) throw AppException.forbidden('Staff accounts only.');
    return { session: await this.open(user, ctx) };
  }

  private async open(user: User, ctx: RequestContext): Promise<SessionDto> {
    const session = await this.auth.startSession(user, 'admin');
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'ADMIN_LOGIN', entityType: 'user', entityId: user.id, requestId: ctx.requestId });
    return session;
  }
}
