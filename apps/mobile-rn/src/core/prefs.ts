import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback } from 'react';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { deviceLocale, translate, type Args, type Locale, type MessageKey } from './i18n';

export type ThemeMode = 'dark' | 'light' | 'system';

interface Prefs {
  /** null = follow the device language. */
  locale: Locale | null;
  themeMode: ThemeMode;
  setLocale(locale: Locale | null): void;
  setThemeMode(mode: ThemeMode): void;
}

/**
 * Phones follow the system appearance (owner's choice; HIG Dark Mode: no app-specific appearance setting). The web
 * keeps the dark-first default (spec §19.5) and its switch, so the computer layout does not change.
 */
export const defaultThemeMode = (): ThemeMode => (Platform.OS === 'web' ? 'dark' : 'system');

type Saved = Pick<Prefs, 'locale' | 'themeMode'>;

/** Version 0 saved the old dark default on every install: on a phone it follows the system once; a chosen light stays. */
export function migratePrefs(saved: unknown, version: number): Saved {
  const prefs = saved as Saved;
  return version < 1 && prefs?.themeMode === 'dark' && defaultThemeMode() === 'system' ? { ...prefs, themeMode: 'system' } : prefs;
}

/** Per-device preferences. */
export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      locale: null,
      themeMode: defaultThemeMode(),
      setLocale: (locale) => set({ locale }),
      setThemeMode: (themeMode) => set({ themeMode }),
    }),
    { name: 'prefs', version: 1, migrate: migratePrefs, storage: createJSONStorage(() => AsyncStorage), partialize: ({ locale, themeMode }) => ({ locale, themeMode }) },
  ),
);

export function useLocale(): Locale {
  return usePrefs((s) => s.locale) ?? deviceLocale();
}

export type T = (key: MessageKey, args?: Args) => string;

/** Translation function for the current language: `t('navHome')`, `t('days', { count: 3 })`. */
export function useT(): T {
  const locale = useLocale();
  return useCallback((key: MessageKey, args?: Args) => translate(locale, key, args), [locale]);
}
