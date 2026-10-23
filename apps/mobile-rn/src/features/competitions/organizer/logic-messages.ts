import type { Json } from '../../../core/api/client';
import { personName } from './logic-b';

/**
 * Organisation update, phase 11: messages to a segment, now or later. Nothing is sent yet: the outbox lists what the
 * server will send by email and notification (`messages`, kept on the device). Recipients keep a name only.
 */

export type SegmentKind = 'ALL_ATHLETES' | 'DIVISION' | 'UNPAID' | 'NOT_CHECKED_IN' | 'WAITING_LIST' | 'STAFF' | 'VOLUNTEERS';
export const SEGMENTS: SegmentKind[] = ['ALL_ATHLETES', 'DIVISION', 'UNPAID', 'NOT_CHECKED_IN', 'WAITING_LIST', 'STAFF', 'VOLUNTEERS'];
export type Segment = { kind: SegmentKind; categoryId?: string | null };
export type Recipient = { id: string; name: string };
export type MessageProblem = 'SUBJECT' | 'BODY' | 'NO_RECIPIENT' | 'PAST';
export type MessageStatus = 'SCHEDULED' | 'SENT' | 'CANCELLED';

type Sources = { registrations: Json[]; checkins: Json[]; waitingList: Json[]; staff: Json[]; applications: Json[] };

const active = (r: Json) => r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED';

export function recipients(s: Segment, d: Sources): Recipient[] {
  const athletes = d.registrations.filter(active);
  const of = (list: Json[]) => list.map((r) => ({ id: r.id as string, name: personName(r) }));
  switch (s.kind) {
    case 'DIVISION':
      return of(athletes.filter((r) => r.categoryId === s.categoryId));
    case 'UNPAID':
      return of(athletes.filter((r) => r.paymentStatus === 'PENDING'));
    case 'NOT_CHECKED_IN': {
      const done = new Set(d.checkins.map((x) => x.id));
      return of(athletes.filter((r) => !done.has(r.id)));
    }
    case 'WAITING_LIST':
      return d.waitingList.map((w) => ({ id: w.id, name: w.name }));
    case 'STAFF':
      return of(d.staff);
    case 'VOLUNTEERS':
      return d.applications.filter((a) => a.status === 'APPROVED').map((a) => ({ id: a.id, name: a.name }));
    default:
      return of(athletes);
  }
}

/** `sendAt` null: now. A message for later must be in the future. */
export function messageProblems(d: { subject: string; body: string; sendAt: string | null }, count: number, now: number): MessageProblem[] {
  const out: MessageProblem[] = [];
  if (!d.subject.trim()) out.push('SUBJECT');
  if (!d.body.trim()) out.push('BODY');
  if (count === 0) out.push('NO_RECIPIENT');
  if (d.sendAt && Date.parse(d.sendAt) <= now) out.push('PAST');
  return out;
}

export const messageStatus = (m: { sendAt: string; cancelled?: boolean }, now: number): MessageStatus => (m.cancelled ? 'CANCELLED' : Date.parse(m.sendAt) <= now ? 'SENT' : 'SCHEDULED');
