import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminApi } from '../api';
import { App } from '../App';
import { AuthProvider } from '../auth';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('staff sign-in', () => {
  it('enrols the authenticator on first sign-in, then opens the dashboard', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url).replace('/api/v1', '');
      calls.push(`${init?.method} ${path}`);
      if (path === '/admin/auth/login') return json(200, { totpSetup: { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/x', setupToken: 'setup' } });
      if (path === '/admin/auth/totp/confirm') {
        expect(JSON.parse(String(init?.body))).toEqual({ setupToken: 'setup', code: '123456' });
        return json(200, { session: { accessToken: 'a', refreshToken: 'r', userId: 'u' } });
      }
      if (path === '/admin/me') return json(200, { id: 'u', email: 'a@b.c', username: 'boss', role: 'ADMIN' });
      if (path === '/admin/stats/overview') return json(200, { users: 12, active7d: 3, workouts7d: 20, heldWorkouts: 1, pendingGyms: 0, activeSeason: null, activeRuleSetVersion: 1 });
      return json(404, { code: 'NOT_FOUND' });
    });
    const api = new AdminApi('/api/v1', fetchFn as typeof fetch, memoryStorage());
    const user = userEvent.setup();
    render(
      <AuthProvider api={api}>
        <App />
      </AuthProvider>,
    );

    await user.type(await screen.findByLabelText('Email'), 'a@b.c');
    await user.type(screen.getByLabelText('Mot de passe'), 'long password!');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByTestId('totp-secret')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '123456');
    await user.click(screen.getByRole('button', { name: 'Activer et se connecter' }));

    expect(await screen.findByText('Tableau de bord', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByText('Règles de scoring')).toBeInTheDocument(); // admin-only nav entry
    expect(calls).toContain('POST /admin/auth/totp/confirm');
  });

  it('shows a clear error for a wrong code', async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => (String(url).endsWith('/admin/auth/login') ? json(401, { code: 'INVALID_CREDENTIALS' }) : json(401, { code: 'UNAUTHENTICATED' })));
    render(
      <AuthProvider api={new AdminApi('/api/v1', fetchFn as typeof fetch, memoryStorage())}>
        <App />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'a@b.c');
    await user.type(screen.getByLabelText('Mot de passe'), 'x');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email, mot de passe ou code incorrect.');
  });
});
