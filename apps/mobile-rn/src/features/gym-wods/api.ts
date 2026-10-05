import { useQuery } from '@tanstack/react-query';

import type { ApiClient, Json } from '../../core/api/client';
import { useApi } from '../../core/services';
import { formatDuration } from '../../core/utils/format';

/** Coach-made WODs of a gym: list, detail, score submission, Rx/Scaled boards, invalidation. */
export const gymWodsApi = (api: ApiClient) => ({
  list: (gymId: string, when = 'active') => api.get<Json>(`/gyms/${gymId}/wods`, { when, limit: 20 }),
  get: (gymId: string, wodId: string) => api.get<Json>(`/gyms/${gymId}/wods/${wodId}`),
  create: (gymId: string, body: Json) => api.post<Json>(`/gyms/${gymId}/wods`, body),
  update: (gymId: string, wodId: string, patch: Json) => api.patch<Json>(`/gyms/${gymId}/wods/${wodId}`, patch),
  submit: (gymId: string, wodId: string, body: Json) => api.put<Json>(`/gyms/${gymId}/wods/${wodId}/score`, body),
  board: (gymId: string, wodId: string, division = 'RX', cursor?: string | null) =>
    api.get<Json>(`/gyms/${gymId}/wods/${wodId}/leaderboard`, { division, limit: 50, cursor }),
  invalidate: (gymId: string, wodId: string, scoreId: string, reason: string) => api.post(`/gyms/${gymId}/wods/${wodId}/scores/${scoreId}/invalidate`, { reason }),
});

export const wodKeys = {
  list: (gymId: string, when: string) => ['gyms', gymId, 'wods', when] as const,
  detail: (gymId: string, wodId: string) => ['gyms', gymId, 'wods', 'detail', wodId] as const,
  board: (gymId: string, wodId: string, division: string) => ['gyms', gymId, 'wods', 'board', wodId, division] as const,
};

export function useGymWods(gymId: string | null | undefined, when: string) {
  const api = useApi();
  return useQuery({ queryKey: wodKeys.list(gymId ?? '', when), queryFn: () => gymWodsApi(api).list(gymId!, when), enabled: !!gymId });
}

export function useWod(gymId: string, wodId: string) {
  const api = useApi();
  return useQuery({ queryKey: wodKeys.detail(gymId, wodId), queryFn: () => gymWodsApi(api).get(gymId, wodId) });
}

/** FOR_TIME → "7:32", AMRAP → "12 rds · 190 reps" or "190 reps", MAX_LOAD → "102.5 kg". */
export function formatWodScore(scoreType: string, s: Json): string {
  const v = Number(s.value);
  switch (scoreType) {
    case 'FOR_TIME':
      return formatDuration(Math.round(v));
    case 'MAX_LOAD':
      return `${v % 1 === 0 ? Math.trunc(v) : v} kg`;
    default:
      return s.rounds != null ? `${s.rounds} rds · ${Math.trunc(v)} reps` : `${Math.trunc(v)} reps`;
  }
}
