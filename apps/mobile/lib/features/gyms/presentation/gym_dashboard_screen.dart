import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/providers.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/rank_row.dart';
import '../../../core/widgets/section_header.dart';
import '../../../core/widgets/skeleton.dart';

final gymDashboardProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, id) => ref.watch(apiClientProvider).get<Map<String, dynamic>>('/gyms/$id/dashboard'));

/// Gym admin dashboard (docs §4.5 P3): members, activity, weekly trend, progress, who needs a nudge, WODs, wars.
class GymDashboardScreen extends ConsumerWidget {
  const GymDashboardScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.gymDashboard)),
      body: ref.watch(gymDashboardProvider(id)).when(
            loading: () => const SkeletonList(count: 4, height: 100),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(gymDashboardProvider(id))),
            data: (d) {
              final m = (d['members'] as Map).cast<String, dynamic>();
              final trend = (d['trend'] as List).cast<Map<String, dynamic>>();
              final top = (d['topProgress'] as List).cast<Map<String, dynamic>>();
              final nudge = (d['toNudge'] as List).cast<Map<String, dynamic>>();
              final wods = (d['wods'] as List).cast<Map<String, dynamic>>();
              final wars = (d['wars'] as Map).cast<String, dynamic>();
              final maxActive = trend.fold<int>(1, (a, w) => (w['activeMembers'] as int) > a ? w['activeMembers'] as int : a);
              Widget stat(String label, Object value) => Expanded(child: StatCard(label: label, child: Text('$value', style: AppTheme.display(context, size: 28))));
              return RefreshIndicator(
                onRefresh: () => ref.refresh(gymDashboardProvider(id).future),
                child: ListView(padding: const EdgeInsets.all(16), children: [
                  Row(children: [stat(l.gymMembersLabel, m['approved'] as int), const SizedBox(width: 8), stat(l.dashboardPending, m['pending'] as int)]),
                  const SizedBox(height: 8),
                  Row(children: [stat(l.dashboardActive7, m['activeLast7Days'] as int), const SizedBox(width: 8), stat(l.dashboardActive28, m['activeLast28Days'] as int)]),
                  SectionHeader(title: l.dashboardTrend),
                  SizedBox(
                    height: 120,
                    child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                      for (final w in trend)
                        Expanded(
                          child: Tooltip(
                            message: '${w['weekStart']} · ${w['activeMembers']} · ${w['meanScore'] ?? '—'}',
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 3),
                              child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                                Text('${w['activeMembers']}', style: t.textTheme.labelSmall),
                                const SizedBox(height: 2),
                                Container(height: 80 * (w['activeMembers'] as int) / maxActive + 2, decoration: BoxDecoration(color: t.colorScheme.primary, borderRadius: BorderRadius.circular(4))),
                              ]),
                            ),
                          ),
                        ),
                    ]),
                  ),
                  if (top.isNotEmpty) ...[
                    SectionHeader(title: l.dashboardTopProgress),
                    for (final (i, p) in top.indexed) RankRow(rank: i + 1, name: (p['name'] ?? '') as String, value: (p['progress'] as num).toStringAsFixed(0)),
                  ],
                  SectionHeader(title: l.dashboardToNudge),
                  if (nudge.isEmpty) Text(l.dashboardNobodyToNudge, style: t.textTheme.bodyMedium),
                  for (final n in nudge)
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.notifications_paused_outlined),
                      title: Text((n['name'] ?? '') as String),
                      subtitle: Text(n['lastWorkoutAt'] == null ? l.dashboardNeverTrained : MaterialLocalizations.of(context).formatMediumDate(DateTime.parse(n['lastWorkoutAt'] as String).toLocal())),
                    ),
                  if (wods.isNotEmpty) ...[
                    SectionHeader(title: l.gymWods),
                    for (final w in wods) ListTile(dense: true, title: Text(w['title'] as String), trailing: Text(l.dashboardScores(w['scores'] as int))),
                  ],
                  SectionHeader(title: l.gymWars),
                  Text(l.gymWarRecord(wars['wins'] as int, wars['losses'] as int, wars['draws'] as int), style: t.textTheme.titleMedium),
                ]),
              );
            },
          ),
    );
  }
}
