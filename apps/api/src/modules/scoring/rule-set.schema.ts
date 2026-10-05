import { z } from 'zod';

/**
 * Shape of `scoring_rule_sets.config` (docs/ARCHITECTURE.md §5.9).
 * Every number used by the scoring engine lives here; nothing is hard-coded in services.
 * The expected-progression table is stored separately (`expected_progression`) because it is a large grid.
 */

const nonNegInt = z.number().int().min(0);
const posInt = z.number().int().positive();
const ratio = z.number().min(0).max(1);

const holdReject = z
  .object({ hold: z.number().positive(), reject: z.number().positive() })
  .refine((t) => t.hold <= t.reject, { message: 'hold must be <= reject' });

/** For "faster than" limits (paces, times): lower is more suspicious, so reject <= hold. */
const holdRejectLowerIsSuspicious = z
  .object({ hold: z.number().positive(), reject: z.number().positive() })
  .refine((t) => t.reject <= t.hold, { message: 'reject must be <= hold for lower-is-suspicious limits' });

const liftLimits = z.object({
  bwRatio: holdReject,
  absoluteKg: holdReject,
});

const divisionCodes = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'ELITE'] as const;

export const ruleSetConfigSchema = z
  .object({
    // Workouts & XP
    workout_base_xp: nonNegInt,
    workout_max_xp: nonNegInt,
    workout_xp_minutes_per_point: posInt,
    workout_min_duration_min: nonNegInt,
    diminishing_returns_after: posInt,
    /** Multipliers applied to the (after+1)th, (after+2)th… workout of a day; the last value repeats. */
    diminishing_multipliers: z.array(ratio).min(1),
    daily_xp_cap: posInt,
    weekly_xp_cap: posInt,

    // PRs
    pr_xp_min: nonNegInt,
    pr_xp_max: nonNegInt,
    calibration_pr_xp: nonNegInt,
    pr_same_metric_cooldown_days: nonNegInt,
    e1rm_formula: z.enum(['EPLEY', 'BRZYCKI']),
    e1rm_max_reps: z.number().int().min(1).max(30),

    // Goals & quests
    goal_milestone_xp: nonNegInt,
    first_workout_quest_xp: nonNegInt,
    challenge_xp: nonNegInt,
    /** Phase 2: count the challenge component in the weekly score (off keeps Phase 1 renormalised weights). */
    challenge_component: z.boolean().default(false),
    weight_change_max_pct_per_week: z.number().positive().max(5),

    // Anti-sandbagging & fairness
    calibration_days: posInt,
    baseline_first_logs: posInt,
    baseline_audit_days: posInt,
    progress_window_days: posInt,
    progress_ceiling_ratio: z.number().positive(),
    progress_reward_cap: z.number().positive(),
    progress_top_n: posInt,

    // League points
    lp_weights: z.object({
      progress: ratio,
      consistency: ratio,
      performance: ratio,
      challenge: ratio,
    }),
    weekly_lp_per_point: z.number().positive(),
    week_grace_hours: nonNegInt,
    late_log_max_hours: posInt,
    verified_weight_multiplier: z.number().min(1).max(3),
    season_soft_reset_ratio: ratio,
    division_thresholds: z.record(z.enum(divisionCodes), nonNegInt),

    // Battles
    battle_win_lp: nonNegInt,
    battle_draw_lp: nonNegInt,
    battle_participation_lp: nonNegInt,
    battle_win_xp: nonNegInt,
    battle_xp_per_point: z.number().min(0),
    battle_draw_margin: z.number().min(0),
    friend_battle_lp_weekly_max: nonNegInt,
    friend_battle_same_opponent_season_max: nonNegInt,
    gym_war_win_xp: nonNegInt,

    /** Weekly Duels (docs §6.1). Defaulted so rule sets written before Phase 2 stay valid. */
    duel: z
      .object({
        glicko_tau: z.number().positive(),
        window_base: posInt,
        window_step: nonNegInt,
        window_step_hours: posInt,
        window_max: posInt,
        no_rematch_weeks: nonNegInt,
        same_gym_allowed: z.boolean(),
        recent_activity_days: posInt,
        ghost_win_lp: nonNegInt,
      })
      .default({
        glicko_tau: 0.5,
        window_base: 150,
        window_step: 100,
        window_step_hours: 6,
        window_max: 400,
        no_rematch_weeks: 4,
        same_gym_allowed: false,
        recent_activity_days: 14,
        ghost_win_lp: 10,
      }),

    /** Gym Wars (docs §6.2). Defaulted so rule sets written before Phase 2 stay valid. */
    gym_war: z
      .object({
        weights: z.object({ top_k: ratio, participation: ratio, progress: ratio, verified: ratio.max(0.99), consistency: ratio }),
        top_k: posInt,
        member_score_cap: posInt,
        min_active_verified_members: posInt,
        bracket_m_min: posInt,
        bracket_l_min: posInt,
        no_rematch_weeks: nonNegInt,
        /** Phase 3: count the share of verified workouts (w4); off spreads w4 over the other weights. */
        use_verified_ratio: z.boolean().default(false),
      })
      .default({
        weights: { top_k: 0.35, participation: 0.2, progress: 0.2, verified: 0.1, consistency: 0.15 },
        top_k: 20,
        member_score_cap: 100,
        min_active_verified_members: 8,
        bracket_m_min: 31,
        bracket_l_min: 81,
        no_rematch_weeks: 3,
        use_verified_ratio: false,
      }),

    // Levels
    level_base_xp: posInt,
    level_exponent: z.number().min(1).max(3),
    level_titles: z
      .array(z.object({ fromLevel: posInt, key: z.string().min(1) }))
      .min(1)
      .refine((titles) => titles[0]?.fromLevel === 1, { message: 'first title must start at level 1' }),

    /** Experience level is derived from performance, not declared (docs §5.4). */
    strength_standards: z.record(
      z.string(),
      z.object({
        bwRatio: z.object({ intermediate: z.number().positive(), advanced: z.number().positive() }),
        absoluteKg: z.object({ intermediate: z.number().positive(), advanced: z.number().positive() }),
      }),
    ),
    /** Race time thresholds in seconds (faster than `advanced` = advanced). */
    running_standards: z.record(z.string(), z.object({ intermediate: z.number().positive(), advanced: z.number().positive() })),

    // Legal
    min_age_years: z.number().int().min(13).max(21),

    // Anti-cheat thresholds (docs §7.2)
    anticheat: z.object({
      future_skew_max_min: posInt,
      clock_skew_hold_hours: posInt,
      run_pace_s_per_km: holdRejectLowerIsSuspicious,
      run_distance_m: holdReject,
      run_time_s: z.object({
        TIME_5K: holdRejectLowerIsSuspicious,
        TIME_10K: holdRejectLowerIsSuspicious,
        TIME_21K: holdRejectLowerIsSuspicious,
      }),
      ride_speed_kmh: holdReject,
      ride_distance_m: holdReject,
      walk_speed_kmh: holdReject,
      swim_pace_s_per_100m: holdRejectLowerIsSuspicious,
      lifts: z.object({ BACK_SQUAT: liftLimits, BENCH_PRESS: liftLimits, DEADLIFT: liftLimits }),
      reps_weighted: holdReject,
      reps_bodyweight: holdReject,
      workout_duration_h: holdReject,
      sets_per_workout: holdReject,
      workouts_per_day_hold: posInt,
      identical_fingerprint_hold: z.object({ count: posInt, days: posInt }),
    }),
  })
  .superRefine((c, ctx) => {
    const w = c.lp_weights;
    const sum = w.progress + w.consistency + w.performance + w.challenge;
    if (Math.abs(sum - 1) > 1e-6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lp_weights'], message: `weights must sum to 1 (got ${Number(sum.toFixed(4))})` });
    }
    const gw = c.gym_war.weights;
    const gwSum = gw.top_k + gw.participation + gw.progress + gw.verified + gw.consistency;
    if (Math.abs(gwSum - 1) > 1e-6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gym_war', 'weights'], message: `weights must sum to 1 (got ${Number(gwSum.toFixed(4))})` });
    }
    if (c.gym_war.bracket_m_min >= c.gym_war.bracket_l_min) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gym_war', 'bracket_m_min'], message: 'bracket_m_min must be < bracket_l_min' });
    }
    if (c.pr_xp_min > c.pr_xp_max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pr_xp_min'], message: 'pr_xp_min must be <= pr_xp_max' });
    }
    if (c.workout_base_xp > c.workout_max_xp) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['workout_base_xp'], message: 'workout_base_xp must be <= workout_max_xp' });
    }
    if (c.daily_xp_cap > c.weekly_xp_cap) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['daily_xp_cap'], message: 'daily cap must be <= weekly cap' });
    }
    if (c.progress_reward_cap > c.progress_ceiling_ratio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['progress_reward_cap'],
        message: 'reward cap must be <= plausibility ceiling',
      });
    }
    const thresholds = divisionCodes.map((d) => c.division_thresholds[d]);
    if (thresholds.some((t) => t === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['division_thresholds'], message: 'all divisions are required' });
    } else if (thresholds[0] !== 0 || thresholds.some((t, i) => i > 0 && t! <= thresholds[i - 1]!)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['division_thresholds'],
        message: 'thresholds must start at 0 and be strictly increasing',
      });
    }
    const levels = c.level_titles.map((t) => t.fromLevel);
    if (levels.some((l, i) => i > 0 && l <= levels[i - 1]!)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['level_titles'], message: 'levels must be strictly increasing' });
    }
  });

export type RuleSetConfig = z.infer<typeof ruleSetConfigSchema>;
