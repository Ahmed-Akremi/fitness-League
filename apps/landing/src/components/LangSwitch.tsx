import { LANGS, type Lang } from '../content';

/** Each language named in itself, so a visitor finds theirs whatever the page language. */
const LABELS: Record<Lang, { short: string; name: string }> = {
  en: { short: 'EN', name: 'English' },
  fr: { short: 'FR', name: 'Français' },
  ar: { short: 'ع', name: 'العربية' },
};

export function LangSwitch({ lang, onLang, label }: { lang: Lang; onLang: (lang: Lang) => void; label: string }) {
  return (
    <div className="lang-switch" role="group" aria-label={label}>
      {LANGS.map((code) => (
        <button key={code} type="button" lang={code} aria-label={LABELS[code].name} aria-pressed={code === lang} onClick={() => onLang(code)}>
          {LABELS[code].short}
        </button>
      ))}
    </div>
  );
}
