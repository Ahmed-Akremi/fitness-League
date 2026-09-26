import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../auth/data/session_controller.dart';
import '../../goals/data/goals_repository.dart';
import '../data/me_repository.dart';

/// "I have a goal. I have progress. I have a rank. I have a reason to train today." (spec §1, §19.3)
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    return Scaffold(
      body: SafeArea(
        child: me.when(
          data: (m) => RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(meProvider);
              ref.invalidate(homeDashboardProvider);
              ref.invalidate(goalsProvider);
            },
            child: _HomeBody(me: m),
          ),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(meProvider)),
        ),
      ),
    );
  }
}

class _HomeBody extends ConsumerWidget {
  const _HomeBody({required this.me});
  final Map<String, dynamic> me;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final profile = me['profile'] as Map<String, dynamic>;
    final stats = me['stats'] as Map<String, dynamic>;
    final streak = (me['streak'] as Map<String, dynamic>?) ?? const {};
    final firstName = (profile['fullName'] as String).split(' ').first;
    final hour = DateTime.now().hour;
    final calibrationEnds = profile['calibrationEndsAt'] == null ? null : DateTime.parse(profile['calibrationEndsAt'] as String).toLocal();
    final calibrating = calibrationEnds != null && calibrationEnds.isAfter(DateTime.now());
    final dashboard = ref.watch(homeDashboardProvider);
    final goals = ref.watch(goalsProvider);
    final xpInto = stats['xpIntoLevel'] as int;
    final xpNext = stats['xpForNextLevel'] as int;

    return ListView(padding: const EdgeInsets.all(20), children: [
      Text((hour < 17 ? l.greetingMorning(firstName) : l.greetingEvening(firstName)).toUpperCase(),
          style: t.textTheme.titleMedium?.copyWith(color: t.colorScheme.outline, letterSpacing: 1.1, fontWeight: FontWeight.w800)),
      const SizedBox(height: 16),
      if (me['emailVerified'] != true)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Card(
            color: t.colorScheme.tertiaryContainer,
            child: ListTile(
              leading: const Icon(Icons.mark_email_unread_rounded),
              title: Text(l.emailNotVerified),
              trailing: TextButton(onPressed: () => ref.read(authRepositoryProvider).resendVerification(), child: Text(l.resendEmail)),
            ),
          ),
        ),
      StatCard(
        label: l.level(stats['level'] as int),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          XpBar(value: xpNext == 0 ? 0 : xpInto / xpNext, semanticsLabel: l.level(stats['level'] as int)),
          const SizedBox(height: 8),
          Row(children: [
            Text(l.xpProgress(xpInto, xpNext), style: t.textTheme.bodyMedium),
            const Spacer(),
            const Icon(Icons.local_fire_department_rounded, color: Color(0xFFFF8A3D), size: 20),
            const SizedBox(width: 4),
            Text(l.weekStreak((streak['currentWeeks'] as int?) ?? 0), style: t.textTheme.labelLarge),
          ]),
        ]),
      ),
      if (calibrating) ...[
        const SizedBox(height: 12),
        Card(child: ListTile(leading: const Icon(Icons.tune_rounded), title: Text(l.calibrating(MaterialLocalizations.of(context).formatMediumDate(calibrationEnds))))),
      ],
      const SizedBox(height: 12),
      goals.when(
        data: (list) {
          final active = list.where((g) => g['status'] == 'ACTIVE').toList();
          if (active.isEmpty) {
            return StatCard(label: l.yourGoal, onTap: () => context.go('/goals'), child: Text(l.emptyGoals, style: t.textTheme.titleMedium));
          }
          final g = active.first;
          final unit = (g['metric'] as Map)['unit'] as String;
          final milestones = g['milestones'] as List;
          return StatCard(
            label: l.yourGoal,
            onTap: () => context.go('/goals'),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${formatMetric(g['startValue'] as num, unit, locale)} → ${formatMetric(g['targetValue'] as num, unit, locale)}', style: t.textTheme.headlineMedium),
              const SizedBox(height: 8),
              XpBar(value: milestones.isEmpty ? 0 : (g['milestonesReached'] as int) / milestones.length),
              const SizedBox(height: 6),
              Text(l.goalMilestones(g['milestonesReached'] as int, milestones.length), style: t.textTheme.bodySmall),
            ]),
          );
        },
        loading: () => const SizedBox.shrink(),
        error: (_, _) => const SizedBox.shrink(),
      ),
      const SizedBox(height: 12),
      dashboard.when(
        data: (d) {
          final lp = d['lp'] as Map<String, dynamic>;
          final ranks = d['ranks'] as Map<String, dynamic>;
          final week = d['week'] as Map<String, dynamic>;
          final gov = profile['governorate'] as Map<String, dynamic>;
          return Column(children: [
            StatCard(
              label: l.yourRank,
              onTap: () => context.go('/league'),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (lp.isNotEmpty) Text(l.divisionLp(lp['division'] as String, lp['lp'] as int), style: t.textTheme.titleLarge),
                const SizedBox(height: 8),
                if (ranks['national'] == null)
                  Text(l.emptyLeague, style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.outline))
                else
                  Wrap(spacing: 16, runSpacing: 6, children: [
                    Text('🇹🇳 ${l.rankNational(ranks['national'] as int)}'),
                    if (ranks['governorate'] != null) Text('📍 ${l.rankRegion(ranks['governorate'] as int, localized(gov['name'], locale))}'),
                    if (ranks['gym'] != null) Text('🏋️ ${l.rankGym(ranks['gym'] as int)}'),
                  ]),
              ]),
            ),
            if (week.isNotEmpty) ...[
              const SizedBox(height: 12),
              StatCard(
                label: l.thisWeek,
                child: Row(children: [
                  Text('${(week['total'] as num).round()}', style: t.textTheme.displaySmall?.copyWith(color: t.colorScheme.primary)),
                  const SizedBox(width: 12),
                  Expanded(child: Text('${week['trainingDays']} / ${week['plannedDays']} · ${l.trainingDaysPerWeek}', style: t.textTheme.bodyMedium)),
                ]),
              ),
            ],
          ]);
        },
        loading: () => const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(homeDashboardProvider)),
      ),
      const SizedBox(height: 20),
      FilledButton.icon(
        key: const Key('home-log-workout'),
        onPressed: () => context.push('/workouts/new'),
        icon: const Icon(Icons.add_rounded),
        label: Text(l.logWorkout.toUpperCase()),
      ),
    ]);
  }
}
