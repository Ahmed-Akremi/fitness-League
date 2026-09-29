import { currentStreak, FactKey, parseRule, progress } from './badge-rules';

describe('badge rules', () => {
  const facts = new Map<FactKey, number>([
    ['COUNT:PR_AWARDED', 12],
    ['LEVEL', 7],
    ['DIVISION', 3],
    ['STREAK_WEEKS', 2],
  ]);

  it('counts events, levels, divisions and streaks against the threshold', () => {
    expect(progress(parseRule({ type: 'COUNT', event: 'PR_AWARDED', gte: 10 })!, facts)).toEqual({ current: 10, target: 10, met: true });
    expect(progress(parseRule({ type: 'LEVEL', gte: 10 })!, facts)).toEqual({ current: 7, target: 10, met: false });
    expect(progress(parseRule({ type: 'DIVISION', gte: 'GOLD' })!, facts).met).toBe(true);
    expect(progress(parseRule({ type: 'DIVISION', gte: 'PLATINUM' })!, facts)).toEqual({ current: 3, target: 4, met: false });
    expect(progress(parseRule({ type: 'STREAK_WEEKS', gte: 4 })!, facts)).toEqual({ current: 2, target: 4, met: false });
    expect(progress(parseRule({ type: 'COUNT', event: 'FRIEND', gte: 1 })!, facts).met).toBe(false);
  });

  it('rejects unknown or malformed rules', () => {
    expect(parseRule({ type: 'COUNT', event: 'NOPE', gte: 1 })).toBeNull();
    expect(parseRule({ type: 'LEVEL', gte: 0 })).toBeNull();
    expect(parseRule({})).toBeNull();
  });

  it('counts the streak back from the latest week and stops at a gap or a missed week', () => {
    const w = (d: string, met = true) => ({ weekStart: new Date(`${d}T00:00:00Z`), met });
    expect(currentStreak([w('2026-10-19'), w('2026-10-12'), w('2026-10-05'), w('2026-09-21')])).toBe(3);
    expect(currentStreak([w('2026-10-19', false), w('2026-10-12')])).toBe(0);
    expect(currentStreak([w('2026-10-12'), w('2026-10-19'), w('2026-10-05', false)])).toBe(2);
    expect(currentStreak([])).toBe(0);
  });
});
