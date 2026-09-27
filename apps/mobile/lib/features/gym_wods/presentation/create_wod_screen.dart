import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/time_field.dart';
import '../../onboarding/data/reference_repository.dart';
import '../data/gym_wods_repository.dart';

/// Coach form: title, movements, score type, optional time cap, window (≤ 31 days), sport, draft.
class CreateWodScreen extends ConsumerStatefulWidget {
  const CreateWodScreen({super.key, required this.gymId});
  final String gymId;

  @override
  ConsumerState<CreateWodScreen> createState() => _CreateWodScreenState();
}

class _CreateWodScreenState extends ConsumerState<CreateWodScreen> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  String _scoreType = 'FOR_TIME';
  int? _cap;
  final _capText = TextEditingController();

  /// Cap typed but unparsable or under the API minimum (60 s).
  bool get _capInvalid => _scoreType != 'MAX_LOAD' && _capText.text.trim().isNotEmpty && (_cap == null || _cap! < 60);
  late DateTime _startsAt = DateTime.now();
  late DateTime _endsAt = DateTime.now().add(const Duration(days: 7));
  String? _sportId;
  bool _draft = false;
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _capText.dispose();
    super.dispose();
  }

  String? get _problem {
    final l = context.l10n;
    if (_title.text.trim().length < 3 || _description.text.trim().isEmpty) return null; // button disabled, no message
    if (!_endsAt.isAfter(_startsAt)) return l.wodEndsBeforeStart;
    if (_endsAt.difference(_startsAt) > const Duration(days: 31)) return l.wodWindowTooLong;
    return null;
  }

  bool get _valid => !_capInvalid && _title.text.trim().length >= 3 && _title.text.trim().length <= 80 && _description.text.trim().isNotEmpty && _endsAt.isAfter(_startsAt) && _endsAt.difference(_startsAt) <= const Duration(days: 31);

  Future<DateTime?> _pick(DateTime initial) async {
    final date = await showDatePicker(context: context, initialDate: initial, firstDate: DateTime.now().subtract(const Duration(days: 30)), lastDate: DateTime.now().add(const Duration(days: 365)));
    if (date == null || !mounted) return null;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(initial));
    return DateTime(date.year, date.month, date.day, time?.hour ?? initial.hour, time?.minute ?? initial.minute);
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(gymWodsRepositoryProvider).create(widget.gymId, {
        'title': _title.text.trim(),
        'description': _description.text.trim(),
        'scoreType': _scoreType,
        if (_scoreType != 'MAX_LOAD') 'timeCapS': ?_cap,
        'startsAt': _startsAt.toUtc().toIso8601String(),
        'endsAt': _endsAt.toUtc().toIso8601String(),
        'sportId': ?_sportId,
        if (_draft) 'status': 'DRAFT',
      });
      ref.invalidate(gymWodsProvider);
      if (mounted && context.canPop()) context.pop();
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
    final loc = MaterialLocalizations.of(context);
    String fmt(DateTime d) => '${loc.formatMediumDate(d)} · ${loc.formatTimeOfDay(TimeOfDay.fromDateTime(d))}';
    final sports = (ref.watch(sportsProvider).valueOrNull ?? const []).where((s) => s['code'] == 'CROSSFIT' || s['code'] == 'HYROX').toList();
    return Scaffold(
      appBar: AppBar(title: Text(l.wodCreate)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(key: const Key('wod-title'), controller: _title, maxLength: 80, decoration: InputDecoration(labelText: l.wodTitle), onChanged: (_) => setState(() {})),
        const SizedBox(height: 8),
        TextField(key: const Key('wod-description'), controller: _description, maxLength: 2000, minLines: 3, maxLines: 8, decoration: InputDecoration(labelText: l.wodDescription), onChanged: (_) => setState(() {})),
        const SizedBox(height: 12),
        Text(l.wodScoreType, style: t.textTheme.labelLarge),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'FOR_TIME', label: Text(l.forTime)),
            ButtonSegment(value: 'AMRAP', label: Text(l.amrap)),
            ButtonSegment(value: 'MAX_LOAD', label: Text(l.maxLoad)),
          ],
          selected: {_scoreType},
          onSelectionChanged: (s) => setState(() => _scoreType = s.first),
        ),
        const SizedBox(height: 16),
        if (_scoreType != 'MAX_LOAD') TimeField(key: const Key('wod-cap'), controller: _capText, label: l.wodTimeCap, onChanged: (v) => setState(() => _cap = v)),
        if (_capInvalid) Padding(padding: const EdgeInsets.only(top: 4), child: Text(l.wodCapTooShort, style: TextStyle(color: t.colorScheme.error))),
        const SizedBox(height: 8),
        ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.play_circle_outline), title: Text(l.wodStarts), subtitle: Text(fmt(_startsAt)), onTap: () async {
          final d = await _pick(_startsAt);
          if (d != null) setState(() => _startsAt = d);
        }),
        ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.flag_outlined), title: Text(l.wodEnds), subtitle: Text(fmt(_endsAt)), onTap: () async {
          final d = await _pick(_endsAt);
          if (d != null) setState(() => _endsAt = d);
        }),
        const SizedBox(height: 12),
        if (sports.isNotEmpty)
          DropdownButtonFormField<String?>(
            initialValue: _sportId,
            decoration: InputDecoration(labelText: l.sport),
            items: [
              DropdownMenuItem(value: null, child: Text(l.none)),
              for (final s in sports) DropdownMenuItem(value: s['id'] as String, child: Text(s['code'] == 'HYROX' ? 'Hyrox' : 'CrossFit')),
            ],
            onChanged: (v) => setState(() => _sportId = v),
          ),
        SwitchListTile(contentPadding: EdgeInsets.zero, value: _draft, onChanged: (v) => setState(() => _draft = v), title: Text(l.wodDraft)),
        if (_problem != null) Text(_problem!, style: TextStyle(color: t.colorScheme.error)),
        if (_error != null) Text(errorMessage(context, _error!), style: TextStyle(color: t.colorScheme.error)),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy || !_valid ? null : _save,
          child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2)) : Text(_draft ? l.save : l.wodPublish),
        ),
      ]),
    );
  }
}
