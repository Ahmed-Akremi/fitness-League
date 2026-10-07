import { NavLink, Outlet } from 'react-router-dom';
import { canAdmin, isJudge, useAuth } from '../auth';

const ROLE_LABEL: Record<string, string> = { JUDGE: 'Juge', HEAD_JUDGE: 'Juge en chef' };

export function Layout() {
  const { me, logout } = useAuth();
  const admin = canAdmin(me);
  return (
    <div className="shell">
      <nav aria-label="Navigation">
        <strong className="brand">{isJudge(me) ? 'FL Juges' : 'FL Admin'}</strong>
        {isJudge(me) ? (
          <>
            <NavLink to="/" end>
              Athlètes
            </NavLink>
            <NavLink to="/submissions">Soumissions</NavLink>
            {me?.role === 'HEAD_JUDGE' && <NavLink to="/team">Équipe des juges</NavLink>}
          </>
        ) : (
          <StaffLinks admin={admin} />
        )}
        <span className="spacer" />
        <span className="who">
          {me?.username} · {ROLE_LABEL[me?.role ?? ''] ?? me?.role}
        </span>
        <button onClick={() => void logout()}>Déconnexion</button>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

function StaffLinks({ admin }: { admin: boolean }) {
  return (
    <>
      <NavLink to="/" end>
        Tableau de bord
      </NavLink>
      <NavLink to="/users">Utilisateurs</NavLink>
      <NavLink to="/held">Séances à vérifier</NavLink>
      <NavLink to="/proofs">Preuves</NavLink>
      <NavLink to="/moderation">Signalements</NavLink>
      {admin && <NavLink to="/gyms">Salles à vérifier</NavLink>}
      {admin && <NavLink to="/rule-sets">Règles de scoring</NavLink>}
      {admin && <NavLink to="/seasons">Saisons</NavLink>}
      {admin && <NavLink to="/announcements">Publications</NavLink>}
      {admin && <NavLink to="/competitions">Compétitions</NavLink>}
      {admin && <NavLink to="/judges">Comptes juges</NavLink>}
      {admin && <NavLink to="/audit">Journal d’audit</NavLink>}
    </>
  );
}
