import 'package:fitness_league/features/onboarding/presentation/onboarding_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

void main() {
  testWidgets('onboarding: sports → weekly plan → declared level → calibration starts', (tester) async {
    final backend = FakeBackend()
      ..on('GET', '/ref/sports', (_) => (200, sports))
      ..on('GET', '/ref/exercises', (_) => (200, [squat]))
      ..on('POST', '/me/onboarding/sports', (_) => (200, {}))
      ..on('PATCH', '/me/profile', (_) => (200, {}))
      ..on('POST', '/me/onboarding/baselines', (_) => (200, {}))
      ..on('POST', '/me/onboarding/complete', (_) => (200, {'completed': true}))
      ..on('GET', '/me', (_) => (200, {}));
    await pumpScreen(tester, const OnboardingScreen(), backend);

    expect(find.text('What do you train?'), findsOneWidget);
    await tester.tap(find.byKey(const Key('sport-BODYBUILDING')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('onboarding-next')));
    await tester.pumpAndSettle();

    expect(find.text('How many days a week do you plan to train?'), findsOneWidget);
    await tester.tap(find.byKey(const Key('onboarding-next')));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('baseline-BACK_SQUAT')), '80');
    await tester.tap(find.byKey(const Key('onboarding-finish')));
    await tester.pumpAndSettle();

    expect(backend.calls('POST', '/me/onboarding/sports').single.data, {'sportIds': ['sp-bb'], 'primarySportId': 'sp-bb'});
    expect(backend.calls('PATCH', '/me/profile').single.data, {'plannedTrainingDaysPerWeek': 3});
    expect(backend.calls('POST', '/me/onboarding/baselines').single.data, {
      'entries': [
        {'exerciseId': 'ex-squat', 'metricCode': 'E1RM', 'value': 80.0},
      ],
    });
    expect(backend.calls('POST', '/me/onboarding/complete'), hasLength(1));
  });
}
