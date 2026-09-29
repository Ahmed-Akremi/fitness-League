import 'package:flutter/material.dart' show IconData, Icons;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

/// In-app notifications (push arrives in Phase 2).
class NotificationsRepository {
  NotificationsRepository(this.api);
  final ApiClient api;

  Future<Map<String, dynamic>> list({String? cursor}) => api.get<Map<String, dynamic>>('/notifications', query: {'limit': 30, 'cursor': ?cursor});

  /// Without [ids], everything is marked read.
  Future<void> markRead([List<String>? ids]) => api.post<dynamic>('/notifications/read', data: {'ids': ?ids});
}

final notificationsRepositoryProvider = Provider<NotificationsRepository>((ref) => NotificationsRepository(ref.watch(apiClientProvider)));
final unreadCountProvider = FutureProvider.autoDispose<int>((ref) async => ((await ref.watch(notificationsRepositoryProvider).list())['unread'] as num?)?.toInt() ?? 0);

/// Human text for a notification. Friend/battle payloads carry ids only, so texts stay generic.
String notificationText(AppLocalizations l, Map<String, dynamic> n) {
  final p = (n['payload'] as Map?)?.cast<String, dynamic>() ?? const {};
  return switch (n['type']) {
    'FRIEND_REQUEST' => l.notifFriendRequest,
    'FRIEND_ACCEPTED' => l.notifFriendAccepted,
    'BATTLE_INVITE' => l.notifBattleInvite,
    'BATTLE_STARTED' => l.notifBattleStarted,
    'BATTLE_DECLINED' => l.notifBattleDeclined,
    'BATTLE_RESULT' => l.notifBattleResult,
    'DUEL_MATCHED' => l.notifDuelMatched,
    'DUEL_GHOST' => l.notifDuelGhost,
    'GYM_WOD_SCORE_INVALIDATED' => l.notifWodInvalidated((p['wodTitle'] ?? '') as String, (p['reason'] ?? '') as String),
    _ => l.notifGeneric,
  };
}

/// Screen a notification opens, if any.
String? notificationRoute(Map<String, dynamic> n) {
  final p = (n['payload'] as Map?)?.cast<String, dynamic>() ?? const {};
  return switch (n['type']) {
    'FRIEND_REQUEST' || 'FRIEND_ACCEPTED' => '/friends',
    'BATTLE_INVITE' || 'BATTLE_STARTED' || 'BATTLE_DECLINED' || 'BATTLE_RESULT' || 'DUEL_MATCHED' || 'DUEL_GHOST' => p['battleId'] == null ? '/battles' : '/battles/${p['battleId']}',
    'GYM_WOD_SCORE_INVALIDATED' => '/gyms/${p['gymId']}/wods/${p['wodId']}',
    _ => null,
  };
}

IconData notificationIcon(String? type) => switch (type) {
      'FRIEND_REQUEST' || 'FRIEND_ACCEPTED' => Icons.person_add_alt_1_rounded,
      'GYM_WOD_SCORE_INVALIDATED' => Icons.report_gmailerrorred_rounded,
      _ => Icons.sports_mma_rounded,
    };
