import { FormEvent, useState } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../components/useFetch';

interface JudgeAccount {
  id: string;
  email: string;
  username: string;
  role: 'JUDGE' | 'HEAD_JUDGE';
  status: string;
  lastLoginAt: string | null;
}

/** Admins generate judge and head judge accounts (admin panel judge space only, never the app). */
export function Judges() {
  const { api } = useAuth();
  const { data, error, reload } = useFetch(() => api.get<JudgeAccount[]>('/admin/judges'), [api]);
  const [form, setForm] = useState({ email: '', username: '', role: 'JUDGE' });
  const [created, setCreated] = useState<(JudgeAccount & { password: string }) | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      setCreated(await api.post<JudgeAccount & { password: string }>('/admin/judges', form));
      setForm({ email: '', username: '', role: form.role });
      await reload();
    } catch (err) {
      setMessage(errorText(err));
    }
  }

  return (
    <section>
      <h2>Comptes juges</h2>
      <form onSubmit={submit} className="card" aria-label="Nouveau compte juge">
        <label>
          Email
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>
          Nom d’utilisateur (a-z, 0-9, _ .)
          <input required pattern="[a-z0-9_.]{3,20}" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </label>
        <label>
          Rôle
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="JUDGE">Juge</option>
            <option value="HEAD_JUDGE">Juge en chef</option>
          </select>
        </label>
        <button type="submit">Générer le compte</button>
        {message && (
          <p role="alert" className="error">
            {message}
          </p>
        )}
      </form>
      {created && (
        <article className="card" role="status">
          <p>
            Compte créé : <strong>{created.email}</strong> ({created.role === 'HEAD_JUDGE' ? 'juge en chef' : 'juge'})
          </p>
          <p>
            Mot de passe : <code className="secret">{created.password}</code>
          </p>
          <p>Notez-le maintenant : il ne sera plus affiché. Le juge se connecte sur ce panneau, pas sur l’application.</p>
        </article>
      )}
      {error ? <p role="alert">{errorText(error)}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Utilisateur</th>
            <th>Email</th>
            <th>Rôle</th>
            <th>Dernière connexion</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((j) => (
            <tr key={j.id}>
              <td>{j.username}</td>
              <td>{j.email}</td>
              <td>{j.role === 'HEAD_JUDGE' ? 'Juge en chef' : 'Juge'}</td>
              <td>{j.lastLoginAt ? new Date(j.lastLoginAt).toLocaleString('fr-FR') : 'jamais'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
