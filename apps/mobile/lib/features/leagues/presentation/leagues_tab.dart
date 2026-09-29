import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/section_header.dart';
import '../data/leagues_repository.dart';

String leaguePresetLabel(AppLocalizations l, String preset) => switch (preset) {
      'CONSISTENCY' => l.componentConsistency,
      'PROGRESS' => l.componentProgress,
      _ => l.leaguePresetStandard,
    };

/// League tab "Leagues": my private and public leagues, join with a code, public leagues to join, create one.
class LeaguesTab extends ConsumerStatefulWidget {
  const LeaguesTab({super.key});

  @override
  ConsumerState<LeaguesTab> createState() => _LeaguesTabState();
}

class _LeaguesTabState extends ConsumerState<LeaguesTab> {
  final _code = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _joinByCode() async {
    setState(() => _busy = true);
    try {
      final league = await ref.read(leaguesRepositoryProvider).joinByCode(_code.text.trim());
      _code.clear();
      ref.invalidate(leaguesProvider);
      if (mounted && GoRouter.maybeOf(context) != null) await context.push('/leagues/${league['id']}');
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(onPressed: () => context.push('/leagues/new'), icon: const Icon(Icons.add_rounded), label: Text(l.newLeague)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(leaguesProvider.future),
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 96), children: [
          Row(children: [
            Expanded(
              child: TextField(
                controller: _code,
                textCapitalization: TextCapitalization.characters,
                decoration: InputDecoration(labelText: l.leagueInviteCode, isDense: true),
                onChanged: (_) => setState(() {}),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(onPressed: _busy || _code.text.trim().length < 4 ? null : _joinByCode, child: Text(l.leagueJoin)),
          ]),
          ...ref.watch(leaguesProvider).when(
                loading: () => [const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))],
                error: (e, _) => [ErrorView(error: e, onRetry: () => ref.invalidate(leaguesProvider))],
                data: (data) {
                  final mine = (data['mine'] as List).cast<Map<String, dynamic>>();
                  final open = (data['public'] as List).cast<Map<String, dynamic>>();
                  return [
                    SectionHeader(title: l.myLeagues),
                    if (mine.isEmpty) EmptyState(icon: Icons.groups_outlined, message: l.noLeagues),
                    for (final lg in mine) _LeagueTile(league: lg),
                    if (open.isNotEmpty) ...[
                      SectionHeader(title: l.publicLeagues),
                      for (final lg in open) _LeagueTile(league: lg),
                    ],
                  ];
                },
              ),
        ]),
      ),
    );
  }
}

class _LeagueTile extends StatelessWidget {
  const _LeagueTile({required this.league});
  final Map<String, dynamic> league;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Card(
      child: ListTile(
        leading: Icon(league['visibility'] == 'PRIVATE' ? Icons.lock_outline_rounded : Icons.public_rounded),
        title: Text(league['name'] as String),
        subtitle: Text('${leaguePresetLabel(l, league['scoringPreset'] as String)} · ${l.membersOf(league['members'] as int, league['maxMembers'] as int)}'),
        trailing: league['status'] == 'ENDED' ? Text(l.challengesEnded) : const Icon(Icons.chevron_right_rounded),
        onTap: () => context.push('/leagues/${league['id']}'),
      ),
    );
  }
}
