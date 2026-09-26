import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../home/data/me_repository.dart';
import 'auth_repository.dart';

enum AuthStatus { unknown, signedOut, signedIn }

final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepository(ref.watch(apiClientProvider)));

/// Who is signed in. `unknown` while the stored refresh token is being tried at startup.
class SessionController extends StateNotifier<AuthStatus> {
  SessionController(this.ref) : super(AuthStatus.unknown) {
    ref.listen<int>(sessionExpiredProvider, (_, _) => state = AuthStatus.signedOut);
  }

  final Ref ref;

  Future<void> restore() async {
    final ok = await ref.read(apiClientProvider).restore();
    ref.invalidate(meProvider);
    state = ok ? AuthStatus.signedIn : AuthStatus.signedOut;
    if (ok) await ref.read(workoutSyncProvider).flush().catchError((_) => 0);
  }

  Future<void> login(String email, String password) async {
    await ref.read(authRepositoryProvider).login(email, password);
    ref.invalidate(meProvider); // never show the previous user's data
    state = AuthStatus.signedIn;
  }

  Future<void> register(RegistrationData data) async {
    await ref.read(authRepositoryProvider).register(data);
    ref.invalidate(meProvider);
    state = AuthStatus.signedIn;
  }

  Future<void> logout() async {
    await ref.read(authRepositoryProvider).logout();
    state = AuthStatus.signedOut;
    ref.invalidate(meProvider);
  }
}

final sessionProvider = StateNotifierProvider<SessionController, AuthStatus>((ref) => SessionController(ref));
