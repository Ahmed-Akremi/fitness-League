import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/widgets/error_text.dart';
import 'features/auth/data/session_controller.dart';
import 'features/battles/presentation/battle_screen.dart';
import 'features/battles/presentation/battles_screen.dart';
import 'features/battles/presentation/new_battle_screen.dart';
import 'features/auth/presentation/login_screen.dart';
import 'features/auth/presentation/register_screen.dart';
import 'features/goals/presentation/goals_screen.dart';
import 'features/gym_wods/presentation/create_wod_screen.dart';
import 'features/gym_wods/presentation/wod_screen.dart';
import 'features/gyms/presentation/gym_members_screen.dart';
import 'features/gyms/presentation/gym_profile_screen.dart';
import 'features/gyms/presentation/gyms_screen.dart';
import 'features/home/data/me_repository.dart';
import 'features/home/presentation/home_screen.dart';
import 'features/league/presentation/league_screen.dart';
import 'features/onboarding/presentation/onboarding_screen.dart';
import 'features/profile/presentation/profile_screen.dart';
import 'features/progress/presentation/progress_screen.dart';
import 'features/shell/app_shell.dart';
import 'features/social/presentation/friends_screen.dart';
import 'features/social/presentation/public_profile_screen.dart';
import 'features/social/presentation/search_screen.dart';
import 'features/workouts/presentation/log_workout_screen.dart';
import 'features/workouts/presentation/train_screen.dart';
import 'features/workouts/presentation/workout_detail_screen.dart';

/// Startup: waits for the session and the profile; offers a retry when the API is unreachable.
class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    final signedIn = ref.watch(sessionProvider) == AuthStatus.signedIn;
    return Scaffold(
      body: signedIn && me.hasError
          ? ErrorView(error: me.error!, onRetry: () => ref.invalidate(meProvider))
          : const Center(child: CircularProgressIndicator()),
    );
  }
}

/// Routes + guards: signed out → /login; signed in but onboarding not done → /onboarding.
final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier(0);
  ref.listen(sessionProvider, (_, _) => refresh.value++);
  ref.listen(meProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(sessionProvider);
      final loc = state.matchedLocation;
      final public = loc == '/login' || loc == '/register';
      if (auth == AuthStatus.unknown) return loc == '/splash' ? null : '/splash';
      if (auth == AuthStatus.signedOut) return public ? null : '/login';
      final me = ref.read(meProvider).valueOrNull;
      if (me == null) return loc == '/splash' ? null : '/splash';
      final onboarded = (me['profile'] as Map?)?['onboardingCompleted'] == true;
      if (!onboarded) return loc == '/onboarding' ? null : '/onboarding';
      if (public || loc == '/splash' || loc == '/onboarding') return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/register', builder: (_, _) => const RegisterScreen()),
      GoRoute(path: '/onboarding', builder: (_, _) => const OnboardingScreen()),
      GoRoute(path: '/workouts/new', builder: (_, _) => const LogWorkoutScreen()),
      GoRoute(path: '/workouts/:id', builder: (_, s) => WorkoutDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/progress', builder: (_, _) => const ProgressScreen()),
      GoRoute(path: '/gyms', builder: (_, _) => const GymsScreen()),
      GoRoute(path: '/friends', builder: (_, _) => const FriendsScreen()),
      GoRoute(path: '/battles', builder: (_, _) => const BattlesScreen()),
      GoRoute(path: '/battles/new', builder: (_, s) => NewBattleScreen(opponentId: s.uri.queryParameters['opponent'])),
      GoRoute(path: '/battles/:id', builder: (_, s) => BattleScreen(id: s.pathParameters['id']!, myId: (ref.read(meProvider).valueOrNull?['id'] ?? '') as String)),
      GoRoute(path: '/search', builder: (_, _) => const SearchScreen()),
      GoRoute(path: '/u/:username', builder: (_, s) => PublicProfileScreen(username: s.pathParameters['username']!)),
      GoRoute(path: '/gyms/:id', builder: (_, s) => GymProfileScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/gyms/:id/members', builder: (_, s) => GymMembersScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/gyms/:id/wods/new', builder: (_, s) => CreateWodScreen(gymId: s.pathParameters['id']!)),
      GoRoute(
        path: '/gyms/:id/wods/:wodId',
        builder: (_, s) => WodScreen(gymId: s.pathParameters['id']!, wodId: s.pathParameters['wodId']!, myId: (ref.read(meProvider).valueOrNull?['id'] ?? '') as String),
      ),
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/', builder: (_, _) => const HomeScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/train', builder: (_, _) => const TrainScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/league', builder: (_, _) => const LeagueScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/goals', builder: (_, _) => const GoalsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/profile', builder: (_, _) => const ProfileScreen())]),
        ],
      ),
    ],
  );
});
