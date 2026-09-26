import 'package:fitness_league/core/network/api_client.dart';
import 'package:fitness_league/core/network/api_error.dart';
import 'package:fitness_league/core/storage/token_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';

void main() {
  group('ApiClient', () {
    test('refreshes once for concurrent 401s and retries both requests', () async {
      final backend = FakeBackend();
      final tokens = MemoryTokenStorage();
      final api = fakeClient(backend, tokens: tokens);
      await api.setSession(Session.fromJson(session('old')));

      backend.on('GET', '/me', (req) => req.headers['Authorization'] == 'Bearer access-new' ? (200, {'ok': true}) : (401, {'code': 'TOKEN_EXPIRED'}));
      backend.on('POST', '/auth/refresh', (req) {
        expect(req.data, {'refreshToken': 'refresh-old'});
        return (200, session('new'));
      });

      final results = await Future.wait([api.get<Map<String, dynamic>>('/me'), api.get<Map<String, dynamic>>('/me')]);
      expect(results, [
        {'ok': true},
        {'ok': true},
      ]);
      // Refresh tokens are single use on the server: two refreshes would be flagged as token theft.
      expect(backend.calls('POST', '/auth/refresh'), hasLength(1));
      expect(await tokens.readRefreshToken(), 'refresh-new');
    });

    test('signals session expiry when the refresh token is refused', () async {
      final backend = FakeBackend();
      var expired = 0;
      final api = fakeClient(backend, onExpired: () => expired++);
      await api.setSession(Session.fromJson(session()));
      backend.on('GET', '/me', (_) => (401, {'code': 'TOKEN_EXPIRED'}));
      backend.on('POST', '/auth/refresh', (_) => (401, {'code': 'TOKEN_REUSED'}));

      await expectLater(api.get<Map<String, dynamic>>('/me'), throwsA(isA<ApiError>().having((e) => e.kind, 'kind', ApiErrorKind.unauthenticated)));
      expect(expired, 1);
      expect(await api.tokens.readRefreshToken(), isNull);
    });

    test('maps problem+json to typed errors without leaking server text', () async {
      final backend = FakeBackend();
      final api = fakeClient(backend);
      backend.on('POST', '/auth/register', (_) => (422, {'code': 'VALIDATION_FAILED', 'errors': [{'field': 'username', 'code': 'MATCHES'}], 'title': 'internal detail'}));
      try {
        await api.post<void>('/auth/register', data: {});
        fail('should throw');
      } on ApiError catch (e) {
        expect(e.kind, ApiErrorKind.client);
        expect(e.code, 'VALIDATION_FAILED');
        expect(e.fieldCode('username'), 'MATCHES');
      }
      backend.offline = true;
      await expectLater(api.get<void>('/me'), throwsA(isA<ApiError>().having((e) => e.kind, 'kind', ApiErrorKind.network)));
    });
  });
}
