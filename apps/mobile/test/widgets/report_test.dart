import 'package:fitness_league/features/moderation/report_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

void main() {
  testWidgets('reports an athlete with a reason and details', (tester) async {
    final b = FakeBackend()..on('POST', '/reports', (_) => (201, {'id': 'r1', 'status': 'OPEN'}));
    await pumpScreen(tester, Scaffold(body: Builder(builder: (c) => TextButton(onPressed: () => showReportSheet(c, targetType: 'USER', targetId: 'u2'), child: const Text('open')))), b);
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Send the report')).onPressed, isNull);
    await tester.tap(find.text('Harassment'));
    await tester.enterText(find.byType(TextField), 'Insults under my workouts');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Send the report'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/reports').single.data, {'targetType': 'USER', 'targetId': 'u2', 'reason': 'HARASSMENT', 'details': 'Insults under my workouts'});
    expect(find.text('Thanks, a moderator will look at it'), findsOneWidget);
  });
}
