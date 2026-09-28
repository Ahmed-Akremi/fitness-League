import { Injectable, Logger } from '@nestjs/common';
import { Battle, BattleOutcome, BattleParticipant, LpReason, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { CursorCodec } from '../../common/pagination/cursor';
import { toPage } from '../../common/pagination/page';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DuelsService } from '../duels/duels.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { RuleSetConfig } from '../scoring/rule-set.schema';
import { RuleSetService } from '../scoring/rule-set.service';
import { WeeklyScoreService } from '../seasons/weekly-score.service';
import { SocialAccess } from '../social/social-access';
import { BATTLE_COMPONENTS, BattleComponent, CreateBattleDto, ListBattlesQueryDto } from './dto/battle.dto';

const DAY = 86_400_000;
const INVITE_TTL_MS = 48 * 3_600_000;
const MAX_OPEN_BATTLES = 3;
const BATTLE_LP_REASONS: LpReason[] = ['BATTLE_WIN', 'BATTLE_DRAW', 'BATTLE_PARTICIPATION'];

type Tx = Prisma.TransactionClient;
type FullBattle = Battle & { participants: BattleParticipant[] };

/**
 * Friend Battles (spec §13.1–13.2). Participants usually train different sports, so a battle never compares raw
 * performance: each side's normalised score over the battle window is compared (docs §5.7).
 */
@Injectable()
export class BattlesService {
  private readonly logger = new Logger(BattlesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly weekly: WeeklyScoreService,
    private readonly ledger: LedgerService,
    private readonly ruleSets: RuleSetService,
    private readonly notifications: NotificationsService,
    private readonly access: SocialAccess,
    private readonly audit: AuditService,
    private readonly cursors: CursorCodec,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
    private readonly duels: DuelsService,
  ) {}

  // ───────────── Lifecycle ─────────────

  async create(me: string, dto: CreateBattleDto) {
    if (dto.opponentId === me) throw AppException.validation([{ field: 'opponentId', code: 'SELF' }]);
    if (!(await this.access.areFriends(me, dto.opponentId)) || (await this.access.isBlockedEitherWay(me, dto.opponentId))) {
      throw AppException.forbidden('Friend Battles are between friends.');
    }
    const season = await this.prisma.season.findFirst({ where: { status: 'ACTIVE' } });
    if (!season) throw AppException.conflict(ErrorCode.CONFLICT, 'No active season.');
    // The weekly duel does not count against the friend battle limit.
    const open = { type: 'FRIEND' as const, status: { in: ['PENDING', 'ACTIVE'] as ('PENDING' | 'ACTIVE')[] } };
    for (const userId of [me, dto.opponentId]) {
      if ((await this.prisma.battle.count({ where: { ...open, participants: { some: { userId } } } })) >= MAX_OPEN_BATTLES) {
        throw AppException.conflict(ErrorCode.CONFLICT, `At most ${MAX_OPEN_BATTLES} open battles per athlete.`, { userId });
      }
    }
    const between = await this.prisma.battle.findFirst({ where: { ...open, AND: [{ participants: { some: { userId: me } } }, { participants: { some: { userId: dto.opponentId } } }] } });
    if (between) throw AppException.conflict(ErrorCode.CONFLICT, 'You already have an open battle with this friend.', { battleId: between.id });

    const { version } = await this.ruleSets.getActive();
    const now = this.clock.now();
    const id = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.battle.create({
        data: {
          id,
          type: 'FRIEND',
          createdById: me,
          seasonId: season.id,
          // Real dates are set when the invite is accepted.
          startsAt: now,
          endsAt: new Date(now.getTime() + dto.durationDays * DAY),
          durationDays: dto.durationDays,
          config: { components: dto.components ?? [...BATTLE_COMPONENTS] },
          ruleSetVersion: version,
          participants: { create: [{ userId: me, acceptedAt: now }, { userId: dto.opponentId }] },
        },
      });
      await this.notifications.notify(tx, dto.opponentId, 'BATTLE_INVITE', { battleId: id, from: me, durationDays: dto.durationDays });
    });
    return this.get(me, id);
  }

  async accept(me: string, id: string) {
    const b = await this.participantOf(me, id);
    const now = this.clock.now();
    if (b.status !== 'PENDING' || b.createdById === me) throw AppException.conflict(ErrorCode.CONFLICT, 'Only the invited friend can accept a pending battle.');
    if (b.createdAt.getTime() + INVITE_TTL_MS < now.getTime()) throw AppException.conflict(ErrorCode.CONFLICT, 'This invitation has expired.');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.battle.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'ACTIVE', startsAt: now, endsAt: new Date(now.getTime() + b.durationDays * DAY) } });
      if (count !== 1) throw AppException.conflict(ErrorCode.CONFLICT, 'Battle already answered.');
      await tx.battleParticipant.update({ where: { battleId_userId: { battleId: id, userId: me } }, data: { acceptedAt: now } });
      await this.notifications.notify(tx, b.createdById, 'BATTLE_STARTED', { battleId: id });
    });
    return this.get(me, id);
  }

  async decline(me: string, id: string) {
    const b = await this.participantOf(me, id);
    if (b.status !== 'PENDING' || b.createdById === me) throw AppException.conflict(ErrorCode.CONFLICT, 'Only the invited friend can decline a pending battle.');
    await this.prisma.$transaction(async (tx) => {
      await tx.battle.update({ where: { id }, data: { status: 'DECLINED' } });
      await this.notifications.notify(tx, b.createdById, 'BATTLE_DECLINED', { battleId: id });
    });
    return this.get(me, id);
  }

  async cancel(me: string, id: string) {
    const b = await this.participantOf(me, id);
    if (b.status !== 'PENDING' || b.createdById !== me) throw AppException.conflict(ErrorCode.CONFLICT, 'Only the creator can cancel, before the battle starts.');
    await this.prisma.battle.update({ where: { id }, data: { status: 'CANCELLED' } });
    return this.get(me, id);
  }

  // ───────────── Reads ─────────────

  async get(me: string, id: string) {
    const b = await this.participantOf(me, id);
    const users = await this.prisma.user.findMany({ where: { id: { in: b.participants.map((p) => p.userId) } }, include: { profile: true } });
    let live: Map<string, Awaited<ReturnType<WeeklyScoreService['computeWindow']>>> | null = null;
    if (b.status === 'ACTIVE') {
      const { version, config } = await this.ruleSets.getActive();
      const end = new Date(Math.min(this.clock.now().getTime(), b.endsAt.getTime()));
      live = new Map();
      for (const p of b.participants) live.set(p.userId, await this.weekly.computeWindow(p.userId, b.startsAt, end, config, version, this.prisma, this.weights(b, config)));
    }
    return {
      id: b.id,
      type: b.type,
      status: b.status,
      createdById: b.createdById,
      startsAt: b.status === 'PENDING' ? null : b.startsAt.toISOString(),
      endsAt: b.status === 'PENDING' ? null : b.endsAt.toISOString(),
      durationDays: b.durationDays,
      components: (b.config as { components?: string[] }).components ?? BATTLE_COMPONENTS,
      isGhost: b.isGhost,
      ghostTarget: b.isGhost ? Number((b.config as { ghostTarget?: number }).ghostTarget ?? 0) : null,
      result: b.result,
      participants: b.participants.map((p) => {
        const u = users.find((x) => x.id === p.userId);
        const s = live?.get(p.userId);
        return {
          userId: p.userId,
          username: u?.username,
          fullName: u?.profile?.fullName,
          accepted: p.acceptedAt !== null,
          score: s ? s.total : p.score === null ? null : Number(p.score),
          breakdown: s ? { components: s.components, trainingDays: s.trainingDays, plannedDays: s.plannedDays } : p.breakdown,
          outcome: p.outcome,
        };
      }),
    };
  }

  async list(me: string, q: ListBattlesQueryDto) {
    const c = q.cursor ? this.cursors.decode<{ id: string }>(q.cursor) : null;
    const rows = await this.prisma.battle.findMany({
      where: { participants: { some: { userId: me } }, status: q.status, ...(c && { id: { lt: c.id } }) },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
      include: { participants: true },
    });
    const page = toPage(rows, q.limit, (r) => ({ id: r.id }), (k) => this.cursors.encode(k));
    return {
      data: page.data.map((b) => ({ id: b.id, type: b.type, isGhost: b.isGhost, status: b.status, createdById: b.createdById, opponentId: b.participants.find((p) => p.userId !== me)?.userId, endsAt: b.status === 'PENDING' ? null : b.endsAt.toISOString(), durationDays: b.durationDays })),
      page: page.page,
    };
  }

  // ───────────── Closing (worker) ─────────────

  /** Expires stale invitations and closes finished battles (after the offline-sync grace). Idempotent. */
  async closeDue(): Promise<{ closed: number; expired: number }> {
    const { config } = await this.ruleSets.getActive();
    const now = this.clock.now();
    const expired = await this.prisma.battle.updateMany({ where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - INVITE_TTL_MS) } }, data: { status: 'EXPIRED' } });
    const due = await this.prisma.battle.findMany({ where: { status: 'ACTIVE', endsAt: { lte: new Date(now.getTime() - config.week_grace_hours * 3_600_000) } }, select: { id: true } });
    for (const { id } of due) await this.close(id);
    return { closed: due.length, expired: expired.count };
  }

  async close(id: string): Promise<void> {
    const { version, config } = await this.ruleSets.getActive();
    await this.prisma.$transaction(async (tx) => {
      const b = await tx.battle.findUniqueOrThrow({ where: { id }, include: { participants: true } });
      if (b.status !== 'ACTIVE') return;
      const weights = this.weights(b, config);
      const scores = new Map<string, Awaited<ReturnType<WeeklyScoreService['computeWindow']>>>();
      for (const p of b.participants) scores.set(p.userId, await this.weekly.computeWindow(p.userId, b.startsAt, b.endsAt, config, version, tx, weights));

      if (b.isGhost) {
        await this.closeGhost(tx, b, scores.get(b.participants[0]!.userId)!, config, version);
        return;
      }
      const [a, c] = b.participants;
      const sa = scores.get(a!.userId)!.total;
      const sc = scores.get(c!.userId)!.total;
      const draw = Math.abs(sa - sc) < config.battle_draw_margin;
      const winnerId = draw ? null : sa > sc ? a!.userId : c!.userId;

      for (const p of b.participants) {
        const s = scores.get(p.userId)!;
        const opponentId = b.participants.find((x) => x.userId !== p.userId)!.userId;
        const outcome: BattleOutcome = draw ? 'DRAW' : p.userId === winnerId ? 'WIN' : 'LOSS';
        const effectiveAt = b.endsAt;

        // XP: everyone earns by their own effort; improvement is rewarded even in defeat (spec §13.1).
        let xpTransactionId: string | null = null;
        const effortXp = Math.round(s.total * config.battle_xp_per_point);
        if (effortXp > 0) {
          xpTransactionId = (await this.ledger.appendXp(tx, { userId: p.userId, amount: effortXp, reason: 'BATTLE', sourceType: 'battle', sourceId: b.id, ruleSetVersion: version, effectiveAt, explanation: { formula: 'battle_xp', inputs: { score: s.total }, result: effortXp } }, config)).id;
        }
        if (outcome === 'WIN') {
          await this.ledger.appendXp(tx, { userId: p.userId, amount: config.battle_win_xp, reason: 'BATTLE_WIN', sourceType: 'battle', sourceId: b.id, ruleSetVersion: version, effectiveAt, explanation: { formula: 'battle_win_xp', result: config.battle_win_xp } }, config);
        }

        // LP, with anti-collusion limits for friend battles (docs §5.7); duel opponents are strangers by construction.
        const lp = this.lpFor(outcome, s.trainingDays, config);
        const skip = lp && b.type === 'FRIEND' ? await this.lpBlockedReason(tx, p.userId, opponentId, b, config) : null;
        let lpTransactionId: string | null = null;
        if (lp && !skip) {
          lpTransactionId = await this.ledger.appendLp(
            tx,
            { userId: p.userId, seasonId: b.seasonId, amount: lp.amount, reason: lp.reason, sourceType: b.type === 'DUEL' ? 'duel' : 'friend_battle', sourceId: b.id, ruleSetVersion: version, effectiveAt, explanation: { formula: lp.reason.toLowerCase(), inputs: { score: s.total, opponentScore: scores.get(opponentId)!.total }, result: lp.amount } },
            config.division_thresholds,
          );
        }

        await tx.battleParticipant.update({
          where: { battleId_userId: { battleId: b.id, userId: p.userId } },
          data: {
            score: s.total,
            outcome,
            breakdown: { components: s.components, trainingDays: s.trainingDays, plannedDays: s.plannedDays, lpSkippedReason: skip },
            lpTransactionId,
            xpTransactionId,
          },
        });
        if (outcome === 'WIN') {
          await tx.activityEvent.create({ data: { id: uuidv7(), userId: p.userId, type: 'BATTLE_WIN', refType: 'battle', refId: b.id, visibility: 'FRIENDS', payload: { opponentId } } });
        }
        await this.notifications.notify(tx, p.userId, 'BATTLE_RESULT', { battleId: b.id, outcome, score: s.total, opponentScore: scores.get(opponentId)!.total });
      }
      if (b.type === 'DUEL') {
        const results = b.participants.map((p) => ({ userId: p.userId, score: draw ? 0.5 : p.userId === winnerId ? 1 : 0 }));
        await this.duels.rate(tx, b, results, config.duel.glicko_tau);
      }
      await tx.battle.update({ where: { id: b.id }, data: { status: 'COMPLETED', closedAt: this.clock.now(), result: { winnerId, draw, scores: Object.fromEntries([...scores].map(([u, s]) => [u, s.total])) } } });
      await this.audit.log({ action: 'BATTLE_CLOSED', entityType: 'battle', entityId: b.id, after: { winnerId, draw } }, tx);
    });
  }

  /**
   * Ghost duel (docs §6.1): the athlete against their own previous week. No MMR change; a win pays `ghost_win_lp`,
   * otherwise participation LP for someone who trained.
   */
  private async closeGhost(tx: Tx, b: FullBattle, s: Awaited<ReturnType<WeeklyScoreService['computeWindow']>>, config: RuleSetConfig, version: number): Promise<void> {
    const p = b.participants[0]!;
    const target = Number((b.config as { ghostTarget?: number }).ghostTarget ?? 0);
    const diff = s.total - target;
    const outcome: BattleOutcome = Math.abs(diff) < config.battle_draw_margin ? 'DRAW' : diff > 0 ? 'WIN' : 'LOSS';
    const effectiveAt = b.endsAt;
    let xpTransactionId: string | null = null;
    const effortXp = Math.round(s.total * config.battle_xp_per_point);
    if (effortXp > 0) {
      xpTransactionId = (await this.ledger.appendXp(tx, { userId: p.userId, amount: effortXp, reason: 'BATTLE', sourceType: 'battle', sourceId: b.id, ruleSetVersion: version, effectiveAt, explanation: { formula: 'battle_xp', inputs: { score: s.total }, result: effortXp } }, config)).id;
    }
    const lp =
      outcome === 'WIN'
        ? { reason: 'BATTLE_WIN' as LpReason, amount: config.duel.ghost_win_lp }
        : s.trainingDays > 0
          ? { reason: 'BATTLE_PARTICIPATION' as LpReason, amount: config.battle_participation_lp }
          : null;
    let lpTransactionId: string | null = null;
    if (lp && lp.amount > 0) {
      lpTransactionId = await this.ledger.appendLp(
        tx,
        { userId: p.userId, seasonId: b.seasonId, amount: lp.amount, reason: lp.reason, sourceType: 'duel', sourceId: b.id, ruleSetVersion: version, effectiveAt, explanation: { formula: 'ghost_duel', inputs: { score: s.total, target }, result: lp.amount } },
        config.division_thresholds,
      );
    }
    await tx.battleParticipant.update({
      where: { battleId_userId: { battleId: b.id, userId: p.userId } },
      data: { score: s.total, outcome, breakdown: { components: s.components, trainingDays: s.trainingDays, plannedDays: s.plannedDays }, lpTransactionId, xpTransactionId },
    });
    await this.notifications.notify(tx, p.userId, 'BATTLE_RESULT', { battleId: b.id, outcome, score: s.total, opponentScore: target, ghost: true });
    await tx.battle.update({ where: { id: b.id }, data: { status: 'COMPLETED', closedAt: this.clock.now(), result: { ghost: true, target, winnerId: outcome === 'WIN' ? p.userId : null, draw: outcome === 'DRAW', scores: { [p.userId]: s.total } } } });
    await this.audit.log({ action: 'BATTLE_CLOSED', entityType: 'battle', entityId: b.id, after: { ghost: true, outcome } }, tx);
  }

  // ───────────── Internals ─────────────

  private lpFor(outcome: BattleOutcome, trainingDays: number, config: RuleSetConfig): { reason: LpReason; amount: number } | null {
    if (outcome === 'WIN') return { reason: 'BATTLE_WIN', amount: config.battle_win_lp };
    if (outcome === 'DRAW') return { reason: 'BATTLE_DRAW', amount: config.battle_draw_lp };
    // Losing still pays participation LP, but only to someone who actually trained.
    return trainingDays > 0 ? { reason: 'BATTLE_PARTICIPATION', amount: config.battle_participation_lp } : null;
  }

  /** Two friends alternating wins must not farm LP: weekly cap and per-opponent season cap. */
  private async lpBlockedReason(tx: Tx, userId: string, opponentId: string, b: Battle, config: RuleSetConfig): Promise<string | null> {
    const profile = await tx.profile.findUnique({ where: { userId } });
    if (!profile?.calibrationEndsAt || profile.calibrationEndsAt > b.startsAt) return 'CALIBRATION';
    const weekStart = this.calendar.weekStart(b.endsAt);
    const thisWeek = await tx.leaguePointTransaction.count({
      where: { userId, sourceType: 'friend_battle', reason: { in: BATTLE_LP_REASONS }, reversesId: null, effectiveAt: { gte: weekStart, lt: new Date(weekStart.getTime() + 7 * DAY) } },
    });
    if (thisWeek >= config.friend_battle_lp_weekly_max) return 'WEEKLY_FRIEND_BATTLE_LP_LIMIT';
    const vsOpponent = await tx.battleParticipant.count({
      where: { userId, lpTransactionId: { not: null }, battle: { seasonId: b.seasonId, type: 'FRIEND', status: 'COMPLETED', participants: { some: { userId: opponentId } } } },
    });
    if (vsOpponent >= config.friend_battle_same_opponent_season_max) return 'SAME_OPPONENT_SEASON_LIMIT';
    return null;
  }

  /** Disabled components get weight 0; the others are renormalised by the scoring formula. */
  private weights(b: Battle, config: RuleSetConfig): RuleSetConfig['lp_weights'] {
    const enabled = new Set<BattleComponent>(((b.config as { components?: BattleComponent[] }).components ?? [...BATTLE_COMPONENTS]) as BattleComponent[]);
    return {
      progress: enabled.has('progress') ? config.lp_weights.progress : 0,
      consistency: enabled.has('consistency') ? config.lp_weights.consistency : 0,
      performance: enabled.has('performance') ? config.lp_weights.performance : 0,
      challenge: 0,
    };
  }

  private async participantOf(me: string, id: string): Promise<FullBattle> {
    const b = await this.prisma.battle.findUnique({ where: { id }, include: { participants: true } });
    if (!b || !b.participants.some((p) => p.userId === me)) throw AppException.notFound('Battle');
    return b;
  }
}
