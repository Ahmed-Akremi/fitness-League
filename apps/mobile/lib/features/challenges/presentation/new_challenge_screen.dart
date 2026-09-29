import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/section_header.dart';
import '../data/challenges_repository.dart';
import 'challenges_screen.dart';

const _metrics = ['WORKOUTS', 'TRAINING_DAYS', 'DURATION_MIN', 'DISTANCE_KM', 'VOLUME_KG'];

/// Personal or friends challenge: a title, a quantity, a target and a duration starting now.
class NewChallengeScreen extends ConsumerStatefulWidget {
  const NewChallengeScreen({super.key});

  @override
  ConsumerState<NewChallengeScreen> createState() => _NewChallengeScreenState();
}

class _NewChallengeScreenState extends ConsumerState<NewChallengeScreen> {
  final _title = TextEditingController();
  final _target = TextEditingController(text: '12');
  String _scope = 'FRIEND';
  String _metric = 'WORKOUTS';
  int _days = 30;
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    _title.dispose();
    _target.dispose();
    super.dispose();
  }

  num? get _targetValue => num.tryParse(_target.text.replaceAll(',', '.'));
  bool get _valid => _title.text.trim().length >= 3 && (_targetValue ?? 0) >= 1;

  Future<void> _create() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final now = DateTime.now().toUtc();
      final c = await ref.read(challengesRepositoryProvider).create({
        'scope': _scope,
        'title': _title.text.trim(),
        'metric': _metric,
        'targetValue': _targetValue,
        'startsAt': now.toIso8601String(),
        'endsAt': now.add(Duration(days: _days)).toIso8601String(),
      });
      ref.invalidate(challengesProvider);
      if (mounted && GoRouter.maybeOf(context) != null) context.replace('/challenges/${c['id']}');
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
    return Scaffold(
      appBar: AppBar(title: Text(l.newChallenge)),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: FilledButton(
            onPressed: _busy || !_valid ? null : _create,
            child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.createChallenge),
          ),
        ),
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _title, maxLength: 80, decoration: InputDecoration(labelText: l.challengeTitle), onChanged: (_) => setState(() {})),
        SectionHeader(title: l.challengeWho),
        SegmentedButton<String>(
          segments: [ButtonSegment(value: 'FRIEND', label: Text(l.scopeFriends)), ButtonSegment(value: 'PERSONAL', label: Text(l.scopePersonal))],
          selected: {_scope},
          onSelectionChanged: (s) => setState(() => _scope = s.first),
        ),
        SectionHeader(title: l.challengeWhat),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final m in _metrics) ChoiceChip(label: Text(challengeMetricLabel(l, m)), selected: _metric == m, onSelected: (_) => setState(() => _metric = m)),
        ]),
        const SizedBox(height: 12),
        TextField(
          controller: _target,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
          decoration: InputDecoration(labelText: l.challengeTarget, suffixText: challengeMetricLabel(l, _metric)),
          onChanged: (_) => setState(() {}),
        ),
        SectionHeader(title: l.battleDuration),
        SegmentedButton<int>(
          segments: [for (final d in const [7, 14, 30]) ButtonSegment(value: d, label: Text(l.days(d)))],
          selected: {_days},
          onSelectionChanged: (s) => setState(() => _days = s.first),
        ),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(errorMessage(context, _error!), style: TextStyle(color: t.colorScheme.error))),
      ]),
    );
  }
}
