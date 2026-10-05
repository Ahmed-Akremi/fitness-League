import { useQuery } from '@tanstack/react-query';

import type { ApiClient, Json } from '../../core/api/client';
import { useApi } from '../../core/services';

/** Friends, follows, blocks, athlete search and public profiles. */
export const socialApi = (api: ApiClient) => ({
  friends: () => api.get<Json[]>('/friends'),
  requests: (direction: 'in' | 'out') => api.get<Json[]>('/friends/requests', { direction }),
  sendRequest: (userId: string) => api.post('/friends/requests', { userId }),
  answer: (userId: string, accept: boolean) => api.post(`/friends/requests/${userId}/${accept ? 'accept' : 'decline'}`),
  unfriend: (userId: string) => api.delete(`/friends/${userId}`),
  follow: (userId: string, on: boolean) => (on ? api.post(`/follows/${userId}`) : api.delete(`/follows/${userId}`)),
  block: (userId: string) => api.post(`/blocks/${userId}`),
  search: (q: string, cursor?: string | null) => api.get<Json>('/search/athletes', { q, limit: 20, cursor }),
  profile: (username: string) => api.get<Json>(`/users/${username}`),
});

export const socialKeys = {
  friends: ['friends'] as const,
  requests: (direction: string) => ['friends', 'requests', direction] as const,
  profile: (username: string) => ['users', username] as const,
};

export function useFriends() {
  const api = useApi();
  return useQuery({ queryKey: socialKeys.friends, queryFn: () => socialApi(api).friends() });
}

export function useFriendRequests(direction: 'in' | 'out') {
  const api = useApi();
  return useQuery({ queryKey: socialKeys.requests(direction), queryFn: () => socialApi(api).requests(direction) });
}

export function usePublicProfile(username: string) {
  const api = useApi();
  return useQuery({ queryKey: socialKeys.profile(username), queryFn: () => socialApi(api).profile(username) });
}
