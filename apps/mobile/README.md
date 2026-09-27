# Fitness League — mobile app (Flutter)

Android + iOS client. Riverpod (state), go_router (navigation + auth/onboarding guards), dio (API with
single-flight token refresh), Drift (offline workout outbox), fr/en/ar with right-to-left Arabic.

## Run

```bash
flutter pub get
dart run build_runner build --delete-conflicting-outputs   # Drift code
flutter gen-l10n                                            # translations
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1   # Android emulator → local API
```

Build-time flags (`--dart-define`): `APP_NAME` (default "Fitness League"), `API_BASE_URL`, `ACCENT_COLOR` (ARGB int).

Web preview (same UI as the phone app):

```bash
flutter build web --dart-define=API_BASE_URL=http://localhost:3000/api/v1
cd build/web && python3 -m http.server 8080      # the API must allow http://localhost:8080 in CORS_ORIGINS
```

Fonts (Barlow Condensed, Inter) are bundled in `assets/fonts` under the SIL Open Font License (`OFL-*.txt`).
Gym photos use `image_picker` (iOS usage strings are in `ios/Runner/Info.plist`).

## Structure

```
lib/
  core/        config, theme, network (ApiClient, ApiError), storage (tokens), offline (outbox + sync), l10n, widgets
  features/    auth · onboarding · home · workouts · progress · league · goals · profile · shell
               each: data/ (repositories, providers) and presentation/ (screens)
  router.dart  routes and redirects (signed out → /login, onboarding not done → /onboarding)
```

The app never computes points: it sends raw workouts and displays what the server returns (docs §9.1).

## Tests

```bash
flutter test
```

Unit tests cover token refresh (one refresh for concurrent 401s) and offline sync (queue, batch flush, conflicts);
widget tests cover login, onboarding, workout logging (online, offline, rejected) and the leaderboard (paging, RTL).
