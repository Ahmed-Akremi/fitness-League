import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/error_text.dart';
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
                ListTile(leading: const Icon(Icons.emoji_events_outlined), title: Text(l.allRecords), onTap: () => context.push('/records')),
                ListTile(leading: const Icon(Icons.monitor_weight_outlined), title: Text(l.body), onTap: () => context.push('/me/body')),
                ListTile(leading: const Icon(Icons.settings_outlined), title: Text(l.settings), onTap: () => context.push('/settings')),
              ]);
            },
          ),
    );
  }
}
