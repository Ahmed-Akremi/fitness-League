import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConsentType, Gender, Locale, OAuthProvider, Prisma, User, VerificationTokenType } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { JUDGE_ROLES } from '../../common/auth/auth-user';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { ENV } from '../../common/config/config.module';
import type { Env } from '../../common/config/env.schema';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { MailSender } from '../../common/mail/mail-sender';
import { renderMail } from '../../common/mail/templates';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RuleSetService } from '../scoring/rule-set.service';
import { ageInYears, lockDurationMinutes } from './auth-policy';
import { ConsentsDto, ForgotPasswordDto, LoginDto, OAuthSignInDto, RegisterDto, ResetPasswordDto, SessionDto } from './dto/auth.dto';
import { OAuthVerifier } from './oauth-verifier';
import { PasswordService } from './password.service';
import { TokenAudience, TokenService } from './token.service';

const EMAIL_VERIFY_TTL_MS = 24 * 3600_000;
const PASSWORD_RESET_TTL_MS = 3600_000;

export interface RequestContext {
  requestId?: string;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly ruleSets: RuleSetService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
    private readonly audit: AuditService,
    private readonly mail: MailSender,
    private readonly oauth: OAuthVerifier,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────────────────────── Registration ─────────────────────────────

  async register(dto: RegisterDto, ctx: RequestContext): Promise<SessionDto> {
    const email = dto.email.trim().toLowerCase();
    await this.assertRegistrable(dto, email, dto.phone);
    const passwordHash = await this.passwords.hash(dto.password);
    const verification = this.tokens.newOpaqueToken();
    const session = await this.createAccount({ ...dto, email, fullName: dto.fullName, passwordHash, emailVerified: false, verificationHash: verification.hash }, ctx);
    await this.sendMail('EMAIL_VERIFY', email, dto.locale, `/verify-email?token=${verification.token}`);
    return session;
  }

  /**
   * Google / Apple sign-in. Known identity → session. Unknown identity with a provider-verified email that
   * matches an account → the identity is linked. Otherwise the client must send the registration fields.
   */
  async oauthSignIn(provider: OAuthProvider, dto: OAuthSignInDto, ctx: RequestContext): Promise<SessionDto> {
    const claims = await this.oauth.verify(provider, dto.idToken, dto.nonce);
    const now = this.clock.now();

    const identity = await this.prisma.oAuthIdentity.findUnique({
      where: { provider_subject: { provider, subject: claims.subject } },
      include: { user: true },
    });
    if (identity) return this.signInExisting(identity.user, now);

    if (claims.email && claims.emailVerified) {
      const existing = await this.prisma.user.findUnique({ where: { email: claims.email } });
      if (existing && existing.status !== 'DELETED') {
        this.assertCanSignIn(existing, now);
        await this.prisma.oAuthIdentity.create({ data: { id: uuidv7(), userId: existing.id, provider, subject: claims.subject } });
        await this.audit.log({ actorId: existing.id, action: 'OAUTH_LINKED', entityType: 'user', entityId: existing.id, after: { provider }, requestId: ctx.requestId });
        return this.signInExisting(existing, now);
      }
    }

    const reg = dto.registration;
    const fullName = reg?.fullName ?? claims.name;
    if (!reg || !claims.email || !fullName) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.OAUTH_REGISTRATION_REQUIRED, 'Registration details required', {
        extra: { prefill: { email: claims.email, fullName: claims.name }, missing: [!claims.email && 'email', !fullName && 'fullName'].filter(Boolean) },
      });
    }
    await this.assertRegistrable(reg, claims.email);
    return this.createAccount(
      { ...reg, email: claims.email, fullName, passwordHash: null, emailVerified: claims.emailVerified, oauth: { provider, subject: claims.subject } },
      ctx,
    );
  }

  private async signInExisting(user: User, now: Date): Promise<SessionDto> {
    this.assertAppAccount(user);
    if (user.status === 'DELETED') throw this.invalidCredentials();
    this.assertCanSignIn(user, now);
    return this.prisma.$transaction(async (tx) => {
      await this.cancelPendingDeletion(user.id, tx);
      const updated = await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      return this.issueSession(updated, tx);
    });
  }

  /** Signing in during the 30-day grace period cancels a deletion request (docs §9.7). */
  private async cancelPendingDeletion(userId: string, tx: Tx): Promise<void> {
    await tx.dataRequest.updateMany({ where: { userId, type: 'DELETION', status: 'PENDING' }, data: { status: 'CANCELLED' } });
  }

  private async assertRegistrable(
    dto: { dateOfBirth: string; countryCode: string; governorateId: string; cityId: string; username: string },
    email: string,
    phone?: string,
  ): Promise<void> {
    const { config } = await this.ruleSets.getActive();
    // Age gate first: nothing about an under-age person is stored (docs §5).
    if (ageInYears(dto.dateOfBirth, this.calendar.localDate(this.clock.now())) < config.min_age_years) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNDER_AGE, 'Minimum age not reached', {
        extra: { minAgeYears: config.min_age_years },
      });
    }
    await this.assertLocation(dto.countryCode, dto.governorateId, dto.cityId);
    await this.assertAvailable(email, dto.username, phone);
  }

  private async createAccount(
    a: {
      email: string;
      username: string;
      fullName: string;
      passwordHash: string | null;
      dateOfBirth: string;
      countryCode: string;
      governorateId: string;
      cityId: string;
      phone?: string;
      gender?: Gender;
      locale?: Locale;
      consents: ConsentsDto;
      emailVerified: boolean;
      verificationHash?: Buffer;
      oauth?: { provider: OAuthProvider; subject: string };
    },
    ctx: RequestContext,
  ): Promise<SessionDto> {
    const now = this.clock.now();
    const userId = uuidv7();
    return this.prisma
      .$transaction(async (tx) => {
        const season = await tx.season.findFirst({ where: { countryCode: a.countryCode, status: 'ACTIVE' } });
        const bronze = await tx.division.findUnique({ where: { code: 'BRONZE' } });
        const user = await tx.user.create({
          data: {
            id: userId,
            email: a.email,
            username: a.username,
            passwordHash: a.passwordHash,
            emailVerifiedAt: a.emailVerified ? now : null,
            dateOfBirth: new Date(`${a.dateOfBirth}T00:00:00Z`),
            phoneE164: a.phone ?? null,
            profile: {
              create: {
                fullName: a.fullName.trim(),
                gender: a.gender ?? null,
                countryCode: a.countryCode,
                governorateId: a.governorateId,
                cityId: a.cityId,
              },
            },
            settings: { create: { locale: a.locale ?? 'fr' } },
            stats: { create: { currentSeasonId: season?.id ?? null, divisionId: bronze?.id ?? null } },
            streak: { create: {} },
            ...(a.oauth && { oauthIdentities: { create: { id: uuidv7(), provider: a.oauth.provider, subject: a.oauth.subject } } }),
          },
        });
        await tx.consent.createMany({ data: this.consentRows(userId, a.consents) });
        if (a.verificationHash) {
          await tx.verificationToken.create({
            data: {
              id: uuidv7(),
              userId,
              type: VerificationTokenType.EMAIL_VERIFY,
              tokenHash: a.verificationHash,
              expiresAt: new Date(now.getTime() + EMAIL_VERIFY_TTL_MS),
            },
          });
        }
        await this.audit.log(
          { actorId: userId, actorRole: 'USER', action: 'USER_REGISTERED', entityType: 'user', entityId: userId, after: { via: a.oauth?.provider ?? 'PASSWORD' }, requestId: ctx.requestId },
          tx,
        );
        return this.issueSession(user, tx);
      })
      .catch((err: unknown) => {
        // Lost a race against a concurrent registration with the same email/username/phone.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw this.takenError(err);
        throw err;
      });
  }

  private consentRows(userId: string, c: ConsentsDto): Prisma.ConsentCreateManyInput[] {
    const entries: [ConsentType, boolean][] = [
      ['TERMS', c.terms],
      ['PRIVACY', c.privacy],
      ['HEALTH_DATA', c.healthData],
      ['MARKETING', c.marketing ?? false],
    ];
    return entries.map(([type, granted]) => ({ id: uuidv7(), userId, type, granted, documentVersion: c.documentVersion }));
  }

  private async assertLocation(countryCode: string, governorateId: string, cityId: string): Promise<void> {
    const city = await this.prisma.city.findUnique({ where: { id: cityId }, include: { governorate: { include: { country: true } } } });
    if (!city || city.governorateId !== governorateId || city.governorate.countryCode !== countryCode || !city.governorate.country.enabled) {
      throw AppException.validation([{ field: 'cityId', code: 'NOT_IN_GOVERNORATE' }]);
    }
  }

  private async assertAvailable(email: string, username: string, phone?: string): Promise<void> {
    const clash = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { username }, ...(phone ? [{ phoneE164: phone }] : [])] },
      select: { email: true, username: true, phoneE164: true },
    });
    if (!clash) return;
    if (clash.email.toLowerCase() === email) throw AppException.conflict(ErrorCode.EMAIL_TAKEN);
    if (clash.username.toLowerCase() === username.toLowerCase()) throw AppException.conflict(ErrorCode.USERNAME_TAKEN);
    throw AppException.conflict(ErrorCode.PHONE_TAKEN);
  }

  private takenError(err: Prisma.PrismaClientKnownRequestError): AppException {
    const target = String(err.meta?.target ?? '');
    if (target.includes('email')) return AppException.conflict(ErrorCode.EMAIL_TAKEN);
    if (target.includes('username')) return AppException.conflict(ErrorCode.USERNAME_TAKEN);
    if (target.includes('phone')) return AppException.conflict(ErrorCode.PHONE_TAKEN);
    return AppException.conflict();
  }

  // ───────────────────────────── Login ─────────────────────────────

  async login(dto: LoginDto, ctx: RequestContext): Promise<SessionDto> {
    const user = await this.verifyCredentials(dto.email, dto.password, ctx);
    this.assertAppAccount(user);
    return this.startSession(user, 'app');
  }

  /**
   * Password check with lockout (docs §9.1), shared by the app and admin logins.
   * Account state is only revealed to someone who knows the password.
   */
  async verifyCredentials(email: string, password: string, ctx: RequestContext): Promise<User> {
    const now = this.clock.now();
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { settings: true } });

    if (!user || user.status === 'DELETED') {
      await this.passwords.verify(null, password); // equalise timing
      throw this.invalidCredentials();
    }
    if (user.lockedUntil && user.lockedUntil > now) throw this.lockedError(user.lockedUntil, now);

    if (!(await this.passwords.verify(user.passwordHash, password))) {
      await this.recordFailedLogin(user, user.settings?.locale, ctx);
      throw this.invalidCredentials();
    }

    this.assertCanSignIn(user, now);
    return user;
  }

  /** Judges only judge (admin panel): they cannot compete, log workouts or score in the app. */
  private assertAppAccount(user: User): void {
    if (JUDGE_ROLES.includes(user.role)) throw AppException.forbidden('Judge accounts sign in to the admin panel.');
  }

  async startSession(user: User, audience: TokenAudience): Promise<SessionDto> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      await this.cancelPendingDeletion(user.id, tx);
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      });
      return this.issueSession(updated, tx, uuidv7(), audience);
    });
  }

  private async recordFailedLogin(user: User, locale: string | undefined, ctx: RequestContext): Promise<void> {
    const { failedLoginCount } = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const minutes = lockDurationMinutes(failedLoginCount);
    if (minutes === null) return;
    const lockedUntil = new Date(this.clock.now().getTime() + minutes * 60_000);
    await this.prisma.user.update({ where: { id: user.id }, data: { lockedUntil } });
    await this.audit.log({ actorId: null, action: 'ACCOUNT_LOCKED', entityType: 'user', entityId: user.id, after: { minutes, failedLoginCount }, requestId: ctx.requestId });
    await this.sendMail('ACCOUNT_LOCKED', user.email, locale, '/forgot-password');
  }

  private assertCanSignIn(user: User, now: Date): void {
    if (user.status === 'BANNED') {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.ACCOUNT_BANNED, 'Account banned');
    }
    if (user.status === 'SUSPENDED' && (!user.suspendedUntil || user.suspendedUntil > now)) {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.ACCOUNT_SUSPENDED, 'Account suspended', {
        extra: { suspendedUntil: user.suspendedUntil?.toISOString() ?? null },
      });
    }
  }

  private invalidCredentials(): AppException {
    return AppException.unauthenticated(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
  }

  private lockedError(until: Date, now: Date): AppException {
    return new AppException(HttpStatus.LOCKED, ErrorCode.ACCOUNT_LOCKED, 'Account temporarily locked', {
      extra: { lockedUntil: until.toISOString() },
      headers: { 'Retry-After': String(Math.ceil((until.getTime() - now.getTime()) / 1000)) },
    });
  }

  // ───────────────────────────── Sessions ─────────────────────────────

  private async issueSession(user: User, tx: Tx, familyId: string = uuidv7(), audience: TokenAudience = 'app'): Promise<SessionDto> {
    const refresh = this.tokens.newOpaqueToken();
    await tx.refreshToken.create({
      data: {
        id: uuidv7(),
        userId: user.id,
        familyId,
        audience,
        tokenHash: refresh.hash,
        expiresAt: new Date(this.clock.now().getTime() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });
    const access = await this.tokens.signAccess({ sub: user.id, role: user.role, sv: user.sessionVersion }, audience);
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken: refresh.token, userId: user.id };
  }

  /**
   * Rotation with reuse detection: a refresh token works once. Presenting an already-rotated token means it
   * was copied, so the whole family (every token descended from that login) is revoked (docs §9.1).
   */
  async refresh(refreshToken: string, ctx: RequestContext, audience: TokenAudience = 'app'): Promise<SessionDto> {
    const now = this.clock.now();
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: TokenService.hash(refreshToken) }, include: { user: true } });
    // Each refresh endpoint only accepts its own kind of session.
    if (!row || row.audience !== audience) throw AppException.unauthenticated(ErrorCode.TOKEN_INVALID, 'Invalid refresh token');

    if (row.revokedAt) {
      if (row.replacedById) await this.revokeFamilyForReuse(row.userId, row.familyId, ctx);
      throw AppException.unauthenticated(row.replacedById ? ErrorCode.TOKEN_REUSED : ErrorCode.TOKEN_INVALID, 'Invalid refresh token');
    }
    if (row.expiresAt <= now) throw AppException.unauthenticated(ErrorCode.TOKEN_EXPIRED, 'Refresh token expired');
    if (row.user.status === 'DELETED') throw AppException.unauthenticated(ErrorCode.TOKEN_INVALID, 'Invalid refresh token');
    try {
      this.assertCanSignIn(row.user, now);
    } catch (err) {
      await this.revokeFamily(row.familyId);
      throw err;
    }

    const newId = uuidv7();
    return this.prisma
      .$transaction(async (tx) => {
        // Conditional update: two concurrent refreshes with the same token → only one wins.
        const { count } = await tx.refreshToken.updateMany({
          where: { id: row.id, revokedAt: null },
          data: { revokedAt: now, replacedById: newId },
        });
        if (count !== 1) throw new ConcurrentRefreshError();
        const refresh = this.tokens.newOpaqueToken();
        await tx.refreshToken.create({
          data: {
            id: newId,
            userId: row.userId,
            familyId: row.familyId,
            tokenHash: refresh.hash,
            deviceId: row.deviceId,
            audience: row.audience,
            expiresAt: new Date(now.getTime() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
          },
        });
        const access = await this.tokens.signAccess({ sub: row.user.id, role: row.user.role, sv: row.user.sessionVersion }, audience);
        return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken: refresh.token, userId: row.user.id };
      })
      .catch(async (err: unknown) => {
        if (!(err instanceof ConcurrentRefreshError)) throw err;
        await this.revokeFamilyForReuse(row.userId, row.familyId, ctx);
        throw AppException.unauthenticated(ErrorCode.TOKEN_REUSED, 'Invalid refresh token');
      });
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: TokenService.hash(refreshToken) } });
    // Only the owner can end a session; anything else is silently ignored (no token oracle).
    if (row && row.userId === userId) await this.revokeFamily(row.familyId);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: this.clock.now() } });
  }

  private async revokeFamilyForReuse(userId: string, familyId: string, ctx: RequestContext): Promise<void> {
    await this.revokeFamily(familyId);
    await this.audit.log({ actorId: null, action: 'REFRESH_TOKEN_REUSE_DETECTED', entityType: 'user', entityId: userId, after: { familyId }, requestId: ctx.requestId });
    this.logger.warn({ userId, familyId }, 'Refresh token reuse detected; session family revoked');
  }

  // ───────────────────────────── Email verification ─────────────────────────────

  async verifyEmail(token: string): Promise<void> {
    const row = await this.consumeToken(token, VerificationTokenType.EMAIL_VERIFY);
    await this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: this.clock.now() } });
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
    if (user.emailVerifiedAt) return;
    const now = this.clock.now();
    const verification = this.tokens.newOpaqueToken();
    await this.prisma.$transaction([
      // Older links stop working once a new one is sent.
      this.prisma.verificationToken.updateMany({
        where: { userId, type: VerificationTokenType.EMAIL_VERIFY, consumedAt: null },
        data: { consumedAt: now },
      }),
      this.prisma.verificationToken.create({
        data: { id: uuidv7(), userId, type: VerificationTokenType.EMAIL_VERIFY, tokenHash: verification.hash, expiresAt: new Date(now.getTime() + EMAIL_VERIFY_TTL_MS) },
      }),
    ]);
    await this.sendMail('EMAIL_VERIFY', user.email, user.settings?.locale, `/verify-email?token=${verification.token}`);
  }

  // ───────────────────────────── Password reset ─────────────────────────────

  /** Always succeeds from the caller's point of view: whether the email exists is never revealed. */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() }, include: { settings: true } });
    if (!user || user.status === 'DELETED' || user.status === 'BANNED') return;
    const now = this.clock.now();
    const reset = this.tokens.newOpaqueToken();
    await this.prisma.$transaction([
      this.prisma.verificationToken.updateMany({
        where: { userId: user.id, type: VerificationTokenType.PASSWORD_RESET, consumedAt: null },
        data: { consumedAt: now },
      }),
      this.prisma.verificationToken.create({
        data: { id: uuidv7(), userId: user.id, type: VerificationTokenType.PASSWORD_RESET, tokenHash: reset.hash, expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS) },
      }),
    ]);
    await this.sendMail('PASSWORD_RESET', user.email, user.settings?.locale, `/reset-password?token=${reset.token}`);
  }

  /** Sets the new password and signs out every device (session version bump + refresh tokens revoked). */
  async resetPassword(dto: ResetPasswordDto, ctx: RequestContext): Promise<void> {
    const row = await this.consumeToken(dto.token, VerificationTokenType.PASSWORD_RESET);
    const passwordHash = await this.passwords.hash(dto.newPassword);
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash, sessionVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
      await this.audit.log({ actorId: row.userId, action: 'PASSWORD_RESET', entityType: 'user', entityId: row.userId, requestId: ctx.requestId }, tx);
    });
  }

  private async consumeToken(token: string, type: VerificationTokenType): Promise<{ userId: string }> {
    const now = this.clock.now();
    const row = await this.prisma.verificationToken.findUnique({ where: { tokenHash: TokenService.hash(token) } });
    const invalid = new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.TOKEN_INVALID, 'Invalid or expired link');
    if (!row || row.type !== type || row.consumedAt || row.expiresAt <= now) throw invalid;
    const { count } = await this.prisma.verificationToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
    if (count !== 1) throw invalid;
    return { userId: row.userId };
  }

  private async sendMail(tag: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'ACCOUNT_LOCKED', to: string, locale: string | undefined, path: string): Promise<void> {
    const { subject, text } = renderMail(tag, locale, { appName: this.env.APP_NAME, link: `${this.env.APP_LINK_BASE_URL}${path}` });
    try {
      await this.mail.send({ to, subject, text, tag });
    } catch (err) {
      // A mail outage must not fail registration or login; the user can ask for a new link.
      this.logger.error({ err, tag }, 'Failed to send email');
    }
  }
}

class ConcurrentRefreshError extends Error {}
