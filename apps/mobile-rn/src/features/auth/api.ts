import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { ApiClient, Session } from '../../core/api/client';
import { setAuthStatus } from '../../core/auth/session';
import { useServices } from '../../core/services';
import { isoDate } from '../../core/utils/format';

/** Registration payload (spec §6 step 1). */
export interface RegistrationData {
  username: string;
  fullName: string;
  email: string;
  password: string;
  dateOfBirth: Date;
  governorateId: string;
  cityId: string;
  healthDataConsent: boolean;
  locale: string;
}

export const registrationJson = (d: RegistrationData) => ({
  username: d.username,
  fullName: d.fullName,
  email: d.email,
  password: d.password,
  dateOfBirth: isoDate(d.dateOfBirth),
  countryCode: 'TN',
  governorateId: d.governorateId,
  cityId: d.cityId,
  locale: d.locale,
  // Terms and privacy are ticked explicitly in the form; the version is the one displayed.
  consents: { terms: true, privacy: true, healthData: d.healthDataConsent, documentVersion: '2026-09' },
});

export const authApi = (api: ApiClient) => ({
  async login(email: string, password: string) {
    const s = await api.post<Session>('/auth/login', { email, password });
    await api.setSession(s);
  },
  async register(data: RegistrationData) {
    const s = await api.post<Session>('/auth/register', registrationJson(data));
    await api.setSession(s);
  },
  async logout() {
    const refresh = await api.tokens.readRefreshToken();
    try {
      if (refresh != null) await api.post('/auth/logout', { refreshToken: refresh });
    } finally {
      await api.clearSession();
    }
  },
  forgotPassword: (email: string) => api.post<void>('/auth/password/forgot', { email }),
  resendVerification: () => api.post<void>('/auth/email/resend'),
});

/** Session transitions. Every change drops cached queries: never show the previous user's data. */
export function useAuth() {
  const { api, sync } = useServices();
  const qc = useQueryClient();
  return useMemo(() => {
    const repo = authApi(api);
    return {
      async restore() {
        const ok = await api.restore();
        qc.clear();
        setAuthStatus(ok ? 'signedIn' : 'signedOut');
        if (ok) await sync.flush().catch(() => 0);
      },
      async login(email: string, password: string) {
        await repo.login(email, password);
        qc.clear();
        setAuthStatus('signedIn');
      },
      async register(data: RegistrationData) {
        await repo.register(data);
        qc.clear();
        setAuthStatus('signedIn');
      },
      async logout() {
        await repo.logout().catch(() => {});
        setAuthStatus('signedOut');
        qc.clear();
      },
      forgotPassword: repo.forgotPassword,
    };
  }, [api, sync, qc]);
}
