import type { ExperienceLevel, MetricDirection } from '@prisma/client';
import type { RuleSetConfig } from '../rule-set.schema';

/**
 * The fairness model (docs §5, §9.3): progress is measured against what is *expected* for the athlete's
 * level, so a beginner's +8 % and an advanced athlete's +1 % can be worth the same.
 */

/** Signed relative improvement, oriented so that "better" is positive whatever the metric direction. */
export function improvementPct(reference: number, current: number, direction: MetricDirection): number {
  if (!(reference > 0)) return 0;
  const delta = direction === 'HIGHER_IS_BETTER' ? current - reference : reference - current;
  return (delta / reference) * 100;
}

export function isBetter(candidate: number, record: number, direction: MetricDirection): boolean {
  return direction === 'HIGHER_IS_BETTER' ? candidate > record : candidate < record;
}

export function progressRatio(improvement: number, expectedPct: number): number {
  if (!(expectedPct > 0)) return 0;
  return Math.max(0, improvement) / expectedPct;
}

/** 0–100 score of one metric; ratios above the reward cap earn nothing more. */
export function metricProgressScore(ratio: number, rewardCap: number): number {
  return (Math.min(Math.max(ratio, 0), rewardCap) / rewardCap) * 100;
}

/** Mean of the N best values (0 when there is nothing to score). */
export function topNMean(values: number[], n: number): number {
  if (!values.length) return 0;
  const top = [...values].sort((a, b) => b - a).slice(0, n);
  return top.reduce((s, v) => s + v, 0) / top.length;
}

/** Training more than planned earns nothing extra: rest days are part of the plan (docs §5 safety). */
export function consistencyComponent(trainingDays: number, plannedDays: number): number {
  if (!(plannedDays > 0)) return 0;
  return Math.min(1, trainingDays / plannedDays) * 100;
}

/** How close this week's best is to the all-time best, per metric (1 = at or above the record). */
export function performanceRatio(weekBest: number, allTimeBest: number, direction: MetricDirection): number {
  if (!(weekBest > 0) || !(allTimeBest > 0)) return 0;
  const r = direction === 'HIGHER_IS_BETTER' ? weekBest / allTimeBest : allTimeBest / weekBest;
  return Math.min(1, r);
}

export interface Components {
  progress: number;
  consistency: number;
  performance: number;
  /** null while challenges don't exist (Phase 1): the other weights are renormalised. */
  challenge: number | null;
}

export function weightedTotal(c: Components, w: RuleSetConfig['lp_weights']): number {
  const parts: [number, number][] = [
    [c.progress, w.progress],
    [c.consistency, w.consistency],
    [c.performance, w.performance],
  ];
  if (c.challenge !== null) parts.push([c.challenge, w.challenge]);
  const weightSum = parts.reduce((s, [, wt]) => s + wt, 0);
  if (!(weightSum > 0)) return 0;
  return parts.reduce((s, [v, wt]) => s + v * wt, 0) / weightSum;
}

const ORDER: ExperienceLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];

/**
 * Level from performance standards. Uses the body-weight ratio when the weight is known, absolute kg otherwise.
 * Returns null when no standard exists for that exercise/metric.
 */
export function deriveExperienceLevel(
  exerciseCode: string,
  metricCode: string,
  bestValue: number,
  bodyWeightKg: number | null,
  config: Pick<RuleSetConfig, 'strength_standards' | 'running_standards'>,
): ExperienceLevel | null {
  if (metricCode === 'E1RM' || metricCode === 'MAX_WEIGHT') {
    const std = config.strength_standards[exerciseCode];
    if (!std) return null;
    const [value, t] = bodyWeightKg ? [bestValue / bodyWeightKg, std.bwRatio] : [bestValue, std.absoluteKg];
    return value >= t.advanced ? 'ADVANCED' : value >= t.intermediate ? 'INTERMEDIATE' : 'BEGINNER';
  }
  const run = config.running_standards[metricCode];
  if (run) return bestValue <= run.advanced ? 'ADVANCED' : bestValue <= run.intermediate ? 'INTERMEDIATE' : 'BEGINNER';
  return null;
}

/**
 * Anti-sandbagging in the other direction (docs §5.4): declaring yourself "advanced" lowers the expected
 * improvement and would inflate your ratio. So the engine uses whichever level expects MORE improvement.
 */
export function harderLevel(
  candidates: (ExperienceLevel | null | undefined)[],
  expectedPctFor: (level: ExperienceLevel) => number | null,
): ExperienceLevel {
  const levels = candidates.filter((l): l is ExperienceLevel => !!l);
  if (!levels.length) return 'BEGINNER';
  return levels.reduce((best, l) => ((expectedPctFor(l) ?? 0) > (expectedPctFor(best) ?? 0) ? l : best));
}

export function levelIndex(l: ExperienceLevel): number {
  return ORDER.indexOf(l);
}
