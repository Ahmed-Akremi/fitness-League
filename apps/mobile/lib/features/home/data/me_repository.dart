import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

/// Everything about the signed-in athlete: /me, onboarding, ranks, XP, LP, weekly score.
class MeRepository {
  MeRepository(this.api);
  final ApiClient api;

  Future<Map<String, dynamic>> me() => api.get<Map<String, dynamic>>('/me');
  Future<Map<String, dynamic>> updateProfile(Map<String, dynamic> patch) => api.patch<Map<String, dynamic>>('/me/profile', data: patch);
  Future<Map<String, dynamic>> updateSettings(Map<String, dynamic> patch) => api.patch<Map<String, dynamic>>('/me/settings', data: patch);

  Future<void> setSports(List<String> sportIds, String primary) => api.post<void>('/me/onboarding/sports', data: {'sportIds': sportIds, 'primarySportId': primary});
  Future<void> declareBaselines(List<Map<String, dynamic>> entries) => api.post<void>('/me/onboarding/baselines', data: {'entries': entries});
  Future<void> completeOnboarding() => api.post<void>('/me/onboarding/complete');

  Future<Map<String, dynamic>> ranks() => api.get<Map<String, dynamic>>('/me/ranks');
  Future<Map<String, dynamic>> lp() => api.get<Map<String, dynamic>>('/me/lp');
  Future<Map<String, dynamic>> currentWeek() => api.get<Map<String, dynamic>>('/me/weekly-scores/current');
  Future<Map<String, dynamic>> exportData() => api.get<Map<String, dynamic>>('/me/export');
  Future<void> deleteAccount(String password) => api.delete<void>('/me', data: {'confirm': 'DELETE', 'password': password});
}

final meRepositoryProvider = Provider<MeRepository>((ref) => MeRepository(ref.watch(apiClientProvider)));

/// Cached /me; screens call `ref.invalidate(meProvider)` after changes.
final meProvider = FutureProvider<Map<String, dynamic>>((ref) => ref.watch(meRepositoryProvider).me());

/// Home dashboard: ranks, LP and this week's provisional score, loaded together.
final homeDashboardProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final repo = ref.watch(meRepositoryProvider);
  final results = await Future.wait([
    repo.ranks().catchError((_) => <String, dynamic>{}),
    repo.lp().catchError((_) => <String, dynamic>{}),
    repo.currentWeek().catchError((_) => <String, dynamic>{}),
  ]);
  return {'ranks': results[0], 'lp': results[1], 'week': results[2]};
});
