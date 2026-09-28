/**
 * Weekly Duel pairing (docs §6.1): candidate edges that satisfy the hard constraints, sorted by cost, greedy match.
 * Pure: the service gathers the facts (ratings, divisions, friendships…) and stores the pairs.
 */

export interface DuelCandidate {
  userId: string;
  mmr: number;
  /** Division order (Bronze 1 … Elite 6). */
  division: number;
  /** Average training days per week over the last 4 weeks. */
  avgTrainingDays: number;
  hoursWaiting: number;
}

export interface WindowRules {
  base: number;
  step: number;
  stepHours: number;
  max: number;
}

export const DEFAULT_WINDOW: WindowRules = { base: 150, step: 100, stepHours: 6, max: 400 };

/** MMR distance allowed after waiting `hours`: 150 + 100 per 6 h, at most 400. */
export function mmrWindow(hours: number, w: WindowRules = DEFAULT_WINDOW): number {
  return Math.min(w.base + w.step * Math.floor(Math.max(0, hours) / w.stepHours), w.max);
}

export function pairCost(a: DuelCandidate, b: DuelCandidate): number {
  return Math.abs(a.mmr - b.mmr) / 100 + 0.5 * Math.abs(a.avgTrainingDays - b.avgTrainingDays) + (a.division === b.division ? 0 : 1);
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Greedy min-cost matching. `forbidden` holds `pairKey`s that break a relational hard constraint
 * (friends, blocked, same gym, recent rematch); division adjacency and the MMR window are checked here.
 * The window of a pair is the smaller of the two players' windows: a late joiner is not thrown far away.
 */
export function pairDuels(candidates: DuelCandidate[], forbidden: ReadonlySet<string>, w: WindowRules = DEFAULT_WINDOW): [string, string][] {
  const edges: { a: DuelCandidate; b: DuelCandidate; cost: number }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (Math.abs(a.division - b.division) > 1) continue;
      if (forbidden.has(pairKey(a.userId, b.userId))) continue;
      if (Math.abs(a.mmr - b.mmr) > Math.min(mmrWindow(a.hoursWaiting, w), mmrWindow(b.hoursWaiting, w))) continue;
      edges.push({ a, b, cost: pairCost(a, b) });
    }
  }
  // Ties broken by ids so a batch is deterministic.
  edges.sort((x, y) => x.cost - y.cost || pairKey(x.a.userId, x.b.userId).localeCompare(pairKey(y.a.userId, y.b.userId)));
  const taken = new Set<string>();
  const pairs: [string, string][] = [];
  for (const e of edges) {
    if (taken.has(e.a.userId) || taken.has(e.b.userId)) continue;
    taken.add(e.a.userId);
    taken.add(e.b.userId);
    pairs.push([e.a.userId, e.b.userId]);
  }
  return pairs;
}
