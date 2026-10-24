import type { Json } from '../../core/api/client';

/**
 * « My pass » (Circle21 §3.9, presence and warm-up QR): what the athlete shows the event host. The QR carries the
 * event and the registration; the short code under it is the same thing for a host who types it.
 */

/** `ABCD-1234` from the registration id: its last eight letters and digits, easy to read aloud. */
export function passCode(registrationId: string): string {
  const s = registrationId.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(-8).padStart(8, '0');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** What the host's scanner reads: the app's prefix, the event and the registration. */
export const passValue = (competitionId: string, registrationId: string) => `fitness-league:checkin:${competitionId}:${registrationId}`;

/** A presence pass exists once registered (not cancelled) in an event held on site. */
export const hasPass = (c: Json) => !!c.myRegistration && c.myRegistration.registrationStatus !== 'CANCELLED' && c.myRegistration.registrationStatus !== 'REFUNDED' && c.format !== 'ONLINE';

/** My tickets of this event that still open the door (reserved or paid, not used nor cancelled). */
export const myTickets = (orders: Json[], meId: string | null | undefined) => (meId ? orders.filter((o) => o.userId === meId && (o.status === 'RESERVED' || o.status === 'PAID') && o.code) : []);
