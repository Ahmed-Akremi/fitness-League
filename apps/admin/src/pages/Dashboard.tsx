import { errorText } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../components/useFetch';

interface Overview {
  users: number;
  active7d: number;
  workouts7d: number;
  heldWorkouts: number;
  pendingGyms: number;
  activeSeason: { name: string; endsAt: string } | null;
  activeRuleSetVersion: number;
}

export function Dashboard() {
  const { api } = useAuth();
  const { data, error } = useFetch(() => api.get<Overview>('/admin/stats/overview'), [api]);
  if (error) return <p role="alert">{errorText(error)}</p>;
  if (!data) return <p>Chargement…</p>;
  const tiles: [string, string | number][] = [
    ['Utilisateurs', data.users],
    ['Actifs (7 j)', data.active7d],
    ['Séances (7 j)', data.workouts7d],
    ['Séances à vérifier', data.heldWorkouts],
    ['Salles à vérifier', data.pendingGyms],
    ['Saison active', data.activeSeason ? `${data.activeSeason.name} (fin ${new Date(data.activeSeason.endsAt).toLocaleDateString('fr-FR')})` : '—'],
    ['Règles actives', `v${data.activeRuleSetVersion}`],
  ];
  return (
    <section>
      <h2>Tableau de bord</h2>
      <div className="tiles">
        {tiles.map(([label, value]) => (
          <div key={label} className="card tile">
            <span className="label">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
