import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credits } from './credits';
import { media } from './media';

// Built with node:path: under jsdom the global URL is jsdom's, which fileURLToPath refuses.
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const publicFile = (path: string) => resolve(publicDir, `.${path}`);
const paths = (value: object): string[] => Object.values(value).flatMap((v) => (typeof v === 'string' ? [v] : paths(v)));

it.each(paths(media))('%s is in public/', (path) => {
  expect(existsSync(publicFile(path))).toBe(true);
});

it('every photo has a credit and every credit has a photo', () => {
  const photos = [media.hero, media.athletes, media.gyms, media.organizers].map((p) => p.replace('/media/', ''));
  expect(credits.map((c) => c.file).sort()).toEqual([...photos].sort());
  for (const c of credits) expect(c.source).toMatch(/^https:\/\/unsplash\.com\/photos\//);
});
