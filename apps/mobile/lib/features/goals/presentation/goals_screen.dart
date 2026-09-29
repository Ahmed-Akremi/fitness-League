import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../home/data/me_repository.dart';
import '../../onboarding/data/reference_repository.dart';
import '../data/goals_repository.dart';

/// Personal goals; `embedded` in the Challenges tab (no app bar of its own).
class GoalsScreen extends ConsumerWidget {
  const GoalsScreen({super.key, this.embedded = false});
  final bool embedded;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    return Scaffold(
      appBar: embedded ? null : AppBar(title: Text(l.goals)),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('goals-new'),
        onPressed: () => showModalBottomSheet(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => const NewGoalSheet()),
        icon: const Icon(Icons.flag_rounded),
        label: Text(l.newGoal),
      ),
      body: ref.watch(goalsProvider).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(goalsProvider)),
            data: (goals) {
              return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
                if (goals.isEmpty) EmptyState(icon: Icons.flag_rounded, message: l.emptyGoals),
                for (final g in goals)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: StatCard(
                      label: '${g['type']} · ${(g['metric'] as Map)['code']}',
                      trailing: g['status'] == 'ACTIVE'
                          ? IconButton(
                              tooltip: l.delete,
                              icon: const Icon(Icons.close_rounded),
                              onPressed: () async {
                                await ref.read(goalsRepositoryProvider).abandon(g['id'] as String);
                                ref.invalidate(goalsProvider);
                              },
                            )
                          : Chip(label: Text(g['status'] as String)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(
                          '${formatMetric(g['startValue'] as num, (g['metric'] as Map)['unit'] as String, locale)} → ${formatMetric(g['targetValue'] as num, (g['metric'] as Map)['unit'] as String, locale)}',
                          style: t.textTheme.headlineMedium,
                        ),
                        const SizedBox(height: 8),
                        XpBar(value: (g['milestones'] as List).isEmpty ? 0 : (g['milestonesReached'] as int) / (g['milestones'] as List).length),
                        const SizedBox(height: 6),
                        Text(l.goalMilestones(g['milestonesReached'] as int, (g['milestones'] as List).length), style: t.textTheme.bodySmall),
                      ]),
                    ),
                  ),
                const SizedBox(height: 12),
                Text(l.challengesComingSoon, textAlign: TextAlign.center, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline)),
              ]);
            },
          ),
    );
  }
}

/// Strength goal from suggestions (spec §10). The disclaimer is shown once here, as the spec asks.
class NewGoalSheet extends ConsumerStatefulWidget {
  const NewGoalSheet({super.key});

  @override
  ConsumerState<NewGoalSheet> createState() => _NewGoalSheetState();
}

class _NewGoalSheetState extends ConsumerState<NewGoalSheet> {
  String? _exerciseId;
  Map<String, dynamic>? _suggestions;
  Object? _error;
  bool _busy = false;

  Future<void> _loadSuggestions(String exerciseId) async {
    setState(() {
      _exerciseId = exerciseId;
      _suggestions = null;
      _error = null;
    });
    try {
      final s = await ref.read(goalsRepositoryProvider).suggestions('STRENGTH', exerciseId, 'E1RM');
      setState(() => _suggestions = s);
    } catch (e) {
      setState(() => _error = e);
    }
  }

  Future<void> _create(num target) async {
    setState(() => _busy = true);
    try {
      await ref.read(goalsRepositoryProvider).create({'type': 'STRENGTH', 'exerciseId': _exerciseId, 'metricCode': 'E1RM', 'targetValue': target, 'wasSuggested': true});
      ref.invalidate(goalsProvider);
      if (mounted) Navigator.pop(context);
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
    final primary = ((ref.watch(meProvider).valueOrNull?['profile'] as Map?)?['sports'] as List?)?.cast<Map>().where((s) => s['isPrimary'] == true).firstOrNull;
    final sportId = primary?['id'] as String?;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(l.newGoal, style: t.textTheme.titleLarge),
        const SizedBox(height: 12),
        if (sportId != null)
          ref.watch(exercisesProvider(sportId)).when(
                data: (list) => DropdownButtonFormField<String>(
                  initialValue: _exerciseId,
                  decoration: InputDecoration(labelText: l.exercise),
                  items: [
                    for (final e in list.where((e) => (e['trackedMetrics'] as List).contains('E1RM')))
                      DropdownMenuItem(value: e['id'] as String, child: Text(localized(e['name'], locale))),
                  ],
                  onChanged: (v) => v == null ? null : _loadSuggestions(v),
                ),
                loading: () => const LinearProgressIndicator(),
                error: (e, _) => ErrorView(error: e),
              ),
        const SizedBox(height: 12),
        if (_suggestions != null) ...[
          Text(l.goalSuggestions, style: t.textTheme.titleMedium),
          for (final s in (_suggestions!['suggestions'] as List).cast<Map<String, dynamic>>())
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(formatMetric(s['targetValue'] as num, 'kg', locale), style: t.textTheme.titleLarge),
              subtitle: Text(l.goalEta((s['etaWeeks'] as Map)['min'] as int, (s['etaWeeks'] as Map)['max'] as int)),
              trailing: FilledButton.tonal(onPressed: _busy ? null : () => _create(s['targetValue'] as num), child: Text(l.save)),
            ),
          const SizedBox(height: 8),
          Text(l.goalsDisclaimer, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline)),
        ],
        if (_error != null) Text(errorMessage(context, _error!), style: TextStyle(color: t.colorScheme.error)),
      ]),
    );
  }
}
