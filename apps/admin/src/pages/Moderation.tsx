import { useState } from 'react';
import { errorText } from '../api';
import { canAdmin, useAuth } from '../auth';
import { useFetch } from '../components/useFetch';

interface OpenReport {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  createdAt: string;
  reporter: string;
  target: { userId: string; username: string | null; status: string | null; reportsTotal: number; sanctionsTotal: number } | null;
}

interface Appeal {
  id: string;
  kind: string;
  reason: string;
  note: string;
  username: string;
  endsAt: string | null;
  appealedAt: string | null;
  appeal: { text: string | null };
}

interface Flag {
  id: string;
  username: string;
  userStatus: string;
  kind: string;
  weekStart: string;
  details: Record<string, unknown>;
}

const FLAG_KINDS: Record<string, string> = { SCORE_SPIKE: 'Pic de score', FARMING: 'Séances au minimum', SHARED_DEVICE: 'Appareil partagé', BATTLE_COLLUSION: 'Battles arrangées' };

const REASONS: Record<string, string> = { CHEATING: 'Triche', HARASSMENT: 'Harcèlement', SPAM: 'Spam', INAPPROPRIATE: 'Contenu inapproprié', IMPERSONATION: 'Usurpation', OTHER: 'Autre' };

/** Reports and appeals (Phase 3). Bans and ban appeals need an admin; nobody reviews an appeal of their own decision. */
export function Moderation() {
  const { api, me } = useAuth();
  const reports = useFetch(() => api.get<OpenReport[]>('/admin/reports'), [api]);
  const appeals = useFetch(() => api.get<Appeal[]>('/admin/appeals'), [api]);
  const flags = useFetch(() => api.get<Flag[]>('/admin/anticheat/flags'), [api]);

  async function reviewFlag(f: Flag, status: 'CLEARED' | 'CONFIRMED') {
    try {
      await api.post(`/admin/anticheat/flags/${f.id}/review`, { status, note: notes[f.id] });
      setMessage(status === 'CLEARED' ? 'Alerte classée.' : 'Alerte confirmée : sanctionne via un signalement si besoin.');
      await flags.reload();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [days, setDays] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function decide(r: OpenReport, action: 'DISMISS' | 'WARN' | 'SUSPEND' | 'BAN') {
    if (action === 'BAN' && !window.confirm(`Bannir @${r.target?.username} ?`)) return;
    try {
      await api.post(`/admin/reports/${r.id}/decide`, { action, note: notes[r.id], ...(action === 'SUSPEND' && { days: days[r.id] ?? 7 }) });
      setMessage('Décision enregistrée.');
      await reports.reload();
    } catch (e) {
      setMessage(errorText(e));
    }
  }

  async function decideAppeal(a: Appeal, decision: 'UPHOLD' | 'OVERTURN') {
    try {
      await api.post(`/admin/sanctions/${a.id}/appeal/decide`, { decision, note: notes[a.id] });
      setMessage(decision === 'OVERTURN' ? 'Sanction levée.' : 'Sanction maintenue.');
      await appeals.reload();
    } catch (e) {
      setMessage(errorText(e));
    }
  }

  const noteOk = (id: string) => (notes[id] ?? '').trim().length >= 5;
  const note = (id: string) => (
    <label>
      Motif (visible par l’athlète, 5 caractères min.)
      <input value={notes[id] ?? ''} onChange={(e) => setNotes({ ...notes, [id]: e.target.value })} />
    </label>
  );

  return (
    <section>
      <h2>Signalements</h2>
      {message && <p role="status">{message}</p>}
      {reports.error != null && <p role="alert">{errorText(reports.error)}</p>}
      {reports.data?.length === 0 && <p>Aucun signalement ouvert.</p>}
      {reports.data?.map((r) => (
        <article key={r.id} className="card">
          <p>
            <strong>{REASONS[r.reason] ?? r.reason}</strong> · {r.targetType} · signalé par @{r.reporter} le {new Date(r.createdAt).toLocaleString('fr-FR')}
          </p>
          {r.target && (
            <p>
              Cible : @{r.target.username} ({r.target.status}) · {r.target.reportsTotal} signalement(s) · {r.target.sanctionsTotal} sanction(s) active(s)
            </p>
          )}
          {r.details && <blockquote>{r.details}</blockquote>}
          {note(r.id)}
          <div className="row">
            <button disabled={!noteOk(r.id)} onClick={() => decide(r, 'DISMISS')}>Classer</button>
            <button disabled={!noteOk(r.id) || !r.target} onClick={() => decide(r, 'WARN')}>Avertir</button>
            <label>
              Jours
              <input type="number" min={1} max={365} value={days[r.id] ?? 7} onChange={(e) => setDays({ ...days, [r.id]: Number(e.target.value) })} style={{ width: 70 }} />
            </label>
            <button disabled={!noteOk(r.id) || !r.target} onClick={() => decide(r, 'SUSPEND')}>Suspendre</button>
            {canAdmin(me) && (
              <button className="danger" disabled={!noteOk(r.id) || !r.target} onClick={() => decide(r, 'BAN')}>
                Bannir
              </button>
            )}
          </div>
        </article>
      ))}

      <h2>Alertes anti-triche</h2>
      {flags.data?.length === 0 && <p>Aucune alerte ouverte.</p>}
      {flags.data?.map((f) => (
        <article key={f.id} className="card">
          <p>
            <strong>{FLAG_KINDS[f.kind] ?? f.kind}</strong> · @{f.username} ({f.userStatus}) · semaine du {f.weekStart}
          </p>
          <pre>{JSON.stringify(f.details, null, 1)}</pre>
          <label>
            Note
            <input value={notes[f.id] ?? ''} onChange={(e) => setNotes({ ...notes, [f.id]: e.target.value })} />
          </label>
          <div className="row">
            <button disabled={(notes[f.id] ?? '').trim().length < 3} onClick={() => reviewFlag(f, 'CLEARED')}>Classer</button>
            <button className="danger" disabled={(notes[f.id] ?? '').trim().length < 3} onClick={() => reviewFlag(f, 'CONFIRMED')}>
              Confirmer
            </button>
          </div>
        </article>
      ))}

      <h2>Appels</h2>
      {appeals.data?.length === 0 && <p>Aucun appel en attente.</p>}
      {appeals.data?.map((a) => (
        <article key={a.id} className="card">
          <p>
            <strong>@{a.username}</strong> · {a.kind} ({REASONS[a.reason] ?? a.reason}){a.endsAt ? ` jusqu’au ${new Date(a.endsAt).toLocaleDateString('fr-FR')}` : ''}
          </p>
          <p>Décision : {a.note}</p>
          <blockquote>{a.appeal.text}</blockquote>
          {note(a.id)}
          <div className="row">
            <button disabled={!noteOk(a.id)} onClick={() => decideAppeal(a, 'UPHOLD')}>Maintenir</button>
            <button className="danger" disabled={!noteOk(a.id)} onClick={() => decideAppeal(a, 'OVERTURN')}>
              Lever la sanction
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
