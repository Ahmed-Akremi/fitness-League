import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';

import type { ApiClient, Json } from '../../../core/api/client';
import { ApiError } from '../../../core/api/errors';
import { useApi } from '../../../core/services';

/** Floor judging (spec 2026-10-21): invitations, the judge's lanes, the heat clock and the scores. */
export const floorApi = (api: ApiClient) => ({
  mine: () => api.get<Json[]>('/competitions/floor-judging'),
  accept: (id: string) => api.post<Json>(`/competitions/${id}/floor-judging/accept`),
  decline: (id: string) => api.post<void>(`/competitions/${id}/floor-judging/decline`),
  lanes: (id: string) => api.get<Json>(`/competitions/${id}/floor-judging/lanes`),
  start: (id: string, heatId: string) => api.post<Json>(`/competitions/${id}/heats/${heatId}/start`),
  score: (id: string, heatId: string, lane: number, body: Json) => api.put<Json>(`/competitions/${id}/heats/${heatId}/lanes/${lane}/score`, body),
  // Organizer side.
  invite: (id: string, userId: string) => api.post<Json>(`/competitions/${id}/staff`, { userId, role: 'FLOOR_JUDGE' }),
  setLaneJudge: (id: string, heatId: string, lane: number, staffId: string | null) => api.put<Json>(`/competitions/${id}/heats/${heatId}/lanes/${lane}/judge`, { staffId }),
  autoJudges: (id: string, heatId: string) => api.post<Json>(`/competitions/${id}/heats/${heatId}/judges/auto`),
  resetStart: (id: string, heatId: string) => api.delete<void>(`/competitions/${id}/heats/${heatId}/start`),
});

export const judgeKeys = {
  lanes: (id: string) => ['competitions', id, 'floor-lanes'] as const,
};

/** The judge's lanes; read again every 5 s on the scoring screen so a heat started by someone else starts here too. */
export function useJudgeLanes(id: string, refetchInterval?: number) {
  const api = useApi();
  return useQuery({
    queryKey: judgeKeys.lanes(id),
    queryFn: async () => {
      const sentAt = Date.now();
      const r = await floorApi(api).lanes(id);
      // Server time − phone time, halfway through the request: every judge's clock counts from the same start.
      return { ...r, offsetMs: new Date(r.serverTime).getTime() - (sentAt + Date.now()) / 2 } as Json;
    },
    refetchInterval,
  });
}

// ───────────── Scores waiting for the network (ruling 6) ─────────────

/** A score the phone could not send: kept with its clientId, so sending it again can never count it twice. */
export interface PendingScore {
  competitionId: string;
  heatId: string;
  lane: number;
  body: Json;
}

const KEY = 'judge-pending-scores';
const same = (a: PendingScore, b: PendingScore) => a.competitionId === b.competitionId && a.heatId === b.heatId && a.lane === b.lane;

export async function pendingScores(): Promise<PendingScore[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingScore[]) : [];
  } catch {
    return [];
  }
}

async function write(list: PendingScore[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

/** The latest score of a lane replaces an older one still waiting. */
export async function keepPending(p: PendingScore) {
  await write([...(await pendingScores()).filter((x) => !same(x, p)), p]);
}

async function dropPending(p: PendingScore) {
  await write((await pendingScores()).filter((x) => !same(x, p)));
}

/**
 * Sends a score; without network it waits on the phone (`queued`). A refusal by the server is not kept: the
 * judge sees why and corrects it.
 */
export async function sendScore(api: ApiClient, p: PendingScore): Promise<{ queued: boolean; result?: Json }> {
  try {
    const result = await floorApi(api).score(p.competitionId, p.heatId, p.lane, p.body);
    await dropPending(p);
    return { queued: false, result };
  } catch (e) {
    if (e instanceof ApiError && e.isConnectivity) {
      await keepPending(p);
      return { queued: true };
    }
    throw e;
  }
}

/** Sends again what waits for this competition; stops at the first network failure. Returns how many are left. */
export async function flushPending(api: ApiClient, competitionId: string): Promise<number> {
  for (const p of (await pendingScores()).filter((x) => x.competitionId === competitionId)) {
    try {
      await floorApi(api).score(p.competitionId, p.heatId, p.lane, p.body);
      await dropPending(p);
    } catch (e) {
      if (e instanceof ApiError && e.isConnectivity) break;
      // Refused since (lane moved, leaderboard locked): dropped, the lane shows « not scored » again.
      await dropPending(p);
    }
  }
  return (await pendingScores()).filter((x) => x.competitionId === competitionId).length;
}
