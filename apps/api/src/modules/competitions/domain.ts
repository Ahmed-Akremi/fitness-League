/**
 * Competitions — pure rules (no I/O): pricing, coupons, category eligibility, WOD points, leaderboard,
 * tie-breaks, podium. The service persists; everything that decides money, eligibility or ranks lives here
 * so it is unit-tested and the server stays the only source of truth.
 *
 * Money is an integer in minor units of the competition currency (TND millimes, EUR cents…).
 */

// ───────────── Pricing & coupons ─────────────

export type CouponType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE';

export interface CouponRule {
  code: string;
  type: CouponType;
  /** PERCENTAGE: 0–100; FIXED_AMOUNT: minor units; FREE: ignored. */
  value: number;
  active: boolean;
  maxUses: number | null;
  usedCount: number;
  expiresAt: Date | null;
  competitionId: string;
  categoryId: string | null;
  minimumAmount: number | null;
}

export type CouponRefusal = 'COUPON_INACTIVE' | 'COUPON_EXPIRED' | 'COUPON_EXHAUSTED' | 'COUPON_OTHER_COMPETITION' | 'COUPON_OTHER_CATEGORY' | 'COUPON_MINIMUM_NOT_MET' | 'COUPON_ALREADY_USED';

export interface PriceQuote {
  originalPrice: number;
  discount: number;
  finalPrice: number;
  /** FREE when nothing is left to pay, PENDING otherwise. */
  paymentStatus: 'FREE' | 'PENDING';
}

/** Category override when set, the competition's price otherwise. */
export function basePrice(competitionPrice: number, categoryOverride: number | null | undefined): number {
  return categoryOverride ?? competitionPrice;
}

export function checkCoupon(
  c: CouponRule,
  ctx: { competitionId: string; categoryId: string; amount: number; now: Date; alreadyUsedByAthlete: boolean },
): CouponRefusal | null {
  if (!c.active) return 'COUPON_INACTIVE';
  if (c.expiresAt && c.expiresAt.getTime() <= ctx.now.getTime()) return 'COUPON_EXPIRED';
  if (c.maxUses != null && c.usedCount >= c.maxUses) return 'COUPON_EXHAUSTED';
  if (c.competitionId !== ctx.competitionId) return 'COUPON_OTHER_COMPETITION';
  if (c.categoryId && c.categoryId !== ctx.categoryId) return 'COUPON_OTHER_CATEGORY';
  if (c.minimumAmount != null && ctx.amount < c.minimumAmount) return 'COUPON_MINIMUM_NOT_MET';
  if (ctx.alreadyUsedByAthlete) return 'COUPON_ALREADY_USED';
  return null;
}

/** BASE PRICE (category override if any) − coupon discount = FINAL PRICE, never below 0. */
export function quote(competitionPrice: number, categoryOverride: number | null | undefined, coupon?: Pick<CouponRule, 'type' | 'value'> | null): PriceQuote {
  const originalPrice = basePrice(competitionPrice, categoryOverride);
  let discount = 0;
  if (coupon) {
    if (coupon.type === 'FREE') discount = originalPrice;
    else if (coupon.type === 'PERCENTAGE') discount = Math.round((originalPrice * Math.min(100, Math.max(0, coupon.value))) / 100);
    else discount = Math.min(originalPrice, Math.max(0, coupon.value));
  }
  const finalPrice = Math.max(0, originalPrice - discount);
  return { originalPrice, discount: originalPrice - finalPrice, finalPrice, paymentStatus: finalPrice === 0 ? 'FREE' : 'PENDING' };
}

// ───────────── Category eligibility ─────────────

export type CategoryGender = 'MALE' | 'FEMALE' | 'MIXED';

export interface CategoryRule {
  gender: CategoryGender;
  minAge: number | null;
  maxAge: number | null;
  active: boolean;
  maxParticipants: number | null;
}

export type EligibilityRefusal = 'CATEGORY_INACTIVE' | 'CATEGORY_FULL' | 'GENDER_REQUIRED' | 'WRONG_GENDER' | 'TOO_YOUNG' | 'TOO_OLD';

/** Age in whole years on `on` (the competition's reference date: its start). */
export function ageOn(dateOfBirth: Date, on: Date): number {
  const age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < dateOfBirth.getUTCMonth() || (on.getUTCMonth() === dateOfBirth.getUTCMonth() && on.getUTCDate() < dateOfBirth.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

/**
 * Category bounds are inclusive: "18-35" admits 18 to 35, "35+" is minAge 35 and no max. Overlapping
 * templates (35-40 / 40+) are the organizer's call; each category is checked on its own.
 */
export function checkEligibility(
  category: CategoryRule,
  athlete: { gender: 'MALE' | 'FEMALE' | 'UNDISCLOSED' | null; dateOfBirth: Date },
  ctx: { referenceDate: Date; registeredCount: number },
): EligibilityRefusal | null {
  if (!category.active) return 'CATEGORY_INACTIVE';
  if (category.maxParticipants != null && ctx.registeredCount >= category.maxParticipants) return 'CATEGORY_FULL';
  if (category.gender !== 'MIXED') {
    if (athlete.gender == null || athlete.gender === 'UNDISCLOSED') return 'GENDER_REQUIRED';
    if (athlete.gender !== category.gender) return 'WRONG_GENDER';
  }
  const age = ageOn(athlete.dateOfBirth, ctx.referenceDate);
  if (category.minAge != null && age < category.minAge) return 'TOO_YOUNG';
  if (category.maxAge != null && age > category.maxAge) return 'TOO_OLD';
  return null;
}

// ───────────── WOD points ─────────────

export type ScoreType = 'TIME' | 'REPS' | 'ROUNDS_REPS' | 'DISTANCE' | 'LOAD' | 'CALORIES' | 'POINTS' | 'MAX_WEIGHT' | 'COMPLEX';

/** DIRECT_POINTS: the official score already is the points. PLACEMENT_POINTS: points from the rank in the category. */
export type ScoringMethod = 'DIRECT_POINTS' | 'PLACEMENT_POINTS';

/** Lower is better only for TIME; every other score type ranks higher-first. */
export const lowerIsBetter = (t: ScoreType) => t === 'TIME';

/**
 * The comparable value of a raw result. ROUNDS_REPS uses rounds × repsPerRound + reps; a capped TIME result
 * (not finished) ranks after every finisher, by reps done: capS + (maxReps − reps).
 */
export function rawValue(
  type: ScoreType,
  r: { timeS?: number | null; rounds?: number | null; reps?: number | null; repsPerRound?: number | null; value?: number | null; capped?: boolean; capS?: number | null; maxReps?: number | null },
): number | null {
  switch (type) {
    case 'TIME':
      if (r.capped) return r.capS != null && r.maxReps != null && r.reps != null ? r.capS + (r.maxReps - r.reps) : null;
      return r.timeS ?? null;
    case 'ROUNDS_REPS':
      return r.rounds == null ? null : r.rounds * (r.repsPerRound ?? 0) + (r.reps ?? 0);
    case 'REPS':
      return r.reps ?? r.value ?? null;
    default:
      return r.value ?? null;
  }
}

/** Dense competition ranks (1, 2, 2, 4) of raw values; equal results share a place. */
export function placements<T extends { id: string; value: number }>(rows: T[], type: ScoreType): Map<string, number> {
  const sorted = [...rows].sort((a, b) => (lowerIsBetter(type) ? a.value - b.value : b.value - a.value));
  const places = new Map<string, number>();
  sorted.forEach((row, i) => {
    const prev = sorted[i - 1];
    places.set(row.id, prev && prev.value === row.value ? places.get(prev.id)! : i + 1);
  });
  return places;
}

/**
 * Points for a placement from the WOD's table (1st = table[0] …). Beyond the table, points keep decreasing by
 * the table's last step and never go under `minimumPoints`.
 */
export function placementPoints(place: number, table: number[], minimumPoints = 0): number {
  if (table.length === 0) return minimumPoints;
  if (place <= table.length) return Math.max(minimumPoints, table[place - 1]);
  const step = table.length > 1 ? table[table.length - 2] - table[table.length - 1] : 0;
  return Math.max(minimumPoints, table[table.length - 1] - step * (place - table.length));
}

/** DIRECT_POINTS are clamped to the WOD's [minimumPoints, maximumPoints]. */
export function clampPoints(points: number, maximumPoints: number, minimumPoints = 0): number {
  return Math.min(maximumPoints, Math.max(minimumPoints, points));
}

// ───────────── Score versions & penalties ─────────────

export interface ScoreVersion {
  version: number;
  points: number;
  reason: string;
  judgeId: string | null;
  createdAt: Date;
}

/** Appends a version (never rewrites history). A penalty is a version whose points are the previous minus the penalty. */
export function nextVersion(history: ScoreVersion[], change: { points: number; reason: string; judgeId: string | null; at: Date }): ScoreVersion[] {
  return [...history, { version: history.length + 1, points: change.points, reason: change.reason, judgeId: change.judgeId, createdAt: change.at }];
}

export function applyPenalty(currentPoints: number, penaltyPoints: number, minimumPoints = 0): number {
  return Math.max(minimumPoints, currentPoints - Math.abs(penaltyPoints));
}

// ───────────── Leaderboard ─────────────

export type SubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'NEEDS_CORRECTION' | 'PENALIZED' | 'FINAL';

/** Only FINAL scores are official (rule §32); PENALIZED/APPROVED become FINAL when the judge closes the review. */
export const isOfficial = (s: SubmissionStatus) => s === 'FINAL';

export type TieBreakRule =
  | { type: 'WOD'; workoutId: string } // more points on this WOD wins
  | { type: 'LAST_WOD' } // more points on the last WOD (by order) wins
  | { type: 'MOST_WOD_WINS' } // more first places wins
  | { type: 'BEST_SINGLE_WOD' } // higher best single-WOD score wins
  | { type: 'WOD_GROUP'; workoutIds: string[] }; // higher sum over these WODs wins

export interface AthleteScores {
  athleteId: string;
  /** Official points per workoutId (FINAL scores only). */
  points: Record<string, number>;
  /** Placement per workoutId, for MOST_WOD_WINS. */
  places?: Record<string, number>;
}

export interface LeaderboardRow {
  athleteId: string;
  total: number;
  rank: number;
  points: Record<string, number>;
}

/** TOTAL = sum of official WOD points (§62). Missing WODs count 0. */
export const totalPoints = (a: AthleteScores) => Object.values(a.points).reduce((s, p) => s + p, 0);

function tieKey(a: AthleteScores, rule: TieBreakRule, workoutOrder: string[]): number {
  switch (rule.type) {
    case 'WOD':
      return a.points[rule.workoutId] ?? 0;
    case 'LAST_WOD':
      return a.points[workoutOrder[workoutOrder.length - 1]] ?? 0;
    case 'MOST_WOD_WINS':
      return Object.values(a.places ?? {}).filter((p) => p === 1).length;
    case 'BEST_SINGLE_WOD':
      return Math.max(0, ...Object.values(a.points));
    case 'WOD_GROUP':
      return rule.workoutIds.reduce((s, id) => s + (a.points[id] ?? 0), 0);
  }
}

/**
 * Sorts by TOTAL desc, then by the organizer's tie-break rules in order. Athletes still equal after every rule
 * share the rank (1, 2, 2, 4): no rule is invented (§35).
 */
export function leaderboard(athletes: AthleteScores[], rules: TieBreakRule[], workoutOrder: string[]): LeaderboardRow[] {
  const keyed = athletes.map((a) => ({ a, keys: [totalPoints(a), ...rules.map((r) => tieKey(a, r, workoutOrder))] }));
  keyed.sort((x, y) => {
    for (let i = 0; i < x.keys.length; i++) if (x.keys[i] !== y.keys[i]) return y.keys[i] - x.keys[i];
    return x.a.athleteId.localeCompare(y.a.athleteId); // stable display order only, ranks stay shared
  });
  const rows: LeaderboardRow[] = [];
  keyed.forEach((k, i) => {
    const prev = keyed[i - 1];
    const same = prev && prev.keys.every((v, j) => v === k.keys[j]);
    rows.push({ athleteId: k.a.athleteId, total: k.keys[0], rank: same ? rows[i - 1].rank : i + 1, points: k.a.points });
  });
  return rows;
}

/** Podium of a final leaderboard: every athlete ranked 1, 2 or 3 (shared ranks all stand on the podium). */
export function podium(rows: LeaderboardRow[]): { gold: LeaderboardRow[]; silver: LeaderboardRow[]; bronze: LeaderboardRow[] } {
  return { gold: rows.filter((r) => r.rank === 1), silver: rows.filter((r) => r.rank === 2), bronze: rows.filter((r) => r.rank === 3) };
}

// ───────────── Status & deadlines ─────────────

export type CompetitionStatus =
  | 'DRAFT'
  | 'REGISTRATION_OPEN'
  | 'REGISTRATION_CLOSED'
  | 'ACTIVE'
  | 'SUBMISSION_OPEN'
  | 'JUDGING'
  | 'PROVISIONAL_LEADERBOARD'
  | 'FINAL_LEADERBOARD'
  | 'FINISHED'
  | 'CANCELLED';

/** Registration needs the open status AND the server clock inside the window (never the phone's clock). */
export function canRegister(c: { status: CompetitionStatus; registrationStart: Date; registrationEnd: Date }, now: Date): 'REGISTRATION_CLOSED' | null {
  if (c.status !== 'REGISTRATION_OPEN') return 'REGISTRATION_CLOSED';
  if (now < c.registrationStart || now > c.registrationEnd) return 'REGISTRATION_CLOSED';
  return null;
}

export function canSubmit(w: { active: boolean; submissionStart: Date; submissionDeadline: Date }, c: { status: CompetitionStatus }, now: Date): 'SUBMISSION_CLOSED' | null {
  if (!w.active || !['ACTIVE', 'SUBMISSION_OPEN'].includes(c.status)) return 'SUBMISSION_CLOSED';
  if (now < w.submissionStart || now > w.submissionDeadline) return 'SUBMISSION_CLOSED';
  return null;
}

// ───────────── Video proof ─────────────

/** YouTube id from watch, short, embed and shorts URLs; null when it is not a YouTube video URL. */
export function youtubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/?#]+)/);
      id = m ? m[2] : null;
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export const youtubeThumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/**
 * Heat seeding (§45): athletes best-first in, heats in running order out. Lower-ranked athletes run in
 * the early heats and the leaders in the last one; every heat but the first is full.
 */
export function seedHeats<T>(bestFirst: readonly T[], laneCount: number): T[][] {
  if (laneCount < 1) throw new Error('laneCount must be at least 1');
  const worstFirst = [...bestFirst].reverse();
  const heats: T[][] = [];
  const firstSize = worstFirst.length % laneCount || laneCount;
  if (worstFirst.length > 0) heats.push(worstFirst.slice(0, firstSize).reverse());
  for (let i = firstSize; i < worstFirst.length; i += laneCount) heats.push(worstFirst.slice(i, i + laneCount).reverse());
  return heats;
}
