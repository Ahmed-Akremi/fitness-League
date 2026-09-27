import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

/// Friends, follows, blocks, athlete search and public profiles.
class SocialRepository {
  SocialRepository(this.api);
  final ApiClient api;

  Future<List<Map<String, dynamic>>> _list(String path, [Map<String, dynamic>? q]) async => (await api.get<List<dynamic>>(path, query: q)).cast<Map<String, dynamic>>();

  Future<List<Map<String, dynamic>>> friends() => _list('/friends');
  Future<List<Map<String, dynamic>>> requests(String direction) => _list('/friends/requests', {'direction': direction});
  Future<void> sendRequest(String userId) => api.post<dynamic>('/friends/requests', data: {'userId': userId});
  Future<void> answer(String userId, bool accept) => api.post<dynamic>('/friends/requests/$userId/${accept ? 'accept' : 'decline'}');
  Future<void> unfriend(String userId) => api.delete<dynamic>('/friends/$userId');
  Future<void> follow(String userId, bool on) => on ? api.post<dynamic>('/follows/$userId') : api.delete<dynamic>('/follows/$userId');
  Future<void> block(String userId) => api.post<dynamic>('/blocks/$userId');
  Future<Map<String, dynamic>> search(String q, {String? cursor}) => api.get<Map<String, dynamic>>('/search/athletes', query: {'q': q, 'limit': 20, 'cursor': ?cursor});
  Future<Map<String, dynamic>> profile(String username) => api.get<Map<String, dynamic>>('/users/$username');
}

final socialRepositoryProvider = Provider<SocialRepository>((ref) => SocialRepository(ref.watch(apiClientProvider)));
final publicProfileProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, username) => ref.watch(socialRepositoryProvider).profile(username));
final friendsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) => ref.watch(socialRepositoryProvider).friends());
