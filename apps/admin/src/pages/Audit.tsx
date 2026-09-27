import { useState } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../components/useFetch';

interface Entry {
  id: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  entityType: string;
  entityId: string | null;
  after: unknown;
  at: string;
}

export function Audit() {
  const { api } = useAuth();
  const [action, setAction] = useState('');
  const { data, error } = useFetch(() => api.get<{ data: Entry[] }>(`/admin/audit-logs?limit=100${action ? `&action=${encodeURIComponent(action)}` : ''}`), [api, action]);
  if (error) return <p role="alert">{errorText(error)}</p>;
  return (
    <section>
      <h2>Journal d’audit</h2>
      <input placeholder="Filtrer par action (ex. USER_BANNED)" value={action} onChange={(e) => setAction(e.target.value.toUpperCase())} aria-label="Action" />
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Action</th>
            <th>Acteur</th>
            <th>Objet</th>
            <th>Détails</th>
          </tr>
        </thead>
        <tbody>
          {data?.data.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.at).toLocaleString('fr-FR')}</td>
              <td>{e.action}</td>
              <td>{e.actorId ? `${e.actorRole} ${e.actorId.slice(0, 8)}` : 'système'}</td>
              <td>
                {e.entityType} {e.entityId?.slice(0, 8)}
              </td>
              <td>
                <code>{e.after ? JSON.stringify(e.after).slice(0, 120) : ''}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
