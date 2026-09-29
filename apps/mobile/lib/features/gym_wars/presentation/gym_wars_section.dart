import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/section_header.dart';
import '../data/gym_wars_repository.dart';

/// Gym profile section: war record, gym rating, recent wars and (for the gym admin) the enrolment switch.
class GymWarsSection extends ConsumerStatefulWidget {
  const GymWarsSection({super.key, required this.gymId, required this.canManage});
  final String gymId;
  final bool canManage;

  @override
  ConsumerState<GymWarsSection> createState() => _GymWarsSectionState();
}

class _GymWarsSectionState extends ConsumerState<GymWarsSection> {
  bool _busy = false;
  bool? _enrolled;

  Future<void> _setEnrolled(bool v) async {
    setState(() => _busy = true);
    try {
      final r = await ref.read(gymWarsRepositoryProvider).setEnrolled(widget.gymId, v);
      if (mounted) setState(() => _enrolled = r['enrolled'] as bool);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final history = ref.watch(gymWarHistoryProvider(widget.gymId)).valueOrNull;
    if (history == null) return const SizedBox.shrink();
    final record = (history['record'] as Map).cast<String, dynamic>();
    final wars = (history['data'] as List).cast<Map<String, dynamic>>();
    if (wars.isEmpty && !widget.canManage) return const SizedBox.shrink();

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SectionHeader(title: l.gymWars),
      Card(
        child: Column(children: [
          ListTile(
            leading: Icon(Icons.shield_outlined, color: t.colorScheme.primary),
            title: Text(l.gymWarRecord(record['wins'] as int, record['losses'] as int, record['draws'] as int)),
            trailing: Text(l.gymWarRating(history['rating'] as int), style: t.textTheme.labelLarge),
          ),
          if (widget.canManage)
            SwitchListTile(
              title: Text(l.gymWarEnrolled),
              subtitle: Text(l.gymWarEnrolledHint),
              value: _enrolled ?? history['enrolled'] == true,
              onChanged: _busy ? null : _setEnrolled,
            ),
          for (final w in wars.take(5))
            ListTile(
              dense: true,
              leading: Icon(switch (w['outcome']) { 'WIN' => Icons.emoji_events_outlined, 'LOSS' => Icons.close_rounded, _ => Icons.shield_outlined }),
              title: Text(w['opponent'] == null ? l.gymWarByeShort : l.gymWarVs((w['opponent'] as Map)['name'] as String)),
              subtitle: Text(w['weekStart'] as String),
              trailing: w['score'] == null
                  ? (w['status'] == 'ACTIVE' ? Text(l.gymWarLive) : null)
                  : Text('${(w['score'] as num).toStringAsFixed(1)} – ${((w['opponentScore'] as num?) ?? 0).toStringAsFixed(1)}'),
              onTap: () => context.push('/gym-wars/${w['id']}'),
            ),
        ]),
      ),
    ]);
  }
}
