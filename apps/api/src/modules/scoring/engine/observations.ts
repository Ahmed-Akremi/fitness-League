import type { RuleSetConfig } from '../rule-set.schema';
import { estimate1rm, WorkoutInput, workingSets } from '../../workouts/workout-metrics';

export interface Observation {
  exerciseId: string;
  metricCode: string;
  /** Weight for REPS_AT_WEIGHT; 0 otherwise. */
  qualifier: number;
  value: number;
}

const STANDARD_DISTANCES: [string, number][] = [
  ['TIME_1K', 1000],
  ['TIME_5K', 5000],
  ['TIME_10K', 10000],
  ['TIME_21K', 21097],
];

/**
 * Best value per (exercise, metric, qualifier) in one workout, restricted to the metrics each exercise tracks.
 * Standard-distance times are projected from the average pace of a run at least that long
 * (ASSUMPTION: no splits before wearable integrations, docs §12.2).
 */
/** Fallback when metric directions are not loaded (unit tests); the scoring service passes the real ones. */
export const defaultLowerIsBetter = (code: string) => code === 'PACE' || code === 'FINISH_TIME' || code.startsWith('TIME_');

export function extractObservations(
  w: WorkoutInput,
  tracked: (exerciseId: string) => string[],
  config: Pick<RuleSetConfig, 'e1rm_formula' | 'e1rm_max_reps'>,
  lowerIsBetter: (code: string) => boolean = defaultLowerIsBetter,
): Observation[] {
  const best = new Map<string, Observation>();
  const offer = (o: Observation) => {
    const key = `${o.exerciseId}|${o.metricCode}|${o.qualifier}`;
    const cur = best.get(key);
    if (!cur || (lowerIsBetter(o.metricCode) ? o.value < cur.value : o.value > cur.value)) best.set(key, o);
  };

  const single = w.exercises.length === 1;
  for (const ex of w.exercises) {
    const metrics = new Set(tracked(ex.exerciseId));
    const sets = workingSets(ex.sets);
    let distance = 0;

    for (const s of sets) {
      const reps = s.reps ?? 0;
      const weight = s.weightKg ?? 0;
      if (weight > 0 && reps >= 1) {
        if (metrics.has('MAX_WEIGHT')) offer({ exerciseId: ex.exerciseId, metricCode: 'MAX_WEIGHT', qualifier: 0, value: weight });
        const e1rm = estimate1rm(weight, reps, config.e1rm_formula, config.e1rm_max_reps);
        if (e1rm !== null && metrics.has('E1RM')) offer({ exerciseId: ex.exerciseId, metricCode: 'E1RM', qualifier: 0, value: e1rm });
        if (metrics.has('REPS_AT_WEIGHT')) offer({ exerciseId: ex.exerciseId, metricCode: 'REPS_AT_WEIGHT', qualifier: weight, value: reps });
      }
      if (reps >= 1 && metrics.has('MAX_REPS')) offer({ exerciseId: ex.exerciseId, metricCode: 'MAX_REPS', qualifier: 0, value: reps });
      // Benchmark WODs, Hyrox races and stations: one timed set = the finish time.
      if (s.durationS && s.durationS > 0 && metrics.has('FINISH_TIME')) offer({ exerciseId: ex.exerciseId, metricCode: 'FINISH_TIME', qualifier: 0, value: s.durationS });

      if (s.distanceM) {
        distance += s.distanceM;
        const duration = s.durationS ?? (single && ex.sets.length === 1 ? w.durationS : null);
        if (duration && s.distanceM >= 1000 && metrics.has('PACE')) {
          offer({ exerciseId: ex.exerciseId, metricCode: 'PACE', qualifier: 0, value: Math.round(duration / (s.distanceM / 1000)) });
        }
        if (duration) {
          for (const [code, meters] of STANDARD_DISTANCES) {
            if (metrics.has(code) && s.distanceM >= meters) {
              offer({ exerciseId: ex.exerciseId, metricCode: code, qualifier: 0, value: Math.round((duration / s.distanceM) * meters) });
            }
          }
        }
      }
    }
    if (distance > 0 && metrics.has('DISTANCE')) offer({ exerciseId: ex.exerciseId, metricCode: 'DISTANCE', qualifier: 0, value: distance });
  }
  return [...best.values()];
}
