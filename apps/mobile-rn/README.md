# Fitness League — React Native (Expo)

The mobile app (it replaced the earlier Flutter app; design: `docs/superpowers/specs/2026-09-30-react-native-port-design.md`).
Expo SDK 57, expo-router, TanStack Query, Zustand, expo-sqlite (offline outbox), socket.io.

## Run

```bash
pnpm install                      # from the repo root
pnpm infra:up && pnpm --filter @fitness-league/api dev   # the API
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

`src/core/i18n/{en,fr,ar}.json` hold every text (ICU message syntax); add a key to all three files.
Arabic switches the layout to right-to-left (reload).
