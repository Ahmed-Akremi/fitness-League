import { config } from '../config';
import type { Copy, Lang } from '../content';
import { credits } from '../credits';
import { mailto } from '../links';
import { media } from '../media';
import { LangSwitch } from './LangSwitch';

export function Footer({ t, lang, onLang }: { t: Copy; lang: Lang; onLang: (lang: Lang) => void }) {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <a className="brand" href="#top" aria-label={t.nav.home}>
            <img src={media.logo} alt="" width={32} height={32} />
            <span>Fitness League</span>
          </a>
          <p className="footer-tagline">{t.footer.tagline}</p>
        </div>
        <div className="footer-contact">
          <h2 className="footer-title">{t.footer.contact}</h2>
          <a href={mailto(t.mail.contact)}>
            <bdi dir="ltr">{config.contactEmail}</bdi>
          </a>
          <LangSwitch lang={lang} onLang={onLang} label={t.nav.language} />
        </div>
        <details className="credits">
          <summary>{t.footer.credits}</summary>
          <p>{t.footer.creditsIntro}</p>
          <ul>
            {credits.map((credit) => (
              <li key={credit.file}>
                <a href={credit.source} target="_blank" rel="noopener noreferrer">
                  <bdi>{credit.photographer}</bdi>
                </a>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className="container footer-legal">
        <p>{t.footer.trademarks}</p>
        <p>{t.footer.rights}</p>
      </div>
    </footer>
  );
}
