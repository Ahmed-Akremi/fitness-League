import 'package:flutter/material.dart';
import 'proofs_section.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../data/workouts_repository.dart';

/// Workout details and "why did I get these points" (spec §9.1 explainability).
class WorkoutDetailScreen extends ConsumerWidget {
  const WorkoutDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    return Scaffold(
      appBar: AppBar(),
      body: ref.watch(workoutDetailProvider(id)).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(workoutDetailProvider(id))),
            data: (d) {
              final (w, points) = d;
              final entries = (points['entries'] as List).cast<Map<String, dynamic>>();
              return ListView(padding: const EdgeInsets.all(20), children: [
                Text(MaterialLocalizations.of(context).formatFullDate(DateTime.parse(w['performedAt'] as String).toLocal()), style: t.textTheme.titleLarge),
                const SizedBox(height: 4),
                Text(formatDuration(w['durationS'] as int), style: t.textTheme.bodyMedium),
                if (w['status'] == 'HELD_FOR_REVIEW') ...[
                  const SizedBox(height: 12),
                  Card(child: ListTile(leading: const Icon(Icons.hourglass_top_rounded), title: Text(l.workoutHeldInfo))),
                ],
                const SizedBox(height: 16),
                for (final e in (w['exercises'] as List).cast<Map<String, dynamic>>())
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: StatCard(
                      label: l.exercise,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        for (final s in (e['sets'] as List).cast<Map<String, dynamic>>())
                          Text([
                            if (s['reps'] != null) '${s['reps']} ×',
                            if (s['weightKg'] != null) '${formatNumber(s['weightKg'] as num, locale)} kg',
                            if (s['distanceM'] != null) formatMetric(s['distanceM'] as num, 'm', locale),
                            if (s['durationS'] != null) formatDuration(s['durationS'] as int),
                            if (s['isWarmup'] == true) '(${l.warmup})',
                          ].join(' ')),
                      ]),
                    ),
                  ),
                if (w['status'] == 'ACCEPTED' || w['status'] == 'HELD_FOR_REVIEW') ProofsSection(workoutId: id),
                const SizedBox(height: 12),
                StatCard(
                  label: l.whyThesePoints,
                  trailing: Text(l.totalXp(points['totalXp'] as int), style: t.textTheme.titleMedium?.copyWith(color: t.colorScheme.primary)),
                  child: Column(children: [
                    for (final e in entries)
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(e['reason'] as String),
                        subtitle: Text(_explain(e['explanation'])),
                        trailing: Text('${(e['amount'] as int) > 0 ? '+' : ''}${e['amount']}', style: t.textTheme.titleMedium),
                      ),
                  ]),
                ),
              ]);
            },
          ),
    );
  }

  /// Renders the server's explanation steps compactly (e.g. "base 10 · duration_bonus 20 · diminishing ×1").
  static String _explain(Object? explanation) {
    if (explanation is! Map) return '';
    final steps = (explanation['steps'] as List?)?.whereType<Map>().map((s) => '${s['label']} ${s['value']}').join(' · ');
    final caps = (explanation['caps'] as List?)?.whereType<Map>().where((c) => c['applied'] == true).map((c) => '${c['label']} ${c['value']}').join(' · ');
    return [if (steps != null && steps.isNotEmpty) steps, if (caps != null && caps.isNotEmpty) caps, if (explanation['formula'] != null && (steps == null || steps.isEmpty)) '${explanation['formula']}'].join(' · ');
  }
}
