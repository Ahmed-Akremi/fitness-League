import type { Copy } from '../content';
import { Reveal } from './Reveal';
import { SectionHead } from './SectionHead';

export function HowItWorks({ t }: { t: Copy }) {
  return (
    <section id="how" className="section" aria-labelledby="how-title">
      <div className="container">
        <SectionHead id="how-title" eyebrow={t.how.eyebrow} title={t.how.title} />
        <ol className="steps">
          {t.how.steps.map((step, i) => (
            <li key={step.title}>
              <Reveal className="step">
                <span className="step-num" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
