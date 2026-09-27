import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/avatar_badge.dart';
import '../../../core/widgets/error_text.dart';
import '../../gyms/data/gyms_repository.dart';
import '../../../core/widgets/gym_logo.dart';
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
      appBar: AppBar(title: Text(l.navProfile), actions: [IconButton(tooltip: l.settings, icon: const Icon(Icons.settings_outlined), onPressed: () => context.push('/settings'))]),
      body: ref.watch(meProvider).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(meProvider)),
            data: (me) {
              final profile = me['profile'] as Map<String, dynamic>;
              final stats = me['stats'] as Map<String, dynamic>;
              final records = ref.watch(recordsProvider).valueOrNull ?? const [];
              return ListView(padding: const EdgeInsets.all(16), children: [
                Center(child: AvatarBadge(name: profile['fullName'] as String, division: stats['division'] as String?, size: 96)),
                const SizedBox(height: 12),
                Center(child: Text(profile['fullName'] as String, style: AppTheme.display(context, size: 30))),
                Center(
                  child: Text('@${me['username']} · ${l.level(stats['level'] as int)}${stats['division'] == null ? '' : ' · ${stats['division']}'}',
                      style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.outline)),
                ),
                const SizedBox(height: 12),
                if (profile['gym'] != null)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.fitness_center_rounded),
                      title: Text((profile['gym'] as Map)['name'] as String),
                      trailing: const Icon(Icons.chevron_right_rounded),
                      onTap: () => context.push('/gyms/${(profile['gym'] as Map)['id']}'),
                    ),
                  )
                else
                  Card(child: ListTile(leading: const Icon(Icons.storefront_outlined), title: Text(l.findGym), onTap: () => context.push('/gyms'))),
                const SizedBox(height: 8),
                // Gyms I submitted that are not verified yet (verified ones show as "my gym" above).
                for (final g in (ref.watch(myGymsProvider).valueOrNull ?? const <Map<String, dynamic>>[]).where((g) => g['status'] != 'VERIFIED'))
                  Card(
                    child: ListTile(
                      leading: GymLogo(name: g['name'] as String, url: g['logoUrl'] as String?, size: 40),
                      title: Text(g['name'] as String),
                      subtitle: Text(g['status'] == 'REJECTED' ? l.gymRejected : l.gymPending),
                      trailing: Icon(g['status'] == 'REJECTED' ? Icons.cancel_outlined : Icons.hourglass_top_rounded),
                    ),
                  ),
                ListTile(leading: const Icon(Icons.add_business_outlined), title: Text(l.addMyGym), onTap: () => context.push('/gyms/new')),
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
                ListTile(leading: const Icon(Icons.group_outlined), title: Text(l.friends), onTap: () => context.push('/friends')),
                ListTile(leading: const Icon(Icons.sports_mma_outlined), title: Text(l.battles), onTap: () => context.push('/battles')),
                ListTile(leading: const Icon(Icons.monitor_weight_outlined), title: Text(l.body), onTap: () => context.push('/me/body')),
                ListTile(leading: const Icon(Icons.settings_outlined), title: Text(l.settings), onTap: () => context.push('/settings')),
              ]);
            },
          ),
    );
  }
}
