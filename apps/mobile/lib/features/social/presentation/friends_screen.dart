import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/section_header.dart';
import '../data/social_repository.dart';
import 'athlete_tile.dart';

/// Friends and friend requests (received / sent).
class FriendsScreen extends ConsumerStatefulWidget {
  const FriendsScreen({super.key});

  @override
  ConsumerState<FriendsScreen> createState() => _FriendsScreenState();
}

class _FriendsScreenState extends ConsumerState<FriendsScreen> {
  late Future<List<Map<String, dynamic>>> _friends;
  late Future<(List<Map<String, dynamic>>, List<Map<String, dynamic>>)> _requests;

  SocialRepository get _repo => ref.read(socialRepositoryProvider);

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    _friends = _repo.friends();
    _requests = Future.wait([_repo.requests('in'), _repo.requests('out')]).then((r) => (r[0], r[1]));
  }

  Future<void> _act(Future<void> Function() action) async {
    try {
      await action();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    }
    ref.invalidate(friendsProvider);
    if (mounted) setState(_reload);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l.friends),
          actions: [IconButton(tooltip: l.findAthletes, icon: const Icon(Icons.person_search_rounded), onPressed: () => context.push('/search'))],
          bottom: TabBar(tabs: [Tab(text: l.friends), Tab(text: l.requests)]),
        ),
        body: TabBarView(children: [
          FutureBuilder<List<Map<String, dynamic>>>(
            future: _friends,
            builder: (context, snap) => AsyncBody<List<Map<String, dynamic>>>(
              snapshot: snap,
              error: (e, _) => ErrorView(error: e, onRetry: () => setState(_reload)),
              builder: (rows) => rows.isEmpty
                  ? EmptyState(icon: Icons.group_add_outlined, message: l.noFriendsYet, actionLabel: l.findAthletes, onAction: () => context.push('/search'))
                  : ListView(padding: const EdgeInsets.symmetric(vertical: 8), children: [
                      for (final f in rows)
                        AthleteTile(
                          athlete: f,
                          trailing: PopupMenuButton<String>(
                            onSelected: (a) {
                              if (a == 'battle') context.push('/battles/new?opponent=${f['id']}');
                              if (a == 'remove') _act(() => _repo.unfriend(f['id'] as String));
                            },
                            itemBuilder: (_) => [
                              PopupMenuItem(value: 'battle', child: Text(l.challenge)),
                              PopupMenuItem(value: 'remove', child: Text(l.unfriend)),
                            ],
                          ),
                        ),
                    ]),
            ),
          ),
          FutureBuilder<(List<Map<String, dynamic>>, List<Map<String, dynamic>>)>(
            future: _requests,
            builder: (context, snap) => AsyncBody<(List<Map<String, dynamic>>, List<Map<String, dynamic>>)>(
              snapshot: snap,
              error: (e, _) => ErrorView(error: e, onRetry: () => setState(_reload)),
              builder: (r) {
                final (incoming, outgoing) = r;
                if (incoming.isEmpty && outgoing.isEmpty) return EmptyState(icon: Icons.inbox_outlined, message: l.noRequests);
                return ListView(padding: const EdgeInsets.symmetric(horizontal: 8), children: [
                  if (incoming.isNotEmpty) SectionHeader(title: l.received),
                  for (final a in incoming)
                    AthleteTile(
                      athlete: a,
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                        IconButton(tooltip: l.accept, icon: const Icon(Icons.check_rounded), onPressed: () => _act(() => _repo.answer(a['id'] as String, true))),
                        IconButton(tooltip: l.decline, icon: const Icon(Icons.close_rounded), onPressed: () => _act(() => _repo.answer(a['id'] as String, false))),
                      ]),
                    ),
                  if (outgoing.isNotEmpty) SectionHeader(title: l.sent),
                  for (final a in outgoing) AthleteTile(athlete: a, trailing: Text(l.pending)),
                ]);
              },
            ),
          ),
        ]),
      ),
    );
  }
}
