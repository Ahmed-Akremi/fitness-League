import '../../../core/network/api_client.dart';

/// Registration payload (spec §6 step 1).
class RegistrationData {
  const RegistrationData({
    required this.username,
    required this.fullName,
    required this.email,
    required this.password,
    required this.dateOfBirth,
    required this.governorateId,
    required this.cityId,
    required this.healthDataConsent,
    required this.locale,
  });

  final String username;
  final String fullName;
  final String email;
  final String password;
  final DateTime dateOfBirth;
  final String governorateId;
  final String cityId;
  final bool healthDataConsent;
  final String locale;

  Map<String, dynamic> toJson() => {
        'username': username,
        'fullName': fullName,
        'email': email,
        'password': password,
        'dateOfBirth': '${dateOfBirth.year.toString().padLeft(4, '0')}-${dateOfBirth.month.toString().padLeft(2, '0')}-${dateOfBirth.day.toString().padLeft(2, '0')}',
        'countryCode': 'TN',
        'governorateId': governorateId,
        'cityId': cityId,
        'locale': locale,
        // Terms and privacy are ticked explicitly in the form; the version is the one displayed.
        'consents': {'terms': true, 'privacy': true, 'healthData': healthDataConsent, 'documentVersion': '2026-09'},
      };
}

class AuthRepository {
  AuthRepository(this.api);
  final ApiClient api;

  Future<Session> login(String email, String password) async {
    final s = Session.fromJson(await api.post<Map<String, dynamic>>('/auth/login', data: {'email': email, 'password': password}));
    await api.setSession(s);
    return s;
  }

  Future<Session> register(RegistrationData data) async {
    final s = Session.fromJson(await api.post<Map<String, dynamic>>('/auth/register', data: data.toJson()));
    await api.setSession(s);
    return s;
  }

  Future<void> logout() async {
    final refresh = await api.tokens.readRefreshToken();
    try {
      if (refresh != null) await api.post<void>('/auth/logout', data: {'refreshToken': refresh});
    } finally {
      await api.clearSession();
    }
  }

  Future<void> forgotPassword(String email) => api.post<void>('/auth/password/forgot', data: {'email': email});
  Future<void> resendVerification() => api.post<void>('/auth/email/resend');
}
