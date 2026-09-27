import 'package:fitness_league/features/notifications/presentation/notification_bell.dart';
import 'package:fitness_league/features/notifications/presentation/notifications_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

void main() {
  final list = {
    'unread': 2,
    'data': [
      {'id': 'n1', 'type': 'FRIEND_REQUEST', 'payload': {'userId': 'u9'}, 'read': false, 'createdAt': '2026-09-27T09:00:00Z'},
      {'id': 'n2', 'type': 'GYM_WOD_SCORE_INVALIDATED', 'payload': {'gymId': 'b', 'wodId': 'w1', 'wodTitle': 'Bodynade Burner', 'reason': 'No-rep'}, 'read': false, 'createdAt': '2026-09-27T08:00:00Z'},
      {'id': 'n3', 'type': 'BATTLE_RESULT', 'payload': {'battleId': 'bt1', 'outcome': 'WIN'}, 'read': true, 'createdAt': '2026-09-26T08:00:00Z'},
    ],
    'page': {'nextCursor': null, 'hasMore': false},
  };

  testWidgets('bell shows the unread count', (tester) async {
    await pumpScreen(tester, const Scaffold(body: NotificationBell()), FakeBackend()..on('GET', '/notifications', (_) => (200, list)));
    expect(find.text('2'), findsOneWidget);
  });

  testWidgets('lists readable texts and marks everything read', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/notifications', (_) => (200, list))
      ..on('POST', '/notifications/read', (_) => (204, null));
    await pumpScreen(tester, const NotificationsScreen(), b);
    expect(find.text('New friend request'), findsOneWidget);
    expect(find.textContaining('Bodynade Burner'), findsOneWidget);
    expect(find.textContaining('No-rep'), findsOneWidget);
    expect(find.text('Your battle is over: see the result'), findsOneWidget);
    await tester.tap(find.byTooltip('Mark all as read'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/notifications/read'), hasLength(1));
    expect((b.calls('POST', '/notifications/read').single.data as Map?)?['ids'], isNull);
  });
}
