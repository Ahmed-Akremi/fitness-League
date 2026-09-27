import { FormEvent, useState } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../components/useFetch';

interface Season {
  id: string;
  name: string;
  status: string;
  startsAt: string;
  endsAt: string;
  standings: number;
}

export function Seasons() {
  const { api } = useAuth();
  const { data, error, reload } = useFetch(() => api.get<Season[]>('/admin/seasons'), [api]);
  const [form, setForm] = useState({ name: '', startsAt: '', endsAt: '' });
  const [message, setMessage] = useState<string | null>(null);

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
      {message && <p role="status">{message}</p>}
    </section>
  );
}
