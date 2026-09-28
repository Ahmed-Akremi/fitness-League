import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/avatar_badge.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../data/gyms_repository.dart';

/// Gym admin: membership requests to approve, members to promote to coach or remove.
class GymMembersScreen extends ConsumerStatefulWidget {
  const GymMembersScreen({super.key, required this.id});
  final String id;

  @override
  ConsumerState<GymMembersScreen> createState() => _GymMembersScreenState();
}

class _GymMembersScreenState extends ConsumerState<GymMembersScreen> {
  late Future<List<Map<String, dynamic>>> _requests;
  late Future<Map<String, dynamic>> _members;

  GymsRepository get _repo => ref.read(gymsRepositoryProvider);

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    _requests = _repo.requests(widget.id);
    _members = _repo.members(widget.id);
  }

  Future<void> _act(Future<void> Function() action) async {
    try {
      await action();
      ref.invalidate(gymProvider(widget.id));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    }
    if (mounted) setState(_reload);
  }

  Future<void> _confirmRemove(Map<String, dynamic> m) async {
    final l = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(l.removeMemberConfirm((m['fullName'] ?? m['username']) as String)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.cancel)),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(l.removeMember)),
        ],
      ),
    );
    if (ok == true) await _act(() => _repo.decide(widget.id, m['id'] as String, 'remove'));
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(title: Text(l.gymManageMembers), bottom: TabBar(tabs: [Tab(text: l.requestsTab), Tab(text: l.membersTab)])),
        body: TabBarView(children: [
          FutureBuilder<List<Map<String, dynamic>>>(
            future: _requests,
            builder: (context, snap) => AsyncBody<List<Map<String, dynamic>>>(
              snapshot: snap,
              error: (e, _) => ErrorView(error: e, onRetry: () => setState(_reload)),
              builder: (rows) => rows.isEmpty
                  ? EmptyState(icon: Icons.inbox_outlined, message: l.noRequests)
                  : ListView(padding: const EdgeInsets.all(8), children: [
                      for (final r in rows)
                        ListTile(
                          leading: AvatarBadge(name: (r['fullName'] ?? r['username']) as String, size: 40),
                          title: Text((r['fullName'] ?? r['username']) as String),
                          subtitle: Text('@${r['username']}'),
                          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                            IconButton(tooltip: l.approve, icon: const Icon(Icons.check_rounded), onPressed: () => _act(() => _repo.decide(widget.id, r['userId'] as String, 'approve'))),
                            IconButton(tooltip: l.reject, icon: const Icon(Icons.close_rounded), onPressed: () => _act(() => _repo.decide(widget.id, r['userId'] as String, 'reject'))),
                          ]),
                        ),
                    ]),
            ),
          ),
          FutureBuilder<Map<String, dynamic>>(
            future: _members,
            builder: (context, snap) => AsyncBody<Map<String, dynamic>>(
              snapshot: snap,
              error: (e, _) => ErrorView(error: e, onRetry: () => setState(_reload)),
              builder: (page) {
                final rows = (page['data'] as List).cast<Map<String, dynamic>>();
                return ListView(padding: const EdgeInsets.all(8), children: [
                  for (final m in rows)
                    ListTile(
                      leading: AvatarBadge(name: (m['fullName'] ?? m['username']) as String, size: 40),
                      title: Text((m['fullName'] ?? m['username']) as String),
                      subtitle: Text(m['role'] == 'COACH' ? l.coach : '@${m['username']}'),
                      trailing: PopupMenuButton<String>(
                        tooltip: l.memberActions,
                        onSelected: (a) => switch (a) {
                          'coach' => _act(() => _repo.setCoach(widget.id, m['id'] as String, true)),
                          'uncoach' => _act(() => _repo.setCoach(widget.id, m['id'] as String, false)),
                          _ => _confirmRemove(m),
                        },
                        itemBuilder: (_) => [
                          if (m['role'] == 'COACH') PopupMenuItem(value: 'uncoach', child: Text(l.removeCoach)) else PopupMenuItem(value: 'coach', child: Text(l.makeCoach)),
                          PopupMenuItem(value: 'remove', child: Text(l.removeMember)),
                        ],
                      ),
                    ),
                ]);
              },
            ),
          ),
        ]),
      ),
    );
  }
}
