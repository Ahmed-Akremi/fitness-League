import 'dart:async';

import 'package:fitness_league/core/network/realtime.dart';
import 'package:fitness_league/core/providers.dart';
import 'package:fitness_league/features/battles/presentation/battle_screen.dart';
import 'package:fitness_league/features/battles/presentation/battles_screen.dart';
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

  group('weekly duel', () {
    Map<String, dynamic> queue({bool open = true, String? entry, Map<String, dynamic>? duel}) => {
          'queueOpen': open,
          'entry': entry == null ? null : {'status': entry, 'joinedAt': '2026-09-25T10:00:00Z', 'battleId': null},
          'rating': {'rating': 1500, 'rd': 350, 'games': 0},
          'currentDuel': duel,
        };
    FakeBackend backend(Map<String, dynamic> status) => FakeBackend()
      ..on('GET', '/duels/queue', (_) => (200, status))
      ..on('GET', '/battles', (_) => (200, {'data': <Object>[], 'nextCursor': null}));

    testWidgets('joins the open queue', (tester) async {
      final b = backend(queue())..on('POST', '/duels/queue', (_) => (201, queue(entry: 'WAITING')));
      await pumpScreen(tester, const BattlesScreen(), b);
      expect(find.text('MMR 1500 · no duels yet'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Join this week'));
      await tester.pumpAndSettle();
      expect(b.calls('POST', '/duels/queue'), hasLength(1));
      expect(find.text("You're in: your opponent is found on Sunday"), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Leave the queue'), findsOneWidget);
    });

    testWidgets('says when the queue is closed', (tester) async {
      await pumpScreen(tester, const BattlesScreen(), backend(queue(open: false)));
      expect(find.text('Sign-ups open on Friday'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Join this week'), findsNothing);
    });

    testWidgets('explains why joining is refused', (tester) async {
      final b = backend(queue())
        ..on('POST', '/duels/queue', (_) => (422, {
              'code': 'VALIDATION_FAILED',
              'errors': [
                {'field': 'user', 'code': 'CALIBRATION'},
              ],
            }));
      await pumpScreen(tester, const BattlesScreen(), b);
      await tester.tap(find.widgetWithText(FilledButton, 'Join this week'));
      await tester.pumpAndSettle();
      expect(find.text('Finish your calibration before joining a duel'), findsOneWidget);
    });

    testWidgets('a ghost duel is against my own last week', (tester) async {
      final ghost = battle('ACTIVE', myScore: 55)
        ..['type'] = 'DUEL'
        ..['isGhost'] = true
        ..['ghostTarget'] = 48.5
        ..['participants'] = [battle('ACTIVE', myScore: 55)['participants'][0]];
      await pumpScreen(tester, const BattleScreen(id: 'bt1', myId: 'u1'), FakeBackend()..on('GET', '/battles/bt1', (_) => (200, ghost)));
      expect(find.text('Weekly Duel'), findsOneWidget);
      expect(find.text('You, last week'), findsOneWidget);
      expect(find.text('48.5'), findsOneWidget);
    });
  });

  testWidgets('a live battle.score event reloads the scores', (tester) async {
    final live = _FakeRealtime();
    var score = 50.0;
    final b = FakeBackend()..on('GET', '/battles/bt1', (_) => (200, battle('ACTIVE', myScore: score, theirScore: 40)));
    await pumpScreen(tester, const BattleScreen(id: 'bt1', myId: 'u1'), b, overrides: [realtimeProvider.overrideWithValue(live)]);
    expect(live.subscribed, {'bt1'});
    expect(find.text('50.0'), findsOneWidget);
    score = 62.5;
    live.scores.add('bt1');
    await tester.pumpAndSettle();
    expect(find.text('62.5'), findsOneWidget);
  });
}

class _FakeRealtime extends NoopRealtime {
  final scores = StreamController<String>.broadcast();
  final subscribed = <String>{};

  @override
  Stream<String> get battleScores => scores.stream;
  @override
  void subscribeBattle(String battleId) => subscribed.add(battleId);
  @override
  void unsubscribeBattle(String battleId) => subscribed.remove(battleId);
}
