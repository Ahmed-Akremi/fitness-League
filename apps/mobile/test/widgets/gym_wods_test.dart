import 'package:fitness_league/features/gym_wods/presentation/create_wod_screen.dart';
import 'package:fitness_league/features/gym_wods/presentation/gym_wods_section.dart';
import 'package:fitness_league/features/gym_wods/presentation/wod_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> wod({Map<String, dynamic>? myScore, String scoreType = 'FOR_TIME'}) => {
      'id': 'w1',
      'gymId': 'b',
      'title': 'Bodynade Burner',
      'description': '21-15-9 thrusters, burpees',
      'scoreType': scoreType,
      'timeCapS': 900,
      'startsAt': DateTime.now().subtract(const Duration(hours: 2)).toIso8601String(),
      'endsAt': DateTime.now().add(const Duration(days: 2)).toIso8601String(),
      'status': 'PUBLISHED',
      'sport': null,
      'createdBy': {'id': 'c', 'username': 'ahmed'},
      'isOpen': true,
      'myScore': myScore,
    };

Map<String, dynamic> row(int rank, String id, String name, num value) =>
    {'rank': rank, 'scoreId': 's$id', 'athlete': {'id': id, 'username': id, 'fullName': name}, 'value': value, 'rounds': null, 'reps': null, 'submittedAt': '2026-09-27T10:00:00Z'};

FakeBackend backend({bool coach = false}) {
  Map<String, dynamic>? mine;
  return FakeBackend()
    ..on('GET', '/gyms/b', (_) => (200, {'myMembership': {'status': 'APPROVED', 'role': coach ? 'COACH' : 'MEMBER'}, 'canManage': false}))
    ..on('GET', '/gyms/b/wods/w1', (_) => (200, wod(myScore: mine)))
    ..on('GET', '/gyms/b/wods/w1/leaderboard', (req) => (200, {
          'data': req.queryParameters['division'] == 'SCALED' ? [row(1, 'n', 'Nour', 530)] : [row(1, 'y', 'Yassine', 452), row(2, 'me', 'Ahmed', 480)],
          'page': {'nextCursor': null, 'hasMore': false},
        }))
    ..on('PUT', '/gyms/b/wods/w1/score', (req) {
      mine = {'id': 's1', 'division': 'RX', 'value': 471, 'rounds': null, 'reps': null, 'status': 'VALID', 'invalidationReason': null};
      return (200, wod(myScore: mine));
    })
    ..on('POST', '/gyms/b/wods/w1/scores/sy/invalidate', (_) => (200, {'id': 'sy', 'status': 'INVALIDATED'}))
    ..on('POST', '/gyms/b/wods', (_) => (201, wod()));
}

void main() {
  testWidgets('shows the WOD, Rx/Scaled boards and submits a time', (tester) async {
    final b = backend();
    await pumpScreen(tester, const WodScreen(gymId: 'b', wodId: 'w1', myId: 'me'), b);
    expect(find.text('Bodynade Burner'), findsOneWidget);
    expect(find.text('7:32'), findsOneWidget); // 452 s
    await tester.tap(find.text('Scaled'));
    await tester.pumpAndSettle();
    expect(find.text('Nour'), findsOneWidget);

    await tester.tap(find.text('Submit my score'));
    await tester.pumpAndSettle();
    final save = find.widgetWithText(FilledButton, 'Save');
    expect(tester.widget<FilledButton>(save).onPressed, isNull); // nothing typed yet
    await tester.enterText(find.byKey(const Key('wod-time')), '15:01');
    await tester.pump();
    expect(tester.widget<FilledButton>(save).onPressed, isNull); // over the 15:00 cap
    expect(find.text('Over the time cap'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('wod-time')), '7:51');
    await tester.pump();
    await tester.tap(save);
    await tester.pumpAndSettle();
    final body = b.calls('PUT', '/gyms/b/wods/w1/score').single.data as Map;
    expect(body['timeS'], 471);
    expect(body['division'], 'RX');
    expect(find.text('7:51'), findsWidgets); // my score card
  });

  testWidgets('coaches can invalidate a score with a reason', (tester) async {
    final b = backend(coach: true);
    await pumpScreen(tester, const WodScreen(gymId: 'b', wodId: 'w1', myId: 'me'), b);
    await tester.longPress(find.text('Yassine'));
    await tester.pumpAndSettle();
    final confirm = find.widgetWithText(FilledButton, 'Invalidate');
    expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
    await tester.enterText(find.byKey(const Key('invalidate-reason')), 'No-rep');
    await tester.pump();
    await tester.tap(confirm);
    await tester.pumpAndSettle();
    expect((b.calls('POST', '/gyms/b/wods/w1/scores/sy/invalidate').single.data as Map)['reason'], 'No-rep');
  });

  testWidgets('members cannot invalidate (no long-press action)', (tester) async {
    await pumpScreen(tester, const WodScreen(gymId: 'b', wodId: 'w1', myId: 'me'), backend());
    await tester.longPress(find.text('Yassine'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('invalidate-reason')), findsNothing);
  });

  testWidgets('a coach creates a WOD', (tester) async {
    final b = backend(coach: true);
    await pumpScreen(tester, const CreateWodScreen(gymId: 'b'), b);
    await tester.enterText(find.byKey(const Key('wod-title')), 'Monday Grind');
    await tester.enterText(find.byKey(const Key('wod-description')), '5 rounds: 10 thrusters, 10 pull-ups');
    await tester.tap(find.text('AMRAP'));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Publish'));
    await tester.pumpAndSettle();
    final body = b.calls('POST', '/gyms/b/wods').single.data as Map;
    expect(body['title'], 'Monday Grind');
    expect(body['scoreType'], 'AMRAP');
    expect(DateTime.parse(body['endsAt'] as String).isAfter(DateTime.parse(body['startsAt'] as String)), isTrue);
  });

  testWidgets('an invalid or too short time cap blocks publishing; MAX_LOAD never sends a cap', (tester) async {
    final b = backend(coach: true);
    await pumpScreen(tester, const CreateWodScreen(gymId: 'b'), b);
    await tester.enterText(find.byKey(const Key('wod-title')), 'Cap test');
    await tester.enterText(find.byKey(const Key('wod-description')), '21-15-9');
    final publish = find.widgetWithText(FilledButton, 'Publish');
    for (final bad in ['1:75', '0:45']) {
      await tester.enterText(find.byKey(const Key('wod-cap')), bad);
      await tester.pump();
      expect(tester.widget<FilledButton>(publish).onPressed, isNull, reason: bad);
    }
    await tester.enterText(find.byKey(const Key('wod-cap')), '12:00');
    await tester.pump();
    await tester.tap(find.text('Max load'));
    await tester.pump();
    await tester.tap(publish);
    await tester.pumpAndSettle();
    final body = b.calls('POST', '/gyms/b/wods').single.data as Map;
    expect(body['scoreType'], 'MAX_LOAD');
    expect(body.containsKey('timeCapS'), isFalse);
  });

  testWidgets('a coach publishes a draft from the WOD screen', (tester) async {
    var status = 'DRAFT';
    final b = backend(coach: true)
      ..on('GET', '/gyms/b/wods/w1', (_) => (200, {...wod(), 'status': status, 'isOpen': false}))
      ..on('PATCH', '/gyms/b/wods/w1', (req) {
        status = (req.data as Map)['status'] as String;
        return (200, {...wod(), 'status': status});
      });
    await pumpScreen(tester, const WodScreen(gymId: 'b', wodId: 'w1', myId: 'me'), b);
    expect(find.text('Draft'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Publish'));
    await tester.pumpAndSettle();
    expect(b.calls('PATCH', '/gyms/b/wods/w1').single.data, {'status': 'PUBLISHED'});
  });

  testWidgets('coaches also see upcoming WODs in the gym section', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/gyms/b/wods', (req) => (200, {
            'data': req.queryParameters['when'] == 'upcoming' ? [{...wod(), 'id': 'w2', 'title': 'Next Monday', 'isOpen': false, 'status': 'DRAFT'}] : <Object>[],
            'page': {'nextCursor': null, 'hasMore': false},
          }));
    await pumpScreen(tester, const Scaffold(body: SingleChildScrollView(child: GymWodsSection(gymId: 'b', isMember: true, isCoach: true))), b);
    await tester.tap(find.text('Upcoming'));
    await tester.pumpAndSettle();
    expect(find.text('Next Monday'), findsOneWidget);
    expect(find.text('Draft'), findsOneWidget);
  });
}
