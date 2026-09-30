import 'package:fitness_league/features/workouts/presentation/proofs_section.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

void main() {
  testWidgets('explains proofs when there are none', (tester) async {
    await pumpScreen(tester, const Scaffold(body: ProofsSection(workoutId: 'w1')), FakeBackend()..on('GET', '/workouts/w1/proofs', (_) => (200, {'workoutId': 'w1', 'status': 'NONE', 'note': null, 'reviewedAt': null, 'proofs': <Object>[]})));
    expect(find.text('None'), findsOneWidget);
    expect(find.text('Add a proof'), findsOneWidget);
  });

  testWidgets('shows the rejection note and hides removal once verified', (tester) async {
    await pumpScreen(tester, const Scaffold(body: ProofsSection(workoutId: 'w1')), FakeBackend()..on('GET', '/workouts/w1/proofs', (_) => (200, {'workoutId': 'w1', 'status': 'REJECTED', 'note': 'Blurry photo', 'reviewedAt': null, 'proofs': <Object>[]})));
    expect(find.text('Rejected'), findsOneWidget);
    expect(find.text('Blurry photo'), findsOneWidget);

  });

  testWidgets('a verified workout takes no more proofs', (tester) async {
    await pumpScreen(tester, const Scaffold(body: ProofsSection(workoutId: 'w1')), FakeBackend()..on('GET', '/workouts/w1/proofs', (_) => (200, {'workoutId': 'w1', 'status': 'VERIFIED', 'note': null, 'reviewedAt': '2026-09-30T10:00:00Z', 'proofs': <Object>[]})));
    expect(find.text('Verified'), findsOneWidget);
    expect(find.text('Add a proof'), findsNothing);
  });
}
