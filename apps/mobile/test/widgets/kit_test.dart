import 'package:fitness_league/core/utils/format.dart';
import 'package:fitness_league/core/widgets/gym_logo.dart';
import 'package:fitness_league/core/widgets/rank_row.dart';
import 'package:fitness_league/core/widgets/time_field.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

void main() {
  test('parseDuration accepts m:ss and h:mm:ss and rejects nonsense', () {
    expect(parseDuration('4:58'), 298);
    expect(parseDuration('1:28:00'), 5280);
    expect(parseDuration(' 12:05 '), 725);
    expect(parseDuration('1:75'), isNull);
    expect(parseDuration('abc'), isNull);
    expect(parseDuration(''), isNull);
    expect(parseDuration('0:00'), isNull);
    expect(parseDuration('5'), isNull);
  });

  testWidgets('TimeField reports seconds, shows an error on invalid input', (tester) async {
    int? value = -1;
    await pumpScreen(tester, Scaffold(body: TimeField(key: const Key('t'), label: 'Time', onChanged: (v) => value = v)), FakeBackend());
    await tester.enterText(find.byKey(const Key('t')), '5:31');
    await tester.pump();
    expect(value, 331);
    await tester.enterText(find.byKey(const Key('t')), '5:61');
    await tester.pump();
    expect(value, isNull);
    expect(find.text('Use m:ss or h:mm:ss'), findsOneWidget);
  });

  testWidgets('GymLogo falls back to initials without a URL', (tester) async {
    await pumpScreen(tester, const Scaffold(body: GymLogo(name: 'Sfax Hybrid Box')), FakeBackend());
    expect(find.text('SH'), findsOneWidget);
  });

  testWidgets('RankRow highlights me and exposes a semantic label', (tester) async {
    await pumpScreen(tester, const Scaffold(body: RankRow(rank: 2, name: 'Nour', value: '5:30', highlight: true)), FakeBackend());
    expect(find.text('#2'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('Rank 2.*Nour.*5:30')), findsOneWidget);
  });
}
