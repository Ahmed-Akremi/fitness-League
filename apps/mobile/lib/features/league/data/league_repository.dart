import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

enum LeagueScope { national, region, gym, friends }

class LeagueRepository {
  LeagueRepository(this.api);
  final ApiClient api;

  String _path(LeagueScope scope, {String? governorateId, String? gymId}) => switch (scope) {
        LeagueScope.national => '/leaderboards/national',
        LeagueScope.region => '/leaderboards/governorates/$governorateId',
        LeagueScope.gym => '/leaderboards/gyms/$gymId',
        LeagueScope.friends => '/leaderboards/friends',
      };

  Future<Map<String, dynamic>> page(LeagueScope scope, {String? governorateId, String? gymId, String? cursor, int limit = 30}) =>
      api.get<Map<String, dynamic>>(_path(scope, governorateId: governorateId, gymId: gymId), query: {'limit': limit, 'cursor': ?cursor});

  Future<Map<String, dynamic>> aroundMe(LeagueScope scope, {String? governorateId, String? gymId, int limit = 30}) =>
      api.get<Map<String, dynamic>>('${_path(scope, governorateId: governorateId, gymId: gymId)}/me', query: {'limit': limit});
}

final leagueRepositoryProvider = Provider<LeagueRepository>((ref) => LeagueRepository(ref.watch(apiClientProvider)));
