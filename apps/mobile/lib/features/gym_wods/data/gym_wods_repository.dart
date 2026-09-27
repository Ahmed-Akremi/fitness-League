import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';
import '../../../core/utils/format.dart';

/// Coach-made WODs of a gym: list, detail, score submission, Rx/Scaled boards, invalidation.
class GymWodsRepository {
  GymWodsRepository(this.api);
  final ApiClient api;

  Future<Map<String, dynamic>> list(String gymId, {String when = 'active'}) => api.get<Map<String, dynamic>>('/gyms/$gymId/wods', query: {'when': when, 'limit': 20});
  Future<Map<String, dynamic>> get(String gymId, String wodId) => api.get<Map<String, dynamic>>('/gyms/$gymId/wods/$wodId');
  Future<Map<String, dynamic>> create(String gymId, Map<String, dynamic> body) => api.post<Map<String, dynamic>>('/gyms/$gymId/wods', data: body);
  Future<Map<String, dynamic>> submit(String gymId, String wodId, Map<String, dynamic> body) => api.put<Map<String, dynamic>>('/gyms/$gymId/wods/$wodId/score', data: body);
  Future<Map<String, dynamic>> board(String gymId, String wodId, {String division = 'RX', String? cursor}) =>
      api.get<Map<String, dynamic>>('/gyms/$gymId/wods/$wodId/leaderboard', query: {'division': division, 'limit': 50, 'cursor': ?cursor});
  Future<void> invalidate(String gymId, String wodId, String scoreId, String reason) => api.post<dynamic>('/gyms/$gymId/wods/$wodId/scores/$scoreId/invalidate', data: {'reason': reason});
}

final gymWodsRepositoryProvider = Provider<GymWodsRepository>((ref) => GymWodsRepository(ref.watch(apiClientProvider)));
final wodProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, (String, String)>((ref, k) => ref.watch(gymWodsRepositoryProvider).get(k.$1, k.$2));

/// (gymId, when) → one page of WODs.
final gymWodsProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, (String, String)>((ref, k) => ref.watch(gymWodsRepositoryProvider).list(k.$1, when: k.$2));

/// FOR_TIME → "7:32", AMRAP → "12 rds · 190 reps" or "190 reps", MAX_LOAD → "102.5 kg".
String formatWodScore(String scoreType, Map<String, dynamic> s) {
  final v = s['value'] as num;
  return switch (scoreType) {
    'FOR_TIME' => formatDuration(v.round()),
    'MAX_LOAD' => '${v % 1 == 0 ? v.toInt() : v} kg',
    _ => s['rounds'] != null ? '${s['rounds']} rds · ${v.toInt()} reps' : '${v.toInt()} reps',
  };
}
