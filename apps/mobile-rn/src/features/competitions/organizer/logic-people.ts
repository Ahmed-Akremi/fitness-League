import type { Json } from '../../../core/api/client';
import { EMAIL_RE } from './logic';

/**
 * Organisation update, phase 5: check-in, finalists invited from a qualifier, and the staff (forms with roles and
 * shifts, applications). The lists are kept on the device for now (`core/api/org-local.ts`).
 */

const counted = (r: Json) => r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED';

/** Checked-in athletes out of those still registered, overall and per division (in the divisions' order). */
export function checkinStats(registrations: Json[], checkins: Json[], categories: Json[]) {
  const done = new Set(checkins.map((c) => c.id));
  const live = registrations.filter(counted);
  return {
    total: live.length,
    checked: live.filter((r) => done.has(r.id)).length,
    byCategory: categories.map((k) => {
      const mine = live.filter((r) => r.categoryId === k.id);
      return { categoryId: k.id as string, name: k.name as string, total: mine.length, checked: mine.filter((r) => done.has(r.id)).length };
    }),
  };
}

/** The top `n` of a qualifier's division leaderboard, as invitations (one per athlete and division). */
export function finalistsFrom(rows: Json[], n: number, categoryId: string): Json[] {
  return [...rows]
    .filter((r) => r.athlete?.id)
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
    .slice(0, Math.max(0, n))
    .map((r) => ({ id: `${categoryId}:${r.athlete.id}`, categoryId, userId: r.athlete.id, name: r.athlete.fullName ?? r.athlete.username ?? '', rank: r.rank, status: 'INVITED' }));
}

/** One role or shift per line, trimmed, without duplicates. */
export function parseLines(text: string): string[] {
  return [...new Set(text.split('\n').map((l) => l.trim()).filter(Boolean))];
}

export type StaffStatus = 'PENDING' | 'APPROVED' | 'DECLINED';

export function staffFilter(apps: Json[], f: { role: string | null; status: StaffStatus | null }): Json[] {
  return apps.filter((a) => (!f.role || a.role === f.role) && (!f.status || a.status === f.status));
}

export function staffStats(apps: Json[]) {
  return {
    total: apps.length,
    approved: apps.filter((a) => a.status === 'APPROVED').length,
    pending: apps.filter((a) => a.status === 'PENDING').length,
    declined: apps.filter((a) => a.status === 'DECLINED').length,
    checkedIn: apps.filter((a) => a.checkedIn === true).length,
  };
}

export type ApplicationProblem = 'NAME' | 'EMAIL' | 'ROLE';

export function applicationProblems(a: { name: string; email: string; role: string }, form: { roles: string[] }): ApplicationProblem[] {
  const problems: ApplicationProblem[] = [];
  if (a.name.trim().length < 2) problems.push('NAME');
  if (!EMAIL_RE.test(a.email.trim())) problems.push('EMAIL');
  if (!form.roles.includes(a.role)) problems.push('ROLE');
  return problems;
}
