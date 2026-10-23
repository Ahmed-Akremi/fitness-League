import { customFlow, flowOf, flowProblems, HYROX_STATIONS, hyroxFlow, moveStage, planWaves, raceStations, stagesLocked } from '../../src/features/competitions/organizer/logic-hybrid';

describe('race flow', () => {
  it('builds the HYROX-style race: a 1 km run before each of the 8 stations, stages locked', () => {
    const f = hyroxFlow();
    expect(f.stages).toHaveLength(16);
    expect(f.stages[0]).toMatchObject({ kind: 'TRANSITION', name: '1 km run', target: 1000, unit: 'M', scoring: 'NONE' });
    expect(raceStations(f).map((s) => s.name)).toEqual(HYROX_STATIONS.map((s) => s.name));
    expect(raceStations(f)[7]).toMatchObject({ name: '100 Wall Balls', target: 100, unit: 'Reps' });
    expect(stagesLocked(f)).toBe(true);
    expect(f.totalScoring).toBe('TIME');
  });

  it('starts a custom race empty and lets its stages move', () => {
    const f = { ...customFlow(), stages: [{ id: 'a', name: 'Row', kind: 'STATION' as const, scoring: 'TIME' as const, target: 500, unit: 'M' }, { id: 'b', name: 'Run', kind: 'TRANSITION' as const, scoring: 'NONE' as const, target: 400, unit: 'M' }] };
    expect(stagesLocked(f)).toBe(false);
    expect(moveStage(f, 1, -1).stages.map((s) => s.id)).toEqual(['b', 'a']);
    expect(moveStage(hyroxFlow(), 1, -1).stages[0].kind).toBe('TRANSITION');
  });

  it('reads no flow for an event without one', () => {
    expect(flowOf({})).toBeNull();
  });

  it('flags an empty race, a stage without name or target, a break out of range and a bad rule', () => {
    expect(flowProblems(customFlow())).toEqual(['NO_STAGES']);
    const f = {
      ...customFlow(),
      stages: [{ id: 'a', name: '', kind: 'STATION' as const, scoring: 'REPS' as const, target: 0, unit: 'Reps' }],
      breaks: [{ afterStage: 3, seconds: 60 }],
      scoringRule: { op: 'ADD' as const, value: -5, unit: 'SEC' as const },
    };
    expect(flowProblems(f)).toEqual(['STAGE', 'BREAK', 'RULE']);
    expect(flowProblems({ ...hyroxFlow(), scoringRule: { op: 'ADD', value: null, unit: 'SEC' } })).toEqual([]);
  });
});

describe('waves', () => {
  it('cuts waves and spaces their starts', () => {
    const entries = ['r1', 'r2', 'r3'].map((id) => ({ registrationId: id, name: id, userId: `u-${id}`, registeredAt: '2026-10-01T00:00:00Z' }));
    expect(planWaves({ entries, perWave: 2, start: new Date('2026-12-12T08:00:00Z'), intervalMin: 10 })).toEqual([
      { number: 1, startsAt: '2026-12-12T08:00:00.000Z', registrationIds: ['r1', 'r2'] },
      { number: 2, startsAt: '2026-12-12T08:10:00.000Z', registrationIds: ['r3'] },
    ]);
  });
});
