import { useQuery } from '@tanstack/react-query';

import type { ApiClient, Json } from '../../core/api/client';
import { useApi } from '../../core/services';

/** User-made leagues (API §leagues). */
export const leaguesApi = (api: ApiClient) => ({
  list: () => api.get<Json>('/leagues'),
  get: (id: string) => api.get<Json>(`/leagues/${id}`),
  leaderboard: (id: string) => api.get<Json>(`/leagues/${id}/leaderboard`),
  create: (body: Json) => api.post<Json>('/leagues', body),
  join: (id: string) => api.post<Json>(`/leagues/${id}/join`),
  joinByCode: (code: string) => api.post<Json>('/leagues/join-by-code', { code }),
  leave: (id: string) => api.delete(`/leagues/${id}/membership`),
  remove: (id: string) => api.delete(`/leagues/${id}`),
});

export const leagueKeys = {
  list: ['leagues'] as const,
  detail: (id: string) => ['leagues', id] as const,
  board: (id: string) => ['leagues', id, 'board'] as const,
};

export function useLeagues() {
  const api = useApi();
  return useQuery({ queryKey: leagueKeys.list, queryFn: () => leaguesApi(api).list() });
}

export function useLeague(id: string) {
  const api = useApi();
  return useQuery({ queryKey: leagueKeys.detail(id), queryFn: () => leaguesApi(api).get(id) });
}

export function useLeagueBoard(id: string) {
  const api = useApi();
  return useQuery({ queryKey: leagueKeys.board(id), queryFn: () => leaguesApi(api).leaderboard(id) });
}
