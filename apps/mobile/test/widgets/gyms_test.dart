import 'package:fitness_league/features/gyms/presentation/gyms_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> gym(String id, String name, List<String> sports, int members, {String? logo}) => {
      'id': id,
      'name': name,
      'slug': id,
      'verified': true,
      'logoUrl': logo,
      'membersCount': members,
      'level': 3,
      'city': {'fr': 'Tunis', 'en': 'Tunis', 'ar': 'تونس'},
      'governorate': {'id': 'g1', 'code': 'TN-11', 'name': {'fr': 'Tunis', 'en': 'Tunis', 'ar': 'تونس'}},
      'sports': [
        for (final s in sports) {'code': s, 'name': {'fr': s, 'en': s, 'ar': s}, 'icon': null},
      ],
    };

void main() {
  FakeBackend backend() => FakeBackend()
    ..on('GET', '/ref/sports', (_) => (200, [
          {'id': 's1', 'code': 'CROSSFIT', 'name': {'fr': 'CrossFit', 'en': 'CrossFit', 'ar': 'كروسفيت'}},
          {'id': 's2', 'code': 'HYROX', 'name': {'fr': 'Hyrox', 'en': 'Hyrox', 'ar': 'هايروكس'}},
        ]))
    ..on('GET', '/ref/governorates', (_) => (200, [
          {'id': 'g1', 'code': 'TN-11', 'name': {'fr': 'Tunis', 'en': 'Tunis', 'ar': 'تونس'}},
        ]))
    ..on('GET', '/gyms', (req) {
      final q = req.queryParameters;
      if (q['q'] == 'zzz') return (200, {'data': [], 'page': {'nextCursor': null, 'hasMore': false}});
      if (q['sport'] == 'HYROX') return (200, {'data': [gym('b', 'Bodynade', ['CROSSFIT', 'HYROX'], 42)], 'page': {'nextCursor': null, 'hasMore': false}});
      return (200, {
        'data': [gym('b', 'Bodynade', ['CROSSFIT', 'HYROX'], 42), gym('c', 'Carthage Strength Lab', ['BODYBUILDING'], 1)],
        'page': {'nextCursor': null, 'hasMore': false},
      });
    });

  testWidgets('lists gyms with logo fallback, sports and member count', (tester) async {
    await pumpScreen(tester, const GymsScreen(), backend());
    expect(find.text('Bodynade'), findsOneWidget);
    expect(find.text('BO'), findsOneWidget); // initials fallback (single word → first two letters)
    expect(find.text('42 members'), findsOneWidget);
    expect(find.text('1 member'), findsOneWidget);
  });

  testWidgets('filters by sport chip and searches by name', (tester) async {
    final b = backend();
    await pumpScreen(tester, const GymsScreen(), b);
    await tester.tap(find.widgetWithText(FilterChip, 'Hyrox'));
    await tester.pumpAndSettle();
    expect(b.calls('GET', '/gyms').last.queryParameters['sport'], 'HYROX');
    expect(find.text('Carthage Strength Lab'), findsNothing);

    await tester.enterText(find.byKey(const Key('gym-search')), 'zzz');
    await tester.pump(const Duration(milliseconds: 400)); // debounce
    await tester.pumpAndSettle();
    expect(find.text('No gym found'), findsOneWidget);
  });

  testWidgets('French plural: a gym without members shows 0, not 1', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/ref/sports', (_) => (200, <Object>[]))
      ..on('GET', '/ref/governorates', (_) => (200, <Object>[]))
      ..on('GET', '/gyms', (_) => (200, {'data': [gym('z', 'Zero Gym', ['BODYBUILDING'], 0)], 'page': {'nextCursor': null, 'hasMore': false}}));
    await pumpScreen(tester, const GymsScreen(), b, locale: const Locale('fr'));
    expect(find.text('0 membre'), findsOneWidget);
    expect(find.text('1 membre'), findsNothing);
  });

  testWidgets('lays out right-to-left in Arabic', (tester) async {
    await pumpScreen(tester, const GymsScreen(), backend(), locale: const Locale('ar'));
    expect(Directionality.of(tester.element(find.text('Bodynade'))), TextDirection.rtl);
  });
}
