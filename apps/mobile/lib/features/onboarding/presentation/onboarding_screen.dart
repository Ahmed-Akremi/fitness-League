import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/error_text.dart';
import '../../home/data/me_repository.dart';
import '../data/reference_repository.dart';

/// Onboarding (spec §6): sports → weekly plan → optional declared level → calibration starts.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  int _step = 0;
  final Set<String> _sportIds = {};
  String? _primary;
  double _days = 3;
  final Map<String, TextEditingController> _baselines = {};
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    for (final c in _baselines.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _toggle(String id) => setState(() {
        if (!_sportIds.contains(id)) {
          _sportIds.add(id);
          _primary ??= id;
        } else if (_primary != id) {
          _primary = id; // second tap on a selected sport makes it the main one
        } else {
          _sportIds.remove(id);
          _primary = _sportIds.isEmpty ? null : _sportIds.first;
        }
      });

  Future<void> _finish(List<Map<String, dynamic>> exercises) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final repo = ref.read(meRepositoryProvider);
    try {
      await repo.setSports(_sportIds.toList(), _primary!);
      await repo.updateProfile({'plannedTrainingDaysPerWeek': _days.round()});
      final entries = <Map<String, dynamic>>[];
      _baselines.forEach((exerciseId, c) {
        final v = double.tryParse(c.text.replaceAll(',', '.'));
        if (v == null || v <= 0) return;
        final exercise = exercises.firstWhere((e) => e['id'] == exerciseId);
        final isRun = exercise['code'] == 'RUN';
        entries.add({'exerciseId': exerciseId, 'metricCode': isRun ? 'TIME_5K' : 'E1RM', 'value': isRun ? v * 60 : v});
      });
      if (entries.isNotEmpty) await repo.declareBaselines(entries);
      await repo.completeOnboarding();
      ref.invalidate(meProvider); // the router leaves onboarding once /me says it's completed
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final sports = ref.watch(sportsProvider);

    Widget body;
    if (_step == 0) {
      body = sports.when(
        data: (list) => Wrap(spacing: 10, runSpacing: 10, children: [
          for (final s in list)
            FilterChip(
              key: Key('sport-${s['code']}'),
              label: Text(localized(s['name'], locale)),
              avatar: _primary == s['id'] ? const Icon(Icons.star_rounded, size: 18) : null,
              selected: _sportIds.contains(s['id']),
              onSelected: (_) => _toggle(s['id'] as String),
            ),
        ]),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(sportsProvider)),
      );
    } else if (_step == 1) {
      body = Column(children: [
        Text('${_days.round()}', style: t.textTheme.displayLarge?.copyWith(color: t.colorScheme.primary)),
        Slider(key: const Key('plan-days'), value: _days, min: 1, max: 6, divisions: 5, label: '${_days.round()}', onChanged: (v) => setState(() => _days = v)),
      ]);
    } else {
      body = _BaselineStep(primarySportId: _primary!, controllers: _baselines, onReady: _finish, busy: _busy);
    }

    final titles = [l.onboardingSportsTitle, l.onboardingPlanTitle, l.onboardingBaselineTitle];
    final subtitles = [l.onboardingSportsSubtitle, l.onboardingPlanSubtitle, l.onboardingBaselineSubtitle];
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            LinearProgressIndicator(value: (_step + 1) / 3, borderRadius: BorderRadius.circular(8)),
            const SizedBox(height: 28),
            Text(titles[_step], style: t.textTheme.headlineMedium),
            const SizedBox(height: 8),
            Text(subtitles[_step], style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.outline)),
            const SizedBox(height: 28),
            Expanded(child: SingleChildScrollView(child: body)),
            if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(errorMessage(context, _error!), style: TextStyle(color: t.colorScheme.error))),
            if (_step < 2)
              FilledButton(
                key: const Key('onboarding-next'),
                onPressed: _sportIds.isEmpty ? null : () => setState(() => _step++),
                child: Text(l.continueLabel),
              ),
          ]),
        ),
      ),
    );
  }
}

/// Optional self-declared level for the main sport. Only a hint: calibration sets the real baseline.
class _BaselineStep extends ConsumerWidget {
  const _BaselineStep({required this.primarySportId, required this.controllers, required this.onReady, required this.busy});

  final String primarySportId;
  final Map<String, TextEditingController> controllers;
  final Future<void> Function(List<Map<String, dynamic>> exercises) onReady;
  final bool busy;

  static const _suggested = ['BACK_SQUAT', 'BENCH_PRESS', 'DEADLIFT', 'RUN'];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final locale = Localizations.localeOf(context).languageCode;
    return ref.watch(exercisesProvider(primarySportId)).when(
          data: (all) {
            final list = all.where((e) => _suggested.contains(e['code'])).toList();
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (final e in list)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: TextField(
                    key: Key('baseline-${e['code']}'),
                    controller: controllers.putIfAbsent(e['id'] as String, TextEditingController.new),
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: InputDecoration(
                      labelText: localized(e['name'], locale),
                      suffixText: e['code'] == 'RUN' ? '5K · ${l.timeMin}' : '1RM · ${l.weightKg}',
                    ),
                  ),
                ),
              const SizedBox(height: 12),
              FilledButton(key: const Key('onboarding-finish'), onPressed: busy ? null : () => onReady(all), child: Text(l.onboardingDone)),
              TextButton(
                onPressed: busy
                    ? null
                    : () {
                        for (final c in controllers.values) {
                          c.clear();
                        }
                        onReady(all);
                      },
                child: Text(l.skip),
              ),
            ]);
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ErrorView(error: e),
        );
  }
}
