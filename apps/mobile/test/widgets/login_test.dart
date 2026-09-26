import 'package:fitness_league/features/auth/data/session_controller.dart';
import 'package:fitness_league/features/auth/presentation/login_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

void main() {
  testWidgets('shows a translated error for wrong credentials, then signs in', (tester) async {
    final backend = FakeBackend();
    var attempts = 0;
    backend.on('POST', '/auth/login', (_) => ++attempts == 1 ? (401, {'code': 'INVALID_CREDENTIALS'}) : (200, session()));
    final container = await pumpScreen(tester, const LoginScreen(), backend);

    await tester.enterText(find.byKey(const Key('login-email')), 'ahmed@example.test');
    await tester.enterText(find.byKey(const Key('login-password')), 'nope');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Wrong email or password.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(container.read(sessionProvider), AuthStatus.signedIn);
  });

  testWidgets('validates the form before calling the API', (tester) async {
    final backend = FakeBackend();
    await pumpScreen(tester, const LoginScreen(), backend);
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Invalid email'), findsOneWidget);
    expect(backend.requests, isEmpty);
  });
}
