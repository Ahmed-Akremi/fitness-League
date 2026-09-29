import 'package:fitness_league/features/settings/presentation/notification_settings.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> prefs({bool social = true, Map<String, dynamic>? quiet}) => {
      'categories': {'SOCIAL': social, 'BATTLES': true, 'COMPETITION': true, 'CHALLENGES': true, 'BADGES': true, 'GYM': true},
      'quietHours': quiet,
    };

void main() {
  testWidgets('switches a push category off and clears quiet hours', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/me/notification-preferences', (_) => (200, prefs(quiet: {'start': '22:00', 'end': '07:00'})))
      ..on('PUT', '/me/notification-preferences', (r) {
        final body = r.data as Map;
        return (200, prefs(social: !(body['categories'] is Map && (body['categories'] as Map)['SOCIAL'] == false), quiet: body.containsKey('quietHours') ? null : {'start': '22:00', 'end': '07:00'}));
      });
    await pumpScreen(tester, const Scaffold(body: SingleChildScrollView(child: NotificationSettingsSection())), b);
    expect(find.text('22:00 – 07:00'), findsOneWidget);
    await tester.tap(find.widgetWithText(SwitchListTile, 'Friends, reactions and comments'));
    await tester.pumpAndSettle();
    expect(b.calls('PUT', '/me/notification-preferences').first.data, {'categories': {'SOCIAL': false}});
    expect(tester.widget<SwitchListTile>(find.widgetWithText(SwitchListTile, 'Friends, reactions and comments')).value, isFalse);
    await tester.tap(find.byIcon(Icons.close_rounded));
    await tester.pumpAndSettle();
    expect(b.calls('PUT', '/me/notification-preferences').last.data, {'quietHours': null});
    expect(find.text('Off'), findsOneWidget);
  });
}
