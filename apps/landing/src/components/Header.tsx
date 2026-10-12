import { useEffect, useState } from 'react';
import type { Copy, Lang } from '../content';
import { mailto } from '../links';
import { media } from '../media';
import { LangSwitch } from './LangSwitch';

export function Header({ t, lang, onLang }: { t: Copy; lang: Lang; onLang: (lang: Lang) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const links = [
    ['#athletes', t.nav.athletes],
    ['#competitions', t.nav.competitions],
    ['#gyms', t.nav.gyms],
    ['#organizers', t.nav.organizers],
    ['#faq', t.nav.faq],
  ] as const;

  return (
    <header className="site-header">
      <div className="container header-inner">
        <a className="brand" href="#top" aria-label={t.nav.home}>
          <img src={media.logo} alt="" width={32} height={32} />
          <span>Fitness League</span>
        </a>
        <nav id="site-menu" className={`site-nav ${open ? 'is-open' : ''}`.trim()} aria-label={t.nav.main}>
          <ul>
            {links.map(([href, label]) => (
              <li key={href}>
                <a href={href} onClick={() => setOpen(false)}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <LangSwitch lang={lang} onLang={onLang} label={t.nav.language} />
        </nav>
        <a className="btn btn-primary btn-small header-contact" href={mailto(t.mail.contact)}>
          {t.nav.contact}
        </a>
        <button type="button" className="menu-toggle" aria-expanded={open} aria-controls="site-menu" aria-label={open ? t.nav.closeMenu : t.nav.menu} onClick={() => setOpen((o) => !o)}>
          <span className="menu-icon" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
