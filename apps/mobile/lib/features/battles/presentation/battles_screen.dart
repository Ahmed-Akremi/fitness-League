import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/countdown_text.dart';
import '../../../core/widgets/error_text.dart';
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
        body: const TabBarView(children: [_BattleList(status: 'ACTIVE'), _BattleList(status: 'PENDING'), _BattleList(status: 'COMPLETED')]),
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
                  leading: const Icon(Icons.sports_mma_rounded),
                  title: Text(l.days(b['durationDays'] as int)),
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
