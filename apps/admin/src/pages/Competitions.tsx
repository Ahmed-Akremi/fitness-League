import { FormEvent, ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../components/useFetch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;

const STATUSES = ['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ACTIVE', 'SUBMISSION_OPEN', 'JUDGING', 'PROVISIONAL_LEADERBOARD', 'FINISHED', 'CANCELLED'];
const money = (minor: number, currency: string) => `${(minor / (currency === 'TND' ? 1000 : 100)).toLocaleString('fr-FR')} ${currency}`;
const toMinor = (major: string, currency: string) => Math.round(Number(major.replace(',', '.')) * (currency === 'TND' ? 1000 : 100));
const iso = (local: string) => new Date(local).toISOString();

/** Admin → Competitions (§55): list and creation. */
export function Competitions() {
  const { api } = useAuth();
  const { data, error, reload } = useFetch(() => api.get<J[]>('/admin/competitions'), [api]);
  const [message, setMessage] = useState<string | null>(null);
  const [f, setF] = useState({ title: '', slug: '', description: '', format: 'ONLINE', city: '', price: '35', currency: 'TND', registrationStart: '', registrationEnd: '', eventStart: '', eventEnd: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/admin/competitions', {
        title: f.title,
        slug: f.slug,
        description: f.description,
        format: f.format,
        city: f.city || undefined,
        registrationPrice: toMinor(f.price, f.currency),
        currency: f.currency,
        registrationStart: iso(f.registrationStart),
        registrationEnd: iso(f.registrationEnd),
        eventStart: iso(f.eventStart),
        eventEnd: iso(f.eventEnd),
      });
      setMessage('Compétition créée (brouillon).');
      await reload();
    } catch (err) {
      setMessage(errorText(err));
    }
  }

  return (
    <section>
      <h1>Compétitions</h1>
      {error ? <p className="error">{errorText(error)}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Nom</th>
            <th>Statut</th>
            <th>Date</th>
            <th>Prix</th>
            <th>Athlètes</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((c) => (
            <tr key={c.id}>
              <td>
                <Link to={`/competitions/${c.id}`}>{c.title}</Link>
              </td>
              <td>{c.status}</td>
              <td>{new Date(c.eventStart).toLocaleDateString('fr-FR')}</td>
              <td>{money(c.registrationPrice, c.currency)}</td>
              <td>{c.participants}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Créer une compétition</h2>
      <form onSubmit={create} className="grid">
        <input required placeholder="Titre" value={f.title} onChange={set('title')} />
        <input required placeholder="slug-en-minuscules" pattern="[a-z0-9]+(-[a-z0-9]+)*" value={f.slug} onChange={set('slug')} />
        <textarea required placeholder="Description" value={f.description} onChange={set('description')} />
        <select value={f.format} onChange={set('format')}>
          <option>ONLINE</option>
          <option>ONSITE</option>
          <option>HYBRID</option>
        </select>
        <input placeholder="Ville" value={f.city} onChange={set('city')} />
        <label>
          Prix d’inscription <input required inputMode="decimal" value={f.price} onChange={set('price')} />
          <select value={f.currency} onChange={set('currency')}>
            <option>TND</option>
            <option>EUR</option>
          </select>
        </label>
        <label>Début des inscriptions <input required type="datetime-local" value={f.registrationStart} onChange={set('registrationStart')} /></label>
        <label>Fin des inscriptions <input required type="datetime-local" value={f.registrationEnd} onChange={set('registrationEnd')} /></label>
        <label>Début de l’événement <input required type="datetime-local" value={f.eventStart} onChange={set('eventStart')} /></label>
        <label>Fin de l’événement <input required type="datetime-local" value={f.eventEnd} onChange={set('eventEnd')} /></label>
        <button type="submit">Créer</button>
      </form>
      {message ? <p className="message">{message}</p> : null}
    </section>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open>
      <summary>
        <h2 style={{ display: 'inline' }}>{title}</h2>
      </summary>
      {children}
    </details>
  );
}

/** One competition: status, figures, categories, WODs, prizes, coupons, judges, registrations, leaderboard. */
export function CompetitionDetail() {
  const { id = '' } = useParams();
  const { api } = useAuth();
  const base = `/admin/competitions/${id}`;
  const comp = useFetch(() => api.get<J>(base), [api, id]);
  const dash = useFetch(() => api.get<J>(`${base}/dashboard`), [api, id]);
  const regs = useFetch(() => api.get<J[]>(`${base}/registrations`), [api, id]);
  const coupons = useFetch(() => api.get<J[]>(`${base}/coupons`), [api, id]);
  const staff = useFetch(() => api.get<J[]>(`${base}/staff`), [api, id]);
  const judgeAccounts = useFetch(() => api.get<J[]>('/admin/judges'), [api]);
  const heats = useFetch(() => api.get<J[]>(`${base}/heats`), [api, id]);
  const athletes = useFetch(() => api.get<J>(`${base}/athletes`), [api, id]);
  const [categoryId, setCategoryId] = useState('');
  const board = useFetch(() => (categoryId ? api.get<J>(`${base}/leaderboard?categoryId=${categoryId}`) : Promise.resolve(null)), [api, id, categoryId]);
  const [message, setMessage] = useState<string | null>(null);
  const [cat, setCat] = useState({ name: '', gender: 'MALE', minAge: '', maxAge: '', price: '' });
  const [wod, setWod] = useState({ name: '', description: '', points: '100', start: '', end: '', method: 'DIRECT_POINTS', table: '100,95,90,85,80', scoreType: 'POINTS' });
  const [prize, setPrize] = useState({ position: '1', type: 'CASH', amount: '', description: '' });
  const [coupon, setCoupon] = useState({ code: '', type: 'FREE', value: '', maxUses: '' });
  const [judge, setJudge] = useState({ userId: '', role: 'JUDGE' });
  const [auto, setAuto] = useState({ categoryId: '', workoutId: '', laneCount: '8', startsAt: '', intervalMin: '15' });
  const [lane, setLane] = useState<Record<string, { registrationId: string; lane: string }>>({});

  async function run(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      setMessage(label);
      await Promise.all([comp.reload(), dash.reload(), regs.reload(), coupons.reload(), staff.reload(), heats.reload(), athletes.reload(), board.reload()]);
    } catch (err) {
      setMessage(errorText(err));
    }
  }

  const c = comp.data;
  if (comp.error) return <p className="error">{errorText(comp.error)}</p>;
  if (!c) return <p>Chargement…</p>;
  const cur = c.currency as string;
  const d = dash.data;
  const nextWod = (c.workouts?.length ?? 0) + 1;

  return (
    <section>
      <p>
        <Link to="/competitions">← Compétitions</Link>
      </p>
      <h1>{c.title}</h1>
      <p>
        Statut : <strong>{c.status}</strong> · {c.format} · {money(c.registrationPrice, cur)} · {c.participants} athlète(s)
      </p>
      <p>
        Passer à :{' '}
        {STATUSES.filter((s) => s !== c.status).map((s) => (
          <button key={s} type="button" onClick={() => run(`Statut : ${s}`, () => api.patch(`${base}/status`, { status: s }))}>
            {s}
          </button>
        ))}{' '}
        <button type="button" onClick={() => window.confirm('Valider et publier le classement final ? Il sera verrouillé.') && run('Classement final publié et verrouillé.', () => api.post(`${base}/publish-leaderboard`))}>
          Publier le classement final
        </button>
      </p>
      {message ? <p className="message">{message}</p> : null}
      {d && (
        <p>
          Participants {d.participants} · payées {d.paidRegistrations} · gratuites {d.freeRegistrations} · paiements en attente {d.pendingPayments} · revenus {money(d.revenue, cur)} · à juger {d.pendingJudging} · validées {d.approvedSubmissions} · refusées {d.rejectedSubmissions}
        </p>
      )}

      <Panel title="Catégories">
        <table>
          <tbody>
            {c.categories.map((x: J) => (
              <tr key={x.id}>
                <td>{x.name}</td>
                <td>{x.gender}</td>
                <td>{x.minAge ?? '—'}–{x.maxAge ?? '+'}</td>
                <td>{money(x.price, cur)}</td>
                <td>
                  <button type="button" onClick={() => run('Catégorie mise à jour.', () => api.put(`${base}/categories/${x.id}`, { active: !x.active }))}>{x.active ? 'Désactiver' : 'Activer'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" onClick={() => run('18 catégories modèles ajoutées.', () => api.post(`${base}/categories/templates`))}>
          Ajouter les 18 catégories modèles
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('Catégorie ajoutée.', () =>
              api.post(`${base}/categories`, {
                name: cat.name,
                gender: cat.gender,
                ...(cat.minAge ? { minAge: Number(cat.minAge) } : {}),
                ...(cat.maxAge ? { maxAge: Number(cat.maxAge) } : {}),
                ...(cat.price ? { registrationPriceOverride: toMinor(cat.price, cur) } : {}),
              }),
            );
          }}
        >
          <input required placeholder="Nom" value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} />
          <select value={cat.gender} onChange={(e) => setCat({ ...cat, gender: e.target.value })}>
            <option>MALE</option>
            <option>FEMALE</option>
            <option>MIXED</option>
          </select>
          <input placeholder="Âge min" inputMode="numeric" value={cat.minAge} onChange={(e) => setCat({ ...cat, minAge: e.target.value })} />
          <input placeholder="Âge max" inputMode="numeric" value={cat.maxAge} onChange={(e) => setCat({ ...cat, maxAge: e.target.value })} />
          <input placeholder={`Prix spécifique (${cur})`} inputMode="decimal" value={cat.price} onChange={(e) => setCat({ ...cat, price: e.target.value })} />
          <button type="submit">Ajouter</button>
        </form>
      </Panel>

      <Panel title="WODs">
        <table>
          <tbody>
            {c.workouts.map((w: J) => (
              <tr key={w.id}>
                <td>#{w.number}</td>
                <td>{w.name}</td>
                <td>{w.scoreType}</td>
                <td>{w.scoringMethod}</td>
                <td>{w.maximumPoints} pts max</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('WOD créé.', () =>
              api.post(`${base}/wods`, {
                number: nextWod,
                name: wod.name || `WOD ${nextWod}`,
                description: wod.description,
                scoreType: wod.scoreType,
                scoringMethod: wod.method,
                maximumPoints: Number(wod.points),
                ...(wod.method === 'PLACEMENT_POINTS' ? { placementTable: wod.table.split(',').map((x) => Number(x.trim())) } : {}),
                submissionStart: iso(wod.start),
                submissionDeadline: iso(wod.end),
              }),
            );
          }}
        >
          <input placeholder={`WOD ${nextWod}`} value={wod.name} onChange={(e) => setWod({ ...wod, name: e.target.value })} />
          <textarea required placeholder="Description / standards" value={wod.description} onChange={(e) => setWod({ ...wod, description: e.target.value })} />
          <select value={wod.scoreType} onChange={(e) => setWod({ ...wod, scoreType: e.target.value })}>
            {['TIME', 'REPS', 'ROUNDS_REPS', 'DISTANCE', 'LOAD', 'CALORIES', 'POINTS', 'MAX_WEIGHT', 'COMPLEX'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={wod.method} onChange={(e) => setWod({ ...wod, method: e.target.value })}>
            <option>DIRECT_POINTS</option>
            <option>PLACEMENT_POINTS</option>
          </select>
          <label>Points max <input required inputMode="numeric" value={wod.points} onChange={(e) => setWod({ ...wod, points: e.target.value })} /></label>
          {wod.method === 'PLACEMENT_POINTS' && <input placeholder="Points par place : 100,95,90…" value={wod.table} onChange={(e) => setWod({ ...wod, table: e.target.value })} />}
          <label>Soumissions du <input required type="datetime-local" value={wod.start} onChange={(e) => setWod({ ...wod, start: e.target.value })} /></label>
          <label>au <input required type="datetime-local" value={wod.end} onChange={(e) => setWod({ ...wod, end: e.target.value })} /></label>
          <button type="submit">Créer le WOD</button>
        </form>
      </Panel>

      <Panel title="Prix / récompenses">
        <ul>
          {c.prizes.map((p: J) => (
            <li key={p.id}>
              #{p.position} {p.type} {p.amount != null ? money(p.amount, p.currency ?? cur) : ''} {p.description ?? ''}
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('Prix ajouté.', () => api.post(`${base}/prizes`, { position: Number(prize.position), type: prize.type, ...(prize.amount ? { amount: toMinor(prize.amount, cur) } : {}), description: prize.description || undefined }));
          }}
        >
          <input required inputMode="numeric" placeholder="Place" value={prize.position} onChange={(e) => setPrize({ ...prize, position: e.target.value })} />
          <select value={prize.type} onChange={(e) => setPrize({ ...prize, type: e.target.value })}>
            {['CASH', 'TROPHY', 'MEDAL', 'EQUIPMENT', 'VOUCHER', 'CUSTOM'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input placeholder={`Montant (${cur})`} inputMode="decimal" value={prize.amount} onChange={(e) => setPrize({ ...prize, amount: e.target.value })} />
          <input placeholder="Description" value={prize.description} onChange={(e) => setPrize({ ...prize, description: e.target.value })} />
          <button type="submit">Ajouter</button>
        </form>
      </Panel>

      <Panel title="Coupons">
        <table>
          <tbody>
            {(coupons.data ?? []).map((x) => (
              <tr key={x.id}>
                <td>{x.code}</td>
                <td>{x.type}{x.type === 'PERCENTAGE' ? ` ${x.value}%` : x.type === 'FIXED_AMOUNT' ? ` ${money(x.value, cur)}` : ''}</td>
                <td>{x.usedCount}/{x.maxUses ?? '∞'}</td>
                <td>
                  <button type="button" onClick={() => run('Coupon mis à jour.', () => api.post(`${base}/coupons/${x.id}/${x.active ? 'deactivate' : 'activate'}`))}>{x.active ? 'Désactiver' : 'Activer'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('Coupon créé.', () =>
              api.post(`${base}/coupons`, {
                code: coupon.code.toUpperCase(),
                type: coupon.type,
                ...(coupon.type === 'PERCENTAGE' ? { value: Number(coupon.value) } : coupon.type === 'FIXED_AMOUNT' ? { value: toMinor(coupon.value, cur) } : {}),
                ...(coupon.maxUses ? { maxUses: Number(coupon.maxUses) } : {}),
              }),
            );
          }}
        >
          <input required placeholder="CODE2026" value={coupon.code} onChange={(e) => setCoupon({ ...coupon, code: e.target.value })} />
          <select value={coupon.type} onChange={(e) => setCoupon({ ...coupon, type: e.target.value })}>
            <option>FREE</option>
            <option>PERCENTAGE</option>
            <option>FIXED_AMOUNT</option>
          </select>
          {coupon.type !== 'FREE' && <input required placeholder={coupon.type === 'PERCENTAGE' ? '%' : cur} inputMode="decimal" value={coupon.value} onChange={(e) => setCoupon({ ...coupon, value: e.target.value })} />}
          <input placeholder="Utilisations max" inputMode="numeric" value={coupon.maxUses} onChange={(e) => setCoupon({ ...coupon, maxUses: e.target.value })} />
          <button type="submit">Créer</button>
        </form>
      </Panel>

      <Panel title="Juges">
        <ul>
          {(staff.data ?? []).map((s) => (
            <li key={s.id}>
              {s.user?.profile?.fullName ?? s.user?.username} — {s.role}
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('Membre du staff ajouté.', () => api.post(`${base}/staff`, judge));
          }}
        >
          {judge.role === 'ORGANIZER' ? (
            <input required placeholder="Identifiant utilisateur (UUID)" value={judge.userId} onChange={(e) => setJudge({ ...judge, userId: e.target.value })} />
          ) : (
            // Judges and head judges are judge accounts (menu « Comptes juges »), never athletes.
            <select required aria-label="Compte juge" value={judge.userId} onChange={(e) => setJudge({ ...judge, userId: e.target.value })}>
              <option value="">— Compte juge —</option>
              {(judgeAccounts.data ?? [])
                .filter((a) => judge.role === 'JUDGE' || a.role === 'HEAD_JUDGE')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.username} ({a.role})
                  </option>
                ))}
            </select>
          )}
          <select value={judge.role} onChange={(e) => setJudge({ userId: '', role: e.target.value })}>
            <option>JUDGE</option>
            <option>HEAD_JUDGE</option>
            <option>ORGANIZER</option>
          </select>
          <button type="submit">Ajouter</button>
        </form>
      </Panel>

      <Panel title="Inscriptions">
        <table>
          <tbody>
            {(regs.data ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.user?.profile?.fullName ?? r.user?.username}</td>
                <td>{r.category?.name}</td>
                <td>{money(r.finalPrice, r.currency)}{r.discount ? ` (−${money(r.discount, r.currency)})` : ''}</td>
                <td>{r.registrationStatus} / {r.paymentStatus}</td>
                <td>
                  {r.paymentStatus === 'PENDING' && (
                    <button type="button" onClick={() => run('Paiement enregistré.', () => api.post(`${base}/registrations/${r.id}/mark-paid`))}>
                      Marquer payé
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Athlètes et vidéos">
        {athletes.error ? <p className="error">{errorText(athletes.error)}</p> : null}
        {athletes.data && athletes.data.athletes.length === 0 ? <p>Aucun athlète inscrit.</p> : null}
        {athletes.data?.athletes.map((a: J) => (
          <div key={a.athlete.id} style={{ marginBottom: 12 }}>
            <strong>{a.athlete.fullName ?? a.athlete.username}</strong> · {a.category?.name} · {a.submissions.length} / {athletes.data!.wodCount} WODs
            <table>
              <tbody>
                {a.submissions.map((s: J) => (
                  <tr key={s.id}>
                    <td>WOD {s.workout.number} · {s.workout.name}</td>
                    <td>{s.status}</td>
                    <td>{s.points ?? s.rawValue ?? '—'}</td>
                    <td>
                      {s.videoUrl ? (
                        <a href={s.videoUrl} target="_blank" rel="noreferrer noopener">
                          {s.videoUrl}
                        </a>
                      ) : (
                        <span className="error">Pas de lien vidéo</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Panel>

      <Panel title="Heats">
        {(heats.data ?? []).map((h) => {
          const draft = lane[h.id] ?? { registrationId: '', lane: '' };
          const used = new Set((h.lanes as J[]).map((l) => l.registrationId));
          return (
            <div key={h.id}>
              <h3>
                {h.name} · {h.workout?.name ?? 'tous WODs'} · {h.startsAt ? new Date(h.startsAt).toLocaleString('fr-FR') : 'horaire à définir'} · {h.lanes.length}/{h.laneCount} couloirs{' '}
                <button type="button" onClick={() => window.confirm(`Supprimer ${h.name} ?`) && run('Heat supprimé.', () => api.delete(`${base}/heats/${h.id}`))}>
                  Supprimer
                </button>
              </h3>
              <ul>
                {(h.lanes as J[]).map((l) => (
                  <li key={l.lane}>
                    Couloir {l.lane} : {l.athlete.fullName ?? l.athlete.username}{' '}
                    <button type="button" onClick={() => run('Couloir libéré.', () => api.delete(`${base}/heats/${h.id}/lanes/${l.lane}`))}>
                      Libérer
                    </button>
                  </li>
                ))}
              </ul>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run('Athlète placé.', () => api.post(`${base}/heats/${h.id}/lanes`, { registrationId: draft.registrationId, lane: Number(draft.lane) }));
                }}
              >
                <select required value={draft.registrationId} onChange={(e) => setLane({ ...lane, [h.id]: { ...draft, registrationId: e.target.value } })}>
                  <option value="">— Athlète —</option>
                  {(regs.data ?? [])
                    .filter((r) => r.registrationStatus === 'CONFIRMED' && !used.has(r.id) && (!h.category || r.categoryId === h.category.id))
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.user?.profile?.fullName ?? r.user?.username} ({r.category?.name})
                      </option>
                    ))}
                </select>
                <input required placeholder="Couloir" inputMode="numeric" value={draft.lane} onChange={(e) => setLane({ ...lane, [h.id]: { ...draft, lane: e.target.value } })} />
                <button type="submit">Placer</button>
              </form>
            </div>
          );
        })}
        <h3>Générer les heats d’une catégorie</h3>
        <p>Les athlètes confirmés sont répartis selon le classement actuel : les premiers courent dans le dernier heat.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('Heats générés.', () =>
              api.post(`${base}/heats/auto`, {
                categoryId: auto.categoryId,
                ...(auto.workoutId ? { workoutId: auto.workoutId } : {}),
                laneCount: Number(auto.laneCount),
                ...(auto.startsAt ? { startsAt: iso(auto.startsAt), intervalMin: Number(auto.intervalMin) } : {}),
              }),
            );
          }}
        >
          <select required value={auto.categoryId} onChange={(e) => setAuto({ ...auto, categoryId: e.target.value })}>
            <option value="">— Catégorie —</option>
            {c.categories.map((x: J) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select value={auto.workoutId} onChange={(e) => setAuto({ ...auto, workoutId: e.target.value })}>
            <option value="">Tous les WODs</option>
            {c.workouts.map((w: J) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <label>Couloirs par heat <input required inputMode="numeric" value={auto.laneCount} onChange={(e) => setAuto({ ...auto, laneCount: e.target.value })} /></label>
          <label>Premier départ <input type="datetime-local" value={auto.startsAt} onChange={(e) => setAuto({ ...auto, startsAt: e.target.value })} /></label>
          <label>Minutes entre deux heats <input inputMode="numeric" value={auto.intervalMin} onChange={(e) => setAuto({ ...auto, intervalMin: e.target.value })} /></label>
          <button type="submit">Générer</button>
        </form>
        <button type="button" onClick={() => run('Heat créé.', () => api.post(`${base}/heats`, {}))}>
          Ajouter un heat vide
        </button>
      </Panel>

      <Panel title="Classement">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">— Catégorie —</option>
          {c.categories.map((x: J) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        {board.data && (
          <>
            <p>{board.data.provisional ? 'Provisoire : les résultats peuvent encore changer.' : 'Classement final (verrouillé).'}</p>
            <table>
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Athlète</th>
                  {(board.data.workouts ?? []).map((w: J) => (
                    <th key={w.id}>{w.name}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {(board.data.rows ?? []).map((r: J) => (
                  <tr key={r.athlete.id}>
                    <td>{r.rank}</td>
                    <td>{r.athlete.fullName ?? r.athlete.username}</td>
                    {(board.data?.workouts ?? []).map((w: J) => (
                      <td key={w.id}>{r.wodPoints[w.id] ?? '—'}</td>
                    ))}
                    <td>
                      <strong>{r.totalPoints}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Panel>
    </section>
  );
}
