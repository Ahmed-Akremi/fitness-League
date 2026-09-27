import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/section_header.dart';
import '../../../core/widgets/skeleton.dart';
import '../data/progress_repository.dart';

/// Personal records grouped as timed (WODs, Hyrox, runs), strength and other.
class RecordsScreen extends ConsumerWidget {
  const RecordsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    return Scaffold(
      appBar: AppBar(title: Text(l.records)),
      body: ref.watch(recordsProvider).when(
            loading: () => const SkeletonList(),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(recordsProvider)),
            data: (rows) {
              if (rows.isEmpty) return EmptyState(icon: Icons.emoji_events_outlined, message: l.noRecords);
              String unit(Map r) => (r['metric'] as Map)['unit'] as String;
              final groups = <String, List<Map<String, dynamic>>>{
                l.recordsTimed: rows.where((r) => unit(r) == 's' || unit(r) == 's_per_km').toList(),
                l.recordsStrength: rows.where((r) => unit(r) == 'kg').toList(),
                l.recordsOther: rows.where((r) => !const ['s', 's_per_km', 'kg'].contains(unit(r))).toList(),
              };
              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(recordsProvider),
                child: ListView(padding: const EdgeInsets.fromLTRB(12, 0, 12, 24), children: [
                  for (final g in groups.entries)
                    if (g.value.isNotEmpty) ...[
                      SectionHeader(title: g.key),
                      for (final r in g.value)
                        Card(
                          margin: const EdgeInsets.only(bottom: 8),
                          child: ListTile(
                            leading: Icon(unit(r) == 'kg' ? Icons.fitness_center_rounded : Icons.timer_outlined, color: t.colorScheme.primary),
                            title: Text(localized((r['exercise'] as Map)['name'], locale), style: t.textTheme.titleMedium),
                            subtitle: Text(
                              r['previousValue'] == null
                                  ? MaterialLocalizations.of(context).formatMediumDate(DateTime.parse(r['achievedAt'] as String))
                                  : l.recordPrevious(formatMetric(r['previousValue'] as num, unit(r), locale)),
                            ),
                            trailing: Text(formatMetric(r['value'] as num, unit(r), locale), style: AppTheme.display(context, size: 24)),
                          ),
                        ),
                    ],
                ]),
              );
            },
          ),
    );
  }
}
