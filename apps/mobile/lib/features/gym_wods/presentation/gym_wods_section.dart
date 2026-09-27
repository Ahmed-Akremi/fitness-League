import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/countdown_text.dart';
import '../../../core/widgets/section_header.dart';
import '../data/gym_wods_repository.dart';

/// Gym profile section: the WODs running now (highlighted), past ones on demand. Members and coaches only.
class GymWodsSection extends ConsumerWidget {
  const GymWodsSection({super.key, required this.gymId, required this.isMember, required this.isCoach});
  final String gymId;
  final bool isMember;
  final bool isCoach;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context);
    final header = SectionHeader(title: l.gymWods, actionLabel: isCoach ? l.wodCreate : null, onAction: () => context.push('/gyms/$gymId/wods/new'));
    if (!isMember && !isCoach) {
      return Column(children: [
        header,
        Card(child: ListTile(leading: const Icon(Icons.lock_outline_rounded), title: Text(l.wodsMembersOnly))),
      ]);
    }
    final active = ref.watch(gymWodsProvider((gymId, 'active')));
    final wods = (active.valueOrNull?['data'] as List? ?? const []).cast<Map<String, dynamic>>();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      header,
      if (active.isLoading) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
      if (!active.isLoading && wods.isEmpty) Card(child: ListTile(leading: const Icon(Icons.event_busy_outlined), title: Text(l.wodNone))),
      for (final w in wods) WodCard(gymId: gymId, wod: w),
      if (isCoach)
        ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 4),
          title: Text(l.wodUpcoming, style: t.textTheme.titleSmall),
          children: [_WodList(gymId: gymId, when: 'upcoming')],
        ),
      ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: 4),
        title: Text(l.wodPast, style: t.textTheme.titleSmall),
        children: [_WodList(gymId: gymId, when: 'past')],
      ),
    ]);
  }
}

class _WodList extends ConsumerWidget {
  const _WodList({required this.gymId, required this.when});
  final String gymId;
  final String when;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final past = ref.watch(gymWodsProvider((gymId, when)));
    final wods = (past.valueOrNull?['data'] as List? ?? const []).cast<Map<String, dynamic>>();
    if (past.isLoading) return const Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator());
    return Column(children: [for (final w in wods) WodCard(gymId: gymId, wod: w)]);
  }
}

/// Compact WOD card: title, countdown, my score (or "no score yet").
class WodCard extends StatelessWidget {
  const WodCard({super.key, required this.gymId, required this.wod});
  final String gymId;
  final Map<String, dynamic> wod;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final mine = (wod['myScore'] as Map?)?.cast<String, dynamic>();
    final open = wod['isOpen'] == true;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/gyms/$gymId/wods/${wod['id']}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(color: (open ? t.colorScheme.primary : t.colorScheme.outline).withValues(alpha: 0.18), borderRadius: BorderRadius.circular(12)),
              child: Icon(open ? Icons.local_fire_department_rounded : Icons.history_rounded, color: open ? t.colorScheme.primary : t.colorScheme.outline),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Flexible(child: Text(wod['title'] as String, style: t.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800), overflow: TextOverflow.ellipsis)),
                  if (wod['status'] == 'DRAFT') Padding(padding: const EdgeInsetsDirectional.only(start: 6), child: _DraftBadge(label: l.wodDraftBadge)),
                ]),
                CountdownText(endsAt: DateTime.parse(wod['endsAt'] as String), style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline)),
              ]),
            ),
            mine == null
                ? Text(l.wodNotScored, style: t.textTheme.bodySmall)
                : Text(formatWodScore(wod['scoreType'] as String, mine), style: AppTheme.display(context, size: 22)),
          ]),
        ),
      ),
    );
  }
}

class _DraftBadge extends StatelessWidget {
  const _DraftBadge({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: t.colorScheme.tertiaryContainer, borderRadius: BorderRadius.circular(8)),
      child: Text(label, style: t.textTheme.labelSmall?.copyWith(color: t.colorScheme.onTertiaryContainer, fontWeight: FontWeight.w800)),
    );
  }
}
