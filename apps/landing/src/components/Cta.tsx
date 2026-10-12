import type { ReactNode } from 'react';
import type { Copy } from '../content';
import { mailto } from '../links';

/** A button that opens an email to the team, with a subject that says who is writing. */
export function Cta({ subject, children, variant = 'primary' }: { subject: string; children: ReactNode; variant?: 'primary' | 'ghost' }) {
  return (
    <a className={`btn btn-${variant}`} href={mailto(subject)}>
      {children}
    </a>
  );
}

/** The three ways in: athlete, gym, organizer. */
export function AudienceCtas({ t }: { t: Copy }) {
  return (
    <div className="cta-row">
      <Cta subject={t.mail.athlete}>{t.audienceCta.athlete}</Cta>
      <Cta subject={t.mail.gym} variant="ghost">
        {t.audienceCta.gym}
      </Cta>
      <Cta subject={t.mail.organizer} variant="ghost">
        {t.audienceCta.organizer}
      </Cta>
    </div>
  );
}
