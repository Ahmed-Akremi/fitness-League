import 'package:flutter/material.dart';

/// Leaderboard row: rank (medal colours for the podium), optional avatar, name, value; "me" highlighted.
class RankRow extends StatelessWidget {
  const RankRow({super.key, required this.rank, required this.name, required this.value, this.highlight = false, this.leading, this.subtitle, this.onTap, this.onLongPress});
  final int rank;
  final String name;
  final String value;
  final bool highlight;
  final Widget? leading;
  final String? subtitle;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final medal = switch (rank) { 1 => const Color(0xFFFFD166), 2 => const Color(0xFFC0C4CC), 3 => const Color(0xFFE09F6B), _ => t.colorScheme.outline };
    return Semantics(
      label: 'Rank $rank, $name, $value',
      button: onTap != null,
      child: ExcludeSemantics(
        child: Material(
          color: highlight ? t.colorScheme.primary.withValues(alpha: 0.14) : Colors.transparent,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: onTap,
            onLongPress: onLongPress,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 56),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(children: [
                  SizedBox(width: 44, child: Text('#$rank', style: TextStyle(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: 20, color: medal))),
                  if (leading != null) ...[leading!, const SizedBox(width: 12)],
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                      Text(name, style: t.textTheme.titleMedium?.copyWith(fontWeight: highlight ? FontWeight.w800 : FontWeight.w600), overflow: TextOverflow.ellipsis),
                      if (subtitle != null) Text(subtitle!, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline)),
                    ]),
                  ),
                  Text(value, style: const TextStyle(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: 22, fontFeatures: [FontFeature.tabularFigures()])),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
