import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../components/useFetch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;

const athleteName = (a: J) => a.fullName ?? a.username ?? '—';
/** "WOD 2 · Fran", or just "WOD 2" when the WOD is named after its number. */
const wodLabel = (w: J) => (w.name === `WOD ${w.number}` ? w.name : `WOD ${w.number} · ${w.name}`);
const STATUS: Record<string, string> = {
  SUBMITTED: 'À juger',
  UNDER_REVIEW: 'En revue',
  APPROVED: 'Validée',
  REJECTED: 'Refusée',
  NEEDS_CORRECTION: 'À corriger',
  PENALIZED: 'Pénalisée',
  FINAL: 'Finale',
};
const status = (s: string) => STATUS[s] ?? s;

/** Judge space (§26), home page of judge accounts: every athlete with their WODs and the YouTube link of each. */
export function JudgeAthletes() {
  const { api } = useAuth();
  const { data, error } = useFetch(() => api.get<J[]>('/admin/judge/athletes'), [api]);
  if (error) return <p role="alert">{errorText(error)}</p>;
  if (!data) return <p>Chargement…</p>;
  return (
    <section>
      <h2>Athlètes</h2>
      {data.every((g) => g.athletes.length === 0) && <p>Aucun athlète à juger pour le moment.</p>}
      {data.map((g) => (
        <div key={g.competition.id}>
          <h3>{g.competition.title}</h3>
          {g.athletes.map((a: J) => (
            <article key={a.athlete.id} className="card">
              <p>
                <strong>{athleteName(a.athlete)}</strong> · {a.category?.name} · {a.submissions.length} / {g.wodCount} WODs
              </p>
              <table>
                <tbody>
                  {a.submissions.map((s: J) => (
                    <tr key={s.id}>
                      <td>
                        <Link to={`/submissions/${s.id}`}>{wodLabel(s.workout)}</Link>
                      </td>
                      <td>{status(s.status)}</td>
                      <td>{s.points ?? s.rawValue ?? '—'}</td>
                      <td>
                        {s.videoUrl ? (
                          <a href={s.videoUrl} target="_blank" rel="noreferrer noopener">
                            ▶ {s.videoUrl}
                          </a>
                        ) : (
                          <span className="error">Pas de lien vidéo</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ))}
        </div>
      ))}
    </section>
  );
}

const QUEUES = [
  ['PENDING', 'À juger'],
  ['APPROVED', 'Validées'],
  ['REJECTED', 'Refusées'],
  ['PENALIZED', 'Pénalisées'],
] as const;

/** Submissions to review, by status. */
export function JudgeQueue() {
  const { api } = useAuth();
  const [queue, setQueue] = useState<(typeof QUEUES)[number][0]>('PENDING');
  const { data, error } = useFetch(() => api.get<J[]>(`/admin/judge/submissions?status=${queue}`), [api, queue]);
  return (
    <section>
      <h2>Soumissions</h2>
      <div className="row">
        {QUEUES.map(([key, label]) => (
          <button key={key} className={key === queue ? '' : 'secondary'} aria-pressed={key === queue} onClick={() => setQueue(key)}>
            {label}
          </button>
        ))}
      </div>
      {error ? <p role="alert">{errorText(error)}</p> : null}
      {data?.length === 0 && <p>Rien dans cette liste.</p>}
      <table>
        <tbody>
          {data?.map((s) => (
            <tr key={s.id}>
              <td>
                <Link to={`/submissions/${s.id}`}>
                  {athleteName(s.athlete)} · {s.workout?.name}
                </Link>
              </td>
              <td>{s.category?.name}</td>
              <td>{s.submittedAt ? new Date(s.submittedAt).toLocaleString('fr-FR') : ''}</td>
              <td>{s.points ?? s.rawValue ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** One submission (§27): score, video, then approve / reject / correction / penalty / adjustment, with a reason. */
export function JudgeReview() {
  const { id = '' } = useParams();
  const { api } = useAuth();
  const navigate = useNavigate();
  const { data: s, error, reload } = useFetch(() => api.get<J>(`/admin/judge/submissions/${id}`), [api, id]);
  const [reason, setReason] = useState('');
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function act(kind: string, body: J = {}) {
    try {
      await api.post(`/admin/judge/submissions/${id}/${kind}`, body);
      setMessage('Décision enregistrée.');
      setReason('');
      setValue('');
      await reload();
    } catch (e) {
      setMessage(errorText(e));
    }
  }

  if (error) return <p role="alert">{errorText(error)}</p>;
  if (!s) return <p>Chargement…</p>;
  const direct = s.workout.scoringMethod === 'DIRECT_POINTS';
  const v = Number(value.replace(',', '.'));
  const hasValue = value.trim() !== '' && Number.isFinite(v);
  const hasReason = reason.trim().length >= 3;
  return (
    <section>
      <button className="secondary" onClick={() => navigate(-1)}>
        ← Retour
      </button>
      <h2>{athleteName(s.athlete)}</h2>
      <p>
        {s.category?.name} · {s.workout.name} · <strong>{status(s.status)}</strong>
      </p>
      <article className="card">
        <p>
          Score déclaré : <strong>{s.rawValue ?? '—'}</strong>
          {s.points != null ? ` · ${s.points} pts` : ''}
        </p>
        {s.workout.scoreType === 'MOVEMENT_REPS' && Array.isArray(s.raw?.movementReps) ? (
          <ul>
            {(s.workout.movements ?? []).map((m: J, i: number) => (
              <li key={i}>
                {m.name} : {s.raw.movementReps[i]} rép. × {m.pointsPerRep} = {Math.round(s.raw.movementReps[i] * m.pointsPerRep * 100) / 100} pts
              </li>
            ))}
          </ul>
        ) : null}
        {s.notes ? <p>{s.notes}</p> : null}
        {s.submittedAt ? <p>Envoyé le {new Date(s.submittedAt).toLocaleString('fr-FR')}</p> : null}
        {s.youtubeId ? (
          <iframe
            title="Vidéo de la performance"
            width="560"
            height="315"
            style={{ maxWidth: '100%', border: 0 }}
            src={`https://www.youtube-nocookie.com/embed/${s.youtubeId}`}
            allow="encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : null}
        {s.videoUrl ? (
          <p>
            <a href={s.videoUrl} target="_blank" rel="noreferrer noopener">
              ▶ Ouvrir sur YouTube
            </a>
          </p>
        ) : (
          <p className="error">Pas de lien vidéo</p>
        )}
      </article>

      <article className="card">
        <h3>Décision</h3>
        {message && <p role="status">{message}</p>}
        <div className="row">
          <button onClick={() => act('approve')}>Valider</button>
        </div>
        <label>
          Motif (obligatoire sauf pour valider)
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label>
          {direct ? 'Points' : 'Valeur'} (pénalité ou nouveau score)
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <div className="row">
          <button disabled={!hasReason || !hasValue} onClick={() => act('penalty', { type: 'POINT_PENALTY', points: v, reason })}>
            Pénaliser de {hasValue ? v : '…'} pts
          </button>
          <button
            disabled={!hasReason || !hasValue}
            onClick={() =>
              act('adjust-score', {
                ...(direct ? { points: v } : { rawValue: v }),
                reason,
              })
            }
          >
            Corriger le score
          </button>
          <button className="secondary" disabled={!hasReason} onClick={() => act('needs-correction', { reason })}>
            Demander une correction
          </button>
          <button className="danger" disabled={!hasReason} onClick={() => act('reject', { reason })}>
            Refuser
          </button>
        </div>
      </article>

      {s.versions ? (
        <article className="card">
          <h3>Historique</h3>
          <ul>
            {s.versions.map((x: J) => (
              <li key={x.version}>
                v{x.version} · {x.points} pts · {x.reason} · {new Date(x.createdAt).toLocaleString('fr-FR')}
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </section>
  );
}

const ROLE: Record<string, string> = {
  ORGANIZER: 'Organisateur',
  HEAD_JUDGE: 'Juge en chef',
  JUDGE: 'Juge',
};

/** Head judge: the judges and head judges of each competition, their WODs, and the final publication. */
export function JudgeTeam() {
  const { api } = useAuth();
  const comps = useFetch(() => api.get<J[]>('/admin/judge/competitions'), [api]);
  const accounts = useFetch(() => api.get<J[]>('/admin/judges'), [api]);
  const led = (comps.data ?? []).filter((c) => c.myRoles.includes('HEAD_JUDGE'));
  if (comps.error) return <p role="alert">{errorText(comps.error)}</p>;
  if (!comps.data) return <p>Chargement…</p>;
  return (
    <section>
      <h2>Équipe des juges</h2>
      {led.length === 0 && <p>Vous n’êtes juge en chef d’aucune compétition.</p>}
      {led.map((c) => (
        <TeamPanel key={c.id} competition={c} accounts={accounts.data ?? []} />
      ))}
    </section>
  );
}

function TeamPanel({ competition: c, accounts }: { competition: J; accounts: J[] }) {
  const { api } = useAuth();
  const staff = useFetch(() => api.get<J[]>(`/admin/judge/competitions/${c.id}/staff`), [api, c.id]);
  const [add, setAdd] = useState({ userId: '', role: 'JUDGE' });
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const base = `/admin/judge/competitions/${c.id}`;

  async function run(done: string, f: () => Promise<unknown>) {
    try {
      await f();
      setMessage(done);
      await staff.reload();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    void run('Juge ajouté.', () => api.post(`${base}/staff`, add));
  };
  const onTeam = new Set((staff.data ?? []).map((s) => `${s.userId}:${s.role}`));
  const candidates = accounts.filter((a) => (add.role === 'HEAD_JUDGE' ? a.role === 'HEAD_JUDGE' : true) && !onTeam.has(`${a.id}:${add.role}`));
  const wod = (id: string | null) => (id ? (c.workouts.find((w: J) => w.id === id)?.name ?? 'WOD') : 'tous les WODs');

  return (
    <article className="card">
      <h3>{c.title}</h3>
      {message && <p role="status">{message}</p>}
      {staff.error ? <p role="alert">{errorText(staff.error)}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Membre</th>
            <th>Rôle</th>
            <th>WODs</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(staff.data ?? []).map((s) => (
            <tr key={s.id}>
              <td>{s.user?.profile?.fullName ?? s.user?.username}</td>
              <td>{ROLE[s.role] ?? s.role}</td>
              <td>
                {s.role === 'ORGANIZER' ? '—' : s.assignments.length ? s.assignments.map((a: J) => wod(a.workoutId)).join(', ') : 'tous les WODs'}
                {s.role === 'JUDGE' && (
                  <span>
                    {' '}
                    <select aria-label="WOD à assigner" value={assign[s.id] ?? ''} onChange={(e) => setAssign({ ...assign, [s.id]: e.target.value })}>
                      <option value="">— WOD —</option>
                      {c.workouts.map((w: J) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={!assign[s.id]}
                      onClick={() =>
                        run('WOD assigné.', () =>
                          api.post(`${base}/judge-assignments`, {
                            staffId: s.id,
                            workoutId: assign[s.id],
                          }),
                        )
                      }
                    >
                      Assigner
                    </button>
                  </span>
                )}
              </td>
              <td>
                {s.role !== 'ORGANIZER' && (
                  <button className="danger" onClick={() => window.confirm('Retirer ce juge de la compétition ?') && run('Juge retiré.', () => api.delete(`${base}/staff/${s.id}`))}>
                    Retirer
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={onAdd} className="row">
        <select aria-label="Rôle" value={add.role} onChange={(e) => setAdd({ userId: '', role: e.target.value })}>
          <option value="JUDGE">Juge</option>
          <option value="HEAD_JUDGE">Juge en chef</option>
        </select>
        <select aria-label="Compte juge" required value={add.userId} onChange={(e) => setAdd({ ...add, userId: e.target.value })}>
          <option value="">— Compte juge —</option>
          {candidates.map((a) => (
            <option key={a.id} value={a.id}>
              {a.username} ({ROLE[a.role]})
            </option>
          ))}
        </select>
        <button type="submit">Ajouter</button>
      </form>
      <p>
        <button disabled={!!c.leaderboardLockedAt} onClick={() => window.confirm('Publier le classement final ? Il sera verrouillé.') && run('Classement publié.', () => api.post(`${base}/publish-leaderboard`))}>
          {c.leaderboardLockedAt ? 'Classement publié' : 'Publier le classement final'}
        </button>
      </p>
    </article>
  );
}
