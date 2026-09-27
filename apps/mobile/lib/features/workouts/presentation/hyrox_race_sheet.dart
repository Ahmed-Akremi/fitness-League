import 'package:flutter/material.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/time_field.dart';

/// Official Hyrox station order (the 1 km runs are part of the total, not listed one by one).
const hyroxStationOrder = [
  'HYROX_SKIERG_1000',
  'HYROX_SLED_PUSH',
  'HYROX_SLED_PULL',
  'HYROX_BURPEE_BROAD_JUMP',
  'HYROX_ROW_1000',
  'HYROX_FARMERS_CARRY',
  'HYROX_SANDBAG_LUNGES',
  'HYROX_WALL_BALLS',
];

/// One timed exercise returned by the assistant.
typedef TimedExercise = ({Map<String, dynamic> exercise, int seconds});

/// Full race assistant: Open/Pro, 8 station splits, total (computed from the splits until edited by hand).
/// Pops with the race total first, then the stations that have a time.
class HyroxRaceSheet extends StatefulWidget {
  const HyroxRaceSheet({super.key, required this.exercises});
  final List<Map<String, dynamic>> exercises;

  @override
  State<HyroxRaceSheet> createState() => _HyroxRaceSheetState();
}

class _HyroxRaceSheetState extends State<HyroxRaceSheet> {
  late final List<Map<String, dynamic>> _races = widget.exercises.where((e) => e['group'] == 'HYROX_RACE').toList();
  late Map<String, dynamic>? _race = _races.firstOrNull;
  late final List<Map<String, dynamic>> _stations = _pickStations();
  late final List<int?> _splits = List.filled(_stations.length, null);
  final _total = TextEditingController();
  int? _totalSeconds;
  bool _totalEdited = false;

  List<Map<String, dynamic>> _pickStations() {
    final byCode = {for (final e in widget.exercises) e['code'] as String: e};
    final official = [for (final c in hyroxStationOrder) ?byCode[c]];
    if (official.length == hyroxStationOrder.length) return official;
    // Catalog without the official codes: the station exercises in catalog order, runs excluded.
    return widget.exercises.where((e) => e['group'] == 'HYROX_STATION' && e['code'] != 'HYROX_RUN_1K').take(8).toList();
  }

  @override
  void dispose() {
    _total.dispose();
    super.dispose();
  }

  void _onSplit(int i, int? v) {
    setState(() {
      _splits[i] = v;
      if (_totalEdited) return;
      final known = _splits.whereType<int>();
      final sum = known.fold<int>(0, (a, b) => a + b);
      _totalSeconds = known.isEmpty ? null : sum;
      _total.text = known.isEmpty ? '' : formatDuration(sum);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: ListView(shrinkWrap: true, padding: const EdgeInsets.fromLTRB(20, 0, 20, 20), children: [
        Text(l.hyroxFullRace, style: t.textTheme.titleLarge),
        const SizedBox(height: 12),
        if (_races.length > 1)
          SegmentedButton<String>(
            segments: [for (final r in _races) ButtonSegment(value: r['id'] as String, label: Text(localized(r['name'], locale)))],
            selected: {_race!['id'] as String},
            onSelectionChanged: (s) => setState(() => _race = _races.firstWhere((r) => r['id'] == s.first)),
          ),
        const SizedBox(height: 12),
        for (final (i, s) in _stations.indexed)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: TimeField(key: Key('station-${i + 1}'), label: '${i + 1}. ${localized(s['name'], locale)}', onChanged: (v) => _onSplit(i, v)),
          ),
        const Divider(height: 24),
        TimeField(
          key: const Key('hyrox-total'),
          controller: _total,
          label: l.hyroxTotal,
          onChanged: (v) => setState(() {
            _totalEdited = true;
            _totalSeconds = v;
          }),
        ),
        Padding(padding: const EdgeInsets.only(top: 6), child: Text(l.hyroxTotalHint, style: t.textTheme.bodySmall)),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _race == null || _totalSeconds == null
              ? null
              : () => Navigator.pop<List<TimedExercise>>(context, [
                    (exercise: _race!, seconds: _totalSeconds!),
                    for (final (i, s) in _stations.indexed)
                      if (_splits[i] != null) (exercise: s, seconds: _splits[i]!),
                  ]),
          child: Text(l.hyroxAdd),
        ),
      ]),
    );
  }
}
