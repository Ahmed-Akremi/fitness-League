import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

/// Challenges (API §challenges): list, detail with leaderboard, create, join, leave, delete.
class ChallengesRepository {
  ChallengesRepository(this.api);
  final ApiClient api;

  Future<List<Map<String, dynamic>>> list({bool ended = false}) async =>
      (await api.get<List<dynamic>>('/challenges', query: {'status': ended ? 'ENDED' : 'ACTIVE'})).cast<Map<String, dynamic>>();
  Future<Map<String, dynamic>> get(String id) => api.get<Map<String, dynamic>>('/challenges/$id');
  Future<Map<String, dynamic>> create(Map<String, dynamic> body) => api.post<Map<String, dynamic>>('/challenges', data: body);
  Future<Map<String, dynamic>> join(String id) => api.post<Map<String, dynamic>>('/challenges/$id/join');
  Future<Map<String, dynamic>> leave(String id) => api.delete<Map<String, dynamic>>('/challenges/$id/join');
  Future<void> remove(String id) => api.delete<dynamic>('/challenges/$id');
}

final challengesRepositoryProvider = Provider<ChallengesRepository>((ref) => ChallengesRepository(ref.watch(apiClientProvider)));
final challengesProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, bool>((ref, ended) => ref.watch(challengesRepositoryProvider).list(ended: ended));
final challengeProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, id) => ref.watch(challengesRepositoryProvider).get(id));
