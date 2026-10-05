import { useQuery } from '@tanstack/react-query';

import type { ApiClient, Json } from '../../core/api/client';
import { useApi } from '../../core/services';

/** Gym Wars (API §gym-wars): my gym's war of the week, a war, a gym's history and enrolment. */
export const gymWarsApi = (api: ApiClient) => ({
  current: () => api.get<Json>('/gym-wars/current'),
  get: (id: string) => api.get<Json>(`/gym-wars/${id}`),
  history: (gymId: string) => api.get<Json>(`/gyms/${gymId}/wars`),
  setEnrolled: (gymId: string, enrolled: boolean) => api.post<Json>(`/gyms/${gymId}/wars/registration`, { enrolled }),
});

export const warKeys = {
  current: ['gym-wars', 'current'] as const,
  detail: (id: string) => ['gym-wars', id] as const,
  history: (gymId: string) => ['gyms', gymId, 'wars'] as const,
};

export function useCurrentGymWar() {
  const api = useApi();
  return useQuery({ queryKey: warKeys.current, queryFn: () => gymWarsApi(api).current() });
}

export function useGymWar(id: string) {
  const api = useApi();
  return useQuery({ queryKey: warKeys.detail(id), queryFn: () => gymWarsApi(api).get(id) });
}

export function useGymWarHistory(gymId: string) {
  const api = useApi();
  return useQuery({ queryKey: warKeys.history(gymId), queryFn: () => gymWarsApi(api).history(gymId) });
}
