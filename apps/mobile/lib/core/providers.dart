import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'config/app_config.dart';
import 'network/api_client.dart';
import 'offline/outbox.dart';
import 'offline/workout_sync_service.dart';
import 'storage/token_storage.dart';

/// Overridden in main() (real implementations) and in tests (fakes).
final appConfigProvider = Provider<AppConfig>((_) => AppConfig.fromEnvironment());
final tokenStorageProvider = Provider<TokenStorage>((_) => MemoryTokenStorage());
final outboxStoreProvider = Provider<OutboxStore>((_) => MemoryOutboxStore());
final sharedPrefsProvider = Provider<SharedPreferences?>((_) => null);

/// Incremented when the API reports that the session can't be restored; the router sends the user to login.
final sessionExpiredProvider = StateProvider<int>((_) => 0);

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    baseUrl: ref.watch(appConfigProvider).apiBaseUrl,
    tokens: ref.watch(tokenStorageProvider),
    onSessionExpired: () => ref.read(sessionExpiredProvider.notifier).state++,
  );
});

final workoutSyncProvider = Provider<WorkoutSyncService>((ref) => WorkoutSyncService(api: ref.watch(apiClientProvider), store: ref.watch(outboxStoreProvider)));

// ───────────── Preferences (per device) ─────────────

class LocaleController extends StateNotifier<Locale?> {
  LocaleController(this._prefs) : super(_read(_prefs));
  final SharedPreferences? _prefs;

  static Locale? _read(SharedPreferences? p) {
    final code = p?.getString('locale');
    return code == null ? null : Locale(code);
  }

  void set(Locale? locale) {
    state = locale;
    if (locale == null) {
      _prefs?.remove('locale');
    } else {
      _prefs?.setString('locale', locale.languageCode);
    }
  }
}

final localeProvider = StateNotifierProvider<LocaleController, Locale?>((ref) => LocaleController(ref.watch(sharedPrefsProvider)));

class ThemeModeController extends StateNotifier<ThemeMode> {
  ThemeModeController(this._prefs) : super(ThemeMode.values.byName(_prefs?.getString('theme') ?? ThemeMode.dark.name));
  final SharedPreferences? _prefs;

  void set(ThemeMode mode) {
    state = mode;
    _prefs?.setString('theme', mode.name);
  }
}

/// Dark first (spec §19.5).
final themeModeProvider = StateNotifierProvider<ThemeModeController, ThemeMode>((ref) => ThemeModeController(ref.watch(sharedPrefsProvider)));
