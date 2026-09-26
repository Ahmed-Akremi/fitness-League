import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Refresh token in the Keychain / Android Keystore (docs §9.1); access token only in memory.
abstract class TokenStorage {
  Future<String?> readRefreshToken();
  Future<void> writeRefreshToken(String? token);
}

class SecureTokenStorage implements TokenStorage {
  SecureTokenStorage([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'refresh_token';
  final FlutterSecureStorage _storage;

  @override
  Future<String?> readRefreshToken() => _storage.read(key: _key);

  @override
  Future<void> writeRefreshToken(String? token) => token == null ? _storage.delete(key: _key) : _storage.write(key: _key, value: token);
}

class MemoryTokenStorage implements TokenStorage {
  String? _token;

  @override
  Future<String?> readRefreshToken() async => _token;

  @override
  Future<void> writeRefreshToken(String? token) async => _token = token;
}
