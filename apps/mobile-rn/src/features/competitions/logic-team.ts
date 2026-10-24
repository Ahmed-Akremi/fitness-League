import type { Json } from '../../core/api/client';

/**
 * The athlete's team and finals invitation (Circle21 §3.4 « Finals and invitations », §3.5 « Team »): what can still be
 * changed and until when, and the invitation sent by the organizer to the finalists of a qualifier.
 */

export type ChangeRule = { allowed: boolean; until: string | null };

/** A change is open until the division's date, or until the event starts when the organizer set none. */
function rule(until: string | null | undefined, eventStart: string | undefined, nowMs: number, never = false): ChangeRule {
  if (never) return { allowed: false, until: null };
  const limit = until ?? eventStart ?? null;
  return { allowed: !limit || Date.parse(limit) >= nowMs, until: limit };
}

export function teamRules(c: Json, nowMs: number): { name: ChangeRule; members: ChangeRule; fee: number; oneStays: boolean } {
  const k: Json = (c.categories ?? []).find((x: Json) => x.id === c.myRegistration?.categoryId) ?? {};
  return {
    name: rule(k.teamNameChangeUntil, c.eventStart, nowMs),
    members: rule(k.memberChangeUntil, c.eventStart, nowMs),
    fee: Number.isInteger(k.memberChangePrice) && k.memberChangePrice > 0 ? k.memberChangePrice : 0,
    oneStays: k.oneMemberStays === true,
  };
}

/** Members who left the team (compared with what was saved). « One member stays »: at least one must remain. */
export function membersChanged(before: string[], after: string[]): number {
  const norm = (xs: string[]) => xs.map((x) => x.trim().toLowerCase()).filter(Boolean);
  const a = norm(after);
  return norm(before).filter((x) => !a.includes(x)).length;
}

export function oneStaysOk(before: string[], after: string[]): boolean {
  const kept = before.map((x) => x.trim().toLowerCase()).filter((x) => x && after.map((y) => y.trim().toLowerCase()).includes(x));
  return before.filter((x) => x.trim()).length === 0 || kept.length > 0;
}

/** My invitation to this final, if the organizer invited me (`finalist-invitations`, phase 5). */
export const myInvitation = (invitations: Json[], meId: string | null | undefined): Json | null => (meId ? (invitations.find((f) => f.userId === meId) ?? null) : null);

/** An invitation still to answer, or answered yes, lets its athlete through an invite-only registration. */
export const invitationOpens = (inv: Json | null) => !!inv && inv.status !== 'DECLINED';
