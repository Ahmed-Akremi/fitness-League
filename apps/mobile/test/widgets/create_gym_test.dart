import 'dart:typed_data';

import 'package:fitness_league/features/gyms/presentation/create_gym_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

void main() {
  FakeBackend backend() => FakeBackend()
    ..on('GET', '/ref/governorates', (_) => (200, [
          {'id': 'g1', 'code': 'TN-11', 'name': {'fr': 'Tunis', 'en': 'Tunis', 'ar': 'تونس'}},
        ]))
    ..on('GET', '/ref/cities', (_) => (200, [
          {'id': 'c1', 'code': 'TN-11-tunis', 'name': {'fr': 'Tunis', 'en': 'Tunis', 'ar': 'تونس'}},
        ]))
    ..on('GET', '/ref/sports', (_) => (200, [
          {'id': 's-cf', 'code': 'CROSSFIT', 'name': {'en': 'CrossFit'}},
          {'id': 's-hx', 'code': 'HYROX', 'name': {'en': 'Hyrox'}},
        ]))
    ..on('POST', '/gyms', (_) => (201, {'id': 'new-gym', 'slug': 'lac-hybrid-club', 'status': 'PENDING'}))
    ..on('PUT', '/gyms/new-gym/logo', (_) => (200, {'logoUrl': 'http://x/logo.webp'}));

  testWidgets('submits the gym, uploads the photo and shows the pending state', (tester) async {
    final b = backend();
    await pumpScreen(tester, CreateGymScreen(pickImage: () async => (bytes: Uint8List.fromList([1, 2, 3]), name: 'logo.png')), b);
    await tester.tap(find.byKey(const Key('gym-photo')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('gym-name')), 'Lac Hybrid Club');
    await tester.tap(find.byKey(const Key('gym-governorate')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tunis').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('gym-city')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tunis').last);
    await tester.pumpAndSettle();
    final scroll = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(find.widgetWithText(FilterChip, 'Hyrox'), 200, scrollable: scroll);
    await tester.tap(find.widgetWithText(FilterChip, 'CrossFit'));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilterChip, 'Hyrox'));
    await tester.pump();
    await tester.scrollUntilVisible(find.byKey(const Key('gym-proof')), 200, scrollable: scroll);
    await tester.enterText(find.byKey(const Key('gym-proof')), 'RNE 7654321B, contrat de bail');
    await tester.pump();
    final submit = find.byKey(const Key('gym-submit'));
    await tester.scrollUntilVisible(submit, 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(submit);
    await tester.pumpAndSettle();

    final body = b.calls('POST', '/gyms').single.data as Map;
    expect(body, containsPair('name', 'Lac Hybrid Club'));
    expect(body['governorateId'], 'g1');
    expect(body['cityId'], 'c1');
    expect(body['sportIds'], ['s-cf', 's-hx']);
    expect(b.calls('PUT', '/gyms/new-gym/logo'), hasLength(1));
    expect(find.textContaining('waiting for approval'), findsOneWidget);
  });

  testWidgets('the submit button stays off until the required fields are valid', (tester) async {
    await pumpScreen(tester, const CreateGymScreen(), backend());
    final submit = find.byKey(const Key('gym-submit'));
    await tester.scrollUntilVisible(submit, 300, scrollable: find.byType(Scrollable).first);
    expect(tester.widget<FilledButton>(submit).onPressed, isNull);
  });
}
