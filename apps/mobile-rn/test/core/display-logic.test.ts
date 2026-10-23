import { applyRaceEvent, keepNewer, raceRows, rotation, scheduleNow } from '../../src/features/competitions/displays/logic';
import { customFlow, emptyResult } from '../../src/features/competitions/organizer/logic-hybrid';

describe('live lanes', () => {
  it('keeps the update with the higher seq', () => {
    const lanes = { 3: { lane: 3, reps: 10, seq: 5 } };
    expect(keepNewer(lanes, { lane: 3, reps: 8, seq: 4 })).toBe(lanes);
    expect(keepNewer(lanes, { lane: 3, reps: 12, seq: 6 })[3]).toMatchObject({ reps: 12 });
    expect(keepNewer(lanes, { lane: 1, reps: 2, seq: 1 })[1]).toMatchObject({ reps: 2 });
  });
});

const stage = (id: string) => ({ id, name: id, kind: 'STATION' as const, scoring: 'TIME' as const, target: 1, unit: 'M' });
const flow = { ...customFlow(), stages: [stage('a'), stage('b')] };

describe('race view', () => {
  it('replays the judges’ events on the results', () => {
    let r = applyRaceEvent([], 'w1', 'split', { registrationId: 'r1', stageIndex: 0, atMs: 60_000 });
    expect(r).toEqual([expect.objectContaining({ id: 'w1:r1', splits: [60_000], finished: false })]);
    r = applyRaceEvent(r, 'w1', 'penalty', { registrationId: 'r1', value: 5 });
    r = applyRaceEvent(r, 'w1', 'split', { registrationId: 'r1', stageIndex: 1, atMs: 130_000 });
    r = applyRaceEvent(r, 'w1', 'clear', { registrationId: 'r1', stageIndex: 1 });
    expect(r[0]).toMatchObject({ splits: [60_000], adjustments: [5] });
    r = applyRaceEvent(r, 'w1', 'done', { registrationId: 'r1', splits: [60_000, 120_000] });
    expect(r[0]).toMatchObject({ splits: [60_000, 120_000], finished: true });
    expect(applyRaceEvent(r, 'w1', 'dnf', { registrationId: 'r2' })[1]).toMatchObject({ dnf: true });
  });

  it('skips an event the snapshot already holds (same or older seq)', () => {
    const snapshot = [{ ...emptyResult('w1', 'r1'), adjustments: [5], seq: 7 }];
    expect(applyRaceEvent(snapshot, 'w1', 'penalty', { registrationId: 'r1', value: 5, seq: 7 })).toBe(snapshot);
    expect(applyRaceEvent(snapshot, 'w1', 'penalty', { registrationId: 'r1', value: 5, seq: 8 })[0]).toMatchObject({ adjustments: [5, 5], seq: 8 });
  });

  it('ranks finishers by total, then racers by progress, DNF last, with gaps', () => {
    const results = [
      { ...emptyResult('w1', 'a'), splits: [60_000, 200_000], finished: true },
      { ...emptyResult('w1', 'b'), splits: [55_000, 190_000], finished: true },
      { ...emptyResult('w1', 'c'), splits: [70_000] },
      { ...emptyResult('w1', 'd'), splits: [80_000], dnf: true },
    ];
    const athletes = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ registrationId: id, name: id.toUpperCase() }));
    const rows = raceRows(flow, results, athletes);
    expect(rows.map((x) => [x.name, x.status, x.rank])).toEqual([
      ['B', 'FINISHED', 1],
      ['A', 'FINISHED', 2],
      ['C', 'RACING', 3],
      ['E', 'WAITING', null],
      ['D', 'DNF', null],
    ]);
    expect(rows[1].gapMs).toBe(10_000);
    expect(rows[2]).toMatchObject({ stagesDone: 1, gapMs: 15_000 });
  });
});

describe('rotation and schedule', () => {
  it('turns through the divisions every period', () => {
    expect(rotation(3, 10, 0, 9_999)).toBe(0);
    expect(rotation(3, 10, 0, 25_000)).toBe(2);
    expect(rotation(3, 10, 0, 31_000)).toBe(0);
    expect(rotation(0, 10, 0, 5_000)).toBe(0);
  });

  it('finds the heats on the floor and the next ones', () => {
    const at = (min: number) => new Date(Date.UTC(2026, 11, 12, 9, min)).toISOString();
    const heats = [
      { id: 'h1', startsAt: at(0), durationMin: 10 },
      { id: 'h2', startsAt: at(15), durationMin: 10 },
      { id: 'h3', startsAt: at(30), durationMin: 10 },
      { id: 'h0', startsAt: null, durationMin: 10 },
    ];
    const s = scheduleNow(heats, Date.parse(at(5)));
    expect(s.active.map((h) => h.id)).toEqual(['h1']);
    expect(s.next.map((h) => h.id)).toEqual(['h2', 'h3']);
  });
});
