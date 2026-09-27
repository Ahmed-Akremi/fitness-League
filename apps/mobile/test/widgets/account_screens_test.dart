import 'package:fitness_league/features/auth/presentation/forgot_password_screen.dart';
import 'package:fitness_league/features/progress/presentation/body_screen.dart';
import 'package:fitness_league/features/progress/presentation/records_screen.dart';
import 'package:fitness_league/features/settings/presentation/settings_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> record(String code, String name, String metric, String unit, num value, {String? previous}) => {
      'id': 'r-$code',
      'exercise': {'id': 'e-$code', 'code': code, 'name': {'en': name}},
      'metric': {'code': metric, 'unit': unit},
      'value': value,
      'previousValue': previous == null ? null : num.parse(previous),
      'status': 'AWARDED',
      'achievedAt': '2026-09-25T10:00:00Z',
      'workoutId': 'w1',
    };

void main() {
  testWidgets('records show times as m:ss / h:mm:ss and loads in kg', (tester) async {
    await pumpScreen(tester, const RecordsScreen(), FakeBackend()
      ..on('GET', '/me/records', (_) => (200, [
            record('WOD_FRAN', 'Fran', 'FINISH_TIME', 's', 298, previous: '331'),
            record('HYROX_OPEN', 'Hyrox race (Open)', 'FINISH_TIME', 's', 5280),
            record('BACK_SQUAT', 'Back squat', 'E1RM', 'kg', 112.5),
          ])));
    expect(find.text('4:58'), findsOneWidget);
    expect(find.text('1:28:00'), findsOneWidget);
    expect(find.text('112.5 kg'), findsOneWidget);
  });

  testWidgets('forgot password always confirms (no account enumeration)', (tester) async {
    final b = FakeBackend()..on('POST', '/auth/password/forgot', (_) => (404, {'code': 'NOT_FOUND'}));
    await pumpScreen(tester, const ForgotPasswordScreen(), b);
    await tester.enterText(find.byType(TextField), 'someone@example.test');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Send link'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/auth/password/forgot'), hasLength(1));
    expect(find.textContaining('If an account exists'), findsOneWidget);
  });

  testWidgets('body screen adds a weigh-in', (tester) async {
    final rows = <Map<String, dynamic>>[
      {'id': 'm1', 'measuredAt': '2026-09-20T07:00:00Z', 'weightKg': 82.4, 'bodyFatPct': null, 'source': 'MANUAL'},
    ];
    final b = FakeBackend()
      ..on('GET', '/me/body-measurements', (_) => (200, rows))
      ..on('POST', '/me/body-measurements', (req) {
        rows.insert(0, {'id': 'm2', 'measuredAt': '2026-09-27T07:00:00Z', 'weightKg': (req.data as Map)['weightKg'], 'bodyFatPct': null, 'source': 'MANUAL'});
        return (201, rows.first);
      });
    await pumpScreen(tester, const BodyScreen(), b);
    expect(find.text('82.4 kg'), findsWidgets);
    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('weight-input')), '81,9');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();
    expect((b.calls('POST', '/me/body-measurements').single.data as Map)['weightKg'], 81.9);
    expect(find.text('81.9 kg'), findsWidgets);
  });

  testWidgets('settings toggles privacy options through PATCH /me/settings', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/me', (_) => (200, {
            'id': 'u1', 'username': 'ahmed', 'emailVerified': true,
            'profile': {'fullName': 'Ahmed', 'plannedTrainingDaysPerWeek': 3},
            'settings': {'locale': 'en', 'defaultVisibility': 'FRIENDS', 'showAgeBracket': false, 'showOnLeaderboards': true},
            'stats': {'level': 3},
          }))
      ..on('PATCH', '/me/settings', (req) => (200, req.data));
    await pumpScreen(tester, const SettingsScreen(), b);
    await tester.tap(find.text('Show my age bracket'));
    await tester.pumpAndSettle();
    expect(b.calls('PATCH', '/me/settings').last.data, {'showAgeBracket': true});
  });
}
