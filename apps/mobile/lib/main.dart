import 'dart:async';
import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'core/network/api_client.dart';
import 'core/network/demo_backend.dart';
import 'core/network/realtime.dart';
import 'core/offline/drift_outbox_store.dart';
import 'core/offline/outbox.dart';
import 'core/providers.dart';
import 'core/storage/token_storage.dart';
import 'features/auth/data/session_controller.dart';

/// Offline demo build: every request is answered on the phone from recorded demo data (no server needed).
const _demo = bool.fromEnvironment('DEMO');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final demoBackend = _demo ? DemoBackend(jsonDecode(await rootBundle.loadString('assets/demo/api.json')) as Map<String, dynamic>) : null;
  final container = ProviderContainer(overrides: [
    if (demoBackend != null)
      apiClientProvider.overrideWith((ref) => ApiClient(
            baseUrl: 'http://demo',
            tokens: ref.watch(tokenStorageProvider),
            onSessionExpired: () => ref.read(sessionExpiredProvider.notifier).state++,
            dio: Dio(BaseOptions(baseUrl: 'http://demo'))..httpClientAdapter = demoBackend,
          )),
    tokenStorageProvider.overrideWithValue(SecureTokenStorage()),
    // Web is a preview target: the offline queue lives in memory there (SQLite on web needs extra wasm assets).
    outboxStoreProvider.overrideWithValue(kIsWeb ? MemoryOutboxStore() : DriftOutboxStore(OfflineDatabase())),
    sharedPrefsProvider.overrideWithValue(prefs),
    if (demoBackend == null) realtimeProvider.overrideWith((ref) => SocketRealtime(apiBaseUrl: ref.watch(appConfigProvider).apiBaseUrl, token: () => ref.read(apiClientProvider).accessToken)),
  ]);

  final locale = container.read(localeProvider);
  if (locale != null) container.read(apiClientProvider).language = locale.languageCode;
  unawaited(container.read(sessionProvider.notifier).restore());
  // Live events while signed in (notifications, battle scores); polling remains the fallback.
  container.listen(sessionProvider, (_, status) {
    final rt = container.read(realtimeProvider);
    status == AuthStatus.signedIn ? rt.connect() : rt.disconnect();
  }, fireImmediately: true);

  // Offline workouts are sent as soon as connectivity comes back (spec §7).
  Connectivity().onConnectivityChanged.listen((results) {
    if (results.any((r) => r != ConnectivityResult.none) && container.read(sessionProvider) == AuthStatus.signedIn) {
      container.read(workoutSyncProvider).flush().catchError((_) => 0);
    }
  });

  runApp(UncontrolledProviderScope(container: container, child: const FitnessLeagueApp()));
}
