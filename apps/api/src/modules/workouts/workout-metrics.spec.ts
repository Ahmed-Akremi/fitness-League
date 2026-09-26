import { canonicalHash, estimate1rm, fingerprint, totalDistanceM, totalVolumeKg, WorkoutInput } from './workout-metrics';

const base: WorkoutInput = {
  sportId: 's1',
  workoutType: 'STRENGTH',
  performedAt: new Date('2026-09-25T08:00:00Z'),
  durationS: 3600,
  exercises: [
    {
      exerciseId: 'e1',
      exerciseCode: 'BACK_SQUAT',
      isBodyweight: false,
      sets: [
        { reps: 5, weightKg: 60, isWarmup: true },
        { reps: 5, weightKg: 100 },
        { reps: 3, weightKg: 110 },
      ],
    },
  ],
};

describe('estimate1rm', () => {
  it('uses Epley by default: 100 kg × 5 → 116.67', () => {
    expect(estimate1rm(100, 5, 'EPLEY', 12)).toBe(116.67);
  });

  it('supports Brzycki: 100 kg × 5 → 112.5', () => {
    expect(estimate1rm(100, 5, 'BRZYCKI', 12)).toBe(112.5);
  });

  it('returns the weight for a single', () => {
    expect(estimate1rm(140, 1, 'EPLEY', 12)).toBe(140);
  });

  it('refuses unreliable inputs', () => {
    expect(estimate1rm(100, 13, 'EPLEY', 12)).toBeNull();
    expect(estimate1rm(0, 5, 'EPLEY', 12)).toBeNull();
    expect(estimate1rm(100, 0, 'EPLEY', 12)).toBeNull();
  });
});

describe('totals', () => {
  it('counts volume over working sets only', () => {
    expect(totalVolumeKg(base)).toBe(5 * 100 + 3 * 110);
  });

  it('sums distance', () => {
    const run = { ...base, exercises: [{ exerciseId: 'r', exerciseCode: 'RUN', isBodyweight: true, sets: [{ distanceM: 5000, durationS: 1500 }, { distanceM: 1000 }] }] };
    expect(totalDistanceM(run)).toBe(6000);
  });
});

describe('fingerprint', () => {
  it('ignores time but not content', () => {
    const later = { ...base, performedAt: new Date('2026-09-26T08:00:00Z'), durationS: 10 };
    expect(fingerprint(later).equals(fingerprint(base))).toBe(true);
    const heavier = structuredClone(base);
    heavier.exercises[0]!.sets[1]!.weightKg = 102.5;
    expect(fingerprint(heavier).equals(fingerprint(base))).toBe(false);
  });
});

describe('canonicalHash', () => {
  it('does not depend on key order or undefined fields', () => {
    expect(canonicalHash({ a: 1, b: [1, { c: 2, d: undefined }] }).equals(canonicalHash({ b: [1, { c: 2 }], a: 1 }))).toBe(true);
    expect(canonicalHash({ a: 1 }).equals(canonicalHash({ a: 2 }))).toBe(false);
  });
});
