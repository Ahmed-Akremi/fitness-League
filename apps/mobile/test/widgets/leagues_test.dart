import 'package:fitness_league/features/leagues/presentation/league_detail_screen.dart';
import 'package:fitness_league/features/leagues/presentation/leagues_tab.dart';
import 'package:fitness_league/features/leagues/presentation/new_league_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> league({String visibility = 'PRIVATE', String? role = 'OWNER', bool member = true}) => {
      'id': 'lg1',
      'name': 'Lac 2 lifters',
      'slug': 'lac-2-lifters-abcd',
      'visibility': visibility,
      'scoringPreset': 'CONSISTENCY',
      'startsAt': '2027-01-03T23:00:00Z',
      'endsAt': '2027-02-28T23:00:00Z',
      'status': 'ACTIVE',
      'members': 3,
      'maxMembers': 10,
      'ownerId': 'u1',
      'isMember': member,
      'myRole': role,
      'inviteCode': member ? 'K7MX2PQA' : null,
    };

void main() {
  testWidgets('lists my leagues and joins one with an invite code', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/leagues', (_) => (200, {'mine': [league()], 'public': <Object>[]}))
      ..on('POST', '/leagues/join-by-code', (_) => (200, league(role: 'MEMBER')));
    await pumpScreen(tester, const LeaguesTab(), b);
    expect(find.text('Lac 2 lifters'), findsOneWidget);
    expect(find.text('Consistency · 3/10 members'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'k7mx2pqa');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Join'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/leagues/join-by-code').single.data, {'code': 'k7mx2pqa'});
  });

  testWidgets('shows the invite code and the ranking', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/leagues/lg1', (_) => (200, league()))
      ..on('GET', '/leagues/lg1/leaderboard', (_) => (200, {
            'league': {'id': 'lg1', 'name': 'Lac 2 lifters', 'scoringPreset': 'CONSISTENCY'},
            'data': [
              {'rank': 1, 'userId': 'u2', 'username': 'nour', 'fullName': 'Nour', 'points': 180, 'weeks': 2, 'isMe': false},
              {'rank': 2, 'userId': 'u1', 'username': 'ahmed', 'fullName': 'Ahmed', 'points': 40.5, 'weeks': 1, 'isMe': true},
            ],
          }));
    await pumpScreen(tester, const LeagueDetailScreen(id: 'lg1'), b);
    expect(find.text('K7MX2PQA'), findsOneWidget);
    expect(find.text('Nour'), findsOneWidget);
    expect(find.text('180'), findsOneWidget);
    expect(find.text('40.5'), findsOneWidget);
    expect(find.text('2 weeks'), findsOneWidget);
  });

  testWidgets('creates a private league ranked on progress', (tester) async {
    final b = FakeBackend()..on('POST', '/leagues', (_) => (201, league()));
    await pumpScreen(tester, const NewLeagueScreen(), b);
    await tester.enterText(find.byType(TextField), 'Lac 2 lifters');
    await tester.tap(find.text('Progress'));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Create the league'));
    await tester.pumpAndSettle();
    final sent = b.calls('POST', '/leagues').single.data as Map;
    expect(sent, containsPair('name', 'Lac 2 lifters'));
    expect(sent, containsPair('visibility', 'PRIVATE'));
    expect(sent, containsPair('scoringPreset', 'PROGRESS'));
  });
}
