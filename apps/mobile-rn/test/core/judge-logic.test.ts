import { elapsedMs, emptyTally, formatClock, laneOrder, movementPoints, rawScore, scoringKind, tallyFromRaw, wholeSeconds } from '../../src/features/competitions/judge/logic';

describe('floor judging: the score from what the judge counted', () => {
  it('maps each score type to its screen', () => {
    expect(['TIME', 'REPS', 'ROUNDS_REPS', 'MOVEMENT_REPS', 'LOAD', 'CALORIES'].map(scoringKind)).toEqual(['time', 'reps', 'rounds', 'movements', 'value', 'value']);
  });

  it('For Time: the time, or CAP + reps; tie-break and no-reps ride along', () => {
    const t = emptyTally();
    expect(rawScore('TIME', t)).toBeNull();
    expect(rawScore('TIME', { ...t, timeS: 245, tieBreakS: 130, noReps: 2 })).toEqual({ timeS: 245, tieBreakS: 130, noReps: 2 });
    expect(rawScore('TIME', { ...t, timeS: 245, capped: true, reps: 60 })).toEqual({ capped: true, reps: 60 });
  });

  it('AMRAP / EMOM reps, rounds + reps (reps per round required), movements, other values', () => {
    const t = emptyTally(2);
    expect(rawScore('REPS', { ...t, reps: 412 })).toEqual({ reps: 412 });
    expect(rawScore('ROUNDS_REPS', { ...t, rounds: 5, reps: 3 })).toBeNull();
    expect(rawScore('ROUNDS_REPS', { ...t, rounds: 5, reps: 3, repsPerRound: '30' })).toEqual({ rounds: 5, reps: 3, repsPerRound: 30 });
    expect(rawScore('MOVEMENT_REPS', { ...t, movementReps: [10, 4] })).toEqual({ movementReps: [10, 4] });
    expect(rawScore('LOAD', { ...t, value: '102,5' })).toEqual({ value: 102.5 });
    expect(rawScore('LOAD', { ...t, value: 'abc' })).toBeNull();
    expect(movementPoints([{ pointsPerRep: 1 }, { pointsPerRep: 0.5 }], [10, 4])).toBe(12);
  });

  it('a correction starts from the score sent', () => {
    expect(tallyFromRaw({ capped: true, reps: 60, maxReps: 100000, floor: {} })).toMatchObject({ capped: true, reps: 60, timeS: null });
    expect(tallyFromRaw({ rounds: 5, reps: 3, repsPerRound: 30 })).toMatchObject({ rounds: 5, reps: 3, repsPerRound: '30' });
    expect(tallyFromRaw({ movementReps: [1, 2] }, 2).movementReps).toEqual([1, 2]);
    expect(tallyFromRaw({ movementReps: [1] }, 2).movementReps).toEqual([0, 0]);
  });
});

describe('floor judging: the heat clock', () => {
  it('counts from the server start, corrected by the phone/server offset', () => {
    const start = '2026-12-12T09:00:00.000Z';
    const at = new Date('2026-12-12T09:04:05.300Z').getTime();
    expect(elapsedMs(null, 0, at)).toBeNull();
    expect(elapsedMs(start, 0, at)).toBe(245_300);
    // The phone is 2 s late: the server offset puts it back on the common clock.
    expect(elapsedMs(start, 2_000, at - 2_000)).toBe(245_300);
    expect(elapsedMs(start, 0, new Date(start).getTime() - 500)).toBe(0);
    expect(formatClock(245_300)).toBe('4:05.3');
    expect(wholeSeconds(245_900)).toBe(245);
  });

  it('lists the heats still to judge first, by start time', () => {
    const lane = (id: string, startsAt: string | null, scored: boolean) => ({ heat: { id, number: 1, startsAt }, score: scored ? {} : null });
    const order = laneOrder([lane('done', '2026-12-12T08:00:00Z', true), lane('late', '2026-12-12T11:00:00Z', false), lane('soon', '2026-12-12T09:00:00Z', false), lane('untimed', null, false)]);
    expect(order.map((l) => l.heat.id)).toEqual(['soon', 'late', 'untimed', 'done']);
  });
});
