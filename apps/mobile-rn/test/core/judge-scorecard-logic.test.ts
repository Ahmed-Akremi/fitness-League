import { scorecardCursor, tapBack, tapNext, tieBreakReps } from '../../src/features/competitions/judge/logic-scorecard';

/** Set A: 2 rounds of 10 thrusters + 50 m row (+2 each round, the row counted every 10 m); set B: 5 burpees. */
const sc = {
  sets: [
    { name: 'A', rounds: 2, increment: 2, movements: [{ name: 'Thrusters', reps: 10, unit: 'Reps', countEvery: 1 }, { name: 'Row', reps: 50, unit: 'M', countEvery: 10 }] },
    { name: 'B', rounds: 1, increment: 0, movements: [{ name: 'Burpees', reps: 5, unit: 'Reps', countEvery: 1 }] },
  ],
  tieBreakAfterSet: 1,
};

describe('floor judging with a scorecard', () => {
  it('finds the set, round and movement of a rep count', () => {
    expect(scorecardCursor(sc, 0)).toMatchObject({ set: 0, round: 1, move: 0, name: 'Thrusters', moveReps: 0, moveTarget: 10, step: 1, done: false });
    expect(scorecardCursor(sc, 10)).toMatchObject({ set: 0, round: 1, move: 1, name: 'Row', moveReps: 0, moveTarget: 50, step: 10 });
    expect(scorecardCursor(sc, 64)).toMatchObject({ set: 0, round: 2, move: 0, moveReps: 4, moveTarget: 12 });
    expect(scorecardCursor(sc, 124)).toMatchObject({ set: 1, round: 1, move: 0, name: 'Burpees', moveTarget: 5 });
    expect(scorecardCursor(sc, 129)).toMatchObject({ done: true, total: 129 });
  });

  it('counts one tap as « count every » reps, never past the movement', () => {
    expect(tapNext(sc, 10)).toBe(20);
    expect(tapNext(sc, 55)).toBe(60);
    expect(tapNext(sc, 129)).toBe(129);
    expect(tapBack(sc, 20)).toBe(10);
    expect(tapBack(sc, 10)).toBe(9);
    expect(tapBack(sc, 0)).toBe(0);
  });

  it('knows the rep count that triggers the tie-break', () => {
    expect(tieBreakReps(sc)).toBe(124);
    expect(tieBreakReps({ ...sc, tieBreakAfterSet: null })).toBeNull();
  });
});
