import 'package:fitness_league/features/battles/presentation/battle_screen.dart';
import 'package:fitness_league/features/battles/presentation/new_battle_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> battle(String status, {num? myScore, num? theirScore, String? myOutcome}) => {
      'id': 'bt1',
      'type': 'FRIEND',
      'status': status,
      'createdById': 'u1',
      'durationDays': 7,
      'components': ['progress', 'consistency', 'performance'],
      'result': null,
      'startsAt': status == 'PENDING' ? null : '2026-09-24T00:00:00Z',
      'endsAt': status == 'PENDING' ? null : DateTime.now().add(const Duration(days: 4)).toIso8601String(),
      'participants': [
        {'userId': 'u1', 'username': 'ahmed', 'fullName': 'Ahmed', 'accepted': true, 'score': myScore, 'breakdown': null, 'outcome': myOutcome},
        {'userId': 'u2', 'username': 'yassine', 'fullName': 'Yassine', 'accepted': status != 'PENDING', 'score': theirScore, 'breakdown': null, 'outcome': null},
      ],
    };

void main() {
  testWidgets('shows both live scores of an active battle', (tester) async {
    await pumpScreen(tester, const BattleScreen(id: 'bt1', myId: 'u1'), FakeBackend()..on('GET', '/battles/bt1', (_) => (200, battle('ACTIVE', myScore: 71.4, theirScore: 64.2))));
    expect(find.text('71.4'), findsOneWidget);
    expect(find.text('64.2'), findsOneWidget);
    expect(find.text('Yassine'), findsOneWidget);
  });

  testWidgets('the invited friend can accept', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/battles/bt1', (_) => (200, battle('PENDING')))
      ..on('POST', '/battles/bt1/accept', (_) => (200, battle('ACTIVE')));
    await pumpScreen(tester, const BattleScreen(id: 'bt1', myId: 'u2'), b);
    await tester.tap(find.widgetWithText(FilledButton, 'Accept'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/battles/bt1/accept'), hasLength(1));
  });

  testWidgets('shows the final result', (tester) async {
    await pumpScreen(tester, const BattleScreen(id: 'bt1', myId: 'u1'), FakeBackend()..on('GET', '/battles/bt1', (_) => (200, battle('COMPLETED', myScore: 80, theirScore: 60, myOutcome: 'WIN'))));
    expect(find.text('You won!'), findsOneWidget);
  });

  testWidgets('creates a battle against a friend with a duration', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/friends', (_) => (200, [
            {'id': 'u2', 'username': 'yassine', 'fullName': 'Yassine', 'governorate': 'TN-51', 'level': 9},
          ]))
      ..on('POST', '/battles', (_) => (201, battle('PENDING')));
    await pumpScreen(tester, const NewBattleScreen(), b);
    await tester.tap(find.text('Yassine'));
    await tester.pump();
    await tester.tap(find.text('14 days'));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Send challenge'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/battles').single.data, {'opponentId': 'u2', 'durationDays': 14});
  });
}
