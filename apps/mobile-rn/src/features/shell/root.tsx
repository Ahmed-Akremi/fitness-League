import { onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { router, Stack, usePathname, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { DevSettings, I18nManager, Platform, View } from 'react-native';

import { useSession } from '../../core/auth/session';
import { config } from '../../core/config';
import { useLocale, useT } from '../../core/prefs';
import { useServices } from '../../core/services';
import { fonts, useTheme } from '../../core/theme';
import { Loading } from '../../core/widgets/common';
import { ErrorView } from '../../core/widgets/error';
import { ToastHost } from '../../core/widgets/kit';
import { useAuth } from '../auth/api';
import { useMe } from '../me/api';

export type Gate = 'splash' | 'auth' | 'onboarding' | 'app';

/** Routes + guards: signed out → login; signed in but onboarding not done → onboarding. */
export function useGate(): Gate {
  const status = useSession((s) => s.status);
  const me = useMe();
  if (status === 'unknown') return 'splash';
  if (status === 'signedOut') return 'auth';
  if (!me.data) return 'splash';
  return me.data.profile?.onboardingCompleted === true ? 'app' : 'onboarding';
}

/** Paths the gate itself shows: no page of the app to come back to. */
const GATE_PATHS = new Set(['/', '/splash', '/login', '/register', '/forgot-password', '/onboarding']);

/**
 * Pages open whatever the gate (signed in or not): the links mailed by the API and the legal documents. Opened
 * before sign-in, they are done with; they are not reopened once the app is ready.
 */
const PUBLIC_PATHS = ['/verify-email', '/reset-password', '/legal'];
const isPublicPath = (path: string) => PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * A link opened before the app is ready (an address typed on the web, a shared app link on a cold start) is
 * replaced by the splash and sign-in screens, then by the home tab: keep it, and open it once the app is.
 */
function usePendingLink(gate: Gate) {
  const pathname = usePathname();
  const pending = useRef<string | null | undefined>(undefined);
  if (pending.current === undefined) pending.current = gate === 'app' || GATE_PATHS.has(pathname) || isPublicPath(pathname) ? null : pathname;
  useEffect(() => {
    if (gate !== 'app' || !pending.current) return;
    const href = pending.current;
    pending.current = null;
    router.push(href as Href);
  }, [gate]);
}

/** Arabic lays out right-to-left; React Native applies a direction change after a reload. */
function useRtl(rtl: boolean) {
  useEffect(() => {
    // The web build follows the document direction; there is nothing to reload.
    if (Platform.OS === 'web' || Boolean(I18nManager.isRTL) === rtl) return;
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
    if (process.env.NODE_ENV === 'test') return;
    import('expo-updates').then((u) => u.reloadAsync()).catch(() => DevSettings?.reload());
  }, [rtl]);
}

/** App wiring shared by the real layout and the tests (which pass fake services). */
export function AppRoot() {
  const { api, sync, realtime } = useServices();
  const auth = useAuth();
  const status = useSession((s) => s.status);
  const gate = useGate();
  usePendingLink(gate);
  const locale = useLocale();
  const { dark, colors } = useTheme();
  const t = useT();

  api.language = locale;
  useRtl(locale === 'ar');

  useEffect(() => {
    void auth.restore();
  }, [auth]);

  // Live events while signed in (notifications, battle scores); polling remains the fallback.
  useEffect(() => {
    if (status === 'signedIn') realtime.connect();
    else realtime.disconnect();
  }, [status, realtime]);

  // Offline workouts are sent as soon as connectivity comes back (spec §7). NetInfo covers native; in browsers
  // that expose navigator.connection NetInfo only hears its "change" event, so TanStack's online manager (window
  // online/offline events) is a second trigger. Concurrent flushes share one request.
  useEffect(() => {
    const flush = () => {
      if (useSession.getState().status === 'signedIn') sync.flush().catch(() => 0);
    };
    const offNetInfo = NetInfo.addEventListener((s) => s.isConnected && flush());
    const offOnline = onlineManager.subscribe((online) => online && flush());
    return () => {
      offNetInfo();
      offOnline();
    };
  }, [sync]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: fonts.display, fontSize: 26 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          title: config.appName,
        }}
      >
        {/* Public: the email links and the legal pages, in every state of the session. */}
        <Stack.Screen name="verify-email" options={{ title: t('verifyEmailTitle') }} />
        <Stack.Screen name="reset-password" options={{ title: t('resetPasswordTitle') }} />
        <Stack.Screen name="legal/index" options={{ title: t('legalTitle') }} />
        <Stack.Screen name="legal/[doc]" options={{ title: t('legalTitle') }} />
        <Stack.Protected guard={gate === 'splash'}>
          <Stack.Screen name="splash" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={gate === 'auth'}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="register" options={{ title: t('register') }} />
          <Stack.Screen name="forgot-password" options={{ title: t('forgotPassword') }} />
        </Stack.Protected>
        <Stack.Protected guard={gate === 'onboarding'}>
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={gate === 'app'}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="workouts/new" options={{ title: t('logWorkout') }} />
          <Stack.Screen name="workouts/[id]" options={{ title: '' }} />
          <Stack.Screen name="settings" options={{ title: t('settings') }} />
          <Stack.Screen name="progress" options={{ title: t('myProgress') }} />
          <Stack.Screen name="records" options={{ title: t('records') }} />
          <Stack.Screen name="me/body" options={{ title: t('body') }} />
          <Stack.Screen name="badges" options={{ title: t('badges') }} />
          <Stack.Screen name="notifications" options={{ title: t('notifications') }} />
          <Stack.Screen name="challenges/new" options={{ title: t('newChallenge') }} />
          <Stack.Screen name="challenges/[id]" options={{ title: t('challengeDetail') }} />
          <Stack.Screen name="friends" options={{ title: t('friends') }} />
          <Stack.Screen name="search" options={{ title: t('findAthletes') }} />
          <Stack.Screen name="u/[username]" options={{ title: '' }} />
          <Stack.Screen name="feed" options={{ title: t('feed') }} />
          <Stack.Screen name="battles/index" options={{ title: t('battles') }} />
          <Stack.Screen name="battles/new" options={{ title: t('newBattle') }} />
          <Stack.Screen name="battles/[id]" options={{ title: t('battles') }} />
          <Stack.Screen name="leagues/new" options={{ title: t('newLeague') }} />
          <Stack.Screen name="leagues/[id]" options={{ title: t('privateLeague') }} />
          <Stack.Screen name="gyms/index" options={{ title: t('gymsTitle') }} />
          <Stack.Screen name="gyms/new" options={{ title: t('addMyGym') }} />
          <Stack.Screen name="gyms/[id]/index" options={{ title: '' }} />
          <Stack.Screen name="gyms/[id]/members" options={{ title: t('gymManageMembers') }} />
          <Stack.Screen name="gyms/[id]/dashboard" options={{ title: t('gymDashboard') }} />
          <Stack.Screen name="gyms/[id]/wods/new" options={{ title: t('wodCreate') }} />
          <Stack.Screen name="gyms/[id]/wods/[wodId]" options={{ title: t('gymWods') }} />
          <Stack.Screen name="gym-wars/[id]" options={{ title: t('gymWar') }} />
          <Stack.Screen name="competitions/index" options={{ title: t('competitions') }} />
          <Stack.Screen name="competitions/new" options={{ title: t('createEvent') }} />
          <Stack.Screen name="competitions/[id]/index" options={{ title: t('competitions') }} />
          <Stack.Screen name="competitions/[id]/manage" options={{ title: t('orgManage') }} />
          <Stack.Screen name="competitions/[id]/register" options={{ title: t('compRegister') }} />
          <Stack.Screen name="competitions/[id]/wods/[wodId]/submit" options={{ title: t('compSubmitScore') }} />
          <Stack.Screen name="competitions/[id]/my-heats" options={{ title: t('myHeatsTitle') }} />
          <Stack.Screen name="competitions/[id]/judge/index" options={{ title: t('floorOpenSpace') }} />
          <Stack.Screen name="competitions/[id]/judge/[heatId]" options={{ title: t('floorOpenSpace') }} />
        </Stack.Protected>
      </Stack>
      <ToastHost />
    </View>
  );
}

/** Startup: waits for the session and the profile; offers a retry when the API is unreachable. */
export function SplashScreen() {
  const signedIn = useSession((s) => s.status === 'signedIn');
  const me = useMe();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {signedIn && me.isError ? <ErrorView error={me.error} onRetry={() => me.refetch()} /> : <Loading />}
    </View>
  );
}
