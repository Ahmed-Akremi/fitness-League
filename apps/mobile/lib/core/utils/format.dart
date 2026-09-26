import 'package:intl/intl.dart';

String formatNumber(num n, String locale) => NumberFormat.decimalPattern(locale).format(n);

/// 1500 s → "25:00", 3725 s → "1:02:05".
String formatDuration(int seconds) {
  final h = seconds ~/ 3600;
  final m = (seconds % 3600) ~/ 60;
  final s = seconds % 60;
  String two(int v) => v.toString().padLeft(2, '0');
  return h > 0 ? '$h:${two(m)}:${two(s)}' : '$m:${two(s)}';
}

/// Displays a metric value in its unit.
String formatMetric(num value, String unit, String locale) => switch (unit) {
      's' || 's_per_km' => formatDuration(value.round()) + (unit == 's_per_km' ? '/km' : ''),
      'm' => '${formatNumber((value / 1000 * 100).round() / 100, locale)} km',
      'kg' => '${formatNumber(value, locale)} kg',
      _ => formatNumber(value, locale),
    };

/// Localised name from the API's {fr, en, ar} objects.
String localized(Object? i18n, String locale) {
  if (i18n is Map) return (i18n[locale] ?? i18n['fr'] ?? i18n['en'] ?? '').toString();
  return i18n?.toString() ?? '';
}
