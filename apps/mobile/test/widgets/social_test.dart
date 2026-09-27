import 'package:fitness_league/features/social/presentation/friends_screen.dart';
import 'package:fitness_league/features/social/presentation/public_profile_screen.dart';
import 'package:fitness_league/features/social/presentation/search_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> athlete(String id, String name) => {'id': id, 'username': id, 'fullName': name, 'governorate': 'TN-51', 'level': 7};

void main() {
  testWidgets('lists friends and accepts an incoming request', (tester) async {
    var incoming = [athlete('sami', 'Sami J.')];
    final b = FakeBackend()
      ..on('GET', '/friends', (_) => (200, [athlete('yassine', 'Yassine T.')]))
      ..on('GET', '/friends/requests', (req) => (200, req.queryParameters['direction'] == 'out' ? <Object>[] : incoming))
      ..on('POST', '/friends/requests/sami/accept', (_) {
        incoming = [];
        return (200, {'status': 'ACCEPTED'});
      });
    await pumpScreen(tester, const FriendsScreen(), b);
    expect(find.text('Yassine T.'), findsOneWidget);
    await tester.tap(find.text('Requests'));
    await tester.pumpAndSettle();
    expect(find.text('Sami J.'), findsOneWidget);
    await tester.tap(find.byTooltip('Accept'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/friends/requests/sami/accept'), hasLength(1));
    expect(find.text('Sami J.'), findsNothing);
  });

  testWidgets('public profile shows division and sends a friend request', (tester) async {
    String? friendship;
    final b = FakeBackend()
      ..on('GET', '/users/nour', (_) => (200, {
            'id': 'nour', 'username': 'nour', 'fullName': 'Nour H.', 'bio': null, 'ageBracket': null,
            'governorate': {'code': 'TN-11', 'name': {'en': 'Tunis'}}, 'gym': {'id': 'b', 'name': 'Bodynade'},
            'level': 8, 'division': 'SILVER', 'seasonLp': 960, 'followers': 3, 'following': 2, 'friendship': friendship,
          }))
      ..on('POST', '/friends/requests', (_) {
        friendship = 'REQUEST_SENT';
        return (201, {'status': 'PENDING'});
      });
    await pumpScreen(tester, const PublicProfileScreen(username: 'nour'), b);
    expect(find.text('Nour H.'), findsOneWidget);
    expect(find.text('960'), findsOneWidget);
    expect(find.text('Bodynade'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Add friend'));
    await tester.pumpAndSettle();
    expect((b.calls('POST', '/friends/requests').single.data as Map)['userId'], 'nour');
    expect(find.text('Request sent'), findsOneWidget);
  });

  testWidgets('search waits for 2 characters then lists athletes', (tester) async {
    final b = FakeBackend()..on('GET', '/search/athletes', (_) => (200, {'data': [athlete('karim', 'Karim G.')], 'page': {'nextCursor': null, 'hasMore': false}}));
    await pumpScreen(tester, const SearchScreen(), b);
    await tester.enterText(find.byType(TextField), 'k');
    await tester.pump(const Duration(milliseconds: 400));
    expect(b.calls('GET', '/search/athletes'), isEmpty);
    await tester.enterText(find.byType(TextField), 'ka');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(b.calls('GET', '/search/athletes').single.queryParameters['q'], 'ka');
    expect(find.text('Karim G.'), findsOneWidget);
  });
}
