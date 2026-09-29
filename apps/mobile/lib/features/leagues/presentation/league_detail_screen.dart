import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/rank_row.dart';
import '../../../core/widgets/section_header.dart';
import '../../../core/widgets/skeleton.dart';
import '../data/leagues_repository.dart';
import 'leagues_tab.dart';

/// A league: invite code to share, ranking of its members, join / leave / delete.
class LeagueDetailScreen extends ConsumerStatefulWidget {
  const LeagueDetailScreen({super.key, required this.id});
  final String id;

  @override
  ConsumerState<LeagueDetailScreen> createState() => _LeagueDetailScreenState();
}

class _LeagueDetailScreenState extends ConsumerState<LeagueDetailScreen> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action, {bool pop = false}) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(leagueProvider(widget.id));
      ref.invalidate(leagueBoardProvider(widget.id));
      ref.invalidate(leaguesProvider);
      if (pop && mounted) await Navigator.of(context).maybePop();
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
    final repo = ref.read(leaguesRepositoryProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.privateLeague)),
      body: ref.watch(leagueProvider(widget.id)).when(
            loading: () => const SkeletonList(count: 3, height: 80),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(leagueProvider(widget.id))),
            data: (lg) {
              final code = lg['inviteCode'] as String?;
              final board = ref.watch(leagueBoardProvider(widget.id)).valueOrNull;
              final rows = ((board?['data'] as List?) ?? const []).cast<Map<String, dynamic>>();
              return RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(leagueBoardProvider(widget.id));
                  ref.invalidate(leagueProvider(widget.id));
                  await ref.read(leagueProvider(widget.id).future);
                },
                child: ListView(padding: const EdgeInsets.all(16), children: [
                  Text(lg['name'] as String, style: AppTheme.display(context, size: 30)),
                  Text(
                    '${leaguePresetLabel(l, lg['scoringPreset'] as String)} · ${l.membersOf(lg['members'] as int, lg['maxMembers'] as int)}',
                    style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.outline),
                  ),
                  if (code != null) ...[
                    const SizedBox(height: 12),
                    Card(
                      child: ListTile(
                        leading: const Icon(Icons.key_rounded),
                        title: Text(code, style: t.textTheme.titleLarge?.copyWith(letterSpacing: 3)),
                        subtitle: Text(l.leagueInviteHint),
                        trailing: IconButton(
                          tooltip: l.leagueCopyCode,
                          icon: const Icon(Icons.copy_rounded),
                          onPressed: () async {
                            await Clipboard.setData(ClipboardData(text: code));
                            if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.leagueCodeCopied)));
                          },
                        ),
                      ),
                    ),
                  ],
                  if (lg['isMember'] != true && lg['status'] != 'ENDED')
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: FilledButton(onPressed: _busy ? null : () => _run(() async => repo.join(widget.id)), child: Text(l.leagueJoin)),
                    ),
                  SectionHeader(title: l.leaderboard),
                  for (final r in rows)
                    RankRow(
                      rank: r['rank'] as int,
                      name: (r['fullName'] ?? r['username']) as String,
                      value: (r['points'] as num).toStringAsFixed((r['points'] as num) == (r['points'] as num).roundToDouble() ? 0 : 1),
                      subtitle: l.weeksCount(r['weeks'] as int),
                      highlight: r['isMe'] == true,
                    ),
                  const SizedBox(height: 16),
                  if (lg['myRole'] == 'MEMBER') OutlinedButton(onPressed: _busy ? null : () => _run(() => repo.leave(widget.id), pop: true), child: Text(l.leagueLeave)),
                  if (lg['myRole'] == 'OWNER') TextButton(onPressed: _busy ? null : () => _run(() => repo.remove(widget.id), pop: true), child: Text(l.delete)),
                ]),
              );
            },
          ),
    );
  }
}
