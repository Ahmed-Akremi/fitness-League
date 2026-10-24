import { defaultTimer, timerPause, timerStart } from '../../src/features/competitions/organizer/logic-timer';
import { lastTen, phaseOf, progressOf, setupProblems } from '../../src/features/timer/logic';

const T0 = Date.parse('2026-10-24T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('athlete timer', () => {
  it('refuses a timer of 00:00 and an interval timer without rounds', () => {
    expect(setupProblems({ ...defaultTimer(), type: 'AMRAP', capSec: 0 })).toEqual(['LENGTH']);
    expect(setupProblems({ ...defaultTimer(), type: 'EMOM', intervalSec: 60, rounds: 0 })).toEqual(['ROUNDS']);
    expect(setupProblems({ ...defaultTimer(), type: 'TABATA', workSec: 0, rounds: 8 })).toEqual(['LENGTH']);
    expect(setupProblems({ ...defaultTimer(), type: 'FOR_TIME', capSec: null })).toEqual([]);
  });

  it('counts down to the start, then runs', () => {
    const s = timerStart({ ...defaultTimer(), type: 'AMRAP', capSec: 300 }, iso(T0 + 10_000));
    expect(phaseOf(s, T0 + 1_500)).toEqual({ kind: 'COUNTDOWN', seconds: 9 });
    const p = phaseOf(s, T0 + 70_000);
    expect(p.kind).toBe('TIMER');
    if (p.kind === 'TIMER') expect(p.view.shownMs).toBe(240_000);
  });

  it('fills the ring over the workout and warns in the last ten seconds', () => {
    const c = { ...defaultTimer(), type: 'AMRAP' as const, capSec: 100 };
    const s = timerStart(c, iso(T0));
    const at = (ms: number) => {
      const p = phaseOf(s, T0 + ms);
      if (p.kind !== 'TIMER') throw new Error('not running');
      return p.view;
    };
    expect(progressOf(c, at(50_000))).toBeCloseTo(0.5);
    expect(lastTen(c, at(50_000))).toBe(false);
    expect(lastTen(c, at(91_000))).toBe(true);
    const paused = phaseOf(timerPause(s, iso(T0 + 95_000)), T0 + 99_000);
    expect(paused.kind === 'TIMER' && lastTen(c, paused.view)).toBe(false);
    const tabata = { ...defaultTimer(), type: 'TABATA' as const, workSec: 20, restSec: 10, rounds: 8 };
    const tp = phaseOf(timerStart(tabata, iso(T0)), T0 + 35_000);
    // Round 2, 5 s into its 20 s of work: a quarter of the way round.
    expect(tp.kind === 'TIMER' && progressOf(tabata, tp.view)).toBeCloseTo(0.25);
    const free = { ...defaultTimer(), type: 'FOR_TIME' as const, capSec: null };
    const fs = phaseOf(timerStart(free, iso(T0)), T0 + 90_000);
    expect(fs.kind === 'TIMER' && progressOf(free, fs.view)).toBeCloseTo(0.5);
  });
});
