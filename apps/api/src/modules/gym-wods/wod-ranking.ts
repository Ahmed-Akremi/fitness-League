import type { WodScoreType } from '@prisma/client';

export const MAX_WOD_WINDOW_DAYS = 31;

/** True if score `a` strictly beats `b`. Ties keep the earlier score. */
export function better(type: WodScoreType, a: number, b: number): boolean {
  return type === 'FOR_TIME' ? a < b : a > b;
}

export function validateWindow(startsAt: Date, endsAt: Date): 'ENDS_BEFORE_START' | 'WINDOW_TOO_LONG' | null {
  if (endsAt.getTime() <= startsAt.getTime()) return 'ENDS_BEFORE_START';
  if (endsAt.getTime() - startsAt.getTime() > MAX_WOD_WINDOW_DAYS * 86_400_000) return 'WINDOW_TOO_LONG';
  return null;
}

/** The ranked value for a score type. AMRAP totals (rounds × reps per round + extra reps) are computed by the client. */
export function scoreValue(type: WodScoreType, s: { timeS?: number; rounds?: number; reps?: number; loadKg?: number }): number | null {
  if (type === 'FOR_TIME') return s.timeS ?? null;
  if (type === 'MAX_LOAD') return s.loadKg ?? null;
  return s.reps ?? null;
}
