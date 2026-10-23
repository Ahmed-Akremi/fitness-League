import type { Json } from '../../../core/api/client';

/**
 * Organisation update, phase 6: a WOD's scorecard (what the judge counts), its penalties and its tie-break. Kept on
 * the device per WOD for now (`workoutFields` in `core/api/org-local.ts`); the judge screens of phase 8 read them.
 */

export type ScMove = { name: string; reps: number; unit: string; countEvery: number };
export type ScSet = { name: string; rounds: number; increment: number; movements: ScMove[] };
/** `tieBreakAfterSet`: the judge records a tie-break time when this set (1-based) is done; null: no tie-break. */
export type Scorecard = { sets: ScSet[]; tieBreakAfterSet: number | null };
export type ScorecardProblem = 'ROUNDS' | 'SET_EMPTY' | 'MOVEMENT' | 'COUNT_EVERY' | 'TIE_BREAK';

export type Penalties = { noRepSeconds: number; missedRepSeconds: number; minorPct: number; majorPct: number };
export type TieBreak = 'NONE' | 'TIME' | 'REPS';

export const scorecardOf = (w: Json): Scorecard => ({ sets: Array.isArray(w.scorecard?.sets) ? w.scorecard.sets : [], tieBreakAfterSet: w.scorecard?.tieBreakAfterSet ?? null });
export const penaltiesOf = (w: Json): Penalties => ({ noRepSeconds: 0, missedRepSeconds: 0, minorPct: 0, majorPct: 0, ...(w.penalties ?? {}) });
export const tieBreakOf = (w: Json): TieBreak => (w.tieBreak === 'TIME' || w.tieBreak === 'REPS' ? w.tieBreak : 'NONE');

/** Reps of a set: every round adds `increment` to each movement. */
export function setTotal(s: ScSet): number {
  const base = s.movements.reduce((n, m) => n + m.reps, 0);
  return s.rounds * base + s.increment * s.movements.length * ((s.rounds * (s.rounds - 1)) / 2);
}

export const scorecardTotal = (sc: Scorecard) => sc.sets.reduce((n, s) => n + setTotal(s), 0);

/** One tap counts `countEvery` reps (a 500 m row counted every 50 m is 10 taps). */
export const tapSteps = (m: ScMove) => Math.ceil(m.reps / Math.max(1, m.countEvery));

export function scorecardProblems(sc: Scorecard): ScorecardProblem[] {
  const found: ScorecardProblem[] = [];
  const add = (p: ScorecardProblem) => !found.includes(p) && found.push(p);
  for (const s of sc.sets) {
    if (!(Number.isInteger(s.rounds) && s.rounds >= 1)) add('ROUNDS');
    if (!s.movements.length) add('SET_EMPTY');
    for (const m of s.movements) {
      if (!m.name.trim() || !(m.reps >= 1)) add('MOVEMENT');
      if (!(m.countEvery >= 1) || m.countEvery > m.reps) add('COUNT_EVERY');
    }
  }
  if (sc.tieBreakAfterSet != null && !(sc.tieBreakAfterSet >= 1 && sc.tieBreakAfterSet <= sc.sets.length)) add('TIE_BREAK');
  return found;
}
