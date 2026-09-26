import 'package:fitness_league/core/l10n/l10n.dart';
import 'package:fitness_league/core/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';

/// Pumps a screen with a fake backend, translations and an optional locale (ar → RTL).
Future<ProviderContainer> pumpScreen(WidgetTester tester, Widget screen, FakeBackend backend, {Locale locale = const Locale('en'), List<Override> overrides = const []}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.5;
  addTearDown(tester.view.reset);
  final container = ProviderContainer(overrides: [apiClientProvider.overrideWithValue(fakeClient(backend)), ...overrides]);
  addTearDown(container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: MaterialApp(
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      home: screen,
    ),
  ));
  await tester.pumpAndSettle();
  return container;
}

const sports = [
  {'id': 'sp-bb', 'code': 'BODYBUILDING', 'category': 'STRENGTH', 'loggingMode': 'SETS_REPS_WEIGHT', 'icon': 'dumbbell', 'name': {'fr': 'Musculation', 'en': 'Bodybuilding', 'ar': 'كمال الأجسام'}},
  {'id': 'sp-run', 'code': 'RUNNING', 'category': 'CARDIO', 'loggingMode': 'DISTANCE_TIME', 'icon': 'run', 'name': {'fr': 'Course à pied', 'en': 'Running', 'ar': 'الجري'}},
];

const squat = {'id': 'ex-squat', 'code': 'BACK_SQUAT', 'sportId': null, 'isBodyweight': false, 'trackedMetrics': ['MAX_WEIGHT', 'E1RM', 'REPS_AT_WEIGHT'], 'name': {'fr': 'Squat', 'en': 'Back squat', 'ar': 'سكوات'}};
