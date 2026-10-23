import type { Json } from '../../../core/api/client';
import type { Entry } from './logic-heats';

/**
 * Organisation update, phase 7: the race of a hybrid event (HYROX-style or custom stages) and its waves. The flow is
 * the competition's `flow`, kept on the device for now. "HYROX" is a trademark: the template is only « HYROX-style ».
 */

export type StageKind = 'STATION' | 'TRANSITION';
export type StageScoring = 'TIME' | 'REPS' | 'CALORIES' | 'DISTANCE' | 'NONE';
export type Stage = { id: string; name: string; kind: StageKind; scoring: StageScoring; target: number; unit: string; timeCapSec?: number | null };
export type ScoringRule = { op: 'ADD' | 'REMOVE'; value: number | null; unit: 'SEC' | 'REP' };
export type Flow = {
  template: 'HYROX_STYLE' | 'CUSTOM';
  timeCapSec: number | null;
  totalScoring: 'TIME' | 'REPS' | 'CALORIES' | 'DISTANCE';
  stages: Stage[];
  /** `afterStage`: 1-based stage after which the break happens. */
  breaks: { afterStage: number; seconds: number }[];
  /** A penalty or bonus the judge applies to the total (`value` null: the judge enters it). */
  scoringRule: ScoringRule | null;
};
export type FlowProblem = 'NO_STAGES' | 'STAGE' | 'BREAK' | 'RULE';

/** The 8 stations of a HYROX-style race, in order. */
export const HYROX_STATIONS: { key: string; name: string; target: number; unit: string }[] = [
  { key: 'ski_erg', name: '1000m SkiErg', target: 1000, unit: 'M' },
  { key: 'sled_push', name: '50m Sled Push', target: 50, unit: 'M' },
  { key: 'sled_pull', name: '50m Sled Pull', target: 50, unit: 'M' },
  { key: 'burpee_broad_jumps', name: '80m Burpee Broad Jumps', target: 80, unit: 'M' },
  { key: 'rowing', name: '1000m Row', target: 1000, unit: 'M' },
  { key: 'farmers_carry', name: '200m Farmers Carry', target: 200, unit: 'M' },
  { key: 'sandbag_lunges', name: '100m Sandbag Lunges', target: 100, unit: 'M' },
  { key: 'wall_balls', name: '100 Wall Balls', target: 100, unit: 'Reps' },
];

export function hyroxFlow(): Flow {
  const stages: Stage[] = HYROX_STATIONS.flatMap((s, i) => [
    { id: `run_${i + 1}`, name: '1 km run', kind: 'TRANSITION' as const, scoring: 'NONE' as const, target: 1000, unit: 'M' },
    { id: s.key, name: s.name, kind: 'STATION' as const, scoring: 'TIME' as const, target: s.target, unit: s.unit },
  ]);
  return { template: 'HYROX_STYLE', timeCapSec: null, totalScoring: 'TIME', stages, breaks: [], scoringRule: null };
}

export const customFlow = (): Flow => ({ template: 'CUSTOM', timeCapSec: null, totalScoring: 'TIME', stages: [], breaks: [], scoringRule: null });

export const flowOf = (c: Json): Flow | null => (c.flow && Array.isArray(c.flow.stages) ? (c.flow as Flow) : null);
export const stagesLocked = (f: Flow) => f.template === 'HYROX_STYLE';
/** The stages that give a result (runs are transitions). */
export const raceStations = (f: Flow) => f.stages.filter((s) => s.kind === 'STATION');

/** Moves a stage of a custom race; the HYROX-style stages stay in their order. */
export function moveStage(f: Flow, index: number, dir: -1 | 1): Flow {
  const to = index + dir;
  if (stagesLocked(f) || to < 0 || to >= f.stages.length) return f;
  const stages = [...f.stages];
  [stages[index], stages[to]] = [stages[to], stages[index]];
  return { ...f, stages };
}

export function flowProblems(f: Flow): FlowProblem[] {
  const problems: FlowProblem[] = [];
  if (!f.stages.length) problems.push('NO_STAGES');
  if (f.stages.some((s) => !s.name.trim() || !(s.target > 0))) problems.push('STAGE');
  if (f.breaks.some((b) => !(Number.isInteger(b.afterStage) && b.afterStage >= 1 && b.afterStage < f.stages.length) || !(b.seconds > 0))) problems.push('BREAK');
  if (f.scoringRule && f.scoringRule.value != null && !(f.scoringRule.value > 0)) problems.push('RULE');
  return problems;
}

export type PlannedWave = { number: number; startsAt: string; registrationIds: string[] };

/** Waves of `perWave` athletes in the given order, one every `intervalMin` minutes. */
export function planWaves(o: { entries: Entry[]; perWave: number; start: Date; intervalMin: number }): PlannedWave[] {
  const size = Math.max(1, o.perWave);
  const waves: PlannedWave[] = [];
  for (let i = 0, n = 0; i < o.entries.length; i += size, n++) {
    waves.push({ number: n + 1, startsAt: new Date(o.start.getTime() + n * o.intervalMin * 60_000).toISOString(), registrationIds: o.entries.slice(i, i + size).map((e) => e.registrationId) });
  }
  return waves;
}
