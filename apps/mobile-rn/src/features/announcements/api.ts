import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';

import { useApi } from '../../core/services';

/** One admin news item on the home screen (text and/or one photo; likes only, never comments). */
export interface News {
  id: string;
  body: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
}

interface NewsPage {
  data: News[];
  page: { nextCursor: string | null; hasMore: boolean };
}

type LikeState = Pick<News, 'likeCount' | 'likedByMe'>;

export const newsKey = ['announcements'] as const;

export function useNews() {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: newsKey,
    queryFn: ({ pageParam }) => api.get<NewsPage>('/announcements', { limit: 5, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page?.nextCursor ?? null,
  });
}

function patch(qc: QueryClient, id: string, state: LikeState) {
  qc.setQueryData<InfiniteData<NewsPage>>(newsKey, (old) =>
    old && { ...old, pages: old.pages.map((p) => ({ ...p, data: p.data.map((n) => (n.id === id ? { ...n, ...state } : n)) })) },
  );
}

/** Like / unlike with an optimistic count; the server's count wins once it answers. */
export function useToggleLike() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (n: News) => (n.likedByMe ? api.delete<LikeState>(`/announcements/${n.id}/like`) : api.put<LikeState>(`/announcements/${n.id}/like`)),
    onMutate: async (n) => {
      await qc.cancelQueries({ queryKey: newsKey });
      const previous = qc.getQueryData<InfiniteData<NewsPage>>(newsKey);
      patch(qc, n.id, { likedByMe: !n.likedByMe, likeCount: Math.max(0, n.likeCount + (n.likedByMe ? -1 : 1)) });
      return { previous };
    },
    onError: (_e, _n, ctx) => {
      if (ctx?.previous) qc.setQueryData(newsKey, ctx.previous);
    },
    onSuccess: (state, n) => patch(qc, n.id, state),
  });
}
