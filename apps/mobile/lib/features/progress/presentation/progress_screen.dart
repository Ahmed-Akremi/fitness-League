import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../data/progress_repository.dart';

/// "My progress": you vs you (spec §11). Body weight is only ever shown here, to its owner.
class ProgressScreen extends ConsumerStatefulWidget {
  const ProgressScreen({super.key});

  @override
  ConsumerState<ProgressScreen> createState() => _ProgressScreenState();
}

class _ProgressScreenState extends ConsumerState<ProgressScreen> {
  String _period = '30d';

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final periods = {'7d': l.period7d, '30d': l.period30d, '3m': l.period3m, '6m': l.period6m, '1y': l.period1y};
    return Scaffold(
      appBar: AppBar(title: Text(l.myProgress)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            for (final p in periods.entries)
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 8),
                child: ChoiceChip(label: Text(p.value), selected: _period == p.key, onSelected: (_) => setState(() => _period = p.key)),
              ),
          ]),
        ),
        const SizedBox(height: 16),
        ref.watch(progressProvider(_period)).when(
              loading: () => const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())),
              error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(progressProvider(_period))),
              data: (p) {
                final metrics = (p['metrics'] as List).cast<Map<String, dynamic>>();
                if (metrics.isEmpty) return EmptyState(icon: Icons.insights_rounded, message: l.emptyWorkouts);
                return Column(children: [
                  for (final m in metrics)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: _MetricCard(metric: m, period: _period, locale: locale),
                    ),
                  if (p['bodyWeight'] != null)
                    StatCard(
                      label: l.privacy,
                      child: Text('${formatNumber(p['bodyWeight']['first'] as num, locale)} → ${formatNumber(p['bodyWeight']['last'] as num, locale)} kg', style: t.textTheme.titleLarge),
                    ),
                ]);
              },
            ),
      ]),
    );
  }
}

class _MetricCard extends ConsumerWidget {
  const _MetricCard({required this.metric, required this.period, required this.locale});
  final Map<String, dynamic> metric;
  final String period;
  final String locale;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context);
    final exercise = metric['exercise'] as Map<String, dynamic>;
    final m = metric['metric'] as Map<String, dynamic>;
    final unit = m['unit'] as String;
    final change = (metric['changePct'] as num).toDouble();
    final series = ref.watch(seriesProvider((exercise['id'] as String, m['code'] as String, period)));
    return StatCard(
      label: '${localized(exercise['name'], locale)} · ${m['code']}',
      trailing: Text('${change >= 0 ? '+' : ''}${change.toStringAsFixed(1)}%',
          style: t.textTheme.titleMedium?.copyWith(color: change >= 0 ? t.colorScheme.primary : t.colorScheme.error, fontWeight: FontWeight.w800)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: _BeforeNow(label: l.before, value: formatMetric(metric['before'] as num, unit, locale))),
          const Icon(Icons.arrow_forward_rounded),
          Expanded(child: _BeforeNow(label: l.now, value: formatMetric(metric['now'] as num, unit, locale), highlight: true)),
        ]),
        if ((metric['xpFromRecords'] as num) > 0) Text(l.totalXp((metric['xpFromRecords'] as num).toInt()), style: t.textTheme.bodySmall),
        const SizedBox(height: 12),
        SizedBox(
          height: 120,
          child: series.when(
            data: (s) {
              final points = (s['points'] as List).cast<Map<String, dynamic>>();
              if (points.length < 2) return const SizedBox.shrink();
              return LineChart(
                LineChartData(
                  gridData: const FlGridData(show: false),
                  borderData: FlBorderData(show: false),
                  titlesData: const FlTitlesData(show: false),
                  lineTouchData: const LineTouchData(enabled: true),
                  lineBarsData: [
                    LineChartBarData(
                      spots: [for (final (i, p) in points.indexed) FlSpot(i.toDouble(), (p['value'] as num).toDouble())],
                      isCurved: true,
                      color: t.colorScheme.primary,
                      barWidth: 3,
                      dotData: const FlDotData(show: false),
                      belowBarData: BarAreaData(show: true, color: t.colorScheme.primary.withValues(alpha: 0.12)),
                    ),
                  ],
                ),
                duration: MediaQuery.of(context).disableAnimations ? Duration.zero : const Duration(milliseconds: 400),
              );
            },
            loading: () => const SizedBox.shrink(),
            error: (_, _) => const SizedBox.shrink(),
          ),
        ),
      ]),
    );
  }
}

class _BeforeNow extends StatelessWidget {
  const _BeforeNow({required this.label, required this.value, this.highlight = false});
  final String label;
  final String value;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: t.textTheme.labelSmall?.copyWith(color: t.colorScheme.outline)),
      Text(value, style: t.textTheme.titleLarge?.copyWith(color: highlight ? t.colorScheme.primary : null)),
    ]);
  }
}
