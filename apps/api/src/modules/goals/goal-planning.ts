import type { MetricDirection } from '@prisma/client';

/**
 * Pure goal maths (docs §10): milestones, ETAs and safety limits.
 * Suggestions are estimates from the expected-progression table, not medical or coaching advice.
 */

export interface Milestone {
  index: number;
  targetValue: number;
}

/** Rounding that matches how athletes think: 2.5 kg plates, 5-second steps, 0.5 kg body weight, whole reps/days. */
export function roundFor(unit: string, metricCode: string, v: number): number {
  if (metricCode === 'BODY_WEIGHT') return Math.round(v * 2) / 2;
  if (unit === 'kg') return Math.round(v / 2.5) * 2.5;
  if (unit === 's' || unit === 's_per_km') return Math.round(v / 5) * 5;
  return Math.round(v);
}

/**
 * Splits start → target into milestones of roughly one "expected month" of progress each (at least 1, at most 6),
 * so every milestone is a realistic next step. E.g. squat 100 → 120 with ~5 kg/month → 105, 110, 115, 120.
 */
export function planMilestones(start: number, target: number, monthlyStep: number, round: (v: number) => number): Milestone[] {
  const range = target - start;
  const step = Math.abs(monthlyStep) > 0 ? Math.abs(monthlyStep) : Math.abs(range);
  const n = Math.min(6, Math.max(1, Math.ceil(Math.abs(range) / step - 1e-9)));
  const out: Milestone[] = [];
  for (let i = 1; i <= n; i++) {
    const value = i === n ? target : round(start + (range * i) / n);
    if (!out.length || value !== out[out.length - 1]!.targetValue) out.push({ index: out.length, targetValue: value });
  }
  return out;
}

export function reached(value: number, milestone: number, direction: MetricDirection): boolean {
  return direction === 'HIGHER_IS_BETTER' ? value >= milestone : value <= milestone;
}

/**
 * Weeks needed to go from start to target at a given % per 28 days (compounded weekly).
 * Returns null when the rate is zero.
 */
export function weeksAtRate(start: number, target: number, pctPer28Days: number, direction: MetricDirection): number | null {
  if (!(pctPer28Days > 0) || !(start > 0) || !(target > 0)) return null;
  const weekly = pctPer28Days / 100 / 4;
  const ratio = direction === 'HIGHER_IS_BETTER' ? target / start : start / target;
  if (ratio <= 1) return 0;
  return Math.ceil(Math.log(ratio) / Math.log(1 + weekly));
}

export interface Suggestion {
  horizon: 'SHORT' | 'MEDIUM' | 'LONG';
  targetValue: number;
  etaWeeks: { min: number; max: number };
}

/**
 * Three realistic targets. The slow bound assumes the expected rate for the athlete's level, the fast bound
 * 1.5× that rate (the reward cap). E.g. squat 80 kg, beginner (8 %/month) → ~90 kg in about 5–8 weeks.
 */
export function suggestTargets(current: number, expectedPct: number, direction: MetricDirection, round: (v: number) => number): Suggestion[] {
  const horizons: [Suggestion['horizon'], number][] = [
    ['SHORT', 4],
    ['MEDIUM', 10],
    ['LONG', 20],
  ];
  const seen = new Set<number>();
  const out: Suggestion[] = [];
  for (const [horizon, weeks] of horizons) {
    const factor = Math.pow(1 + expectedPct / 100 / 4, weeks);
    const raw = direction === 'HIGHER_IS_BETTER' ? current * factor : current / factor;
    const targetValue = round(raw);
    if (targetValue === round(current) || seen.has(targetValue)) continue;
    seen.add(targetValue);
    const slow = weeksAtRate(current, targetValue, expectedPct, direction) ?? weeks;
    const fast = weeksAtRate(current, targetValue, expectedPct * 1.5, direction) ?? weeks;
    out.push({ horizon, targetValue, etaWeeks: { min: Math.max(1, fast), max: Math.max(1, slow) } });
  }
  return out;
}

/** Earliest safe date for a body-weight change at `maxPctPerWeek` of the starting weight (docs §5). */
export function safeWeightWeeks(startKg: number, targetKg: number, maxPctPerWeek: number): number {
  return Math.ceil(Math.abs(targetKg - startKg) / ((startKg * maxPctPerWeek) / 100));
}

/** Body-weight change credited toward rewards: faster-than-safe change earns nothing extra. */
export function creditedWeightChange(actualChangeKg: number, startKg: number, weeksElapsed: number, maxPctPerWeek: number): number {
  const cap = ((startKg * maxPctPerWeek) / 100) * Math.max(0, weeksElapsed);
  return Math.sign(actualChangeKg) * Math.min(Math.abs(actualChangeKg), cap);
}
