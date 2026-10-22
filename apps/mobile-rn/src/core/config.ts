import { orgLocalEnabled } from './api/org-local';

/**
 * Build-time configuration (EXPO_PUBLIC_* variables, inlined by Metro).
 * The app name is configurable (spec §0): rebranding is a build flag, not a code change.
 */
export const config = {
  appName: process.env.EXPO_PUBLIC_APP_NAME ?? 'Fitness League',
  // 10.0.2.2 is the host machine seen from the Android emulator.
  apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000/api/v1',
  accent: process.env.EXPO_PUBLIC_ACCENT ?? '#C6F432',
  /** Offline demo build: every request is answered on the phone from recorded demo data. */
  demo: process.env.EXPO_PUBLIC_DEMO === 'true',
  /** Organizer features the API does not have yet are kept on the device (`api/org-local.ts`); `false` turns that off. */
  orgLocal: orgLocalEnabled(process.env.EXPO_PUBLIC_ORG_LOCAL),
};
