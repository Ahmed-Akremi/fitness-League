import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n/l10n.dart';

/// Bottom bar (spec §19.1): Home · Train · League · Challenges(Goals) · Profile.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home_rounded), label: l.navHome),
          NavigationDestination(icon: const Icon(Icons.fitness_center_outlined), selectedIcon: const Icon(Icons.fitness_center_rounded), label: l.navTrain),
          NavigationDestination(icon: const Icon(Icons.emoji_events_outlined), selectedIcon: const Icon(Icons.emoji_events_rounded), label: l.navLeague),
          NavigationDestination(icon: const Icon(Icons.flag_outlined), selectedIcon: const Icon(Icons.flag_rounded), label: l.navChallenges),
          NavigationDestination(icon: const Icon(Icons.person_outline_rounded), selectedIcon: const Icon(Icons.person_rounded), label: l.navProfile),
        ],
      ),
    );
  }
}
