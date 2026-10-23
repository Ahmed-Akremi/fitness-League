import { timerPause, timerResume, timerSeconds, timerStart, timerView, type TimerConfig } from '../../src/features/competitions/organizer/logic-timer';

const T = Date.parse('2026-12-12T09:00:00.000Z');
const at = (s: number) => T + s * 1000;
const iso = (s: number) => new Date(at(s)).toISOString();
const cfg = (over: Partial<TimerConfig>): TimerConfig => ({ type: 'FOR_TIME', capSec: null, intervalSec: 60, rounds: 8, workSec: 20, restSec: 10, ...over });

describe('timers (computed from the start timestamp, never from local ticks)', () => {
  it('waits until it is started', () => {
    expect(timerView({ config: cfg({}), startTimestamp: null, pausedAt: null, pausedMs: 0 }, at(10)).status).toBe('IDLE');
  });

  it('counts For Time up to its cap', () => {
    const s = timerStart(cfg({ capSec: 600 }), iso(0));
    expect(timerView(s, at(65))).toMatchObject({ status: 'RUNNING', shownMs: 65_000 });
    expect(timerView(s, at(700))).toMatchObject({ status: 'DONE', shownMs: 600_000 });
  });

  it('counts AMRAP and countdown down', () => {
    expect(timerView(timerStart(cfg({ type: 'AMRAP', capSec: 720 }), iso(0)), at(20)).shownMs).toBe(700_000);
    expect(timerView(timerStart(cfg({ type: 'COUNTDOWN', capSec: 60 }), iso(0)), at(61)).status).toBe('DONE');
  });

  it('shows the round and what is left of the minute in an EMOM', () => {
    expect(timerView(timerStart(cfg({ type: 'EMOM', intervalSec: 60, rounds: 10 }), iso(0)), at(125))).toMatchObject({ round: 3, shownMs: 55_000 });
  });

  it('alternates work and rest in a Tabata', () => {
    const s = timerStart(cfg({ type: 'TABATA' }), iso(0));
    expect(timerView(s, at(25))).toMatchObject({ round: 1, phase: 'REST', shownMs: 5_000 });
    expect(timerView(s, at(31))).toMatchObject({ round: 2, phase: 'WORK', shownMs: 19_000 });
    expect(timerView(s, at(240)).status).toBe('DONE');
  });

  it('rounds the seconds shown: down when counting up, up when counting down', () => {
    expect(timerSeconds({ status: 'RUNNING', elapsedMs: 65_900, shownMs: 65_900, round: null, phase: null }, 'FOR_TIME')).toBe(65);
    expect(timerSeconds({ status: 'RUNNING', elapsedMs: 100, shownMs: 59_900, round: null, phase: null }, 'AMRAP')).toBe(60);
  });

  it('freezes while paused and goes on after', () => {
    const paused = timerPause(timerStart(cfg({}), iso(0)), iso(30));
    expect(timerView(paused, at(90))).toMatchObject({ status: 'PAUSED', elapsedMs: 30_000 });
    expect(timerView(timerResume(paused, iso(90)), at(100)).elapsedMs).toBe(40_000);
  });
});
