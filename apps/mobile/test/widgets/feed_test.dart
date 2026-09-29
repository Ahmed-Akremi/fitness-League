import 'package:fitness_league/features/feed/presentation/feed_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> item({String? myReaction, int fire = 0}) => {
      'id': 'a1',
      'type': 'WORKOUT',
      'createdAt': '2027-02-01T09:00:00Z',
      'user': {'id': 'u2', 'username': 'yassine', 'fullName': 'Yassine T.'},
      'isMine': false,
      'details': {
        'durationS': 3600,
        'sport': {'code': 'POWERLIFTING', 'name': {'en': 'Powerlifting'}},
      },
      'reactions': {'LIKE': 0, 'FIRE': fire, 'STRONG': 0},
      'myReaction': myReaction,
      'comments': 0,
    };

void main() {
  testWidgets('shows friends activity and reacts', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/feed', (_) => (200, {'data': [item()], 'page': {'nextCursor': null, 'hasMore': false}}))
      ..on('PUT', '/activities/a1/reactions', (_) => (200, {'reactions': {'LIKE': 0, 'FIRE': 1, 'STRONG': 0}, 'myReaction': 'FIRE'}));
    await pumpScreen(tester, const FeedScreen(), b);
    expect(find.text('Yassine T.'), findsOneWidget);
    expect(find.text('trained: Powerlifting, 60 min'), findsOneWidget);
    await tester.tap(find.text('🔥 0'));
    await tester.pumpAndSettle();
    expect(b.calls('PUT', '/activities/a1/reactions').single.data, {'type': 'FIRE'});
    expect(find.text('🔥 1'), findsOneWidget);
  });

  testWidgets('comments on an activity', (tester) async {
    var comments = <Map<String, dynamic>>[];
    final b = FakeBackend()
      ..on('GET', '/feed', (_) => (200, {'data': [item()], 'page': {'nextCursor': null, 'hasMore': false}}))
      ..on('GET', '/activities/a1/comments', (_) => (200, {'data': comments, 'page': {'nextCursor': null, 'hasMore': false}}))
      ..on('POST', '/activities/a1/comments', (r) {
        comments = [
          {'id': 'c1', 'body': (r.data as Map)['body'], 'createdAt': '2027-02-01T10:00:00Z', 'user': {'id': 'u1', 'username': 'ahmed', 'fullName': 'Ahmed'}, 'isMine': true},
        ];
        return (201, comments.first);
      });
    await pumpScreen(tester, const FeedScreen(), b);
    await tester.tap(find.byIcon(Icons.chat_bubble_outline_rounded));
    await tester.pumpAndSettle();
    expect(find.text('No comment yet'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Beast mode');
    await tester.pump();
    await tester.tap(find.byIcon(Icons.send_rounded));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/activities/a1/comments').single.data, {'body': 'Beast mode'});
    expect(find.text('Beast mode'), findsOneWidget);
  });

  testWidgets('invites to add friends when the feed is empty', (tester) async {
    await pumpScreen(tester, const FeedScreen(), FakeBackend()..on('GET', '/feed', (_) => (200, {'data': <Object>[], 'page': {'nextCursor': null, 'hasMore': false}})));
    expect(find.text('Nothing here yet. Add friends to follow their training!'), findsOneWidget);
  });
}
