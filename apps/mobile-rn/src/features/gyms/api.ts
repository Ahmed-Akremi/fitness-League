import { useQuery } from '@tanstack/react-query';

import type { ApiClient, Json, UploadFile } from '../../core/api/client';
import { useApi } from '../../core/services';

export interface GymQuery {
  q?: string;
  sport?: string | null;
  governorateId?: string | null;
  sort?: string;
  cursor?: string | null;
  limit?: number;
}

/** Gym directory, profile, membership, logo and member management (API §gyms). */
export const gymsApi = (api: ApiClient) => ({
  list: ({ q, sport, governorateId, sort = 'name', cursor, limit = 20 }: GymQuery = {}) =>
    api.get<Json>('/gyms', { limit, sort, q: q ? q : undefined, sport, governorateId, cursor }),
  get: (id: string) => api.get<Json>(`/gyms/${id}`),
  create: (body: Json) => api.post<Json>('/gyms', body),
  mine: () => api.get<Json[]>('/gyms/mine'),
  join: (id: string) => api.post(`/gyms/${id}/membership`),
  leave: () => api.delete('/gyms/me/membership'),
  uploadLogo: (id: string, file: UploadFile) => api.upload<Json>(`/gyms/${id}/logo`, file),
  members: (id: string, cursor?: string | null) => api.get<Json>(`/gyms/${id}/members`, { limit: 50, cursor }),
  requests: (id: string) => api.get<Json[]>(`/gyms/${id}/membership-requests`),
  decide: (id: string, userId: string, action: string) => api.post(`/gyms/${id}/members/${userId}/${action}`),
  setCoach: (id: string, userId: string, coach: boolean) =>
    coach ? api.post(`/gyms/${id}/members/${userId}/coach`) : api.delete(`/gyms/${id}/members/${userId}/coach`),
});

export const gymKeys = {
  detail: (id: string) => ['gyms', id] as const,
  mine: ['gyms', 'mine'] as const,
  members: (id: string) => ['gyms', id, 'members'] as const,
  requests: (id: string) => ['gyms', id, 'requests'] as const,
};

export function useGym(id: string | null | undefined) {
  const api = useApi();
  return useQuery({ queryKey: gymKeys.detail(id ?? ''), queryFn: () => gymsApi(api).get(id!), enabled: !!id });
}

export function useMyGyms() {
  const api = useApi();
  return useQuery({ queryKey: gymKeys.mine, queryFn: () => gymsApi(api).mine() });
}
