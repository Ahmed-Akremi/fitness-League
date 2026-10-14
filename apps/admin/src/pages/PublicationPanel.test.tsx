import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminApi } from '../api';
import { AuthProvider } from '../auth';
import { PublicationPanel } from './PublicationPanel';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const waiting = { id: 'c1', status: 'DRAFT', publicationRequestedAt: '2026-10-14T10:00:00.000Z', publicationNote: null };

function setup(competition: Record<string, unknown>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url).replace('/api/v1', '');
    calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return json(200, {});
  });
  const onDone = vi.fn();
  const onMessage = vi.fn();
  const api = new AdminApi('/api/v1', fetchFn as typeof fetch, memoryStorage());
  render(
    <AuthProvider api={api}>
      <PublicationPanel competition={competition} onDone={onDone} onMessage={onMessage} />
    </AuthProvider>,
  );
  return { calls, onDone, onMessage };
}

describe('publication panel', () => {
  it('sends the draft back only with a real note', async () => {
    const { calls, onDone } = setup(waiting);
    const user = userEvent.setup();
    expect(screen.getByText(/Publication demandée/)).toBeInTheDocument();
    const back = screen.getByRole('button', { name: 'Renvoyer au brouillon' });
    expect(back).toBeDisabled();
    await user.type(screen.getByLabelText("Note pour l'organisateur"), '     ');
    expect(back).toBeDisabled();
    await user.clear(screen.getByLabelText("Note pour l'organisateur"));
    await user.type(screen.getByLabelText("Note pour l'organisateur"), '  Bannière floue ');
    await user.click(back);
    expect(calls).toContainEqual({ method: 'POST', path: '/admin/competitions/c1/publication-request/return', body: { note: 'Bannière floue' } });
    expect(onDone).toHaveBeenCalled();
  });

  it('publishes the draft', async () => {
    const { calls, onMessage } = setup(waiting);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Publier' }));
    expect(calls).toContainEqual({ method: 'PATCH', path: '/admin/competitions/c1/status', body: { status: 'REGISTRATION_OPEN' } });
    // The panel unmounts once published: the message goes to the parent.
    expect(onMessage).toHaveBeenCalledWith('Compétition publiée : les inscriptions sont ouvertes.');
  });

  it('disables both actions while a request runs', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchFn = vi.fn(async () => {
      await gate;
      return json(200, {});
    });
    const api = new AdminApi('/api/v1', fetchFn as unknown as typeof fetch, memoryStorage());
    render(
      <AuthProvider api={api}>
        <PublicationPanel competition={waiting} onDone={vi.fn()} onMessage={vi.fn()} />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Note pour l'organisateur"), 'Bannière floue');
    await user.click(screen.getByRole('button', { name: 'Publier' }));
    expect(screen.getByRole('button', { name: 'Publier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Renvoyer au brouillon' })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publier' })).toBeEnabled());
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('shows nothing once the competition is published', () => {
    const { container } = render(
      <AuthProvider api={new AdminApi('/api/v1', vi.fn() as unknown as typeof fetch, memoryStorage())}>
        <PublicationPanel competition={{ ...waiting, status: 'REGISTRATION_OPEN' }} onDone={vi.fn()} onMessage={vi.fn()} />
      </AuthProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
