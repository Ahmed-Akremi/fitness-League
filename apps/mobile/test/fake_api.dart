import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:fitness_league/core/network/api_client.dart';
import 'package:fitness_league/core/storage/token_storage.dart';

typedef Handler = (int, Object?) Function(RequestOptions req);

/// Scripted HTTP backend for tests: routes "METHOD /path" to handlers and records every request.
class FakeBackend implements HttpClientAdapter {
  final Map<String, Handler> routes = {};
  final List<RequestOptions> requests = [];
  bool offline = false;

  void on(String method, String path, Handler h) => routes['$method $path'] = h;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    if (offline) throw DioException.connectionError(requestOptions: options, reason: 'offline');
    final handler = routes['${options.method} ${options.path}'];
    final (status, body) = handler == null ? (404, {'code': 'NOT_FOUND'}) : handler(options);
    return ResponseBody.fromString(jsonEncode(body), status, headers: {
      Headers.contentTypeHeader: ['application/json'],
    });
  }

  @override
  void close({bool force = false}) {}

  List<RequestOptions> calls(String method, String path) => requests.where((r) => r.method == method && r.path == path).toList();
}

ApiClient fakeClient(FakeBackend backend, {TokenStorage? tokens, void Function()? onExpired}) {
  final dio = Dio(BaseOptions(baseUrl: 'http://test'))..httpClientAdapter = backend;
  return ApiClient(baseUrl: 'http://test', tokens: tokens ?? MemoryTokenStorage(), onSessionExpired: onExpired ?? () {}, dio: dio);
}

Map<String, dynamic> session([String suffix = '1']) => {'accessToken': 'access-$suffix', 'refreshToken': 'refresh-$suffix', 'userId': 'u1', 'expiresIn': 900};
