import { useQuery } from '@tanstack/react-query';

import type { Json } from '../../core/api/client';
import { useApi } from '../../core/services';

export function useProgress(period: string) {
  const api = useApi();
  return useQuery({ queryKey: ['progress', period], queryFn: () => api.get<Json>('/me/progress', { period }) });
}

export function useSeries(exerciseId: string, metricCode: string, period: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['progress', 'series', exerciseId, metricCode, period],
    queryFn: () => api.get<Json>(`/me/progress/metrics/${exerciseId}/${metricCode}`, { period }),
  });
}

export function useRecords() {
  const api = useApi();
  return useQuery({ queryKey: ['records'], queryFn: () => api.get<Json[]>('/me/records') });
}
