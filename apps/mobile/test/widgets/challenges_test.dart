import 'package:fitness_league/features/challenges/presentation/challenge_screen.dart';
import 'package:fitness_league/features/challenges/presentation/challenges_screen.dart';
import 'package:fitness_league/features/challenges/presentation/new_challenge_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> challenge({bool joined = false, num? progress, String scope = 'COMMUNITY', String createdById = 'staff'}) => {
      'id': 'c1',
      'scope': scope,
      'title': 'November grind',
      'metric': 'WORKOUTS',
      'target': 12,
      'startsAt': '2026-11-01T00:00:00Z',
      'endsAt': DateTime.now().add(const Duration(days: 10)).toIso8601String(),
      'status': 'ACTIVE',
      'xpReward': scope == 'COMMUNITY' ? 250 : 0,
      'gym': null,
      'createdById': createdById,
      'participants': joined ? 2 : 1,
      'joined': joined,
      'myProgress': progress,
      'completedAt': null,
      'description': 'Twelve sessions this month.',
      'leaderboard': [
        {'rank': 1, 'userId': 'u2', 'username': 'yassine', 'fullName': 'Yassine T.', 'progress': 7, 'completed': false},
        if (joined) {'rank': 2, 'userId': 'u1', 'username': 'ahmed', 'fullName': 'Ahmed', 'progress': progress ?? 0, 'completed': false},
      ],
    };

FakeBackend withMe(FakeBackend b) => b..on('GET', '/me', (_) => (200, {'id': 'u1', 'username': 'ahmed'}));

void main() {
  testWidgets('lists challenges with my progress', (tester) async {
    await pumpScreen(tester, const ChallengesTabScreen(), withMe(FakeBackend()..on('GET', '/challenges', (_) => (200, [challenge(joined: true, progress: 3)]))));
    expect(find.text('November grind'), findsOneWidget);
    expect(find.text('3 / 12'), findsOneWidget);
    expect(find.textContaining('Community · 12 workouts · 2 participants'), findsOneWidget);
  });

  testWidgets('joins a community challenge and sees the leaderboard', (tester) async {
    var joined = false;
    final b = withMe(FakeBackend()
      ..on('GET', '/challenges/c1', (_) => (200, challenge(joined: joined, progress: joined ? 3 : null)))
      ..on('POST', '/challenges/c1/join', (_) {
        joined = true;
        return (200, challenge(joined: true, progress: 3));
      }));
    await pumpScreen(tester, const ChallengeScreen(id: 'c1'), b);
    expect(find.text('Goal: 12 workouts'), findsOneWidget);
    expect(find.text('+250 XP when completed'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Join the challenge'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/challenges/c1/join'), hasLength(1));
    expect(find.text('3 / 12'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, 'Leave the challenge'), findsOneWidget);
    expect(find.text('Yassine T.'), findsOneWidget);
  });

  testWidgets('creates a friends challenge', (tester) async {
    final b = withMe(FakeBackend()..on('POST', '/challenges', (_) => (201, challenge(scope: 'FRIEND', createdById: 'u1', joined: true, progress: 0))));
    await pumpScreen(tester, const NewChallengeScreen(), b);
    await tester.enterText(find.widgetWithText(TextField, 'Title'), 'Run club');
    await tester.tap(find.text('km'));
    await tester.enterText(find.widgetWithText(TextField, 'Target'), '42.2');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Create the challenge'));
    await tester.pumpAndSettle();
    final sent = b.calls('POST', '/challenges').single.data as Map;
    expect(sent, containsPair('scope', 'FRIEND'));
    expect(sent, containsPair('metric', 'DISTANCE_KM'));
    expect(sent, containsPair('targetValue', 42.2));
    expect(sent, containsPair('title', 'Run club'));
    final days = DateTime.parse(sent['endsAt'] as String).difference(DateTime.parse(sent['startsAt'] as String)).inDays;
    expect(days, 30);
  });
}
