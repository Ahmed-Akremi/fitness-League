/**
 * Gym War maths (docs §6.2). Pure: the service gathers member scores and stores the result.
 */

export type Bracket = 'S' | 'M' | 'L';

export interface GymWarRules {
  weights: { top_k: number; participation: number; progress: number; verified: number; consistency: number };
  top_k: number;
  member_score_cap: number;
  min_active_verified_members: number;
  bracket_m_min: number;
  bracket_l_min: number;
  no_rematch_weeks: number;
}

export const DEFAULT_GYM_WAR: GymWarRules = {
  weights: { top_k: 0.35, participation: 0.2, progress: 0.2, verified: 0.1, consistency: 0.15 },
  top_k: 20,
  member_score_cap: 100,
  min_active_verified_members: 8,
  bracket_m_min: 31,
  bracket_l_min: 81,
  no_rematch_weeks: 3,
};

export interface MemberWeek {
  /** Weekly total (0–100); 0 for an eligible member who did not train. */
  total: number;
  progress: number;
  consistency: number;
  /** At least one accepted workout in the war week. */
  active: boolean;
}

export interface GymScore {
  score: number;
  topK: number;
  participation: number;
  meanProgress: number;
  verifiedRatio: number | null;
  consistency: number;
  eligible: number;
  active: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function bracketOf(eligible: number, r: Pick<GymWarRules, 'bracket_m_min' | 'bracket_l_min'> = DEFAULT_GYM_WAR): Bracket {
  return eligible >= r.bracket_l_min ? 'L' : eligible >= r.bracket_m_min ? 'M' : 'S';
}

/**
 * gym_score = w1·top_k + w2·participation + w3·mean_progress + w4·verified_ratio + w5·consistency.
 * Until proofs exist (Phase 3) `verifiedRatio` is null and w4 is spread over the other weights.
 */
export function gymScore(members: MemberWeek[], verifiedRatio: number | null, r: GymWarRules = DEFAULT_GYM_WAR): GymScore {
  const eligible = members.length;
  const active = members.filter((m) => m.active);
  const k = Math.min(r.top_k, eligible);
  const best = members.map((m) => Math.min(m.total, r.member_score_cap)).sort((a, b) => b - a).slice(0, k);
  const parts = {
    topK: mean(best),
    participation: eligible ? (active.length / eligible) * 100 : 0,
    meanProgress: mean(active.map((m) => m.progress)),
    consistency: mean(members.map((m) => m.consistency)),
  };
  const w = r.weights;
  const weighted = w.top_k * parts.topK + w.participation * parts.participation + w.progress * parts.meanProgress + w.consistency * parts.consistency;
  const score = verifiedRatio === null ? weighted / (1 - w.verified) : weighted + w.verified * verifiedRatio;
  return {
    score: round2(score),
    topK: round2(parts.topK),
    participation: round2(parts.participation),
    meanProgress: round2(parts.meanProgress),
    verifiedRatio,
    consistency: round2(parts.consistency),
    eligible,
    active: active.length,
  };
}

export interface GymCandidate {
  gymId: string;
  bracket: Bracket;
  rating: number;
}

export const gymPairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const ORDER: Bracket[] = ['S', 'M', 'L'];

/**
 * Same bracket, closest gym rating, no recent rematch (`forbidden`); leftovers may meet an adjacent bracket;
 * whoever is still alone gets a bye. Greedy on rating distance, ties broken by ids so a run is deterministic.
 */
export function pairGyms(gyms: GymCandidate[], forbidden: ReadonlySet<string>): { pairs: [string, string][]; byes: string[] } {
  const taken = new Set<string>();
  const pairs: [string, string][] = [];
  const match = (allowed: (a: GymCandidate, b: GymCandidate) => boolean) => {
    const edges: { a: GymCandidate; b: GymCandidate; cost: number }[] = [];
    const free = gyms.filter((g) => !taken.has(g.gymId));
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const a = free[i]!;
        const b = free[j]!;
        if (!allowed(a, b) || forbidden.has(gymPairKey(a.gymId, b.gymId))) continue;
        edges.push({ a, b, cost: Math.abs(a.rating - b.rating) });
      }
    }
    edges.sort((x, y) => x.cost - y.cost || gymPairKey(x.a.gymId, x.b.gymId).localeCompare(gymPairKey(y.a.gymId, y.b.gymId)));
    for (const e of edges) {
      if (taken.has(e.a.gymId) || taken.has(e.b.gymId)) continue;
      taken.add(e.a.gymId);
      taken.add(e.b.gymId);
      pairs.push([e.a.gymId, e.b.gymId]);
    }
  };
  match((a, b) => a.bracket === b.bracket);
  match((a, b) => Math.abs(ORDER.indexOf(a.bracket) - ORDER.indexOf(b.bracket)) === 1);
  return { pairs, byes: gyms.filter((g) => !taken.has(g.gymId)).map((g) => g.gymId).sort() };
}
