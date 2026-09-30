import type { ApiClient } from '../../core/api/client';
import type { Page } from '../workouts/api';

export type LeagueScope = 'national' | 'region' | 'gym' | 'friends';

export interface LeagueRow {
  rank: number;
  lp: number;
  level: number;
  division?: string | null;
  movement?: number | 'NEW' | null;
  athlete: { id: string; fullName: string; username?: string };
  gym?: { id: string; name: string } | null;
  governorate: { id: string; name: unknown };
}

export interface ScopeTarget {
  governorateId?: string | null;
  gymId?: string | null;
}

function path(scope: LeagueScope, target: ScopeTarget): string {
  switch (scope) {
    case 'national':
      return '/leaderboards/national';
    case 'region':
      return `/leaderboards/governorates/${target.governorateId}`;
    case 'gym':
      return `/leaderboards/gyms/${target.gymId}`;
    case 'friends':
      return '/leaderboards/friends';
  }
}

export const leagueApi = (api: ApiClient) => ({
  page: (scope: LeagueScope, target: ScopeTarget = {}, cursor?: string | null, limit = 30) => api.get<Page<LeagueRow>>(path(scope, target), { limit, cursor }),
  aroundMe: (scope: LeagueScope, target: ScopeTarget = {}, limit = 30) => api.get<Page<LeagueRow>>(`${path(scope, target)}/me`, { limit }),
});
