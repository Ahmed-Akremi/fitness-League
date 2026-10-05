import { QueryClient } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { setAuthStatus, type AuthStatus } from '../src/core/auth/session';
import type { Locale } from '../src/core/i18n';
import { MemoryOutboxStore, type OutboxStore } from '../src/core/offline/outbox';
import { WorkoutSyncService } from '../src/core/offline/workout-sync';
import { usePrefs } from '../src/core/prefs';
import { NoopRealtime } from '../src/core/realtime';
import { ServicesProvider, type Services } from '../src/core/services';
import { ToastHost } from '../src/core/widgets/kit';
import { fakeClient, type FakeBackend } from './fake-api';

const metrics = { frame: { x: 0, y: 0, width: 432, height: 960 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

export function fakeServices(backend: FakeBackend, store: OutboxStore = new MemoryOutboxStore()): Services {
  const api = fakeClient(backend, { onExpired: () => setAuthStatus('signedOut') });
  return { api, sync: new WorkoutSyncService(api, store), realtime: new NoopRealtime() };
}

export const testQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });

/** Renders a screen inside a router with fake services, translations and an optional locale. */
export async function renderScreen(
  screen: () => ReactElement,
  backend: FakeBackend,
  opts: { locale?: Locale; store?: OutboxStore; status?: AuthStatus; routes?: Record<string, () => ReactElement> } = {},
) {
  usePrefs.setState({ locale: opts.locale ?? 'en', themeMode: 'dark' });
  setAuthStatus(opts.status ?? 'signedIn');
  const services = fakeServices(backend, opts.store);
  const Layout = () => (
    <SafeAreaProvider initialMetrics={metrics}>
      <ServicesProvider services={services} queryClient={testQueryClient()}>
        <Slot />
        <ToastHost />
      </ServicesProvider>
    </SafeAreaProvider>
  );
  const result = await renderRouter({ _layout: Layout, index: screen, ...opts.routes }, { initialUrl: '/' });
  return Object.assign(result, { services });
}

export const page = <T,>(data: T[], nextCursor: string | null = null) => ({ data, page: { nextCursor, hasMore: nextCursor != null } });

export const sports = [
  { id: 'sp-bb', code: 'BODYBUILDING', category: 'STRENGTH', loggingMode: 'SETS_REPS_WEIGHT', icon: 'dumbbell', name: { fr: 'Musculation', en: 'Bodybuilding', ar: 'كمال الأجسام' } },
  { id: 'sp-run', code: 'RUNNING', category: 'CARDIO', loggingMode: 'DISTANCE_TIME', icon: 'run', name: { fr: 'Course à pied', en: 'Running', ar: 'الجري' } },
];

export const squat = { id: 'ex-squat', code: 'BACK_SQUAT', sportId: null, isBodyweight: false, trackedMetrics: ['MAX_WEIGHT', 'E1RM', 'REPS_AT_WEIGHT'], name: { fr: 'Squat', en: 'Back squat', ar: 'سكوات' } };
