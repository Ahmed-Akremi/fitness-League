import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../core/services';

/** Public catalog entries (governorates, cities, sports, exercises): `name` is an {fr, en, ar} object. */
export interface RefItem {
  id: string;
  code?: string;
  name: unknown;
  [k: string]: unknown;
}

// Cached for the app's lifetime.
const forever = { staleTime: Infinity, gcTime: Infinity } as const;

export function useGovernorates() {
  const api = useApi();
  return useQuery({ queryKey: ['ref', 'governorates'], queryFn: () => api.get<RefItem[]>('/ref/governorates'), ...forever });
}

export function useCities(governorateId: string | null | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['ref', 'cities', governorateId],
    queryFn: () => api.get<RefItem[]>('/ref/cities', { governorateId }),
    enabled: !!governorateId,
    ...forever,
  });
}

export function useSports() {
  const api = useApi();
  return useQuery({ queryKey: ['ref', 'sports'], queryFn: () => api.get<RefItem[]>('/ref/sports'), ...forever });
}

export function useExercises(sportId: string | null | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['ref', 'exercises', sportId],
    queryFn: () => api.get<RefItem[]>('/ref/exercises', { sportId }),
    enabled: !!sportId,
    ...forever,
  });
}
