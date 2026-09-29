import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/countdown_text.dart';
import '../../../core/widgets/error_text.dart';
import '../../goals/presentation/goals_screen.dart';
import '../data/challenges_repository.dart';

/// Bottom-bar "Challenges" tab: challenges and personal goals.
class ChallengesTabScreen extends StatelessWidget {
  const ChallengesTabScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(title: Text(l.navChallenges), bottom: TabBar(tabs: [Tab(text: l.challenges), Tab(text: l.goals)])),
        body: const TabBarView(children: [ChallengesList(), GoalsScreen(embedded: true)]),
      ),
    );
  }
}

String challengeMetricLabel(AppLocalizations l, String metric) => switch (metric) {
      'WORKOUTS' => l.metricWorkouts,
      'TRAINING_DAYS' => l.metricTrainingDays,
      'DURATION_MIN' => l.metricDurationMin,
      'DISTANCE_KM' => l.metricDistanceKm,
      _ => l.metricVolumeKg,
    };

String challengeScopeLabel(AppLocalizations l, String scope) => switch (scope) {
      'PERSONAL' => l.scopePersonal,
      'FRIEND' => l.scopeFriends,
      'GYM' => l.scopeGym,
      _ => l.scopeCommunity,
    };

String fmtAmount(num v) => v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1);

class ChallengesList extends ConsumerStatefulWidget {
  const ChallengesList({super.key});

  @override
  ConsumerState<ChallengesList> createState() => _ChallengesListState();
}

class _ChallengesListState extends ConsumerState<ChallengesList> {
  bool _ended = false;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final rows = ref.watch(challengesProvider(_ended));
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(onPressed: () => context.push('/challenges/new'), icon: const Icon(Icons.add_rounded), label: Text(l.newChallenge)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(challengesProvider(_ended).future),
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 96), children: [
          SegmentedButton<bool>(
            segments: [ButtonSegment(value: false, label: Text(l.challengesActive)), ButtonSegment(value: true, label: Text(l.challengesEnded))],
            selected: {_ended},
            onSelectionChanged: (s) => setState(() => _ended = s.first),
          ),
          const SizedBox(height: 12),
          ...rows.when(
            loading: () => [const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))],
            error: (e, _) => [ErrorView(error: e, onRetry: () => ref.invalidate(challengesProvider(_ended)))],
            data: (list) => list.isEmpty ? [EmptyState(icon: Icons.flag_outlined, message: l.noChallenges)] : [for (final c in list) ChallengeCard(challenge: c)],
          ),
        ]),
      ),
    );
  }
}

class ChallengeCard extends StatelessWidget {
  const ChallengeCard({super.key, required this.challenge});
  final Map<String, dynamic> challenge;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final c = challenge;
    final target = c['target'] as num;
    final mine = c['myProgress'] as num?;
    final done = c['completedAt'] != null;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: () => context.push('/challenges/${c['id']}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(c['title'] as String, style: t.textTheme.titleMedium)),
              if (done) Icon(Icons.check_circle_rounded, color: t.colorScheme.primary, semanticLabel: l.challengeCompleted),
            ]),
            const SizedBox(height: 4),
            Text(
              '${challengeScopeLabel(l, c['scope'] as String)} · ${fmtAmount(target)} ${challengeMetricLabel(l, c['metric'] as String)} · ${l.participantsCount(c['participants'] as int)}',
              style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline),
            ),
            if (mine != null) ...[
              const SizedBox(height: 10),
              ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(value: (mine / target).clamp(0, 1).toDouble(), minHeight: 8)),
              const SizedBox(height: 4),
              Text('${fmtAmount(mine)} / ${fmtAmount(target)}', style: t.textTheme.labelMedium),
            ],
            if (c['status'] == 'ACTIVE') ...[
              const SizedBox(height: 6),
              CountdownText(endsAt: DateTime.parse(c['endsAt'] as String), style: t.textTheme.labelMedium?.copyWith(color: t.colorScheme.outline)),
            ],
          ]),
        ),
      ),
    );
  }
}
