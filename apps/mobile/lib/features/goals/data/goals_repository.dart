import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

class GoalsRepository {
  GoalsRepository(this.api);
  final ApiClient api;

  Future<List<Map<String, dynamic>>> list() async => (await api.get<List<dynamic>>('/goals')).cast<Map<String, dynamic>>();
  Future<Map<String, dynamic>> create(Map<String, dynamic> body) => api.post<Map<String, dynamic>>('/goals', data: body);
  Future<Map<String, dynamic>> suggestions(String type, String exerciseId, String metricCode) =>
      api.post<Map<String, dynamic>>('/goals/suggestions', data: {'type': type, 'exerciseId': exerciseId, 'metricCode': metricCode});
  Future<void> abandon(String id) => api.delete<void>('/goals/$id');
}

final goalsRepositoryProvider = Provider<GoalsRepository>((ref) => GoalsRepository(ref.watch(apiClientProvider)));
final goalsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) => ref.watch(goalsRepositoryProvider).list());
