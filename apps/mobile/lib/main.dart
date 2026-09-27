import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'core/offline/drift_outbox_store.dart';
import 'core/offline/outbox.dart';
import 'core/providers.dart';
import 'core/storage/token_storage.dart';
import 'features/auth/data/session_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final container = ProviderContainer(overrides: [
    tokenStorageProvider.overrideWithValue(SecureTokenStorage()),
    // Web is a preview target: the offline queue lives in memory there (SQLite on web needs extra wasm assets).
    outboxStoreProvider.overrideWithValue(kIsWeb ? MemoryOutboxStore() : DriftOutboxStore(OfflineDatabase())),
    sharedPrefsProvider.overrideWithValue(prefs),
  ]);

  final locale = container.read(localeProvider);
  if (locale != null) container.read(apiClientProvider).language = locale.languageCode;
  unawaited(container.read(sessionProvider.notifier).restore());

  // Offline workouts are sent as soon as connectivity comes back (spec §7).
  Connectivity().onConnectivityChanged.listen((results) {
    if (results.any((r) => r != ConnectivityResult.none) && container.read(sessionProvider) == AuthStatus.signedIn) {
      container.read(workoutSyncProvider).flush().catchError((_) => 0);
    }
  });

  runApp(UncontrolledProviderScope(container: container, child: const FitnessLeagueApp()));
}
