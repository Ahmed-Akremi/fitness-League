import { FormEvent, useState } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../components/useFetch';

interface RecomputeResult {
  dryRun: boolean;
  weeks: number;
  changed: number;
  lpDelta: number;
  changes: { userId: string; weekStart: string; before: { total: number; lp: number }; after: { total: number; lp: number } }[];
}

interface Season {
  id: string;
  name: string;
  status: string;
  startsAt: string;
  endsAt: string;
  standings: number;
}

export function Seasons() {
  const { api, me } = useAuth();
  const { data, error, reload } = useFetch(() => api.get<Season[]>('/admin/seasons'), [api]);
  const [form, setForm] = useState({ name: '', startsAt: '', endsAt: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [range, setRange] = useState({ from: '', to: '', reason: '' });
  const [preview, setPreview] = useState<RecomputeResult | null>(null);

  async function recompute(dryRun: boolean) {
    if (!dryRun && !window.confirm(`Recalculer ${preview?.changed ?? 0} semaine(s) ? Les écritures seront annulées puis ré-écrites.`)) return;
    try {
      const r = await api.post<RecomputeResult>('/admin/recompute', { ...range, dryRun });
      setPreview(r);
      setMessage(dryRun ? `Simulation : ${r.changed} semaine(s) sur ${r.weeks} changeraient (${r.lpDelta >= 0 ? '+' : ''}${r.lpDelta} LP).` : `Recalcul appliqué : ${r.changed} semaine(s).`);
    } catch (err) {
      setMessage(errorText(err));
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/admin/seasons', { name: form.name, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() });
      setMessage('Saison programmée.');
      await reload();
    } catch (err) {
      setMessage(errorText(err));
    }
  }

  async function close(s: Season) {
    if (!window.confirm(`Clôturer ${s.name} ? Classements archivés et remise à niveau des LP.`)) return;
    try {
      await api.post(`/admin/seasons/${s.id}/close`);
      setMessage('Saison clôturée.');
      await reload();
    } catch (err) {
      setMessage(errorText(err));
    }
  }

  if (error) return <p role="alert">{errorText(error)}</p>;
  return (
    <section>
      <h2>Saisons</h2>
      <table>
        <thead>
          <tr>
            <th>Nom</th>
            <th>Statut</th>
            <th>Début</th>
            <th>Fin</th>
            <th>Classement archivé</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.status}</td>
              <td>{new Date(s.startsAt).toLocaleString('fr-FR')}</td>
              <td>{new Date(s.endsAt).toLocaleString('fr-FR')}</td>
              <td>{s.standings}</td>
              <td>{s.status === 'ACTIVE' && <button className="danger" onClick={() => close(s)}>Clôturer</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={create} className="card">
        <h3>Programmer une saison</h3>
        <label>
          Nom
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          Début
          <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} required />
        </label>
        <label>
          Fin
          <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} required />
        </label>
        <button type="submit">Programmer</button>
      </form>
      {me?.role === 'SUPER_ADMIN' && (
        <form onSubmit={(e) => { e.preventDefault(); void recompute(true); }} className="card">
          <h3>Recalculer des semaines closes</h3>
          <p>Applique les règles actives aux semaines de la saison en cours (annulation + nouvelle écriture, jamais de modification).</p>
          <label>
            Du lundi
            <input type="date" value={range.from} onChange={(e) => { setRange({ ...range, from: e.target.value }); setPreview(null); }} required />
          </label>
          <label>
            Au lundi (exclu)
            <input type="date" value={range.to} onChange={(e) => { setRange({ ...range, to: e.target.value }); setPreview(null); }} required />
          </label>
          <label>
            Motif
            <input value={range.reason} minLength={5} onChange={(e) => setRange({ ...range, reason: e.target.value })} required />
          </label>
          <button type="submit">Simuler</button>
          {preview?.dryRun && preview.changed > 0 && (
            <button type="button" className="danger" onClick={() => recompute(false)}>
              Appliquer
            </button>
          )}
          {preview && preview.changes.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Athlète</th>
                  <th>Semaine</th>
                  <th>Score</th>
                  <th>LP</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.map((c) => (
                  <tr key={`${c.userId}-${c.weekStart}`}>
                    <td>{c.userId.slice(0, 8)}</td>
                    <td>{c.weekStart}</td>
                    <td>{c.before.total} → {c.after.total}</td>
                    <td>{c.before.lp} → {c.after.lp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
