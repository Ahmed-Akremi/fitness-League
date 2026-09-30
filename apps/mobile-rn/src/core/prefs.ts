import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback } from 'react';
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

/** Per-device preferences. Dark first (spec §19.5). */
export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      locale: null,
      themeMode: 'dark',
      setLocale: (locale) => set({ locale }),
      setThemeMode: (themeMode) => set({ themeMode }),
    }),
    { name: 'prefs', storage: createJSONStorage(() => AsyncStorage), partialize: ({ locale, themeMode }) => ({ locale, themeMode }) },
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
