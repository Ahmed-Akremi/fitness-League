import type { RuleSetConfig } from '../rule-set.schema';

type XpRules = Pick<
  RuleSetConfig,
  'workout_base_xp' | 'workout_max_xp' | 'workout_xp_minutes_per_point' | 'workout_min_duration_min' | 'diminishing_returns_after' | 'diminishing_multipliers' | 'daily_xp_cap' | 'weekly_xp_cap' | 'pr_xp_min' | 'pr_xp_max'
>;

export interface Step {
  label: string;
  value: number;
  expr?: string;
  applied?: boolean;
}

/** Workout XP before caps (docs §5.6): base + 1 per N minutes, capped; nothing under the minimum duration. */
export function workoutXp(durationS: number, r: XpRules): { amount: number; steps: Step[] } {
  const minutes = Math.floor(durationS / 60);
  if (minutes < r.workout_min_duration_min) {
    return { amount: 0, steps: [{ label: 'below_min_duration', value: minutes, expr: `< ${r.workout_min_duration_min} min` }] };
  }
  const bonus = Math.floor(minutes / r.workout_xp_minutes_per_point);
  const raw = r.workout_base_xp + bonus;
  const amount = Math.min(raw, r.workout_max_xp);
  return {
    amount,
    steps: [
      { label: 'base', value: r.workout_base_xp },
      { label: 'duration_bonus', value: bonus, expr: `floor(${minutes}/${r.workout_xp_minutes_per_point})` },
      { label: 'workout_max', value: r.workout_max_xp, applied: raw > r.workout_max_xp },
    ],
  };
}

/** Multiplier for the n-th counted workout of a local day (1-based). */
export function diminishingMultiplier(nth: number, r: XpRules): number {
  if (nth <= r.diminishing_returns_after) return 1;
  const i = Math.min(nth - r.diminishing_returns_after - 1, r.diminishing_multipliers.length - 1);
  return r.diminishing_multipliers[i]!;
}

/** Grants what fits under the daily and weekly caps. */
export function applyCaps(requested: number, grantedToday: number, grantedThisWeek: number, r: XpRules): { granted: number; steps: Step[] } {
  const dailyRoom = Math.max(0, r.daily_xp_cap - grantedToday);
  const weeklyRoom = Math.max(0, r.weekly_xp_cap - grantedThisWeek);
  const granted = Math.max(0, Math.min(requested, dailyRoom, weeklyRoom));
  return {
    granted,
    steps: [
      { label: 'daily_cap_remaining', value: dailyRoom, applied: requested > dailyRoom },
      { label: 'weekly_cap_remaining', value: weeklyRoom, applied: requested > weeklyRoom },
    ],
  };
}

/** PR XP scales with how remarkable the improvement is for this athlete's level (ratio vs expected, max 2). */
export function prXp(ratio: number, r: XpRules): number {
  return Math.round(r.pr_xp_min + (r.pr_xp_max - r.pr_xp_min) * Math.min(Math.max(ratio, 0) / 2, 1));
}
