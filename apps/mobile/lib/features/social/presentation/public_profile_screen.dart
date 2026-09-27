import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/avatar_badge.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/skeleton.dart';
import '../../home/data/me_repository.dart';
import '../data/social_repository.dart';

/// Public athlete profile: division, level, season LP, gym; friend / challenge / follow / block.
class PublicProfileScreen extends ConsumerStatefulWidget {
  const PublicProfileScreen({super.key, required this.username});
  final String username;

  @override
  ConsumerState<PublicProfileScreen> createState() => _PublicProfileScreenState();
}

class _PublicProfileScreenState extends ConsumerState<PublicProfileScreen> {
  bool _busy = false;
  bool _following = false;

  Future<void> _act(Future<void> Function() action, {bool popAfter = false}) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(publicProfileProvider(widget.username));
      ref.invalidate(friendsProvider);
      if (popAfter && mounted && context.canPop()) context.pop();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(publicProfileProvider(widget.username));
    return profile.when(
      loading: () => Scaffold(appBar: AppBar(), body: const SkeletonList(count: 3, height: 110)),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorView(error: e, onRetry: () => ref.invalidate(publicProfileProvider(widget.username)))),
      data: (p) => _view(context, p),
    );
  }

  Widget _view(BuildContext context, Map<String, dynamic> p) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final repo = ref.read(socialRepositoryProvider);
    final id = p['id'] as String;
    final name = (p['fullName'] ?? p['username']) as String;
    final isMe = ref.watch(meProvider).valueOrNull?['id'] == id;
    final gym = (p['gym'] as Map?)?.cast<String, dynamic>();
    final division = p['division'] as String?;

    final Widget? action = isMe
        ? null
        : switch (p['friendship']) {
            'FRIENDS' => FilledButton.icon(onPressed: () => context.push('/battles/new?opponent=$id'), icon: const Icon(Icons.sports_mma_rounded), label: Text(l.challenge)),
            'REQUEST_SENT' => FilledButton(onPressed: null, child: Text(l.requestSent)),
            'REQUEST_RECEIVED' => FilledButton(onPressed: _busy ? null : () => _act(() => repo.answer(id, true)), child: Text(l.accept)),
            _ => FilledButton.icon(onPressed: _busy ? null : () => _act(() => repo.sendRequest(id)), icon: const Icon(Icons.person_add_alt_1_rounded), label: Text(l.addFriend)),
          };

    return Scaffold(
      appBar: AppBar(
        title: Text('@${p['username']}'),
        actions: [
          if (!isMe)
            PopupMenuButton<String>(
              onSelected: (a) async {
                if (a == 'follow') {
                  await _act(() => repo.follow(id, !_following));
                  setState(() => _following = !_following);
                }
                if (a == 'block') {
                  if (!context.mounted) return;
                  final ok = await showDialog<bool>(
                    context: context,
                    builder: (c) => AlertDialog(
                      content: Text(l.blockConfirm),
                      actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.cancel)), FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(l.block))],
                    ),
                  );
                  if (ok == true) await _act(() => repo.block(id), popAfter: true);
                }
              },
              itemBuilder: (_) => [
                PopupMenuItem(value: 'follow', child: Text(_following ? l.unfollow : l.follow)),
                PopupMenuItem(value: 'block', child: Text(l.block)),
              ],
            ),
        ],
      ),
      bottomNavigationBar: action == null ? null : SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 12), child: action)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Center(child: AvatarBadge(name: name, division: division, size: 96)),
        const SizedBox(height: 12),
        Center(child: Text(name, style: AppTheme.display(context, size: 30))),
        if (division != null)
          Center(
            child: Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Chip(avatar: Icon(Icons.shield_rounded, color: divisionColor(division), size: 18), label: Text(division)),
            ),
          ),
        if (p['bio'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(p['bio'] as String, textAlign: TextAlign.center, style: t.textTheme.bodyMedium)),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(child: StatCard(label: l.gymLevel, child: Text('${p['level']}', style: AppTheme.display(context, size: 28)))),
          const SizedBox(width: 10),
          Expanded(child: StatCard(label: l.seasonLp, child: Text('${p['seasonLp']}', style: AppTheme.display(context, size: 28)))),
          const SizedBox(width: 10),
          Expanded(child: StatCard(label: l.followers, child: Text('${p['followers']}', style: AppTheme.display(context, size: 28)))),
        ]),
        const SizedBox(height: 12),
        if (gym != null)
          Card(child: ListTile(leading: const Icon(Icons.fitness_center_rounded), title: Text(gym['name'] as String), trailing: const Icon(Icons.chevron_right_rounded), onTap: () => context.push('/gyms/${gym['id']}'))),
        if (p['governorate'] != null)
          Card(child: ListTile(leading: const Icon(Icons.place_outlined), title: Text(localized((p['governorate'] as Map)['name'], locale)))),
      ]),
    );
  }
}
