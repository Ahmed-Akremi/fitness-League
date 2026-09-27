import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/utils/ids.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/time_field.dart';

/// Bottom sheet to submit a score: Rx/Scaled + time, AMRAP rounds/reps, or load, depending on the WOD.
class WodScoreSheet extends StatefulWidget {
  const WodScoreSheet({super.key, required this.wod, required this.onSubmit});
  final Map<String, dynamic> wod;
  final Future<void> Function(Map<String, dynamic> body) onSubmit;

  @override
  State<WodScoreSheet> createState() => _WodScoreSheetState();
}

class _WodScoreSheetState extends State<WodScoreSheet> {
  String _division = 'RX';
  int? _seconds;
  int? _rounds;
  int? _repsPerRound;
  int? _extraReps;
  double? _loadKg;
  bool _busy = false;
  Object? _error;

  String get _type => widget.wod['scoreType'] as String;
  int? get _cap => widget.wod['timeCapS'] as int?;
  bool get _overCap => _type == 'FOR_TIME' && _seconds != null && _cap != null && _seconds! > _cap!;

  int? get _amrapTotal {
    if (_rounds == null) return null;
    return _rounds! * (_repsPerRound ?? 0) + (_extraReps ?? 0);
  }

  Map<String, dynamic>? get _score => switch (_type) {
        'FOR_TIME' => _seconds == null || _overCap ? null : {'timeS': _seconds},
        'MAX_LOAD' => _loadKg == null || _loadKg! < 1 || _loadKg! > 500 ? null : {'loadKg': _loadKg},
        _ => _amrapTotal == null || (_repsPerRound == null && _extraReps == null) ? null : {'rounds': _rounds, 'reps': _amrapTotal},
      };

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onSubmit({'division': _division, ..._score!, 'performedAt': DateTime.now().toUtc().toIso8601String(), 'clientId': newClientId()});
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _intField(String key, String label, ValueChanged<int?> onChanged) => TextField(
        key: Key(key),
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
        decoration: InputDecoration(labelText: label),
        onChanged: (v) => setState(() => onChanged(int.tryParse(v))),
      );

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 12, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(l.wodSubmitScore, style: t.textTheme.titleLarge),
        const SizedBox(height: 16),
        SegmentedButton<String>(
          segments: [const ButtonSegment(value: 'RX', label: Text('Rx')), ButtonSegment(value: 'SCALED', label: Text(l.scaled))],
          selected: {_division},
          onSelectionChanged: (s) => setState(() => _division = s.first),
        ),
        const SizedBox(height: 16),
        if (_type == 'FOR_TIME') ...[
          TimeField(key: const Key('wod-time'), label: l.wodYourTime, onChanged: (v) => setState(() => _seconds = v)),
          if (_overCap) Padding(padding: const EdgeInsets.only(top: 6), child: Text(l.wodOverCap, style: TextStyle(color: t.colorScheme.error))),
          if (_cap != null && !_overCap) Padding(padding: const EdgeInsets.only(top: 6), child: Text('Cap ${formatDuration(_cap!)}', style: t.textTheme.bodySmall)),
        ] else if (_type == 'MAX_LOAD')
          TextField(
            key: const Key('wod-load'),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: l.wodLoad),
            onChanged: (v) => setState(() => _loadKg = double.tryParse(v.replaceAll(',', '.'))),
          )
        else ...[
          Row(children: [
            Expanded(child: _intField('wod-rounds', l.wodRounds, (v) => _rounds = v)),
            const SizedBox(width: 10),
            Expanded(child: _intField('wod-reps-per-round', l.wodRepsPerRound, (v) => _repsPerRound = v)),
          ]),
          const SizedBox(height: 10),
          _intField('wod-extra-reps', l.wodExtraReps, (v) => _extraReps = v),
          if (_amrapTotal != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('= $_amrapTotal reps', style: t.textTheme.titleMedium)),
        ],
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(errorMessage(context, _error!), style: TextStyle(color: t.colorScheme.error))),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _busy || _score == null ? null : _save,
          child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.save),
        ),
      ]),
    );
  }
}
