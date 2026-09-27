import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/avatar_badge.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/section_header.dart';
import '../../social/data/social_repository.dart';
import '../data/battles_repository.dart';

const _components = ['progress', 'consistency', 'performance'];

/// Challenge a friend: opponent, 3 / 7 / 14 days, scoring components.
class NewBattleScreen extends ConsumerStatefulWidget {
  const NewBattleScreen({super.key, this.opponentId});
  final String? opponentId;

  @override
  ConsumerState<NewBattleScreen> createState() => _NewBattleScreenState();
}

class _NewBattleScreenState extends ConsumerState<NewBattleScreen> {
  late String? _opponent = widget.opponentId;
  int _days = 7;
  final Set<String> _selected = {..._components};
  bool _busy = false;
  Object? _error;

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final b = await ref.read(battlesRepositoryProvider).create(_opponent!, _days, _selected.length == _components.length ? null : _selected.toList());
      if (!mounted) return;
      if (GoRouter.maybeOf(context) != null) context.replace('/battles/${b['id']}');
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final friends = ref.watch(friendsProvider);
    String label(String c) => switch (c) { 'progress' => l.componentProgress, 'consistency' => l.componentConsistency, _ => l.componentPerformance };
    return Scaffold(
      appBar: AppBar(title: Text(l.newBattle)),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: FilledButton(
            onPressed: _busy || _opponent == null || _selected.isEmpty ? null : _send,
            child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.sendChallenge),
          ),
        ),
      ),
      body: friends.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(friendsProvider)),
        data: (list) => list.isEmpty
            ? EmptyState(icon: Icons.group_add_outlined, message: l.noFriendsYet, actionLabel: l.findAthletes, onAction: () => context.push('/search'))
            : ListView(padding: const EdgeInsets.all(16), children: [
                SectionHeader(title: l.friends),
                RadioGroup<String>(
                  groupValue: _opponent,
                  onChanged: (v) => setState(() => _opponent = v),
                  child: Column(children: [
                    for (final f in list)
                      RadioListTile<String>(
                        value: f['id'] as String,
                        secondary: AvatarBadge(name: (f['fullName'] ?? f['username']) as String, size: 40),
                        title: Text((f['fullName'] ?? f['username']) as String),
                        subtitle: Text('@${f['username']}'),
                      ),
                  ]),
                ),
                SectionHeader(title: l.battleDuration),
                SegmentedButton<int>(
                  segments: [for (final d in const [3, 7, 14]) ButtonSegment(value: d, label: Text(l.days(d)))],
                  selected: {_days},
                  onSelectionChanged: (s) => setState(() => _days = s.first),
                ),
                SectionHeader(title: l.battleComponents),
                Wrap(spacing: 8, children: [
                  for (final c in _components)
                    FilterChip(
                      label: Text(label(c)),
                      selected: _selected.contains(c),
                      onSelected: (on) => setState(() => on ? _selected.add(c) : _selected.remove(c)),
                    ),
                ]),
                if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(errorMessage(context, _error!), style: TextStyle(color: t.colorScheme.error))),
              ]),
      ),
    );
  }
}
