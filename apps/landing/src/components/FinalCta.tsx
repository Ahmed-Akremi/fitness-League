import { config } from '../config';
import type { Copy } from '../content';
import { whatsappLink } from '../links';
import { AudienceCtas } from './Cta';

export function FinalCta({ t, whatsapp = config.whatsapp }: { t: Copy; whatsapp?: string }) {
  const chat = whatsappLink(t.whatsapp.message, whatsapp);
  return (
    <section className="section final" aria-labelledby="final-title">
      <div className="container">
        <div className="final-inner">
          <h2 id="final-title" className="display">
            {t.final.title}
          </h2>
          <p className="lead">{t.final.text}</p>
          <AudienceCtas t={t} />
          {chat && (
            <a className="btn btn-ghost" href={chat} target="_blank" rel="noopener noreferrer">
              {t.whatsapp.label}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
