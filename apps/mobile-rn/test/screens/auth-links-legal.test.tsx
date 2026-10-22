import { fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { setAuthStatus, useSession } from '../../src/core/auth/session';
import type { Locale } from '../../src/core/i18n';
import { usePrefs } from '../../src/core/prefs';
import { ServicesProvider } from '../../src/core/services';
import { ResetPasswordScreen, VerifyEmailScreen } from '../../src/features/auth/links';
import { LEGAL_DOCS, legalDoc } from '../../src/features/legal/content';
import { LegalDocScreen, LegalIndexScreen } from '../../src/features/legal/screens';
import { AccountSection, LegalSection } from '../../src/features/settings/screen';
import { AppRoot } from '../../src/features/shell/root';
import { FakeBackend } from '../fake-api';
import { fakeServices, renderScreen, testQueryClient } from '../harness';

const TOKEN = 'a-token-long-enough-for-the-api-1234';
const invalid = [422, { code: 'TOKEN_INVALID' }] as [number, unknown];

describe('verify-email page', () => {
  it('checks the link once, then sends a signed-in user on', async () => {
    const backend = new FakeBackend().on('POST', '/auth/email/verify', [200, {}]).on('GET', '/me', [200, { id: 'u1', emailVerified: true }]);
    const screen = await renderScreen(() => <VerifyEmailScreen token={TOKEN} />, backend);
    expect(await screen.findByText('Email verified')).toBeTruthy();
    expect(backend.calls('POST', '/auth/email/verify')).toEqual([expect.objectContaining({ body: { token: TOKEN } })]);
    expect(screen.getByTestId('verify-continue')).toBeTruthy();
  });

  it('an expired link offers a new email to a signed-in user', async () => {
    const backend = new FakeBackend().on('POST', '/auth/email/verify', invalid).on('POST', '/auth/email/resend', [200, {}]);
    const screen = await renderScreen(() => <VerifyEmailScreen token={TOKEN} />, backend);
    expect(await screen.findByText('Invalid or expired link')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('verify-resend'));
    expect(await screen.findByTestId('verify-resent')).toBeTruthy();
    expect(backend.calls('POST', '/auth/email/resend')).toHaveLength(1);
  });

  it('signed out: an expired link sends to the login, a link without token is not even sent', async () => {
    const backend = new FakeBackend().on('POST', '/auth/email/verify', invalid);
    const screen = await renderScreen(() => <VerifyEmailScreen token={TOKEN} />, backend, { status: 'signedOut' });
    expect(await screen.findByText('This link was already used or has expired. Sign in to get a new email.')).toBeTruthy();
    expect(screen.queryByTestId('verify-resend')).toBeNull();
    expect(screen.getByTestId('verify-login')).toBeTruthy();

    const empty = new FakeBackend();
    const none = await renderScreen(() => <VerifyEmailScreen />, empty, { status: 'signedOut' });
    expect(await none.findByText('Invalid or expired link')).toBeTruthy();
    expect(empty.requests).toHaveLength(0);
  });
});

describe('reset-password page', () => {
  it('needs 10 characters typed twice the same, then sends the new password', async () => {
    const backend = new FakeBackend().on('POST', '/auth/password/reset', [200, {}]);
    const screen = await renderScreen(() => <ResetPasswordScreen token={TOKEN} />, backend, { status: 'signedOut' });
    await fireEvent.changeText(screen.getByTestId('reset-password'), 'short');
    expect(screen.getAllByText('At least 10 characters').length).toBeGreaterThan(0);
    await fireEvent.changeText(screen.getByTestId('reset-password'), 'correct horse battery');
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'correct horse batterx');
    expect(screen.getByText('The two passwords differ.')).toBeTruthy();
    expect(screen.getByTestId('reset-submit')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'correct horse battery');
    await fireEvent.press(screen.getByTestId('reset-submit'));
    expect(await screen.findByText('Password changed')).toBeTruthy();
    expect(backend.calls('POST', '/auth/password/reset')[0].body).toEqual({ token: TOKEN, newPassword: 'correct horse battery' });
  });

  it('a signed-in phone is signed out after the reset', async () => {
    const backend = new FakeBackend().on('POST', '/auth/password/reset', [200, {}]);
    const screen = await renderScreen(() => <ResetPasswordScreen token={TOKEN} />, backend);
    await fireEvent.changeText(screen.getByTestId('reset-password'), 'correct horse battery');
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'correct horse battery');
    await fireEvent.press(screen.getByTestId('reset-submit'));
    await waitFor(() => expect(useSession.getState().status).toBe('signedOut'));
  });

  it('an expired link asks for a new one', async () => {
    const backend = new FakeBackend().on('POST', '/auth/password/reset', invalid);
    const screen = await renderScreen(() => <ResetPasswordScreen token={TOKEN} />, backend, { status: 'signedOut' });
    await fireEvent.changeText(screen.getByTestId('reset-password'), 'correct horse battery');
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'correct horse battery');
    await fireEvent.press(screen.getByTestId('reset-submit'));
    expect(await screen.findByText('Invalid or expired link')).toBeTruthy();
    expect(screen.getByTestId('reset-again')).toBeTruthy();
  });
});

describe('legal documents', () => {
  it('every document exists in the three languages with the same sections', () => {
    for (const id of LEGAL_DOCS) {
      const counts = (['fr', 'en', 'ar'] as Locale[]).map((l) => legalDoc(id, l)!.sections.length);
      expect(new Set(counts).size).toBe(1);
    }
    expect(legalDoc('nope', 'fr')).toBeNull();
  });

  it('lists the documents and opens one in the app language', async () => {
    const screen = await renderScreen(() => <LegalIndexScreen />, new FakeBackend(), { status: 'signedOut' });
    expect(screen.getByText('Terms and conditions')).toBeTruthy();
    expect(screen.getByText('Privacy policy')).toBeTruthy();
    expect(screen.getByText('Health data')).toBeTruthy();
    const fr = await renderScreen(() => <LegalDocScreen id="privacy" />, new FakeBackend(), { status: 'signedOut', locale: 'fr' });
    expect(fr.getByText('Les données que nous traitons, pourquoi, combien de temps, et tes droits.')).toBeTruthy();
    expect(fr.getByText('7. Tes droits')).toBeTruthy();
  });

  it('an unknown document says so', async () => {
    const screen = await renderScreen(() => <LegalDocScreen id="nope" />, new FakeBackend());
    expect(screen.getByText('This document does not exist.')).toBeTruthy();
  });
});

describe('settings: account and legal', () => {
  const me = (emailVerified: boolean) => ({ id: 'u1', username: 'ahmed', email: 'ahmed@example.test', emailVerified, profile: { onboardingCompleted: true }, settings: {} });

  it('shows the email and its state; resends the verification; mails a password reset link', async () => {
    const backend = new FakeBackend()
      .on('GET', '/me', [200, me(false)])
      .on('POST', '/auth/email/resend', [200, {}])
      .on('POST', '/auth/password/forgot', [202, {}]);
    const screen = await renderScreen(() => <AccountSection />, backend);
    expect(await screen.findByText('ahmed@example.test')).toBeTruthy();
    expect(screen.getByText('Address not verified yet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('account-resend'));
    await waitFor(() => expect(backend.calls('POST', '/auth/email/resend')).toHaveLength(1));
    await fireEvent.press(screen.getByTestId('account-password'));
    await waitFor(() => expect(backend.calls('POST', '/auth/password/forgot')[0]?.body).toEqual({ email: 'ahmed@example.test' }));
    expect(await screen.findByText('Link sent to ahmed@example.test')).toBeTruthy();
  });

  it('a verified address has nothing to resend', async () => {
    const screen = await renderScreen(() => <AccountSection />, new FakeBackend().on('GET', '/me', [200, me(true)]));
    expect(await screen.findByText('Address verified')).toBeTruthy();
    expect(screen.queryByTestId('account-resend')).toBeNull();
  });

  it('lists the legal documents', async () => {
    const screen = await renderScreen(() => <LegalSection />, new FakeBackend());
    for (const id of LEGAL_DOCS) expect(screen.getByTestId(`settings-legal-${id}`)).toBeTruthy();
  });
});

describe('navigation: the public pages', () => {
  const stub = (label: string) => () => <Text>{label}</Text>;
  async function boot(initialUrl: string) {
    usePrefs.setState({ locale: 'en', themeMode: 'dark' });
    setAuthStatus('unknown');
    const services = fakeServices(new FakeBackend());
    const Layout = () => (
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <ServicesProvider services={services} queryClient={testQueryClient()}>
          <AppRoot />
        </ServicesProvider>
      </SafeAreaProvider>
    );
    return renderRouter(
      { _layout: Layout, splash: stub('splash'), login: stub('login'), '(tabs)/index': stub('home'), 'reset-password': stub('reset page'), 'legal/[doc]': stub('legal page') },
      { initialUrl },
    );
  }

  it('a signed-out user opens the reset link and a legal document instead of the login', async () => {
    expect(await (await boot('/reset-password?token=abc')).findByText('reset page')).toBeTruthy();
    expect(await (await boot('/legal/terms')).findByText('legal page')).toBeTruthy();
  });
});
