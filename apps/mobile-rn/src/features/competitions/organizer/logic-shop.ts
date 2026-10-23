/**
 * Organisation update, phase 11: spectator tickets and the event shop. Orders are reservations paid on site or with
 * the existing « mark paid » flow (ruling 8: no payment provider). Kept on the device for now.
 */

/** Tickets: RESERVED → PAID → USED (checked in at the door). Shop: RESERVED → PAID → PICKED_UP. */
export type OrderStatus = 'RESERVED' | 'PAID' | 'USED' | 'PICKED_UP' | 'CANCELLED';
export type Order = { id: string; itemId: string; quantity: number; status: string; size?: string | null };
/** A ticket type (`limit` = quantity) or a product (`limit` = stock); null: no limit. */
export type Item = { id: string; limit: number | null; salesEnd?: string | null; sizes?: string[] };
export type OrderProblem = 'QUANTITY' | 'SOLD_OUT' | 'CLOSED' | 'SIZE';

const counted = (o: Order) => o.status !== 'CANCELLED';

export function availability(item: Item, orders: Order[], now: number): { sold: number; left: number | null; onSale: boolean } {
  const sold = orders.filter((o) => o.itemId === item.id && counted(o)).reduce((n, o) => n + o.quantity, 0);
  const left = item.limit == null ? null : Math.max(0, item.limit - sold);
  const open = !item.salesEnd || Date.parse(item.salesEnd) > now;
  return { sold, left, onSale: open && left !== 0 };
}

export function orderProblems(item: Item, quantity: number, orders: Order[], now: number, size?: string | null): OrderProblem[] {
  if (!(Number.isInteger(quantity) && quantity >= 1)) return ['QUANTITY'];
  const a = availability(item, orders, now);
  if (item.salesEnd && Date.parse(item.salesEnd) <= now) return ['CLOSED'];
  if (a.left != null && quantity > a.left) return ['SOLD_OUT'];
  if (item.sizes?.length && !size) return ['SIZE'];
  return [];
}

/** Money received: paid orders (and those used or picked up since), in millimes. */
export function revenue(items: { id: string; price: number }[], orders: Order[]): number {
  return orders.filter((o) => o.status === 'PAID' || o.status === 'USED' || o.status === 'PICKED_UP').reduce((sum, o) => sum + (items.find((i) => i.id === o.itemId)?.price ?? 0) * o.quantity, 0);
}

/** `ABCD-EFGH` from random bytes, without the letters and digits people mix up (I, O, 0, 1). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function ticketCode(bytes: Uint8Array): string {
  const chars = Array.from(bytes.slice(0, 8), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}
