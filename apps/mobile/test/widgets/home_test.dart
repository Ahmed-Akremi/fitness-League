import 'package:fitness_league/features/home/presentation/home_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> me({Map<String, dynamic>? gym}) => {
      'id': 'u1',
      'username': 'ahmed',
      'emailVerified': true,
      'profile': {
        'fullName': 'Ahmed Ben Salah',
        'governorate': {'id': 'g1', 'code': 'TN-11', 'name': {'en': 'Tunis'}},
        'gym': gym,
        'calibrationEndsAt': null,
        'onboardingCompleted': true,
      },
      'stats': {'level': 12, 'xpIntoLevel': 120, 'xpForNextLevel': 400, 'division': 'GOLD'},
      'streak': {'currentWeeks': 3},
    };

FakeBackend backend({Map<String, dynamic>? gym}) => FakeBackend()
  ..on('GET', '/me', (_) => (200, me(gym: gym)))
  ..on('GET', '/me/ranks', (_) => (200, {'national': 4, 'governorate': 2, 'gym': 1}))
  ..on('GET', '/me/lp', (_) => (200, {'lp': 1240, 'division': 'GOLD'}))
  ..on('GET', '/me/weekly-scores/current', (_) => (200, {'total': 72.4, 'trainingDays': 2, 'plannedDays': 3}))
  ..on('GET', '/goals', (_) => (200, <Object>[]))
  ..on('GET', '/notifications', (_) => (200, {'unread': 1, 'data': <Object>[], 'page': {'nextCursor': null, 'hasMore': false}}))
  ..on('GET', '/gyms/b', (_) => (200, {'id': 'b', 'name': 'Bodynade', 'logoUrl': null, 'myMembership': {'status': 'APPROVED', 'role': 'MEMBER'}}))
  ..on('GET', '/gyms/b/wods', (_) => (200, {
        'data': [
          {'id': 'w1', 'title': 'Bodynade Burner', 'scoreType': 'FOR_TIME', 'endsAt': DateTime.now().add(const Duration(days: 3)).toIso8601String(), 'isOpen': true, 'myScore': null},
        ],
        'page': {'nextCursor': null, 'hasMore': false},
      }));

void main() {
  testWidgets('hero LP, my gym with its current WOD and the notification bell', (tester) async {
    await pumpScreen(tester, const HomeScreen(), backend(gym: {'id': 'b', 'name': 'Bodynade', 'slug': 'bodynade'}));
    expect(find.text('1240'), findsOneWidget);
    expect(find.text('Bodynade'), findsOneWidget);
    expect(find.text('Bodynade Burner'), findsOneWidget);
    expect(find.descendant(of: find.byType(Badge), matching: find.text('1')), findsOneWidget);
  });

  testWidgets('in Arabic, the goal numbers stay left-to-right', (tester) async {
    final b = backend()
      ..on('GET', '/goals', (_) => (200, [
            {'id': 'g1', 'status': 'ACTIVE', 'startValue': 122.5, 'targetValue': 130, 'metric': {'code': 'E1RM', 'unit': 'kg'}, 'milestones': [1, 2, 3], 'milestonesReached': 0},
          ]));
    await pumpScreen(tester, const HomeScreen(), b, locale: const Locale('ar'));
    final goal = tester.widget<Text>(find.textContaining('→'));
    expect(goal.textDirection, TextDirection.ltr);
  });

  testWidgets('without a gym, invites to find one', (tester) async {
    await pumpScreen(tester, const HomeScreen(), backend());
    expect(find.text('Find a gym'), findsOneWidget);
  });
}
