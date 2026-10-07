import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminApi } from '../api';
import { AuthProvider } from '../auth';
import { Announcements } from './Announcements';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

const existing = { id: 'n1', body: 'Final this weekend', imageUrl: null, imageWidth: null, imageHeight: null, createdAt: '2026-10-06T10:00:00.000Z', likeCount: 7, likedByMe: false };

describe('publications page', () => {
  it('keeps Publish off until there is text or a photo, then sends the text as multipart', async () => {
    const sent: FormData[] = [];
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url).replace('/api/v1', '');
      if (path.startsWith('/admin/announcements') && (init?.method ?? 'GET') === 'GET') return json(200, { data: [existing], page: { nextCursor: null, hasMore: false } });
      if (path === '/admin/announcements' && init?.method === 'POST') {
        sent.push(init.body as FormData);
        return json(201, { ...existing, id: 'n2', body: 'Registrations open', likeCount: 0 });
      }
      return json(404, { code: 'NOT_FOUND' });
    });
    const api = new AdminApi('/api/v1', fetchFn as typeof fetch, memoryStorage());
    const user = userEvent.setup();
    render(
      <AuthProvider api={api}>
        <Announcements />
      </AuthProvider>,
    );

    expect(await screen.findByText('Final this weekend')).toBeInTheDocument();
    expect(screen.getByText('❤️ 7')).toBeInTheDocument();
    const publish = screen.getByRole('button', { name: 'Publier' });
    expect(publish).toBeDisabled();

    await user.type(screen.getByLabelText('Texte'), '   ');
    expect(publish).toBeDisabled();
    await user.clear(screen.getByLabelText('Texte'));
    await user.type(screen.getByLabelText('Texte'), 'Registrations open');
    expect(screen.getByText('18 / 2000')).toBeInTheDocument();
    await user.click(publish);

    expect(sent).toHaveLength(1);
    expect(sent[0].get('body')).toBe('Registrations open');
    expect(sent[0].get('file')).toBeNull();
    expect(await screen.findByText('Publication envoyée aux athlètes.')).toBeInTheDocument();
  });
});
