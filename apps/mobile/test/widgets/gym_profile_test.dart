import 'package:fitness_league/features/gyms/presentation/gym_members_screen.dart';
import 'package:fitness_league/features/gyms/presentation/gym_profile_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> profile({String status = 'NONE', String? role, bool canManage = false}) => {
      'id': 'b',
      'name': 'Bodynade',
      'slug': 'bodynade',
      'verified': true,
      'logoUrl': null,
      'membersCount': 42,
      'level': 4,
      'rank': 3,
      'city': {'en': 'Tunis'},
      'governorate': {'id': 'g1', 'code': 'TN-11', 'name': {'en': 'Tunis'}},
      'sports': [
        {'code': 'CROSSFIT', 'name': {'en': 'CrossFit'}},
        {'code': 'HYROX', 'name': {'en': 'Hyrox'}},
      ],
      'addressLine': 'Les Berges du Lac',
      'socialLinks': {'instagram': 'https://instagram.com/bodynade.demo'},
      'topAthletes': [
        {'id': 'u1', 'username': 'yassine', 'fullName': 'Yassine T.', 'lp': 1180, 'level': 9},
      ],
      'myMembership': {'status': status, 'role': role},
      'canManage': canManage,
      'warRecord': null,
    };

FakeBackend withWods(FakeBackend b) => b..on('GET', '/gyms/b/wods', (_) => (200, {'data': [], 'page': {'nextCursor': null, 'hasMore': false}}));

void main() {
  testWidgets('shows header, stats, sports, address and top athletes; joins', (tester) async {
    var status = 'NONE';
    final b = withWods(FakeBackend()
      ..on('GET', '/gyms/b', (_) => (200, profile(status: status)))
      ..on('POST', '/gyms/b/membership', (_) {
        status = 'PENDING';
        return (201, {'gymId': 'b', 'status': 'PENDING'});
      }));
    await pumpScreen(tester, const GymProfileScreen(id: 'b'), b);
    expect(find.text('Bodynade'), findsWidgets);
    expect(find.text('#3'), findsOneWidget);
    expect(find.text('CrossFit'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Yassine T.'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('Les Berges du Lac'), findsOneWidget);
    expect(find.text('Yassine T.'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Join'));
    await tester.pumpAndSettle();
    expect(find.text('Request sent'), findsOneWidget);
  });

  testWidgets('members see Leave; gym admins see the logo and members actions', (tester) async {
    await pumpScreen(tester, const GymProfileScreen(id: 'b'), withWods(FakeBackend()..on('GET', '/gyms/b', (_) => (200, profile(status: 'APPROVED', role: 'COACH', canManage: true)))));
    expect(find.text('Leave'), findsOneWidget);
    expect(find.byTooltip('Change logo'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Manage members'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('Manage members'), findsOneWidget);
  });

  testWidgets('the gym admin approves requests and appoints a coach', (tester) async {
    var requests = [
      {'userId': 'u9', 'username': 'sami', 'fullName': 'Sami J.', 'requestedAt': '2026-09-27T09:00:00Z'},
    ];
    final b = FakeBackend()
      ..on('GET', '/gyms/b/membership-requests', (_) => (200, requests))
      ..on('POST', '/gyms/b/members/u9/approve', (_) {
        requests = [];
        return (200, {'userId': 'u9', 'status': 'APPROVED'});
      })
      ..on('GET', '/gyms/b/members', (_) => (200, {
            'data': [
              {'id': 'u2', 'username': 'nour', 'fullName': 'Nour H.', 'role': 'MEMBER', 'since': null},
            ],
            'page': {'nextCursor': null, 'hasMore': false},
          }))
      ..on('POST', '/gyms/b/members/u2/coach', (_) => (200, {'userId': 'u2', 'role': 'COACH'}));
    await pumpScreen(tester, const GymMembersScreen(id: 'b'), b);
    expect(find.text('Sami J.'), findsOneWidget);
    await tester.tap(find.byTooltip('Approve'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/gyms/b/members/u9/approve'), hasLength(1));
    expect(find.text('Sami J.'), findsNothing);

    await tester.tap(find.text('Members'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Member actions'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Make coach'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/gyms/b/members/u2/coach'), hasLength(1));
  });

  testWidgets('removing a member asks for confirmation first', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/gyms/b/membership-requests', (_) => (200, <Object>[]))
      ..on('GET', '/gyms/b/members', (_) => (200, {
            'data': [
              {'id': 'u2', 'username': 'nour', 'fullName': 'Nour H.', 'role': 'MEMBER', 'since': null},
            ],
            'page': {'nextCursor': null, 'hasMore': false},
          }))
      ..on('POST', '/gyms/b/members/u2/remove', (_) => (200, {'userId': 'u2', 'status': 'REMOVED'}));
    await pumpScreen(tester, const GymMembersScreen(id: 'b'), b);
    await tester.tap(find.text('Members'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Member actions'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remove from gym'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/gyms/b/members/u2/remove'), isEmpty);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/gyms/b/members/u2/remove'), isEmpty);
  });
}
