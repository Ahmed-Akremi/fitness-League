import { useQuery } from '@tanstack/react-query';

import type { ApiClient } from '../../core/api/client';
import { useSession } from '../../core/auth/session';
import { useApi } from '../../core/services';

/** The signed-in athlete (GET /me). Only the fields the app reads are typed. */
export interface Me {
  id: string;
  username: string;
  email?: string;
  emailVerified?: boolean;
  profile?: {
    fullName?: string;
    onboardingCompleted?: boolean;
    primarySportId?: string | null;
    governorateId?: string | null;
    cityId?: string | null;
    gymId?: string | null;
    plannedTrainingDaysPerWeek?: number | null;
    governorate?: { id: string; name: unknown } | null;
    gym?: { id: string; name: string } | null;
    [k: string]: unknown;
  };
  sports?: { sportId: string; isPrimary?: boolean; sport?: { id: string; code: string; name: unknown } }[];
  [k: string]: unknown;
}

export const meKey = ['me'] as const;

export const meApi = (api: ApiClient) => ({
  me: () => api.get<Me>('/me'),
  updateProfile: (patch: Record<string, unknown>) => api.patch<Record<string, unknown>>('/me/profile', patch),
  updateSettings: (patch: Record<string, unknown>) => api.patch<Record<string, unknown>>('/me/settings', patch),
  setSports: (sportIds: string[], primary: string) => api.post<void>('/me/onboarding/sports', { sportIds, primarySportId: primary }),
  declareBaselines: (entries: Record<string, unknown>[]) => api.post<void>('/me/onboarding/baselines', { entries }),
  completeOnboarding: () => api.post<void>('/me/onboarding/complete'),
  ranks: () => api.get<Record<string, any>>('/me/ranks'),
  lp: () => api.get<Record<string, any>>('/me/lp'),
  currentWeek: () => api.get<Record<string, any>>('/me/weekly-scores/current'),
  exportData: () => api.get<Record<string, unknown>>('/me/export'),
  deleteAccount: (password: string) => api.delete<void>('/me', { confirm: 'DELETE', password }),
});

/** Cached /me; screens invalidate `meKey` after changes. Only fetched while signed in. */
export function useMe() {
  const api = useApi();
  const signedIn = useSession((s) => s.status === 'signedIn');
  return useQuery({ queryKey: meKey, queryFn: () => meApi(api).me(), enabled: signedIn, staleTime: 60_000 });
}
