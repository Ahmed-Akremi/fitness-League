/** Pure rules of the auth flow, kept free of I/O so they are unit-tested directly. */

export const MAX_FAILED_LOGINS = 5;
const BASE_LOCK_MINUTES = 15;
const MAX_LOCK_MINUTES = 24 * 60;

/**
 * Lock after every 5th consecutive failure; the lock doubles each time (15 min, 30, 60… capped at 24 h).
 * Returns null when this failure does not trigger a lock.
 */
export function lockDurationMinutes(failedCount: number): number | null {
  if (failedCount < MAX_FAILED_LOGINS || failedCount % MAX_FAILED_LOGINS !== 0) return null;
  const lockIndex = failedCount / MAX_FAILED_LOGINS - 1;
  return Math.min(BASE_LOCK_MINUTES * 2 ** lockIndex, MAX_LOCK_MINUTES);
}

/** Age in full years on `today` (both ISO dates, YYYY-MM-DD, in the business timezone). */
export function ageInYears(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const hadBirthday = tm > bm || (tm === bm && td >= bd);
  return ty - by - (hadBirthday ? 0 : 1);
}

/** Public age bracket, shown only if the user opts in (never the date of birth). */
export function ageBracket(age: number): '18-24' | '25-34' | '35+' | null {
  if (age < 18) return null;
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  return '35+';
}
