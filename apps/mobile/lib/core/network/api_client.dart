import 'dart:async';

import 'package:dio/dio.dart';

import '../storage/token_storage.dart';
import 'api_error.dart';

/// Session tokens returned by /auth/login, /auth/register, /auth/refresh.
class Session {
  const Session({required this.accessToken, required this.refreshToken, required this.userId});

  factory Session.fromJson(Map<String, dynamic> j) =>
      Session(accessToken: j['accessToken'] as String, refreshToken: j['refreshToken'] as String, userId: j['userId'] as String);

  final String accessToken;
  final String refreshToken;
  final String userId;
}

/// HTTP client for the Fitness League API.
///
/// Refresh tokens are single use on the server (rotation + reuse detection), so concurrent 401s must share ONE
/// refresh call; otherwise the second refresh would look like a stolen token and log the user out everywhere.
class ApiClient {
  ApiClient({required String baseUrl, required this.tokens, required this.onSessionExpired, Dio? dio, String? acceptLanguage})
      : dio = dio ?? Dio(BaseOptions(baseUrl: baseUrl, connectTimeout: const Duration(seconds: 10), receiveTimeout: const Duration(seconds: 20))) {
    this.dio.options.headers['Accept-Language'] = acceptLanguage ?? 'fr';
    this.dio.interceptors.add(InterceptorsWrapper(onRequest: _onRequest, onError: _onError));
  }

  final Dio dio;
  final TokenStorage tokens;
  final void Function() onSessionExpired;
  String? _accessToken;
  Future<bool>? _refreshing;

  bool get hasAccessToken => _accessToken != null;
  String? get accessToken => _accessToken;

  Future<void> setSession(Session s) async {
    _accessToken = s.accessToken;
    await tokens.writeRefreshToken(s.refreshToken);
  }

  Future<void> clearSession() async {
    _accessToken = null;
    await tokens.writeRefreshToken(null);
  }

  set language(String code) => dio.options.headers['Accept-Language'] = code;

  /// Restores a session at startup from the stored refresh token.
  Future<bool> restore() => _refresh();

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) => _call(() => dio.get<T>(path, queryParameters: query));
  Future<T> post<T>(String path, {Object? data, Map<String, String>? headers}) => _call(() => dio.post<T>(path, data: data, options: Options(headers: headers)));
  Future<T> patch<T>(String path, {Object? data, Map<String, String>? headers}) => _call(() => dio.patch<T>(path, data: data, options: Options(headers: headers)));
  Future<T> delete<T>(String path, {Object? data}) => _call(() => dio.delete<T>(path, data: data));
  Future<T> put<T>(String path, {Object? data}) => _call(() => dio.put<T>(path, data: data));

  /// Multipart upload (field "file" by default).
  Future<T> upload<T>(String path, {required List<int> bytes, required String filename, String field = 'file', bool post = false, Map<String, dynamic>? query}) {
    final form = FormData.fromMap({field: MultipartFile.fromBytes(bytes, filename: filename)});
    return _call(() => post ? dio.post<T>(path, data: form, queryParameters: query) : dio.put<T>(path, data: form, queryParameters: query));
  }

  Future<T> _call<T>(Future<Response<T>> Function() request) async {
    try {
      return (await request()).data as T;
    } on DioException catch (e) {
      throw e.error is ApiError ? e.error! as ApiError : ApiError.fromDio(e);
    }
  }

  void _onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (_accessToken != null && !options.path.startsWith('/auth/refresh')) {
      options.headers['Authorization'] = 'Bearer $_accessToken';
    }
    handler.next(options);
  }

  Future<void> _onError(DioException err, ErrorInterceptorHandler handler) async {
    final code = (err.response?.data is Map) ? (err.response!.data as Map)['code'] : null;
    final retriable = err.response?.statusCode == 401 &&
        (code == 'TOKEN_EXPIRED' || code == 'TOKEN_INVALID') &&
        err.requestOptions.extra['retried'] != true &&
        !err.requestOptions.path.startsWith('/auth/');
    if (!retriable) return handler.next(err);

    if (!await _refresh()) {
      onSessionExpired();
      return handler.next(err);
    }
    final retry = err.requestOptions
      ..extra['retried'] = true
      ..headers['Authorization'] = 'Bearer $_accessToken';
    try {
      handler.resolve(await dio.fetch(retry));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  Future<bool> _refresh() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<bool> _doRefresh() async {
    final refresh = await tokens.readRefreshToken();
    if (refresh == null) return false;
    try {
      final res = await dio.post<Map<String, dynamic>>('/auth/refresh', data: {'refreshToken': refresh});
      await setSession(Session.fromJson(res.data!));
      return true;
    } on DioException catch (e) {
      // Network failure: keep the stored token so the next attempt can succeed.
      if (e.response == null) return false;
      await clearSession();
      return false;
    }
  }
}
