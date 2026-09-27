import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

/// Friend Battles: list, detail with live scores, create, accept / decline / cancel.
class BattlesRepository {
  BattlesRepository(this.api);
  final ApiClient api;

  Future<Map<String, dynamic>> list({String? status}) => api.get<Map<String, dynamic>>('/battles', query: {'limit': 30, 'status': ?status});
  Future<Map<String, dynamic>> get(String id) => api.get<Map<String, dynamic>>('/battles/$id');
  Future<Map<String, dynamic>> create(String opponentId, int durationDays, List<String>? components) =>
      api.post<Map<String, dynamic>>('/battles', data: {'opponentId': opponentId, 'durationDays': durationDays, 'components': ?components});
  Future<void> act(String id, String action) => api.post<dynamic>('/battles/$id/$action');
}

final battlesRepositoryProvider = Provider<BattlesRepository>((ref) => BattlesRepository(ref.watch(apiClientProvider)));
