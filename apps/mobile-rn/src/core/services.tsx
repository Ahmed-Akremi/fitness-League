import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { ApiClient } from './api/client';
import { demoFetch } from './api/demo-backend';
import { setAuthStatus } from './auth/session';
import { SecureTokenStorage, WebTokenStorage } from './auth/token-storage';
import { config } from './config';
import { MemoryOutboxStore } from './offline/outbox';
import { WorkoutSyncService } from './offline/workout-sync';
import { NoopRealtime, SocketRealtime, type Realtime } from './realtime';

export interface Services {
  api: ApiClient;
  sync: WorkoutSyncService;
  realtime: Realtime;
}

/** Real implementations; the demo build answers every request on the phone (no server). */
export function createServices(): Services {
  const onExpired = () => setAuthStatus('signedOut');
  if (config.demo) {
    const api = new ApiClient('http://demo/api/v1', new SecureTokenStorage(), onExpired, demoFetch(require('../../assets/demo/api.json')));
    return { api, sync: new WorkoutSyncService(api, new MemoryOutboxStore()), realtime: new NoopRealtime() };
  }
  // Web is a preview target: tokens in localStorage, the offline queue in memory (as in the Flutter web build).
  const web = Platform.OS === 'web';
  const api = new ApiClient(config.apiBaseUrl, web ? new WebTokenStorage() : new SecureTokenStorage(), onExpired);
  // Loaded lazily so tests, the demo and the web build never open the native database.
  const store = web ? new MemoryOutboxStore() : new (require('./offline/sqlite-outbox') as typeof import('./offline/sqlite-outbox')).SqliteOutboxStore();
  return {
    api,
    sync: new WorkoutSyncService(api, store),
    realtime: new SocketRealtime(config.apiBaseUrl, () => api.accessToken),
  };
}

const ServicesContext = createContext<Services | null>(null);

export function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 }, mutations: { retry: false } } });
}

/** Services + TanStack Query. Tests pass fakes and their own client. */
export function ServicesProvider({ services, queryClient, children }: { services: Services; queryClient?: QueryClient; children: ReactNode }) {
  const [client] = useState(() => queryClient ?? newQueryClient());
  return (
    <ServicesContext.Provider value={services}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ServicesContext.Provider>
  );
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices outside ServicesProvider');
  return s;
}

export const useApi = () => useServices().api;
