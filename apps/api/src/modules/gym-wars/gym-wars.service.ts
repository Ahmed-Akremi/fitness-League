import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BadgesService } from '../badges/badges.service';
import { ratePeriod } from '../duels/glicko2';
import { GymsService } from '../gyms/gyms.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { RuleSetConfig } from '../scoring/rule-set.schema';
import { RuleSetService } from '../scoring/rule-set.service';
import { WeeklyScoreService } from '../seasons/weekly-score.service';
import { bracketOf, GymCandidate, gymPairKey, GymScore, gymScore, MemberWeek, pairGyms } from './gym-war';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

type Db = Prisma.TransactionClient | PrismaService;

const warInclude = { participants: { include: { gym: { include: { logo: true, city: true } } } } } satisfies Prisma.GymWarInclude;
type Participant = Prisma.GymWarGetPayload<{ include: typeof warInclude }>['participants'][number];

/**
 * Gym Wars (docs §6.2). Every Monday the verified gyms that have not opted out are paired by size bracket and gym
 * rating; the eligible roster is frozen at the start. Once the week's scores are final (after the weekly close) the
 * war is scored from the members' weekly scores, the winner's active members earn XP and both gym ratings move.
 */
@Injectable()
export class GymWarsService {
  private readonly logger = new Logger(GymWarsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleSets: RuleSetService,
    private readonly weekly: WeeklyScoreService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly gyms: GymsService,
    private readonly badges: BadgesService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  private dateCol(weekStart: Date): Date {
    return new Date(`${this.calendar.localDate(weekStart)}T00:00:00Z`);
  }

  /** Business week start (Tunis midnight) of a DATE column. */
  private weekOf(col: Date): Date {
    return this.calendar.weekStart(new Date(col.getTime() + 12 * 3_600_000));
  }

  // ───────────── Start (Monday) ─────────────

  /** Pairs the eligible gyms for the week starting `week`. Idempotent: a gym already in this week's war is skipped. */
  async startWeek(week: Date): Promise<{ wars: number; byes: number }> {
    const { version, config } = await this.ruleSets.getActive();
    const r = config.gym_war;
    const weekStart = this.dateCol(week);
    const gyms = await this.prisma.gym.findMany({ where: { status: 'VERIFIED', deletedAt: null, warsOptOut: false, warParticipations: { none: { weekStart } } } });
    const rosters = new Map<string, string[]>();
    const candidates: GymCandidate[] = [];
    for (const g of gyms) {
      const members = await this.eligibleMembers(g.id, week);
      if (members.length < r.min_active_verified_members) continue;
      rosters.set(g.id, members);
      candidates.push({ gymId: g.id, bracket: bracketOf(members.length, r), rating: Number(g.rating) });
    }
    if (!candidates.length) return { wars: 0, byes: 0 };
    const { pairs, byes } = pairGyms(candidates, await this.recentPairs(week, r.no_rematch_weeks));
    const byId = new Map(gyms.map((g) => [g.id, g]));
    const bracketOfGym = new Map(candidates.map((c) => [c.gymId, c.bracket]));
    const participant = (gymId: string) => ({
      id: uuidv7(),
      gymId,
      weekStart,
      memberIds: rosters.get(gymId)!,
      eligibleMemberCount: rosters.get(gymId)!.length,
      ratingBefore: byId.get(gymId)!.rating,
    });

    for (const [a, b] of pairs) {
      await this.prisma.$transaction(async (tx) => {
        // A war paired across brackets is filed under the larger one.
        const bracket = [bracketOfGym.get(a)!, bracketOfGym.get(b)!].sort((x, y) => 'SML'.indexOf(y) - 'SML'.indexOf(x))[0]!;
        const war = await tx.gymWar.create({ data: { id: uuidv7(), weekStart, bracket, ruleSetVersion: version, participants: { create: [participant(a), participant(b)] } } });
        for (const [gymId, opponentId] of [
          [a, b],
          [b, a],
        ] as const) {
          for (const userId of rosters.get(gymId)!) {
            await this.notifications.notify(tx, userId, 'GYM_WAR_STARTED', { warId: war.id, gymId, opponentGymId: opponentId, opponentName: byId.get(opponentId)!.name });
          }
        }
      });
    }
    for (const gymId of byes) {
      await this.prisma.gymWar.create({ data: { id: uuidv7(), weekStart, bracket: bracketOfGym.get(gymId)!, status: 'BYE', ruleSetVersion: version, participants: { create: [participant(gymId)] } } });
    }
    this.logger.log(`Gym Wars week ${this.calendar.localDate(week)}: ${pairs.length} war(s), ${byes.length} bye(s)`);
    return { wars: pairs.length, byes: byes.length };
  }

  /**
   * Eligible roster (docs §6.2): primary gym, membership approved before the war starts, verified email,
   * past calibration, active account. Sanctions arrive in Phase 3.
   */
  private async eligibleMembers(gymId: string, week: Date): Promise<string[]> {
    const rows = await this.prisma.gymMember.findMany({
      where: {
        gymId,
        status: 'APPROVED',
        approvedAt: { lt: week },
        user: { status: 'ACTIVE', deletedAt: null, emailVerifiedAt: { not: null }, profile: { primaryGymId: gymId, calibrationEndsAt: { lte: week } } },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((m) => m.userId).sort();
  }

  private async recentPairs(week: Date, weeks: number): Promise<Set<string>> {
    const wars = await this.prisma.gymWar.findMany({
      where: { status: { not: 'BYE' }, weekStart: { gte: this.dateCol(new Date(week.getTime() - weeks * WEEK)), lt: this.dateCol(week) } },
      include: { participants: { select: { gymId: true } } },
    });
    return new Set(wars.filter((w) => w.participants.length === 2).map((w) => gymPairKey(w.participants[0]!.gymId, w.participants[1]!.gymId)));
  }

  // ───────────── Close (after the weekly close) ─────────────

  /** Scores and closes every active war of the week starting `week`. Idempotent. */
  async closeWeek(week: Date): Promise<{ closed: number }> {
    const wars = await this.prisma.gymWar.findMany({ where: { weekStart: this.dateCol(week), status: 'ACTIVE' }, select: { id: true } });
    for (const w of wars) await this.close(w.id);
    return { closed: wars.length };
  }

  async close(id: string): Promise<void> {
    const { version, config } = await this.ruleSets.getActive();
    await this.prisma.$transaction(async (tx) => {
      // Claim the war first so a concurrent close cannot pay twice.
      const { count } = await tx.gymWar.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'COMPLETED', closedAt: this.clock.now() } });
      if (count !== 1) return;
      const war = await tx.gymWar.findUniqueOrThrow({ where: { id }, include: warInclude });
      const week = this.weekOf(war.weekStart);
      const weekEnd = new Date(week.getTime() + WEEK);
      const [a, b] = war.participants as [Participant, Participant];
      const scored = new Map<string, { score: GymScore; active: string[] }>();
      for (const p of [a, b]) scored.set(p.gymId, await this.scoreFinal(tx, p.memberIds, week, weekEnd, config));
      const sa = scored.get(a.gymId)!.score.score;
      const sb = scored.get(b.gymId)!.score.score;
      const ratingOf = (p: Participant) => ({ rating: Number(p.gym.rating), rd: Number(p.gym.ratingRd), volatility: Number(p.gym.ratingVolatility) });
      const points = sa > sb ? 1 : sa < sb ? 0 : 0.5;
      const next = new Map([
        [a.gymId, ratePeriod(ratingOf(a), [{ opponent: ratingOf(b), score: points }], config.duel.glicko_tau)],
        [b.gymId, ratePeriod(ratingOf(b), [{ opponent: ratingOf(a), score: 1 - points }], config.duel.glicko_tau)],
      ]);
      const winner = sa === sb ? null : sa > sb ? a : b;

      for (const [p, opponent] of [
        [a, b],
        [b, a],
      ] as const) {
        const mine = scored.get(p.gymId)!.score;
        const theirs = scored.get(opponent.gymId)!.score.score;
        const outcome = mine.score > theirs ? 'WIN' : mine.score < theirs ? 'LOSS' : 'DRAW';
        const n = next.get(p.gymId)!;
        await tx.gymWarParticipant.update({ where: { id: p.id }, data: { score: mine.score, breakdown: { ...mine }, activeMemberCount: mine.active, outcome, ratingAfter: n.rating } });
        await tx.gym.update({ where: { id: p.gymId }, data: { rating: n.rating, ratingRd: n.rd, ratingVolatility: n.volatility } });
        for (const userId of p.memberIds) {
          await this.notifications.notify(tx, userId, 'GYM_WAR_RESULT', { warId: war.id, gymId: p.gymId, outcome, score: mine.score, opponentScore: theirs });
        }
      }
      if (winner) {
        const amount = config.gym_war_win_xp;
        for (const userId of scored.get(winner.gymId)!.active) {
          if (amount > 0) {
            await this.ledger.appendXp(tx, { userId, amount, reason: 'GYM_WAR_WIN', sourceType: 'gym_war', sourceId: war.id, ruleSetVersion: version, effectiveAt: weekEnd, explanation: { formula: 'gym_war_win_xp', result: amount } }, config);
          }
          await tx.activityEvent.create({ data: { id: uuidv7(), userId, type: 'GYM_WAR_WIN', refType: 'gym_war', refId: war.id, visibility: 'FRIENDS', payload: { gymId: winner.gymId } } });
          await this.badges.evaluate(tx, userId, war.id);
        }
      }
      await tx.gymWar.update({ where: { id }, data: { result: { winnerGymId: winner?.gymId ?? null, scores: { [a.gymId]: sa, [b.gymId]: sb } } } });
    });
  }

  /** Final score from the closed weekly scores: a member with no weekly score did not train (all zeros). */
  private async scoreFinal(db: Db, memberIds: string[], week: Date, weekEnd: Date, config: RuleSetConfig): Promise<{ score: GymScore; active: string[] }> {
    const active = await this.activeMembers(db, memberIds, week, weekEnd);
    const rows = await db.weeklyScore.findMany({ where: { userId: { in: memberIds }, weekStart: this.dateCol(week) } });
    const byUser = new Map(rows.map((w) => [w.userId, w]));
    const members: MemberWeek[] = memberIds.map((userId) => {
      const w = byUser.get(userId);
      return { total: Number(w?.total ?? 0), progress: Number(w?.progressC ?? 0), consistency: Number(w?.consistencyC ?? 0), active: active.has(userId) };
    });
    return { score: gymScore(members, await this.verifiedRatio(db, memberIds, week, weekEnd, config), config.gym_war), active: [...active] };
  }

  /** Live score of an active war: weekly scores computed up to now. */
  private async scoreLive(memberIds: string[], week: Date, config: RuleSetConfig, version: number): Promise<GymScore> {
    const end = new Date(Math.min(this.clock.now().getTime(), week.getTime() + WEEK));
    const active = await this.activeMembers(this.prisma, memberIds, week, end);
    const members: MemberWeek[] = [];
    for (const userId of memberIds) {
      if (!active.has(userId)) {
        members.push({ total: 0, progress: 0, consistency: 0, active: false });
        continue;
      }
      const s = await this.weekly.computeWindow(userId, week, end, config, version);
      members.push({ total: s.total, progress: s.components.progress, consistency: s.components.consistency, active: true });
    }
    return gymScore(members, await this.verifiedRatio(this.prisma, memberIds, week, end, config), config.gym_war);
  }

  /** Verified accepted workouts / accepted workouts × 100 (docs §6.2 w4), or null while the rule set keeps it off. */
  private async verifiedRatio(db: Db, memberIds: string[], from: Date, to: Date, config: RuleSetConfig): Promise<number | null> {
    if (!config.gym_war.use_verified_ratio) return null;
    const where = { userId: { in: memberIds }, status: 'ACCEPTED' as const, deletedAt: null, performedAt: { gte: from, lt: to } };
    const [all, verified] = await Promise.all([db.workout.count({ where }), db.workout.count({ where: { ...where, isVerified: true } })]);
    return all ? (verified / all) * 100 : 0;
  }

  private async activeMembers(db: Db, memberIds: string[], from: Date, to: Date): Promise<Set<string>> {
    const rows = await db.workout.findMany({ where: { userId: { in: memberIds }, status: 'ACCEPTED', deletedAt: null, performedAt: { gte: from, lt: to } }, select: { userId: true }, distinct: ['userId'] });
    return new Set(rows.map((r) => r.userId));
  }

  // ───────────── Reads ─────────────

  /** The war of my primary gym this week, with live scores. */
  async current(me: string) {
    const profile = await this.prisma.profile.findUnique({ where: { userId: me } });
    const gymId = profile?.primaryGymId ?? null;
    if (!gymId) return { gymId: null, war: null };
    const weekStart = this.dateCol(this.calendar.weekStart(this.clock.now()));
    const p = await this.prisma.gymWarParticipant.findUnique({ where: { gymId_weekStart: { gymId, weekStart } } });
    return { gymId, war: p ? await this.get(me, p.gymWarId) : null };
  }

  async get(me: string, id: string) {
    const war = await this.prisma.gymWar.findUnique({ where: { id }, include: warInclude });
    if (!war) throw AppException.notFound('Gym war');
    const week = this.weekOf(war.weekStart);
    let live: Map<string, GymScore> | null = null;
    if (war.status === 'ACTIVE') {
      const { version, config } = await this.ruleSets.getActive();
      live = new Map();
      for (const p of war.participants) live.set(p.gymId, await this.scoreLive(p.memberIds, week, config, version));
    }
    return {
      id: war.id,
      weekStart: this.calendar.localDate(week),
      endsAt: new Date(week.getTime() + WEEK).toISOString(),
      status: war.status,
      bracket: war.bracket,
      live: live !== null,
      gyms: war.participants.map((p) => {
        const s = live?.get(p.gymId) ?? (p.score === null ? null : (p.breakdown as unknown as GymScore));
        return {
          gymId: p.gymId,
          name: p.gym.name,
          city: p.gym.city.nameI18n,
          logoUrl: this.gyms.logoUrl(p.gym.logo),
          isMine: p.memberIds.includes(me),
          eligibleMembers: p.eligibleMemberCount,
          activeMembers: s?.active ?? p.activeMemberCount,
          score: s?.score ?? null,
          breakdown: s ? { topK: s.topK, participation: s.participation, meanProgress: s.meanProgress, consistency: s.consistency } : null,
          outcome: p.outcome,
          rating: Math.round(Number(p.ratingAfter ?? p.ratingBefore)),
        };
      }),
    };
  }

  /** Past and current wars of a gym, newest first, with its record and enrolment. */
  async history(gymId: string) {
    const gym = await this.prisma.gym.findFirst({ where: { id: gymId, deletedAt: null } });
    if (!gym) throw AppException.notFound('Gym');
    const [rows, outcomes] = await Promise.all([
      this.prisma.gymWarParticipant.findMany({
        where: { gymId },
        orderBy: { weekStart: 'desc' },
        take: 20,
        include: { war: { include: { participants: { include: { gym: { select: { name: true } } } } } } },
      }),
      this.prisma.gymWarParticipant.groupBy({ by: ['outcome'], where: { gymId, outcome: { not: null } }, _count: true }),
    ]);
    const count = (o: string) => outcomes.find((x) => x.outcome === o)?._count ?? 0;
    return {
      enrolled: !gym.warsOptOut,
      rating: Math.round(Number(gym.rating)),
      record: { wins: count('WIN'), losses: count('LOSS'), draws: count('DRAW') },
      data: rows.map((p) => {
        const opponent = p.war.participants.find((o) => o.gymId !== gymId);
        return {
          id: p.gymWarId,
          weekStart: this.calendar.localDate(this.weekOf(p.weekStart)),
          status: p.war.status,
          opponent: opponent ? { gymId: opponent.gymId, name: opponent.gym.name } : null,
          score: p.score === null ? null : Number(p.score),
          opponentScore: opponent?.score == null ? null : Number(opponent.score),
          outcome: p.outcome,
        };
      }),
    };
  }

  /** The gym admin opts the gym in or out of the coming wars (Q-11: auto-enrolled by default). */
  async setEnrollment(user: AuthUser, gymId: string, enrolled: boolean) {
    const gym = await this.prisma.gym.findFirst({ where: { id: gymId, deletedAt: null } });
    if (!gym) throw AppException.notFound('Gym');
    if (!this.gyms.canManage(user, gym)) throw AppException.forbidden("Only this gym's admin can do that.");
    await this.prisma.gym.update({ where: { id: gymId }, data: { warsOptOut: !enrolled } });
    return { enrolled };
  }
}
