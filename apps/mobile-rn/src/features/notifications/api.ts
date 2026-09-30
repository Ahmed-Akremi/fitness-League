import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { ApiClient, Json } from '../../core/api/client';
import type { T } from '../../core/prefs';
import { useServices } from '../../core/services';
import { localized } from '../../core/utils/format';
import type { IconName } from '../../core/widgets/kit';

/** In-app notifications (push arrives in Phase 2). */
export const notificationsApi = (api: ApiClient) => ({
  list: (cursor?: string | null) => api.get<Json>('/notifications', { limit: 30, cursor }),
  /** Without ids, everything is marked read. */
  markRead: (ids?: string[]) => api.post('/notifications/read', ids ? { ids } : {}),
});

export const unreadKey = ['notifications', 'unread'] as const;

export function useUnreadCount() {
  const { api, realtime } = useServices();
  const qc = useQueryClient();
  // A live notification refreshes the count without waiting for the next screen change.
  useEffect(() => realtime.onNotification(() => qc.invalidateQueries({ queryKey: unreadKey })), [realtime, qc]);
  return useQuery({ queryKey: unreadKey, queryFn: async () => Number((await notificationsApi(api).list()).unread ?? 0) });
}

/** Human text for a notification. Friend/battle payloads carry ids only, so texts stay generic. */
export function notificationText(t: T, locale: string, n: Json): string {
  const p: Json = n.payload ?? {};
  switch (n.type) {
    case 'FRIEND_REQUEST':
      return t('notifFriendRequest');
    case 'FRIEND_ACCEPTED':
      return t('notifFriendAccepted');
    case 'BATTLE_INVITE':
      return t('notifBattleInvite');
    case 'BATTLE_STARTED':
      return t('notifBattleStarted');
    case 'BATTLE_DECLINED':
      return t('notifBattleDeclined');
    case 'BATTLE_RESULT':
      return t('notifBattleResult');
    case 'DUEL_MATCHED':
      return t('notifDuelMatched');
    case 'DUEL_GHOST':
      return t('notifDuelGhost');
    case 'CHALLENGE_COMPLETED':
      return t('notifChallengeCompleted', { title: p.title ?? '' });
    case 'PROOF_VERIFIED':
      return t('notifProofVerified');
    case 'PROOF_REJECTED':
      return t('notifProofRejected');
    case 'ACTIVITY_REACTION':
      return t('notifActivityReaction');
    case 'ACTIVITY_COMMENT':
      return t('notifActivityComment');
    case 'BADGE_AWARDED':
      return t('notifBadgeAwarded', { name: localized(p.name, locale) });
    case 'GYM_WAR_STARTED':
      return t('notifGymWarStarted', { name: p.opponentName ?? '' });
    case 'GYM_WAR_RESULT':
      return p.outcome === 'WIN' ? t('notifGymWarWon') : p.outcome === 'LOSS' ? t('notifGymWarLost') : t('notifGymWarDraw');
    case 'GYM_WOD_SCORE_INVALIDATED':
      return t('notifWodInvalidated', { wod: p.wodTitle ?? '', reason: p.reason ?? '' });
    default:
      return t('notifGeneric');
  }
}

/** Screen a notification opens, if any. */
export function notificationRoute(n: Json): string | null {
  const p: Json = n.payload ?? {};
  switch (n.type) {
    case 'FRIEND_REQUEST':
    case 'FRIEND_ACCEPTED':
      return '/friends';
    case 'BATTLE_INVITE':
    case 'BATTLE_STARTED':
    case 'BATTLE_DECLINED':
    case 'BATTLE_RESULT':
    case 'DUEL_MATCHED':
    case 'DUEL_GHOST':
      return p.battleId == null ? '/battles' : `/battles/${p.battleId}`;
    case 'GYM_WOD_SCORE_INVALIDATED':
      return `/gyms/${p.gymId}/wods/${p.wodId}`;
    case 'GYM_WAR_STARTED':
    case 'GYM_WAR_RESULT':
      return `/gym-wars/${p.warId}`;
    case 'BADGE_AWARDED':
      return '/badges';
    case 'PROOF_VERIFIED':
    case 'PROOF_REJECTED':
      return `/workouts/${p.workoutId}`;
    case 'ACTIVITY_REACTION':
    case 'ACTIVITY_COMMENT':
      return '/feed';
    case 'CHALLENGE_COMPLETED':
      return `/challenges/${p.challengeId}`;
    default:
      return null;
  }
}

export function notificationIcon(type?: string): IconName {
  if (type === 'FRIEND_REQUEST' || type === 'FRIEND_ACCEPTED') return 'person-add-alt-1';
  if (type === 'GYM_WOD_SCORE_INVALIDATED') return 'report-gmailerrorred';
  return 'sports-mma';
}
