import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/network/api_error.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/error_text.dart';
import '../../onboarding/data/reference_repository.dart';
import '../data/auth_repository.dart';
import '../data/session_controller.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _fullName = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  DateTime? _dob;
  String? _governorateId;
  String? _cityId;
  bool _terms = false;
  bool _privacy = false;
  bool _health = false;
  bool _busy = false;
  bool _submitted = false;
  Object? _error;

  @override
  void dispose() {
    for (final c in [_username, _fullName, _email, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _serverField(String field) {
    final e = _error;
    return e is ApiError && e.fieldCode(field) != null ? context.l10n.errorValidation : null;
  }

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final picked = await showDatePicker(context: context, initialDate: DateTime(now.year - 25), firstDate: DateTime(now.year - 100), lastDate: now);
    if (picked != null) setState(() => _dob = picked);
  }

  Future<void> _submit() async {
    setState(() => _submitted = true);
    final ok = _form.currentState!.validate();
    if (!ok || _dob == null || _governorateId == null || _cityId == null || !_terms || !_privacy) {
      setState(() {});
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).register(RegistrationData(
            username: _username.text.trim(),
            fullName: _fullName.text.trim(),
            email: _email.text.trim(),
            password: _password.text,
            dateOfBirth: _dob!,
            governorateId: _governorateId!,
            cityId: _cityId!,
            healthDataConsent: _health,
            locale: Localizations.localeOf(context).languageCode,
          ));
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
    final locale = Localizations.localeOf(context).languageCode;
    final govs = ref.watch(governoratesProvider);
    final cities = _governorateId == null ? null : ref.watch(citiesProvider(_governorateId!));
    final submitted = _submitted;

    return Scaffold(
      appBar: AppBar(title: Text(l.register)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Form(
            key: _form,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              TextFormField(
                key: const Key('reg-username'),
                controller: _username,
                decoration: InputDecoration(labelText: l.username, helperText: l.usernameRule, errorText: _serverField('username')),
                validator: (v) => RegExp(r'^[a-z0-9_.]{3,20}$').hasMatch(v ?? '') ? null : l.usernameRule,
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('reg-fullname'),
                controller: _fullName,
                decoration: InputDecoration(labelText: l.fullName),
                validator: (v) => (v == null || v.trim().length < 2) ? l.required : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('reg-email'),
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                decoration: InputDecoration(labelText: l.email),
                validator: (v) => (v == null || !v.contains('@')) ? l.invalidEmail : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('reg-password'),
                controller: _password,
                obscureText: true,
                decoration: InputDecoration(labelText: l.password, helperText: l.passwordTooShort),
                validator: (v) => (v == null || v.length < 10) ? l.passwordTooShort : null,
              ),
              const SizedBox(height: 12),
              ListTile(
                key: const Key('reg-dob'),
                contentPadding: EdgeInsets.zero,
                title: Text(l.dateOfBirth),
                subtitle: Text(_dob == null ? l.dateOfBirthHint : MaterialLocalizations.of(context).formatMediumDate(_dob!)),
                trailing: const Icon(Icons.calendar_month_rounded),
                onTap: _pickDob,
                textColor: submitted && _dob == null ? t.colorScheme.error : null,
              ),
              govs.when(
                data: (list) => DropdownButtonFormField<String>(
                  key: const Key('reg-governorate'),
                  initialValue: _governorateId,
                  decoration: InputDecoration(labelText: l.governorate),
                  items: [for (final g in list) DropdownMenuItem(value: g['id'] as String, child: Text(localized(g['name'], locale)))],
                  onChanged: (v) => setState(() {
                    _governorateId = v;
                    _cityId = null;
                  }),
                  validator: (v) => v == null ? l.required : null,
                ),
                loading: () => const LinearProgressIndicator(),
                error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(governoratesProvider)),
              ),
              const SizedBox(height: 12),
              if (cities != null)
                cities.when(
                  data: (list) => DropdownButtonFormField<String>(
                    key: const Key('reg-city'),
                    initialValue: _cityId,
                    decoration: InputDecoration(labelText: l.city),
                    items: [for (final c in list) DropdownMenuItem(value: c['id'] as String, child: Text(localized(c['name'], locale)))],
                    onChanged: (v) => setState(() => _cityId = v),
                    validator: (v) => v == null ? l.required : null,
                  ),
                  loading: () => const LinearProgressIndicator(),
                  error: (e, _) => ErrorView(error: e),
                ),
              const SizedBox(height: 8),
              CheckboxListTile(key: const Key('reg-terms'), value: _terms, onChanged: (v) => setState(() => _terms = v ?? false), title: Text(l.acceptTerms), contentPadding: EdgeInsets.zero, isError: submitted && !_terms),
              CheckboxListTile(key: const Key('reg-privacy'), value: _privacy, onChanged: (v) => setState(() => _privacy = v ?? false), title: Text(l.acceptPrivacy), contentPadding: EdgeInsets.zero, isError: submitted && !_privacy),
              CheckboxListTile(value: _health, onChanged: (v) => setState(() => _health = v ?? false), title: Text(l.acceptHealth), contentPadding: EdgeInsets.zero),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(errorMessage(context, _error!), style: TextStyle(color: t.colorScheme.error)),
              ],
              const SizedBox(height: 20),
              FilledButton(key: const Key('reg-submit'), onPressed: _busy ? null : _submit, child: Text(l.register)),
              TextButton(onPressed: () => context.go('/login'), child: Text(l.haveAccount)),
            ]),
          ),
        ),
      ),
    );
  }
}
