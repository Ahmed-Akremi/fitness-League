import { z } from 'zod';

/**
 * Data-driven badge rules (docs §3.10). A rule reads one fact about the athlete and compares it to a threshold;
 * the service gathers only the facts the enabled badges need.
 */

export const BADGE_EVENTS = ['WORKOUT_ACCEPTED', 'PR_AWARDED', 'BATTLE_WIN', 'DUEL_WIN', 'GYM_WAR_WIN', 'GOAL_COMPLETED', 'FRIEND', 'GYM_JOINED', 'CHALLENGE_COMPLETED'] as const;
export type BadgeEvent = (typeof BADGE_EVENTS)[number];

export const DIVISION_ORDER = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'ELITE'] as const;

export const badgeRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('COUNT'), event: z.enum(BADGE_EVENTS), gte: z.number().int().positive() }),
  z.object({ type: z.literal('LEVEL'), gte: z.number().int().positive() }),
  z.object({ type: z.literal('DIVISION'), gte: z.enum(DIVISION_ORDER) }),
  /** Consecutive closed weeks with the training plan fully met (consistency 100). */
  z.object({ type: z.literal('STREAK_WEEKS'), gte: z.number().int().positive() }),
]);
export type BadgeRule = z.infer<typeof badgeRuleSchema>;

/** Fact keys: `COUNT:<event>`, `LEVEL`, `DIVISION` (1 = Bronze … 6 = Elite, 0 = none), `STREAK_WEEKS`. */
export type FactKey = `COUNT:${BadgeEvent}` | 'LEVEL' | 'DIVISION' | 'STREAK_WEEKS';

export function factKey(rule: BadgeRule): FactKey {
  return rule.type === 'COUNT' ? `COUNT:${rule.event}` : rule.type;
}

export function target(rule: BadgeRule): number {
  return rule.type === 'DIVISION' ? DIVISION_ORDER.indexOf(rule.gte) + 1 : rule.gte;
}

/** Progress towards a badge: current value capped at the target. */
export function progress(rule: BadgeRule, facts: ReadonlyMap<FactKey, number>): { current: number; target: number; met: boolean } {
  const t = target(rule);
  const current = facts.get(factKey(rule)) ?? 0;
  return { current: Math.min(current, t), target: t, met: current >= t };
}

/** Parses a stored rule; an invalid rule never awards anything. */
export function parseRule(raw: unknown): BadgeRule | null {
  const r = badgeRuleSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Run of consecutive weeks (7 days apart) with the plan met, counted back from the latest closed week. */
export function currentStreak(weeks: { weekStart: Date; met: boolean }[]): number {
  const sorted = [...weeks].sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime());
  let streak = 0;
  let expected: number | null = null;
  for (const w of sorted) {
    if (!w.met) break;
    if (expected !== null && Math.abs(w.weekStart.getTime() - expected) > 36 * 3_600_000) break;
    streak++;
    expected = w.weekStart.getTime() - 7 * 86_400_000;
  }
  return streak;
}
