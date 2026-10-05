import { bracketOf, gymPairKey, gymScore, MemberWeek, pairGyms } from './gym-war';

const members = (n: number, m: Partial<MemberWeek>): MemberWeek[] => Array.from({ length: n }, () => ({ total: 0, progress: 0, consistency: 0, active: false, ...m }));

describe('Gym War score (docs §6.2)', () => {
  it('reproduces the worked example: the small engaged gym beats the big one', () => {
    // Gym A: 25 eligible, 18 active at ~70 → top-K 63 (18×70 + 2×0)/20; participation 72; progress 65; consistency 75.
    const a = [...members(18, { total: 70, progress: 65, consistency: 75, active: true }), ...members(7, { consistency: 75 })];
    // Gym B: 60 eligible, 27 active, 20 best at 85; participation 45; progress 55; consistency 60.
    const b = [...members(20, { total: 85, progress: 55, consistency: 60, active: true }), ...members(7, { total: 40, progress: 55, consistency: 60, active: true }), ...members(33, { consistency: 60 })];
    const sa = gymScore(a, 40);
    const sb = gymScore(b, 50);
    expect(sa).toMatchObject({ topK: 63, participation: 72, meanProgress: 65, consistency: 75, eligible: 25, active: 18, score: 64.7 });
    expect(sb).toMatchObject({ topK: 85, participation: 45, meanProgress: 55, consistency: 60, score: 63.75 });
  });

  it('spreads the verified weight until proofs exist', () => {
    const all = members(10, { total: 50, progress: 50, consistency: 50, active: true });
    expect(gymScore(all, null).score).toBeCloseTo((0.35 * 50 + 0.2 * 100 + 0.2 * 50 + 0.15 * 50) / 0.9, 2);
  });

  it('padding the roster with passive members lowers the score', () => {
    const core = members(20, { total: 80, progress: 60, consistency: 70, active: true });
    expect(gymScore([...core, ...members(100, {})], null).score).toBeLessThan(gymScore(core, null).score);
  });

  it('caps each member score', () => {
    expect(gymScore(members(1, { total: 140, active: true }), null).topK).toBe(100);
  });
});

describe('Gym War pairing', () => {
  it('sizes gyms into brackets', () => {
    expect([bracketOf(8), bracketOf(30), bracketOf(31), bracketOf(80), bracketOf(81)]).toEqual(['S', 'S', 'M', 'M', 'L']);
  });

  it('pairs the closest ratings inside a bracket, then across adjacent brackets, else a bye', () => {
    const { pairs, byes } = pairGyms(
      [
        { gymId: 'a', bracket: 'S', rating: 1500 },
        { gymId: 'b', bracket: 'S', rating: 1510 },
        { gymId: 'c', bracket: 'S', rating: 1700 },
        { gymId: 'd', bracket: 'M', rating: 1650 },
        { gymId: 'e', bracket: 'L', rating: 1500 },
      ],
      new Set(),
    );
    expect(pairs).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(byes).toEqual(['e']);
  });

  it('never repeats a recent war', () => {
    const { pairs, byes } = pairGyms(
      [
        { gymId: 'a', bracket: 'S', rating: 1500 },
        { gymId: 'b', bracket: 'S', rating: 1500 },
      ],
      new Set([gymPairKey('b', 'a')]),
    );
    expect(pairs).toEqual([]);
    expect(byes).toEqual(['a', 'b']);
  });
});
