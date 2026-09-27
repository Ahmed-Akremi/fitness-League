import type { RuleSetConfig } from '../scoring/rule-set.schema';
import { estimate1rm, WorkoutInput, workingSets } from '../workouts/workout-metrics';

/**
 * Layer 1 anti-cheat (docs §7): deterministic rules on a single workout plus a little history.
 * HARD = physically impossible or a duplicate → REJECTED. SOFT = possible but exceptional → HELD_FOR_REVIEW.
 * INFO = recorded for scoring, never blocks (e.g. late logging).
 */
export type Severity = 'INFO' | 'SOFT' | 'HARD';

export interface RuleHit {
  rule: string;
  severity: Severity;
  value?: number;
  threshold?: number;
  exerciseIndex?: number;
  setIndex?: number;
}

export interface EvaluationContext {
  now: Date;
  deviceSubmittedAt?: Date | null;
  /** Latest body weight, if the user shared it (health consent). */
  bodyWeightKg: number | null;
  /** Other (non-rejected, non-deleted) workouts of the user on the same local day. */
  workoutsSameDay: number;
  /** Other workouts whose time range overlaps this one, with their fingerprints. */
  overlapping: { fingerprintHex: string }[];
  /** Workouts with an identical fingerprint in the look-back window (excluding this one). */
  identicalRecent: number;
  fingerprintHex: string;
}

export interface Evaluation {
  outcome: 'ACCEPTED' | 'HELD_FOR_REVIEW' | 'REJECTED';
  hits: RuleHit[];
  confidence: number;
  /** False when logged too late to count for points (history and progress charts only). */
  countsForCompetition: boolean;
}

type AnticheatRules = RuleSetConfig['anticheat'];
/** Per-exercise bounds from the catalog: loads (kg), finish times (s), AMRAP totals (reps). */
export type Plausibility = { hold_kg?: number; reject_kg?: number; hold_s?: number; reject_s?: number; hold_reps?: number; reject_reps?: number };
type Limits = { hold: number; reject: number };

const LIFTS = ['BACK_SQUAT', 'BENCH_PRESS', 'DEADLIFT'] as const;
/** Back-to-back sessions may touch; only overlaps longer than this count. */
export const OVERLAP_TOLERANCE_MS = 5 * 60_000;

/** Higher-is-suspicious check (loads, distances, speeds). */
function above(rule: string, value: number, limits: Limits, extra: Partial<RuleHit> = {}): RuleHit | null {
  if (value > limits.reject) return { rule, severity: 'HARD', value, threshold: limits.reject, ...extra };
  if (value > limits.hold) return { rule, severity: 'SOFT', value, threshold: limits.hold, ...extra };
  return null;
}

/** Lower-is-suspicious check (paces, race times). */
function below(rule: string, value: number, limits: Limits, extra: Partial<RuleHit> = {}): RuleHit | null {
  if (value < limits.reject) return { rule, severity: 'HARD', value, threshold: limits.reject, ...extra };
  if (value < limits.hold) return { rule, severity: 'SOFT', value, threshold: limits.hold, ...extra };
  return null;
}

export function evaluateWorkout(
  w: WorkoutInput,
  ctx: EvaluationContext,
  config: Pick<RuleSetConfig, 'anticheat' | 'late_log_max_hours' | 'e1rm_formula' | 'e1rm_max_reps'>,
  plausibility: (exerciseCode: string) => Plausibility,
): Evaluation {
  const r = config.anticheat;
  const hits: (RuleHit | null)[] = [];

  // Time
  const futureMs = w.performedAt.getTime() - ctx.now.getTime();
  if (futureMs > r.future_skew_max_min * 60_000) hits.push({ rule: 'PERFORMED_IN_FUTURE', severity: 'HARD', value: Math.round(futureMs / 60_000), threshold: r.future_skew_max_min });
  if (ctx.deviceSubmittedAt) {
    const skewH = Math.abs(ctx.deviceSubmittedAt.getTime() - ctx.now.getTime()) / 3_600_000;
    if (skewH > r.clock_skew_hold_hours) hits.push({ rule: 'CLOCK_SKEW', severity: 'SOFT', value: Math.round(skewH), threshold: r.clock_skew_hold_hours });
  }
  const lateH = (ctx.now.getTime() - w.performedAt.getTime()) / 3_600_000;
  const late = lateH > config.late_log_max_hours;
  if (late) hits.push({ rule: 'LATE_LOG', severity: 'INFO', value: Math.round(lateH), threshold: config.late_log_max_hours });

  // Workout shape
  hits.push(above('WORKOUT_DURATION', w.durationS / 3600, r.workout_duration_h));
  const setCount = w.exercises.reduce((n, e) => n + e.sets.length, 0);
  hits.push(above('SETS_PER_WORKOUT', setCount, r.sets_per_workout));

  w.exercises.forEach((ex, exerciseIndex) => {
    const p = plausibility(ex.exerciseCode);
    ex.sets.forEach((s, setIndex) => {
      // AMRAP totals (e.g. Cindy) are judged by their own bounds below, not the per-set rep limit.
      if (s.reps != null && !p.hold_reps) {
        const limits = ex.isBodyweight || !s.weightKg ? r.reps_bodyweight : r.reps_weighted;
        hits.push(above('REPS_PER_SET', s.reps, limits, { exerciseIndex, setIndex }));
      }
    });
    hits.push(...strengthHits(ex, exerciseIndex, ctx.bodyWeightKg, r, config, plausibility));
    hits.push(...cardioHits(ex, exerciseIndex, w, r));
    hits.push(...timedHits(ex, exerciseIndex, p));
  });

  // History
  if (ctx.overlapping.length) {
    const duplicate = ctx.overlapping.some((o) => o.fingerprintHex === ctx.fingerprintHex);
    hits.push({ rule: duplicate ? 'DUPLICATE_WORKOUT' : 'OVERLAPPING_WORKOUT', severity: 'HARD', value: ctx.overlapping.length });
  }
  if (ctx.workoutsSameDay >= r.workouts_per_day_hold) {
    hits.push({ rule: 'WORKOUTS_PER_DAY', severity: 'SOFT', value: ctx.workoutsSameDay + 1, threshold: r.workouts_per_day_hold });
  }
  if (ctx.identicalRecent + 1 >= r.identical_fingerprint_hold.count) {
    hits.push({ rule: 'REPEATED_IDENTICAL_WORKOUT', severity: 'SOFT', value: ctx.identicalRecent + 1, threshold: r.identical_fingerprint_hold.count });
  }

  const found = hits.filter((h): h is RuleHit => h !== null);
  const outcome = found.some((h) => h.severity === 'HARD') ? 'REJECTED' : found.some((h) => h.severity === 'SOFT') ? 'HELD_FOR_REVIEW' : 'ACCEPTED';
  return {
    outcome,
    hits: found,
    confidence: outcome === 'REJECTED' ? 0.99 : outcome === 'HELD_FOR_REVIEW' ? 0.6 : 0,
    countsForCompetition: !late,
  };
}

function strengthHits(
  ex: WorkoutInput['exercises'][number],
  exerciseIndex: number,
  bodyWeightKg: number | null,
  r: AnticheatRules,
  config: Pick<RuleSetConfig, 'e1rm_formula' | 'e1rm_max_reps'>,
  plausibility: (exerciseCode: string) => Plausibility,
): (RuleHit | null)[] {
  const sets = workingSets(ex.sets).filter((s) => (s.weightKg ?? 0) > 0);
  if (!sets.length) return [];
  // Heaviest load actually moved, and best e1RM when the rep range makes it meaningful.
  const maxLoad = Math.max(...sets.map((s) => s.weightKg!));
  const bestE1rm = Math.max(maxLoad, ...sets.map((s) => estimate1rm(s.weightKg!, s.reps ?? 0, config.e1rm_formula, config.e1rm_max_reps) ?? 0));

  const lift = (LIFTS as readonly string[]).includes(ex.exerciseCode) ? r.lifts[ex.exerciseCode as (typeof LIFTS)[number]] : null;
  if (lift) {
    const out = [above('LIFT_ABSOLUTE_KG', bestE1rm, lift.absoluteKg, { exerciseIndex })];
    if (bodyWeightKg) out.push(above('LIFT_BODYWEIGHT_RATIO', Math.round((bestE1rm / bodyWeightKg) * 100) / 100, lift.bwRatio, { exerciseIndex }));
    return out;
  }
  const p = plausibility(ex.exerciseCode);
  if (p.hold_kg && p.reject_kg) return [above('LOAD_KG', maxLoad, { hold: p.hold_kg, reject: p.reject_kg }, { exerciseIndex })];
  return [];
}

/** Finish times (lower is suspicious) and AMRAP totals (higher is suspicious) against the exercise's bounds. */
function timedHits(ex: WorkoutInput['exercises'][number], exerciseIndex: number, p: Plausibility): (RuleHit | null)[] {
  const out: (RuleHit | null)[] = [];
  ex.sets.forEach((s, setIndex) => {
    if (p.hold_s && p.reject_s && s.durationS) out.push(below('FINISH_TIME_S', s.durationS, { hold: p.hold_s, reject: p.reject_s }, { exerciseIndex, setIndex }));
    if (p.hold_reps && p.reject_reps && s.reps != null) out.push(above('WOD_TOTAL_REPS', s.reps, { hold: p.hold_reps, reject: p.reject_reps }, { exerciseIndex, setIndex }));
  });
  return out;
}

function cardioHits(ex: WorkoutInput['exercises'][number], exerciseIndex: number, w: WorkoutInput, r: AnticheatRules): (RuleHit | null)[] {
  const out: (RuleHit | null)[] = [];
  const single = w.exercises.length === 1 && ex.sets.length === 1;
  let distance = 0;

  ex.sets.forEach((s, setIndex) => {
    if (!s.distanceM) return;
    distance += s.distanceM;
    // A lone cardio set without its own duration takes the workout duration.
    const duration = s.durationS ?? (single ? w.durationS : null);
    if (!duration) return;
    const km = s.distanceM / 1000;
    const kmh = km / (duration / 3600);
    const at = { exerciseIndex, setIndex };

    switch (ex.exerciseCode) {
      case 'RUN':
        if (s.distanceM >= 1000) out.push(below('RUN_PACE', Math.round(duration / km), r.run_pace_s_per_km, at));
        for (const [metric, meters] of [['TIME_5K', 5000], ['TIME_10K', 10000], ['TIME_21K', 21097]] as const) {
          if (s.distanceM >= meters) out.push(below(`RUN_${metric}`, Math.round((duration / s.distanceM) * meters), r.run_time_s[metric], at));
        }
        break;
      case 'RIDE':
        out.push(above('RIDE_SPEED', Math.round(kmh * 10) / 10, r.ride_speed_kmh, at));
        break;
      case 'WALK':
        out.push(above('WALK_SPEED', Math.round(kmh * 10) / 10, r.walk_speed_kmh, at));
        break;
      case 'SWIM_FREESTYLE':
        if (s.distanceM >= 200) out.push(below('SWIM_PACE', Math.round(duration / (s.distanceM / 100)), r.swim_pace_s_per_100m, at));
        break;
    }
  });

  if (ex.exerciseCode === 'RUN') out.push(above('RUN_DISTANCE', distance, r.run_distance_m, { exerciseIndex }));
  if (ex.exerciseCode === 'RIDE') out.push(above('RIDE_DISTANCE', distance, r.ride_distance_m, { exerciseIndex }));
  return out;
}
