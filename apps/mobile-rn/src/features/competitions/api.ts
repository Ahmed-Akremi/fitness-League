import { useQuery } from '@tanstack/react-query';

import type { ApiClient, Json, UploadFile } from '../../core/api/client';
import { useApi } from '../../core/services';

export type CompFilter = 'ALL' | 'REGISTRATION_OPEN' | 'UPCOMING' | 'ACTIVE' | 'FINISHED';

/** Competitions (organizer-made events): discovery, registration, submissions, leaderboard, judging. */
export const competitionsApi = (api: ApiClient) => ({
  list: (filter: CompFilter, mine = false) => api.get<Json[]>('/competitions', { filter, ...(mine ? { mine: 'true' } : {}) }),
  get: (id: string) => api.get<Json>(`/competitions/${id}`),
  checkCoupon: (id: string, categoryId: string, code: string) => api.post<Json>(`/competitions/${id}/coupon/validate`, { categoryId, code }),
  register: (id: string, categoryId: string, couponCode?: string) => api.post<Json>(`/competitions/${id}/register`, { categoryId, ...(couponCode ? { couponCode } : {}) }),
  uploadVideo: (id: string, file: UploadFile) => api.upload<Json>(`/competitions/${id}/videos`, file, { post: true }),
  submit: (id: string, wodId: string, body: Json) => api.post<Json>(`/competitions/${id}/wods/${wodId}/submissions`, body),
  mySubmissions: (id: string) => api.get<Json[]>(`/competitions/${id}/my-submissions`),
  leaderboard: (id: string, categoryId?: string, workoutId?: string) => api.get<Json>(`/competitions/${id}/leaderboard`, { categoryId, workoutId }),
  appeal: (id: string, submissionId: string, reason: string) => api.post<Json>(`/competitions/${id}/submissions/${submissionId}/appeals`, { reason }),
  judgeQueue: (status: string, competitionId?: string) => api.get<Json[]>('/judge/submissions', { status, competitionId }),
  judgeDetail: (id: string) => api.get<Json>(`/judge/submissions/${id}`),
  judgeAct: (id: string, action: 'approve' | 'reject' | 'needs-correction' | 'penalty' | 'adjust-score', body: Json = {}) => api.post<Json>(`/judge/submissions/${id}/${action}`, body),
});

export const compKeys = {
  list: (filter: string, mine: boolean) => ['competitions', filter, mine] as const,
  detail: (id: string) => ['competitions', 'detail', id] as const,
  mine: (id: string) => ['competitions', id, 'my-submissions'] as const,
  board: (id: string, categoryId?: string, workoutId?: string) => ['competitions', id, 'board', categoryId ?? '', workoutId ?? ''] as const,
  judge: (status: string) => ['judge', status] as const,
  judgeDetail: (id: string) => ['judge', 'detail', id] as const,
};

export function useCompetitions(filter: CompFilter, mine: boolean) {
  const api = useApi();
  return useQuery({ queryKey: compKeys.list(filter, mine), queryFn: () => competitionsApi(api).list(filter, mine) });
}

export function useCompetition(id: string) {
  const api = useApi();
  return useQuery({ queryKey: compKeys.detail(id), queryFn: () => competitionsApi(api).get(id) });
}

export function useMySubmissions(id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: compKeys.mine(id), queryFn: () => competitionsApi(api).mySubmissions(id), enabled });
}

export function useCompLeaderboard(id: string, categoryId?: string, workoutId?: string) {
  const api = useApi();
  return useQuery({ queryKey: compKeys.board(id, categoryId, workoutId), queryFn: () => competitionsApi(api).leaderboard(id, categoryId, workoutId) });
}

/** Money is stored in minor units: 3500 EUR cents → "35 EUR", 35000 TND millimes → "35 TND". */
export function formatMoney(amount: number, currency: string, locale: string): string {
  const digits = currency === 'TND' ? 3 : 2;
  const value = amount / 10 ** digits;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: Number.isInteger(value) ? 0 : digits }).format(value);
}

/** YouTube id from the usual URL forms (same rules as the server). */
export function youtubeId(url: string): string | null {
  const m = url.trim().match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
