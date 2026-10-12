import type { Copy } from '../content';
import { media } from '../media';
import { AudienceCtas } from './Cta';
import { PhoneFrame } from './PhoneFrame';
import { StoreBadges } from './StoreBadges';

export function Hero({ t }: { t: Copy }) {
  return (
    <section id="top" className="hero">
      <img className="hero-photo" src={media.hero} srcSet={`${media.heroSmall} 800w, ${media.hero} 1600w`} sizes="100vw" alt={t.hero.photoAlt} fetchPriority="high" />
      <div className="container hero-inner">
        <div className="hero-copy">
          <p className="eyebrow">{t.hero.eyebrow}</p>
          <h1 className="display">{t.hero.title}</h1>
          <p className="hero-slogan">{t.hero.slogan}</p>
          <p className="lead">{t.hero.lead}</p>
          <AudienceCtas t={t} />
          <StoreBadges t={t} />
        </div>
        <PhoneFrame className="hero-phone">
          <img src={media.screens.home} alt={t.hero.screenAlt} width={390} height={844} />
        </PhoneFrame>
      </div>
    </section>
  );
}
