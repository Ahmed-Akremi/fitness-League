import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { setAuthStatus, useSession } from '../../src/core/auth/session';
import { usePrefs } from '../../src/core/prefs';
import { ServicesProvider } from '../../src/core/services';
import { AppRoot } from '../../src/features/shell/root';
import { FakeBackend, session } from '../fake-api';
import { fakeServices, testQueryClient } from '../harness';

const stub = (label: string) => () => <Text>{label}</Text>;

async function boot(backend: FakeBackend, refreshToken: string | null) {
  usePrefs.setState({ locale: 'en', themeMode: 'dark' });
  setAuthStatus('unknown');
  const services = fakeServices(backend);
  if (refreshToken) await services.api.tokens.writeRefreshToken(refreshToken);
  const Layout = () => (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <ServicesProvider services={services} queryClient={testQueryClient()}>
        <AppRoot />
      </ServicesProvider>
    </SafeAreaProvider>
  );
  return renderRouter(
    {
      _layout: Layout,
      splash: stub('splash'),
      login: stub('login'),
      register: stub('register'),
      'forgot-password': stub('forgot'),
      onboarding: stub('onboarding'),
      '(tabs)/index': stub('home'),
      'workouts/new': stub('log'),
      'workouts/[id]': stub('detail'),
    },
    { initialUrl: '/' },
  );
}

describe('startup guard', () => {
  it('sends a signed-out athlete to login', async () => {
    const r = await boot(new FakeBackend(), null);
    expect(await r.findByText('login')).toBeTruthy();
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('restores the session and sends an unfinished profile to onboarding', async () => {
    const backend = new FakeBackend()
      .on('POST', '/auth/refresh', [200, session('2')])
      .on('POST', '/workouts/sync', [200, { results: [] }])
      .on('GET', '/me', [200, { id: 'u1', username: 'ahmed', profile: { onboardingCompleted: false } }]);
    const r = await boot(backend, 'refresh-1');
    expect(await r.findByText('onboarding')).toBeTruthy();
  });

  it('opens the tabs once onboarding is done', async () => {
    const backend = new FakeBackend()
      .on('POST', '/auth/refresh', [200, session('2')])
      .on('GET', '/me', [200, { id: 'u1', username: 'ahmed', profile: { onboardingCompleted: true } }]);
    const r = await boot(backend, 'refresh-1');
    expect(await r.findByText('home')).toBeTruthy();
  });
});
