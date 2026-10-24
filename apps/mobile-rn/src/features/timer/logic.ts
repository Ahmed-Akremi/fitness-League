import { timerTotalMs, timerView, type TimerConfig, type TimerState, type TimerView } from '../competitions/organizer/logic-timer';

/**
 * The athlete's own workout timer (Circle21 §3.18): the event timers' maths (`logic-timer.ts`) with a countdown
 * before the start, the share of the workout done (the ring) and the last ten seconds of each part (the warning).
 */

export const COUNTDOWN_SEC = 10;
export type SetupProblem = 'LENGTH' | 'ROUNDS';

/** Circle21's setup errors: « Timer length can't be 00:00 », « You must enter number of rounds ». */
export function setupProblems(c: TimerConfig): SetupProblem[] {
  const out: SetupProblem[] = [];
  if (c.type === 'AMRAP' && !(c.capSec && c.capSec > 0)) out.push('LENGTH');
  if (c.type === 'EMOM' && !(c.intervalSec > 0)) out.push('LENGTH');
  if (c.type === 'TABATA' && !(c.workSec > 0)) out.push('LENGTH');
  if ((c.type === 'EMOM' || c.type === 'TABATA') && !(Number.isInteger(c.rounds) && c.rounds >= 1)) out.push('ROUNDS');
  return out;
}

export type Phase = { kind: 'COUNTDOWN'; seconds: number } | { kind: 'TIMER'; view: TimerView };

/** The timer starts `COUNTDOWN_SEC` after « Set timer »: before that, the seconds left to get ready. */
export function phaseOf(s: TimerState, nowMs: number): Phase {
  if (s.startTimestamp && !s.pausedAt && nowMs < Date.parse(s.startTimestamp)) return { kind: 'COUNTDOWN', seconds: Math.ceil((Date.parse(s.startTimestamp) - nowMs) / 1000) };
  return { kind: 'TIMER', view: timerView(s, nowMs) };
}

/**
 * 0 → 1 around the ring: each interval of an EMOM, each work or rest of a Tabata, otherwise the whole workout; For
 * Time without a cap goes round once a minute.
 */
export function progressOf(c: TimerConfig, v: TimerView): number {
  if (v.status === 'DONE') return 1;
  const part = c.type === 'EMOM' ? c.intervalSec * 1000 : c.type === 'TABATA' ? (v.phase === 'REST' ? c.restSec : c.workSec) * 1000 : 0;
  if (part > 0) return Math.min(1, Math.max(0, 1 - v.shownMs / part));
  const total = timerTotalMs(c);
  if (total == null) return (v.elapsedMs % 60_000) / 60_000;
  return total > 0 ? Math.min(1, v.elapsedMs / total) : 0;
}

/** The last ten seconds of a countdown (an AMRAP, an EMOM minute, a Tabata work or rest), or of a capped For Time. */
export function lastTen(c: TimerConfig, v: TimerView): boolean {
  if (v.status !== 'RUNNING') return false;
  if (c.type === 'FOR_TIME') {
    const total = timerTotalMs(c);
    return total != null && total - v.elapsedMs <= 10_000;
  }
  return v.shownMs <= 10_000;
}
