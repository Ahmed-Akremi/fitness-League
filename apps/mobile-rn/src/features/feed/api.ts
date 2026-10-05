import { useQuery } from '@tanstack/react-query';

import type { ApiClient, Json } from '../../core/api/client';
import { useApi } from '../../core/services';

/** Activity feed, reactions and comments (API §feed). */
export const feedApi = (api: ApiClient) => ({
  feed: (cursor?: string | null) => api.get<Json>('/feed', { limit: 20, cursor }),
  react: (id: string, type: string) => api.put<Json>(`/activities/${id}/reactions`, { type }),
  unreact: (id: string) => api.delete<Json>(`/activities/${id}/reactions`),
  comments: (id: string) => api.get<Json>(`/activities/${id}/comments`, { limit: 50 }),
  comment: (id: string, body: string) => api.post<Json>(`/activities/${id}/comments`, { body }),
  deleteComment: (id: string, commentId: string) => api.delete(`/activities/${id}/comments/${commentId}`),
});

export function useComments(activityId: string) {
  const api = useApi();
  return useQuery({ queryKey: ['comments', activityId], queryFn: () => feedApi(api).comments(activityId) });
}
