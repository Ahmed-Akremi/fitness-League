import NetInfo from '@react-native-community/netinfo';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { DevSettings, I18nManager, View } from 'react-native';

import { useSession } from '../../core/auth/session';
import { config } from '../../core/config';
import { useLocale, useT } from '../../core/prefs';
import { useServices } from '../../core/services';
import { useTheme } from '../../core/theme';
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

/** Arabic lays out right-to-left; React Native applies a direction change after a reload. */
function useRtl(rtl: boolean) {
  useEffect(() => {
    if (I18nManager.isRTL === rtl) return;
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
    if (process.env.NODE_ENV === 'test') return;
    import('expo-updates').then((u) => u.reloadAsync()).catch(() => DevSettings.reload());
  }, [rtl]);
}

/** App wiring shared by the real layout and the tests (which pass fake services). */
export function AppRoot() {
  const { api, sync, realtime } = useServices();
  const auth = useAuth();
  const status = useSession((s) => s.status);
  const gate = useGate();
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

  // Offline workouts are sent as soon as connectivity comes back (spec §7).
  useEffect(
    () =>
      NetInfo.addEventListener((s) => {
        if (s.isConnected && useSession.getState().status === 'signedIn') sync.flush().catch(() => 0);
      }),
    [sync],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          title: config.appName,
        }}
      >
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
