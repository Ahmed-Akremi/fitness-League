import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

/// Activity feed, reactions and comments (API §feed).
class FeedRepository {
  FeedRepository(this.api);
  final ApiClient api;

  Future<Map<String, dynamic>> feed({String? cursor}) => api.get<Map<String, dynamic>>('/feed', query: {'limit': 20, 'cursor': ?cursor});
  Future<Map<String, dynamic>> react(String id, String type) => api.put<Map<String, dynamic>>('/activities/$id/reactions', data: {'type': type});
  Future<Map<String, dynamic>> unreact(String id) => api.delete<Map<String, dynamic>>('/activities/$id/reactions');
  Future<Map<String, dynamic>> comments(String id) => api.get<Map<String, dynamic>>('/activities/$id/comments', query: {'limit': 50});
  Future<Map<String, dynamic>> comment(String id, String body) => api.post<Map<String, dynamic>>('/activities/$id/comments', data: {'body': body});
  Future<void> deleteComment(String id, String commentId) => api.delete<dynamic>('/activities/$id/comments/$commentId');
}

final feedRepositoryProvider = Provider<FeedRepository>((ref) => FeedRepository(ref.watch(apiClientProvider)));
final commentsProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, id) => ref.watch(feedRepositoryProvider).comments(id));
