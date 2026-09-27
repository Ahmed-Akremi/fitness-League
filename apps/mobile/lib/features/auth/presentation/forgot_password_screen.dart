import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/network/api_error.dart';
import '../../../core/widgets/error_text.dart';
import '../data/session_controller.dart';

/// Password reset request. Always shows the same confirmation, whatever the account state (no enumeration).
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _email = TextEditingController();
  bool _busy = false;
  bool _sent = false;
  Object? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authRepositoryProvider).forgotPassword(_email.text.trim());
      setState(() => _sent = true);
    } on ApiError catch (e) {
      // Only a network problem is worth showing; any server answer gets the neutral confirmation.
      setState(() => e.status == null ? _error = e : _sent = true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final valid = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(_email.text.trim());
    return Scaffold(
      appBar: AppBar(title: Text(l.forgotPassword)),
      body: ListView(padding: const EdgeInsets.all(24), children: [
        if (_sent) ...[
          Icon(Icons.mark_email_read_outlined, size: 64, color: t.colorScheme.primary),
          const SizedBox(height: 16),
          Text(l.resetLinkSent, textAlign: TextAlign.center, style: t.textTheme.titleMedium),
        ] else ...[
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: InputDecoration(labelText: l.email, prefixIcon: const Icon(Icons.alternate_email_rounded)),
            onChanged: (_) => setState(() {}),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(errorMessage(context, _error!), style: TextStyle(color: t.colorScheme.error))),
          const SizedBox(height: 20),
          FilledButton(onPressed: _busy || !valid ? null : _send, child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.sendLink)),
        ],
      ]),
    );
  }
}
