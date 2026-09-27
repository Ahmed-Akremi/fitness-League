import 'package:flutter/material.dart';

import '../utils/format.dart';

IconData sportIcon(String code) => switch (code) {
      'CROSSFIT' => Icons.sports_gymnastics_rounded,
      'HYROX' => Icons.flag_circle_rounded,
      'RUNNING' => Icons.directions_run_rounded,
      'CYCLING' => Icons.directions_bike_rounded,
      'SWIMMING' => Icons.pool_rounded,
      'WALKING' => Icons.directions_walk_rounded,
      'FUNCTIONAL' => Icons.bolt_rounded,
      _ => Icons.fitness_center_rounded,
    };

/// Sport pill; selectable when [onTap] is set (filters).
class SportChip extends StatelessWidget {
  const SportChip({super.key, required this.code, required this.name, this.selected = false, this.onTap});
  final String code;
  final Object? name;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final label = Text(localized(name, Localizations.localeOf(context).languageCode));
    final avatar = Icon(sportIcon(code), size: 16);
    return onTap == null
        ? Chip(avatar: avatar, label: label, visualDensity: VisualDensity.compact, materialTapTargetSize: MaterialTapTargetSize.shrinkWrap)
        : FilterChip(avatar: avatar, label: label, selected: selected, onSelected: (_) => onTap!(), showCheckmark: false);
  }
}
