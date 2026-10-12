import { useState } from 'react';
import type { Copy } from '../content';
import { SectionHead } from './SectionHead';

export function Faq({ t }: { t: Copy }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="section" aria-labelledby="faq-title">
      <div className="container narrow">
        <SectionHead id="faq-title" eyebrow={t.faq.eyebrow} title={t.faq.title} />
        <div className="faq">
          {t.faq.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className={`faq-item ${isOpen ? 'is-open' : ''}`.trim()}>
                <h3>
                  <button type="button" id={`faq-q-${i}`} aria-expanded={isOpen} aria-controls={`faq-a-${i}`} onClick={() => setOpen(isOpen ? null : i)}>
                    <span>{item.q}</span>
                    <span className="faq-icon" aria-hidden="true" />
                  </button>
                </h3>
                <div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} hidden={!isOpen}>
                  <p>{item.a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
