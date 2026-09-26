import 'package:dio/dio.dart';

/// Typed view of the API's problem+json errors (docs §4.3). The UI maps `code` to translated text;
/// stack traces and raw server messages are never shown.
class ApiError implements Exception {
  const ApiError({required this.kind, this.status, this.code, this.fieldErrors = const [], this.extra = const {}});

  final ApiErrorKind kind;
  final int? status;
  final String? code;
  final List<FieldError> fieldErrors;
  final Map<String, dynamic> extra;

  factory ApiError.fromDio(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return const ApiError(kind: ApiErrorKind.timeout);
      case DioExceptionType.connectionError:
        return const ApiError(kind: ApiErrorKind.network);
      default:
        break;
    }
    final res = e.response;
    if (res == null) return const ApiError(kind: ApiErrorKind.network);
    final body = res.data is Map<String, dynamic> ? res.data as Map<String, dynamic> : const <String, dynamic>{};
    final status = res.statusCode ?? 0;
    final errors = (body['errors'] as List?)?.whereType<Map<String, dynamic>>().map((m) => FieldError(field: '${m['field']}', code: '${m['code']}')).toList() ?? const [];
    final kind = switch (status) {
      401 => ApiErrorKind.unauthenticated,
      >= 500 => ApiErrorKind.server,
      _ => ApiErrorKind.client,
    };
    return ApiError(kind: kind, status: status, code: body['code'] as String?, fieldErrors: errors, extra: body);
  }

  String? fieldCode(String field) {
    for (final e in fieldErrors) {
      if (e.field == field) return e.code;
    }
    return null;
  }

  @override
  String toString() => 'ApiError($kind, $status, $code)';
}

enum ApiErrorKind { network, timeout, unauthenticated, client, server }

class FieldError {
  const FieldError({required this.field, required this.code});
  final String field;
  final String code;
}
