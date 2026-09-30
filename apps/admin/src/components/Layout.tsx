import { NavLink, Outlet } from 'react-router-dom';
import { canAdmin, useAuth } from '../auth';

export function Layout() {
  const { me, logout } = useAuth();
  const admin = canAdmin(me);
  return (
    <div className="shell">
      <nav aria-label="Navigation">
        <strong className="brand">FL Admin</strong>
        <NavLink to="/" end>
          Tableau de bord
        </NavLink>
        <NavLink to="/users">Utilisateurs</NavLink>
        <NavLink to="/held">Séances à vérifier</NavLink>
        <NavLink to="/proofs">Preuves</NavLink>
        {admin && <NavLink to="/gyms">Salles à vérifier</NavLink>}
        {admin && <NavLink to="/rule-sets">Règles de scoring</NavLink>}
        {admin && <NavLink to="/seasons">Saisons</NavLink>}
        {admin && <NavLink to="/audit">Journal d’audit</NavLink>}
        <span className="spacer" />
        <span className="who">
          {me?.username} · {me?.role}
        </span>
        <button onClick={() => void logout()}>Déconnexion</button>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
