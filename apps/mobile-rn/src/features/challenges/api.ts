import { useQuery } from '@tanstack/react-query';

import type { ApiClient, Json } from '../../core/api/client';
import { useApi } from '../../core/services';

/** Challenges (API §challenges): list, detail with leaderboard, create, join, leave, delete. */
export const challengesApi = (api: ApiClient) => ({
  list: (ended = false) => api.get<Json[]>('/challenges', { status: ended ? 'ENDED' : 'ACTIVE' }),
  get: (id: string) => api.get<Json>(`/challenges/${id}`),
  create: (body: Json) => api.post<Json>('/challenges', body),
  join: (id: string) => api.post<Json>(`/challenges/${id}/join`),
  leave: (id: string) => api.delete<Json>(`/challenges/${id}/join`),
  remove: (id: string) => api.delete(`/challenges/${id}`),
});

export const challengeKeys = {
  list: (ended: boolean) => ['challenges', ended ? 'ended' : 'active'] as const,
  detail: (id: string) => ['challenges', 'detail', id] as const,
};

export function useChallenges(ended: boolean) {
  const api = useApi();
  return useQuery({ queryKey: challengeKeys.list(ended), queryFn: () => challengesApi(api).list(ended) });
}

export function useChallenge(id: string) {
  const api = useApi();
  return useQuery({ queryKey: challengeKeys.detail(id), queryFn: () => challengesApi(api).get(id) });
}
