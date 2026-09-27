import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/network/api_error.dart';
import '../../../core/providers.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/skeleton.dart';

final bodyMeasurementsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>(
  (ref) async => (await ref.watch(apiClientProvider).get<List<dynamic>>('/me/body-measurements')).cast<Map<String, dynamic>>(),
);

/// Weigh-ins (health data, owner only): weight curve and history.
class BodyScreen extends ConsumerWidget {
  const BodyScreen({super.key});

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    final l = context.l10n;
    final c = TextEditingController();
    final weight = await showDialog<double>(
      context: context,
      builder: (d) => StatefulBuilder(
        builder: (d, setLocal) {
          final v = double.tryParse(c.text.replaceAll(',', '.'));
          final ok = v != null && v >= 25 && v <= 350;
          return AlertDialog(
            title: Text(l.addMeasurement),
            content: TextField(
              key: const Key('weight-input'),
              controller: c,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
              decoration: InputDecoration(labelText: l.weightKg),
              onChanged: (_) => setLocal(() {}),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(d), child: Text(l.cancel)),
              FilledButton(onPressed: ok ? () => Navigator.pop(d, v) : null, child: Text(l.save)),
            ],
          );
        },
      ),
    );
    if (weight == null) return;
    try {
      await ref.read(apiClientProvider).post<dynamic>('/me/body-measurements', data: {'weightKg': weight});
      ref.invalidate(bodyMeasurementsProvider);
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    return Scaffold(
      appBar: AppBar(title: Text(l.body)),
      floatingActionButton: FloatingActionButton(tooltip: l.addMeasurement, onPressed: () => _add(context, ref), child: const Icon(Icons.add_rounded)),
      body: ref.watch(bodyMeasurementsProvider).when(
            loading: () => const SkeletonList(count: 4),
            error: (e, _) => e is ApiError && e.status == 403
                ? EmptyState(icon: Icons.health_and_safety_outlined, message: l.healthConsentNeeded)
                : ErrorView(error: e, onRetry: () => ref.invalidate(bodyMeasurementsProvider)),
            data: (rows) {
              final weights = rows.where((r) => r['weightKg'] != null).toList().reversed.toList();
              if (weights.isEmpty) return EmptyState(icon: Icons.monitor_weight_outlined, message: l.noMeasurements);
              final latest = weights.last['weightKg'] as num;
              return ListView(padding: const EdgeInsets.all(16), children: [
                StatCard(label: l.weightKg, child: Text('${formatNumber(latest, locale)} kg', style: AppTheme.display(context, size: 40))),
                if (weights.length >= 2) ...[
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 180,
                    child: LineChart(LineChartData(
                      gridData: const FlGridData(show: false),
                      borderData: FlBorderData(show: false),
                      titlesData: const FlTitlesData(show: false),
                      lineBarsData: [
                        LineChartBarData(
                          spots: [for (final (i, w) in weights.indexed) FlSpot(i.toDouble(), (w['weightKg'] as num).toDouble())],
                          isCurved: true,
                          color: t.colorScheme.primary,
                          barWidth: 3,
                          dotData: const FlDotData(show: true),
                        ),
                      ],
                    )),
                  ),
                ],
                const SizedBox(height: 12),
                for (final r in rows.where((r) => r['weightKg'] != null))
                  ListTile(
                    leading: const Icon(Icons.monitor_weight_outlined),
                    title: Text('${formatNumber(r['weightKg'] as num, locale)} kg'),
                    subtitle: Text(MaterialLocalizations.of(context).formatMediumDate(DateTime.parse(r['measuredAt'] as String))),
                  ),
              ]);
            },
          ),
    );
  }
}
