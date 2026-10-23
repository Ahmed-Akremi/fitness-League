import type { Json } from '../../core/api/client';
import { EMAIL_RE } from './organizer/logic';
import { teamSize } from './organizer/logic-division';
import type { Agreements } from './organizer/logic-forms';

/**
 * Organisation update, phase 4: the athlete's side of registration. What the organizer set up in phases 2 and 3
 * (invitations, codes, teams, agreements) decides what the athlete is asked. The extras are kept on the device for now.
 */

/** Invite-only events and « only emails from my list »: an email not on the list cannot register. */
export function inviteRefused(c: Json, email: string | undefined): boolean {
  const restricted = c.inviteOnly === true || c.settings?.restrictToEmailList === true;
  if (!restricted) return false;
  const list: string[] = c.settings?.invitedEmails ?? [];
  return !email || !list.includes(email.trim().toLowerCase());
}

export const needsEventCode = (c: Json) => c.visibility === 'PASSWORD' && typeof c.accessCode === 'string' && c.accessCode.length > 0;
export const codeMatches = (entered: string, expected: string) => entered.trim() === expected;

/** The captain is the athlete registering: the others are asked by email. */
export const teamMemberSlots = (cat: Json) => (cat.type === 'TEAM' ? Math.max(1, teamSize(cat) - 1) : 0);

export type TeamProblem = 'TEAM_NAME' | 'MEMBERS';

export function teamProblems(cat: Json, teamName: string, members: string[]): TeamProblem[] {
  const problems: TeamProblem[] = [];
  const name = teamName.trim();
  if (name.length < 2 || name.length > 60) problems.push('TEAM_NAME');
  const emails = members.map((m) => m.trim().toLowerCase());
  const slots = teamMemberSlots(cat);
  if (emails.length !== slots || emails.some((e) => !EMAIL_RE.test(e)) || new Set(emails).size !== emails.length) problems.push('MEMBERS');
  return problems;
}

/** The waiting room of a busy event (`settings.highDemand`), simulated until the server has a real queue. */
export type QueueState = { phase: 'WAITING' | 'ADMITTED'; position: number };
export const queueStart = (seed: number): QueueState => ({ phase: 'WAITING', position: 3 + (Math.abs(Math.trunc(seed)) % 5) });
export const queueTick = (s: QueueState): QueueState => (s.position <= 1 ? { phase: 'ADMITTED', position: 0 } : { phase: 'WAITING', position: s.position - 1 });

export type AgreementId = 'LIABILITY' | 'CUSTOM' | 'MEDICAL' | 'DOCUMENT';

/** The boxes the athlete ticks: one per agreement the organizer requires (face recognition is a free choice). */
export function requiredAgreements(a: Agreements): AgreementId[] {
  const ids: AgreementId[] = [];
  if (a.liability.required) ids.push('LIABILITY');
  if (a.custom.required) ids.push('CUSTOM');
  if (a.medicalReport.required) ids.push('MEDICAL');
  if (a.additionalDocument.required) ids.push('DOCUMENT');
  return ids;
}

export type Guardian = { name: string; email: string; phone: string; consent: boolean; photoConsent?: boolean };
export type GuardianProblem = 'GUARDIAN_NAME' | 'GUARDIAN_EMAIL' | 'GUARDIAN_PHONE' | 'GUARDIAN_CONSENT';

export function minorProblems(g: Guardian): GuardianProblem[] {
  const problems: GuardianProblem[] = [];
  if (g.name.trim().length < 2) problems.push('GUARDIAN_NAME');
  if (!EMAIL_RE.test(g.email.trim())) problems.push('GUARDIAN_EMAIL');
  if (!/^\+?[\d\s-]{6,20}$/.test(g.phone.trim())) problems.push('GUARDIAN_PHONE');
  if (!g.consent) problems.push('GUARDIAN_CONSENT');
  return problems;
}

export type PaymentPlan = 'FULL' | 'DEPOSIT';

/** What is sent with the registration besides the category and the promo code; only what applies. */
export function registrationExtras(x: {
  answers: Record<string, string>;
  accepted: AgreementId[];
  teamName: string;
  teamMembers: string[];
  giftFor: string;
  plan: PaymentPlan;
  guardian: Guardian | null;
}): Json {
  const out: Json = {};
  if (Object.keys(x.answers).length) out.answers = x.answers;
  if (x.accepted.length) out.agreementsAccepted = x.accepted;
  if (x.teamName.trim()) out.teamName = x.teamName.trim();
  if (x.teamMembers.length) out.teamMembers = x.teamMembers.map((m) => m.trim().toLowerCase());
  if (x.giftFor.trim()) out.giftFor = x.giftFor.trim().toLowerCase();
  out.paymentPlan = x.plan;
  if (x.guardian) out.guardian = { ...x.guardian, name: x.guardian.name.trim(), email: x.guardian.email.trim().toLowerCase(), phone: x.guardian.phone.trim() };
  return out;
}
