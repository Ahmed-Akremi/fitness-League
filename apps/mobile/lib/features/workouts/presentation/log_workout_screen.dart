import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/network/api_error.dart';
import '../../../core/offline/workout_sync_service.dart';
import '../../../core/providers.dart';
import '../../../core/utils/format.dart';
import '../../../core/utils/ids.dart';
import '../../../core/widgets/error_text.dart';
import '../../home/data/me_repository.dart';
import '../../onboarding/data/reference_repository.dart';
import '../data/workouts_repository.dart';

class _SetRow {
  final reps = TextEditingController();
  final weight = TextEditingController();
  final distance = TextEditingController();
  final time = TextEditingController();
  bool warmup = false;

  void dispose() {
    for (final c in [reps, weight, distance, time]) {
      c.dispose();
    }
  }
}

class _ExerciseEntry {
  _ExerciseEntry(this.exercise) : sets = [_SetRow()];
  final Map<String, dynamic> exercise;
  final List<_SetRow> sets;
  bool get isCardio => (exercise['trackedMetrics'] as List).contains('DISTANCE');
  bool get isBodyweight => exercise['isBodyweight'] == true;
}

/// Raw data only: the server computes volume, e1RM, records and points (spec §7, §9.1).
class LogWorkoutScreen extends ConsumerStatefulWidget {
  const LogWorkoutScreen({super.key});

  @override
  ConsumerState<LogWorkoutScreen> createState() => _LogWorkoutScreenState();
}

class _LogWorkoutScreenState extends ConsumerState<LogWorkoutScreen> {
  String? _sportId;
  DateTime _performedAt = DateTime.now().subtract(const Duration(hours: 1));
  final _duration = TextEditingController(text: '60');
  final _notes = TextEditingController();
  final List<_ExerciseEntry> _entries = [];
  // Generated once per form: re-submitting after a timeout reuses it, so the server never duplicates.
  final String _clientId = newClientId();
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    _duration.dispose();
    _notes.dispose();
    for (final e in _entries) {
      for (final s in e.sets) {
        s.dispose();
      }
    }
    super.dispose();
  }

  double? _num(TextEditingController c) => double.tryParse(c.text.replaceAll(',', '.'));

  Map<String, dynamic> _payload(String defaultType) {
    return {
      'clientId': _clientId,
      'sportId': _sportId,
      'workoutType': defaultType,
      'performedAt': _performedAt.toUtc().toIso8601String(),
      'durationS': ((_num(_duration) ?? 0) * 60).round(),
      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      'exercises': [
        for (final e in _entries)
          {
            'exerciseId': e.exercise['id'],
            'sets': [
              for (final s in e.sets)
                {
                  if (!e.isCardio && _num(s.reps) != null) 'reps': _num(s.reps)!.round(),
                  if (!e.isCardio && !e.isBodyweight && _num(s.weight) != null) 'weightKg': _num(s.weight),
                  if (e.isCardio && _num(s.distance) != null) 'distanceM': (_num(s.distance)! * 1000).round(),
                  if (e.isCardio && _num(s.time) != null) 'durationS': (_num(s.time)! * 60).round(),
                  if (s.warmup) 'isWarmup': true,
                },
            ],
          },
      ],
    };
  }

  Future<void> _save(String workoutType) async {
    final l = context.l10n;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final (outcome, _) = await ref.read(workoutSyncProvider).save(_payload(workoutType));
      ref.invalidate(workoutsProvider);
      ref.invalidate(pendingWorkoutsProvider);
      ref.invalidate(meProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(outcome == SaveOutcome.saved ? l.workoutSaved : l.workoutQueued)));
      await Navigator.of(context).maybePop();
    } on ApiError catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickDate() async {
    final date = await showDatePicker(context: context, initialDate: _performedAt, firstDate: DateTime.now().subtract(const Duration(days: 30)), lastDate: DateTime.now());
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_performedAt));
    setState(() => _performedAt = DateTime(date.year, date.month, date.day, time?.hour ?? 12, time?.minute ?? 0));
  }

  Future<void> _addExercise(List<Map<String, dynamic>> exercises) async {
    final locale = Localizations.localeOf(context).languageCode;
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      showDragHandle: true,
      builder: (_) => ListView(children: [
        for (final e in exercises) ListTile(key: Key('pick-${e['code']}'), title: Text(localized(e['name'], locale)), onTap: () => Navigator.pop(context, e)),
      ]),
    );
    if (picked != null) setState(() => _entries.add(_ExerciseEntry(picked)));
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final sports = ref.watch(sportsProvider);
    final exercises = _sportId == null ? null : ref.watch(exercisesProvider(_sportId!));

    return Scaffold(
      appBar: AppBar(title: Text(l.logWorkout)),
      body: sports.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(sportsProvider)),
        data: (sportList) {
          final sport = sportList.where((s) => s['id'] == _sportId).firstOrNull;
          return ListView(padding: const EdgeInsets.all(20), children: [
            DropdownButtonFormField<String>(
              key: const Key('log-sport'),
              initialValue: _sportId,
              decoration: InputDecoration(labelText: l.sport),
              items: [for (final s in sportList) DropdownMenuItem(value: s['id'] as String, child: Text(localized(s['name'], locale)))],
              onChanged: (v) => setState(() {
                _sportId = v;
                _entries.clear();
              }),
            ),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(l.performedAt),
                  subtitle: Text('${MaterialLocalizations.of(context).formatMediumDate(_performedAt)} · ${TimeOfDay.fromDateTime(_performedAt).format(context)}'),
                  onTap: _pickDate,
                ),
              ),
              SizedBox(
                width: 130,
                child: TextField(key: const Key('log-duration'), controller: _duration, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: l.durationMin)),
              ),
            ]),
            const SizedBox(height: 8),
            for (final (i, e) in _entries.indexed) _ExerciseCard(key: Key('entry-$i'), entry: e, locale: locale, onChanged: () => setState(() {}), onRemove: () => setState(() => _entries.removeAt(i))),
            if (exercises != null)
              exercises.when(
                data: (list) => OutlinedButton.icon(key: const Key('log-add-exercise'), onPressed: () => _addExercise(list), icon: const Icon(Icons.add_rounded), label: Text(l.addExercise)),
                loading: () => const LinearProgressIndicator(),
                error: (e, _) => ErrorView(error: e),
              ),
            const SizedBox(height: 12),
            TextField(controller: _notes, maxLines: 2, maxLength: 2000, decoration: InputDecoration(labelText: l.notes)),
            if (_error != null) ...[
              Text(errorMessage(context, _error!), style: TextStyle(color: t.colorScheme.error)),
              const SizedBox(height: 8),
            ],
            FilledButton(
              key: const Key('log-save'),
              onPressed: _busy || _sportId == null || _entries.isEmpty ? null : () => _save(sport?['category'] == 'CARDIO' ? 'CARDIO' : 'STRENGTH'),
              child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.save),
            ),
          ]);
        },
      ),
    );
  }
}

class _ExerciseCard extends StatelessWidget {
  const _ExerciseCard({super.key, required this.entry, required this.locale, required this.onChanged, required this.onRemove});

  final _ExerciseEntry entry;
  final String locale;
  final VoidCallback onChanged;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    Widget field(TextEditingController c, String label, String key) => Expanded(
          child: Padding(
            padding: const EdgeInsetsDirectional.only(end: 8),
            child: TextField(key: Key(key), controller: c, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: label, isDense: true)),
          ),
        );
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(localized(entry.exercise['name'], locale), style: t.textTheme.titleMedium)),
            IconButton(tooltip: l.delete, onPressed: onRemove, icon: const Icon(Icons.close_rounded)),
          ]),
          for (final (i, s) in entry.sets.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                SizedBox(width: 28, child: Text('${i + 1}', style: t.textTheme.labelLarge)),
                if (entry.isCardio) ...[
                  field(s.distance, l.distanceKm, 'set-$i-distance'),
                  field(s.time, l.timeMin, 'set-$i-time'),
                ] else ...[
                  field(s.reps, l.reps, 'set-$i-reps'),
                  if (!entry.isBodyweight) field(s.weight, l.weightKg, 'set-$i-weight'),
                ],
                if (!entry.isCardio)
                  Tooltip(
                    message: l.warmup,
                    child: Checkbox(value: s.warmup, onChanged: (v) {
                      s.warmup = v ?? false;
                      onChanged();
                    }),
                  ),
              ]),
            ),
          TextButton.icon(
            key: const Key('add-set'),
            onPressed: () {
              entry.sets.add(_SetRow());
              onChanged();
            },
            icon: const Icon(Icons.add_rounded),
            label: Text(l.addSet),
          ),
        ]),
      ),
    );
  }
}
