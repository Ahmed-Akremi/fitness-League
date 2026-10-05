import { Injectable } from '@nestjs/common';
import { Baseline, MetricType, Prisma } from '@prisma/client';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  consistencyComponent,
  harderLevel,
  improvementPct,
  isBetter,
  metricProgressScore,
  performanceRatio,
  progressRatio,
  topNMean,
  weightedTotal,
} from '../scoring/engine/fairness';
import { ExpectedProgressionService } from '../scoring/expected-progression.service';
import type { RuleSetConfig } from '../scoring/rule-set.schema';

const DAY = 86_400_000;
/** A metric is "active" when trained in the last 8 weeks. */
const ACTIVE_LOOKBACK_DAYS = 56;

export interface WeeklyScore {
  weekStart: Date;
  trainingDays: number;
  plannedDays: number;
  components: { progress: number; consistency: number; performance: number; challenge: number | null };
  total: number;
  lp: number;
  /** LP are only earned after the calibration period (docs §9.2). */
  eligible: boolean;
  breakdown: Prisma.InputJsonObject;
}

type Obs = { exerciseId: string; metricTypeId: string; value: number; observedAt: Date };

/**
 * Weekly competitive score (docs §5.5): 0–100, turned into League Points.
 * Reads only accepted, on-time data (metric observations flagged countsForCompetition).
 */
@Injectable()
export class WeeklyScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expected: ExpectedProgressionService,
    private readonly calendar: BusinessCalendar,
  ) {}

  async compute(userId: string, weekStart: Date, config: RuleSetConfig, ruleSetVersion: number, db: Prisma.TransactionClient = this.prisma): Promise<WeeklyScore> {
    return this.computeWindow(userId, weekStart, new Date(weekStart.getTime() + 7 * DAY), config, ruleSetVersion, db);
  }

  /**
   * Same scoring on any window (battles run on their own dates, docs §5.7). The plan is scaled to the window
   * length, so a 3-day battle expects 3/7 of the weekly training days.
   */
  async computeWindow(
    userId: string,
    weekStart: Date,
    weekEnd: Date,
    config: RuleSetConfig,
    ruleSetVersion: number,
    db: Prisma.TransactionClient = this.prisma,
    weights: RuleSetConfig['lp_weights'] = config.lp_weights,
  ): Promise<WeeklyScore> {
    const windowStart = new Date(weekEnd.getTime() - config.progress_window_days * DAY);
    const lookup = await this.expected.lookup(ruleSetVersion);

    const [profile, workouts, baselines, metricTypes, rawObs] = await Promise.all([
      db.profile.findUniqueOrThrow({ where: { userId } }),
      db.workout.findMany({
        where: { userId, status: 'ACCEPTED', deletedAt: null, performedAt: { gte: weekStart, lt: weekEnd }, durationS: { gte: config.workout_min_duration_min * 60 } },
        include: { evaluation: true },
      }),
      db.baseline.findMany({ where: { userId, status: { in: ['FINAL', 'CORRECTED'] } } }),
      db.metricType.findMany(),
      db.metricObservation.findMany({
        where: { userId, qualifier: 0, countsForCompetition: true, observedAt: { lt: weekEnd } },
        select: { exerciseId: true, metricTypeId: true, value: true, observedAt: true },
      }),
    ]);
    const metricById = new Map(metricTypes.map((m) => [m.id, m]));
    const obs: Obs[] = rawObs.map((o) => ({ ...o, value: Number(o.value) }));

    // Consistency: distinct local days with an on-time accepted workout, vs the athlete's own plan.
    const onTime = workouts.filter((w) => !((w.evaluation?.ruleHits ?? []) as { rule: string }[]).some((h) => h.rule === 'LATE_LOG'));
    const trainingDays = new Set(onTime.map((w) => this.calendar.localDate(w.performedAt))).size;
    const windowDays = (weekEnd.getTime() - weekStart.getTime()) / DAY;
    const plannedDays = Math.max(1, Math.round((profile.plannedTrainingDaysPerWeek * windowDays) / 7));
    const consistency = consistencyComponent(trainingDays, plannedDays);

    const progressScores: number[] = [];
    const performanceRatios: number[] = [];
    const metricsBreakdown: Prisma.InputJsonObject[] = [];
    const activeSince = new Date(weekEnd.getTime() - ACTIVE_LOOKBACK_DAYS * DAY);

    for (const b of baselines) {
      const metric = metricById.get(b.metricTypeId);
      if (!metric || metric.code === 'REPS_AT_WEIGHT') continue;
      const series = obs.filter((o) => o.exerciseId === b.exerciseId && o.metricTypeId === b.metricTypeId);
      if (!series.some((o) => o.observedAt >= activeSince)) continue;
      const best = (xs: Obs[]) => xs.reduce<number | null>((acc, o) => (acc === null || isBetter(o.value, acc, metric.direction) ? o.value : acc), null);

      // Progress: best in the rolling window vs the best before it (never below the baseline).
      const current = best(series.filter((o) => o.observedAt >= windowStart));
      const before = best(series.filter((o) => o.observedAt < windowStart));
      const baseline = Number(b.effectiveValue);
      const reference = before === null || isBetter(baseline, before, metric.direction) ? baseline : before;
      let progressScore: number | null = null;
      let ratio: number | null = null;
      let capped = false;
      if (current !== null) {
        const level = harderLevel([profile.experienceLevelDeclared, b.experienceLevel], (l) => lookup(l, b.exerciseId, b.metricTypeId));
        const pct = lookup(level, b.exerciseId, b.metricTypeId);
        if (pct !== null) {
          ratio = progressRatio(improvementPct(reference, current, metric.direction), pct);
          capped = ratio > config.progress_ceiling_ratio;
          progressScore = metricProgressScore(Math.min(ratio, config.progress_ceiling_ratio), config.progress_reward_cap);
          progressScores.push(progressScore);
        }
      }

      // Performance: this week's best relative to the all-time best (keeps advanced athletes in the game).
      const weekBest = best(series.filter((o) => o.observedAt >= weekStart));
      const allTime = best(series);
      let perf: number | null = null;
      if (weekBest !== null && allTime !== null) {
        perf = performanceRatio(weekBest, allTime, metric.direction);
        performanceRatios.push(perf);
      }

      metricsBreakdown.push({
        exerciseId: b.exerciseId,
        metric: metric.code,
        reference,
        current,
        ratio: ratio === null ? null : round(ratio, 3),
        progressScore: progressScore === null ? null : round(progressScore, 1),
        cappedForPlausibility: capped,
        weekBest,
        performanceRatio: perf === null ? null : round(perf, 3),
      });
    }

    const components = {
      progress: round(topNMean(progressScores, config.progress_top_n), 2),
      consistency: round(consistency, 2),
      // Verified proofs (Phase 3): factor = 1 + (multiplier − 1) × share of verified workouts, capped at 100 (docs §5).
      performance: round(Math.min(100, topNMean(performanceRatios, config.progress_top_n) * 100 * verificationFactor(workouts, config.verified_weight_multiplier)), 2),
      // Joined a challenge running this week and trained in it → 100 (docs §5); off → weights renormalised (Q-1).
      challenge: config.challenge_component ? await this.challengeComponent(db, userId, weekStart, weekEnd, workouts.length > 0) : null,
    };
    const total = round(weightedTotal(components, weights), 2);
    const eligible = !!profile.calibrationEndsAt && profile.calibrationEndsAt <= weekStart;
    return {
      weekStart,
      trainingDays,
      plannedDays,
      components,
      total,
      lp: eligible ? Math.round(total * config.weekly_lp_per_point) : 0,
      eligible,
      breakdown: {
        formula: 'weekly_score',
        weights,
        trainingDays,
        plannedDays,
        metrics: metricsBreakdown,
        topN: config.progress_top_n,
        ruleSetVersion,
      },
    };
  }

  /**
   * Anti-sandbagging audit (docs §5.4): within `baseline_audit_days` after a baseline is final, a best
   * performance that implies an impossible rate of progress means the baseline was understated. The baseline is
   * raised to what the plausible ceiling allows. Returns the corrected baselines.
   */
  async auditBaselines(tx: Prisma.TransactionClient, userId: string, until: Date, config: RuleSetConfig, ruleSetVersion: number): Promise<Baseline[]> {
    const lookup = await this.expected.lookup(ruleSetVersion);
    const profile = await tx.profile.findUniqueOrThrow({ where: { userId } });
    const baselines = await tx.baseline.findMany({ where: { userId, status: 'FINAL', finalizedAt: { not: null } } });
    const metrics = new Map((await tx.metricType.findMany()).map((m): [string, MetricType] => [m.id, m]));
    const corrected: Baseline[] = [];

    for (const b of baselines) {
      const metric = metrics.get(b.metricTypeId)!;
      const since = b.finalizedAt!;
      const auditEnd = new Date(since.getTime() + config.baseline_audit_days * DAY);
      if (until <= since) continue;
      const obs = await tx.metricObservation.findMany({
        where: { userId, exerciseId: b.exerciseId, metricTypeId: b.metricTypeId, qualifier: 0, countsForCompetition: true, observedAt: { gt: since, lt: until < auditEnd ? until : auditEnd } },
      });
      if (!obs.length) continue;
      const bestObs = obs.reduce((a, o) => (isBetter(Number(o.value), Number(a.value), metric.direction) ? o : a));
      const level = harderLevel([profile.experienceLevelDeclared, b.experienceLevel], (l) => lookup(l, b.exerciseId, b.metricTypeId));
      const pct = lookup(level, b.exerciseId, b.metricTypeId);
      if (pct === null) continue;
      const elapsedDays = Math.max(1, (bestObs.observedAt.getTime() - since.getTime()) / DAY);
      const allowedPct = config.progress_ceiling_ratio * pct * (elapsedDays / config.progress_window_days);
      const baseline = Number(b.effectiveValue);
      if (improvementPct(baseline, Number(bestObs.value), metric.direction) <= allowedPct) continue;

      const factor = 1 + allowedPct / 100;
      const raised = metric.direction === 'HIGHER_IS_BETTER' ? Number(bestObs.value) / factor : Number(bestObs.value) * factor;
      corrected.push(
        await tx.baseline.update({
          where: { id: b.id },
          data: { status: 'CORRECTED', correctedFrom: baseline, effectiveValue: round(raised, 3), ruleSetVersion },
        }),
      );
    }
    return corrected;
  }

  private async challengeComponent(db: Prisma.TransactionClient, userId: string, weekStart: Date, weekEnd: Date, trained: boolean): Promise<number> {
    if (!trained) return 0;
    const joined = await db.challengeParticipant.count({ where: { userId, joinedAt: { lt: weekEnd }, challenge: { deletedAt: null, startsAt: { lt: weekEnd }, endsAt: { gt: weekStart } } } });
    return joined > 0 ? 100 : 0;
  }
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** 1 when nothing is verified, `multiplier` when every counted workout of the week is. */
export function verificationFactor(workouts: { isVerified: boolean }[], multiplier: number): number {
  if (!workouts.length) return 1;
  return 1 + (multiplier - 1) * (workouts.filter((w) => w.isVerified).length / workouts.length);
}
