import type { Json } from '../../../core/api/client';
import { parseDuration } from '../../../core/utils/format';
import { fold } from './logic-b';
import { raceTotalMs, type Flow, type RaceResult } from './logic-hybrid';
import type { Penalties } from './logic-scorecard';

/**
 * Organisation update, phase 10: results. The ranking rules of the prompt (§4), as pure functions: the server keeps
 * its own leaderboard; these give the organizer's choices (points table, visibility, freeze) and the local results
 * (hybrid races, imported scores) until the server takes them over.
 */

// ───────────── The organizer's choices ─────────────

/** `table`: `SERVER` keeps the server's points; `frozenAt`: the displays keep the standings of that moment. */
export type ResultsSettings = { table: 'SERVER' | 'RANK' | 'DESCENDING'; first: number; step: number; visibility: Visibility; finalists: number | null; frozenAt: string | null };

export const resultsSettingsOf = (c: Json): ResultsSettings => ({ table: 'SERVER', first: 100, step: 3, visibility: 'RANKED', finalists: null, frozenAt: null, ...(c.resultsSettings ?? {}) });

export const tableOf = (s: ResultsSettings): PointsTable | null => (s.table === 'SERVER' ? null : s.table === 'RANK' ? { kind: 'RANK' } : { kind: 'DESCENDING', first: s.first, step: s.step });

// ───────────── Functional fitness: one workout ─────────────

export type FfEntry = { id: string; timeS?: number | null; reps?: number | null; value?: number | null; capped?: boolean; tieBreakS?: number | null; scaled?: boolean; dnf?: boolean; penaltySec?: number };
export type Ranked = { id: string; rank: number };

/**
 * For Time: finishers by time + penalties, then capped athletes by reps; other score types: the higher the better.
 * The tie-break time separates equal scores; equal entries share a rank. Scaled after Rx (`scaledLast`), DNF last.
 */
export function rankFunctional(entries: FfEntry[], scoreType: string, opts: { scaledLast?: boolean } = {}): Ranked[] {
  const scaledLast = opts.scaledLast ?? true;
  const time = scoreType === 'TIME';
  const group = (e: FfEntry) => (e.dnf ? 4 : 0) + (scaledLast && e.scaled ? 2 : 0) + (time && e.capped ? 1 : 0);
  /** Lower is better. */
  const score = (e: FfEntry) => (time && !e.capped ? (e.timeS ?? Infinity) + (e.penaltySec ?? 0) : -(e.reps ?? e.value ?? -Infinity));
  const tie = (e: FfEntry) => e.tieBreakS ?? Infinity;
  // Equal infinities (no time, no tie-break) compare equal: Infinity - Infinity is NaN.
  const diff = (x: number, y: number) => (x === y ? 0 : x - y);
  const cmp = (a: FfEntry, b: FfEntry) => group(a) - group(b) || diff(score(a), score(b)) || diff(tie(a), tie(b));
  const sorted = [...entries].sort(cmp);
  const out: Ranked[] = [];
  sorted.forEach((e, i) => out.push({ id: e.id, rank: i > 0 && cmp(sorted[i - 1], e) === 0 ? out[i - 1].rank : i + 1 }));
  return out;
}

/** Seconds added for the judge's penalty counts; minor and major are a share of the time. */
export function penaltySeconds(p: Penalties, n: { noReps?: number; missedReps?: number; minor?: number; major?: number }, timeS: number): number {
  return (n.noReps ?? 0) * p.noRepSeconds + (n.missedReps ?? 0) * p.missedRepSeconds + (timeS * ((n.minor ?? 0) * p.minorPct + (n.major ?? 0) * p.majorPct)) / 100;
}

// ───────────── Points tables and overall ranking ─────────────

/** `RANK`: points = rank, the lowest total wins. `DESCENDING`: 100, 97, 94… the highest total wins. */
export type PointsTable = { kind: 'RANK' } | { kind: 'DESCENDING'; first: number; step: number };

export const pointsFor = (rank: number, t: PointsTable) => (t.kind === 'RANK' ? rank : Math.max(0, t.first - (rank - 1) * t.step));

/** Places in one workout from the server's points of each row (more points = better place; equal points share). */
export function wodRanks(rows: Json[], workoutId: string): Map<string, number> {
  const scored = rows.filter((r) => r.wodPoints?.[workoutId] != null).sort((a, b) => b.wodPoints[workoutId] - a.wodPoints[workoutId]);
  const out = new Map<string, number>();
  scored.forEach((r, i) => out.set(r.athlete.id, i > 0 && scored[i - 1].wodPoints[workoutId] === r.wodPoints[workoutId] ? out.get(scored[i - 1].athlete.id)! : i + 1));
  return out;
}

/**
 * The overall ranking with the organizer's table. Equal totals: more better places first (countback: most firsts,
 * then seconds…), then the better place in the last workout.
 */
export function overallRanking(rows: Json[], workouts: { id: string }[], table: PointsTable): (Json & { localRank: number; localTotal: number; places: (number | null)[] })[] {
  const ranks = workouts.map((w) => wodRanks(rows, w.id));
  const missing = rows.length + 1;
  const scored = rows.map((r) => {
    const places = ranks.map((m) => m.get(r.athlete.id) ?? null);
    const localTotal = places.reduce<number>((sum, p) => sum + (p == null ? (table.kind === 'RANK' ? missing : 0) : pointsFor(p, table)), 0);
    return { ...r, places, localTotal, localRank: 0 };
  });
  const better = table.kind === 'RANK' ? (a: number, b: number) => a - b : (a: number, b: number) => b - a;
  const countback = (a: (number | null)[], b: (number | null)[]) => {
    for (let place = 1; place <= rows.length; place++) {
      const d = b.filter((p) => p === place).length - a.filter((p) => p === place).length;
      if (d) return d;
    }
    return 0;
  };
  const last = (p: (number | null)[]) => p[p.length - 1] ?? missing;
  const cmp = (a: (typeof scored)[number], b: (typeof scored)[number]) => better(a.localTotal, b.localTotal) || countback(a.places, b.places) || last(a.places) - last(b.places);
  scored.sort(cmp);
  scored.forEach((r, i) => (r.localRank = i > 0 && cmp(scored[i - 1], r) === 0 ? scored[i - 1].localRank : i + 1));
  return scored;
}

// ───────────── Hybrid race ─────────────

export type HybridStatus = 'FINISHED' | 'CAPPED' | 'RACING' | 'WAITING' | 'DNF';
export type HybridRow = { registrationId: string; name: string; status: HybridStatus; stagesDone: number; splits: number[]; totalMs: number | null; lastMs: number | null; rank: number | null };

const ORDER: Record<HybridStatus, number> = { FINISHED: 0, CAPPED: 1, RACING: 1, WAITING: 2, DNF: 3 };

/**
 * Results of a race (ruling 4): finishers by total time (rule seconds included); then those stopped by the time cap
 * (or not finished), by stages done within the cap and their last split; DNF last, without a rank.
 */
export function hybridRanking(f: Flow, results: RaceResult[], athletes: { registrationId: string; name: string }[]): HybridRow[] {
  const cap = f.timeCapSec ? f.timeCapSec * 1000 : null;
  const rows: HybridRow[] = athletes.map((a) => {
    const r = results.find((x) => x.registrationId === a.registrationId);
    if (r?.importedMs != null) {
      const inTime = cap == null || r.importedMs <= cap;
      return { registrationId: a.registrationId, name: a.name, status: inTime ? 'FINISHED' : 'CAPPED', stagesDone: inTime ? f.stages.length : 0, splits: [], totalMs: inTime ? r.importedMs : null, lastMs: null, rank: null };
    }
    const all = r?.splits ?? [];
    const within = cap == null ? all : all.filter((s) => s <= cap);
    const overCap = cap != null && within.length < all.length;
    const status: HybridStatus = r?.dnf ? 'DNF' : r?.finished && !overCap ? 'FINISHED' : !all.length ? 'WAITING' : cap != null ? 'CAPPED' : 'RACING';
    const splits = status === 'DNF' ? all : within;
    return { registrationId: a.registrationId, name: a.name, status, stagesDone: splits.length, splits, totalMs: status === 'FINISHED' && r ? raceTotalMs(f, r) : null, lastMs: splits.length ? splits[splits.length - 1] : null, rank: null };
  });
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === 'FINISHED' ? (a.totalMs ?? 0) - (b.totalMs ?? 0) : b.stagesDone - a.stagesDone || (a.lastMs ?? 0) - (b.lastMs ?? 0)));
  let rank = 0;
  rows.forEach((r) => {
    if (r.status !== 'DNF' && r.status !== 'WAITING') r.rank = ++rank;
  });
  return rows;
}

/** Time of each station (runs hidden in the results columns); null for a station not reached. */
export function stationTimes(f: Flow, splits: number[]): (number | null)[] {
  return f.stages.flatMap((s, i) => (s.kind === 'STATION' ? [splits[i] != null ? splits[i] - (splits[i - 1] ?? 0) : null] : []));
}

// ───────────── Visibility and ages ─────────────

export type Visibility = 'RANKED' | 'RANDOM' | 'HIDDEN';

/** `RANDOM`: the same names in a fixed shuffled order, no ranks (a final's standings kept secret). */
export function visibleRows<T extends { rank?: number | null }>(rows: T[], v: Visibility, seed: string): T[] {
  if (v === 'RANKED') return rows;
  if (v === 'HIDDEN') return [];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const next = () => (h = (h * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const out = rows.map((r) => ({ ...r, rank: null }));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type AgeGroup = 'ALL' | 'U18' | '18-34' | '35-39' | '40-44' | '45-49' | '50+';
export const AGE_GROUPS: AgeGroup[] = ['ALL', 'U18', '18-34', '35-39', '40-44', '45-49', '50+'];
const AGE_RANGE: Record<AgeGroup, [number, number]> = { ALL: [0, 200], U18: [0, 17], '18-34': [18, 34], '35-39': [35, 39], '40-44': [40, 44], '45-49': [45, 49], '50+': [50, 200] };

/** Age in whole years on a day (`YYYY-MM-DD` strings or ISO). */
export function ageOn(birth: string, on: string): number {
  const b = new Date(birth);
  const d = new Date(on);
  const had = d.getUTCMonth() > b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() >= b.getUTCDate());
  return d.getUTCFullYear() - b.getUTCFullYear() - (had ? 0 : 1);
}

/** An unknown age only fits « all ». */
export const inAgeGroup = (age: number | null, g: AgeGroup) => g === 'ALL' || (age != null && age >= AGE_RANGE[g][0] && age <= AGE_RANGE[g][1]);

// ───────────── CSV import ─────────────

export type CsvLine = { line: number; name: string; score: string };
export type ImportCheck = { ok: { line: number; registrationId: string; name: string; raw: Json }[]; problems: { line: number; code: 'NO_MATCH' | 'BAD_SCORE' | 'DUPLICATE' }[] };

/** `name;score` lines (`;` or `,`), with or without a header row; line numbers count from 1 as in a spreadsheet. */
export function parseResultsCsv(text: string): CsvLine[] {
  const lines = text.split(/\r?\n/);
  const sep = (lines[0] ?? '').includes(';') ? ';' : ',';
  return lines
    .map((l, i) => {
      const [name = '', score = ''] = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
      return { line: i + 1, name, score };
    })
    .filter((l, i) => (l.name || l.score) && !(i === 0 && /^(name|nom|athl)/i.test(l.name)));
}

/** A score as typed in the sheet: `4:05` or `245` (For Time), `CAP+12`; a number otherwise. */
export function parseScore(scoreType: string, s: string): Json | null {
  const t = s.trim().toUpperCase().replace(/\s/g, '');
  if (scoreType === 'TIME') {
    const cap = t.match(/^CAP\+?(\d+)$/);
    if (cap) return { capped: true, reps: Number(cap[1]) };
    const timeS = t.includes(':') ? parseDuration(t) : /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : null;
    return timeS ? { timeS } : null;
  }
  const v = Number(t.replace(',', '.'));
  if (t === '' || !Number.isFinite(v) || v < 0) return null;
  return scoreType === 'REPS' ? (Number.isInteger(v) ? { reps: v } : null) : { value: v };
}

/** The dry run: who each line is (accents and case ignored), whether the score reads, and lines for the same athlete. */
export function matchImport(lines: CsvLine[], regs: { id: string; name: string }[], scoreType: string): ImportCheck {
  const check: ImportCheck = { ok: [], problems: [] };
  for (const l of lines) {
    const reg = regs.find((r) => fold(r.name).trim() === fold(l.name).trim());
    const raw = parseScore(scoreType, l.score);
    if (!reg) check.problems.push({ line: l.line, code: 'NO_MATCH' });
    else if (!raw) check.problems.push({ line: l.line, code: 'BAD_SCORE' });
    else if (check.ok.some((x) => x.registrationId === reg.id)) check.problems.push({ line: l.line, code: 'DUPLICATE' });
    else check.ok.push({ line: l.line, registrationId: reg.id, name: reg.name, raw });
  }
  return check;
}
