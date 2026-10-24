import type { Json } from '../../core/api/client';

/**
 * « My events » (athlete side, Circle21 §3.11): the events the user is involved in, by role, and what is left to do
 * in each (Circle21's « Required actions »). Pure functions over each event's detail as the API returns it.
 */

export type MyRole = 'ATHLETE' | 'ORGANIZER' | 'STAFF';
export const STAFF_ROLES = ['HEAD_JUDGE', 'JUDGE', 'FLOOR_JUDGE'];

export function rolesOf(c: Json): MyRole[] {
  const roles = (c.myRoles ?? []) as string[];
  const out: MyRole[] = [];
  if (c.myRegistration && c.myRegistration.registrationStatus !== 'CANCELLED' && c.myRegistration.registrationStatus !== 'REFUNDED') out.push('ATHLETE');
  if (roles.includes('ORGANIZER')) out.push('ORGANIZER');
  if (roles.some((r) => STAFF_ROLES.includes(r))) out.push('STAFF');
  return out;
}

/** The staff role shown on a card: the highest one held. */
export const staffRoleOf = (c: Json): string | null => STAFF_ROLES.find((r) => (c.myRoles ?? []).includes(r)) ?? null;

/** Finished once the last day is over. */
export const isPast = (c: Json, nowMs: number) => Date.parse(c.eventEnd ?? c.eventStart) < nowMs;

/** Upcoming first by start date; past events last, the most recent first. */
export function sortMine(list: Json[], nowMs: number): Json[] {
  return [...list].sort((a, b) => {
    const pa = isPast(a, nowMs);
    const pb = isPast(b, nowMs);
    if (pa !== pb) return pa ? 1 : -1;
    const d = Date.parse(a.eventStart) - Date.parse(b.eventStart);
    return pa ? -d : d;
  });
}

export type Due = { kind: 'DAYS'; days: number } | { kind: 'TODAY' } | { kind: 'PASSED' } | { kind: 'NONE' };

/** Circle21's deadline words: « 3 days left », « Due today! », « Deadline passed ». */
export function dueOf(deadline: string | null | undefined, nowMs: number): Due {
  if (!deadline) return { kind: 'NONE' };
  const left = Date.parse(deadline) - nowMs;
  if (left < 0) return { kind: 'PASSED' };
  const days = Math.floor(left / 86_400_000);
  return days === 0 ? { kind: 'TODAY' } : { kind: 'DAYS', days };
}

export type RequiredAction =
  | { kind: 'PAYMENT'; due: Due }
  | { kind: 'BALANCE'; due: Due }
  | { kind: 'SCORES'; sent: number; total: number; due: Due };

/**
 * What the athlete still has to do: pay (or pay the balance of a deposit) before the registration deadline, and, in
 * an online event, send a score for every workout before the submission deadline. `sent`: workouts with a score.
 */
export function requiredActions(c: Json, sent: number, nowMs: number): RequiredAction[] {
  const r = c.myRegistration;
  if (!r || isPast(c, nowMs)) return [];
  const out: RequiredAction[] = [];
  const regDeadline = c.deadlines?.registrationEnd ?? c.registrationEnd;
  if (r.paymentStatus === 'PENDING') out.push({ kind: r.paymentPlan === 'DEPOSIT' ? 'BALANCE' : 'PAYMENT', due: dueOf(regDeadline, nowMs) });
  const total = (c.workouts ?? []).length;
  if (c.format !== 'ONSITE' && r.registrationStatus === 'CONFIRMED' && total > 0 && sent < total) {
    out.push({ kind: 'SCORES', sent, total, due: dueOf(c.deadlines?.scoreSubmissionDeadline, nowMs) });
  }
  return out;
}

export type RegState = 'CONFIRMED' | 'PAYMENT_PENDING' | 'PENDING';

export function registrationState(c: Json): RegState {
  const r = c.myRegistration ?? {};
  if (r.registrationStatus === 'CONFIRMED') return 'CONFIRMED';
  return r.paymentStatus === 'PENDING' ? 'PAYMENT_PENDING' : 'PENDING';
}
