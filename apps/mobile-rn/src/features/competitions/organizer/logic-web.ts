import type { Json } from '../../../core/api/client';
import { ApiError } from '../../../core/api/errors';
import { csvFileName, delayTargets, fold, heatDays, heatEnd, heatState, localDay, personName, standing, timetable, toCsv, units, type Distribution, type HeatState } from './logic-b';

/** Organizer space on a computer, lot Web 2 (analysis 2026-10-15 §3 items 7–10): the rules its pages share. */

// ───────────── Overview ─────────────

/** Whole percentages that add up to 100 (largest remainder first, then the first one); nothing at all stays at 0. */
export function percentages(values: number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v * 100) / total);
  const out = exact.map((x) => Math.floor(x));
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

/** Judges of the event: the judges and head judges of the staff list. */
export const judgeCount = (staff: Json[]) => staff.filter((s) => s.role === 'JUDGE' || s.role === 'HEAD_JUDGE').length;

/** The `n` categories with the most registrations still standing. */
export const topCategories = (byCategory: Distribution['byCategory'], n = 5) => [...byCategory].sort((a, b) => b.count - a.count).slice(0, n);

/** Every day from the first registration to the last, the days without one at 0, so the chart's axis has no holes. */
export function fillDays(perDay: Distribution['perDay']): Distribution['perDay'] {
  if (perDay.length === 0) return [];
  const counts = new Map(perDay.map((d) => [d.day, d.count]));
  const last = perDay[perDay.length - 1].day;
  const out: Distribution['perDay'] = [];
  // Local noon, one day at a time: a change of clock time never skips or repeats a day.
  const d = new Date(`${perDay[0].day}T12:00:00`);
  for (let i = 0; i < 400; i++) {
    const day = localDay(d.toISOString());
    out.push({ day, count: counts.get(day) ?? 0 });
    if (day >= last) break;
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// ───────────── Finances ─────────────

export type Finance = { gross: number; discounts: number; collected: number; toCollect: number; free: number; refunded: number; rows: Json[] };

const priceOf = (r: Json) => Number(r.originalPrice ?? r.finalPrice ?? 0);
const discountOf = (r: Json) => Number(r.discount ?? 0);
const amountOf = (r: Json) => Number(r.finalPrice ?? 0);

/**
 * The money of the event, from the registrations (payments are recorded by hand, no online fees). The transactions
 * are the paid, free and refunded registrations and the payments still to collect; a cancelled registration that
 * never paid is not one. Amounts in millimes / cents; newest first.
 */
export function finance(rows: Json[]): Finance {
  const tx = rows
    .filter((r) => r.paymentStatus === 'PAID' || r.paymentStatus === 'FREE' || r.paymentStatus === 'REFUNDED' || (r.paymentStatus === 'PENDING' && standing(r)))
    .sort((a, b) => Date.parse(b.registeredAt) - Date.parse(a.registeredAt));
  const sum = (list: Json[], f: (r: Json) => number) => list.reduce((s, r) => s + f(r), 0);
  const withStatus = (status: string) => tx.filter((r) => r.paymentStatus === status);
  return {
    gross: sum(tx, priceOf),
    discounts: sum(tx, discountOf),
    collected: sum(withStatus('PAID'), amountOf),
    toCollect: sum(withStatus('PENDING'), amountOf),
    free: withStatus('FREE').length,
    refunded: sum(withStatus('REFUNDED'), amountOf),
    rows: tx,
  };
}

export type TxFilter = 'ALL' | 'PAID' | 'PENDING' | 'FREE' | 'REFUNDED';

export function filterTransactions(rows: Json[], f: { q: string; payment: TxFilter }): Json[] {
  const q = fold(f.q.trim());
  return rows.filter((r) => (f.payment === 'ALL' || r.paymentStatus === f.payment) && (!q || fold(`${personName(r)} ${r.user?.username ?? ''}`).includes(q)));
}

export function transactionsCsv(rows: Json[], sep = ','): string {
  return toCsv(
    ['registered_at', 'name', 'username', 'category', 'price', 'discount', 'amount', 'currency', 'payment'],
    rows.map((r) => [r.registeredAt, personName(r), r.user?.username ?? '', r.category?.name ?? '', units(priceOf(r), r.currency), units(discountOf(r), r.currency), units(amountOf(r), r.currency), r.currency, r.paymentStatus]),
    sep,
  );
}

// ───────────── Participants ─────────────

export type PayBatch = { paid: string[]; already: string[]; error: unknown; left: string[] };

/**
 * « Marquer payé » for several registrations, one request at a time. One settled meanwhile (409) is counted
 * « déjà réglée » and the rest go on; any other error stops the batch, and `left` keeps the ones not done, the failed one first.
 */
export async function markPaidBatch(ids: string[], post: (id: string) => Promise<unknown>): Promise<PayBatch> {
  const r: PayBatch = { paid: [], already: [], error: null, left: [] };
  for (let i = 0; i < ids.length; i++) {
    try {
      await post(ids[i]);
      r.paid.push(ids[i]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        r.already.push(ids[i]);
      } else {
        r.error = e;
        r.left = ids.slice(i);
        break;
      }
    }
  }
  return r;
}

/** The heats an athlete is placed in, with the lane, in running order (heats without a time last). */
export function athleteHeats(heats: Json[], registrationId: string): { heat: Json; lane: number }[] {
  const out: { heat: Json; lane: number }[] = [];
  for (const h of heats) for (const l of h.lanes ?? []) if (l.registrationId === registrationId) out.push({ heat: h, lane: l.lane });
  const start = (h: Json) => (h.startsAt ? Date.parse(h.startsAt) : Infinity);
  return out.sort((a, b) => start(a.heat) - start(b.heat));
}

// ───────────── Time table ─────────────

/** The day « Horaire du jour » opens on: the day of the heat running now; else the day « Retard » would move; else the last day with heats; null without a timed heat. */
export function scheduleDay(heats: Json[], now: number): string | null {
  const running = timetable(heats, now).current;
  if (running) return localDay(running.startsAt);
  const next = delayTargets(heats, now)[0];
  if (next) return localDay(next.startsAt);
  const days = heatDays(heats);
  return days.length ? days[days.length - 1] : null;
}

/** The timed heats of one day, in running order, each with its state at `now`. */
export function daySchedule(heats: Json[], day: string, now: number): { heat: Json; state: HeatState }[] {
  return heats
    .filter((h) => h.startsAt && localDay(h.startsAt) === day)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .map((heat) => ({ heat, state: heatState(heat, now) }));
}

/** When the program ends: the latest end of the timed heats given. */
export function dayEnd(heats: Json[]): string | null {
  const ends = heats.filter((h) => h.startsAt).map(heatEnd).sort();
  return ends.length ? ends[ends.length - 1] : null;
}

// ───────────── Live pages, leaderboard, promo codes (lot Web 3) ─────────────

/** The time table and the leaderboard read their data again this often while they are open. */
export const LIVE_REFRESH_MS = 30_000;

/** Leaderboard rows whose athlete's name or username contains the search, accents and case aside. */
export function filterBoard(rows: Json[], q: string): Json[] {
  const s = fold(q.trim());
  return s ? rows.filter((r) => fold(`${r.athlete?.fullName ?? ''} ${r.athlete?.username ?? ''}`).includes(s)) : rows;
}

/** Latin letters that accents removal leaves as they are: spelled out, so « Straße » is not cut into « stra-e ». */
const SPELLED: Record<string, string> = { ß: 'ss', œ: 'oe', æ: 'ae', ø: 'o', ł: 'l', đ: 'd', þ: 'th' };

/** Lowercase ASCII words joined by dashes, for file names: « RX Femmes 18-35 » → « rx-femmes-18-35 ». */
export const toSlug = (s: string) =>
  fold(s)
    .replace(/[ßœæøłđþ]/g, (x) => SPELLED[x])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** `<event>-leaderboard-<category>.csv`, so two categories exported the same day stay apart; a name without Latin letters (Arabic) gets its position in the list instead. */
export const boardFileName = (c: Json, category: string, index = -1) => {
  const part = toSlug(category) || (index >= 0 ? String(index + 1) : '');
  return csvFileName(c, part ? `leaderboard-${part}` : 'leaderboard');
};

/** The promo-code list with one code switched on or off (the optimistic toggle). */
export const setActive = (list: Json[], id: string, active: boolean) => list.map((k) => (k.id === id ? { ...k, active } : k));
