import { afterEach, describe, expect, it, vi } from 'vitest';
import { dirOf, readStoredLang, resolveLang, STORAGE_KEY, storeLang, toLang } from './lang';

describe('toLang', () => {
  it.each([
    ['fr', 'fr'],
    ['FR', 'fr'],
    ['fr-TN', 'fr'],
    ['ar_TN', 'ar'],
    [' en ', 'en'],
  ])('reads %j as %s', (input, lang) => {
    expect(toLang(input)).toBe(lang);
  });

  it.each([['de'], [''], [null], [undefined], ['english'], ['-fr']])('rejects %j', (input) => {
    expect(toLang(input)).toBeNull();
  });
});

describe('resolveLang', () => {
  it('prefers the language in the address', () => {
    expect(resolveLang({ search: '?lang=ar', stored: 'fr', browser: ['en-US'] })).toBe('ar');
  });

  it('then the stored choice', () => {
    expect(resolveLang({ search: '', stored: 'fr', browser: ['ar'] })).toBe('fr');
  });

  it('then the first browser language the page has', () => {
    expect(resolveLang({ search: '', stored: null, browser: ['de-DE', 'ar-TN', 'fr'] })).toBe('ar');
  });

  it('skips an unknown address value and keeps looking', () => {
    expect(resolveLang({ search: '?lang=klingon', stored: 'fr', browser: [] })).toBe('fr');
  });

  it('falls back to English', () => {
    expect(resolveLang({ search: '?lang=de', stored: 'xx', browser: ['de', 'it'] })).toBe('en');
  });
});

describe('stored choice', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('round-trips through localStorage', () => {
    storeLang('ar');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('ar');
    expect(readStoredLang()).toBe('ar');
  });

  it('survives a storage that throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(readStoredLang()).toBeNull();
    expect(() => storeLang('fr')).not.toThrow();
  });
});

it('lays Arabic out right to left and the others left to right', () => {
  expect(dirOf('ar')).toBe('rtl');
  expect(dirOf('fr')).toBe('ltr');
  expect(dirOf('en')).toBe('ltr');
});
