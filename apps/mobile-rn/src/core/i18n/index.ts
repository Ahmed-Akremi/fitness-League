import { getLocales } from 'expo-localization';

import ar from './ar.json';
import en from './en.json';
import fr from './fr.json';

export type Locale = 'fr' | 'en' | 'ar';
export type MessageKey = keyof typeof en;
export type Args = Record<string, string | number>;

const catalogs: Record<Locale, Record<string, string>> = { fr, en, ar };
export const supportedLocales: Locale[] = ['fr', 'en', 'ar'];

/** Device language when supported, French otherwise (same default as the Flutter app). */
export function deviceLocale(): Locale {
  const code = getLocales()[0]?.languageCode;
  return supportedLocales.includes(code as Locale) ? (code as Locale) : 'fr';
}

/**
 * Formats an ARB/ICU message: `{name}` placeholders and `{n, plural, =0{…} =1{…} one{…} other{…}}` blocks.
 * Exact matches (`=N`) win, then the CLDR category of the locale, then `other`.
 */
export function format(message: string, args: Args = {}, locale: Locale = 'en'): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const open = message.indexOf('{', i);
    if (open < 0) return out + message.slice(i);
    out += message.slice(i, open);
    const close = matchingBrace(message, open);
    out += formatArgument(message.slice(open + 1, close), args, locale);
    i = close + 1;
  }
  return out;
}

function matchingBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  throw new Error(`Unbalanced message: ${s}`);
}

function formatArgument(body: string, args: Args, locale: Locale): string {
  const [name, type] = body.split(',', 2).map((p) => p.trim());
  if (type !== 'plural') return String(args[name] ?? `{${name}}`);
  const n = Number(args[name] ?? 0);
  const cases: Record<string, string> = {};
  const rest = body.slice(body.indexOf(',', body.indexOf(',') + 1) + 1);
  let i = 0;
  while (i < rest.length) {
    const open = rest.indexOf('{', i);
    if (open < 0) break;
    const close = matchingBrace(rest, open);
    cases[rest.slice(i, open).trim()] = rest.slice(open + 1, close);
    i = close + 1;
  }
  const chosen = cases[`=${n}`] ?? cases[new Intl.PluralRules(locale).select(n)] ?? cases.other ?? '';
  return format(chosen, args, locale);
}

export function translate(locale: Locale, key: MessageKey, args?: Args): string {
  const message = catalogs[locale][key] ?? catalogs.en[key] ?? key;
  return format(message, args, locale);
}
