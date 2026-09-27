import 'package:fitness_league/features/workouts/presentation/log_workout_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

const crossfit = {'id': 'sp-cf', 'code': 'CROSSFIT', 'category': 'FUNCTIONAL', 'loggingMode': 'MIXED', 'icon': 'kettlebell', 'name': {'en': 'CrossFit', 'fr': 'CrossFit', 'ar': 'كروسفيت'}};
const hyrox = {'id': 'sp-hx', 'code': 'HYROX', 'category': 'FUNCTIONAL', 'loggingMode': 'MIXED', 'icon': 'hyrox', 'name': {'en': 'Hyrox', 'fr': 'Hyrox', 'ar': 'هايروكس'}};
Map<String, dynamic> ex(String id, String code, String group, List<String> metrics) =>
    {'id': id, 'code': code, 'sportId': 'x', 'isBodyweight': false, 'trackedMetrics': metrics, 'group': group, 'description': {'en': '$code description'}, 'name': {'en': code, 'fr': code, 'ar': code}};

void main() {
  FakeBackend backend() => FakeBackend()
    ..on('GET', '/ref/sports', (_) => (200, [crossfit, hyrox]))
    ..on('GET', '/ref/exercises', (req) => (200, req.queryParameters['sportId'] == 'sp-cf'
        ? [ex('e1', 'THRUSTER', 'MOVEMENT', ['MAX_WEIGHT']), ex('e2', 'WOD_FRAN', 'BENCHMARK_WOD', ['FINISH_TIME'])]
        : [
            ex('h0', 'HYROX_OPEN', 'HYROX_RACE', ['FINISH_TIME']),
            ex('r1', 'HYROX_RUN_1K', 'HYROX_STATION', ['FINISH_TIME']),
            for (var i = 1; i <= 8; i++) ex('h$i', 'STATION_$i', 'HYROX_STATION', ['FINISH_TIME']),
          ]))
    ..on('POST', '/workouts', (req) => (201, {'workout': {'id': 'w1', 'status': 'ACCEPTED'}}));

  Future<void> pickSport(WidgetTester tester, String name) async {
    await tester.tap(find.byKey(const Key('log-sport')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(name).last);
    await tester.pumpAndSettle();
  }

  testWidgets('groups exercises and logs a benchmark WOD as a time', (tester) async {
    final b = backend();
    await pumpScreen(tester, const LogWorkoutScreen(), b);
    await pickSport(tester, 'CrossFit');
    await tester.tap(find.byKey(const Key('log-add-exercise')));
    await tester.pumpAndSettle();
    expect(find.text('BENCHMARK WODS'), findsOneWidget);
    expect(find.text('MOVEMENTS'), findsOneWidget);
    expect(find.text('WOD_FRAN description'), findsOneWidget);
    await tester.tap(find.byKey(const Key('pick-WOD_FRAN')));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.byKey(const Key('log-save'))).onPressed, isNull); // no time yet
    await tester.enterText(find.byKey(const Key('time-0')), '4:58');
    await tester.enterText(find.byKey(const Key('log-duration')), '20');
    await tester.pump();
    await tester.tap(find.byKey(const Key('log-save')));
    await tester.pumpAndSettle();
    final body = b.calls('POST', '/workouts').single.data as Map;
    expect(body['workoutType'], 'WOD');
    expect(((body['exercises'] as List).single as Map)['sets'], [
      {'durationS': 298},
    ]);
  });

  testWidgets('the Hyrox race assistant fills the 8 stations and the total', (tester) async {
    final b = backend();
    await pumpScreen(tester, const LogWorkoutScreen(), b);
    await pickSport(tester, 'Hyrox');
    await tester.tap(find.byKey(const Key('hyrox-race')));
    await tester.pumpAndSettle();
    for (var i = 1; i <= 8; i++) {
      await tester.enterText(find.byKey(Key('station-$i')), '5:00');
    }
    await tester.pump();
    expect(find.text('40:00'), findsOneWidget); // computed total, still editable
    await tester.enterText(find.byKey(const Key('hyrox-total')), '1:18:30');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Add to workout'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.byKey(const Key('log-save')), 400, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const Key('log-save')));
    await tester.pumpAndSettle();
    final body = b.calls('POST', '/workouts').single.data as Map;
    final exercises = body['exercises'] as List;
    expect(body['workoutType'], 'RACE');
    expect((exercises.first as Map)['exerciseId'], 'h0');
    expect((exercises.first as Map)['sets'], [
      {'durationS': 4710},
    ]);
    expect(exercises, hasLength(9));
    expect(body['durationS'], greaterThanOrEqualTo(4710));
  });
}
