import { Audience } from './components/Audience';
import { Competitions } from './components/Competitions';
import { Faq } from './components/Faq';
import { FinalCta } from './components/FinalCta';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { HowItWorks } from './components/HowItWorks';
import { copies } from './content';
import { media } from './media';
import { useLang } from './useLang';

export function App() {
  const [lang, setLang] = useLang();
  const t = copies[lang];
  return (
    <>
      <a className="skip-link" href="#main">
        {t.nav.skip}
      </a>
      <Header t={t} lang={lang} onLang={setLang} />
      <main id="main">
        <Hero t={t} />
        <HowItWorks t={t} />
        <Audience id="athletes" copy={t.athletes} subject={t.mail.athlete} photo={media.athletes} screens={[media.screens.league, media.screens.train]} />
        <Competitions t={t} />
        <Audience id="gyms" copy={t.gyms} subject={t.mail.gym} photo={media.gyms} screens={[media.screens.gym]} reverse />
        <Audience id="organizers" copy={t.organizers} subject={t.mail.organizer} photo={media.organizers} screens={[media.screens.competitions]} />
        <Faq t={t} />
        <FinalCta t={t} />
      </main>
      <Footer t={t} lang={lang} onLang={setLang} />
    </>
  );
}
