import { useState } from 'react';
import type { Copy } from '../content';
import { media } from '../media';
import { Cta } from './Cta';
import { PhoneFrame } from './PhoneFrame';
import { Reveal } from './Reveal';
import { SectionHead } from './SectionHead';

export function Competitions({ t }: { t: Copy }) {
  const c = t.competitions;
  // Content inside <video> only shows where video is not supported at all; a file that fails to load needs its own fallback.
  const [failed, setFailed] = useState(false);
  const fallback = (
    <>
      {c.videoFallback}{' '}
      <a href={media.tutorial} download>
        {c.videoDownload}
      </a>
    </>
  );
  return (
    <section id="competitions" className="section competitions" aria-labelledby="competitions-title">
      <div className="container competitions-grid">
        <Reveal className="competitions-video">
          <PhoneFrame className="phone-video">
            {failed ? (
              <p className="video-fallback">{fallback}</p>
            ) : (
              <video controls playsInline preload="none" poster={media.videoPoster} aria-label={c.videoLabel}>
                <source src={media.tutorial} type="video/mp4" onError={() => setFailed(true)} />
                <p>{fallback}</p>
              </video>
            )}
          </PhoneFrame>
        </Reveal>
        <div>
          <SectionHead id="competitions-title" eyebrow={c.eyebrow} title={c.title} intro={c.intro} />
          <ul className="points">
            {c.points.map((point) => (
              <li key={point.title}>
                <h3>{point.title}</h3>
                <p>{point.text}</p>
              </li>
            ))}
          </ul>
          <Cta subject={t.mail.athlete}>{c.cta}</Cta>
        </div>
      </div>
    </section>
  );
}
