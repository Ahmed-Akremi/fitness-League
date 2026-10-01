import { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { canAdmin, useAuth } from './auth';
import { Layout } from './components/Layout';
import { Audit } from './pages/Audit';
import { CompetitionDetail, Competitions } from './pages/Competitions';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Moderation } from './pages/Moderation';
import { GymVerification, HeldWorkouts, ProofQueue } from './pages/Queues';
import { RuleSets } from './pages/RuleSets';
import { Seasons } from './pages/Seasons';
import { Users } from './pages/Users';

/** The server enforces every permission; hiding pages here is only for clarity. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  return canAdmin(me) ? children : <Navigate to="/" replace />;
}

export function App() {
  const { me, ready } = useAuth();
  if (!ready) return <p className="center">Chargement…</p>;
  if (!me) return <Login />;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="users" element={<Users />} />
          <Route path="held" element={<HeldWorkouts />} />
          <Route path="proofs" element={<ProofQueue />} />
          <Route path="moderation" element={<Moderation />} />
          <Route path="gyms" element={<AdminOnly><GymVerification /></AdminOnly>} />
          <Route path="rule-sets" element={<AdminOnly><RuleSets /></AdminOnly>} />
          <Route path="seasons" element={<AdminOnly><Seasons /></AdminOnly>} />
          <Route path="audit" element={<AdminOnly><Audit /></AdminOnly>} />
          <Route path="competitions" element={<AdminOnly><Competitions /></AdminOnly>} />
          <Route path="competitions/:id" element={<AdminOnly><CompetitionDetail /></AdminOnly>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
