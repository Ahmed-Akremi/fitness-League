import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// Offline demo (build with --dart-define=DEMO=true): answers every request from responses recorded against the
/// local API with demo data (assets/demo/api.json), so the APK can be tried on a phone without any server.
/// Any email/password signs in as the demo athlete; writes succeed but change nothing.
class DemoBackend implements HttpClientAdapter {
  DemoBackend(this._recorded);

  final Map<String, dynamic> _recorded;

  static const _ignoredQuery = {'limit', 'cursor'};
  static const _emptyPage = {'data': [], 'page': {'nextCursor': null, 'hasMore': false}};

  static String _key(String method, String path, Map<String, dynamic> query) {
    final q = query.entries.where((e) => e.value != null && !_ignoredQuery.contains(e.key)).map((e) => '${e.key}=${e.value}').toList()..sort();
    return '$method $path${q.isEmpty ? '' : '?${q.join('&')}'}';
  }

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    await Future<void>.delayed(const Duration(milliseconds: 150));
    final (status, body) = _answer(options.method, options.path, options.queryParameters);
    return ResponseBody.fromString(body == null ? '' : jsonEncode(body), status, headers: {
      Headers.contentTypeHeader: ['application/json'],
    });
  }

  (int, Object?) _answer(String method, String path, Map<String, dynamic> query) {
    if (path.startsWith('/auth/')) {
      return switch (path) {
        '/auth/login' || '/auth/register' || '/auth/refresh' || '/auth/google' || '/auth/apple' => (200, _recorded['POST /auth/login']),
        _ => (204, null),
      };
    }
    if (method == 'GET') {
      if (path == '/search/athletes') return (200, _search('${query['q'] ?? ''}'.toLowerCase()));
      final exact = _recorded[_key(method, path, query)];
      if (exact != null) return (200, exact);
      // Same path with other filters (sort, search text…): the closest recorded answer.
      final prefix = 'GET $path';
      for (final e in _recorded.entries) {
        if (e.key == prefix || e.key.startsWith('$prefix?')) return (200, e.value);
      }
      return (404, {'code': 'NOT_FOUND', 'title': 'Not available in the offline demo', 'status': 404});
    }
    // Writes: accepted but not stored.
    if (method == 'POST' && path == '/workouts') return (201, _firstWorkout());
    if (method == 'POST' && path == '/workouts/sync') return (200, {'results': []});
    return (200, <String, dynamic>{});
  }

  Map<String, dynamic> _search(String q) {
    final seen = <String>{};
    final hits = <Object?>[];
    for (final e in _recorded.entries.where((e) => e.key.startsWith('GET /search/athletes'))) {
      for (final a in (e.value as Map)['data'] as List) {
        final m = a as Map;
        final text = '${m['username']} ${m['fullName']}'.toLowerCase();
        if (text.contains(q) && seen.add('${m['id']}')) hits.add(m);
      }
    }
    return {..._emptyPage, 'data': hits};
  }

  Object? _firstWorkout() {
    for (final e in _recorded.entries) {
      if (RegExp(r'^GET /workouts/[^/]+$').hasMatch(e.key)) return e.value;
    }
    return <String, dynamic>{};
  }

  @override
  void close({bool force = false}) {}
}
