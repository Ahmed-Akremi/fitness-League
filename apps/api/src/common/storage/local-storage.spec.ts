import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage } from './local-storage';

describe('LocalStorage', () => {
  const root = mkdtempSync(join(tmpdir(), 'fl-storage-'));
  const s = new LocalStorage(root, 'http://localhost:3000/api/v1/media');

  it('stores, reads, builds a public URL and deletes', async () => {
    await s.put('gyms/abc/logo-1.webp', Buffer.from('img'), 'image/webp');
    expect(s.url('gyms/abc/logo-1.webp')).toBe('http://localhost:3000/api/v1/media/gyms/abc/logo-1.webp');
    expect(await s.read('gyms/abc/logo-1.webp')).toEqual({ bytes: Buffer.from('img'), mime: 'image/webp' });
    await s.delete('gyms/abc/logo-1.webp');
    expect(await s.read('gyms/abc/logo-1.webp')).toBeNull();
  });

  it('refuses keys that escape the root', async () => {
    await expect(s.put('../evil.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow('Invalid storage key');
    expect(await s.read('../../etc/passwd')).toBeNull();
  });
});
