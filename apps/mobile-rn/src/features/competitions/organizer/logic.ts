import type { Json } from '../../../core/api/client';

/** Organizer space (spec 2026-10-14): the rules the organizer screens share. */

export type ManageTab = 'dashboard' | 'general' | 'categories' | 'wods' | 'planning' | 'participants' | 'team' | 'leaderboard';
export type ChecklistItem = 'DESCRIPTION' | 'DATES' | 'COVER' | 'CATEGORY' | 'WOD';
export type PublicationState = 'DRAFT' | 'REQUESTED' | 'RETURNED' | 'PUBLISHED' | 'CANCELLED';
export type EventFormat = 'ONSITE' | 'ONLINE' | 'HYBRID';

/** Banner limit of the API (PNG, JPEG or WebP). */
export const COVER_MAX_BYTES = 5 * 1024 * 1024;

export const CHECKLIST: ChecklistItem[] = ['DESCRIPTION', 'DATES', 'COVER', 'CATEGORY', 'WOD'];

/** Where each missing item is fixed. */
export const TAB_FOR: Record<ChecklistItem, ManageTab> = { DESCRIPTION: 'general', DATES: 'general', COVER: 'general', CATEGORY: 'categories', WOD: 'wods' };

/** The organizer's next statuses once an admin has published the event: the server's table minus cancellation, which stays with the admins. */
export const ORGANIZER_NEXT: Record<string, string[]> = {
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED'],
  REGISTRATION_CLOSED: ['REGISTRATION_OPEN', 'ACTIVE', 'SUBMISSION_OPEN'],
  ACTIVE: ['SUBMISSION_OPEN', 'JUDGING'],
  SUBMISSION_OPEN: ['JUDGING'],
  JUDGING: ['PROVISIONAL_LEADERBOARD'],
  PROVISIONAL_LEADERBOARD: ['JUDGING'],
  FINAL_LEADERBOARD: ['FINISHED'],
};

export const SCORE_TYPES = ['MOVEMENT_REPS', 'REPS', 'TIME', 'ROUNDS_REPS', 'LOAD', 'MAX_WEIGHT', 'DISTANCE', 'CALORIES', 'POINTS', 'COMPLEX'] as const;

const time = (v: unknown) => (typeof v === 'string' || v instanceof Date ? new Date(v).getTime() : NaN);

/** The server's rules: registration opens before it closes; the event does not end before it starts. */
export function datesValid(x: { registrationStart: unknown; registrationEnd: unknown; eventStart: unknown; eventEnd: unknown }): boolean {
  return time(x.registrationStart) < time(x.registrationEnd) && time(x.eventStart) <= time(x.eventEnd);
}

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

/** Address name of a new event (server: a-z, 0-9 and single dashes, 3 to 80 characters). `event-xxxx` when the title has no Latin letter. */
export function slugFor(title: string, suffix: string = randomSuffix()): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/, '');
  return `${base.length >= 3 ? base : 'event'}-${suffix}`;
}

/** What the draft still needs before the organizer can ask for publication (the server checks banner, category and WOD again). */
export function missingForPublication(c: Json): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  if (!String(c.description ?? '').trim()) out.push('DESCRIPTION');
  if (!datesValid({ registrationStart: c.deadlines?.registrationStart, registrationEnd: c.registrationEnd, eventStart: c.eventStart, eventEnd: c.eventEnd })) out.push('DATES');
  if (!c.coverUrl) out.push('COVER');
  if (!(c.categories ?? []).some((x: Json) => x.active)) out.push('CATEGORY');
  if (!(c.workouts ?? []).length) out.push('WOD');
  return out;
}

export function publicationState(c: Json): PublicationState {
  if (c.status === 'CANCELLED') return 'CANCELLED';
  if (c.status !== 'DRAFT') return 'PUBLISHED';
  if (c.publicationRequestedAt) return 'REQUESTED';
  if (c.publicationNote) return 'RETURNED';
  return 'DRAFT';
}

/** "35", "12,5" (TND) → millimes; null when it is not an amount. */
export function toMillimes(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  return Math.round(Number(s) * 1000);
}

export const fromMillimes = (m: number | null | undefined) => (m == null ? '' : String(m / 1000));

export const nextWodNumber = (workouts: Json[]) => workouts.reduce((n, w) => Math.max(n, w.number ?? 0), 0) + 1;

const num = (s: string) => Number(s.trim().replace(',', '.'));
const intOrNull = (s: string) => (s.trim() ? Number(s.trim()) : null);
const isInt = (s: string, min: number, max = Number.MAX_SAFE_INTEGER) => !s.trim() || (Number.isInteger(Number(s.trim())) && Number(s.trim()) >= min && Number(s.trim()) <= max);

// ───────────── Categories ─────────────

export type CatDraft = { id?: string; name: string; gender: 'MALE' | 'FEMALE' | 'MIXED'; minAge: string; maxAge: string; level: string; max: string; price: string; active: boolean };

export function catDraft(c: Json | null): CatDraft {
  if (!c) return { name: '', gender: 'MIXED', minAge: '', maxAge: '', level: '', max: '', price: '', active: true };
  return {
    id: c.id,
    name: c.name ?? '',
    gender: c.gender,
    minAge: c.minAge == null ? '' : String(c.minAge),
    maxAge: c.maxAge == null ? '' : String(c.maxAge),
    level: c.level ?? '',
    max: c.maxParticipants == null ? '' : String(c.maxParticipants),
    price: fromMillimes(c.registrationPriceOverride),
    active: c.active !== false,
  };
}

/** The server's category rules: name 2 to 120, ages 0 to 120 with min ≤ max, places ≥ 1, a valid price or none. */
export function catValid(d: CatDraft): boolean {
  const name = d.name.trim();
  if (name.length < 2 || name.length > 120 || d.level.trim().length > 40) return false;
  if (!isInt(d.minAge, 0, 120) || !isInt(d.maxAge, 0, 120) || !isInt(d.max, 1)) return false;
  if (d.minAge.trim() && d.maxAge.trim() && Number(d.minAge) > Number(d.maxAge)) return false;
  return !d.price.trim() || toMillimes(d.price) != null;
}

export function catBody(d: CatDraft): Json {
  return {
    name: d.name.trim(),
    gender: d.gender,
    minAge: intOrNull(d.minAge),
    maxAge: intOrNull(d.maxAge),
    level: d.level.trim(),
    maxParticipants: intOrNull(d.max),
    registrationPriceOverride: d.price.trim() ? toMillimes(d.price) : null,
  };
}

// ───────────── WODs ─────────────

export type WodMovement = { name: string; points: string };
export type WodDraft = {
  id?: string;
  number: number;
  name: string;
  description: string;
  standards: string;
  scoreType: string;
  method: 'DIRECT_POINTS' | 'PLACEMENT_POINTS';
  table: string;
  max: string;
  min: string;
  capMin: string;
  videoUrl: string;
  movements: WodMovement[];
  start: Date;
  end: Date;
};

const DEFAULT_TABLE = '100, 95, 90, 85, 80';
const placements = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).map(Number);

export function wodDraft(w: Json | null, defaults: { number: number; start: Date; end: Date }): WodDraft {
  if (!w) {
    return { number: defaults.number, name: `WOD ${defaults.number}`, description: '', standards: '', scoreType: 'MOVEMENT_REPS', method: 'DIRECT_POINTS', table: DEFAULT_TABLE, max: '100', min: '0', capMin: '', videoUrl: '', movements: [{ name: '', points: '1' }], start: defaults.start, end: defaults.end };
  }
  return {
    id: w.id,
    number: w.number,
    name: w.name ?? '',
    description: w.description ?? '',
    standards: w.standards ?? '',
    scoreType: w.scoreType,
    method: w.scoringMethod ?? 'DIRECT_POINTS',
    table: (w.placementTable ?? []).join(', ') || DEFAULT_TABLE,
    max: String(w.maximumPoints ?? 100),
    min: String(w.minimumPoints ?? 0),
    capMin: w.timeCapS ? String(w.timeCapS / 60) : '',
    videoUrl: w.videoUrl ?? '',
    movements: (w.movements ?? []).map((m: Json) => ({ name: m.name, points: String(m.pointsPerRep) })),
    start: new Date(w.submissionStart ?? defaults.start),
    end: new Date(w.submissionDeadline ?? defaults.end),
  };
}

/** The server's checkWorkout rules, so the organizer sees the problem before sending. */
export function wodValid(d: WodDraft): boolean {
  const max = num(d.max);
  const min = d.min.trim() ? num(d.min) : 0;
  if (!d.name.trim() || d.name.trim().length > 80 || !d.description.trim()) return false;
  if (!Number.isInteger(max) || max < 1 || max > 100_000 || !Number.isInteger(min) || min < 0 || min > max) return false;
  if (!(d.start.getTime() < d.end.getTime())) return false;
  if (d.capMin.trim() && !(num(d.capMin) >= 1)) return false;
  if (d.method === 'PLACEMENT_POINTS') {
    const t = placements(d.table);
    if (!t.length || t.some((p, i) => !Number.isInteger(p) || p > max || (i > 0 && p > t[i - 1]))) return false;
  }
  if (d.scoreType === 'MOVEMENT_REPS') {
    const ms = d.movements.filter((m) => m.name.trim());
    if (!ms.length || ms.some((m) => !(num(m.points) > 0))) return false;
  }
  return true;
}

export function wodBody(d: WodDraft): Json {
  return {
    number: d.number,
    name: d.name.trim(),
    description: d.description.trim(),
    standards: d.standards.trim(),
    scoreType: d.scoreType,
    scoringMethod: d.method,
    maximumPoints: num(d.max),
    minimumPoints: d.min.trim() ? num(d.min) : 0,
    ...(d.method === 'PLACEMENT_POINTS' ? { placementTable: placements(d.table) } : {}),
    // Empty fields are sent as cleared: the server keeps what a PUT leaves out.
    timeCapS: d.capMin.trim() ? Math.round(num(d.capMin) * 60) : null,
    videoUrl: d.videoUrl.trim(),
    movements: d.scoreType === 'MOVEMENT_REPS' ? d.movements.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), pointsPerRep: num(m.points) })) : [],
    submissionStart: d.start.toISOString(),
    submissionDeadline: d.end.toISOString(),
  };
}
