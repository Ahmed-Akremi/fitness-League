import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ExerciseRow {
  code: string;
  sport: string | null;
  metrics: string[];
  group?: string;
  plausibility: Record<string, number>;
  name: Record<string, string>;
  description?: Record<string, string>;
}

const catalog = JSON.parse(readFileSync(join(__dirname, '../../../../infra/seed-data/catalog.json'), 'utf8'));
const byCode = new Map<string, ExerciseRow>(catalog.exercises.map((e: ExerciseRow) => [e.code, e]));

describe('catalog: CrossFit & Hyrox', () => {
  it('declares FINISH_TIME as lower-is-better seconds and the HYROX sport', () => {
    expect(catalog.metricTypes.find((m: { code: string }) => m.code === 'FINISH_TIME')).toMatchObject({ unit: 's', direction: 'LOWER_IS_BETTER' });
    expect(catalog.sports.find((s: { code: string }) => s.code === 'HYROX')).toMatchObject({ category: 'FUNCTIONAL', loggingMode: 'MIXED' });
  });

  it.each(['WOD_FRAN', 'WOD_GRACE', 'WOD_HELEN', 'WOD_DIANE', 'WOD_ISABEL', 'WOD_MURPH', 'HYROX_OPEN', 'HYROX_PRO'])('%s is timed with plausibility bounds', (code) => {
    const e = byCode.get(code)!;
    expect(e.metrics).toEqual(['FINISH_TIME']);
    expect(e.plausibility.reject_s).toBeLessThan(e.plausibility.hold_s!);
    for (const l of ['fr', 'en', 'ar']) expect(e.description?.[l]).toBeTruthy();
  });

  it('has the 9 Hyrox stations, Cindy as an AMRAP and translated names everywhere', () => {
    const stations = catalog.exercises.filter((e: ExerciseRow) => e.group === 'HYROX_STATION');
    expect(stations).toHaveLength(9);
    for (const s of stations) expect(s.plausibility.reject_s).toBeLessThan(s.plausibility.hold_s);
    expect(byCode.get('WOD_CINDY')).toMatchObject({ metrics: ['MAX_REPS'], group: 'BENCHMARK_WOD', plausibility: { hold_reps: 700, reject_reps: 900 } });
    for (const e of catalog.exercises) for (const l of ['fr', 'en', 'ar']) expect(e.name[l]).toBeTruthy();
    // New CrossFit-only movements; the shared barbell/bodyweight ones stay available to every strength sport.
    for (const code of ['WALL_BALL', 'DOUBLE_UNDER', 'TOES_TO_BAR', 'MUSCLE_UP']) expect(byCode.get(code)).toMatchObject({ sport: 'CROSSFIT', group: 'MOVEMENT' });
    for (const code of ['THRUSTER', 'CLEAN_AND_JERK', 'SNATCH', 'KETTLEBELL_SWING', 'BOX_JUMP', 'PULL_UP']) expect(byCode.get(code)).toMatchObject({ sport: null, group: 'MOVEMENT' });
    expect(new Set(catalog.exercises.map((e: ExerciseRow) => e.code)).size).toBe(catalog.exercises.length);
  });
});
