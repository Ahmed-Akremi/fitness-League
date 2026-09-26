import { createHash } from 'node:crypto';

/** Normalised workout used by metrics, anti-cheat and scoring (all SI units). */
export interface WorkoutInput {
  sportId: string;
  workoutType: string;
  performedAt: Date;
  durationS: number;
  exercises: {
    exerciseId: string;
    exerciseCode: string;
    isBodyweight: boolean;
    sets: SetInput[];
  }[];
}

export interface SetInput {
  reps?: number | null;
  weightKg?: number | null;
  distanceM?: number | null;
  durationS?: number | null;
  isWarmup?: boolean;
  rpe?: number | null;
}

export type E1rmFormula = 'EPLEY' | 'BRZYCKI';

/**
 * Estimated one-rep max. Only for 1..maxReps reps: both formulas drift badly on high-rep sets.
 * Epley: w × (1 + r/30). Brzycki: w × 36 / (37 − r). A single rep is the weight itself.
 */
export function estimate1rm(weightKg: number, reps: number, formula: E1rmFormula, maxReps: number): number | null {
  if (!(weightKg > 0) || !Number.isInteger(reps) || reps < 1 || reps > maxReps) return null;
  if (reps === 1) return round2(weightKg);
  return round2(formula === 'EPLEY' ? weightKg * (1 + reps / 30) : (weightKg * 36) / (37 - reps));
}

export function workingSets(sets: SetInput[]): SetInput[] {
  return sets.filter((s) => !s.isWarmup);
}

/** Σ reps × weight over working sets. */
export function totalVolumeKg(input: WorkoutInput): number {
  let volume = 0;
  for (const ex of input.exercises) for (const s of workingSets(ex.sets)) volume += (s.reps ?? 0) * (s.weightKg ?? 0);
  return round2(volume);
}

export function totalDistanceM(input: WorkoutInput): number {
  let d = 0;
  for (const ex of input.exercises) for (const s of ex.sets) d += s.distanceM ?? 0;
  return d;
}

/**
 * Content fingerprint (time excluded): the same sets logged twice produce the same fingerprint.
 * Used for near-duplicate and "identical repeated workout" detection (docs §7).
 */
export function fingerprint(input: WorkoutInput): Buffer {
  const content = input.exercises.map((ex) => [
    ex.exerciseId,
    ex.sets.map((s) => [s.reps ?? null, s.weightKg ?? null, s.distanceM ?? null, s.durationS ?? null, s.isWarmup ?? false]),
  ]);
  return createHash('sha256').update(JSON.stringify([input.sportId, content])).digest();
}

/** Stable hash of a request payload, independent of key order (idempotent replay vs conflict). */
export function canonicalHash(payload: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(payload)).digest();
}

function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonicalJson(val)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
