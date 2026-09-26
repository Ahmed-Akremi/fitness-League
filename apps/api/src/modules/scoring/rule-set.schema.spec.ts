import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ruleSetConfigSchema } from './rule-set.schema';

const v1 = JSON.parse(readFileSync(join(__dirname, '../../../../../infra/seed-data/ruleset-v1.json'), 'utf8')).config;
const clone = () => structuredClone(v1);
const messages = (input: unknown) => {
  const r = ruleSetConfigSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('ruleSetConfigSchema', () => {
  it('accepts the default rule set v1', () => {
    expect(messages(v1)).toEqual([]);
  });

  it('contains every configuration key required by the spec (§9.6)', () => {
    const required = [
      'workout_base_xp', 'workout_min_duration_min', 'pr_xp_min', 'pr_xp_max', 'goal_milestone_xp', 'challenge_xp',
      'battle_win_lp', 'battle_draw_lp', 'battle_participation_lp', 'gym_war_win_xp', 'daily_xp_cap', 'weekly_xp_cap',
      'diminishing_returns_after', 'calibration_days', 'progress_ceiling_ratio', 'weight_change_max_pct_per_week',
      'lp_weights', 'season_soft_reset_ratio', 'verified_weight_multiplier',
    ];
    const keys = Object.keys(ruleSetConfigSchema.innerType().shape);
    expect(required.filter((k) => !keys.includes(k))).toEqual([]);
  });

  it('rejects LP weights that do not sum to 100%', () => {
    const c = clone();
    c.lp_weights.progress = 0.5;
    expect(messages(c)).toContain('lp_weights: weights must sum to 1 (got 1.1)');
  });

  it('rejects non-increasing division thresholds', () => {
    const c = clone();
    c.division_thresholds.GOLD = 300;
    expect(messages(c).some((m) => m.startsWith('division_thresholds'))).toBe(true);
  });

  it('rejects a reward cap above the plausibility ceiling', () => {
    const c = clone();
    c.progress_reward_cap = 3;
    expect(messages(c).some((m) => m.startsWith('progress_reward_cap'))).toBe(true);
  });

  it('rejects inverted anti-cheat thresholds', () => {
    const c = clone();
    c.anticheat.run_pace_s_per_km = { hold: 150, reject: 195 };
    expect(messages(c).some((m) => m.startsWith('anticheat.run_pace_s_per_km'))).toBe(true);
  });

  it('rejects unknown types and negative values', () => {
    const c = clone();
    c.daily_xp_cap = -1;
    c.e1rm_formula = 'MAGIC';
    const m = messages(c);
    expect(m.some((x) => x.startsWith('daily_xp_cap'))).toBe(true);
    expect(m.some((x) => x.startsWith('e1rm_formula'))).toBe(true);
  });
});
