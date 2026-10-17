import { useCallback, useEffect, useState } from 'react';
import { copies, dirOf, readStoredLang, resolveLang, storeLang, type Lang } from './content';

function initialLang(): Lang {
  const browser = navigator.languages?.length ? navigator.languages : [navigator.language];
  return resolveLang({ search: window.location.search, stored: readStoredLang(), browser });
}

/** The page language, applied to <html>, the title and the description. A choice is remembered and put in the address. */
export function useLang(): [Lang, (lang: Lang) => void] {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    const t = copies[lang];
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
    document.title = t.meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.meta.description);
  }, [lang]);

  const choose = useCallback((next: Lang) => {
    storeLang(next);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState(null, '', url);
    setLang(next);
  }, []);

  return [lang, choose];
}
