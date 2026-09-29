import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

/// User-made leagues (API §leagues).
class LeaguesRepository {
  LeaguesRepository(this.api);
  final ApiClient api;

  Future<Map<String, dynamic>> list() => api.get<Map<String, dynamic>>('/leagues');
  Future<Map<String, dynamic>> get(String id) => api.get<Map<String, dynamic>>('/leagues/$id');
  Future<Map<String, dynamic>> leaderboard(String id) => api.get<Map<String, dynamic>>('/leagues/$id/leaderboard');
  Future<Map<String, dynamic>> create(Map<String, dynamic> body) => api.post<Map<String, dynamic>>('/leagues', data: body);
  Future<Map<String, dynamic>> join(String id) => api.post<Map<String, dynamic>>('/leagues/$id/join');
  Future<Map<String, dynamic>> joinByCode(String code) => api.post<Map<String, dynamic>>('/leagues/join-by-code', data: {'code': code});
  Future<void> leave(String id) => api.delete<dynamic>('/leagues/$id/membership');
  Future<void> remove(String id) => api.delete<dynamic>('/leagues/$id');
}

final leaguesRepositoryProvider = Provider<LeaguesRepository>((ref) => LeaguesRepository(ref.watch(apiClientProvider)));
final leaguesProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) => ref.watch(leaguesRepositoryProvider).list());
final leagueProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, id) => ref.watch(leaguesRepositoryProvider).get(id));
final leagueBoardProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, id) => ref.watch(leaguesRepositoryProvider).leaderboard(id));
