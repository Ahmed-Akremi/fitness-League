import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/countdown_text.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/rank_row.dart';
import '../../../core/widgets/section_header.dart';
import '../../../core/widgets/skeleton.dart';
import '../../home/data/me_repository.dart';
import '../data/challenges_repository.dart';
import 'challenges_screen.dart';

/// One challenge: target, my progress, join / leave, leaderboard.
class ChallengeScreen extends ConsumerStatefulWidget {
  const ChallengeScreen({super.key, required this.id});
  final String id;

  @override
  ConsumerState<ChallengeScreen> createState() => _ChallengeScreenState();
}

class _ChallengeScreenState extends ConsumerState<ChallengeScreen> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(challengeProvider(widget.id));
      ref.invalidate(challengesProvider);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final challenge = ref.watch(challengeProvider(widget.id));
    final myId = ref.watch(meProvider).valueOrNull?['id'];
    return Scaffold(
      appBar: AppBar(title: Text(l.challengeDetail)),
      body: challenge.when(
        loading: () => const SkeletonList(count: 3, height: 96),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(challengeProvider(widget.id))),
        data: (c) {
          final repo = ref.read(challengesRepositoryProvider);
          final target = c['target'] as num;
          final mine = c['myProgress'] as num?;
          final joined = c['joined'] == true;
          final open = c['status'] == 'ACTIVE' || c['status'] == 'UPCOMING';
          final isAuthor = c['createdById'] == myId;
          final selfMade = c['scope'] == 'PERSONAL' || c['scope'] == 'FRIEND';
          final board = (c['leaderboard'] as List).cast<Map<String, dynamic>>();
          return RefreshIndicator(
            onRefresh: () => ref.refresh(challengeProvider(widget.id).future),
            child: ListView(padding: const EdgeInsets.all(16), children: [
              Text(c['title'] as String, style: AppTheme.display(context, size: 30)),
              const SizedBox(height: 4),
              Text(
                '${challengeScopeLabel(l, c['scope'] as String)}${c['gym'] == null ? '' : ' · ${(c['gym'] as Map)['name']}'}',
                style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.outline),
              ),
              if (c['description'] != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(c['description'] as String)),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(l.challengeGoal(fmtAmount(target), challengeMetricLabel(l, c['metric'] as String)), style: t.textTheme.titleMedium),
                    if ((c['xpReward'] as int) > 0) Text(l.challengeXp(c['xpReward'] as int), style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.primary)),
                    if (mine != null) ...[
                      const SizedBox(height: 12),
                      ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(value: (mine / target).clamp(0, 1).toDouble(), minHeight: 10)),
                      const SizedBox(height: 6),
                      Text(c['completedAt'] != null ? l.challengeCompleted : '${fmtAmount(mine)} / ${fmtAmount(target)}', style: t.textTheme.titleSmall),
                    ],
                    if (c['status'] == 'ACTIVE') Padding(padding: const EdgeInsets.only(top: 8), child: CountdownText(endsAt: DateTime.parse(c['endsAt'] as String))),
                  ]),
                ),
              ),
              const SizedBox(height: 12),
              if (open && !joined && c['scope'] != 'PERSONAL') FilledButton(onPressed: _busy ? null : () => _run(() async => repo.join(widget.id)), child: Text(l.challengeJoin)),
              if (open && joined && !(isAuthor && selfMade) && c['completedAt'] == null)
                OutlinedButton(onPressed: _busy ? null : () => _run(() async => repo.leave(widget.id)), child: Text(l.challengeLeave)),
              if (isAuthor)
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => _run(() async {
                            await repo.remove(widget.id);
                            if (context.mounted) await Navigator.of(context).maybePop();
                          }),
                  child: Text(l.delete),
                ),
              if (board.isNotEmpty) ...[
                SectionHeader(title: l.leaderboard),
                for (final p in board)
                  RankRow(
                    rank: p['rank'] as int,
                    name: (p['fullName'] ?? p['username']) as String,
                    value: p['completed'] == true ? '✓ ${fmtAmount(p['progress'] as num)}' : fmtAmount(p['progress'] as num),
                    highlight: p['userId'] == myId,
                  ),
              ],
            ]),
          );
        },
      ),
    );
  }
}
