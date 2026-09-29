import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/providers.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/section_header.dart';
import '../../auth/data/session_controller.dart';
import '../../home/data/me_repository.dart';
import 'notification_settings.dart';

/// Settings: preferences (language, theme, training days), privacy, data export, account deletion, sign out.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.settings)),
      body: ListView(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8), children: [
        SectionHeader(title: l.preferences),
        const PreferencesSection(),
        SectionHeader(title: l.notifications),
        const NotificationSettingsSection(),
        SectionHeader(title: l.privacy),
        const PrivacySection(),
        SectionHeader(title: l.account),
        ListTile(leading: const Icon(Icons.download_rounded), title: Text(l.exportData), onTap: () => _export(context, ref)),
        ListTile(leading: Icon(Icons.delete_forever_rounded, color: t.colorScheme.error), title: Text(l.deleteAccount), onTap: () => _delete(context, ref)),
        ListTile(
          key: const Key('logout'),
          leading: const Icon(Icons.logout_rounded),
          title: Text(l.logout),
          onTap: () => ref.read(sessionProvider.notifier).logout(),
        ),
      ]),
    );
  }

  Future<void> _export(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    final l = context.l10n;
    try {
      final data = await ref.read(meRepositoryProvider).exportData();
      messenger.showSnackBar(SnackBar(content: Text('${l.exportData}: ${(data['workouts'] as List).length} workouts')));
    } catch (e) {
      if (context.mounted) messenger.showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    final l = context.l10n;
    final password = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.deleteAccount),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(l.deleteAccountWarning),
          const SizedBox(height: 12),
          TextField(controller: password, obscureText: true, decoration: InputDecoration(labelText: l.password)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.cancel)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.delete)),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(meRepositoryProvider).deleteAccount(password.text);
      await ref.read(apiClientProvider).clearSession();
      ref.read(sessionExpiredProvider.notifier).state++;
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    }
  }
}

/// Privacy switches saved with PATCH /me/settings (optimistic, rolled back on error).
class PrivacySection extends ConsumerStatefulWidget {
  const PrivacySection({super.key});

  @override
  ConsumerState<PrivacySection> createState() => _PrivacySectionState();
}

class _PrivacySectionState extends ConsumerState<PrivacySection> {
  final Map<String, Object?> _overrides = {};

  Future<void> _set(String key, Object value) async {
    final previous = _overrides[key];
    setState(() => _overrides[key] = value);
    try {
      await ref.read(meRepositoryProvider).updateSettings({key: value});
    } catch (e) {
      if (!mounted) return;
      setState(() => _overrides[key] = previous);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final settings = ((ref.watch(meProvider).valueOrNull?['settings'] as Map?) ?? const {}).cast<String, dynamic>();
    Object? value(String k) => _overrides.containsKey(k) ? _overrides[k] : settings[k];
    return Column(children: [
      ListTile(
        title: Text(l.workoutVisibility),
        trailing: DropdownButton<String>(
          value: (value('defaultVisibility') ?? 'FRIENDS') as String,
          items: [
            DropdownMenuItem(value: 'PUBLIC', child: Text(l.visibilityPublic)),
            DropdownMenuItem(value: 'FRIENDS', child: Text(l.visibilityFriends)),
            DropdownMenuItem(value: 'PRIVATE', child: Text(l.visibilityPrivate)),
          ],
          onChanged: (v) => v == null ? null : _set('defaultVisibility', v),
        ),
      ),
      SwitchListTile(title: Text(l.showAgeBracket), value: value('showAgeBracket') == true, onChanged: (v) => _set('showAgeBracket', v)),
      SwitchListTile(title: Text(l.showOnLeaderboards), value: value('showOnLeaderboards') != false, onChanged: (v) => _set('showOnLeaderboards', v)),
    ]);
  }
}

class PreferencesSection extends ConsumerWidget {
  const PreferencesSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final locale = ref.watch(localeProvider);
    final theme = ref.watch(themeModeProvider);
    final me = ref.watch(meProvider).valueOrNull;
    final planned = ((me?['profile'] as Map?)?['plannedTrainingDaysPerWeek'] as int?) ?? 3;
    return Column(children: [
      ListTile(
        title: Text(l.language),
        trailing: DropdownButton<String>(
          key: const Key('settings-language'),
          value: locale?.languageCode ?? Localizations.localeOf(context).languageCode,
          items: const [
            DropdownMenuItem(value: 'fr', child: Text('Français')),
            DropdownMenuItem(value: 'en', child: Text('English')),
            DropdownMenuItem(value: 'ar', child: Text('العربية')),
          ],
          onChanged: (v) {
            if (v == null) return;
            ref.read(localeProvider.notifier).set(Locale(v));
            ref.read(apiClientProvider).language = v;
            ref.read(meRepositoryProvider).updateSettings({'locale': v}).ignore();
          },
        ),
      ),
      ListTile(
        title: Text(l.theme),
        trailing: SegmentedButton<ThemeMode>(
          segments: [
            ButtonSegment(value: ThemeMode.dark, label: Text(l.themeDark)),
            ButtonSegment(value: ThemeMode.light, label: Text(l.themeLight)),
            ButtonSegment(value: ThemeMode.system, label: Text(l.themeSystem)),
          ],
          selected: {theme},
          onSelectionChanged: (s) => ref.read(themeModeProvider.notifier).set(s.first),
        ),
      ),
      ListTile(
        title: Text(l.trainingDaysPerWeek),
        trailing: DropdownButton<int>(
          value: planned,
          items: [for (var d = 1; d <= 6; d++) DropdownMenuItem(value: d, child: Text('$d'))],
          onChanged: (v) async {
            if (v == null) return;
            await ref.read(meRepositoryProvider).updateProfile({'plannedTrainingDaysPerWeek': v});
            ref.invalidate(meProvider);
          },
        ),
      ),
    ]);
  }
}
