import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ruleSetConfigSchema } from '../scoring/rule-set.schema';
import { WorkoutInput } from '../workouts/workout-metrics';
import { evaluateWorkout, EvaluationContext } from './rules';

const config = ruleSetConfigSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../../../../infra/seed-data/ruleset-v1.json'), 'utf8')).config);
const now = new Date('2026-09-25T12:00:00Z');
const ctx = (over: Partial<EvaluationContext> = {}): EvaluationContext => ({
  now,
  bodyWeightKg: null,
  workoutsSameDay: 0,
  overlapping: [],
  identicalRecent: 0,
  fingerprintHex: 'fp',
  ...over,
});
const plaus = (code: string) => (code === 'OVERHEAD_PRESS' ? { hold_kg: 150, reject_kg: 240 } : {});

const run = (distanceM: number, durationS: number): WorkoutInput => ({
  sportId: 'run',
  workoutType: 'RUN',
  performedAt: new Date('2026-09-25T07:00:00Z'),
  durationS,
  exercises: [{ exerciseId: 'r', exerciseCode: 'RUN', isBodyweight: true, sets: [{ distanceM, durationS }] }],
});

const lift = (code: string, weightKg: number, reps = 1): WorkoutInput => ({
  sportId: 'pl',
  workoutType: 'STRENGTH',
  performedAt: new Date('2026-09-25T07:00:00Z'),
  durationS: 3600,
  exercises: [{ exerciseId: 'x', exerciseCode: code, isBodyweight: false, sets: [{ reps, weightKg }] }],
});

const evalW = (w: WorkoutInput, c = ctx()) => evaluateWorkout(w, c, config, plaus);
const rules = (w: WorkoutInput, c = ctx()) => evalW(w, c).hits.map((h) => `${h.rule}:${h.severity}`);

const timed = (code: string, durationS: number, reps?: number): WorkoutInput => ({
  sportId: 'cf',
  workoutType: 'WOD',
  performedAt: new Date('2026-09-25T07:00:00Z'),
  durationS: Math.max(durationS, 600),
  exercises: [{ exerciseId: 'x', exerciseCode: code, isBodyweight: false, sets: [reps === undefined ? { durationS } : { reps }] }],
});
const timedPlaus = (code: string) =>
  ({ HYROX_OPEN: { hold_s: 3300, reject_s: 3000 }, WOD_FRAN: { hold_s: 120, reject_s: 100 }, WOD_CINDY: { hold_reps: 700, reject_reps: 900 } })[code] ?? {};

describe('anti-cheat rules (layer 1)', () => {
  it('rejects an impossible Hyrox time and holds a suspicious Fran', () => {
    expect(evaluateWorkout(timed('HYROX_OPEN', 2700), ctx(), config, timedPlaus).outcome).toBe('REJECTED');
    expect(evaluateWorkout(timed('HYROX_OPEN', 4200), ctx(), config, timedPlaus).outcome).toBe('ACCEPTED');
    const fran = evaluateWorkout(timed('WOD_FRAN', 110), ctx(), config, timedPlaus);
    expect(fran.outcome).toBe('HELD_FOR_REVIEW');
    expect(fran.hits.map((h) => h.rule)).toContain('FINISH_TIME_S');
  });

  it('judges an AMRAP total with its own bounds instead of the per-set rep limit', () => {
    expect(evaluateWorkout(timed('WOD_CINDY', 0, 410), ctx(), config, timedPlaus).outcome).toBe('ACCEPTED');
    expect(evaluateWorkout(timed('WOD_CINDY', 0, 950), ctx(), config, timedPlaus).hits.map((h) => `${h.rule}:${h.severity}`)).toEqual(['WOD_TOTAL_REPS:HARD']);
  });

  it('accepts a normal 5K run', () => {
    expect(evalW(run(5000, 27 * 60))).toMatchObject({ outcome: 'ACCEPTED', hits: [], countsForCompetition: true });
  });

  it('rejects the spec example: 100 km in 20 minutes', () => {
    const e = evalW(run(100_000, 20 * 60));
    expect(e.outcome).toBe('REJECTED');
    expect(rules(run(100_000, 20 * 60))).toEqual(expect.arrayContaining(['RUN_PACE:HARD', 'RUN_TIME_5K:HARD', 'RUN_TIME_21K:HARD']));
  });

  it('holds an elite-level but possible 5K (14:30) for review instead of rejecting', () => {
    expect(evalW(run(5000, 14 * 60 + 30)).outcome).toBe('HELD_FOR_REVIEW');
  });

  it('checks the big lifts against absolute and body-weight limits', () => {
    expect(evalW(lift('BACK_SQUAT', 180)).outcome).toBe('ACCEPTED');
    expect(rules(lift('BACK_SQUAT', 320))).toEqual(['LIFT_ABSOLUTE_KG:SOFT']);
    expect(rules(lift('DEADLIFT', 520))).toEqual(['LIFT_ABSOLUTE_KG:HARD']);
    // 200 kg squat at 60 kg body weight = 3.33× → held; unknown body weight → absolute limits only.
    expect(rules(lift('BACK_SQUAT', 200), ctx({ bodyWeightKg: 60 }))).toEqual(['LIFT_BODYWEIGHT_RATIO:SOFT']);
    expect(evalW(lift('BACK_SQUAT', 200)).outcome).toBe('ACCEPTED');
  });

  it('uses the estimated 1RM, not only the weight on the bar', () => {
    // 260 × 10 → e1RM 346.7 > 300 hold
    expect(rules(lift('BACK_SQUAT', 260, 10))).toEqual(['LIFT_ABSOLUTE_KG:SOFT']);
  });

  it('applies per-exercise plausibility overrides from the catalog', () => {
    expect(rules(lift('OVERHEAD_PRESS', 250))).toEqual(['LOAD_KG:HARD']);
  });

  it('rejects workouts in the future and flags late logs without blocking them', () => {
    const future = { ...run(5000, 1800), performedAt: new Date(now.getTime() + 60 * 60_000) };
    expect(rules(future)).toContain('PERFORMED_IN_FUTURE:HARD');
    const late = { ...run(5000, 1800), performedAt: new Date(now.getTime() - 80 * 3_600_000) };
    expect(evalW(late)).toMatchObject({ outcome: 'ACCEPTED', countsForCompetition: false });
  });

  it('rejects duplicates and overlapping sessions', () => {
    expect(rules(run(5000, 1800), ctx({ overlapping: [{ fingerprintHex: 'fp' }] }))).toEqual(['DUPLICATE_WORKOUT:HARD']);
    expect(rules(run(5000, 1800), ctx({ overlapping: [{ fingerprintHex: 'other' }] }))).toEqual(['OVERLAPPING_WORKOUT:HARD']);
  });

  it('holds abnormal frequency and identical repeated workouts', () => {
    expect(rules(run(5000, 1800), ctx({ workoutsSameDay: 4 }))).toEqual(['WORKOUTS_PER_DAY:SOFT']);
    expect(rules(run(5000, 1800), ctx({ identicalRecent: 2 }))).toEqual(['REPEATED_IDENTICAL_WORKOUT:SOFT']);
    expect(rules(run(5000, 1800), ctx({ identicalRecent: 1 }))).toEqual([]);
  });

  it('limits reps and duration', () => {
    const w = lift('BICEPS_CURL', 20, 250);
    expect(rules(w)).toEqual(['REPS_PER_SET:HARD']);
    expect(rules({ ...run(5000, 1800), durationS: 6 * 3600 })).toEqual(['WORKOUT_DURATION:SOFT']);
  });

  it('checks cycling speed and swimming pace', () => {
    const ride = (d: number, t: number): WorkoutInput => ({ ...run(d, t), exercises: [{ exerciseId: 'b', exerciseCode: 'RIDE', isBodyweight: false, sets: [{ distanceM: d, durationS: t }] }] });
    expect(evalW(ride(40_000, 3600)).outcome).toBe('ACCEPTED');
    expect(rules(ride(70_000, 3600))).toEqual(['RIDE_SPEED:HARD']);
    const swim: WorkoutInput = { ...run(1000, 900), exercises: [{ exerciseId: 's', exerciseCode: 'SWIM_FREESTYLE', isBodyweight: true, sets: [{ distanceM: 1000, durationS: 400 }] }] };
    expect(rules(swim)).toEqual(['SWIM_PACE:HARD']);
  });
});
