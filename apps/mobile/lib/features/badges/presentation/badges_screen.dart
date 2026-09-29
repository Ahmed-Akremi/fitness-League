import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/section_header.dart';
import '../../../core/widgets/skeleton.dart';
import '../data/badges_repository.dart';

/// Badge collection: earned badges in colour, locked ones greyed with their progress (docs §3.10).
class BadgesScreen extends ConsumerWidget {
  const BadgesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final badges = ref.watch(badgesProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.badges)),
      body: badges.when(
        loading: () => const SkeletonList(count: 4, height: 96),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(badgesProvider)),
        data: (all) {
          final earned = all.where((b) => b['awardedAt'] != null).length;
          final categories = <String, List<Map<String, dynamic>>>{};
          for (final b in all) {
            categories.putIfAbsent(b['category'] as String, () => []).add(b);
          }
          return RefreshIndicator(
            onRefresh: () => ref.refresh(badgesProvider.future),
            child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
              Text(l.badgesEarned(earned, all.length), style: Theme.of(context).textTheme.titleMedium),
              for (final e in categories.entries) ...[
                SectionHeader(title: _categoryLabel(l, e.key)),
                GridView.count(
                  crossAxisCount: 3,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: 8,
                  crossAxisSpacing: 8,
                  childAspectRatio: 0.78,
                  children: [for (final b in e.value) _BadgeTile(badge: b)],
                ),
              ],
            ]),
          );
        },
      ),
    );
  }

  String _categoryLabel(AppLocalizations l, String c) => switch (c) {
        'PROGRESS' => l.badgeCategoryProgress,
        'CONSISTENCY' => l.badgeCategoryConsistency,
        'COMPETITION' => l.badgeCategoryCompetition,
        'SOCIAL' => l.badgeCategorySocial,
        'GYM' => l.badgeCategoryGym,
        _ => l.badgeCategoryElite,
      };
}

IconData badgeIcon(String? icon) => switch (icon) {
      'dumbbell' || 'first-step' => Icons.fitness_center_rounded,
      'trophy' => Icons.emoji_events_rounded,
      'trending-up' => Icons.trending_up_rounded,
      'flag' => Icons.flag_rounded,
      'flame' => Icons.local_fire_department_rounded,
      'swords' => Icons.sports_mma_rounded,
      'bolt' => Icons.bolt_rounded,
      'medal' => Icons.military_tech_rounded,
      'diamond' => Icons.diamond_rounded,
      'crown' => Icons.workspace_premium_rounded,
      'star' => Icons.star_rounded,
      'users' => Icons.group_rounded,
      'building' => Icons.store_rounded,
      'shield' => Icons.shield_rounded,
      'target' => Icons.track_changes_rounded,
      _ => Icons.verified_rounded,
    };

class _BadgeTile extends StatelessWidget {
  const _BadgeTile({required this.badge});
  final Map<String, dynamic> badge;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final earned = badge['awardedAt'] != null;
    final p = (badge['progress'] as Map?)?.cast<String, dynamic>();
    final color = switch (badge['rarity']) {
      'LEGENDARY' => Colors.amber,
      'EPIC' => Colors.purpleAccent,
      'RARE' => Colors.lightBlueAccent,
      _ => t.colorScheme.primary,
    };
    final name = localized(badge['name'], locale);
    return Tooltip(
      message: localized(badge['description'], locale),
      triggerMode: TooltipTriggerMode.tap,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: earned ? color.withValues(alpha: 0.18) : t.colorScheme.surfaceContainerHighest,
              child: Icon(badgeIcon(badge['icon'] as String?), color: earned ? color : t.colorScheme.outline, semanticLabel: name),
            ),
            const SizedBox(height: 8),
            Text(name, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: t.textTheme.labelMedium?.copyWith(color: earned ? null : t.colorScheme.outline)),
            if (!earned && p != null) ...[
              const SizedBox(height: 6),
              LinearProgressIndicator(value: (p['current'] as num) / (p['target'] as num), minHeight: 4),
              const SizedBox(height: 2),
              Text('${p['current']}/${p['target']}', style: t.textTheme.labelSmall?.copyWith(color: t.colorScheme.outline)),
            ],
          ]),
        ),
      ),
    );
  }
}
