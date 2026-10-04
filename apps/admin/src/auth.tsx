import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AdminApi, api as defaultApi, Session } from './api';

export interface Me {
  id: string;
  email: string;
  username: string;
  role: 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN' | 'JUDGE' | 'HEAD_JUDGE';
}

interface AuthState {
  api: AdminApi;
  me: Me | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children, api = defaultApi }: { children: ReactNode; api?: AdminApi }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const loadMe = useCallback(async () => setMe(await api.get<Me>('/admin/me')), [api]);

  useEffect(() => {
    api.onSessionLost = () => setMe(null);
    api
      .restore()
      .then((ok) => (ok ? loadMe() : undefined))
      .catch(() => setMe(null))
      .finally(() => setReady(true));
  }, [api, loadMe]);

  const value = useMemo<AuthState>(
    () => ({
      api,
      me,
      ready,
      async login(email, password) {
        const res = await api.post<{ session: Session }>('/admin/auth/login', { email, password });
        api.setSession(res.session);
        await loadMe();
      },
      async logout() {
        await api.logout();
        setMe(null);
      },
    }),
    [api, me, ready, loadMe],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export const canAdmin = (me: Me | null) => me?.role === 'ADMIN' || me?.role === 'SUPER_ADMIN';
/** Judge accounts only see the judge space. */
export const isJudge = (me: Me | null) => me?.role === 'JUDGE' || me?.role === 'HEAD_JUDGE';
