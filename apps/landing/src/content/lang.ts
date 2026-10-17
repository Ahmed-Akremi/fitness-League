export const LANGS = ['en', 'fr', 'ar'] as const;
export type Lang = (typeof LANGS)[number];

export const STORAGE_KEY = 'fl-landing-lang';

/** 'FR', 'fr-TN', 'fr_TN' and ' fr ' all mean French; anything else is not a language of the page. */
export function toLang(value: string | null | undefined): Lang | null {
  const base = (value ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return (LANGS as readonly string[]).includes(base) ? (base as Lang) : null;
}

export interface LangSources {
  /** `location.search`, e.g. `?lang=fr`. */
  search: string;
  /** The visitor's last choice, or null. */
  stored: string | null;
  /** `navigator.languages`, most preferred first. */
  browser: readonly string[];
}

/** The address wins, then the visitor's last choice, then the browser, then English. */
export function resolveLang({ search, stored, browser }: LangSources): Lang {
  return (
    toLang(new URLSearchParams(search).get('lang')) ??
    toLang(stored) ??
    browser.map(toLang).find((lang): lang is Lang => lang !== null) ??
    'en'
  );
}

export function readStoredLang(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeLang(lang: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Storage blocked (private mode): the choice lasts until the page is closed.
  }
}

export const dirOf = (lang: Lang): 'rtl' | 'ltr' => (lang === 'ar' ? 'rtl' : 'ltr');
