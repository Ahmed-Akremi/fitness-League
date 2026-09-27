import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

/// Gym directory, profile, membership, logo and member management (API §gyms).
class GymsRepository {
  GymsRepository(this.api);
  final ApiClient api;

  Future<Map<String, dynamic>> list({String? q, String? sport, String? governorateId, String sort = 'name', String? cursor, int limit = 20}) =>
      api.get<Map<String, dynamic>>('/gyms', query: {
        'limit': limit,
        'sort': sort,
        'q': ?(q == null || q.isEmpty ? null : q),
        'sport': ?sport,
        'governorateId': ?governorateId,
        'cursor': ?cursor,
      });
  Future<Map<String, dynamic>> get(String id) => api.get<Map<String, dynamic>>('/gyms/$id');
  Future<Map<String, dynamic>> create(Map<String, dynamic> body) => api.post<Map<String, dynamic>>('/gyms', data: body);
  Future<List<Map<String, dynamic>>> mine() async => (await api.get<List<dynamic>>('/gyms/mine')).cast<Map<String, dynamic>>();
  Future<void> join(String id) => api.post<dynamic>('/gyms/$id/membership');
  Future<void> leave() => api.delete<dynamic>('/gyms/me/membership');
  Future<Map<String, dynamic>> uploadLogo(String id, List<int> bytes, String filename) => api.upload<Map<String, dynamic>>('/gyms/$id/logo', bytes: bytes, filename: filename);
  Future<Map<String, dynamic>> members(String id, {String? cursor}) => api.get<Map<String, dynamic>>('/gyms/$id/members', query: {'limit': 50, 'cursor': ?cursor});
  Future<List<Map<String, dynamic>>> requests(String id) async => (await api.get<List<dynamic>>('/gyms/$id/membership-requests')).cast<Map<String, dynamic>>();
  Future<void> decide(String id, String userId, String action) => api.post<dynamic>('/gyms/$id/members/$userId/$action');
  Future<void> setCoach(String id, String userId, bool coach) => coach ? api.post<dynamic>('/gyms/$id/members/$userId/coach') : api.delete<dynamic>('/gyms/$id/members/$userId/coach');
}

final gymsRepositoryProvider = Provider<GymsRepository>((ref) => GymsRepository(ref.watch(apiClientProvider)));
final gymProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, id) => ref.watch(gymsRepositoryProvider).get(id));
final myGymsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) => ref.watch(gymsRepositoryProvider).mine());
