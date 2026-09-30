# Fitness League — React Native (Expo)

React Native port of the Flutter app in `apps/mobile` (design: `docs/superpowers/specs/2026-09-30-react-native-port-design.md`).
Expo SDK 57, expo-router, TanStack Query, Zustand, expo-sqlite (offline outbox), socket.io.

## Run

```bash
pnpm install                      # from the repo root
pnpm infra:up && pnpm --filter @fitness-league/api dev   # the API, as for the Flutter app
cd apps/mobile-rn
npx expo run:android              # development build (native modules: sqlite, secure-store, datetimepicker)
```

Configuration (`EXPO_PUBLIC_*`, read at build time):

| Variable | Default | |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://10.0.2.2:3000/api/v1` | API base URL (10.0.2.2 = host seen from the Android emulator) |
| `EXPO_PUBLIC_DEMO` | `false` | `true` answers every request on the phone from `assets/demo/api.json` |
| `EXPO_PUBLIC_APP_NAME` | `Fitness League` | Rebranding is a build flag |
| `EXPO_PUBLIC_ACCENT` | `#C6F432` | Accent colour |

## Checks

```bash
pnpm typecheck
pnpm test
npx expo-doctor
```

## Translations

`src/core/i18n/{en,fr,ar}.json` are generated from the Flutter ARB files (ICU syntax kept):
`pnpm i18n` after editing `apps/mobile/lib/core/l10n/*.arb`. Arabic switches the layout to right-to-left (reload).
