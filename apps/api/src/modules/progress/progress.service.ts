import { Injectable } from '@nestjs/common';
import { Baseline, ExperienceLevel, MetricType, PersonalRecord, PrStatus, Prisma } from '@prisma/client';
import { uuidv7 } from '../../common/ids/uuid';
import { deriveExperienceLevel, harderLevel, improvementPct, isBetter, progressRatio } from '../scoring/engine/fairness';
import { extractObservations, Observation } from '../scoring/engine/observations';
import type { RuleSetConfig } from '../scoring/rule-set.schema';
import type { WorkoutInput } from '../workouts/workout-metrics';

type Tx = Prisma.TransactionClient;

export interface PrOutcome {
  prId: string;
  exerciseId: string;
  exerciseCode: string;
  metricCode: string;
  qualifier: number;
  value: number;
  previousValue: number | null;
  status: PrStatus;
  /** Improvement ratio vs expected; null for calibration / first records. */
  ratio: number | null;
}

export interface RecordContext {
  userId: string;
  workoutId: string;
  input: WorkoutInput;
  tracked: (exerciseId: string) => string[];
  config: RuleSetConfig;
  expected: (level: ExperienceLevel, exerciseId: string, metricTypeId: string) => number | null;
  /** Workout performed during the calibration period (docs §9.2). */
  inCalibration: boolean;
  calibrationOver: boolean;
  declaredLevel: ExperienceLevel | null;
  bodyWeightKg: number | null;
  countsForCompetition: boolean;
}

/** Baselines, calibration and personal records (docs §8, §9.2). */
@Injectable()
export class ProgressService {
  private metricCache: Map<string, MetricType> | null = null;

  async metricTypes(tx: Tx): Promise<Map<string, MetricType>> {
    if (!this.metricCache) this.metricCache = new Map((await tx.metricType.findMany()).map((m) => [m.code, m]));
    return this.metricCache;
  }

  async recordWorkout(tx: Tx, ctx: RecordContext): Promise<{ prs: PrOutcome[]; observations: Observation[] }> {
    const metrics = await this.metricTypes(tx);
    const observations = extractObservations(ctx.input, ctx.tracked, ctx.config, (code) => metrics.get(code)?.direction === 'LOWER_IS_BETTER');
    const codeOf = new Map(ctx.input.exercises.map((e) => [e.exerciseId, e.exerciseCode]));

    await tx.metricObservation.deleteMany({ where: { workoutId: ctx.workoutId } });
    await tx.metricObservation.createMany({
      data: observations.map((o) => ({
        id: uuidv7(),
        userId: ctx.userId,
        exerciseId: o.exerciseId,
        metricTypeId: metrics.get(o.metricCode)!.id,
        qualifier: o.qualifier,
        value: o.value,
        workoutId: ctx.workoutId,
        observedAt: ctx.input.performedAt,
        countsForCompetition: ctx.countsForCompetition,
      })),
    });

    const outcomes: PrOutcome[] = [];
    for (const o of observations) {
      const metric = metrics.get(o.metricCode)!;
      const baseline = o.qualifier === 0 ? await this.updateBaseline(tx, ctx, o, metric, codeOf.get(o.exerciseId)!) : null;
      const pr = await this.detectPr(tx, ctx, o, metric, baseline, codeOf.get(o.exerciseId)!);
      if (pr) outcomes.push(pr);
    }
    return { prs: outcomes, observations };
  }

  private async updateBaseline(tx: Tx, ctx: RecordContext, o: Observation, metric: MetricType, exerciseCode: string): Promise<{ row: Baseline; establishing: boolean }> {
    const key = { userId_exerciseId_metricTypeId: { userId: ctx.userId, exerciseId: o.exerciseId, metricTypeId: metric.id } };
    const current = await tx.baseline.findUnique({ where: key });
    const best = (a: number | null | undefined, b: number | null | undefined) => {
      const vals = [a, b].filter((v): v is number => v !== null && v !== undefined);
      if (!vals.length) return null;
      return metric.direction === 'HIGHER_IS_BETTER' ? Math.max(...vals) : Math.min(...vals);
    };
    const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));
    const derived = deriveExperienceLevel(exerciseCode, metric.code, o.value, ctx.bodyWeightKg, ctx.config);
    const level = (prev: ExperienceLevel | null | undefined): ExperienceLevel | null => {
      const order: ExperienceLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
      if (!derived) return prev ?? null;
      if (!prev) return derived;
      return order.indexOf(derived) > order.indexOf(prev) ? derived : prev;
    };

    if (current && current.status !== 'PROVISIONAL') {
      if (derived && level(current.experienceLevel) !== current.experienceLevel) {
        return { row: await tx.baseline.update({ where: key, data: { experienceLevel: level(current.experienceLevel) } }), establishing: false };
      }
      return { row: current, establishing: false };
    }

    // Calibration ended before the nightly job finalised this baseline: finalise it from calibration data only,
    // then score this workout normally.
    if (current && !ctx.inCalibration && ctx.calibrationOver && current.calibratedValue !== null) {
      const row = await tx.baseline.update({
        where: key,
        data: { status: 'FINAL', finalizedAt: new Date(), effectiveValue: best(num(current.declaredValue), num(current.calibratedValue))!, experienceLevel: level(current.experienceLevel) },
      });
      return { row, establishing: false };
    }

    // During calibration every log builds the baseline. After it, an exercise seen for the first time needs
    // `baseline_first_logs` sessions before improvements on it can score (docs §5.4).
    const calibrated = best(num(current?.calibratedValue), o.value)!;
    const logsCounted = (current?.logsCounted ?? 0) + 1;
    const finalNow = !ctx.inCalibration && logsCounted >= ctx.config.baseline_first_logs;
    const data = {
      calibratedValue: calibrated,
      effectiveValue: best(num(current?.declaredValue), calibrated)!,
      logsCounted,
      experienceLevel: level(current?.experienceLevel),
      status: finalNow ? ('FINAL' as const) : ('PROVISIONAL' as const),
      finalizedAt: finalNow ? new Date() : null,
    };
    const row = current
      ? await tx.baseline.update({ where: key, data })
      : await tx.baseline.create({ data: { id: uuidv7(), userId: ctx.userId, exerciseId: o.exerciseId, metricTypeId: metric.id, ...data } });
    return { row, establishing: true };
  }

  private async detectPr(
    tx: Tx,
    ctx: RecordContext,
    o: Observation,
    metric: MetricType,
    baseline: { row: Baseline; establishing: boolean } | null,
    exerciseCode: string,
  ): Promise<PrOutcome | null> {
    const current = await tx.personalRecord.findFirst({
      where: { userId: ctx.userId, exerciseId: o.exerciseId, metricTypeId: metric.id, qualifier: o.qualifier, isCurrent: true },
    });
    // A PR is awarded once per new best value; equal values earn nothing.
    if (current && !isBetter(o.value, Number(current.value), metric.direction)) return null;

    let status: PrStatus = 'CALIBRATION';
    let ratio: number | null = null;
    const reference = current ? Number(current.value) : null;
    if (!ctx.inCalibration && !baseline?.establishing && reference !== null) {
      // Max weight progresses like the estimated 1RM; use its expectation so a jump can't slip through untested.
      const expectedMetricId = metric.code === 'MAX_WEIGHT' ? ((await this.metricTypes(tx)).get('E1RM')?.id ?? metric.id) : metric.id;
      const lvl = harderLevel([ctx.declaredLevel, baseline?.row.experienceLevel], (l) => ctx.expected(l, o.exerciseId, expectedMetricId));
      const expectedPct = ctx.expected(lvl, o.exerciseId, expectedMetricId);
      if (expectedPct !== null) {
        ratio = progressRatio(improvementPct(reference, o.value, metric.direction), expectedPct);
        status = ratio > ctx.config.progress_ceiling_ratio ? 'HELD' : 'AWARDED';
      } else {
        status = 'AWARDED';
      }
    }

    // A held PR doesn't become the record until reviewed (implausible jumps never raise the bar for others).
    const becomesCurrent = status !== 'HELD';
    if (current && becomesCurrent) await tx.personalRecord.update({ where: { id: current.id }, data: { isCurrent: false } });
    const pr: PersonalRecord = await tx.personalRecord.create({
      data: {
        id: uuidv7(),
        userId: ctx.userId,
        exerciseId: o.exerciseId,
        metricTypeId: metric.id,
        qualifier: o.qualifier,
        value: o.value,
        previousValue: reference,
        workoutId: ctx.workoutId,
        status,
        isCurrent: becomesCurrent,
        achievedAt: ctx.input.performedAt,
      },
    });
    return { prId: pr.id, exerciseId: o.exerciseId, exerciseCode, metricCode: metric.code, qualifier: o.qualifier, value: o.value, previousValue: reference, status, ratio };
  }

  /** Undo the records of a workout (edit/delete): revoke them and restore the previous best as current. */
  async revokeWorkout(tx: Tx, workoutId: string): Promise<PersonalRecord[]> {
    const prs = await tx.personalRecord.findMany({ where: { workoutId, status: { not: 'REVOKED' } } });
    for (const pr of prs) {
      await tx.personalRecord.update({ where: { id: pr.id }, data: { status: 'REVOKED', isCurrent: false } });
      if (!pr.isCurrent) continue;
      const metric = [...(await this.metricTypes(tx)).values()].find((m) => m.id === pr.metricTypeId)!;
      const previous = await tx.personalRecord.findFirst({
        where: { userId: pr.userId, exerciseId: pr.exerciseId, metricTypeId: pr.metricTypeId, qualifier: pr.qualifier, status: { in: ['AWARDED', 'CALIBRATION'] }, id: { not: pr.id } },
        orderBy: { value: metric.direction === 'HIGHER_IS_BETTER' ? 'desc' : 'asc' },
      });
      if (previous) await tx.personalRecord.update({ where: { id: previous.id }, data: { isCurrent: true } });
    }
    await tx.metricObservation.deleteMany({ where: { workoutId } });
    return prs;
  }
}
