import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/providers.dart';
import '../../../core/widgets/error_text.dart';
import '../data/session_controller.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).login(_email.text.trim(), _password.text);
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final appName = ref.watch(appConfigProvider).appName;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _form,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Container(
                    width: 64,
                    height: 64,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: t.colorScheme.primary, borderRadius: BorderRadius.circular(18)),
                    child: const Icon(Icons.bolt_rounded, size: 40, color: Color(0xFF0E0F12)),
                  ),
                  const SizedBox(height: 20),
                  Text(appName.toUpperCase(), style: t.textTheme.displaySmall?.copyWith(color: t.colorScheme.primary, height: 1)),
                  const SizedBox(height: 8),
                  Text(l.appTagline, style: t.textTheme.bodyLarge?.copyWith(color: t.colorScheme.outline)),
                  const SizedBox(height: 40),
                  TextFormField(
                    key: const Key('login-email'),
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    decoration: InputDecoration(labelText: l.email),
                    validator: (v) => (v == null || !v.contains('@')) ? l.invalidEmail : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    key: const Key('login-password'),
                    controller: _password,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    decoration: InputDecoration(labelText: l.password),
                    validator: (v) => (v == null || v.isEmpty) ? l.required : null,
                    onFieldSubmitted: (_) => _submit(),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(errorMessage(context, _error!), style: TextStyle(color: t.colorScheme.error)),
                  ],
                  const SizedBox(height: 24),
                  FilledButton(
                    key: const Key('login-submit'),
                    onPressed: _busy ? null : _submit,
                    child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.login),
                  ),
                  const SizedBox(height: 8),
                  TextButton(onPressed: () => context.push('/forgot-password'), child: Text(l.forgotPassword)),
                  TextButton(onPressed: () => context.go('/register'), child: Text(l.noAccount)),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
