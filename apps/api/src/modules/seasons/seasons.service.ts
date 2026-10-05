import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Season } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GoalsService } from '../goals/goals.service';
import { divisionFor, LedgerService } from '../ledger/ledger.service';
import type { RuleSetConfig } from '../scoring/rule-set.schema';
import { RuleSetService } from '../scoring/rule-set.service';
import { WeeklyScoreService } from './weekly-score.service';

const DAY = 86_400_000;
type Tx = Prisma.TransactionClient;

@Injectable()
export class SeasonsService {
  private readonly logger = new Logger(SeasonsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly weekly: WeeklyScoreService,
    private readonly ledger: LedgerService,
    private readonly goals: GoalsService,
    private readonly ruleSets: RuleSetService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  // ───────────────────────────── Seasons ─────────────────────────────

  async current(countryCode = 'TN'): Promise<Season | null> {
    return this.prisma.season.findFirst({ where: { countryCode, status: 'ACTIVE' } });
  }

  seasonAt(tx: Tx, at: Date, countryCode = 'TN'): Promise<Season | null> {
    return tx.season.findFirst({ where: { countryCode, startsAt: { lte: at }, endsAt: { gt: at } } });
  }

  /** Activates scheduled seasons whose start has come (and nothing else is active). */
  async openDueSeasons(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.season.findMany({ where: { status: 'SCHEDULED', startsAt: { lte: now } }, orderBy: { startsAt: 'asc' } });
    let opened = 0;
    for (const s of due) {
      if (await this.prisma.season.findFirst({ where: { countryCode: s.countryCode, status: { in: ['ACTIVE', 'CLOSING'] } } })) continue;
      await this.prisma.season.update({ where: { id: s.id }, data: { status: 'ACTIVE' } });
      await this.audit.log({ action: 'SEASON_OPENED', entityType: 'season', entityId: s.id });
      opened++;
    }
    return opened;
  }

  /**
   * Season end (docs §14): archive standings and champions, then carry every athlete into the next season with
   * a soft reset toward their division floor. Idempotent: re-running after a crash finishes the job.
   */
  async closeSeason(seasonId: string): Promise<{ standings: number }> {
    const { version, config } = await this.ruleSets.getActive();
    const season = await this.prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    if (season.status === 'CLOSED') return { standings: 0 };
    await this.prisma.season.update({ where: { id: seasonId }, data: { status: 'CLOSING' } });

    const next = await this.nextSeason(season);
    const count = await this.prisma.$transaction(
      async (tx) => {
        await this.writeStandings(tx, season.id);
        const stats = await tx.userStats.findMany({ where: { currentSeasonId: season.id } });
        for (const s of stats) {
          const carried = softReset(s.seasonLp, config);
          await tx.userStats.update({ where: { userId: s.userId }, data: { currentSeasonId: next.id, seasonLp: 0 } });
          if (carried > 0) {
            await this.ledger.appendLp(
              tx,
              {
                userId: s.userId,
                seasonId: next.id,
                amount: carried,
                reason: 'SEASON_SOFT_RESET',
                sourceType: 'season',
                sourceId: season.id,
                ruleSetVersion: version,
                effectiveAt: next.startsAt,
                explanation: { formula: 'floor + (lp − floor) × ratio', inputs: { lp: s.seasonLp, floor: divisionFloor(s.seasonLp, config), ratio: config.season_soft_reset_ratio }, result: carried },
              },
              config.division_thresholds,
            );
          } else {
            const bronze = await tx.division.findUnique({ where: { code: 'BRONZE' } });
            await tx.userStats.update({ where: { userId: s.userId }, data: { divisionId: bronze?.id } });
          }
        }
        await tx.season.update({ where: { id: season.id }, data: { status: 'CLOSED', closedAt: this.clock.now(), ruleSetVersionAtClose: version } });
        await tx.season.update({ where: { id: next.id }, data: { status: 'ACTIVE' } });
        await this.audit.log({ action: 'SEASON_CLOSED', entityType: 'season', entityId: season.id, after: { standings: stats.length, nextSeasonId: next.id } }, tx);
        return stats.length;
      },
      { timeout: 120_000 },
    );
    return { standings: count };
  }

  /** Next season: the scheduled one starting at this season's end, or a new quarter (default cadence). */
  private async nextSeason(season: Season): Promise<Season> {
    const scheduled = await this.prisma.season.findFirst({ where: { countryCode: season.countryCode, status: 'SCHEDULED', startsAt: { gte: season.endsAt } }, orderBy: { startsAt: 'asc' } });
    if (scheduled) return scheduled;
    const { start, end } = this.calendar.quarterBounds(new Date(season.endsAt.getTime() + DAY));
    const local = new Date(start.getTime() + 60 * 60_000);
    return this.prisma.season.create({
      data: { id: uuidv7(), name: `Season ${local.getUTCFullYear()} Q${Math.floor(local.getUTCMonth() / 3) + 1}`, countryCode: season.countryCode, startsAt: season.endsAt, endsAt: end, status: 'SCHEDULED' },
    });
  }

  private async writeStandings(tx: Tx, seasonId: string): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO season_standings (season_id, user_id, final_lp, division_id, rank_national, rank_governorate, rank_gym, is_champion, champion_scope)
      SELECT ${seasonId}::uuid, r.user_id, r.lp, COALESCE(r.division_id, (SELECT id FROM divisions WHERE code = 'BRONZE')),
             r.rank_national, r.rank_governorate, r.rank_gym,
             r.rank_national = 1 OR r.rank_governorate = 1,
             CASE WHEN r.rank_national = 1 THEN 'NATIONAL' WHEN r.rank_governorate = 1 THEN 'GOVERNORATE' END
      FROM (
        SELECT us.user_id, us.season_lp AS lp, us.division_id,
               RANK() OVER (ORDER BY us.season_lp DESC) AS rank_national,
               RANK() OVER (PARTITION BY p.governorate_id ORDER BY us.season_lp DESC) AS rank_governorate,
               CASE WHEN p.primary_gym_id IS NULL THEN NULL ELSE RANK() OVER (PARTITION BY p.primary_gym_id ORDER BY us.season_lp DESC) END AS rank_gym
        FROM user_stats us
        JOIN users u ON u.id = us.user_id
        JOIN profiles p ON p.user_id = us.user_id
        WHERE us.current_season_id = ${seasonId}::uuid AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL AND us.season_lp > 0
      ) r
      ON CONFLICT (season_id, user_id) DO NOTHING`;
  }

  // ───────────────────────────── Weekly close ─────────────────────────────

  /** Start (Monday 00:00 local) of the most recent week whose grace period is over. */
  lastClosableWeek(now: Date, graceHours: number): Date {
    const thisWeek = this.calendar.weekStart(now);
    const candidate = new Date(thisWeek.getTime() - 7 * DAY);
    return now.getTime() >= candidate.getTime() + 7 * DAY + graceHours * 3_600_000 ? candidate : new Date(candidate.getTime() - 7 * DAY);
  }

  /**
   * Final weekly scores → League Points, weekly streaks and habit goals (docs §8 weekly-close).
   * Idempotent per (user, week).
   */
  async closeWeek(weekStart: Date): Promise<{ users: number; lpPosted: number }> {
    const { version, config } = await this.ruleSets.getActive();
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
    const active = await this.prisma.workout.findMany({ where: { performedAt: { gte: weekStart, lt: weekEnd }, status: 'ACCEPTED', deletedAt: null }, select: { userId: true }, distinct: ['userId'] });
    const habit = await this.prisma.goal.findMany({ where: { type: 'HABIT', status: 'ACTIVE', deletedAt: null }, select: { userId: true }, distinct: ['userId'] });
    const users = [...new Set([...active.map((a) => a.userId), ...habit.map((h) => h.userId)])];
    let lpPosted = 0;

    for (const userId of users) {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.weeklyScore.findUnique({ where: { userId_weekStart: { userId, weekStart: dateOnly(weekStart) } } });
        if (existing?.status === 'FINAL') return;

        // Anti-sandbagging audit first: a corrected baseline also re-scores the weeks already paid on it.
        const corrected = await this.weekly.auditBaselines(tx, userId, weekEnd, config, version);
        if (corrected.length) await this.rescoreFinalWeeks(tx, userId, corrected[0]!.finalizedAt!, weekStart, config, version);

        const score = await this.weekly.compute(userId, weekStart, config, version, tx);
        const season = await this.seasonAt(tx, weekStart);
        let lpTransactionId: string | null = null;
        if (score.lp > 0 && season) {
          lpTransactionId = await this.ledger.appendLp(
            tx,
            { userId, seasonId: season.id, amount: score.lp, reason: 'WEEKLY_SCORE', sourceType: 'week', sourceId: this.calendar.localDate(weekStart), ruleSetVersion: version, effectiveAt: weekEnd, explanation: { ...score.breakdown, components: score.components, total: score.total, result: score.lp } },
            config.division_thresholds,
          );
          lpPosted += score.lp;
        }
        await this.saveScore(tx, userId, season?.id ?? null, score, version, lpTransactionId);
        await this.updateWeeklyStreak(tx, userId, score.trainingDays >= score.plannedDays);
        await this.goals.onWeekClosed(tx, userId, score.trainingDays, weekEnd, version, config);
      });
    }
    this.logger.log(`Week ${this.calendar.localDate(weekStart)} closed: ${users.length} users, ${lpPosted} LP`);
    return { users: users.length, lpPosted };
  }

  /** Re-scores already-paid weeks after a baseline correction: reversal + corrected entry (docs §5.10.3). */
  private async rescoreFinalWeeks(tx: Tx, userId: string, since: Date, before: Date, config: RuleSetConfig, version: number): Promise<void> {
    const weeks = await tx.weeklyScore.findMany({ where: { userId, status: 'FINAL', weekStart: { gte: dateOnly(this.calendar.weekStart(since)), lt: dateOnly(before) } } });
    for (const w of weeks) {
      const weekStart = this.calendar.weekStart(new Date(w.weekStart.getTime() + 12 * 3_600_000));
      if (w.lpTransactionId) await this.ledger.reverseLp(tx, w.lpTransactionId, 'baseline corrected (anti-sandbagging)', version, config.division_thresholds);
      const score = await this.weekly.compute(userId, weekStart, config, version, tx);
      let lpTransactionId: string | null = null;
      if (score.lp > 0 && w.seasonId) {
        const corrections = await tx.leaguePointTransaction.count({ where: { userId, sourceType: 'week', sourceId: { startsWith: this.calendar.localDate(weekStart) } } });
        lpTransactionId = await this.ledger.appendLp(
          tx,
          {
            userId,
            seasonId: w.seasonId,
            amount: score.lp,
            reason: 'WEEKLY_SCORE',
            sourceType: 'week',
            sourceId: `${this.calendar.localDate(weekStart)}#c${corrections}`,
            ruleSetVersion: version,
            effectiveAt: new Date(weekStart.getTime() + 7 * DAY),
            explanation: { ...score.breakdown, components: score.components, total: score.total, result: score.lp, correction: 'baseline corrected' },
          },
          config.division_thresholds,
        );
      }
      await this.saveScore(tx, userId, w.seasonId, score, version, lpTransactionId);
    }
  }

  /**
   * Admin "recompute range" (docs §5.2): re-scores the closed weeks in [from, to) with the active rule set.
   * Never edits a ledger row: a changed week gets a reversal and a new entry. Weeks of closed seasons are left
   * alone (their standings are final). `dryRun` only reports what would change.
   */
  async recomputeRange(from: Date, to: Date, dryRun: boolean): Promise<{ weeks: number; changed: number; lpDelta: number; changes: { userId: string; weekStart: string; before: { total: number; lp: number }; after: { total: number; lp: number } }[] }> {
    const { version, config } = await this.ruleSets.getActive();
    const rows = await this.prisma.weeklyScore.findMany({
      where: { status: 'FINAL', weekStart: { gte: dateOnly(from), lt: dateOnly(to) }, season: { status: 'ACTIVE' } },
      orderBy: [{ weekStart: 'asc' }, { userId: 'asc' }],
    });
    const lpIds = rows.map((r) => r.lpTransactionId).filter((id): id is string => id !== null);
    const paid = new Map((await this.prisma.leaguePointTransaction.findMany({ where: { id: { in: lpIds } }, select: { id: true, amount: true } })).map((t) => [t.id, t.amount]));
    const changes: { userId: string; weekStart: string; before: { total: number; lp: number }; after: { total: number; lp: number } }[] = [];
    for (const w of rows) {
      const weekStart = this.calendar.weekStart(new Date(w.weekStart.getTime() + 12 * 3_600_000));
      const score = await this.weekly.compute(w.userId, weekStart, config, version);
      const before = { total: Number(w.total), lp: w.lpTransactionId ? (paid.get(w.lpTransactionId) ?? 0) : 0 };
      if (score.total === before.total && score.lp === before.lp) continue;
      changes.push({ userId: w.userId, weekStart: this.calendar.localDate(weekStart), before, after: { total: score.total, lp: score.lp } });
      if (dryRun) continue;
      await this.prisma.$transaction(async (tx) => {
        if (w.lpTransactionId) await this.ledger.reverseLp(tx, w.lpTransactionId, `recompute with rule set v${version}`, version, config.division_thresholds);
        let lpTransactionId: string | null = null;
        if (score.lp > 0) {
          const n = await tx.leaguePointTransaction.count({ where: { userId: w.userId, sourceType: 'week', sourceId: { startsWith: this.calendar.localDate(weekStart) } } });
          lpTransactionId = await this.ledger.appendLp(
            tx,
            {
              userId: w.userId,
              seasonId: w.seasonId,
              amount: score.lp,
              reason: 'WEEKLY_SCORE',
              sourceType: 'week',
              sourceId: `${this.calendar.localDate(weekStart)}#r${n}`,
              ruleSetVersion: version,
              effectiveAt: new Date(weekStart.getTime() + 7 * DAY),
              explanation: { ...score.breakdown, components: score.components, total: score.total, result: score.lp, correction: `recomputed with rule set v${version}` },
            },
            config.division_thresholds,
          );
        }
        await this.saveScore(tx, w.userId, w.seasonId, score, version, lpTransactionId);
      });
    }
    return { weeks: rows.length, changed: changes.length, lpDelta: changes.reduce((acc, c) => acc + c.after.lp - c.before.lp, 0), changes: changes.slice(0, 200) };
  }

  private async saveScore(tx: Tx, userId: string, seasonId: string | null, s: Awaited<ReturnType<WeeklyScoreService['compute']>>, version: number, lpTransactionId: string | null) {
    const season = seasonId ?? (await this.seasonAt(tx, s.weekStart))?.id;
    if (!season) return;
    const data = {
      seasonId: season,
      ruleSetVersion: version,
      progressC: s.components.progress,
      consistencyC: s.components.consistency,
      performanceC: s.components.performance,
      challengeC: s.components.challenge,
      total: s.total,
      breakdown: s.breakdown,
      lpTransactionId,
      status: 'FINAL' as const,
    };
    await tx.weeklyScore.upsert({
      where: { userId_weekStart: { userId, weekStart: dateOnly(s.weekStart) } },
      update: data,
      create: { id: uuidv7(), userId, weekStart: dateOnly(s.weekStart), ...data },
    });
  }

  /** Headline streak = weeks meeting the personal plan (ASSUMPTION Q-8: rest days never break it). */
  private async updateWeeklyStreak(tx: Tx, userId: string, met: boolean): Promise<void> {
    const s = await tx.streak.findUnique({ where: { userId } });
    const current = met ? (s?.currentWeeks ?? 0) + 1 : 0;
    await tx.streak.upsert({
      where: { userId },
      update: { currentWeeks: current, longestWeeks: Math.max(current, s?.longestWeeks ?? 0) },
      create: { userId, currentWeeks: current, longestWeeks: current },
    });
  }

  // ───────────────────────────── Reads ─────────────────────────────

  async currentWeek(userId: string) {
    const { version, config } = await this.ruleSets.getActive();
    const weekStart = this.calendar.weekStart(this.clock.now());
    const s = await this.weekly.compute(userId, weekStart, config, version);
    return { weekStart: weekStart.toISOString(), status: 'PROVISIONAL', trainingDays: s.trainingDays, plannedDays: s.plannedDays, components: s.components, total: s.total, projectedLp: s.lp, eligible: s.eligible, breakdown: s.breakdown };
  }

  async lp(userId: string, seasonId?: string) {
    const season = seasonId ? await this.prisma.season.findUnique({ where: { id: seasonId } }) : await this.current();
    if (!season) throw AppException.notFound('Season');
    const stats = await this.prisma.userStats.findUniqueOrThrow({ where: { userId }, include: { division: true } });
    const live = stats.currentSeasonId === season.id;
    const standing = live ? null : await this.prisma.seasonStanding.findUnique({ where: { seasonId_userId: { seasonId: season.id, userId } }, include: { division: true } });
    const { config } = await this.ruleSets.getActive();
    const lp = live ? stats.seasonLp : (standing?.finalLp ?? 0);
    const division = live ? (stats.division?.code ?? divisionFor(lp, config.division_thresholds)) : (standing?.division.code ?? 'BRONZE');
    const nextDivision = (['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'ELITE'] as const).find((d) => (config.division_thresholds[d] ?? Infinity) > lp) ?? null;
    return {
      season: { id: season.id, name: season.name, startsAt: season.startsAt.toISOString(), endsAt: season.endsAt.toISOString(), status: season.status },
      lp,
      division,
      nextDivision,
      lpToNextDivision: nextDivision ? config.division_thresholds[nextDivision]! - lp : null,
    };
  }
}

/** New-season LP: floor + (lp − floor) × ratio (docs §5.10.4). */
export function softReset(lp: number, config: Pick<RuleSetConfig, 'division_thresholds' | 'season_soft_reset_ratio'>): number {
  const floor = divisionFloor(lp, config);
  return Math.round(floor + (lp - floor) * config.season_soft_reset_ratio);
}

export function divisionFloor(lp: number, config: Pick<RuleSetConfig, 'division_thresholds'>): number {
  return config.division_thresholds[divisionFor(lp, config.division_thresholds)] ?? 0;
}

function dateOnly(instantOfLocalMidnight: Date): Date {
  // weekStart instants are local midnights (e.g. Sunday 23:00Z for Tunis); the DATE column stores the local date.
  return new Date(`${new Date(instantOfLocalMidnight.getTime() + 12 * 3_600_000).toISOString().slice(0, 10)}T00:00:00Z`);
}
