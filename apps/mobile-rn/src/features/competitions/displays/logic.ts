import type { Json } from '../../../core/api/client';
import { emptyResult, raceTotalMs, type Flow, type RaceResult } from '../organizer/logic-hybrid';

/**
 * Organisation update, phase 9: what the displays compute. A display loads a snapshot, then applies the live
 * updates (`seq` orders them); it never relies on the updates alone.
 */

export type LaneLive = { lane: number; seq: number } & Json;

/** The latest update of each lane; an older one arriving late is dropped. */
export function keepNewer(lanes: Record<number, LaneLive>, p: LaneLive): Record<number, LaneLive> {
  const had = lanes[p.lane];
  if (had && had.seq >= p.seq) return lanes;
  return { ...lanes, [p.lane]: { ...had, ...p } };
}

/** Replays one judge event (`wave.<id>`) on the results of a wave; a result saved with a later `seq` already has it. */
export function applyRaceEvent(results: RaceResult[], waveId: string, event: string, p: Json): RaceResult[] {
  const id = `${waveId}:${p.registrationId}`;
  const had = results.find((r) => r.id === id) ?? emptyResult(waveId, p.registrationId);
  if (typeof p.seq === 'number' && (had.seq ?? 0) >= p.seq) return results;
  let next = had;
  switch (event) {
    case 'split': {
      const splits = had.splits.slice(0, p.stageIndex);
      splits[p.stageIndex] = p.atMs;
      next = { ...had, splits, finished: false };
      break;
    }
    case 'clear':
      next = { ...had, splits: had.splits.slice(0, p.stageIndex), finished: false };
      break;
    case 'penalty':
      next = { ...had, adjustments: [...had.adjustments, p.value] };
      break;
    case 'done':
      next = { ...had, splits: Array.isArray(p.splits) ? p.splits : had.splits, finished: true };
      break;
    case 'dnf':
      next = { ...had, dnf: true };
      break;
    default:
      return results;
  }
  if (typeof p.seq === 'number') next = { ...next, seq: p.seq };
  return results.some((r) => r.id === id) ? results.map((r) => (r.id === id ? next : r)) : [...results, next];
}

export type RaceStatus = 'FINISHED' | 'RACING' | 'WAITING' | 'DNF';
export type RaceRow = { registrationId: string; name: string; status: RaceStatus; stagesDone: number; splits: number[]; lastMs: number | null; totalMs: number | null; rank: number | null; gapMs: number | null };

const ORDER: Record<RaceStatus, number> = { FINISHED: 0, RACING: 1, WAITING: 2, DNF: 3 };

/** Finishers by total time, then racers by stages done and last split, then those not started, DNF last. */
export function raceRows(f: Flow, results: RaceResult[], athletes: { registrationId: string; name: string }[]): RaceRow[] {
  const rows: RaceRow[] = athletes.map((a) => {
    const r = results.find((x) => x.registrationId === a.registrationId);
    const splits = r?.splits ?? [];
    const status: RaceStatus = r?.dnf ? 'DNF' : r?.finished ? 'FINISHED' : splits.length ? 'RACING' : 'WAITING';
    return { registrationId: a.registrationId, name: a.name, status, stagesDone: splits.length, splits, lastMs: splits.length ? splits[splits.length - 1] : null, totalMs: r ? raceTotalMs(f, r) : null, rank: null, gapMs: null };
  });
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === 'FINISHED' ? (a.totalMs ?? 0) - (b.totalMs ?? 0) : b.stagesDone - a.stagesDone || (a.lastMs ?? 0) - (b.lastMs ?? 0)));
  const bestTotal = rows.find((r) => r.status === 'FINISHED')?.totalMs ?? null;
  /** Fastest split at the end of stage i among everyone who got there. */
  const bestAt = (i: number) => Math.min(...rows.filter((r) => r.splits.length > i && r.status !== 'DNF').map((r) => r.splits[i]));
  let rank = 0;
  for (const r of rows) {
    if (r.status === 'FINISHED' || r.status === 'RACING') r.rank = ++rank;
    if (r.status === 'FINISHED' && bestTotal != null) r.gapMs = (r.totalMs ?? 0) - bestTotal;
    if (r.status === 'RACING') r.gapMs = (r.lastMs ?? 0) - bestAt(r.stagesDone - 1);
  }
  return rows;
}

/** Index of the division shown now when the screen turns through `count` of them every `periodSec`. */
export const rotation = (count: number, periodSec: number, startMs: number, nowMs: number) => (count > 0 ? Math.floor(Math.max(0, nowMs - startMs) / (Math.max(1, periodSec) * 1000)) % count : 0);

/** Heats (or waves) on the floor now, and the next three. */
export function scheduleNow<T extends { startsAt?: string | null; durationMin?: number | null }>(items: T[], nowMs: number): { active: T[]; next: T[] } {
  const timed = items.filter((h) => h.startsAt).sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!));
  const start = (h: T) => Date.parse(h.startsAt!);
  const end = (h: T) => start(h) + (h.durationMin ?? 0) * 60_000;
  return { active: timed.filter((h) => start(h) <= nowMs && nowMs < end(h)), next: timed.filter((h) => start(h) > nowMs).slice(0, 3) };
}
