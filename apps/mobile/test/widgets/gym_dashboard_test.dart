import 'package:fitness_league/features/gyms/presentation/gym_dashboard_screen.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

void main() {
  testWidgets('shows members, trend and who to nudge', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/gyms/g1/dashboard', (_) => (200, {
            'gym': {'id': 'g1', 'name': 'Bodynade', 'rating': 1520},
            'members': {'approved': 24, 'pending': 3, 'activeLast7Days': 15, 'activeLast28Days': 20},
            'trend': [
              for (var i = 0; i < 8; i++) {'weekStart': '2026-08-0$i', 'activeMembers': 10 + i, 'meanScore': 55.0},
            ],
            'topProgress': [
              {'userId': 'u1', 'name': 'Nour', 'progress': 88.0, 'total': 76.0},
            ],
            'toNudge': [
              {'userId': 'u2', 'name': 'Karim', 'lastWorkoutAt': null},
            ],
            'wods': [
              {'id': 'w1', 'title': 'Fran Friday', 'scores': 12},
            ],
            'wars': {'wins': 3, 'losses': 1, 'draws': 0, 'enrolled': true},
          }));
    await pumpScreen(tester, const GymDashboardScreen(id: 'g1'), b);
    expect(find.text('24'), findsOneWidget);
    expect(find.text('15'), findsWidgets);
    expect(find.text('Nour'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Karim'), 200);
    expect(find.text('No workout yet'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('3W · 1L · 0D'), 200);
    expect(find.text('12 scores'), findsOneWidget);
  });
}
