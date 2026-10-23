import type { Scorecard } from '../organizer/logic-scorecard';

/**
 * Organisation update, phase 8: floor judging driven by the WOD's scorecard. The judge taps reps; the screen shows
 * where the athlete is (set, round, movement) and steps by the movement's « count every ».
 */

export type ScorecardCursor = {
  set: number;
  /** 1-based. */
  round: number;
  move: number;
  name: string;
  unit: string;
  step: number;
  moveReps: number;
  moveTarget: number;
  total: number;
  done: boolean;
};

type Segment = { set: number; round: number; move: number; name: string; unit: string; step: number; start: number; end: number };

/** Each movement of each round, in order, with its rep range [start, end). */
function segments(sc: Scorecard): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  sc.sets.forEach((s, set) => {
    for (let round = 1; round <= s.rounds; round++) {
      s.movements.forEach((m, move) => {
        const reps = m.reps + s.increment * (round - 1);
        out.push({ set, round, move, name: m.name, unit: m.unit, step: Math.max(1, m.countEvery), start: at, end: at + reps });
        at += reps;
      });
    }
  });
  return out;
}

const view = (g: Segment, reps: number, total: number, done: boolean): ScorecardCursor => ({
  set: g.set,
  round: g.round,
  move: g.move,
  name: g.name,
  unit: g.unit,
  step: g.step,
  moveReps: Math.min(reps, g.end) - g.start,
  moveTarget: g.end - g.start,
  total,
  done,
});

export function scorecardCursor(sc: Scorecard, reps: number): ScorecardCursor | null {
  const all = segments(sc);
  if (!all.length) return null;
  const total = all[all.length - 1].end;
  const g = all.find((x) => reps < x.end);
  return g ? view(g, reps, total, false) : view(all[all.length - 1], total, total, true);
}

/** One tap: `step` reps more, never past the end of the current movement. */
export function tapNext(sc: Scorecard, reps: number): number {
  const g = segments(sc).find((x) => reps < x.end);
  return g ? Math.min(reps + g.step, g.end) : reps;
}

/** One tap back, inside the movement that holds the last counted rep. */
export function tapBack(sc: Scorecard, reps: number): number {
  if (reps <= 0) return 0;
  const g = segments(sc).find((x) => reps - 1 < x.end);
  return g ? Math.max(g.start, reps - g.step) : reps - 1;
}

/** The rep count at the end of the tie-break set; null without a tie-break. */
export function tieBreakReps(sc: Scorecard): number | null {
  if (sc.tieBreakAfterSet == null) return null;
  const last = segments(sc).filter((g) => g.set < sc.tieBreakAfterSet!);
  return last.length ? last[last.length - 1].end : null;
}
