import { measure, WorkoutFact } from './challenge-metrics';

const w = (localDate: string, durationS: number, distanceM: number | null = null, volumeKg: number | null = null): WorkoutFact => ({ localDate, durationS, distanceM, volumeKg });

describe('challenge metrics', () => {
  const week = [w('2026-11-09', 3600, 5000, null), w('2026-11-09', 1800, null, 2500.4), w('2026-11-11', 2700, 10250, 1200)];

  it('aggregates each metric its own way', () => {
    expect(measure('WORKOUTS', week)).toBe(3);
    expect(measure('TRAINING_DAYS', week)).toBe(2);
    expect(measure('DURATION_MIN', week)).toBe(135);
    expect(measure('DISTANCE_KM', week)).toBe(15.3);
    expect(measure('VOLUME_KG', week)).toBe(3700);
  });

  it('is zero without workouts', () => {
    expect(measure('DISTANCE_KM', [])).toBe(0);
    expect(measure('TRAINING_DAYS', [])).toBe(0);
  });
});
