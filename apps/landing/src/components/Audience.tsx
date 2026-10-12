import type { Copy } from '../content';
import { Cta } from './Cta';
import { CheckIcon } from './icons';
import { PhoneFrame } from './PhoneFrame';
import { Reveal } from './Reveal';
import { SectionHead } from './SectionHead';

type AudienceCopy = Copy['athletes'];

/** One component for the athletes, gyms and organizers sections. */
export function Audience({ id, copy, subject, photo, screens, reverse = false }: { id: string; copy: AudienceCopy; subject: string; photo: string; screens: readonly string[]; reverse?: boolean }) {
  return (
    <section id={id} className={`section audience ${reverse ? 'is-reverse' : ''}`.trim()} aria-labelledby={`${id}-title`}>
      <div className="container audience-grid">
        <div className="audience-copy">
          <SectionHead id={`${id}-title`} eyebrow={copy.eyebrow} title={copy.title} intro={copy.intro} />
          <ul className="features">
            {copy.features.map((feature) => (
              <li key={feature.title}>
                <CheckIcon />
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <Cta subject={subject}>{copy.cta}</Cta>
        </div>
        <Reveal className="audience-media">
          <img className="audience-photo" src={photo} alt={copy.photoAlt} loading="lazy" width={1200} height={900} />
          <div className="audience-phones">
            {screens.map((src, i) => (
              <PhoneFrame key={src}>
                <img src={src} alt={copy.screenAlts[i]} loading="lazy" width={390} height={844} />
              </PhoneFrame>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
