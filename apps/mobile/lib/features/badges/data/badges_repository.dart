import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

/// Badges (API §badges): the catalogue with my progress.
class BadgesRepository {
  BadgesRepository(this.api);
  final ApiClient api;

  Future<List<Map<String, dynamic>>> catalog() async => (await api.get<List<dynamic>>('/badges')).cast<Map<String, dynamic>>();
}

final badgesRepositoryProvider = Provider<BadgesRepository>((ref) => BadgesRepository(ref.watch(apiClientProvider)));
final badgesProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) => ref.watch(badgesRepositoryProvider).catalog());
