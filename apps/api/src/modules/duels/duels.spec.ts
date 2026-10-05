import { decay, expectedScore, NEW_PLAYER, ratePeriod } from './glicko2';
import { DuelCandidate, mmrWindow, pairDuels, pairKey } from './matchmaking';

describe('Glicko-2', () => {
  it('matches the paper example (docs §6.1 reference vector)', () => {
    const r = ratePeriod({ rating: 1500, rd: 200, volatility: 0.06 }, [
      { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
      { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
      { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
    ]);
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.rd).toBeCloseTo(151.52, 1);
    expect(r.volatility).toBeCloseTo(0.05999, 4);
  });

  it('expected score of 1600 vs 1500/RD 200 is 0.619', () => {
    expect(expectedScore({ rating: 1600, rd: 50, volatility: 0.06 }, { rating: 1500, rd: 200, volatility: 0.06 })).toBeCloseTo(0.619, 3);
  });

  it('a win moves a new player up and shrinks RD; inactivity grows RD up to 350', () => {
    const won = ratePeriod(NEW_PLAYER, [{ opponent: NEW_PLAYER, score: 1 }]);
    expect(won.rating).toBeGreaterThan(1500);
    expect(won.rd).toBeLessThan(350);
    const idle = decay({ rating: 1500, rd: 100, volatility: 0.06 }, 3);
    expect(idle.rd).toBeGreaterThan(100);
    expect(decay({ rating: 1500, rd: 349, volatility: 0.06 }, 50).rd).toBe(350);
  });
});

describe('duel matchmaking', () => {
  // docs §6.1 worked example, Sunday 12:00 batch.
  const at = (hours: number): DuelCandidate[] => [
    { userId: 'A', division: 3, mmr: 1620, avgTrainingDays: 3.5, hoursWaiting: hours },
    { userId: 'B', division: 3, mmr: 1580, avgTrainingDays: 3.0, hoursWaiting: hours },
    { userId: 'C', division: 2, mmr: 1450, avgTrainingDays: 2.5, hoursWaiting: hours },
    { userId: 'D', division: 3, mmr: 1900, avgTrainingDays: 4.0, hoursWaiting: hours },
    { userId: 'E', division: 4, mmr: 1950, avgTrainingDays: 4.5, hoursWaiting: hours },
    { userId: 'F', division: 1, mmr: 1200, avgTrainingDays: 2.0, hoursWaiting: hours },
  ];

  it('window grows by 100 every 6 hours up to 400', () => {
    expect([0, 5, 6, 12, 18, 100].map((h) => mmrWindow(h))).toEqual([150, 150, 250, 350, 400, 400]);
  });

  it('pairs A–B and D–E first; C and F wait', () => {
    expect(pairDuels(at(0), new Set())).toEqual([
      ['A', 'B'],
      ['D', 'E'],
    ]);
  });

  it('at 18:00 the wider window pairs C–F (adjacent divisions)', () => {
    const waiting = at(6).filter((c) => c.userId === 'C' || c.userId === 'F');
    expect(pairDuels(waiting, new Set())).toEqual([['C', 'F']]);
  });

  it('never pairs non-adjacent divisions or forbidden pairs', () => {
    const cands = at(100);
    const pairs = pairDuels(cands, new Set([pairKey('A', 'B')]));
    for (const [x, y] of pairs) {
      const dx = cands.find((c) => c.userId === x)!.division;
      const dy = cands.find((c) => c.userId === y)!.division;
      expect(Math.abs(dx - dy)).toBeLessThanOrEqual(1);
      expect(pairKey(x, y)).not.toBe(pairKey('A', 'B'));
    }
  });
});
