import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

class WorkoutsRepository {
  WorkoutsRepository(this.api);
  final ApiClient api;

  Future<Map<String, dynamic>> list({String? cursor, int limit = 20}) =>
      api.get<Map<String, dynamic>>('/workouts', query: {'limit': limit, 'cursor': ?cursor});
  Future<Map<String, dynamic>> get(String id) => api.get<Map<String, dynamic>>('/workouts/$id');
  Future<Map<String, dynamic>> points(String id) => api.get<Map<String, dynamic>>('/workouts/$id/points');
  Future<void> delete(String id) => api.delete<void>('/workouts/$id');
}

final workoutsRepositoryProvider = Provider<WorkoutsRepository>((ref) => WorkoutsRepository(ref.watch(apiClientProvider)));
final workoutsProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) => ref.watch(workoutsRepositoryProvider).list());
final workoutDetailProvider = FutureProvider.autoDispose.family<(Map<String, dynamic>, Map<String, dynamic>), String>((ref, id) async {
  final repo = ref.watch(workoutsRepositoryProvider);
  final results = await Future.wait([repo.get(id), repo.points(id)]);
  return (results[0], results[1]);
});
final pendingWorkoutsProvider = FutureProvider.autoDispose((ref) => ref.watch(workoutSyncProvider).pending());
