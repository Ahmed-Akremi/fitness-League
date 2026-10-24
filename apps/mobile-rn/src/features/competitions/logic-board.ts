import type { Json } from '../../core/api/client';

/**
 * The athlete's leaderboard and appeals (Circle21 §3.3, §3.7): searching a participant, finding my own row, and
 * whether an appeal can still be sent. Pure functions over what the API returns and the event's settings.
 */

const fold = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export const athleteName = (r: Json) => r.athlete?.fullName || r.athlete?.username || '—';

/** Rows whose athlete's name or username contains the search, accents and case aside. */
export function searchBoard(rows: Json[], q: string): Json[] {
  const s = fold(q).trim();
  if (!s) return rows;
  return rows.filter((r) => fold(`${r.athlete?.fullName ?? ''} ${r.athlete?.username ?? ''}`).includes(s));
}

export const myRow = (rows: Json[], meId: string | null | undefined) => (meId ? (rows.find((r) => r.athlete?.id === meId) ?? null) : null);

export type AppealRule = { enabled: boolean; price: number; maxPerAthlete: number | null; deadline: string | null };

export function appealRuleOf(c: Json): AppealRule {
  const a = c?.settings?.appeals ?? {};
  return { enabled: a.enabled === true, price: Number.isInteger(a.price) && a.price > 0 ? a.price : 0, maxPerAthlete: Number.isInteger(a.maxPerAthlete) && a.maxPerAthlete > 0 ? a.maxPerAthlete : null, deadline: a.deadline ?? c?.deadlines?.appealDeadline ?? null };
}

export type AppealState = 'OPEN' | 'OFF' | 'EXPIRED' | 'NO_SCORE';

/** An appeal needs appeals on, a judged score, and the deadline not passed. */
export function appealState(rule: AppealRule, submission: Json | undefined, nowMs: number): AppealState {
  if (!rule.enabled) return 'OFF';
  if (!submission || !['FINAL', 'REJECTED', 'APPROVED'].includes(submission.status)) return 'NO_SCORE';
  if (rule.deadline && Date.parse(rule.deadline) < nowMs) return 'EXPIRED';
  return 'OPEN';
}

/** A reason the judges can act on: at least 20 characters. */
export const reasonOk = (s: string) => s.trim().length >= 20;
