import 'package:fitness_league/features/battles/presentation/battles_screen.dart';
import 'package:fitness_league/features/gym_wars/presentation/gym_war_screen.dart';
import 'package:fitness_league/features/gym_wars/presentation/gym_wars_section.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> gym(String id, String name, {required bool mine, num? score, String? outcome, int active = 4}) => {
      'gymId': id,
      'name': name,
      'city': {'en': 'Tunis'},
      'logoUrl': null,
      'isMine': mine,
      'eligibleMembers': 8,
      'activeMembers': active,
      'score': score,
      'breakdown': score == null ? null : {'topK': 40, 'participation': 50, 'meanProgress': 60, 'consistency': 30},
      'outcome': outcome,
      'rating': 1500,
    };

Map<String, dynamic> war(String status, {String? myOutcome}) => {
      'id': 'w1',
      'weekStart': '2026-10-26',
      'endsAt': DateTime.now().add(const Duration(days: 3)).toIso8601String(),
      'status': status,
      'bracket': 'S',
      'live': status == 'ACTIVE',
      'gyms': [
        gym('b', 'Carthage Barbell', mine: false, score: 31.5, outcome: myOutcome == null ? null : (myOutcome == 'WIN' ? 'LOSS' : 'WIN'), active: 1),
        gym('a', 'Atlas Box', mine: true, score: 58.2, outcome: myOutcome),
      ],
    };

void main() {
  testWidgets('shows both gyms, my gym first, with the live breakdown', (tester) async {
    await pumpScreen(tester, const GymWarScreen(id: 'w1'), FakeBackend()..on('GET', '/gym-wars/w1', (_) => (200, war('ACTIVE'))));
    expect(find.text('Gym War'), findsOneWidget);
    expect(find.text('58.2'), findsOneWidget);
    expect(find.text('31.5'), findsOneWidget);
    expect(find.text('4/8'), findsOneWidget);
    expect(find.text('1/8'), findsOneWidget);
    expect(tester.getTopLeft(find.text('Atlas Box')).dx, lessThan(tester.getTopLeft(find.text('Carthage Barbell')).dx));
  });

  testWidgets('shows the final result', (tester) async {
    await pumpScreen(tester, const GymWarScreen(id: 'w1'), FakeBackend()..on('GET', '/gym-wars/w1', (_) => (200, war('COMPLETED', myOutcome: 'WIN'))));
    expect(find.text('Your gym won!'), findsOneWidget);
  });

  testWidgets("the battles hub links to my gym's war of the week", (tester) async {
    final b = FakeBackend()
      ..on('GET', '/gym-wars/current', (_) => (200, {'gymId': 'a', 'war': war('ACTIVE')}))
      ..on('GET', '/battles', (_) => (200, {'data': <Object>[], 'nextCursor': null}));
    await pumpScreen(tester, const BattlesScreen(), b);
    expect(find.text("This week's Gym War"), findsOneWidget);
    expect(find.text('Atlas Box 58.2 – 31.5 Carthage Barbell'), findsOneWidget);
  });

  testWidgets('gym admins can opt their gym out; the record and past wars are listed', (tester) async {
    var enrolled = true;
    final b = FakeBackend()
      ..on('GET', '/gyms/a/wars', (_) => (200, {
            'enrolled': enrolled,
            'rating': 1532,
            'record': {'wins': 1, 'losses': 0, 'draws': 0},
            'data': [
              {'id': 'w1', 'weekStart': '2026-10-26', 'status': 'COMPLETED', 'opponent': {'gymId': 'b', 'name': 'Carthage Barbell'}, 'score': 58.2, 'opponentScore': 31.5, 'outcome': 'WIN'},
            ],
          }))
      ..on('POST', '/gyms/a/wars/registration', (r) {
        enrolled = (r.data as Map)['enrolled'] as bool;
        return (200, {'enrolled': enrolled});
      });
    await pumpScreen(tester, const Scaffold(body: SingleChildScrollView(child: GymWarsSection(gymId: 'a', canManage: true))), b);
    expect(find.text('1W · 0L · 0D'), findsOneWidget);
    expect(find.text('Rating 1532'), findsOneWidget);
    expect(find.text('vs Carthage Barbell'), findsOneWidget);
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/gyms/a/wars/registration').single.data, {'enrolled': false});
    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
  });
}
