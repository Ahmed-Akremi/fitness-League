import { useEffect, useState } from 'react';
import { ApiError, errorText } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../components/useFetch';

interface RuleSetRow {
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  changeNote: string;
  basedOnVersion: number | null;
  activatedAt: string | null;
}
interface Validation {
  valid: boolean;
  issues: { path: string; message: string }[];
  dryRun?: { week: string; users: number; meanTotalActive: number; meanTotalDraft: number; maxIncrease: number; maxDecrease: number };
}

/** Scoring rules: every number lives here, versioned; drafts are validated and dry-run before activation (docs §5.2). */
export function RuleSets() {
  const { api, me } = useAuth();
  const list = useFetch(() => api.get<RuleSetRow[]>('/admin/rule-sets'), [api]);
  const [version, setVersion] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<RuleSetRow['status'] | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);

  useEffect(() => {
    if (version === null) return;
    api.get<{ config: unknown; status: RuleSetRow['status'] }>(`/admin/rule-sets/${version}`).then((r) => {
      setText(JSON.stringify(r.config, null, 2));
      setStatus(r.status);
      setValidation(null);
      setMessage(null);
    });
  }, [api, version]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMessage(null);
    try {
      await fn();
      setMessage(ok);
      await list.reload();
    } catch (e) {
      const fields = e instanceof ApiError ? e.fieldErrors.map((f) => `${f.field}: ${String(f.params?.message ?? f.code)}`) : [];
      setMessage([errorText(e), ...fields].join('\n'));
    }
  }

  const draft = status === 'DRAFT';
  return (
    <section>
      <h2>Règles de scoring</h2>
      <div className="row">
        <input placeholder="Note de changement" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note de changement" />
        <button
          disabled={note.length < 3}
          onClick={() =>
            run(async () => {
              const r = await api.post<{ version: number }>('/admin/rule-sets', { changeNote: note });
              setVersion(r.version);
            }, 'Brouillon créé depuis la version active.')
          }
        >
          Nouveau brouillon
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Statut</th>
            <th>Note</th>
            <th>Activée</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((r) => (
            <tr key={r.version} onClick={() => setVersion(r.version)} className={version === r.version ? 'selected' : ''}>
              <td>v{r.version}</td>
              <td>{r.status}</td>
              <td>{r.changeNote}</td>
              <td>{r.activatedAt ? new Date(r.activatedAt).toLocaleString('fr-FR') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {version !== null && (
        <div className="card">
          <h3>
            v{version} · {status} {!draft && '(publiée : lecture seule)'}
          </h3>
          <textarea aria-label="Configuration JSON" value={text} onChange={(e) => setText(e.target.value)} readOnly={!draft} rows={24} spellCheck={false} />
          <div className="row">
            {draft && (
              <button
                onClick={() =>
                  run(async () => {
                    let config: unknown;
                    try {
                      config = JSON.parse(text);
                    } catch {
                      throw new ApiError(422, 'VALIDATION_FAILED', { errors: [{ field: 'JSON', code: 'syntaxe invalide' }] });
                    }
                    await api.put(`/admin/rule-sets/${version}`, { config });
                  }, 'Brouillon enregistré.')
                }
              >
                Enregistrer
              </button>
            )}
            <button onClick={() => run(async () => setValidation(await api.post<Validation>(`/admin/rule-sets/${version}/validate`)), 'Validation terminée.')}>
              Valider (simulation)
            </button>
            {draft && me?.role === 'SUPER_ADMIN' && (
              <button
                className="danger"
                onClick={() => window.confirm(`Activer v${version} pour tous les nouveaux calculs ?`) && run(() => api.post(`/admin/rule-sets/${version}/activate`), 'Version activée.')}
              >
                Activer
              </button>
            )}
          </div>
          {validation && (
            <div className="card">
              {validation.valid ? (
                <p>
                  Valide. Simulation semaine du {validation.dryRun?.week} sur {validation.dryRun?.users} athlètes : score moyen {validation.dryRun?.meanTotalActive} →{' '}
                  {validation.dryRun?.meanTotalDraft} (écart max +{validation.dryRun?.maxIncrease} / {validation.dryRun?.maxDecrease}).
                </p>
              ) : (
                <ul>
                  {validation.issues.map((i) => (
                    <li key={i.path}>
                      {i.path} : {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {message && <pre role="status">{message}</pre>}
        </div>
      )}
    </section>
  );
}
