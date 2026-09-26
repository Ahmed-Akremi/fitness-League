import 'package:fitness_league/features/league/data/league_repository.dart';
import 'package:fitness_league/features/league/presentation/league_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> row(int rank, String id, String name, int lp, Object? movement) => {
      'rank': rank,
      'athlete': {'id': id, 'username': id, 'fullName': name},
      'gym': null,
      'governorate': {'id': 'g', 'code': 'TN-51', 'name': {'fr': 'Sousse', 'en': 'Sousse', 'ar': 'سوسة'}},
      'lp': lp,
      'level': 7,
      'division': 'BRONZE',
      'movement': movement,
    };

void main() {
  FakeBackend board() {
    return FakeBackend()
      ..on('GET', '/leaderboards/national', (req) {
        return req.queryParameters['cursor'] == null
            ? (200, {'data': [row(1, 'u1', 'Sami', 88, 3), row(2, 'u2', 'Karim', 66, -1)], 'page': {'nextCursor': 'c2', 'hasMore': true}})
            : (200, {'data': [row(3, 'u3', 'Nour', 40, 'NEW')], 'page': {'nextCursor': null, 'hasMore': false}});
      })
      ..on('GET', '/leaderboards/national/me', (_) => (200, {'data': [row(2, 'u2', 'Karim', 66, -1)], 'page': {'nextCursor': null, 'hasMore': false}}));
  }

  testWidgets('renders ranks, LP and movement, and pages with the cursor', (tester) async {
    final backend = board();
    await pumpScreen(tester, const Scaffold(body: LeaderboardList(scope: LeagueScope.national, myId: 'u2')), backend);
    expect(find.text('#1'), findsOneWidget);
    expect(find.text('88 LP'), findsOneWidget);
    expect(find.text('↑3'), findsOneWidget);
    expect(find.text('↓1'), findsOneWidget);

    await tester.drag(find.byType(ListView), const Offset(0, -600));
    await tester.pumpAndSettle();
    expect(find.text('NEW'), findsOneWidget);
    expect(backend.calls('GET', '/leaderboards/national').last.queryParameters['cursor'], 'c2');

    await tester.tap(find.byTooltip('Jump to my rank'));
    await tester.pumpAndSettle();
    expect(find.text('Karim'), findsOneWidget);
    expect(find.text('Sami'), findsNothing);
  });

  testWidgets('lays out right-to-left in Arabic', (tester) async {
    await pumpScreen(tester, const Scaffold(body: LeaderboardList(scope: LeagueScope.national)), board(), locale: const Locale('ar'));
    expect(Directionality.of(tester.element(find.text('Sami'))), TextDirection.rtl);
    expect(find.textContaining('سوسة'), findsWidgets);
  });
}
