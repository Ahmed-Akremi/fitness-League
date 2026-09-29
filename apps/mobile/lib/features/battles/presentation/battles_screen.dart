import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/countdown_text.dart';
import '../../../core/widgets/error_text.dart';
import '../../gym_wars/data/gym_wars_repository.dart';
import '../data/battles_repository.dart';

/// Battles by state: active, invites (pending), finished.
class BattlesScreen extends ConsumerWidget {
  const BattlesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(title: Text(l.battles), bottom: TabBar(tabs: [Tab(text: l.battlesActive), Tab(text: l.battlesInvites), Tab(text: l.battlesFinished)])),
        floatingActionButton: FloatingActionButton.extended(onPressed: () => context.push('/battles/new'), icon: const Icon(Icons.sports_mma_rounded), label: Text(l.newBattle)),
        body: const Column(children: [
          _DuelCard(),
          _GymWarCard(),
          Expanded(child: TabBarView(children: [_BattleList(status: 'ACTIVE'), _BattleList(status: 'PENDING'), _BattleList(status: 'COMPLETED')])),
        ]),
      ),
    );
  }
}

/// This week's Gym War of my primary gym, when there is one.
class _GymWarCard extends ConsumerWidget {
  const _GymWarCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final war = (ref.watch(currentGymWarProvider).valueOrNull?['war'] as Map?)?.cast<String, dynamic>();
    if (war == null || war['status'] == 'BYE') return const SizedBox.shrink();
    final l = context.l10n;
    final t = Theme.of(context);
    final gyms = (war['gyms'] as List).cast<Map<String, dynamic>>();
    final mine = gyms.firstWhere((g) => g['isMine'] == true, orElse: () => gyms.first);
    final them = gyms.firstWhere((g) => !identical(g, mine));
    String score(Map<String, dynamic> g) => (g['score'] as num?)?.toStringAsFixed(1) ?? '—';
    return Card(
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 0),
      child: ListTile(
        leading: Icon(Icons.shield_outlined, color: t.colorScheme.primary),
        title: Text(l.gymWarThisWeek),
        subtitle: Text('${mine['name']} ${score(mine)} – ${score(them)} ${them['name']}', maxLines: 1, overflow: TextOverflow.ellipsis),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: () => context.push('/gym-wars/${war['id']}'),
      ),
    );
  }
}

/// Weekly Duel: join or leave the queue, see the MMR and open the duel of the week (docs §6.1).
class _DuelCard extends ConsumerStatefulWidget {
  const _DuelCard();

  @override
  ConsumerState<_DuelCard> createState() => _DuelCardState();
}

class _DuelCardState extends ConsumerState<_DuelCard> {
  Map<String, dynamic>? _status;
  bool _busy = false;

  BattlesRepository get _repo => ref.read(battlesRepositoryProvider);

  @override
  void initState() {
    super.initState();
    _repo.duelStatus().then((s) {
      if (mounted) setState(() => _status = s);
    }).catchError((Object _) {}); // the card simply stays hidden
  }

  Future<void> _run(Future<Map<String, dynamic>> Function() call) async {
    setState(() => _busy = true);
    try {
      final s = await call();
      if (mounted) setState(() => _status = s);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _status;
    if (s == null) return const SizedBox.shrink();
    final l = context.l10n;
    final t = Theme.of(context);
    final rating = (s['rating'] as Map).cast<String, dynamic>();
    final duel = (s['currentDuel'] as Map?)?.cast<String, dynamic>();
    final entry = (s['entry'] as Map?)?.cast<String, dynamic>();
    final open = s['queueOpen'] == true;
    final waiting = entry?['status'] == 'WAITING';

    final Widget action;
    if (duel != null && !waiting) {
      action = FilledButton.icon(onPressed: () => context.push('/battles/${duel['battleId']}'), icon: const Icon(Icons.sports_mma_rounded), label: Text(l.duelSeeDuel));
    } else if (waiting) {
      action = OutlinedButton(onPressed: _busy ? null : () => _run(_repo.leaveDuel), child: Text(l.duelLeave));
    } else if (open) {
      action = FilledButton(onPressed: _busy ? null : () => _run(_repo.joinDuel), child: Text(l.duelJoin));
    } else {
      action = Text(l.duelQueueClosed, style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.outline));
    }

    return Card(
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 0),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Icons.bolt_rounded, color: t.colorScheme.primary),
            const SizedBox(width: 8),
            Expanded(child: Text(l.weeklyDuel, style: t.textTheme.titleMedium)),
            Text(l.duelRating((rating['rating'] as num).toInt(), (rating['games'] as num).toInt()), style: t.textTheme.labelMedium),
          ]),
          const SizedBox(height: 8),
          Text(
            duel != null && duel['isGhost'] == true ? l.duelGhost : (waiting ? l.duelWaiting : l.duelIntro),
            style: t.textTheme.bodyMedium,
          ),
          const SizedBox(height: 12),
          Align(alignment: AlignmentDirectional.centerEnd, child: action),
        ]),
      ),
    );
  }
}

class _BattleList extends ConsumerStatefulWidget {
  const _BattleList({required this.status});
  final String status;

  @override
  ConsumerState<_BattleList> createState() => _BattleListState();
}

class _BattleListState extends ConsumerState<_BattleList> {
  late final Future<Map<String, dynamic>> _page = ref.read(battlesRepositoryProvider).list(status: widget.status);

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
          if (rows.isEmpty) return EmptyState(icon: Icons.sports_mma_outlined, message: l.noBattles);
          return ListView(padding: const EdgeInsets.all(12), children: [
            for (final b in rows)
              Card(
                child: ListTile(
                  leading: Icon(b['type'] == 'DUEL' ? Icons.bolt_rounded : Icons.sports_mma_rounded),
                  title: Text(b['type'] == 'DUEL' ? (b['isGhost'] == true ? l.duelGhost : l.weeklyDuel) : l.days(b['durationDays'] as int)),
                  subtitle: b['endsAt'] == null ? Text(l.pending) : CountdownText(endsAt: DateTime.parse(b['endsAt'] as String)),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => context.push('/battles/${b['id']}'),
                ),
              ),
          ]);
        },
      ),
    );
  }
}
