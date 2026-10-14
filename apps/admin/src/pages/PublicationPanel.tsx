import { FormEvent, useState } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;

/** Organizer space: an admin publishes a draft, or sends it back to its organizer with a note. */
export function PublicationPanel({ competition: c, onDone }: { competition: J; onDone: () => unknown }) {
  const { api } = useAuth();
  const base = `/admin/competitions/${c.id}`;
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  if (c.status !== 'DRAFT') return null;

  async function act(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      setMessage(label);
      setNote('');
    } catch (err) {
      setMessage(errorText(err));
    }
    await onDone();
  }

  function sendBack(e: FormEvent) {
    e.preventDefault();
    void act("Renvoyée au brouillon : l'organisateur voit ta note.", () => api.post(`${base}/publication-request/return`, { note: note.trim() }));
  }

  return (
    <div className="panel">
      <h2>Publication</h2>
      {c.publicationRequestedAt ? (
        <p>
          <span className="badge">Publication demandée</span> le {new Date(c.publicationRequestedAt).toLocaleString('fr-FR')}
        </p>
      ) : (
        <p>L'organisateur n'a pas encore demandé la publication.</p>
      )}
      {c.publicationNote ? <p>Dernière note envoyée : « {c.publicationNote} »</p> : null}
      <p>
        <button type="button" onClick={() => void act('Compétition publiée : les inscriptions sont ouvertes.', () => api.patch(`${base}/status`, { status: 'REGISTRATION_OPEN' }))}>
          Publier
        </button>
      </p>
      {c.publicationRequestedAt ? (
        <form onSubmit={sendBack}>
          <label>
            Note pour l'organisateur
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </label>
          <button type="submit" disabled={note.trim().length < 3}>
            Renvoyer au brouillon
          </button>
        </form>
      ) : null}
      {message ? <p className="message">{message}</p> : null}
    </div>
  );
}
