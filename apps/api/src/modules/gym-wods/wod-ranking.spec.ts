import { better, scoreValue, validateWindow } from './wod-ranking';

describe('wod ranking', () => {
  it('lower time wins FOR_TIME, higher wins AMRAP and MAX_LOAD', () => {
    expect(better('FOR_TIME', 300, 320)).toBe(true);
    expect(better('FOR_TIME', 320, 300)).toBe(false);
    expect(better('AMRAP', 250, 240)).toBe(true);
    expect(better('MAX_LOAD', 100, 102.5)).toBe(false);
    expect(better('AMRAP', 240, 240)).toBe(false); // ties keep the earlier score
  });

  it('validates the window', () => {
    const t = new Date('2026-09-27T08:00:00Z');
    expect(validateWindow(t, new Date(t.getTime() + 3_600_000))).toBeNull();
    expect(validateWindow(t, t)).toBe('ENDS_BEFORE_START');
    expect(validateWindow(t, new Date(t.getTime() + 32 * 86_400_000))).toBe('WINDOW_TOO_LONG');
  });

  it('reads the value that matches the score type', () => {
    expect(scoreValue('FOR_TIME', { timeS: 431, reps: 3 })).toBe(431);
    expect(scoreValue('AMRAP', { rounds: 12, reps: 190 })).toBe(190);
    expect(scoreValue('MAX_LOAD', { loadKg: 102.5 })).toBe(102.5);
    expect(scoreValue('FOR_TIME', { reps: 3 })).toBeNull();
  });
});
