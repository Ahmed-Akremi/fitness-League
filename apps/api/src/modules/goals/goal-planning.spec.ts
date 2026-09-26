import { creditedWeightChange, planMilestones, reached, roundFor, safeWeightWeeks, suggestTargets, weeksAtRate } from './goal-planning';

const kg = (v: number) => roundFor('kg', 'E1RM', v);

describe('goal planning', () => {
  it('splits squat 100 → 120 into 5 kg milestones (spec example)', () => {
    expect(planMilestones(100, 120, 5, kg).map((m) => m.targetValue)).toEqual([105, 110, 115, 120]);
  });

  it('caps the number of milestones and handles decreasing targets', () => {
    expect(planMilestones(100, 200, 5, kg)).toHaveLength(6);
    const run = planMilestones(1800, 1650, 60, (v) => roundFor('s', 'TIME_5K', v));
    expect(run.map((m) => m.targetValue)).toEqual([1750, 1700, 1650]);
  });

  it('detects reached milestones in both directions', () => {
    expect(reached(110, 110, 'HIGHER_IS_BETTER')).toBe(true);
    expect(reached(1649, 1650, 'LOWER_IS_BETTER')).toBe(true);
    expect(reached(1651, 1650, 'LOWER_IS_BETTER')).toBe(false);
  });

  it('suggests realistic squat targets for a beginner at 80 kg (8 %/month in rule set v1)', () => {
    const s = suggestTargets(80, 8, 'HIGHER_IS_BETTER', kg);
    expect(s.map((x) => [x.horizon, x.targetValue])).toEqual([
      ['SHORT', 87.5],
      ['MEDIUM', 97.5],
      ['LONG', 120],
    ]);
    expect(s[0]!.etaWeeks).toEqual({ min: 4, max: 5 });
    // The spec's "90 kg" would take about 6 weeks at the beginner rate, 16 at the intermediate one.
    expect(weeksAtRate(80, 90, 8, 'HIGHER_IS_BETTER')).toBe(6);
    expect(weeksAtRate(80, 90, 3, 'HIGHER_IS_BETTER')).toBe(16);
  });

  it('suggests smaller steps for advanced athletes', () => {
    const s = suggestTargets(200, 1, 'HIGHER_IS_BETTER', kg);
    expect(s[0]!.targetValue).toBeLessThanOrEqual(205);
  });

  it('computes weeks at a rate', () => {
    expect(weeksAtRate(100, 100, 8, 'HIGHER_IS_BETTER')).toBe(0);
    expect(weeksAtRate(100, 110, 8, 'HIGHER_IS_BETTER')).toBe(5);
    expect(weeksAtRate(100, 110, 0, 'HIGHER_IS_BETTER')).toBeNull();
  });

  it('limits body-weight change to 1 %/week', () => {
    expect(safeWeightWeeks(90, 80, 1)).toBe(12); // 10 kg at 0.9 kg/week
    expect(creditedWeightChange(-6, 90, 4, 1)).toBeCloseTo(-3.6); // lost 6 kg in 4 weeks: only 3.6 kg count
    expect(creditedWeightChange(2, 60, 4, 1)).toBe(2);
  });
});
