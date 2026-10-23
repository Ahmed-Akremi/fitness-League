/**
 * Organisation update, phase 8: the event timers (organizer control, judges, displays). Every screen computes the
 * time from the start timestamp and the clock (`now`), never from its own ticks, so all of them show the same.
 */

export type TimerType = 'FOR_TIME' | 'AMRAP' | 'EMOM' | 'TABATA' | 'COUNTDOWN';
export const TIMER_TYPES: TimerType[] = ['FOR_TIME', 'AMRAP', 'EMOM', 'TABATA', 'COUNTDOWN'];

/** `capSec`: For Time cap, AMRAP or countdown length. `intervalSec`, `rounds`: EMOM. `workSec`, `restSec`, `rounds`: Tabata. */
export type TimerConfig = { type: TimerType; capSec: number | null; intervalSec: number; rounds: number; workSec: number; restSec: number };
/** `pausedMs`: time spent paused before the current run; `pausedAt`: set while paused. */
export type TimerState = { config: TimerConfig; startTimestamp: string | null; pausedAt: string | null; pausedMs: number };
export type TimerStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'DONE';
export type TimerView = { status: TimerStatus; elapsedMs: number; shownMs: number; round: number | null; phase: 'WORK' | 'REST' | null };

export const defaultTimer = (): TimerConfig => ({ type: 'FOR_TIME', capSec: 600, intervalSec: 60, rounds: 8, workSec: 20, restSec: 10 });

export const timerStart = (config: TimerConfig, now: string): TimerState => ({ config, startTimestamp: now, pausedAt: null, pausedMs: 0 });
export const timerPause = (s: TimerState, now: string): TimerState => (s.startTimestamp && !s.pausedAt ? { ...s, pausedAt: now } : s);
export const timerResume = (s: TimerState, now: string): TimerState =>
  s.pausedAt ? { ...s, pausedAt: null, pausedMs: s.pausedMs + Math.max(0, Date.parse(now) - Date.parse(s.pausedAt)) } : s;

/** How long the timer runs; null: For Time without a cap runs until stopped. */
export function timerTotalMs(c: TimerConfig): number | null {
  switch (c.type) {
    case 'EMOM':
      return c.intervalSec * c.rounds * 1000;
    case 'TABATA':
      return (c.workSec + c.restSec) * c.rounds * 1000;
    default:
      return c.capSec ? c.capSec * 1000 : null;
  }
}

export function timerView(s: TimerState, now: number): TimerView {
  if (!s.startTimestamp) return { status: 'IDLE', elapsedMs: 0, shownMs: s.config.type === 'AMRAP' || s.config.type === 'COUNTDOWN' ? (s.config.capSec ?? 0) * 1000 : 0, round: null, phase: null };
  const until = s.pausedAt ? Date.parse(s.pausedAt) : now;
  const total = timerTotalMs(s.config);
  const raw = Math.max(0, until - Date.parse(s.startTimestamp) - s.pausedMs);
  const elapsedMs = total == null ? raw : Math.min(raw, total);
  const status: TimerStatus = total != null && raw >= total ? 'DONE' : s.pausedAt ? 'PAUSED' : 'RUNNING';
  const c = s.config;
  switch (c.type) {
    case 'EMOM': {
      const len = c.intervalSec * 1000;
      const i = Math.min(Math.floor(elapsedMs / len), c.rounds - 1);
      return { status, elapsedMs, shownMs: status === 'DONE' ? 0 : len * (i + 1) - elapsedMs, round: i + 1, phase: null };
    }
    case 'TABATA': {
      const len = (c.workSec + c.restSec) * 1000;
      const i = Math.min(Math.floor(elapsedMs / len), c.rounds - 1);
      const inRound = elapsedMs - i * len;
      const work = inRound < c.workSec * 1000;
      return { status, elapsedMs, shownMs: status === 'DONE' ? 0 : work ? c.workSec * 1000 - inRound : len - inRound, round: i + 1, phase: work ? 'WORK' : 'REST' };
    }
    case 'AMRAP':
    case 'COUNTDOWN':
      return { status, elapsedMs, shownMs: (total ?? 0) - elapsedMs, round: null, phase: null };
    default:
      return { status, elapsedMs, shownMs: elapsedMs, round: null, phase: null };
  }
}

/** Whole seconds to show: For Time counts up (4:05.9 shows 4:05), the others count down (0:59.1 shows 1:00). */
export const timerSeconds = (v: TimerView, type: TimerType) => (type === 'FOR_TIME' ? Math.floor(v.shownMs / 1000) : Math.ceil(v.shownMs / 1000));
