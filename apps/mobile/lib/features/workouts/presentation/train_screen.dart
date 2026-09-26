import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/offline/outbox.dart';
import '../../../core/providers.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../data/workouts_repository.dart';

/// Train tab: history (newest first), workouts waiting for sync, and the way to "My progress".
class TrainScreen extends ConsumerWidget {
  const TrainScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final workouts = ref.watch(workoutsProvider);
    final pending = ref.watch(pendingWorkoutsProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l.navTrain),
        actions: [IconButton(tooltip: l.myProgress, onPressed: () => context.push('/progress'), icon: const Icon(Icons.insights_rounded))],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('train-log'),
        onPressed: () => context.push('/workouts/new'),
        icon: const Icon(Icons.add_rounded),
        label: Text(l.logWorkout),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(workoutSyncProvider).flush().catchError((_) => 0);
          ref.invalidate(pendingWorkoutsProvider);
          ref.invalidate(workoutsProvider);
        },
        child: workouts.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [ErrorView(error: e, onRetry: () => ref.invalidate(workoutsProvider))]),
          data: (page) {
            final items = (page['data'] as List).cast<Map<String, dynamic>>();
            final queued = pending.valueOrNull ?? const <OutboxItem>[];
            if (items.isEmpty && queued.isEmpty) {
              return ListView(children: [
                SizedBox(height: MediaQuery.of(context).size.height * 0.2),
                EmptyState(icon: Icons.fitness_center_rounded, message: l.emptyWorkouts, actionLabel: l.logWorkout, onAction: () => context.push('/workouts/new')),
              ]);
            }
            return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
              for (final q in queued)
                Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  child: ListTile(
                    leading: Icon(q.status == OutboxStatus.pending ? Icons.cloud_upload_rounded : Icons.error_outline_rounded),
                    title: Text(MaterialLocalizations.of(context).formatMediumDate(DateTime.parse(q.payload['performedAt'] as String).toLocal())),
                    subtitle: Text(q.status == OutboxStatus.pending ? l.pendingSync : (q.status == OutboxStatus.rejected ? l.statusRejected : l.errorGeneric)),
                    trailing: q.status == OutboxStatus.pending
                        ? null
                        : IconButton(
                            tooltip: l.delete,
                            icon: const Icon(Icons.delete_outline_rounded),
                            onPressed: () async {
                              await ref.read(workoutSyncProvider).discard(q.clientId);
                              ref.invalidate(pendingWorkoutsProvider);
                            },
                          ),
                  ),
                ),
              for (final w in items) _WorkoutTile(workout: w),
            ]);
          },
        ),
      ),
    );
  }
}

class _WorkoutTile extends StatelessWidget {
  const _WorkoutTile({required this.workout});
  final Map<String, dynamic> workout;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final status = workout['status'] as String;
    final when = DateTime.parse(workout['performedAt'] as String).toLocal();
    final (label, color) = switch (status) {
      'ACCEPTED' => (l.statusAccepted, t.colorScheme.primary),
      'HELD_FOR_REVIEW' => (l.statusHeld, const Color(0xFFFFB020)),
      _ => (l.statusRejected, t.colorScheme.error),
    };
    final volume = workout['totalVolumeKg'] as num?;
    final distance = workout['totalDistanceM'] as num?;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        onTap: () => context.push('/workouts/${workout['id']}'),
        title: Text('${MaterialLocalizations.of(context).formatMediumDate(when)} · ${formatDuration(workout['durationS'] as int)}'),
        subtitle: Text([
          if (volume != null && volume > 0) '${formatNumber(volume, Localizations.localeOf(context).languageCode)} kg',
          if (distance != null && distance > 0) formatMetric(distance, 'm', Localizations.localeOf(context).languageCode),
        ].join(' · ')),
        trailing: Chip(label: Text(label), side: BorderSide(color: color), labelStyle: TextStyle(color: color, fontWeight: FontWeight.w700)),
      ),
    );
  }
}
