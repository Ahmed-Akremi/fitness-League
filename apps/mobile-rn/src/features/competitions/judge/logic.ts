import type { Json } from '../../../core/api/client';
import { formatDuration } from '../../../core/utils/format';

/** What the scoring screen shows for a WOD's score type (spec 2026-10-21, « Floor judging »). */
export type ScoringKind = 'time' | 'reps' | 'rounds' | 'movements' | 'value';

export function scoringKind(scoreType: string): ScoringKind {
  switch (scoreType) {
    case 'TIME':
      return 'time';
    case 'REPS':
      return 'reps';
    case 'ROUNDS_REPS':
      return 'rounds';
    case 'MOVEMENT_REPS':
      return 'movements';
    default:
      return 'value';
  }
}

/** Everything the judge counts on the floor; the raw score is derived from it. */
export interface Tally {
  /** For Time: the athlete's time, set by « FINI » or typed. */
  timeS: number | null;
  /** For Time: the cap was reached, `reps` holds the reps done. */
  capped: boolean;
  reps: number;
  rounds: number;
  repsPerRound: string;
  movementReps: number[];
  value: string;
  tieBreakS: number | null;
  noReps: number;
}

export function emptyTally(movements = 0): Tally {
  return { timeS: null, capped: false, reps: 0, rounds: 0, repsPerRound: '', movementReps: Array.from({ length: movements }, () => 0), value: '', tieBreakS: null, noReps: 0 };
}

/** Back from a score already sent (correction): the counters start where the judge left them. */
export function tallyFromRaw(raw: Json | null | undefined, movements = 0): Tally {
  const t = emptyTally(movements);
  if (!raw) return t;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    ...t,
    timeS: num(raw.timeS),
    capped: raw.capped === true,
    reps: num(raw.reps) ?? 0,
    rounds: num(raw.rounds) ?? 0,
    repsPerRound: num(raw.repsPerRound) != null ? String(raw.repsPerRound) : '',
    movementReps: Array.isArray(raw.movementReps) && raw.movementReps.length === movements ? raw.movementReps.map((r: unknown) => num(r) ?? 0) : t.movementReps,
    value: num(raw.value) != null ? String(raw.value) : '',
    tieBreakS: num(raw.tieBreakS),
    noReps: num(raw.noReps) ?? 0,
  };
}

const decimal = (s: string) => {
  const v = Number(s.trim().replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(v) && v >= 0 ? v : null;
};

/** The body's `raw` (same shapes as the athlete form, plus tie-break and no-reps); null until it is complete. */
export function rawScore(scoreType: string, t: Tally): Json | null {
  const extras = { ...(t.tieBreakS != null ? { tieBreakS: t.tieBreakS } : {}), ...(t.noReps > 0 ? { noReps: t.noReps } : {}) };
  switch (scoringKind(scoreType)) {
    case 'time':
      if (t.capped) return { capped: true, reps: t.reps, ...extras };
      return t.timeS != null && t.timeS > 0 ? { timeS: t.timeS, ...extras } : null;
    case 'reps':
      return { reps: t.reps, ...extras };
    case 'rounds': {
      const per = decimal(t.repsPerRound);
      return per != null && per > 0 && Number.isInteger(per) ? { rounds: t.rounds, reps: t.reps, repsPerRound: per, ...extras } : null;
    }
    case 'movements':
      return t.movementReps.length > 0 ? { movementReps: t.movementReps, ...extras } : null;
    default: {
      const v = decimal(t.value);
      return v == null ? null : { value: v, ...extras };
    }
  }
}

/** Σ reps × points per rep, rounded to the cent: the server's formula for movement-scored WODs. */
export function movementPoints(movements: { pointsPerRep: number }[], reps: number[]): number {
  return Math.round(movements.reduce((sum, m, i) => sum + m.pointsPerRep * (reps[i] ?? 0), 0) * 100) / 100;
}

/** Elapsed time of a heat on the server's clock: `offsetMs` = server time − phone time when the server answered. */
export function elapsedMs(startedAt: string | null | undefined, offsetMs: number, now = Date.now()): number | null {
  if (!startedAt) return null;
  return Math.max(0, now + offsetMs - new Date(startedAt).getTime());
}

/** 245_300 ms → "4:05.3": the floor clock shows tenths. */
export function formatClock(ms: number): string {
  const tenths = Math.floor(ms / 100);
  return `${formatDuration(Math.floor(tenths / 10))}.${tenths % 10}`;
}

/** Whole seconds, as scorecards record them: 245.9 s → 245. */
export const wholeSeconds = (ms: number) => Math.floor(ms / 1000);

/** The heats a judge sees, the next ones first: a heat not scored yet before the scored ones. */
export function laneOrder(lanes: Json[]): Json[] {
  const at = (l: Json) => (l.heat.startsAt ? new Date(l.heat.startsAt).getTime() : Infinity);
  return [...lanes].sort((a, b) => Number(a.score != null) - Number(b.score != null) || at(a) - at(b) || a.heat.number - b.heat.number);
}
