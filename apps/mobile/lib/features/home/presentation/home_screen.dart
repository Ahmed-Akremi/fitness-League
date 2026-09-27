import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/common.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/avatar_badge.dart';
import '../../../core/widgets/countdown_text.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/gym_logo.dart';
import '../../../core/widgets/section_header.dart';
import '../../gym_wods/data/gym_wods_repository.dart';
import '../../gyms/data/gyms_repository.dart';
import '../../notifications/presentation/notification_bell.dart';
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
    final gym = (profile['gym'] as Map?)?.cast<String, dynamic>();
    final d = dashboard.valueOrNull;
    final lp = (d?['lp'] as Map?)?.cast<String, dynamic>() ?? const {};
    final ranks = (d?['ranks'] as Map?)?.cast<String, dynamic>() ?? const {};
    final week = (d?['week'] as Map?)?.cast<String, dynamic>() ?? const {};
    final division = (lp['division'] ?? stats['division']) as String?;

    return ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 28), children: [
      Row(children: [
        Expanded(
          child: Text((hour < 17 ? l.greetingMorning(firstName) : l.greetingEvening(firstName)).toUpperCase(),
              style: t.textTheme.titleMedium?.copyWith(color: t.colorScheme.outline, letterSpacing: 1.1, fontWeight: FontWeight.w800)),
        ),
        const NotificationBell(),
      ]),
      const SizedBox(height: 12),
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
      // Hero: season LP, division, level progress, streak.
      Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [divisionColor(division).withValues(alpha: 0.35), t.colorScheme.surface]),
        ),
        child: InkWell(
          onTap: () => context.go('/league'),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(l.seasonLp.toUpperCase(), style: t.textTheme.labelMedium?.copyWith(letterSpacing: 1.2, color: t.colorScheme.outline)),
                  Text('${lp['lp'] ?? 0}', style: AppTheme.display(context, size: 56)),
                ]),
              ),
              Column(children: [
                AvatarBadge(name: profile['fullName'] as String, division: division, size: 56),
                const SizedBox(height: 4),
                Text(division ?? '—', style: t.textTheme.labelLarge?.copyWith(color: divisionColor(division), fontWeight: FontWeight.w800)),
              ]),
            ]),
            const SizedBox(height: 14),
            XpBar(value: xpNext == 0 ? 0 : xpInto / xpNext, semanticsLabel: l.level(stats['level'] as int)),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: Text('${l.level(stats['level'] as int)} · ${l.xpProgress(xpInto, xpNext)}', style: t.textTheme.bodySmall, overflow: TextOverflow.ellipsis)),
              const Icon(Icons.local_fire_department_rounded, color: Color(0xFFFF8A3D), size: 18),
              const SizedBox(width: 4),
              Text(l.weekStreak((streak['currentWeeks'] as int?) ?? 0), style: t.textTheme.labelLarge),
            ]),
          ]),
        ),
      ),
      if (calibrating) ...[
        const SizedBox(height: 12),
        Card(child: ListTile(leading: const Icon(Icons.tune_rounded), title: Text(l.calibrating(MaterialLocalizations.of(context).formatMediumDate(calibrationEnds))))),
      ],
      const SizedBox(height: 12),
      if (dashboard.hasError) ErrorView(error: dashboard.error!, onRetry: () => ref.invalidate(homeDashboardProvider)),
      Row(children: [
        Expanded(child: _Tile(label: l.rankNationalShort, value: ranks['national'] == null ? '—' : '#${ranks['national']}', onTap: () => context.go('/league'))),
        const SizedBox(width: 10),
        Expanded(child: _Tile(label: localized((profile['governorate'] as Map)['name'], locale), value: ranks['governorate'] == null ? '—' : '#${ranks['governorate']}', onTap: () => context.go('/league'))),
        const SizedBox(width: 10),
        Expanded(child: _Tile(label: l.thisWeek, value: week['total'] == null ? '—' : '${(week['total'] as num).round()}', caption: week.isEmpty ? null : '${week['trainingDays']}/${week['plannedDays']}')),
      ]),
      SectionHeader(title: l.myGym, actionLabel: l.gymsTitle, onAction: () => context.push('/gyms')),
      if (gym == null)
        Card(
          child: ListTile(
            leading: const Icon(Icons.storefront_outlined),
            title: Text(l.findGym),
            subtitle: Text(l.findGymHint),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => context.push('/gyms'),
          ),
        )
      else
        _MyGymCard(gymId: gym['id'] as String, gymName: gym['name'] as String),
      SectionHeader(title: l.yourGoal, actionLabel: l.navChallenges, onAction: () => context.go('/goals')),
      goals.when(
        data: (list) {
          final active = list.where((g) => g['status'] == 'ACTIVE').toList();
          if (active.isEmpty) return Card(child: ListTile(leading: const Icon(Icons.flag_outlined), title: Text(l.emptyGoals), onTap: () => context.go('/goals')));
          final g = active.first;
          final unit = (g['metric'] as Map)['unit'] as String;
          final milestones = g['milestones'] as List;
          return StatCard(
            label: l.yourGoal,
            onTap: () => context.go('/goals'),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              // Numbers and units read left-to-right, also in Arabic.
              Text('${formatMetric(g['startValue'] as num, unit, locale)} → ${formatMetric(g['targetValue'] as num, unit, locale)}',
                  textDirection: TextDirection.ltr, style: AppTheme.display(context, size: 28)),
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
      SectionHeader(title: l.shortcuts),
      Row(children: [
        for (final (icon, label, route) in [
          (Icons.emoji_events_outlined, l.records, '/records'),
          (Icons.group_outlined, l.friends, '/friends'),
          (Icons.sports_mma_outlined, l.battles, '/battles'),
        ])
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                onPressed: () => context.push(route),
                child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(icon), const SizedBox(height: 4), Text(label, maxLines: 1, overflow: TextOverflow.ellipsis)]),
              ),
            ),
          ),
      ]),
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

class _Tile extends StatelessWidget {
  const _Tile({required this.label, required this.value, this.caption, this.onTap});
  final String label;
  final String value;
  final String? caption;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label.toUpperCase(), maxLines: 1, overflow: TextOverflow.ellipsis, style: t.textTheme.labelSmall?.copyWith(color: t.colorScheme.outline, letterSpacing: 1)),
            const SizedBox(height: 4),
            Text(value, style: AppTheme.display(context, size: 28)),
            if (caption != null) Text(caption!, style: t.textTheme.bodySmall),
          ]),
        ),
      ),
    );
  }
}

/// "My gym": logo, name and the WOD running now (or a hint), tapping opens the gym.
class _MyGymCard extends ConsumerWidget {
  const _MyGymCard({required this.gymId, required this.gymName});
  final String gymId;
  final String gymName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context);
    final gym = ref.watch(gymProvider(gymId)).valueOrNull;
    final wods = ((ref.watch(gymWodsProvider((gymId, 'active'))).valueOrNull?['data'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final wod = wods.firstOrNull;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/gyms/$gymId'),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              GymLogo(name: gymName, url: gym?['logoUrl'] as String?, size: 52),
              const SizedBox(width: 12),
              Expanded(child: Text(gymName, style: t.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800))),
              const Icon(Icons.chevron_right_rounded),
            ]),
            if (wod != null) ...[
              const Divider(height: 24),
              InkWell(
                onTap: () => context.push('/gyms/$gymId/wods/${wod['id']}'),
                child: Row(children: [
                  Icon(Icons.local_fire_department_rounded, color: t.colorScheme.primary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(wod['title'] as String, style: t.textTheme.titleMedium),
                      CountdownText(endsAt: DateTime.parse(wod['endsAt'] as String), style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline)),
                    ]),
                  ),
                  wod['myScore'] == null
                      ? Text(l.wodSubmitScore, style: t.textTheme.labelLarge?.copyWith(color: t.colorScheme.primary))
                      : Text(formatWodScore(wod['scoreType'] as String, (wod['myScore'] as Map).cast<String, dynamic>()), style: AppTheme.display(context, size: 22)),
                ]),
              ),
            ],
          ]),
        ),
      ),
    );
  }
}
