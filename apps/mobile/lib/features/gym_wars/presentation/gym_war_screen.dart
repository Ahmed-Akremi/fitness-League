import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/countdown_text.dart';
import '../../../core/widgets/gym_logo.dart';
import '../../../core/widgets/skeleton.dart';
import '../data/gym_wars_repository.dart';

/// One Gym War: both gyms side by side, live or final scores and what makes them (docs §6.2).
class GymWarScreen extends ConsumerWidget {
  const GymWarScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final war = ref.watch(gymWarProvider(id));
    return Scaffold(
      appBar: AppBar(title: Text(l.gymWar)),
      body: war.when(
        data: (w) => RefreshIndicator(onRefresh: () => ref.refresh(gymWarProvider(id).future), child: GymWarView(war: w)),
        loading: () => const SkeletonList(count: 3, height: 120),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(gymWarProvider(id))),
      ),
    );
  }
}

class GymWarView extends StatelessWidget {
  const GymWarView({super.key, required this.war});
  final Map<String, dynamic> war;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    // My gym on the start side.
    final gyms = [...(war['gyms'] as List).cast<Map<String, dynamic>>()]..sort((a, b) => (b['isMine'] == true ? 1 : 0) - (a['isMine'] == true ? 1 : 0));
    final status = war['status'] as String;
    final mine = gyms.first;
    final outcome = mine['isMine'] == true ? mine['outcome'] as String? : null;

    if (status == 'BYE') {
      return ListView(padding: const EdgeInsets.all(16), children: [
        _GymSide(gym: mine),
        const SizedBox(height: 16),
        Center(child: Text(l.gymWarBye, textAlign: TextAlign.center, style: t.textTheme.titleMedium)),
      ]);
    }
    final them = gyms.last;
    num score(Map<String, dynamic> g) => (g['score'] as num?) ?? 0;
    final total = score(mine) + score(them);
    Widget row(String left, String label, String right) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(children: [
            SizedBox(width: 56, child: Text(left, style: t.textTheme.titleMedium)),
            Expanded(child: Text(label, textAlign: TextAlign.center, style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.outline))),
            SizedBox(width: 56, child: Text(right, textAlign: TextAlign.end, style: t.textTheme.titleMedium)),
          ]),
        );
    String part(Map<String, dynamic> g, String key) {
      final v = (g['breakdown'] as Map?)?[key] as num?;
      return v == null ? '—' : v.toStringAsFixed(0);
    }

    return ListView(padding: const EdgeInsets.all(16), children: [
      Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 12),
          child: Column(children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(child: _GymSide(gym: mine)),
              Padding(padding: const EdgeInsets.only(top: 28), child: Text(l.vs, style: AppTheme.display(context, size: 28).copyWith(color: t.colorScheme.primary))),
              Expanded(child: _GymSide(gym: them)),
            ]),
            const SizedBox(height: 16),
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: LinearProgressIndicator(value: total == 0 ? 0.5 : score(mine) / total, minHeight: 10, backgroundColor: t.colorScheme.surfaceContainerHighest),
            ),
          ]),
        ),
      ),
      const SizedBox(height: 12),
      if (status == 'ACTIVE') Center(child: CountdownText(endsAt: DateTime.parse(war['endsAt'] as String), style: t.textTheme.titleMedium)),
      if (outcome != null)
        Center(
          child: Text(
            switch (outcome) { 'WIN' => l.gymWarWon, 'LOSS' => l.gymWarLost, _ => l.battleDraw },
            style: AppTheme.display(context, size: 36).copyWith(color: outcome == 'WIN' ? t.colorScheme.primary : null),
          ),
        ),
      const SizedBox(height: 16),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(children: [
            row(part(mine, 'topK'), l.gymWarTopK, part(them, 'topK')),
            row(part(mine, 'participation'), l.gymWarParticipation, part(them, 'participation')),
            row(part(mine, 'meanProgress'), l.componentProgress, part(them, 'meanProgress')),
            row(part(mine, 'consistency'), l.componentConsistency, part(them, 'consistency')),
            row('${mine['activeMembers']}/${mine['eligibleMembers']}', l.gymWarActiveMembers, '${them['activeMembers']}/${them['eligibleMembers']}'),
          ]),
        ),
      ),
      const SizedBox(height: 12),
      Text(l.gymWarExplain, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline)),
    ]);
  }
}

class _GymSide extends StatelessWidget {
  const _GymSide({required this.gym});
  final Map<String, dynamic> gym;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final s = gym['score'] as num?;
    final name = gym['name'] as String;
    return InkWell(
      onTap: () => context.push('/gyms/${gym['gymId']}'),
      child: Column(children: [
        GymLogo(name: name, url: gym['logoUrl'] as String?, size: 64),
        const SizedBox(height: 8),
        Text(name, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: t.textTheme.titleSmall),
        Text(localized(gym['city'], Localizations.localeOf(context).languageCode), style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline)),
        const SizedBox(height: 8),
        Text(s == null ? '—' : s.toStringAsFixed(1), style: AppTheme.display(context, size: 44)),
      ]),
    );
  }
}
