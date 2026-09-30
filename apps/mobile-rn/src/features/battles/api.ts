import type { ApiClient, Json } from '../../core/api/client';

/** Friend Battles: list, detail with live scores, create, accept / decline / cancel. */
export const battlesApi = (api: ApiClient) => ({
  list: (status?: string) => api.get<Json>('/battles', { limit: 30, status }),
  get: (id: string) => api.get<Json>(`/battles/${id}`),
  create: (opponentId: string, durationDays: number, components?: string[] | null) =>
    api.post<Json>('/battles', { opponentId, durationDays, ...(components ? { components } : {}) }),
  act: (id: string, action: 'accept' | 'decline' | 'cancel') => api.post(`/battles/${id}/${action}`),
  // Weekly Duels: the queue; the duel itself is a battle (GET /battles/{id}).
  duelStatus: () => api.get<Json>('/duels/queue'),
  joinDuel: () => api.post<Json>('/duels/queue'),
  leaveDuel: () => api.delete<Json>('/duels/queue'),
});

export const battleKeys = {
  list: (status?: string) => ['battles', status ?? 'all'] as const,
  detail: (id: string) => ['battles', 'detail', id] as const,
  duel: ['duels', 'queue'] as const,
};
