import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BattlesService } from '../battles/battles.service';
import { LeaderboardsService } from '../leaderboards/leaderboards.service';
import { divisionFor, levelRulesOf } from '../ledger/ledger.service';
import { levelFromXp } from '../scoring/level';
import { RuleSetService } from '../scoring/rule-set.service';
import { SeasonsService } from '../seasons/seasons.service';
import { PrivacyService } from '../users/privacy.service';

const STALE_RUN_MS = 60 * 60_000;

/**
 * Scheduled jobs (docs §8). ASSUMPTION: an in-process scheduler in the single worker instead of BullMQ until Redis
 * is available; every job is idempotent through the `job_runs` (job, key) ledger, so a restart or a double tick
 * never runs the same work twice.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seasons: SeasonsService,
    private readonly leaderboards: LeaderboardsService,
    private readonly privacy: PrivacyService,
    private readonly battles: BattlesService,
    private readonly ruleSets: RuleSetService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  /** Runs everything that is due now. Called every minute by the worker. */
  async runDue(): Promise<Record<string, unknown>> {
    const now = this.clock.now();
    const today = this.calendar.localDate(now);
    const { config } = await this.ruleSets.getActive();
    const out: Record<string, unknown> = {};

    out.seasonOpen = await this.once('season-open', today, () => this.seasons.openDueSeasons());
    for (const s of await this.prisma.season.findMany({ where: { status: { in: ['ACTIVE', 'CLOSING'] }, endsAt: { lte: new Date(now.getTime() - config.week_grace_hours * 3_600_000) } } })) {
      out[`seasonClose:${s.id}`] = await this.once('season-close', s.id, () => this.seasons.closeSeason(s.id));
    }
    const week = this.seasons.lastClosableWeek(now, config.week_grace_hours);
    out.weeklyClose = await this.once('weekly-close', this.calendar.localDate(week), () => this.seasons.closeWeek(week));
    // Battles close continuously (every tick), not once a day.
    out.battles = await this.battles.closeDue();
    out.calibration = await this.once('calibration-finalize', today, () => this.finalizeCalibrations());
    out.snapshot = await this.once('leaderboard-snapshot', today, () => this.leaderboards.snapshot(now));
    out.reconcile = await this.once('balance-reconcile', today, () => this.reconcileBalances());
    out.anonymise = await this.once('account-anonymise', today, () => this.privacy.processDueDeletions());
    out.cleanup = await this.once('cleanup', today, () => this.cleanup());
    return out;
  }

  /** Runs `fn` once per (job, key); failed or stale runs are retried on the next tick. */
  async once<T>(job: string, key: string, fn: () => Promise<T>): Promise<T | 'SKIPPED'> {
    const existing = await this.prisma.jobRun.findUnique({ where: { job_key: { job, key } } });
    if (existing?.status === 'DONE') return 'SKIPPED';
    if (existing?.status === 'RUNNING' && this.clock.now().getTime() - existing.startedAt.getTime() < STALE_RUN_MS) return 'SKIPPED';
    const id = existing?.id ?? uuidv7();
    try {
      if (existing) await this.prisma.jobRun.update({ where: { id }, data: { status: 'RUNNING', startedAt: this.clock.now(), error: null } });
      else await this.prisma.jobRun.create({ data: { id, job, key, status: 'RUNNING' } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'SKIPPED'; // another tick won
      throw err;
    }
    try {
      const result = await fn();
      await this.prisma.jobRun.update({ where: { id }, data: { status: 'DONE', finishedAt: this.clock.now(), result: (result ?? null) as Prisma.InputJsonValue } });
      return result;
    } catch (err) {
      this.logger.error({ err, job, key }, 'Job failed');
      await this.prisma.jobRun.update({ where: { id }, data: { status: 'FAILED', error: String(err).slice(0, 2000), finishedAt: this.clock.now() } });
      throw err;
    }
  }

  /** Baselines built during calibration become final: max(declared, best logged) (docs §9.2). */
  async finalizeCalibrations(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.baseline.findMany({
      where: { status: 'PROVISIONAL', calibratedValue: { not: null }, user: { profile: { calibrationEndsAt: { lte: now } } } },
      include: { metricType: true, user: { include: { profile: true } } },
    });
    for (const b of due) {
      const values = [b.declaredValue, b.calibratedValue].filter((v): v is Prisma.Decimal => v !== null).map(Number);
      const effective = b.metricType.direction === 'HIGHER_IS_BETTER' ? Math.max(...values) : Math.min(...values);
      await this.prisma.baseline.update({ where: { id: b.id }, data: { status: 'FINAL', effectiveValue: effective, finalizedAt: b.user.profile!.calibrationEndsAt } });
    }
    return due.length;
  }

  /** The cached balances must equal the ledgers; drift is repaired and reported. */
  async reconcileBalances(): Promise<{ checked: number; repaired: number }> {
    const { config } = await this.ruleSets.getActive();
    const drift = await this.prisma.$queryRaw<{ user_id: string; xp: bigint; lp: bigint; season_id: string | null }[]>`
      SELECT us.user_id,
             COALESCE((SELECT SUM(amount) FROM xp_transactions x WHERE x.user_id = us.user_id), 0) AS xp,
             COALESCE((SELECT SUM(amount) FROM league_point_transactions l WHERE l.user_id = us.user_id AND l.season_id = us.current_season_id), 0) AS lp,
             us.current_season_id AS season_id
      FROM user_stats us
      WHERE us.xp_total <> COALESCE((SELECT SUM(amount) FROM xp_transactions x WHERE x.user_id = us.user_id), 0)
         OR us.season_lp <> GREATEST(0, COALESCE((SELECT SUM(amount) FROM league_point_transactions l WHERE l.user_id = us.user_id AND l.season_id = us.current_season_id), 0))`;
    for (const d of drift) {
      const xp = Number(d.xp);
      const lp = Math.max(0, Number(d.lp));
      const level = levelFromXp(xp, levelRulesOf(config));
      const division = await this.prisma.division.findUnique({ where: { code: divisionFor(lp, config.division_thresholds) } });
      await this.prisma.userStats.update({
        where: { userId: d.user_id },
        data: { xpTotal: xp, level: level.level, xpIntoLevel: level.xpIntoLevel, xpForNextLevel: level.xpForNextLevel, seasonLp: lp, divisionId: division?.id },
      });
    }
    if (drift.length) this.logger.warn(`Balance drift repaired for ${drift.length} user(s)`);
    const checked = await this.prisma.userStats.count();
    return { checked, repaired: drift.length };
  }

  async cleanup(): Promise<Record<string, number>> {
    const now = this.clock.now();
    const week = new Date(now.getTime() - 7 * 86_400_000);
    const [tokens, verifications, outbox] = await Promise.all([
      this.prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: week } }] } }),
      this.prisma.verificationToken.deleteMany({ where: { OR: [{ expiresAt: { lt: week } }, { consumedAt: { lt: week } }] } }),
      this.prisma.domainEventOutbox.deleteMany({ where: { processedAt: { lt: week } } }),
    ]);
    return { refreshTokens: tokens.count, verificationTokens: verifications.count, outbox: outbox.count };
  }
}
