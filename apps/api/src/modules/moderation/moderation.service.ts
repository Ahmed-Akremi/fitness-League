import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, ReportReason, ReportStatus, ReportTarget, Role, Sanction, SanctionKind } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { ENV } from '../../common/config/config.module';
import type { Env } from '../../common/config/env.schema';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { MailSender } from '../../common/mail/mail-sender';
import { renderMail } from '../../common/mail/templates';
import { CursorCodec } from '../../common/pagination/cursor';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SocialAccess } from '../social/social-access';

const DAY = 86_400_000;
const APPEAL_TOKEN_DAYS = 30;
/** Staff never sanction each other through reports; admins manage staff accounts directly. */
const SANCTIONABLE: Role[] = ['USER', 'GYM_ADMIN'];
const ADMINS: Role[] = ['ADMIN', 'SUPER_ADMIN'];

type Tx = Prisma.TransactionClient;

export type ReportAction = 'DISMISS' | 'WARN' | 'SUSPEND' | 'BAN';

/**
 * Reports, sanctions and appeals (docs §3.12, Phase 3). Athletes report content; moderators dismiss or sanction
 * (warning, suspension, ban — bans need an admin); a sanctioned athlete appeals once, from the app for a warning
 * or through the signed link emailed with a suspension or ban (they can no longer sign in). Decisions are audited
 * and published anonymised in the moderation log.
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SocialAccess,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly mail: MailSender,
    private readonly codec: CursorCodec,
    private readonly clock: ClockService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────── Reports ─────────────

  async report(me: string, dto: { targetType: ReportTarget; targetId: string; reason: ReportReason; details?: string }) {
    const targetUserId = await this.targetOwner(me, dto.targetType, dto.targetId);
    if (targetUserId === me) throw AppException.validation([{ field: 'targetId', code: 'SELF' }]);
    // One open report per reporter and target: reporting again changes nothing.
    const existing = await this.prisma.report.findFirst({ where: { reporterId: me, targetType: dto.targetType, targetId: dto.targetId, status: 'OPEN' } });
    if (existing) return this.reportView(existing);
    const r = await this.prisma.report.create({
      data: { id: uuidv7(), reporterId: me, targetType: dto.targetType, targetId: dto.targetId, targetUserId, reason: dto.reason, details: dto.details?.trim() || null },
    });
    return this.reportView(r);
  }

  /** Who owns the reported thing; the reporter must be able to see it. */
  private async targetOwner(me: string, type: ReportTarget, id: string): Promise<string | null> {
    const notFound = AppException.notFound('Report target');
    switch (type) {
      case 'USER': {
        const u = await this.prisma.user.findFirst({ where: { id, status: { not: 'DELETED' } } });
        if (!u) throw notFound;
        return u.id;
      }
      case 'WORKOUT': {
        const w = await this.prisma.workout.findFirst({ where: { id, deletedAt: null } });
        if (!w || !(await this.access.canView(me, w.userId, w.visibility))) throw notFound;
        return w.userId;
      }
      case 'COMMENT': {
        const c = await this.prisma.activityComment.findFirst({ where: { id, deletedAt: null }, include: { activityEvent: true } });
        if (!c || !(await this.access.canView(me, c.activityEvent.userId, c.activityEvent.visibility))) throw notFound;
        return c.userId;
      }
      case 'GYM': {
        const g = await this.prisma.gym.findFirst({ where: { id, deletedAt: null } });
        if (!g) throw notFound;
        return g.ownerUserId;
      }
    }
  }

  async myReports(me: string) {
    const rows = await this.prisma.report.findMany({ where: { reporterId: me }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((r) => this.reportView(r));
  }

  private reportView(r: { id: string; targetType: ReportTarget; targetId: string; reason: ReportReason; status: ReportStatus; createdAt: Date; handledAt: Date | null }) {
    // The reporter learns that the report was handled, never what happened to the other athlete.
    return { id: r.id, targetType: r.targetType, targetId: r.targetId, reason: r.reason, status: r.status === 'OPEN' ? 'OPEN' : 'HANDLED', createdAt: r.createdAt.toISOString(), handledAt: r.handledAt?.toISOString() ?? null };
  }

  async openReports() {
    const rows = await this.prisma.report.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, take: 100, include: { reporter: { select: { username: true } } } });
    const userIds = [...new Set(rows.map((r) => r.targetUserId).filter((id): id is string => id !== null))];
    const [users, counts, history] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, status: true } }),
      this.prisma.report.groupBy({ by: ['targetUserId'], where: { targetUserId: { in: userIds } }, _count: true }),
      this.prisma.sanction.groupBy({ by: ['userId'], where: { userId: { in: userIds }, revokedAt: null }, _count: true }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      details: r.details,
      createdAt: r.createdAt.toISOString(),
      reporter: r.reporter.username,
      target: r.targetUserId
        ? {
            userId: r.targetUserId,
            username: userById.get(r.targetUserId)?.username ?? null,
            status: userById.get(r.targetUserId)?.status ?? null,
            reportsTotal: counts.find((c) => c.targetUserId === r.targetUserId)?._count ?? 0,
            sanctionsTotal: history.find((h) => h.userId === r.targetUserId)?._count ?? 0,
          }
        : null,
    }));
  }

  async decideReport(actor: AuthUser, reportId: string, dto: { action: ReportAction; days?: number; note: string }) {
    const r = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!r) throw AppException.notFound('Report');
    if (r.status !== 'OPEN') throw AppException.conflict(ErrorCode.CONFLICT, 'This report was already handled.', { reason: 'REPORT_HANDLED' });
    const sanction = await this.prisma.$transaction(async (tx) => {
      let s: Sanction | null = null;
      if (dto.action !== 'DISMISS') {
        if (!r.targetUserId) throw AppException.validation([{ field: 'action', code: 'NO_TARGET_USER' }]);
        s = await this.sanction(tx, actor, r.targetUserId, dto.action, r.reason, dto.note, dto.days);
      }
      await tx.report.update({
        where: { id: reportId },
        data: { status: dto.action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED', handledById: actor.id, handledAt: this.clock.now(), decisionNote: dto.note, sanctionId: s?.id ?? null },
      });
      await this.notifications.notify(tx, r.reporterId, 'REPORT_HANDLED', { reportId });
      await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: `REPORT_${dto.action}`, entityType: 'report', entityId: reportId, after: { note: dto.note, days: dto.days ?? null, sanctionId: s?.id ?? null } }, tx);
      return s;
    });
    if (sanction && sanction.kind !== 'WARNING') await this.emailSanction(sanction);
    return { reportId, status: dto.action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED', sanctionId: sanction?.id ?? null };
  }

  private async sanction(tx: Tx, actor: AuthUser, userId: string, action: Exclude<ReportAction, 'DISMISS'>, reason: ReportReason, note: string, days?: number): Promise<Sanction> {
    const target = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!SANCTIONABLE.includes(target.role)) throw AppException.forbidden('Staff accounts are managed by admins, not through reports.');
    if (action === 'BAN' && !ADMINS.includes(actor.role)) throw AppException.forbidden('Only admins can ban.');
    if (action === 'SUSPEND' && !days) throw AppException.validation([{ field: 'days', code: 'REQUIRED' }]);
    const now = this.clock.now();
    const kind: SanctionKind = action === 'WARN' ? 'WARNING' : action === 'SUSPEND' ? 'SUSPENSION' : 'BAN';
    const endsAt = kind === 'SUSPENSION' ? new Date(now.getTime() + days! * DAY) : null;
    const s = await tx.sanction.create({ data: { id: uuidv7(), userId, kind, reason, note, startsAt: now, endsAt, createdById: actor.id } });
    if (kind === 'WARNING') {
      await this.notifications.notify(tx, userId, 'SANCTION_WARNING', { sanctionId: s.id, reason });
    } else {
      // Suspensions and bans sign the athlete out everywhere at once.
      await tx.user.update({ where: { id: userId }, data: { status: kind === 'BAN' ? 'BANNED' : 'SUSPENDED', suspendedUntil: endsAt, sessionVersion: { increment: 1 } } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    }
    return s;
  }

  private async emailSanction(s: Sanction): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: s.userId }, include: { settings: true } });
    if (!user?.email) return;
    const token = this.codec.encode({ p: 'appeal', s: s.id, exp: this.clock.now().getTime() + APPEAL_TOKEN_DAYS * DAY });
    const { subject, text } = renderMail(s.kind === 'BAN' ? 'ACCOUNT_BANNED' : 'ACCOUNT_SUSPENDED', user.settings?.locale, {
      appName: this.env.APP_NAME,
      link: `${this.env.APP_LINK_BASE_URL}/appeal?token=${encodeURIComponent(token)}`,
    });
    try {
      await this.mail.send({ to: user.email, subject, text, tag: 'SANCTION' });
    } catch (err) {
      this.logger.error({ err }, 'Failed to send the sanction email');
    }
  }

  // ───────────── Sanctions and appeals ─────────────

  async mySanctions(me: string) {
    const rows = await this.prisma.sanction.findMany({ where: { userId: me }, orderBy: { createdAt: 'desc' } });
    return rows.map((s) => this.sanctionView(s));
  }

  private sanctionView(s: Sanction) {
    return {
      id: s.id,
      kind: s.kind,
      reason: s.reason,
      note: s.note,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt?.toISOString() ?? null,
      revoked: s.revokedAt !== null,
      appeal: { status: s.appealStatus, text: s.appealText, note: s.appealNote, decidedAt: s.appealDecidedAt?.toISOString() ?? null },
    };
  }

  async appeal(me: string, sanctionId: string, text: string) {
    const s = await this.prisma.sanction.findFirst({ where: { id: sanctionId, userId: me } });
    if (!s) throw AppException.notFound('Sanction');
    return this.fileAppeal(s, text);
  }

  /** Sanction behind an emailed appeal link (the athlete cannot sign in while suspended or banned). */
  async byToken(token: string) {
    return this.sanctionView(await this.fromToken(token));
  }

  async appealByToken(token: string, text: string) {
    return this.fileAppeal(await this.fromToken(token), text);
  }

  private async fromToken(token: string): Promise<Sanction> {
    const invalid = new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.TOKEN_INVALID, 'Invalid or expired link');
    let payload: { p?: string; s?: string; exp?: number };
    try {
      payload = this.codec.decode(token);
    } catch {
      throw invalid;
    }
    if (payload.p !== 'appeal' || typeof payload.s !== 'string' || !payload.exp || payload.exp < this.clock.now().getTime()) throw invalid;
    const s = await this.prisma.sanction.findUnique({ where: { id: payload.s } });
    if (!s) throw invalid;
    return s;
  }

  private async fileAppeal(s: Sanction, text: string) {
    if (s.revokedAt) throw AppException.conflict(ErrorCode.CONFLICT, 'This sanction was lifted.', { reason: 'SANCTION_REVOKED' });
    if (s.appealStatus !== 'NONE') throw AppException.conflict(ErrorCode.CONFLICT, 'A sanction can be appealed once.', { reason: 'ALREADY_APPEALED' });
    const body = text.trim();
    if (body.length < 10) throw AppException.validation([{ field: 'text', code: 'TOO_SHORT' }]);
    const updated = await this.prisma.sanction.update({ where: { id: s.id }, data: { appealStatus: 'PENDING', appealText: body, appealedAt: this.clock.now() } });
    return this.sanctionView(updated);
  }

  async pendingAppeals() {
    const rows = await this.prisma.sanction.findMany({ where: { appealStatus: 'PENDING' }, orderBy: { appealedAt: 'asc' }, take: 100, include: { user: { select: { username: true } } } });
    return rows.map((s) => ({ ...this.sanctionView(s), username: s.user.username, userId: s.userId, appealedAt: s.appealedAt?.toISOString() ?? null }));
  }

  async decideAppeal(actor: AuthUser, sanctionId: string, decision: 'UPHOLD' | 'OVERTURN', note: string) {
    const s = await this.prisma.sanction.findUnique({ where: { id: sanctionId } });
    if (!s) throw AppException.notFound('Sanction');
    if (s.appealStatus !== 'PENDING') throw AppException.conflict(ErrorCode.CONFLICT, 'No pending appeal.', { reason: 'NO_PENDING_APPEAL' });
    // The moderator who decided cannot judge the appeal against their own decision.
    if (s.createdById === actor.id) throw AppException.forbidden('Another moderator must review this appeal.');
    if (s.kind === 'BAN' && !ADMINS.includes(actor.role)) throw AppException.forbidden('Only admins review ban appeals.');
    const now = this.clock.now();
    const overturned = decision === 'OVERTURN';
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.sanction.update({
        where: { id: sanctionId },
        data: { appealStatus: overturned ? 'OVERTURNED' : 'UPHELD', appealDecidedById: actor.id, appealDecidedAt: now, appealNote: note, ...(overturned && { revokedAt: now }) },
      });
      if (overturned && s.kind !== 'WARNING') {
        // Back to active unless another sanction still holds.
        const other = await tx.sanction.findFirst({ where: { userId: s.userId, id: { not: s.id }, revokedAt: null, kind: { in: ['SUSPENSION', 'BAN'] }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } });
        if (!other) await tx.user.update({ where: { id: s.userId }, data: { status: 'ACTIVE', suspendedUntil: null } });
      }
      await this.notifications.notify(tx, s.userId, 'APPEAL_DECIDED', { sanctionId, decision });
      await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: `APPEAL_${overturned ? 'OVERTURNED' : 'UPHELD'}`, entityType: 'sanction', entityId: sanctionId, after: { note } }, tx);
      return row;
    });
    return this.sanctionView(updated);
  }

  /** Public, anonymised moderation log (docs §4.5 P3): what kind of decision, why, how long, and appeals. */
  async publicLog() {
    const rows = await this.prisma.sanction.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((s) => ({
      date: s.startsAt.toISOString().slice(0, 10),
      kind: s.kind,
      reason: s.reason,
      days: s.endsAt ? Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / DAY) : null,
      appeal: s.appealStatus === 'NONE' ? null : s.appealStatus,
    }));
  }
}
