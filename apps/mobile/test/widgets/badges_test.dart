import 'package:fitness_league/features/badges/presentation/badges_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> badge(String code, String category, String name, {String? awardedAt, int current = 0, int target = 1}) => {
      'code': code,
      'category': category,
      'name': {'en': name},
      'description': {'en': '$name description'},
      'icon': 'dumbbell',
      'rarity': 'COMMON',
      'awardedAt': awardedAt,
      'progress': {'current': current, 'target': target, 'met': awardedAt != null},
    };

void main() {
  testWidgets('groups badges by category, counts the earned ones and shows progress on locked ones', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/badges', (_) => (200, [
            badge('FIRST_STEP', 'PROGRESS', 'First Step', awardedAt: '2026-11-10T08:00:00Z', current: 1),
            badge('TEN_WORKOUTS', 'PROGRESS', 'Regular', current: 3, target: 10),
            badge('FIRST_FRIEND', 'SOCIAL', 'Training buddy'),
          ]));
    await pumpScreen(tester, const BadgesScreen(), b);
    expect(find.text('1 of 3 earned'), findsOneWidget);
    expect(find.text('PROGRESS'), findsOneWidget);
    expect(find.text('SOCIAL'), findsOneWidget);
    expect(find.text('First Step'), findsOneWidget);
    expect(find.text('3/10'), findsOneWidget);
    // Earned badges show no progress bar.
    expect(find.byType(LinearProgressIndicator), findsNWidgets(2));
  });
}
