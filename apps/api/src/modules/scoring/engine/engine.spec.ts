import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ruleSetConfigSchema } from '../rule-set.schema';
import {
  consistencyComponent,
  deriveExperienceLevel,
  harderLevel,
  improvementPct,
  metricProgressScore,
  performanceRatio,
  progressRatio,
  topNMean,
  weightedTotal,
} from './fairness';
import { extractObservations } from './observations';
import { applyCaps, diminishingMultiplier, prXp, workoutXp } from './xp';

const config = ruleSetConfigSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../../../../../infra/seed-data/ruleset-v1.json'), 'utf8')).config);

describe('fairness model — worked example of docs §5.10.1', () => {
  // Sami (beginner): squat e1RM 60 → 65 kg; expected 8 %/28 d; 3/3 planned days; joined a challenge.
  const samiProgress = metricProgressScore(progressRatio(improvementPct(60, 65, 'HIGHER_IS_BETTER'), 8), config.progress_reward_cap);
  // Karim (advanced): 200 → 202 kg; expected 1 %; 4/5 days; bench 140 vs PR 145; no challenge.
  const karimProgress = metricProgressScore(progressRatio(improvementPct(200, 202, 'HIGHER_IS_BETTER'), 1), config.progress_reward_cap);
  const karimPerf = topNMean([performanceRatio(202, 202, 'HIGHER_IS_BETTER'), performanceRatio(140, 145, 'HIGHER_IS_BETTER')], 3) * 100;

  it('gives nearly the same progress score to +8.3 % (beginner) and +1 % (advanced)', () => {
    expect(samiProgress).toBeCloseTo(69.4, 1);
    expect(karimProgress).toBeCloseTo(66.7, 1);
  });

  it('computes the weekly totals of the example', () => {
    const sami = weightedTotal({ progress: samiProgress, consistency: consistencyComponent(3, 3), performance: 100, challenge: 100 }, config.lp_weights);
    const karim = weightedTotal({ progress: karimProgress, consistency: consistencyComponent(4, 5), performance: karimPerf, challenge: 0 }, config.lp_weights);
    expect(sami).toBeCloseTo(87.8, 1);
    expect(karim).toBeCloseTo(66.3, 1);
  });

  it('renormalises the weights while challenges do not exist (Phase 1 variant)', () => {
    const sami = weightedTotal({ progress: samiProgress, consistency: 100, performance: 100, challenge: null }, config.lp_weights);
    const karim = weightedTotal({ progress: karimProgress, consistency: 80, performance: karimPerf, challenge: null }, config.lp_weights);
    expect(sami).toBeCloseTo(85.6, 1);
    expect(karim).toBeCloseTo(78.0, 1);
  });

  it('caps the reward at 1.5× expected and never rewards regression', () => {
    expect(metricProgressScore(3, 1.5)).toBe(100);
    expect(metricProgressScore(progressRatio(improvementPct(100, 95, 'HIGHER_IS_BETTER'), 3), 1.5)).toBe(0);
  });

  it('orients improvement for lower-is-better metrics (run times)', () => {
    expect(improvementPct(1500, 1440, 'LOWER_IS_BETTER')).toBeCloseTo(4, 5);
    expect(performanceRatio(1500, 1440, 'LOWER_IS_BETTER')).toBeCloseTo(0.96, 2);
  });

  it('does not reward training beyond the plan', () => {
    expect(consistencyComponent(6, 3)).toBe(100);
  });
});

describe('experience level (anti-sandbagging, docs §5.4)', () => {
  it('derives the level from body-weight ratio when known, absolute kg otherwise', () => {
    expect(deriveExperienceLevel('BACK_SQUAT', 'E1RM', 150, 70, config)).toBe('ADVANCED'); // 2.14× BW
    expect(deriveExperienceLevel('BACK_SQUAT', 'E1RM', 150, null, config)).toBe('INTERMEDIATE');
    expect(deriveExperienceLevel('TIME_5K' as string, 'TIME_5K', 1200, null, config)).toBe('ADVANCED');
    expect(deriveExperienceLevel('BICEPS_CURL', 'E1RM', 40, null, config)).toBeNull();
  });

  it('uses the level that expects MORE improvement, so declaring "advanced" never helps', () => {
    const expected = { BEGINNER: 8, INTERMEDIATE: 3, ADVANCED: 1 } as const;
    expect(harderLevel(['ADVANCED', 'BEGINNER'], (l) => expected[l])).toBe('BEGINNER');
    expect(harderLevel(['ADVANCED', 'INTERMEDIATE'], (l) => expected[l])).toBe('INTERMEDIATE');
    expect(harderLevel([null, undefined], (l) => expected[l])).toBe('BEGINNER');
  });
});

describe('XP rules', () => {
  it('computes workout XP: 10 + 1 per 3 min, max 50, nothing under 15 min', () => {
    expect(workoutXp(62 * 60, config).amount).toBe(30);
    expect(workoutXp(3 * 3600, config).amount).toBe(50);
    expect(workoutXp(14 * 60, config).amount).toBe(0);
  });

  it('applies diminishing returns after 2 workouts a day', () => {
    expect([1, 2, 3, 4, 5].map((n) => diminishingMultiplier(n, config))).toEqual([1, 1, 0.5, 0, 0]);
  });

  it('applies daily and weekly caps', () => {
    expect(applyCaps(100, 350, 0, config).granted).toBe(50);
    expect(applyCaps(100, 0, 1950, config).granted).toBe(50);
    expect(applyCaps(100, 400, 0, config).granted).toBe(0);
  });

  it('scales PR XP from 50 to 500 with the progress ratio', () => {
    expect(prXp(0, config)).toBe(50);
    expect(prXp(0.634, config)).toBe(193); // docs §5.10.3
    expect(prXp(2, config)).toBe(500);
    expect(prXp(9, config)).toBe(500);
  });
});

describe('extractObservations', () => {
  const tracked = (id: string) =>
    ({ squat: ['MAX_WEIGHT', 'E1RM', 'REPS_AT_WEIGHT'], run: ['DISTANCE', 'PACE', 'TIME_1K', 'TIME_5K', 'TIME_10K', 'TIME_21K'], pull: ['MAX_REPS'] })[id] ?? [];

  it('keeps the best value per metric and ignores warm-ups', () => {
    const obs = extractObservations(
      {
        sportId: 's',
        workoutType: 'STRENGTH',
        performedAt: new Date(),
        durationS: 3600,
        exercises: [
          { exerciseId: 'squat', exerciseCode: 'BACK_SQUAT', isBodyweight: false, sets: [{ reps: 1, weightKg: 150, isWarmup: true }, { reps: 5, weightKg: 100 }, { reps: 3, weightKg: 110 }] },
          { exerciseId: 'pull', exerciseCode: 'PULL_UP', isBodyweight: true, sets: [{ reps: 8 }, { reps: 10 }] },
        ],
      },
      tracked,
      config,
    );
    const get = (m: string, q = 0) => obs.find((o) => o.metricCode === m && o.qualifier === q)?.value;
    expect(get('MAX_WEIGHT')).toBe(110);
    expect(get('E1RM')).toBe(121); // 110 × (1 + 3/30)
    expect(get('REPS_AT_WEIGHT', 100)).toBe(5);
    expect(get('MAX_REPS')).toBe(10);
  });

  it('records FINISH_TIME from a timed set and keeps the lowest', () => {
    const obs = extractObservations(
      {
        sportId: 's',
        workoutType: 'WOD',
        performedAt: new Date(),
        durationS: 900,
        exercises: [{ exerciseId: 'fran', exerciseCode: 'WOD_FRAN', isBodyweight: false, sets: [{ durationS: 312 }, { durationS: 298 }] }],
      },
      () => ['FINISH_TIME'],
      config,
      (code) => code === 'FINISH_TIME',
    );
    expect(obs).toEqual([{ exerciseId: 'fran', metricCode: 'FINISH_TIME', qualifier: 0, value: 298 }]);
  });

  it('ignores FINISH_TIME when the set has no duration', () => {
    const obs = extractObservations(
      { sportId: 's', workoutType: 'WOD', performedAt: new Date(), durationS: 900, exercises: [{ exerciseId: 'fran', exerciseCode: 'WOD_FRAN', isBodyweight: false, sets: [{ reps: 45 }] }] },
      () => ['FINISH_TIME'],
      config,
    );
    expect(obs).toEqual([]);
  });

  it('projects standard-distance times from a longer run', () => {
    const obs = extractObservations(
      { sportId: 'r', workoutType: 'RUN', performedAt: new Date(), durationS: 3000, exercises: [{ exerciseId: 'run', exerciseCode: 'RUN', isBodyweight: true, sets: [{ distanceM: 10000, durationS: 3000 }] }] },
      tracked,
      config,
    );
    const get = (m: string) => obs.find((o) => o.metricCode === m)?.value;
    expect([get('DISTANCE'), get('PACE'), get('TIME_5K'), get('TIME_10K'), get('TIME_21K')]).toEqual([10000, 300, 1500, 3000, undefined]);
  });
});
