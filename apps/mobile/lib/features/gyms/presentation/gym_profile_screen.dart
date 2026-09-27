import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/avatar_badge.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/gym_logo.dart';
import '../../../core/widgets/rank_row.dart';
import '../../../core/widgets/section_header.dart';
import '../../../core/widgets/skeleton.dart';
import '../../../core/widgets/sport_chip.dart';
import '../../gym_wods/presentation/gym_wods_section.dart';
import '../../home/data/me_repository.dart';
import '../data/gyms_repository.dart';

/// Public gym profile: banner + logo, stats, sports, info, top athletes, membership action (spec §6).
class GymProfileScreen extends ConsumerWidget {
  const GymProfileScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final gym = ref.watch(gymProvider(id));
    return gym.when(
      data: (g) => _GymProfileView(id: id, gym: g),
      loading: () => Scaffold(appBar: AppBar(), body: const SkeletonList(count: 4, height: 120)),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorView(error: e, onRetry: () => ref.invalidate(gymProvider(id)))),
    );
  }
}

class _GymProfileView extends ConsumerStatefulWidget {
  const _GymProfileView({required this.id, required this.gym});
  final String id;
  final Map<String, dynamic> gym;

  @override
  ConsumerState<_GymProfileView> createState() => _GymProfileViewState();
}

class _GymProfileViewState extends ConsumerState<_GymProfileView> {
  bool _busy = false;

  Map<String, dynamic> get gym => widget.gym;

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(gymProvider(widget.id));
      ref.invalidate(meProvider);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _leave() async {
    final l = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(l.gymLeaveConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(MaterialLocalizations.of(c).cancelButtonLabel)),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(l.gymLeave)),
        ],
      ),
    );
    if (ok == true) await _run(() => ref.read(gymsRepositoryProvider).leave());
  }

  Future<void> _pickLogo() async {
    final l = context.l10n;
    final messenger = ScaffoldMessenger.of(context);
    final file = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1024, maxHeight: 1024, imageQuality: 90);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.length > 2 * 1024 * 1024) {
      messenger.showSnackBar(SnackBar(content: Text(l.logoTooLarge)));
      return;
    }
    await _run(() => ref.read(gymsRepositoryProvider).uploadLogo(widget.id, bytes, file.name));
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final membership = (gym['myMembership'] as Map?)?.cast<String, dynamic>() ?? const {'status': 'NONE'};
    final status = membership['status'] as String? ?? 'NONE';
    final canManage = gym['canManage'] == true;
    final sports = (gym['sports'] as List? ?? const []).cast<Map<String, dynamic>>();
    final links = (gym['socialLinks'] as Map?)?.cast<String, dynamic>() ?? const {};
    final top = (gym['topAthletes'] as List? ?? const []).cast<Map<String, dynamic>>();
    final name = gym['name'] as String;

    final action = switch (status) {
      'APPROVED' => OutlinedButton(onPressed: _busy ? null : _leave, child: Text(l.gymLeave)),
      'PENDING' => FilledButton(onPressed: null, child: Text(l.gymRequestSent)),
      _ => FilledButton(onPressed: _busy ? null : () => _run(() => ref.read(gymsRepositoryProvider).join(widget.id)), child: Text(l.gymJoin)),
    };

    return Scaffold(
      bottomNavigationBar: SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 12), child: action)),
      body: CustomScrollView(slivers: [
        SliverAppBar(
          pinned: true,
          expandedHeight: 250,
          title: Text(name),
          actions: [
            if (canManage) IconButton(tooltip: l.gymChangeLogo, icon: const Icon(Icons.photo_camera_outlined), onPressed: _busy ? null : _pickLogo),
          ],
          flexibleSpace: FlexibleSpaceBar(
            background: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [t.colorScheme.primary.withValues(alpha: 0.35), t.scaffoldBackgroundColor],
                ),
              ),
              alignment: Alignment.bottomCenter,
              padding: const EdgeInsets.only(bottom: 16),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                GymLogo(name: name, url: gym['logoUrl'] as String?, size: 96),
                const SizedBox(height: 10),
                Row(mainAxisSize: MainAxisSize.min, children: [
                  Text(name, style: AppTheme.display(context, size: 32)),
                  if (gym['verified'] == true) Padding(padding: const EdgeInsetsDirectional.only(start: 6), child: Icon(Icons.verified_rounded, color: t.colorScheme.primary, semanticLabel: l.gymVerified)),
                ]),
                const SizedBox(height: 4),
                Text(localized(gym['city'], locale), style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.outline)),
              ]),
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          sliver: SliverList.list(children: [
            Row(children: [
              Expanded(child: StatCard(label: l.gymMembersLabel, child: Text('${gym['membersCount']}', style: AppTheme.display(context, size: 30)))),
              const SizedBox(width: 10),
              Expanded(child: StatCard(label: l.gymLevel, child: Text('${gym['level'] ?? 1}', style: AppTheme.display(context, size: 30)))),
              const SizedBox(width: 10),
              Expanded(child: StatCard(label: l.gymRank, child: Text(gym['rank'] == null ? '—' : '#${gym['rank']}', style: AppTheme.display(context, size: 30)))),
            ]),
            if (sports.isNotEmpty) ...[
              SectionHeader(title: l.gymSports),
              Wrap(spacing: 8, runSpacing: 8, children: [for (final s in sports) SportChip(code: s['code'] as String, name: s['name'])]),
            ],
            if (gym['addressLine'] != null || links.isNotEmpty) ...[
              SectionHeader(title: l.gymInfo),
              Card(
                child: Column(children: [
                  if (gym['addressLine'] != null) ListTile(leading: const Icon(Icons.place_outlined), title: Text(gym['addressLine'] as String)),
                  for (final e in links.entries)
                    ListTile(
                      leading: const Icon(Icons.link_rounded),
                      title: Text(e.key[0].toUpperCase() + e.key.substring(1)),
                      subtitle: Text('${e.value}', overflow: TextOverflow.ellipsis),
                      onTap: () async {
                        await Clipboard.setData(ClipboardData(text: '${e.value}'));
                        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.linkCopied)));
                      },
                    ),
                ]),
              ),
            ],
            GymWodsSection(gymId: widget.id, isMember: status == 'APPROVED', isCoach: membership['role'] == 'COACH' || canManage),
            if (top.isNotEmpty) ...[
              SectionHeader(title: l.gymTopAthletes),
              for (final (i, a) in top.indexed)
                RankRow(
                  rank: i + 1,
                  name: (a['fullName'] ?? a['username']) as String,
                  value: '${a['lp']} LP',
                  leading: AvatarBadge(name: (a['fullName'] ?? a['username']) as String, size: 40),
                  onTap: () => context.push('/u/${a['username']}'),
                ),
            ],
            if (canManage) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(onPressed: () => context.push('/gyms/${widget.id}/members'), icon: const Icon(Icons.group_outlined), label: Text(l.gymManageMembers)),
            ],
          ]),
        ),
      ]),
    );
  }
}
