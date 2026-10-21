import { Platform } from 'react-native';

import { defaultThemeMode, migratePrefs, usePrefs } from '../../src/core/prefs';
import { PreferencesSection } from '../../src/features/settings/screen';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

afterEach(() => jest.restoreAllMocks());

/** The theme a fresh install starts with on this platform. */
function freshPrefs(os: string) {
  jest.replaceProperty(Platform, 'OS', os as typeof Platform.OS);
  return defaultThemeMode();
}

describe('appearance follows the system (owner, Q1 — HIG Dark Mode: no app-specific setting)', () => {
  it('a fresh install follows the system on iOS and Android; the web keeps its dark default', () => {
    expect(freshPrefs('ios')).toBe('system');
    expect(freshPrefs('android')).toBe('system');
    expect(freshPrefs('web')).toBe('dark');
    // The store this test file loaded on iOS started from it.
    expect(usePrefs.getInitialState().themeMode).toBe('system');
  });

  it('installs that saved the old dark default follow the system once; a chosen light stays', () => {
    expect(migratePrefs({ locale: 'fr', themeMode: 'dark' }, 0)).toEqual({ locale: 'fr', themeMode: 'system' });
    expect(migratePrefs({ locale: null, themeMode: 'light' }, 0)).toEqual({ locale: null, themeMode: 'light' });
    jest.replaceProperty(Platform, 'OS', 'web');
    expect(migratePrefs({ locale: 'en', themeMode: 'dark' }, 0)).toEqual({ locale: 'en', themeMode: 'dark' });
  });

  it('Settings has no Dark / Light / System switch on a phone', async () => {
    const phone = await renderScreen(PreferencesSection, new FakeBackend().on('GET', '/me', [200, { id: 'u1', profile: {} }]));
    expect(await phone.findByText('Language')).toBeTruthy();
    expect(phone.queryByTestId('tab-dark')).toBeNull();
    expect(phone.queryByText('System')).toBeNull();
  });

  it('the web keeps the switch', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const screen = await renderScreen(PreferencesSection, new FakeBackend().on('GET', '/me', [200, { id: 'u1', profile: {} }]));
    expect(await screen.findByTestId('tab-dark')).toBeTruthy();
  });
});
