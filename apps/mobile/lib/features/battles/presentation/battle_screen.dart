import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/avatar_badge.dart';
import '../../../core/widgets/countdown_text.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/skeleton.dart';
import '../data/battles_repository.dart';

/// Face-to-face battle: live scores (polled every 30 s while active), components, actions, result.
class BattleScreen extends ConsumerStatefulWidget {
  const BattleScreen({super.key, required this.id, required this.myId});
  final String id;
  final String myId;

  @override
  ConsumerState<BattleScreen> createState() => _BattleScreenState();
}

class _BattleScreenState extends ConsumerState<BattleScreen> {
  Map<String, dynamic>? _battle;
  Object? _error;
  bool _busy = false;
  Timer? _poll;

  BattlesRepository get _repo => ref.read(battlesRepositoryProvider);

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_battle?['status'] == 'ACTIVE') _load();
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final b = await _repo.get(widget.id);
      if (mounted) setState(() => _battle = b);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _act(String action) async {
    setState(() => _busy = true);
    try {
      await _repo.act(widget.id, action);
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    if (_battle == null) {
      return Scaffold(appBar: AppBar(title: Text(l.battles)), body: _error != null ? ErrorView(error: _error!, onRetry: _load) : const SkeletonList(count: 3, height: 120));
    }
    final b = _battle!;
    final t = Theme.of(context);
    final parts = (b['participants'] as List).cast<Map<String, dynamic>>();
    final me = parts.firstWhere((p) => p['userId'] == widget.myId, orElse: () => parts.first);
    // A ghost duel has one participant: the opponent is the athlete's own previous week.
    final them = b['isGhost'] == true
        ? <String, dynamic>{'userId': null, 'fullName': l.duelGhostOpponent, 'score': b['ghostTarget']}
        : parts.firstWhere((p) => p['userId'] != me['userId']);
    final status = b['status'] as String;
    final iCreated = b['createdById'] == widget.myId;
    num? score(Map<String, dynamic> p) => p['score'] as num?;
    final mine = score(me) ?? 0;
    final theirs = score(them) ?? 0;
    final share = mine + theirs == 0 ? 0.5 : mine / (mine + theirs);

    Widget side(Map<String, dynamic> p) {
      final name = (p['fullName'] ?? p['username']) as String;
      final s = score(p);
      return Expanded(
        child: Column(children: [
          AvatarBadge(name: name, size: 64),
          const SizedBox(height: 8),
          Text(name, style: t.textTheme.titleMedium, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 6),
          Text(s == null ? '—' : s.toStringAsFixed(1), style: AppTheme.display(context, size: 48)),
        ]),
      );
    }

    final outcome = me['outcome'] as String?;
    return Scaffold(
      appBar: AppBar(title: Text(b['type'] == 'DUEL' ? l.weeklyDuel : l.battles)),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 12),
              child: Column(children: [
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  side(me),
                  Padding(padding: const EdgeInsets.only(top: 24), child: Text(l.vs, style: AppTheme.display(context, size: 28).copyWith(color: t.colorScheme.primary))),
                  side(them),
                ]),
                const SizedBox(height: 16),
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: LinearProgressIndicator(value: share.toDouble(), minHeight: 10, backgroundColor: t.colorScheme.surfaceContainerHighest),
                ),
              ]),
            ),
          ),
          const SizedBox(height: 12),
          if (status == 'ACTIVE' && b['endsAt'] != null) Center(child: CountdownText(endsAt: DateTime.parse(b['endsAt'] as String), style: t.textTheme.titleMedium)),
          if (status == 'PENDING') Center(child: Text(iCreated ? l.battleWaiting : l.battleInvited, style: t.textTheme.titleMedium)),
          if (outcome != null)
            Center(
              child: Text(
                switch (outcome) { 'WIN' => l.battleWon, 'LOSS' => l.battleLost, _ => l.battleDraw },
                style: AppTheme.display(context, size: 36).copyWith(color: outcome == 'WIN' ? t.colorScheme.primary : null),
              ),
            ),
          const SizedBox(height: 12),
          Wrap(alignment: WrapAlignment.center, spacing: 8, children: [
            for (final c in (b['components'] as List? ?? const []).cast<String>())
              Chip(label: Text(switch (c) { 'progress' => l.componentProgress, 'consistency' => l.componentConsistency, _ => l.componentPerformance })),
          ]),
          const SizedBox(height: 24),
          if (status == 'PENDING' && !iCreated) ...[
            FilledButton(onPressed: _busy ? null : () => _act('accept'), child: Text(l.accept)),
            TextButton(onPressed: _busy ? null : () => _act('decline'), child: Text(l.decline)),
          ],
          if (status == 'PENDING' && iCreated) OutlinedButton(onPressed: _busy ? null : () => _act('cancel'), child: Text(l.cancelBattle)),
        ]),
      ),
    );
  }
}
