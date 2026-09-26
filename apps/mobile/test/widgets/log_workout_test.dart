import 'package:fitness_league/core/offline/outbox.dart';
import 'package:fitness_league/core/providers.dart';
import 'package:fitness_league/features/workouts/presentation/log_workout_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Future<void> fillWorkout(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('log-sport')));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Bodybuilding').last);
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('log-add-exercise')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('pick-BACK_SQUAT')));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const Key('set-0-reps')), '5');
  await tester.enterText(find.byKey(const Key('set-0-weight')), '100');
}

Future<void> save(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const Key('log-save')));
  await tester.tap(find.byKey(const Key('log-save')));
  await tester.pumpAndSettle();
}

void main() {
  FakeBackend backendWithCatalog() => FakeBackend()
    ..on('GET', '/ref/sports', (_) => (200, sports))
    ..on('GET', '/ref/exercises', (_) => (200, [squat]))
    ..on('GET', '/me', (_) => (200, {}))
    ..on('GET', '/workouts', (_) => (200, {'data': [], 'page': {'nextCursor': null, 'hasMore': false}}));

  testWidgets('logs raw sets only (never points) with an idempotency key', (tester) async {
    final backend = backendWithCatalog()..on('POST', '/workouts', (_) => (201, {'id': 'w1', 'status': 'ACCEPTED', 'version': 1}));
    await pumpScreen(tester, const LogWorkoutScreen(), backend);
    await fillWorkout(tester);
    await save(tester);

    final req = backend.calls('POST', '/workouts').single;
    final body = req.data as Map<String, dynamic>;
    expect(req.headers['Idempotency-Key'], body['clientId']);
    expect(body['exercises'], [
      {
        'exerciseId': 'ex-squat',
        'sets': [
          {'reps': 5, 'weightKg': 100.0},
        ],
      },
    ]);
    expect(body.keys.any((k) => k.toLowerCase().contains('xp') || k.toLowerCase().contains('point')), isFalse);
  });

  testWidgets('queues the workout offline and tells the user', (tester) async {
    final backend = backendWithCatalog();
    final store = MemoryOutboxStore();
    await pumpScreen(tester, const LogWorkoutScreen(), backend, overrides: [outboxStoreProvider.overrideWithValue(store)]);
    await fillWorkout(tester);
    backend.offline = true; // the connection drops just as the athlete taps save
    await save(tester);
    expect(find.text('Saved offline. It will sync automatically.'), findsOneWidget);
    expect((await store.all()).single.status, OutboxStatus.pending);
  });

  testWidgets('shows the anti-cheat refusal', (tester) async {
    final backend = backendWithCatalog()..on('POST', '/workouts', (_) => (422, {'code': 'WORKOUT_REJECTED'}));
    await pumpScreen(tester, const LogWorkoutScreen(), backend);
    await fillWorkout(tester);
    await save(tester);
    expect(find.text('This workout exceeds physiological limits or duplicates another one.'), findsOneWidget);
  });
}
