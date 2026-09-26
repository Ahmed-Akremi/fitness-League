import { Injectable } from '@nestjs/common';
import { MetricType } from '@prisma/client';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { improvementPct } from '../scoring/engine/fairness';
import { PrivacyService } from '../users/privacy.service';

export const PERIODS = { '7d': 7, '30d': 30, '3m': 91, '6m': 182, '1y': 365 } as const;
export type Period = keyof typeof PERIODS;

/** "My Progress": you vs you (docs §11). Read-only views over observations, records and the XP ledger. */
@Injectable()
export class ProgressQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: PrivacyService,
    private readonly clock: ClockService,
  ) {}

  async overview(userId: string, period: Period) {
    const now = this.clock.now();
    const from = new Date(now.getTime() - PERIODS[period] * 86_400_000);
    const [observations, baselines, prXp] = await Promise.all([
      this.prisma.metricObservation.findMany({
        where: { userId, qualifier: 0, metricType: { code: { not: 'REPS_AT_WEIGHT' } } },
        include: { metricType: true, exercise: true },
        orderBy: { observedAt: 'asc' },
      }),
      this.prisma.baseline.findMany({ where: { userId } }),
      this.prisma.xpTransaction.findMany({ where: { userId, sourceType: 'pr', reason: { in: ['PR', 'CALIBRATION_PR'] }, effectiveAt: { gte: from }, reversal: null } }),
    ]);

    const groups = new Map<string, typeof observations>();
    for (const o of observations) {
      const k = `${o.exerciseId}|${o.metricTypeId}`;
      groups.set(k, [...(groups.get(k) ?? []), o]);
    }
    const bestOf = (vals: number[], m: MetricType) => (m.direction === 'HIGHER_IS_BETTER' ? Math.max(...vals) : Math.min(...vals));

    const metrics = [];
    for (const rows of groups.values()) {
      const inPeriod = rows.filter((r) => r.observedAt >= from);
      if (!inPeriod.length) continue;
      const first = rows[0]!;
      const before = rows.filter((r) => r.observedAt < from);
      const baseline = baselines.find((b) => b.exerciseId === first.exerciseId && b.metricTypeId === first.metricTypeId);
      // Reference: best before the period; for a brand-new metric, the first value inside it (or the baseline).
      const reference = before.length
        ? bestOf(before.map((r) => Number(r.value)), first.metricType)
        : baseline
          ? Number(baseline.effectiveValue)
          : Number(inPeriod[0]!.value);
      const current = bestOf(inPeriod.map((r) => Number(r.value)), first.metricType);
      const points = prXp
        .filter((x) => {
          const inputs = (x.explanation as { inputs?: { exerciseId?: string; metric?: string } }).inputs;
          return inputs?.exerciseId === first.exerciseId && inputs?.metric === first.metricType.code;
        })
        .reduce((s, x) => s + x.amount, 0);
      metrics.push({
        exercise: { id: first.exerciseId, code: first.exercise.code, name: first.exercise.nameI18n },
        metric: { code: first.metricType.code, unit: first.metricType.unit, direction: first.metricType.direction },
        before: reference,
        now: current,
        changePct: Math.round(improvementPct(reference, current, first.metricType.direction) * 10) / 10,
        xpFromRecords: points,
        sessions: inPeriod.length,
      });
    }
    metrics.sort((a, b) => b.sessions - a.sessions);

    // Health data: only ever returned to its owner, and only this endpoint shows it.
    const weights = (await this.privacy.bodyMeasurements(userId, 400)).filter((m) => new Date(m.measuredAt) >= from && m.weightKg !== null);
    return {
      period,
      from: from.toISOString(),
      to: now.toISOString(),
      metrics,
      bodyWeight: weights.length ? { first: weights[weights.length - 1]!.weightKg, last: weights[0]!.weightKg, points: weights.length } : null,
    };
  }

  async series(userId: string, exerciseId: string, metricCode: string, period: Period) {
    const from = new Date(this.clock.now().getTime() - PERIODS[period] * 86_400_000);
    const metric = await this.prisma.metricType.findUnique({ where: { code: metricCode } });
    if (!metric) throw AppException.notFound('Metric');
    const rows = await this.prisma.metricObservation.findMany({
      where: { userId, exerciseId, metricTypeId: metric.id, qualifier: 0, observedAt: { gte: from } },
      orderBy: { observedAt: 'asc' },
    });
    return { metric: { code: metric.code, unit: metric.unit, direction: metric.direction }, points: rows.map((r) => ({ at: r.observedAt.toISOString(), value: Number(r.value), workoutId: r.workoutId })) };
  }

  async records(userId: string) {
    const rows = await this.prisma.personalRecord.findMany({
      where: { userId, isCurrent: true, metricType: { code: { not: 'REPS_AT_WEIGHT' } } },
      include: { exercise: true, metricType: true },
      orderBy: { achievedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      exercise: { id: r.exerciseId, code: r.exercise.code, name: r.exercise.nameI18n },
      metric: { code: r.metricType.code, unit: r.metricType.unit },
      value: Number(r.value),
      previousValue: r.previousValue === null ? null : Number(r.previousValue),
      status: r.status,
      achievedAt: r.achievedAt.toISOString(),
      workoutId: r.workoutId,
    }));
  }

  async baselines(userId: string) {
    const rows = await this.prisma.baseline.findMany({ where: { userId }, include: { exercise: true, metricType: true } });
    return rows.map((b) => ({
      exercise: { id: b.exerciseId, code: b.exercise.code },
      metric: { code: b.metricType.code, unit: b.metricType.unit },
      declared: b.declaredValue === null ? null : Number(b.declaredValue),
      effective: Number(b.effectiveValue),
      status: b.status,
      experienceLevel: b.experienceLevel,
    }));
  }
}
