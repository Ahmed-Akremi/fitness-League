/**
 * Challenge progress (docs §3.10). ASSUMPTION: instead of `metric_type_id + aggregation`, a challenge measures one of
 * a few workout-level quantities, each with its own aggregation, so progress never depends on per-exercise records.
 */

export const CHALLENGE_METRICS = ['WORKOUTS', 'TRAINING_DAYS', 'DURATION_MIN', 'DISTANCE_KM', 'VOLUME_KG'] as const;
export type ChallengeMetric = (typeof CHALLENGE_METRICS)[number];

export interface WorkoutFact {
  /** Business-calendar day (Africa/Tunis), e.g. 2026-11-10. */
  localDate: string;
  durationS: number;
  distanceM: number | null;
  volumeKg: number | null;
}

/** Aggregated value of the accepted workouts inside the challenge window. */
export function measure(metric: ChallengeMetric, workouts: WorkoutFact[]): number {
  const sum = (f: (w: WorkoutFact) => number) => workouts.reduce((acc, w) => acc + f(w), 0);
  switch (metric) {
    case 'WORKOUTS':
      return workouts.length;
    case 'TRAINING_DAYS':
      return new Set(workouts.map((w) => w.localDate)).size;
    case 'DURATION_MIN':
      return Math.floor(sum((w) => w.durationS) / 60);
    case 'DISTANCE_KM':
      return Math.round(sum((w) => w.distanceM ?? 0) / 100) / 10;
    case 'VOLUME_KG':
      return Math.round(sum((w) => w.volumeKg ?? 0));
  }
}
