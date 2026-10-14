import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { ApiClient, Json, UploadFile } from '../../../core/api/client';
import { ApiError } from '../../../core/api/errors';
import { useApi } from '../../../core/services';
import { slugFor, type EventFormat } from './logic';

export type CompetitionInput = {
  title: string;
  slug: string;
  description: string;
  format: EventFormat;
  countryCode?: string;
  city?: string;
  location?: string;
  registrationStart: string;
  registrationEnd: string;
  eventStart: string;
  eventEnd: string;
  registrationPrice: number;
  currency?: string;
  maxParticipants?: number | null;
};

/** Organizer space: the organizer routes of the competitions API (spec 2026-10-14). */
export const organizerApi = (api: ApiClient) => ({
  create: (body: CompetitionInput) => api.post<Json>('/competitions', body),
  update: (id: string, body: Partial<CompetitionInput>) => api.put<Json>(`/competitions/${id}`, body),
  remove: (id: string) => api.delete<void>(`/competitions/${id}`),
  setStatus: (id: string, status: string) => api.patch<Json>(`/competitions/${id}/status`, { status }),
  requestPublication: (id: string) => api.post<Json>(`/competitions/${id}/publication-request`),
  dashboard: (id: string) => api.get<Json>(`/competitions/${id}/dashboard`),
  uploadCover: (id: string, file: UploadFile) => api.upload<Json>(`/competitions/${id}/cover`, file),
  removeCover: (id: string) => api.delete<void>(`/competitions/${id}/cover`),
  addCategory: (id: string, body: Json) => api.post<Json>(`/competitions/${id}/categories`, body),
  addTemplates: (id: string) => api.post<Json>(`/competitions/${id}/categories/templates`),
  updateCategory: (id: string, categoryId: string, body: Json) => api.put<Json>(`/competitions/${id}/categories/${categoryId}`, body),
  addWod: (id: string, body: Json) => api.post<Json>(`/competitions/${id}/wods`, body),
  updateWod: (id: string, wodId: string, body: Json) => api.put<Json>(`/competitions/${id}/wods/${wodId}`, body),
  removeWod: (id: string, wodId: string) => api.delete<void>(`/competitions/${id}/wods/${wodId}`),
  reorderWods: (id: string, workoutIds: string[]) => api.post<Json[]>(`/competitions/${id}/wods/reorder`, { workoutIds }),
});

/** Creates the draft; a taken address name gets one new random suffix (two events may share a title). */
export async function createWithFreeSlug(org: ReturnType<typeof organizerApi>, body: CompetitionInput): Promise<Json> {
  try {
    return await org.create(body);
  } catch (e) {
    if (!(e instanceof ApiError) || !e.fieldErrors.some((f) => f.field === 'slug' && f.code === 'TAKEN')) throw e;
    return org.create({ ...body, slug: slugFor(body.title) });
  }
}

export function useOrganizerDashboard(id: string) {
  const api = useApi();
  return useQuery({ queryKey: ['competitions', id, 'org-dashboard'], queryFn: () => organizerApi(api).dashboard(id) });
}

/** After an organizer change: every competition query (detail, lists, dashboard) reads again. */
export function useRefreshCompetition() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['competitions'] });
}
