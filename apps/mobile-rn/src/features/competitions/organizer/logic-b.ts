import type { Json } from '../../../core/api/client';
import { ApiError } from '../../../core/api/errors';
import { toMillimes } from './logic';

/** Organizer space, lot B (spec 2026-10-14 §1.3 items 5–10): the rules the lot B screens share. */

/** Lowercase without accents, so « kefi » finds « Kéfi ». */
export const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Name of a registration or a staff row (`user`) or of a lane (`athlete`): full name, else username. */
export function personName(x: Json): string {
  const p = x.user ?? x.athlete ?? {};
  return p.profile?.fullName || p.fullName || p.username || '—';
}

/** `YYYY-MM-DD` of an instant, in the phone's time zone. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const isInt = (s: string, min: number, max: number) => /^\d+$/.test(s.trim()) && Number(s) >= min && Number(s) <= max;
const optInt = (s: string, min: number, max: number) => !s.trim() || isInt(s, min, max);
const startOf = (h: Json) => (h.startsAt ? Date.parse(h.startsAt) : NaN);
const endOf = (h: Json) => startOf(h) + (h.durationMin ?? 0) * 60_000;

// ───────────── Participants ─────────────

export type PaymentFilter = 'ALL' | 'PENDING' | 'PAID' | 'FREE';

export function filterRegistrations(rows: Json[], f: { q: string; categoryId: string | null; payment: PaymentFilter }): Json[] {
  const q = fold(f.q.trim());
  return rows.filter(
    (r) =>
      (!q || fold(`${personName(r)} ${r.user?.username ?? ''}`).includes(q)) &&
      (!f.categoryId || r.categoryId === f.categoryId) &&
      (f.payment === 'ALL' || r.paymentStatus === f.payment),
  );
}

/** « À encaisser »: payment pending, registration neither cancelled nor refunded, oldest first. */
export function toCollect(rows: Json[]): Json[] {
  return rows
    .filter((r) => r.paymentStatus === 'PENDING' && r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED')
    .sort((a, b) => Date.parse(a.registeredAt) - Date.parse(b.registeredAt));
}

const csvCell = (v: unknown) => {
  const raw = v == null ? '' : String(v);
  // Athletes choose their names: a cell that starts like a formula is kept as text in the spreadsheet.
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Column separator a spreadsheet of that language expects: French and Arabic Excel split on « ; » (their decimal mark is the comma). */
export const csvSeparator = (locale: string) => (locale === 'en' ? ',' : ';');

/** One CSV text: the header line, then one line per row; every cell goes through `csvCell` (which quotes « , » and « ; »). */
export const toCsv = (head: string[], rows: unknown[][], sep = ',') => [head.join(sep), ...rows.map((r) => r.map(csvCell).join(sep))].join('\n');

/** Amount in currency units: 3 decimals for TND (millimes), 2 otherwise. */
const units = (amount: unknown, currency: string) => {
  const digits = currency === 'TND' ? 3 : 2;
  return (Number(amount ?? 0) / 10 ** digits).toFixed(digits);
};

/** Spreadsheet export: one line per registration; amounts in currency units, dates in ISO. */
export function registrationsCsv(rows: Json[], sep = ','): string {
  return toCsv(
    ['name', 'username', 'category', 'registration', 'payment', 'amount', 'currency', 'registered_at'],
    rows.map((r) => [personName(r), r.user?.username ?? '', r.category?.name ?? '', r.registrationStatus, r.paymentStatus, units(r.finalPrice, r.currency), r.currency, r.registeredAt]),
    sep,
  );
}

/** Lane sheet to print for the floor: one line per lane of every heat, free lanes included. */
export function heatsCsv(heats: Json[], sep = ','): string {
  const rows: unknown[][] = [];
  for (const h of heats) {
    const byLane = new Map<number, Json>((h.lanes ?? []).map((l: Json) => [l.lane, l]));
    for (let n = 1; n <= (h.laneCount ?? 0); n++) {
      const l = byLane.get(n);
      rows.push([h.name, h.startsAt ?? '', h.workout?.name ?? '', h.category?.name ?? '', n, l ? personName(l) : '', l?.athlete?.username ?? '']);
    }
  }
  return toCsv(['heat', 'starts_at', 'wod', 'category', 'lane', 'athlete', 'username'], rows, sep);
}

export function couponsCsv(coupons: Json[], categories: Json[], currency: string, sep = ','): string {
  const names = new Map(categories.map((k) => [k.id, k.name]));
  return toCsv(
    ['code', 'type', 'value', 'category', 'used', 'max_uses', 'expires_at', 'active'],
    coupons.map((k) => [
      k.code,
      k.type,
      k.type === 'PERCENTAGE' ? k.value : k.type === 'FIXED_AMOUNT' ? units(k.value, currency) : '',
      k.categoryId ? (names.get(k.categoryId) ?? '') : '',
      k.usedCount ?? 0,
      k.maxUses ?? '',
      k.expiresAt ?? '',
      k.active ? 'yes' : 'no',
    ]),
    sep,
  );
}

export const staffCsv = (rows: Json[], sep = ',') => {
  const groups = staffByRole(rows);
  return toCsv(['role', 'name', 'username'], STAFF_ORDER.flatMap((role) => groups[role].map((s) => [role, personName(s), s.user?.username ?? ''])), sep);
};

export const leaderboardCsv = (rows: Json[], category: string, sep = ',') =>
  toCsv(['category', 'rank', 'name', 'username', 'points', 'pending'], rows.map((r) => [category, r.rank, r.athlete?.fullName || r.athlete?.username || '', r.athlete?.username ?? '', r.totalPoints, r.pending ?? 0]), sep);

/** `<address name>-<list>.csv`, so the organizer's downloads stay apart. */
export const csvFileName = (c: Json, list: string) => `${c.slug || 'event'}-${list}.csv`;

// ───────────── Planning ─────────────

/** The free lane numbers of a heat: 1 … laneCount minus the taken ones. */
export function freeLanes(heat: Json): number[] {
  const taken = new Set((heat.lanes ?? []).map((l: Json) => l.lane));
  return Array.from({ length: heat.laneCount ?? 0 }, (_, i) => i + 1).filter((n) => !taken.has(n));
}

/** Who can still go in this heat (the server's rules): confirmed, of the heat's category when it has one, not already in it. */
export function laneCandidates(heat: Json, registrations: Json[]): Json[] {
  const inHeat = new Set((heat.lanes ?? []).map((l: Json) => l.registrationId));
  return registrations.filter((r) => r.registrationStatus === 'CONFIRMED' && (!heat.category?.id || r.categoryId === heat.category.id) && !inHeat.has(r.id));
}

export type HeatFilter = { day: string | null; categoryId: string | null; workoutId: string | null; q: string };

export const heatDays = (heats: Json[]) => [...new Set(heats.filter((h) => h.startsAt).map((h) => localDay(h.startsAt)))].sort();

export function filterHeats(heats: Json[], f: HeatFilter): Json[] {
  const q = fold(f.q.trim());
  return heats.filter(
    (h) =>
      (!f.day || (h.startsAt && localDay(h.startsAt) === f.day)) &&
      (!f.categoryId || h.category?.id === f.categoryId) &&
      (!f.workoutId || h.workout?.id === f.workoutId) &&
      (!q || (h.lanes ?? []).some((l: Json) => fold(`${personName(l)} ${l.athlete?.username ?? ''}`).includes(q))),
  );
}

export type Timetable = { current: Json | null; next: Json | null; done: number; total: number };

/** The clock of the event day: the heat running now, the next one to start, how many have ended. Heats without a start time are not counted; a heat without a duration ends when it starts. */
export function timetable(heats: Json[], now: number): Timetable {
  const timed = heats.filter((h) => !Number.isNaN(startOf(h))).sort((a, b) => startOf(a) - startOf(b));
  return {
    current: timed.find((h) => startOf(h) <= now && now < endOf(h)) ?? null,
    next: timed.find((h) => startOf(h) > now) ?? null,
    done: timed.filter((h) => endOf(h) <= now).length,
    total: timed.length,
  };
}

/** « Retard »: the heats of the day being run that start after now, in running order (started heats, heats without a time and the other days stay where they are). */
export function delayTargets(heats: Json[], now: number): Json[] {
  const later = heats.filter((h) => startOf(h) > now).sort((a, b) => startOf(a) - startOf(b));
  const day = later.length ? localDay(later[0].startsAt) : null;
  return later.filter((h) => localDay(h.startsAt) === day);
}

export const shiftedStart = (h: Json, minutes: number) => new Date(startOf(h) + minutes * 60_000).toISOString();

/** Minutes of a delay: a whole number from 1 to 600 (the server's longest heat), else null. */
export const delayMinutes = (s: string): number | null => (isInt(s, 1, 600) ? Number(s) : null);

/** Moves each heat in order, one `PUT` each, and goes on after a failure; returns the heats that did not move. */
export async function runDelay(targets: Json[], minutes: number, put: (heatId: string, startsAt: string) => Promise<unknown>): Promise<Json[]> {
  const failed: Json[] = [];
  for (const h of targets) {
    try {
      await put(h.id, shiftedStart(h, minutes));
    } catch {
      failed.push(h);
    }
  }
  return failed;
}

export type HeatDraft = { id?: string; name: string; workoutId: string | null; categoryId: string | null; start: Date | null; duration: string; lanes: string };

export function heatDraft(h: Json | null): HeatDraft {
  if (!h) return { name: '', workoutId: null, categoryId: null, start: null, duration: '15', lanes: '8' };
  return {
    id: h.id,
    name: h.name ?? '',
    workoutId: h.workout?.id ?? null,
    categoryId: h.category?.id ?? null,
    start: h.startsAt ? new Date(h.startsAt) : null,
    duration: h.durationMin == null ? '' : String(h.durationMin),
    lanes: String(h.laneCount ?? ''),
  };
}

/** The server's heat rules: name up to 80, duration 1 to 600 minutes, 1 to 40 lanes. */
export const heatValid = (d: HeatDraft) => d.name.trim().length <= 80 && optInt(d.duration, 1, 600) && isInt(d.lanes, 1, 40);

/** A new heat gets only what is filled; an edit sends the WOD, category and duration set back to none as `null` (the server keeps the fields a `PUT` leaves out). */
export function heatBody(d: HeatDraft): Json {
  const cleared = d.id ? null : undefined;
  const body: Json = {
    ...(d.name.trim() ? { name: d.name.trim() } : {}),
    workoutId: d.workoutId ?? cleared,
    categoryId: d.categoryId ?? cleared,
    ...(d.start ? { startsAt: d.start.toISOString() } : {}),
    durationMin: d.duration.trim() ? Number(d.duration) : cleared,
    laneCount: Number(d.lanes),
  };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return body;
}

export type AutoDraft = { categoryId: string | null; workoutId: string | null; lanes: string; start: Date | null; interval: string };

export const autoValid = (d: AutoDraft) => !!d.categoryId && isInt(d.lanes, 1, 40) && optInt(d.interval, 1, 600);

export function autoBody(d: AutoDraft): Json {
  return {
    categoryId: d.categoryId,
    ...(d.workoutId ? { workoutId: d.workoutId } : {}),
    laneCount: Number(d.lanes),
    ...(d.start ? { startsAt: d.start.toISOString() } : {}),
    ...(d.interval.trim() ? { intervalMin: Number(d.interval) } : {}),
  };
}

// ───────────── Team ─────────────

export const STAFF_ORDER = ['ORGANIZER', 'HEAD_JUDGE', 'JUDGE'] as const;
export type StaffRole = (typeof STAFF_ORDER)[number];

export function staffByRole(rows: Json[]): Record<StaffRole, Json[]> {
  const out: Record<StaffRole, Json[]> = { ORGANIZER: [], HEAD_JUDGE: [], JUDGE: [] };
  for (const s of rows) out[s.role as StaffRole]?.push(s);
  for (const k of STAFF_ORDER) out[k].sort((a, b) => personName(a).localeCompare(personName(b)));
  return out;
}

// ───────────── Promo codes ─────────────

export type CouponKind = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE';
export type CouponDraft = { code: string; type: CouponKind; value: string; categoryId: string | null; maxUses: string; expires: Date | null; quantity: string };

export const couponDraft = (): CouponDraft => ({ code: '', type: 'PERCENTAGE', value: '10', categoryId: null, maxUses: '', expires: null, quantity: '1' });

/** Codes are upper case, spaces become dashes. */
export const normalizeCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '-');

export const MAX_BATCH = 50;

/** `CODE` alone, or `CODE-1` … `CODE-N` for a batch. */
export const batchCodes = (code: string, quantity: number) => (quantity <= 1 ? [code] : Array.from({ length: quantity }, (_, i) => `${code}-${i + 1}`));

/** The server's rules (every code of the batch included): A–Z 0–9 _ - from 3 to 32, 1 to 100 %, an amount above 0, max uses ≥ 1; a batch of 1 to 50. */
export function couponValid(d: CouponDraft): boolean {
  if (!optInt(d.quantity, 1, MAX_BATCH)) return false;
  const quantity = d.quantity.trim() ? Number(d.quantity) : 1;
  if (!batchCodes(normalizeCode(d.code), quantity).every((c) => /^[A-Z0-9_-]{3,32}$/.test(c))) return false;
  if (d.type === 'PERCENTAGE' && !isInt(d.value, 1, 100)) return false;
  if (d.type === 'FIXED_AMOUNT' && !((toMillimes(d.value) ?? 0) > 0)) return false;
  return optInt(d.maxUses, 1, Number.MAX_SAFE_INTEGER);
}

export function couponBody(d: CouponDraft, code: string): Json {
  return {
    code,
    type: d.type,
    ...(d.type === 'PERCENTAGE' ? { value: Number(d.value) } : d.type === 'FIXED_AMOUNT' ? { value: toMillimes(d.value) } : {}),
    ...(d.categoryId ? { categoryId: d.categoryId } : {}),
    ...(d.maxUses.trim() ? { maxUses: Number(d.maxUses) } : {}),
    ...(d.expires ? { expiresAt: d.expires.toISOString() } : {}),
  };
}

export type BatchResult = { created: string[]; taken: string[]; error: unknown };

/** Creates the codes one at a time: a code already taken is skipped and reported; any other error stops the batch. */
export async function createCoupons(codes: string[], post: (code: string) => Promise<unknown>): Promise<BatchResult> {
  const r: BatchResult = { created: [], taken: [], error: null };
  for (const code of codes) {
    try {
      await post(code);
      r.created.push(code);
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.some((f) => f.field === 'code' && f.code === 'TAKEN')) {
        r.taken.push(code);
      } else {
        r.error = e;
        break;
      }
    }
  }
  return r;
}

export const topUsed = (coupons: Json[], n = 5) => coupons.filter((c) => (c.usedCount ?? 0) > 0).sort((a, b) => b.usedCount - a.usedCount).slice(0, n);

// ───────────── Announcements ─────────────

export function announcementValid(title: string, body: string): boolean {
  const t = title.trim().length;
  const b = body.trim().length;
  return t >= 3 && t <= 120 && b >= 1 && b <= 5000;
}

// ───────────── Dashboard ─────────────

export type Distribution = { byCategory: { id: string; name: string; count: number }[]; women: number; men: number; mixed: number; perDay: { day: string; count: number }[] };

/** Registrations still standing, per category (in the event's order), women / men / mixed from the category, and per day of registration. */
export function distribution(rows: Json[], categories: Json[]): Distribution {
  const live = rows.filter((r) => r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED');
  const perCategory = new Map<string, number>();
  const perDay = new Map<string, number>();
  for (const r of live) {
    perCategory.set(r.categoryId, (perCategory.get(r.categoryId) ?? 0) + 1);
    const day = localDay(r.registeredAt);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const gender = new Map(categories.map((k) => [k.id, k.gender]));
  const count = (g: string) => live.filter((r) => gender.get(r.categoryId) === g).length;
  return {
    byCategory: categories.filter((k) => perCategory.has(k.id)).map((k) => ({ id: k.id, name: k.name, count: perCategory.get(k.id)! })),
    women: count('FEMALE'),
    men: count('MALE'),
    mixed: count('MIXED'),
    perDay: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => ({ day, count: n })),
  };
}
