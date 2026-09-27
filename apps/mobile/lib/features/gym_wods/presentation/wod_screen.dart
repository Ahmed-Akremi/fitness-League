import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/avatar_badge.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/countdown_text.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/rank_row.dart';
import '../../../core/widgets/skeleton.dart';
import '../../gyms/data/gyms_repository.dart';
import '../data/gym_wods_repository.dart';
import 'wod_score_sheet.dart';

/// A gym WOD: description, countdown, my score, Rx/Scaled boards; coaches invalidate with a long press.
class WodScreen extends ConsumerStatefulWidget {
  const WodScreen({super.key, required this.gymId, required this.wodId, required this.myId});
  final String gymId;
  final String wodId;
  final String myId;

  @override
  ConsumerState<WodScreen> createState() => _WodScreenState();
}

class _WodScreenState extends ConsumerState<WodScreen> {
  int _boardVersion = 0;

  (String, String) get _key => (widget.gymId, widget.wodId);

  void _refresh() {
    ref.invalidate(wodProvider(_key));
    ref.invalidate(gymWodsProvider);
    setState(() => _boardVersion++);
  }

  Future<void> _openScoreSheet(Map<String, dynamic> wod) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => WodScoreSheet(wod: wod, onSubmit: (body) => ref.read(gymWodsRepositoryProvider).submit(widget.gymId, widget.wodId, body)),
    );
    if (mounted) _refresh();
  }

  Future<void> _publish() async {
    try {
      await ref.read(gymWodsRepositoryProvider).update(widget.gymId, widget.wodId, {'status': 'PUBLISHED'});
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    }
    if (mounted) _refresh();
  }

  Future<void> _invalidate(Map<String, dynamic> row) async {
    final l = context.l10n;
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setLocal) => AlertDialog(
          title: Text(l.invalidate),
          content: TextField(
            key: const Key('invalidate-reason'),
            controller: reason,
            maxLength: 300,
            decoration: InputDecoration(labelText: l.invalidateReason),
            onChanged: (_) => setLocal(() {}),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.cancel)),
            FilledButton(onPressed: reason.text.trim().length >= 3 ? () => Navigator.pop(c, true) : null, child: Text(l.invalidate)),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(gymWodsRepositoryProvider).invalidate(widget.gymId, widget.wodId, row['scoreId'] as String, reason.text.trim());
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    }
    if (mounted) _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final wod = ref.watch(wodProvider(_key));
    final gym = ref.watch(gymProvider(widget.gymId)).valueOrNull;
    final isCoach = (gym?['myMembership'] as Map?)?['role'] == 'COACH' || gym?['canManage'] == true;
    return wod.when(
      loading: () => Scaffold(appBar: AppBar(), body: const SkeletonList(count: 5)),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorView(error: e, onRetry: _refresh)),
      data: (w) => _body(context, w, isCoach),
    );
  }

  Widget _body(BuildContext context, Map<String, dynamic> w, bool isCoach) {
    final l = context.l10n;
    final t = Theme.of(context);
    final type = w['scoreType'] as String;
    final mine = (w['myScore'] as Map?)?.cast<String, dynamic>();
    final typeLabel = switch (type) { 'FOR_TIME' => l.forTime, 'AMRAP' => l.amrap, _ => l.maxLoad };
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(title: Text(l.gymWods)),
        bottomNavigationBar: isCoach && w['status'] == 'DRAFT'
            ? SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                  child: FilledButton.icon(onPressed: _publish, icon: const Icon(Icons.publish_rounded), label: Text(l.wodPublish)),
                ),
              )
            : w['isOpen'] == true
            ? SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 12), child: FilledButton.icon(onPressed: () => _openScoreSheet(w), icon: const Icon(Icons.edit_note_rounded), label: Text(l.wodSubmitScore))))
            : null,
        body: NestedScrollView(
          headerSliverBuilder: (context, _) => [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(w['title'] as String, style: AppTheme.display(context, size: 34)),
                  if (w['status'] == 'DRAFT') Padding(padding: const EdgeInsets.only(top: 6), child: Chip(avatar: const Icon(Icons.edit_note_rounded, size: 16), label: Text(l.wodDraftBadge))),
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, runSpacing: 6, children: [
                    Chip(avatar: const Icon(Icons.bolt_rounded, size: 16), label: Text(typeLabel)),
                    if (w['timeCapS'] != null) Chip(avatar: const Icon(Icons.timer_outlined, size: 16), label: Text('Cap ${formatDuration(w['timeCapS'] as int)}')),
                    Chip(avatar: const Icon(Icons.hourglass_bottom_rounded, size: 16), label: CountdownText(endsAt: DateTime.parse(w['endsAt'] as String))),
                  ]),
                  const SizedBox(height: 12),
                  Card(child: Padding(padding: const EdgeInsets.all(16), child: SelectableText(w['description'] as String, style: t.textTheme.bodyLarge))),
                  if (mine != null) ...[
                    const SizedBox(height: 12),
                    Card(
                      color: mine['status'] == 'INVALIDATED' ? t.colorScheme.errorContainer : t.colorScheme.primary.withValues(alpha: 0.12),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Row(children: [
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(l.wodMyScore.toUpperCase(), style: t.textTheme.labelMedium),
                              if (mine['status'] == 'INVALIDATED') Text(l.wodInvalidated((mine['invalidationReason'] ?? '') as String), style: t.textTheme.bodySmall),
                            ]),
                          ),
                          Text(formatWodScore(type, mine), style: AppTheme.display(context, size: 30)),
                          const SizedBox(width: 8),
                          Text(mine['division'] == 'SCALED' ? l.scaled : 'Rx', style: t.textTheme.labelLarge),
                        ]),
                      ),
                    ),
                  ],
                  const SizedBox(height: 8),
                ]),
              ),
            ),
            SliverToBoxAdapter(child: TabBar(tabs: [const Tab(text: 'Rx'), Tab(text: l.scaled)])),
          ],
          body: TabBarView(children: [
            for (final division in const ['RX', 'SCALED'])
              _Board(key: ValueKey('$division-$_boardVersion'), gymId: widget.gymId, wodId: widget.wodId, division: division, scoreType: type, myId: widget.myId, onLongPress: isCoach ? _invalidate : null),
          ]),
        ),
      ),
    );
  }
}

class _Board extends ConsumerStatefulWidget {
  const _Board({super.key, required this.gymId, required this.wodId, required this.division, required this.scoreType, required this.myId, this.onLongPress});
  final String gymId;
  final String wodId;
  final String division;
  final String scoreType;
  final String myId;
  final void Function(Map<String, dynamic> row)? onLongPress;

  @override
  ConsumerState<_Board> createState() => _BoardState();
}

class _BoardState extends ConsumerState<_Board> {
  late final Future<Map<String, dynamic>> _page = ref.read(gymWodsRepositoryProvider).board(widget.gymId, widget.wodId, division: widget.division);

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return FutureBuilder<Map<String, dynamic>>(
      future: _page,
      builder: (context, snap) => AsyncBody<Map<String, dynamic>>(
        snapshot: snap,
        error: (e, _) => ErrorView(error: e),
        builder: (page) {
          final rows = (page['data'] as List).cast<Map<String, dynamic>>();
          if (rows.isEmpty) return EmptyState(icon: Icons.leaderboard_outlined, message: l.wodNoScores);
          return ListView(padding: const EdgeInsets.fromLTRB(8, 8, 8, 24), children: [
            for (final r in rows)
              RankRow(
                rank: r['rank'] as int,
                name: ((r['athlete'] as Map)['fullName'] ?? (r['athlete'] as Map)['username']) as String,
                value: formatWodScore(widget.scoreType, r),
                highlight: (r['athlete'] as Map)['id'] == widget.myId,
                leading: AvatarBadge(name: ((r['athlete'] as Map)['fullName'] ?? (r['athlete'] as Map)['username']) as String, size: 40),
                onLongPress: widget.onLongPress == null ? null : () => widget.onLongPress!(r),
              ),
          ]);
        },
      ),
    );
  }
}
