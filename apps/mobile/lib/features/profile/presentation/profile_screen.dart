import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/providers.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/error_text.dart';
import '../../auth/data/session_controller.dart';
import '../../home/data/me_repository.dart';
import '../../progress/data/progress_repository.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    return Scaffold(
      appBar: AppBar(title: Text(l.navProfile)),
      body: ref.watch(meProvider).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(meProvider)),
            data: (me) {
              final profile = me['profile'] as Map<String, dynamic>;
              final stats = me['stats'] as Map<String, dynamic>;
              final records = ref.watch(recordsProvider).valueOrNull ?? const [];
              return ListView(padding: const EdgeInsets.all(16), children: [
                ListTile(
                  leading: CircleAvatar(radius: 28, child: Text((profile['fullName'] as String).characters.first.toUpperCase())),
                  title: Text(profile['fullName'] as String, style: t.textTheme.titleLarge),
                  subtitle: Text('@${me['username']} · ${l.level(stats['level'] as int)} · ${stats['division'] ?? ''}'),
                ),
                const SizedBox(height: 8),
                ListTile(leading: const Icon(Icons.insights_rounded), title: Text(l.myProgress), onTap: () => context.push('/progress')),
                ExpansionTile(
                  leading: const Icon(Icons.emoji_events_rounded),
                  title: Text(l.records),
                  children: [
                    for (final r in records)
                      ListTile(
                        dense: true,
                        title: Text('${localized((r['exercise'] as Map)['name'], locale)} · ${(r['metric'] as Map)['code']}'),
                        trailing: Text(formatMetric(r['value'] as num, (r['metric'] as Map)['unit'] as String, locale), style: t.textTheme.titleSmall),
                      ),
                  ],
                ),
                const Divider(),
                Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 4), child: Text(l.settings, style: t.textTheme.titleMedium)),
                const _SettingsSection(),
                const Divider(),
                ListTile(leading: const Icon(Icons.download_rounded), title: Text(l.exportData), onTap: () => _export(context, ref)),
                ListTile(leading: Icon(Icons.delete_forever_rounded, color: t.colorScheme.error), title: Text(l.deleteAccount), onTap: () => _delete(context, ref)),
                ListTile(
                  key: const Key('logout'),
                  leading: const Icon(Icons.logout_rounded),
                  title: Text(l.logout),
                  onTap: () => ref.read(sessionProvider.notifier).logout(),
                ),
              ]);
            },
          ),
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

class _SettingsSection extends ConsumerWidget {
  const _SettingsSection();

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
