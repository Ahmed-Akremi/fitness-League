import {
  ageOn,
  hybridRanking,
  inAgeGroup,
  matchImport,
  overallRanking,
  parseResultsCsv,
  resultsSettingsOf,
  penaltySeconds,
  pointsFor,
  rankFunctional,
  stationTimes,
  visibleRows,
} from '../../src/features/competitions/organizer/logic-results';
import { customFlow, emptyResult } from '../../src/features/competitions/organizer/logic-hybrid';

describe('functional fitness ranking', () => {
  it('For Time: finishers with penalties first, then capped by reps and tie-break, scaled after Rx, DNF last', () => {
    const ranks = rankFunctional(
      [
        { id: 'A', timeS: 300 },
        { id: 'B', timeS: 290, penaltySec: 15 },
        { id: 'C', capped: true, reps: 100, tieBreakS: 200 },
        { id: 'D', capped: true, reps: 100, tieBreakS: 180 },
        { id: 'E', capped: true, reps: 90 },
        { id: 'F', timeS: 200, scaled: true },
        { id: 'G', dnf: true },
      ],
      'TIME',
    );
    expect(ranks.map((r) => [r.id, r.rank])).toEqual([
      ['A', 1],
      ['B', 2],
      ['D', 3],
      ['C', 4],
      ['E', 5],
      ['F', 6],
      ['G', 7],
    ]);
  });

  it('shares a rank on a tie the tie-break does not separate', () => {
    const ranks = rankFunctional([{ id: 'A', timeS: 250 }, { id: 'B', timeS: 250 }, { id: 'C', timeS: 260 }], 'TIME');
    expect(ranks.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(rankFunctional([{ id: 'A', reps: 80 }, { id: 'B', reps: 95 }], 'REPS').map((r) => r.id)).toEqual(['B', 'A']);
  });

  it('turns no-reps, missed reps and minor / major penalties into seconds', () => {
    const p = { noRepSeconds: 2, missedRepSeconds: 5, minorPct: 1, majorPct: 5 };
    expect(penaltySeconds(p, { noReps: 3, missedReps: 1, minor: 1, major: 1 }, 300)).toBe(6 + 5 + 3 + 15);
  });
});

describe('points and overall ranking', () => {
  it('gives the points of a rank in each table', () => {
    expect(pointsFor(4, { kind: 'RANK' })).toBe(4);
    expect(pointsFor(1, { kind: 'DESCENDING', first: 100, step: 3 })).toBe(100);
    expect(pointsFor(2, { kind: 'DESCENDING', first: 100, step: 3 })).toBe(97);
    expect(pointsFor(40, { kind: 'DESCENDING', first: 100, step: 3 })).toBe(0);
  });

  const workouts = [{ id: 'w1' }, { id: 'w2' }];
  const row = (id: string, w1: number, w2: number) => ({ rank: 0, athlete: { id, fullName: id }, wodPoints: { w1, w2 }, totalPoints: w1 + w2 });
  const rows = [row('X', 100, 90), row('Y', 95, 95), row('Z', 90, 100)];

  it('re-ranks with a table; equal totals go to the better placings, then the last workout', () => {
    expect(overallRanking(rows, workouts, { kind: 'RANK' }).map((r) => [r.athlete.id, r.localRank, r.localTotal])).toEqual([
      ['Z', 1, 4],
      ['X', 2, 4],
      ['Y', 3, 4],
    ]);
    expect(overallRanking(rows, workouts, { kind: 'DESCENDING', first: 100, step: 3 }).map((r) => r.athlete.id)).toEqual(['Z', 'X', 'Y']);
  });
});

describe('hybrid ranking', () => {
  const stage = (id: string, kind: 'STATION' | 'TRANSITION') => ({ id, name: id, kind, scoring: kind === 'STATION' ? ('TIME' as const) : ('NONE' as const), target: 1, unit: 'M' });
  const flow = { ...customFlow(), timeCapSec: 180, stages: [stage('r1', 'TRANSITION'), stage('s1', 'STATION'), stage('s2', 'STATION')] };
  const athletes = ['A', 'B', 'C', 'D'].map((id) => ({ registrationId: id, name: id }));

  it('ranks finishers by time; past the cap, by stations done within it; DNF last', () => {
    const results = [
      { ...emptyResult('w', 'A'), splits: [50_000, 120_000, 170_000], finished: true },
      { ...emptyResult('w', 'B'), splits: [60_000, 150_000, 190_000], finished: true },
      { ...emptyResult('w', 'C'), splits: [70_000, 175_000] },
      { ...emptyResult('w', 'D'), splits: [80_000], dnf: true },
    ];
    expect(hybridRanking(flow, results, athletes).map((r) => [r.name, r.status, r.rank, r.stagesDone])).toEqual([
      ['A', 'FINISHED', 1, 3],
      ['B', 'CAPPED', 2, 2],
      ['C', 'CAPPED', 3, 2],
      ['D', 'DNF', null, 1],
    ]);
  });

  it('ranks an imported finish time with the judged ones (no splits)', () => {
    const results = [{ ...emptyResult('w', 'A'), splits: [50_000, 120_000, 170_000], finished: true }, { ...emptyResult('import', 'B'), importedMs: 160_000 }, { ...emptyResult('import', 'C'), importedMs: 200_000 }];
    expect(hybridRanking(flow, results, athletes.slice(0, 3)).map((r) => [r.name, r.status, r.totalMs])).toEqual([
      ['B', 'FINISHED', 160_000],
      ['A', 'FINISHED', 170_000],
      ['C', 'CAPPED', null],
    ]);
  });

  it('shows the stations only (runs hidden), the last one being the finish', () => {
    expect(stationTimes(flow, [50_000, 120_000, 170_000])).toEqual([70_000, 50_000]);
    expect(stationTimes(flow, [50_000])).toEqual([null, null]);
  });
});

describe('visibility, ages and CSV import', () => {
  const rows = [1, 2, 3, 4].map((n) => ({ id: `a${n}`, rank: n }));

  it('hides the ranks in random order and everything when hidden', () => {
    const shuffled = visibleRows(rows, 'RANDOM', 'seed');
    expect(shuffled.map((r) => r.id).sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(shuffled.every((r) => r.rank == null)).toBe(true);
    expect(visibleRows(rows, 'RANDOM', 'seed')).toEqual(shuffled);
    expect(visibleRows(rows, 'HIDDEN', 'seed')).toEqual([]);
    expect(visibleRows(rows, 'RANKED', 'seed')).toBe(rows);
  });

  it('computes an age on the event day and its group', () => {
    expect(ageOn('1990-06-15', '2026-06-14')).toBe(35);
    expect(ageOn('1990-06-15', '2026-06-15')).toBe(36);
    expect(inAgeGroup(36, '35-39')).toBe(true);
    expect(inAgeGroup(52, '50+')).toBe(true);
    expect(inAgeGroup(null, '35-39')).toBe(false);
    expect(inAgeGroup(null, 'ALL')).toBe(true);
  });

  it('checks a CSV before importing it (dry run)', () => {
    const lines = parseResultsCsv('Name;Score\nSami Ben Ali;4:05\nhedi kefi;CAP+12\nNobody;3:00\nLina Trabelsi;abc\nSami Ben Ali;4:10');
    const regs = [
      { id: 'r1', name: 'Sami Ben Ali' },
      { id: 'r2', name: 'Hédi Kéfi' },
      { id: 'r3', name: 'Lina Trabelsi' },
    ];
    const check = matchImport(lines, regs, 'TIME');
    expect(check.ok).toEqual([
      { line: 2, registrationId: 'r1', name: 'Sami Ben Ali', raw: { timeS: 245 } },
      { line: 3, registrationId: 'r2', name: 'Hédi Kéfi', raw: { capped: true, reps: 12 } },
    ]);
    expect(check.problems).toEqual([
      { line: 4, code: 'NO_MATCH' },
      { line: 5, code: 'BAD_SCORE' },
      { line: 6, code: 'DUPLICATE' },
    ]);
    expect(matchImport(parseResultsCsv('name,score\nSami Ben Ali,215'), regs, 'REPS').ok[0].raw).toEqual({ reps: 215 });
  });
});

describe('results settings', () => {
  it('reads the organizer’s choices with their defaults', () => {
    expect(resultsSettingsOf({})).toEqual({ table: 'SERVER', first: 100, step: 3, visibility: 'RANKED', finalists: null, frozenAt: null });
    expect(resultsSettingsOf({ resultsSettings: { table: 'RANK', finalists: 10 } })).toMatchObject({ table: 'RANK', finalists: 10, visibility: 'RANKED' });
  });
});
