import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/providers.dart';
import '../../../core/widgets/error_text.dart';

const _categories = ['SOCIAL', 'BATTLES', 'COMPETITION', 'CHALLENGES', 'BADGES', 'GYM'];

final notificationPrefsProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) => ref.watch(apiClientProvider).get<Map<String, dynamic>>('/me/notification-preferences'));

/// Push switches per category and quiet hours (the in-app list always keeps everything).
class NotificationSettingsSection extends ConsumerStatefulWidget {
  const NotificationSettingsSection({super.key});

  @override
  ConsumerState<NotificationSettingsSection> createState() => _NotificationSettingsSectionState();
}

class _NotificationSettingsSectionState extends ConsumerState<NotificationSettingsSection> {
  Map<String, dynamic>? _prefs;

  Future<void> _save(Map<String, dynamic> body) async {
    try {
      final p = await ref.read(apiClientProvider).put<Map<String, dynamic>>('/me/notification-preferences', data: body);
      if (mounted) setState(() => _prefs = p);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    }
  }

  Future<void> _pickQuietHours(Map<String, dynamic>? current) async {
    TimeOfDay parse(String s) => TimeOfDay(hour: int.parse(s.substring(0, 2)), minute: int.parse(s.substring(3, 5)));
    String fmt(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    final start = await showTimePicker(context: context, initialTime: parse((current?['start'] ?? '22:00') as String));
    if (start == null || !mounted) return;
    final end = await showTimePicker(context: context, initialTime: parse((current?['end'] ?? '07:00') as String));
    if (end == null) return;
    await _save({'quietHours': {'start': fmt(start), 'end': fmt(end)}});
  }

  String _label(AppLocalizations l, String c) => switch (c) {
        'SOCIAL' => l.pushSocial,
        'BATTLES' => l.pushBattles,
        'COMPETITION' => l.gymWars,
        'CHALLENGES' => l.challenges,
        'BADGES' => l.badges,
        _ => l.pushGym,
      };

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final prefs = _prefs ?? ref.watch(notificationPrefsProvider).valueOrNull;
    if (prefs == null) return const SizedBox.shrink();
    final categories = (prefs['categories'] as Map).cast<String, dynamic>();
    final quiet = (prefs['quietHours'] as Map?)?.cast<String, dynamic>();
    return Column(children: [
      for (final c in _categories)
        SwitchListTile(title: Text(_label(l, c)), value: categories[c] != false, onChanged: (v) => _save({'categories': {c: v}})),
      ListTile(
        leading: const Icon(Icons.bedtime_outlined),
        title: Text(l.quietHours),
        subtitle: Text(quiet == null ? l.quietHoursOff : '${quiet['start']} – ${quiet['end']}'),
        onTap: () => _pickQuietHours(quiet),
        trailing: quiet == null ? null : IconButton(tooltip: l.delete, icon: const Icon(Icons.close_rounded), onPressed: () => _save({'quietHours': null})),
      ),
    ]);
  }
}
