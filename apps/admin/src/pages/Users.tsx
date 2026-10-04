import { FormEvent, useState } from 'react';
import { errorText } from '../api';
import { canAdmin, useAuth } from '../auth';
import { useFetch } from '../components/useFetch';

interface UserRow {
  id: string;
  email: string;
  username: string;
  fullName?: string;
  role: string;
  status: string;
  emailVerified: boolean;
  level: number;
  seasonLp: number;
}
interface Page<T> {
  data: T[];
  page: { nextCursor: string | null };
}
interface UserDetail extends UserRow {
  suspendedUntil: string | null;
  governorate?: string;
  gym: string | null;
  xpTotal: number;
  division: string | null;
  workouts: { total: number; held: number; rejected: number };
  audit: { action: string; actorId: string | null; at: string }[];
}

export function Users() {
  const { api } = useAuth();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useFetch(() => api.get<Page<UserRow>>(`/admin/users?limit=50${query ? `&q=${encodeURIComponent(query)}` : ''}`), [api, query]);

  return (
    <section>
      <h2>Utilisateurs</h2>
      <form
        className="row"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setQuery(q);
        }}
      >
        <input placeholder="Email, pseudo ou nom" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Recherche" />
        <button type="submit">Rechercher</button>
      </form>
      {list.error ? <p role="alert">{errorText(list.error)}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Pseudo</th>
            <th>Email</th>
            <th>Rôle</th>
            <th>Statut</th>
            <th>Niveau</th>
            <th>LP</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.data.map((u) => (
            <tr key={u.id} onClick={() => setSelected(u.id)} className={selected === u.id ? 'selected' : ''}>
              <td>{u.username}</td>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>{u.status}</td>
              <td>{u.level}</td>
              <td>{u.seasonLp}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected && <UserPanel id={selected} onChanged={() => void list.reload()} />}
    </section>
  );
}

function UserPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { api, me } = useAuth();
  const { data, error, reload } = useFetch(() => api.get<UserDetail>(`/admin/users/${id}`), [api, id]);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setMessage(null);
    try {
      await fn();
      await reload();
      onChanged();
      setMessage('Enregistré.');
    } catch (e) {
      setMessage(errorText(e));
    }
  }

  if (error) return <p role="alert">{errorText(error)}</p>;
  if (!data) return null;
  const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
  return (
    <aside className="card panel">
      <h3>
        {data.fullName} (@{data.username})
      </h3>
      <p>
        {data.role} · {data.status}
        {data.suspendedUntil ? ` jusqu’au ${new Date(data.suspendedUntil).toLocaleString('fr-FR')}` : ''} · email{' '}
        {data.emailVerified ? 'vérifié' : 'non vérifié'}
      </p>
      <p>
        Niveau {data.level} · {data.xpTotal} XP · {data.seasonLp} LP ({data.division ?? '—'}) · {data.governorate} · salle : {data.gym ?? '—'}
      </p>
      <p>
        Séances : {data.workouts.total} (à vérifier {data.workouts.held}, refusées {data.workouts.rejected})
      </p>
      <label>
        Motif (obligatoire, visible dans l’audit)
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="row">
        <button disabled={reason.length < 3} onClick={() => act(() => api.patch(`/admin/users/${id}/status`, { status: 'SUSPENDED', until, reason }))}>
          Suspendre 7 jours
        </button>
        {canAdmin(me) && (
          <button className="danger" disabled={reason.length < 3} onClick={() => act(() => api.patch(`/admin/users/${id}/status`, { status: 'BANNED', reason }))}>
            Bannir
          </button>
        )}
        <button disabled={reason.length < 3} onClick={() => act(() => api.patch(`/admin/users/${id}/status`, { status: 'ACTIVE', reason }))}>
          Réactiver
        </button>
        {canAdmin(me) && (
          <select aria-label="Rôle" value={data.role} onChange={(e) => act(() => api.patch(`/admin/users/${id}/role`, { role: e.target.value }))}>
            {['USER', 'GYM_ADMIN', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      <h4>Historique</h4>
      <ul className="audit">
        {data.audit.map((a, i) => (
          <li key={i}>
            {new Date(a.at).toLocaleString('fr-FR')} — {a.action}
          </li>
        ))}
      </ul>
    </aside>
  );
}
