import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

/// Gym Wars (API §gym-wars): my gym's war of the week, a war, a gym's history and enrolment.
class GymWarsRepository {
  GymWarsRepository(this.api);
  final ApiClient api;

  Future<Map<String, dynamic>> current() => api.get<Map<String, dynamic>>('/gym-wars/current');
  Future<Map<String, dynamic>> get(String id) => api.get<Map<String, dynamic>>('/gym-wars/$id');
  Future<Map<String, dynamic>> history(String gymId) => api.get<Map<String, dynamic>>('/gyms/$gymId/wars');
  Future<Map<String, dynamic>> setEnrolled(String gymId, bool enrolled) => api.post<Map<String, dynamic>>('/gyms/$gymId/wars/registration', data: {'enrolled': enrolled});
}

final gymWarsRepositoryProvider = Provider<GymWarsRepository>((ref) => GymWarsRepository(ref.watch(apiClientProvider)));
final currentGymWarProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) => ref.watch(gymWarsRepositoryProvider).current());
final gymWarProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, id) => ref.watch(gymWarsRepositoryProvider).get(id));
final gymWarHistoryProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, gymId) => ref.watch(gymWarsRepositoryProvider).history(gymId));
