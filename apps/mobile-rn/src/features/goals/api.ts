import { useQuery } from '@tanstack/react-query';

import type { ApiClient, Json } from '../../core/api/client';
import { useApi } from '../../core/services';

export const goalsKey = ['goals'] as const;

export const goalsApi = (api: ApiClient) => ({
  list: () => api.get<Json[]>('/goals'),
  create: (body: Json) => api.post<Json>('/goals', body),
  suggestions: (type: string, exerciseId: string, metricCode: string) => api.post<Json>('/goals/suggestions', { type, exerciseId, metricCode }),
  abandon: (id: string) => api.delete<void>(`/goals/${id}`),
});

export function useGoals() {
  const api = useApi();
  return useQuery({ queryKey: goalsKey, queryFn: () => goalsApi(api).list() });
}
