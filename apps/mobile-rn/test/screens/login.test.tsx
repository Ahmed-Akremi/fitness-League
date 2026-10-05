import { fireEvent, waitFor } from 'expo-router/testing-library';

import { useSession } from '../../src/core/auth/session';
import { ForgotPasswordScreen, LoginScreen } from '../../src/features/auth/screens';
import { FakeBackend, session } from '../fake-api';
import { renderScreen } from '../harness';

describe('LoginScreen', () => {
  it('shows a translated error for wrong credentials, then signs in', async () => {
    let attempts = 0;
    const backend = new FakeBackend().on('POST', '/auth/login', () => (++attempts === 1 ? [401, { code: 'INVALID_CREDENTIALS' }] : [200, session()]));
    const screen = await renderScreen(LoginScreen, backend, { status: 'signedOut' });

    await fireEvent.changeText(screen.getByTestId('login-email'), 'ahmed@example.test');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'nope');
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByText('Wrong email or password.')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('login-submit'));
    await waitFor(() => expect(useSession.getState().status).toBe('signedIn'));
  });

  it('tells a judge account to use the admin panel', async () => {
    const backend = new FakeBackend().on('POST', '/auth/login', [403, { code: 'JUDGE_ACCOUNT' }]);
    const screen = await renderScreen(LoginScreen, backend, { status: 'signedOut' });
    await fireEvent.changeText(screen.getByTestId('login-email'), 'judge@example.test');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'secret-password');
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByText(/judge account: judges work in the web admin panel/)).toBeTruthy();
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('validates the form before calling the API', async () => {
    const backend = new FakeBackend();
    const screen = await renderScreen(LoginScreen, backend, { status: 'signedOut' });
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByText('Invalid email')).toBeTruthy();
    expect(backend.requests).toHaveLength(0);
  });
});

describe('ForgotPasswordScreen', () => {
  it('shows the same confirmation whatever the server answers (no account enumeration)', async () => {
    const backend = new FakeBackend().on('POST', '/auth/password/forgot', [404, { code: 'NOT_FOUND' }]);
    const screen = await renderScreen(ForgotPasswordScreen, backend, { status: 'signedOut' });
    await fireEvent.changeText(screen.getByTestId('forgot-email'), 'nobody@example.test');
    await fireEvent.press(screen.getByTestId('forgot-submit'));
    expect(await screen.findByText(/reset link/i)).toBeTruthy();
  });
});
