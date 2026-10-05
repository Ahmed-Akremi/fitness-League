import { useState } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../components/useFetch';

interface Held {
  id: string;
  userId: string;
  performedAt: string;
  durationS: number;
  exercises: { exerciseId: string; sets: { reps: number | null; weightKg: number | null; distanceM: number | null; durationS: number | null }[] }[];
  evaluation?: { ruleHits: { rule: string; severity: string; value?: number; threshold?: number }[] };
}

/** Anti-cheat HELD_FOR_REVIEW queue: points stay pending until a moderator decides (spec §18.2). */
export function HeldWorkouts() {
  const { api } = useAuth();
  const { data, error, reload } = useFetch(() => api.get<{ data: Held[] }>('/admin/workouts/held?limit=50'), [api]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function decide(id: string, decision: 'approve' | 'reject') {
    try {
      await api.post(`/admin/workouts/${id}/${decision}`, { note: notes[id] });
      setMessage(decision === 'approve' ? 'Séance acceptée.' : 'Séance refusée.');
      await reload();
    } catch (e) {
      setMessage(errorText(e));
    }
  }

  if (error) return <p role="alert">{errorText(error)}</p>;
  return (
    <section>
      <h2>Séances à vérifier</h2>
      {message && <p role="status">{message}</p>}
      {data?.data.length === 0 && <p>Rien à vérifier.</p>}
      {data?.data.map((w) => (
        <article key={w.id} className="card">
          <p>
            <strong>{new Date(w.performedAt).toLocaleString('fr-FR')}</strong> · {Math.round(w.durationS / 60)} min · athlète {w.userId.slice(0, 8)}
          </p>
          <ul>
            {w.evaluation?.ruleHits.map((h, i) => (
              <li key={i}>
                <span className={`badge ${h.severity}`}>{h.severity}</span> {h.rule}
                {h.value !== undefined ? ` : ${h.value}` : ''}
                {h.threshold !== undefined ? ` (seuil ${h.threshold})` : ''}
              </li>
            ))}
          </ul>
          <details>
            <summary>Séries</summary>
            <pre>{JSON.stringify(w.exercises, null, 1)}</pre>
          </details>
          <label>
            Motif de la décision
            <input value={notes[w.id] ?? ''} onChange={(e) => setNotes({ ...notes, [w.id]: e.target.value })} />
          </label>
          <div className="row">
            <button disabled={(notes[w.id] ?? '').length < 3} onClick={() => decide(w.id, 'approve')}>
              Accepter
            </button>
            <button className="danger" disabled={(notes[w.id] ?? '').length < 3} onClick={() => decide(w.id, 'reject')}>
              Refuser
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

interface GymRequest {
  id: string;
  proofText: string | null;
  createdAt: string;
  gym: {
    id: string;
    name: string;
    governorate: string;
    addressLine: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    socialLinks: Record<string, string>;
    logoUrl?: string | null;
    sports?: string[];
  };
}

export function GymVerification() {
  const { api } = useAuth();
  const { data, error, reload } = useFetch(() => api.get<{ data: GymRequest[] }>('/admin/gyms/verification-requests?limit=50'), [api]);
  const [message, setMessage] = useState<string | null>(null);

  async function review(id: string, decision: 'APPROVE' | 'REJECT') {
    try {
      await api.post(`/admin/gyms/verification-requests/${id}/review`, { decision });
      setMessage(decision === 'APPROVE' ? 'Salle vérifiée.' : 'Demande refusée.');
      await reload();
    } catch (e) {
      setMessage(errorText(e));
    }
  }

  if (error) return <p role="alert">{errorText(error)}</p>;
  return (
    <section>
      <h2>Salles à vérifier</h2>
      {message && <p role="status">{message}</p>}
      {data?.data.length === 0 && <p>Aucune demande.</p>}
      {data?.data.map((r) => (
        <article key={r.id} className="card">
          <div className="row">
            {r.gym.logoUrl ? (
              <img src={r.gym.logoUrl} alt={`Logo ${r.gym.name}`} width={64} height={64} style={{ borderRadius: 14, objectFit: 'cover' }} />
            ) : (
              <span className="muted">Pas de logo</span>
            )}
            <h3>
              {r.gym.name} · {r.gym.governorate}
            </h3>
          </div>
          {r.gym.sports && r.gym.sports.length > 0 && <p>Sports : {r.gym.sports.join(', ')}</p>}
          <p>{r.gym.addressLine}</p>
          <p>
            {r.gym.contactPhone} · {r.gym.contactEmail}
          </p>
          <p>
            Justificatif : <em>{r.proofText}</em>
          </p>
          <ul>
            {Object.entries(r.gym.socialLinks ?? {}).map(([k, v]) => (
              <li key={k}>
                {k} : <a href={v} target="_blank" rel="noreferrer noopener">{v}</a>
              </li>
            ))}
          </ul>
          <div className="row">
            <button onClick={() => review(r.id, 'APPROVE')}>Vérifier</button>
            <button className="danger" onClick={() => review(r.id, 'REJECT')}>
              Refuser
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

interface PendingProof {
  workoutId: string;
  username: string;
  sport: string;
  performedAt: string;
  durationS: number;
  exercises: { code: string; sets: { reps: number | null; weightKg: number | null; distanceM: number | null; durationS: number | null }[] }[];
  proofs: { id: string; kind: string; url: string }[];
}

/** Proofs to review (Phase 3): a verified workout weighs more in the performance component. */
export function ProofQueue() {
  const { api } = useAuth();
  const { data, error, reload } = useFetch(() => api.get<PendingProof[]>('/admin/proofs/queue'), [api]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function decide(id: string, decision: 'VERIFY' | 'REJECT') {
    try {
      await api.post(`/admin/proofs/${id}/decide`, { decision, note: notes[id] });
      setMessage(decision === 'VERIFY' ? 'Séance vérifiée.' : 'Preuve refusée.');
      await reload();
    } catch (e) {
      setMessage(errorText(e));
    }
  }

  if (error) return <p role="alert">{errorText(error)}</p>;
  return (
    <section>
      <h2>Preuves à vérifier</h2>
      {message && <p role="status">{message}</p>}
      {data?.length === 0 && <p>Aucune preuve en attente.</p>}
      {data?.map((w) => (
        <article key={w.workoutId} className="card">
          <p>
            <strong>@{w.username}</strong> · {w.sport} · {new Date(w.performedAt).toLocaleString('fr-FR')} · {Math.round(w.durationS / 60)} min
          </p>
          <div className="row">
            {w.proofs.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                <img src={p.url} alt={`Preuve (${p.kind})`} style={{ maxWidth: 240, maxHeight: 240, objectFit: 'contain' }} />
              </a>
            ))}
          </div>
          <details>
            <summary>Séries déclarées</summary>
            <pre>{JSON.stringify(w.exercises, null, 1)}</pre>
          </details>
          <label>
            Note (obligatoire pour refuser, visible par l’athlète)
            <input value={notes[w.workoutId] ?? ''} onChange={(e) => setNotes({ ...notes, [w.workoutId]: e.target.value })} />
          </label>
          <div className="row">
            <button onClick={() => decide(w.workoutId, 'VERIFY')}>Vérifier</button>
            <button className="danger" disabled={(notes[w.workoutId] ?? '').trim().length < 3} onClick={() => decide(w.workoutId, 'REJECT')}>
              Refuser
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
