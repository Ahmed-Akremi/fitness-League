/**
 * Organisation update, phase 6: the advanced heat generator. The app computes the plan (order, lanes, times) and
 * creates the heats and lanes through the existing server routes (`POST /heats`, `POST /heats/:id/lanes`).
 */

export type Placement = 'START' | 'MIDDLE' | 'END';
export type HeatSort = 'RANK_TOP' | 'RANK_LOW' | 'ALPHABET' | 'REGISTRATION';
export type Entry = { registrationId: string; name: string; userId: string; registeredAt: string };
export type PlannedHeat = { number: number; startsAt: string; lanes: { lane: number; registrationId: string }[] };

/** The lanes in the order the best placed athletes take them: from lane 1, from the last lane, or from the middle outwards. */
export function laneOrder(lanes: number, placement: Placement): number[] {
  const all = Array.from({ length: lanes }, (_, i) => i + 1);
  if (placement === 'START') return all;
  if (placement === 'END') return all.reverse();
  const out: number[] = [];
  // Even counts lean right first (3, 4, 2, 5…), odd counts left first (3, 2, 4, 1…), so the best stay at the centre.
  const mid = lanes % 2 === 0 ? lanes / 2 : (lanes + 1) / 2;
  out.push(mid);
  for (let step = 1; out.length < lanes; step++) {
    const [first, second] = lanes % 2 === 0 ? [mid + step, mid - step] : [mid - step, mid + step];
    if (first >= 1 && first <= lanes) out.push(first);
    if (out.length < lanes && second >= 1 && second <= lanes) out.push(second);
  }
  return out;
}

/** `ranks`: leaderboard rank per user id (1 is best); unranked athletes come last, by registration date. */
export function sortEntries(entries: Entry[], sort: HeatSort, ranks: Record<string, number>): Entry[] {
  const byDate = (a: Entry, b: Entry) => new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime();
  const sorted = [...entries];
  if (sort === 'ALPHABET') return sorted.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'REGISTRATION') return sorted.sort(byDate);
  const ranked = sorted.filter((e) => ranks[e.userId] != null).sort((a, b) => ranks[a.userId] - ranks[b.userId]);
  const unranked = sorted.filter((e) => ranks[e.userId] == null).sort(byDate);
  return [...(sort === 'RANK_TOP' ? ranked : ranked.reverse()), ...unranked];
}

/**
 * Heats of `perHeat` athletes in the given order; inside a heat the first athlete takes the first lane of
 * `laneOrder`. A heat starts `durationMin + transitionMin` after the previous one, plus `pauseMin` after every
 * `pauseEvery` heats.
 */
export function planHeats(o: {
  entries: Entry[];
  perHeat: number;
  lanes: number;
  placement: Placement;
  start: Date;
  durationMin: number;
  transitionMin: number;
  pauseEvery?: number;
  pauseMin?: number;
}): PlannedHeat[] {
  const size = Math.max(1, Math.min(o.perHeat, o.lanes));
  const order = laneOrder(o.lanes, o.placement);
  const heats: PlannedHeat[] = [];
  let at = o.start.getTime();
  for (let i = 0, n = 0; i < o.entries.length; i += size, n++) {
    if (n > 0) {
      at += (o.durationMin + o.transitionMin) * 60_000;
      if (o.pauseEvery && o.pauseMin && n % o.pauseEvery === 0) at += o.pauseMin * 60_000;
    }
    heats.push({
      number: n + 1,
      startsAt: new Date(at).toISOString(),
      lanes: o.entries.slice(i, i + size).map((e, j) => ({ lane: order[j], registrationId: e.registrationId })),
    });
  }
  return heats;
}
