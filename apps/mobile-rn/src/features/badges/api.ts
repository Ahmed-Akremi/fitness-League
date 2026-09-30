import { useQuery } from '@tanstack/react-query';

import type { Json } from '../../core/api/client';
import { useApi } from '../../core/services';

/** Badges (API §badges): the catalogue with my progress. */
export function useBadges() {
  const api = useApi();
  return useQuery({ queryKey: ['badges'], queryFn: () => api.get<Json[]>('/badges') });
}
