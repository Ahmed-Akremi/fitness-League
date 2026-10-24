import type { Json } from '../../core/api/client';

/**
 * Event page (athlete side, Circle21-style): the facts under the cover, the registration line and the one-line
 * explanation of each workout format. Pure functions over the competition the API returns.
 */

const live = (k: Json) => k.active !== false;

/** The cheapest entry (an early-bird price still running counts); the event's price when it has no divisions. */
export function cheapestPrice(c: Json, nowMs: number): number {
  const prices = (c.categories ?? []).filter(live).map((k: Json) => (earlyRunning(k, nowMs) ? k.earlyPrice : (k.price ?? c.registrationPrice)));
  const valid = prices.filter((p: unknown): p is number => typeof p === 'number' && p >= 0);
  return valid.length ? Math.min(...valid) : (c.registrationPrice ?? 0);
}

const earlyRunning = (k: Json, nowMs: number) => typeof k.earlyPrice === 'number' && !!k.earlyUntil && Date.parse(k.earlyUntil) > nowMs && typeof k.price === 'number' && k.price > 0;

/** The biggest early-bird saving still running, in whole percent; null when none. */
export function earlyBirdPercent(c: Json, nowMs: number): number | null {
  const pcts = (c.categories ?? [])
    .filter((k: Json) => live(k) && earlyRunning(k, nowMs))
    .map((k: Json) => Math.round(((k.price - k.earlyPrice) / k.price) * 100))
    .filter((p: number) => p > 0);
  return pcts.length ? Math.max(...pcts) : null;
}

export type RegistrationLine = { kind: 'OPEN'; until: string | null; daysLeft: number | null } | { kind: 'STARTS'; from: string } | { kind: 'CLOSED' };

/** « Registration open until … · N days left », « Registration starts … » or « Registration closed ». */
export function registrationLine(c: Json, nowMs: number): RegistrationLine {
  const from = c.deadlines?.registrationStart ?? null;
  const until = c.deadlines?.registrationEnd ?? c.registrationEnd ?? null;
  if (c.status === 'REGISTRATION_OPEN') {
    const left = until ? Date.parse(until) - nowMs : null;
    return { kind: 'OPEN', until, daysLeft: left == null || left < 0 ? null : Math.floor(left / 86_400_000) };
  }
  if (from && Date.parse(from) > nowMs && (c.status === 'DRAFT' || c.status === 'UPCOMING' || c.status === 'PUBLISHED')) return { kind: 'STARTS', from };
  return { kind: 'CLOSED' };
}

/** Individuals, teams or both: from the divisions' type (a local field), individuals when none says. */
export function whoCanJoin(c: Json): { individuals: boolean; teams: boolean } {
  const cats = (c.categories ?? []).filter(live);
  const teams = cats.some((k: Json) => k.type === 'TEAM');
  const individuals = cats.length === 0 || cats.some((k: Json) => k.type !== 'TEAM');
  return { individuals, teams };
}

export type WorkoutFormat = 'FOR_TIME' | 'AMRAP' | 'MAX' | 'POINTS';

/** How the workout is scored, for the line under its name (« For time · fastest is better »). */
export function workoutFormat(scoreType: string): WorkoutFormat {
  if (scoreType === 'TIME') return 'FOR_TIME';
  if (scoreType === 'REPS' || scoreType === 'ROUNDS_REPS' || scoreType === 'MOVEMENT_REPS' || scoreType === 'CALORIES' || scoreType === 'DISTANCE') return 'AMRAP';
  if (scoreType === 'LOAD' || scoreType === 'MAX_WEIGHT') return 'MAX';
  return 'POINTS';
}

/** Ages of a division: « 18–35 », « 40+ », « up to 17 », or nothing. */
export function ageRange(k: Json): string {
  if (k.minAge != null && k.maxAge != null) return `${k.minAge}–${k.maxAge}`;
  if (k.minAge != null) return `${k.minAge}+`;
  if (k.maxAge != null) return `≤ ${k.maxAge}`;
  return '';
}
