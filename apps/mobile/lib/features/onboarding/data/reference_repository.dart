import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

/// Public catalog (governorates, cities, sports, exercises). Cached for the app's lifetime.
class ReferenceRepository {
  ReferenceRepository(this.api);
  final ApiClient api;

  Future<List<Map<String, dynamic>>> _list(String path, [Map<String, dynamic>? q]) async =>
      (await api.get<List<dynamic>>(path, query: q)).cast<Map<String, dynamic>>();

  Future<List<Map<String, dynamic>>> governorates() => _list('/ref/governorates');
  Future<List<Map<String, dynamic>>> cities(String governorateId) => _list('/ref/cities', {'governorateId': governorateId});
  Future<List<Map<String, dynamic>>> sports() => _list('/ref/sports');
  Future<List<Map<String, dynamic>>> exercises(String sportId) => _list('/ref/exercises', {'sportId': sportId});
}

final referenceRepositoryProvider = Provider<ReferenceRepository>((ref) => ReferenceRepository(ref.watch(apiClientProvider)));
final governoratesProvider = FutureProvider<List<Map<String, dynamic>>>((ref) => ref.watch(referenceRepositoryProvider).governorates());
final citiesProvider = FutureProvider.family<List<Map<String, dynamic>>, String>((ref, id) => ref.watch(referenceRepositoryProvider).cities(id));
final sportsProvider = FutureProvider<List<Map<String, dynamic>>>((ref) => ref.watch(referenceRepositoryProvider).sports());
final exercisesProvider = FutureProvider.family<List<Map<String, dynamic>>, String>((ref, sportId) => ref.watch(referenceRepositoryProvider).exercises(sportId));
