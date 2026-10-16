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
  registrations: (id: string) => api.get<Json[]>(`/competitions/${id}/registrations`),
  markPaid: (id: string, registrationId: string) => api.post<Json>(`/competitions/${id}/registrations/${registrationId}/mark-paid`),
  addHeat: (id: string, body: Json) => api.post<Json>(`/competitions/${id}/heats`, body),
  autoHeats: (id: string, body: Json) => api.post<Json>(`/competitions/${id}/heats/auto`, body),
  updateHeat: (id: string, heatId: string, body: Json) => api.put<Json>(`/competitions/${id}/heats/${heatId}`, body),
  removeHeat: (id: string, heatId: string) => api.delete<void>(`/competitions/${id}/heats/${heatId}`),
  assignLane: (id: string, heatId: string, registrationId: string, lane: number) => api.post<Json>(`/competitions/${id}/heats/${heatId}/lanes`, { registrationId, lane }),
  freeLane: (id: string, heatId: string, lane: number) => api.delete<void>(`/competitions/${id}/heats/${heatId}/lanes/${lane}`),
  staff: (id: string) => api.get<Json[]>(`/competitions/${id}/staff`),
  addOrganizer: (id: string, userId: string) => api.post<Json>(`/competitions/${id}/staff`, { userId, role: 'ORGANIZER' }),
  removeStaff: (id: string, staffId: string) => api.delete<void>(`/competitions/${id}/staff/${staffId}`),
  coupons: (id: string) => api.get<Json[]>(`/competitions/${id}/coupons`),
  addCoupon: (id: string, body: Json) => api.post<Json>(`/competitions/${id}/coupons`, body),
  setCouponActive: (id: string, couponId: string, active: boolean) => api.post<Json>(`/competitions/${id}/coupons/${couponId}/${active ? 'activate' : 'deactivate'}`),
  announcements: (id: string) => api.get<Json[]>(`/competitions/${id}/announcements`),
  announce: (id: string, body: { title: string; body: string }) => api.post<Json>(`/competitions/${id}/announcements`, body),
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

/** Lot B lists: their keys sit under ['competitions', id], so useRefreshCompetition() reloads them after a change. */
export const orgKeys = {
  registrations: (id: string) => ['competitions', id, 'org-registrations'] as const,
  staff: (id: string) => ['competitions', id, 'org-staff'] as const,
  coupons: (id: string) => ['competitions', id, 'org-coupons'] as const,
  announcements: (id: string) => ['competitions', id, 'announcements'] as const,
};

export function useRegistrations(id: string) {
  const api = useApi();
  return useQuery({ queryKey: orgKeys.registrations(id), queryFn: () => organizerApi(api).registrations(id) });
}

export function useStaff(id: string) {
  const api = useApi();
  return useQuery({ queryKey: orgKeys.staff(id), queryFn: () => organizerApi(api).staff(id) });
}

export function useCoupons(id: string) {
  const api = useApi();
  return useQuery({ queryKey: orgKeys.coupons(id), queryFn: () => organizerApi(api).coupons(id) });
}

export function useAnnouncements(id: string) {
  const api = useApi();
  return useQuery({ queryKey: orgKeys.announcements(id), queryFn: () => organizerApi(api).announcements(id) });
}
