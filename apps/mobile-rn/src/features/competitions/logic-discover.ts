import type { Json } from '../../core/api/client';

/**
 * Event list (athlete side, Circle21-style discovery): search and filters applied on the device to the list the API
 * returns, the date block of a card and how long registration stays open.
 */

export type EventType = 'FUNCTIONAL' | 'HYBRID';
export type EventFormat = 'ONSITE' | 'ONLINE' | 'HYBRID';
export type When = 'ANY' | 'MONTH' | 'QUARTER';
export type Discover = { q: string; types: EventType[]; formats: EventFormat[]; countries: string[]; when: When };

export const EMPTY_DISCOVER: Discover = { q: '', types: [], formats: [], countries: [], when: 'ANY' };

const DAY = 86_400_000;

/** The organizer's event style (a local field); events made before it are functional fitness. */
export const typeOf = (c: Json): EventType => (c.eventStyle === 'HYBRID_RACE' ? 'HYBRID' : 'FUNCTIONAL');

/** Accents and case aside: « sousse » finds « Soussé ». */
const fold = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function matches(c: Json, f: Discover, nowMs: number): boolean {
  const q = fold(f.q).trim();
  if (q && ![c.title, c.city, c.location, c.shortDescription, c.label].some((x) => fold(x).includes(q))) return false;
  if (f.types.length && !f.types.includes(typeOf(c))) return false;
  if (f.formats.length && !f.formats.includes(c.format)) return false;
  if (f.countries.length && !f.countries.includes(String(c.countryCode ?? '').toUpperCase())) return false;
  if (f.when !== 'ANY') {
    const start = Date.parse(c.eventStart);
    const horizon = nowMs + (f.when === 'MONTH' ? 31 : 92) * DAY;
    // Events already running count as « soon ».
    const end = Date.parse(c.eventEnd ?? c.eventStart);
    if (!(end >= nowMs && start <= horizon)) return false;
  }
  return true;
}

export const filterEvents = (list: Json[], f: Discover, nowMs: number) => list.filter((c) => matches(c, f, nowMs));

/** How many filters are on (the search aside): the badge of the « Filters » button. */
export const activeFilters = (f: Discover) => f.types.length + f.formats.length + f.countries.length + (f.when === 'ANY' ? 0 : 1);

/** The countries of the list, most events first, for the country chips. */
export function countriesOf(list: Json[]): string[] {
  const n = new Map<string, number>();
  for (const c of list) {
    const code = String(c.countryCode ?? '').toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) n.set(code, (n.get(code) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code]) => code);
}

export const toggle = <T,>(xs: T[], x: T): T[] => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

/** Whole days left to register (0 on the last day); null once closed or without a date. */
export function daysToRegister(c: Json, nowMs: number): number | null {
  if (c.status !== 'REGISTRATION_OPEN' || !c.registrationEnd) return null;
  const left = Date.parse(c.registrationEnd) - nowMs;
  return left < 0 ? null : Math.floor(left / DAY);
}

/** A flag from a two-letter country code (🇹🇳); nothing for anything else. */
export function flagOf(code: unknown): string {
  const c = String(code ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
