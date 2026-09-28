import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:fitness_league/core/l10n/l10n.dart';
import 'package:fitness_league/core/network/api_client.dart';
import 'package:fitness_league/core/network/demo_backend.dart';
import 'package:fitness_league/core/providers.dart';
import 'package:fitness_league/core/storage/token_storage.dart';
import 'package:fitness_league/core/widgets/error_text.dart';
import 'package:fitness_league/features/battles/presentation/battles_screen.dart';
import 'package:fitness_league/features/gyms/presentation/gym_profile_screen.dart';
import 'package:fitness_league/features/gyms/presentation/gyms_screen.dart';
import 'package:fitness_league/features/home/presentation/home_screen.dart';
import 'package:fitness_league/features/league/presentation/league_screen.dart';
import 'package:fitness_league/features/notifications/presentation/notifications_screen.dart';
import 'package:fitness_league/features/profile/presentation/profile_screen.dart';
import 'package:fitness_league/features/progress/presentation/progress_screen.dart';
import 'package:fitness_league/features/progress/presentation/records_screen.dart';
import 'package:fitness_league/features/social/presentation/friends_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// The offline demo APK (--dart-define=DEMO=true) must render every main screen from the recorded demo data.
void main() {
  final recorded = jsonDecode(File('assets/demo/api.json').readAsStringSync()) as Map<String, dynamic>;
  final bodynade = ((recorded['GET /gyms/mine'] as List).first as Map)['id'] as String;

  final screens = <String, Widget>{
    'home': const HomeScreen(),
    'gyms': const GymsScreen(),
    'gym profile': GymProfileScreen(id: bodynade),
    'league': const LeagueScreen(),
    'battles': const BattlesScreen(),
    'friends': const FriendsScreen(),
    'notifications': const NotificationsScreen(),
    'profile': const ProfileScreen(),
    'progress': const ProgressScreen(),
    'records': const RecordsScreen(),
  };
  for (final MapEntry(key: name, value: screen) in screens.entries) {
    testWidgets('$name renders from the demo data', (tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.5;
      addTearDown(tester.view.reset);
      final client = ApiClient(
        baseUrl: 'http://demo',
        tokens: MemoryTokenStorage(),
        onSessionExpired: () {},
        dio: Dio(BaseOptions(baseUrl: 'http://demo'))..httpClientAdapter = DemoBackend(recorded),
      );
      await tester.pumpWidget(ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(client)],
        child: MaterialApp(
          locale: const Locale('fr'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: screen,
        ),
      ));
      // The demo backend answers after a short real delay: let it run outside the fake clock.
      for (var i = 0; i < 6; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(tester.takeException(), isNull);
      expect(find.byType(ErrorView), findsNothing);
    });
  }
}
