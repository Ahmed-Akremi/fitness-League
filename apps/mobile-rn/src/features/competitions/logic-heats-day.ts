import type { Json } from '../../core/api/client';
import { localDay } from './organizer/logic-b';

/**
 * « Heats of the day » (athlete side, Circle21 §3.9): the running order of one day, only my heats on demand, a search
 * for a heat or an athlete, and which heat is on the floor now.
 */

export type HeatState = 'LIVE' | 'DONE' | 'UPCOMING';
export type HeatQuery = { day: string | null; mineOnly: boolean; q: string };

const fold = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const laneName = (l: Json) => `${l.athlete?.fullName ?? ''} ${l.athlete?.username ?? ''} ${l.teamName ?? ''}`;

/** On the floor once started (by the organizer, or by the clock), done once its time is over. */
export function heatState(h: Json, nowMs: number): HeatState {
  const start = h.startsAt ? Date.parse(h.startsAt) : NaN;
  const end = start + (h.durationMin ?? 0) * 60_000;
  if (h.finishedAt || (Number.isFinite(start) && h.durationMin && nowMs >= end)) return 'DONE';
  if (h.startedAt || (Number.isFinite(start) && nowMs >= start)) return 'LIVE';
  return 'UPCOMING';
}

export const hasMine = (h: Json) => (h.lanes ?? []).some((l: Json) => l.mine);

/** The heat's name, workout or division, or the name of an athlete in it. */
export function heatMatches(h: Json, q: string): boolean {
  const s = fold(q).trim();
  if (!s) return true;
  return [h.name, h.workout?.name, h.category?.name].some((x) => fold(x).includes(s)) || (h.lanes ?? []).some((l: Json) => fold(laneName(l)).includes(s));
}

/** The lanes whose athlete matches the search, to highlight them. */
export const matchingLanes = (h: Json, q: string): number[] => (fold(q).trim() ? (h.lanes ?? []).filter((l: Json) => fold(laneName(l)).includes(fold(q).trim())).map((l: Json) => l.lane) : []);

export function heatsOfDay(heats: Json[], f: HeatQuery): Json[] {
  return [...heats]
    .filter((h) => (!f.day || (h.startsAt && localDay(h.startsAt) === f.day)) && (!f.mineOnly || hasMine(h)) && heatMatches(h, f.q))
    .sort((a, b) => (a.startsAt ? Date.parse(a.startsAt) : Infinity) - (b.startsAt ? Date.parse(b.startsAt) : Infinity) || (a.number ?? 0) - (b.number ?? 0));
}

/** The day to open on: today when it has heats, else the next day with heats, else the first. */
export function defaultDay(days: string[], nowMs: number): string | null {
  if (!days.length) return null;
  const today = localDay(new Date(nowMs).toISOString());
  return days.find((d) => d >= today) ?? days[days.length - 1];
}

/** Every lane of the heat, with the empty ones (Circle21's « Empty lane »). */
export function lanesWithEmpty(h: Json): { lane: number; entry: Json | null }[] {
  const byLane = new Map<number, Json>((h.lanes ?? []).map((l: Json) => [l.lane, l]));
  const count = Math.max(h.laneCount ?? 0, ...(h.lanes ?? []).map((l: Json) => l.lane));
  return Array.from({ length: count }, (_, i) => ({ lane: i + 1, entry: byLane.get(i + 1) ?? null }));
}
