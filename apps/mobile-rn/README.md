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
| `EXPO_PUBLIC_ORG_LOCAL` | on | `false` turns off the organisation update's local layer (below). **Use `false` for any build given to real users** |

## Checks

```bash
pnpm typecheck
pnpm test
npx expo-doctor
```

## Translations

`src/core/i18n/{en,fr,ar}.json` hold every text (ICU message syntax); add a key to all three files.
Arabic switches the layout to right-to-left (reload).

## Organisation update (local layer)

The organizer space, judging, displays, results, messages, tickets and shop of the organisation update
(design `docs/superpowers/specs/2026-10-22-organisation-update-design.md`) need data the API does not store yet.
Until it does, `src/core/api/org-local.ts` answers those requests on the device:
- **Storage:** AsyncStorage, which is localStorage in the web build.
- **Fields:** extra fields are merged into the API's answers.
- **Live updates:** they travel between the tabs of one browser on `src/core/live-bus.ts` (`BroadcastChannel`).

The screens show a « Local » badge wherever data lives only on the device.

**Pages:**
- **Organizer:** Settings, Pricing, Waiver & form, Roster, Staff, Race, Waves, Live, Tools, Results, Messages,
  Tickets, Shop.
- **Judges:** scorecard-driven floor judging, and `/competitions/<id>/judge/race` for hybrid races.
- **Public:** `/display/<id>/<timer|heat|lane|race|leaderboard|schedule|call>` (TV and stream; `?overlay=1`), and
  `/competitions/<id>/shop`.

**Read next:**
- the backend contract (`docs/organisation-backend-contract.md`), which is the to-do list to move each item to the
  server;
- the demo script (`docs/organisation-demo-script.md`), tested end to end by
  `test/screens/organisation-demo.test.tsx`.

**Limits:**
- the data stays on one device or browser;
- every account signed in there shares it, and it stays after sign-out;
- payments are simulated and messages are not sent.

Because the store keeps personal data (contact emails, codes, teammates, the guardian of a minor, buyers' names),
**build with `EXPO_PUBLIC_ORG_LOCAL=false` for real users** until the server stores it.

