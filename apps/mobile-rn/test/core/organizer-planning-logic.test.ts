import { laneOrder, planHeats, sortEntries } from '../../src/features/competitions/organizer/logic-heats';
import { scorecardOf, scorecardProblems, scorecardTotal, tapSteps } from '../../src/features/competitions/organizer/logic-scorecard';

describe('heat generator', () => {
  it('places the best athletes in the start, middle or end lanes', () => {
    expect(laneOrder(6, 'START')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(laneOrder(6, 'END')).toEqual([6, 5, 4, 3, 2, 1]);
    expect(laneOrder(6, 'MIDDLE')).toEqual([3, 4, 2, 5, 1, 6]);
    expect(laneOrder(5, 'MIDDLE')).toEqual([3, 2, 4, 1, 5]);
  });

  const entries = [
    { registrationId: 'r1', name: 'Omar', userId: 'u1', registeredAt: '2026-10-03T00:00:00Z' },
    { registrationId: 'r2', name: 'Amira', userId: 'u2', registeredAt: '2026-10-01T00:00:00Z' },
    { registrationId: 'r3', name: 'Hédi', userId: 'u3', registeredAt: '2026-10-02T00:00:00Z' },
  ];

  it('sorts by rank (best or worst first, unranked last), by name or by registration date', () => {
    const ranks = { u1: 2, u3: 1 };
    expect(sortEntries(entries, 'RANK_TOP', ranks).map((e) => e.registrationId)).toEqual(['r3', 'r1', 'r2']);
    expect(sortEntries(entries, 'RANK_LOW', ranks).map((e) => e.registrationId)).toEqual(['r1', 'r3', 'r2']);
    expect(sortEntries(entries, 'ALPHABET', {}).map((e) => e.name)).toEqual(['Amira', 'Hédi', 'Omar']);
    expect(sortEntries(entries, 'REGISTRATION', {}).map((e) => e.registrationId)).toEqual(['r2', 'r3', 'r1']);
  });

  it('cuts heats, places lanes and times them with transitions and pauses', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ registrationId: `r${i + 1}`, name: `A${i + 1}`, userId: `u${i + 1}`, registeredAt: '2026-10-01T00:00:00Z' }));
    const heats = planHeats({ entries: many, perHeat: 3, lanes: 4, placement: 'MIDDLE', start: new Date('2026-12-12T08:00:00Z'), durationMin: 12, transitionMin: 3, pauseEvery: 2, pauseMin: 10 });
    expect(heats.map((h) => h.startsAt)).toEqual(['2026-12-12T08:00:00.000Z', '2026-12-12T08:15:00.000Z', '2026-12-12T08:40:00.000Z']);
    expect(heats[0].lanes).toEqual([
      { lane: 2, registrationId: 'r1' },
      { lane: 3, registrationId: 'r2' },
      { lane: 1, registrationId: 'r3' },
    ]);
    expect(heats[2].lanes).toEqual([{ lane: 2, registrationId: 'r7' }]);
  });
});

describe('scorecard', () => {
  const sc = {
    sets: [
      { name: 'Set 1', rounds: 3, increment: 2, movements: [{ name: 'Thrusters', reps: 10, unit: 'Reps', countEvery: 1 }, { name: 'Pull-ups', reps: 5, unit: 'Reps', countEvery: 5 }] },
      { name: 'Set 2', rounds: 1, increment: 0, movements: [{ name: 'Row', reps: 500, unit: 'M', countEvery: 50 }] },
    ],
    tieBreakAfterSet: 1,
  };

  it('starts empty for a WOD without one', () => {
    expect(scorecardOf({})).toEqual({ sets: [], tieBreakAfterSet: null });
  });

  it('adds up the reps of every round, increments included', () => {
    // Set 1: rounds of 15, 19, 23 → 57; Set 2: 500.
    expect(scorecardTotal(sc)).toBe(557);
  });

  it('counts the taps a judge makes for a movement', () => {
    expect(tapSteps({ name: 'Row', reps: 500, unit: 'M', countEvery: 50 })).toBe(10);
    expect(tapSteps({ name: 'Burpees', reps: 7, unit: 'Reps', countEvery: 5 })).toBe(2);
  });

  it('flags an empty set, a movement without name or reps, a count step over the reps and a tie-break out of range', () => {
    expect(scorecardProblems(sc)).toEqual([]);
    const bad = { sets: [{ name: 'S', rounds: 0, increment: 0, movements: [] }, { name: 'T', rounds: 1, increment: 0, movements: [{ name: '', reps: 0, unit: 'Reps', countEvery: 10 }] }], tieBreakAfterSet: 5 };
    expect(scorecardProblems(bad)).toEqual(['ROUNDS', 'SET_EMPTY', 'MOVEMENT', 'COUNT_EVERY', 'TIE_BREAK']);
  });
});
