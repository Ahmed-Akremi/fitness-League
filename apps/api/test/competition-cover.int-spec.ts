import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { adminBearer, registerUser, setupTestApp } from './helpers';

describe('Competition banner upload (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
  const image = (color: string) => sharp({ create: { width: 1600, height: 900, channels: 3, background: color } }).jpeg().toBuffer();

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp({ STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'fl-media-')) }));
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  async function user(role?: 'GYM_ADMIN') {
    const u = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: u.session.userId }, data: { emailVerifiedAt: new Date(), ...(role ? { role } : {}) } });
    const login = await api().post('/api/v1/auth/login').send({ email: u.body.email, password: u.body.password }).expect(200);
    return { id: u.session.userId, token: login.body.accessToken as string };
  }

  it('lets the organizer upload, replace and remove the banner, served as a 1440×596 WebP', async () => {
    const organizer = await user('GYM_ADMIN');
    const athlete = await user();
    const c = await api()
      .post('/api/v1/competitions')
      .set(bearer(organizer.token))
      .send({ title: 'Banner Cup', slug: `banner-cup-${Date.now()}`, description: 'x', format: 'ONLINE', registrationStart: h(-1), registrationEnd: h(48), eventStart: h(72), eventEnd: h(96), registrationPrice: 0, currency: 'TND' })
      .expect(201);
    const base = `/api/v1/competitions/${c.body.id}`;
    await api().post(`${base}/categories`).set(bearer(organizer.token)).send({ name: 'Open', gender: 'MIXED' }).expect(201);
    await api().patch(`${base}/status`).set(bearer(organizer.token)).send({ status: 'REGISTRATION_OPEN' }).expect(200);

    // Only the organizer (or an admin) changes it, and only images are accepted.
    await api().put(`${base}/cover`).set(bearer(athlete.token)).attach('file', await image('#c6f432'), 'cover.jpg').expect(403);
    await api().put(`${base}/cover`).set(bearer(organizer.token)).attach('file', Buffer.from('not an image'), 'cover.txt').expect(415);
    expect((await api().get(base).set(bearer(athlete.token)).expect(200)).body.coverUrl).toBeNull();

    const up = await api().put(`${base}/cover`).set(bearer(organizer.token)).attach('file', await image('#c6f432'), 'cover.jpg').expect(200);
    expect(up.body.coverUrl).toMatch(/\/media\/competitions\/.+\.webp$/);
    const path = new URL(up.body.coverUrl).pathname;
    const img = await api().get(path).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (b: Buffer) => chunks.push(b));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const meta = await sharp(img.body as Buffer).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 1440, 596]);

    // Athletes see it on the page and in the list.
    expect((await api().get(base).set(bearer(athlete.token)).expect(200)).body.coverUrl).toBe(up.body.coverUrl);
    const list = await api().get('/api/v1/competitions?filter=ALL').set(bearer(athlete.token)).expect(200);
    expect(list.body.find((x: { id: string }) => x.id === c.body.id).coverUrl).toBe(up.body.coverUrl);

    // A new banner for the final replaces the old one, whose file is removed.
    const again = await api().put(`${base}/cover`).set(bearer(organizer.token)).attach('file', await image('#3da9fc'), 'final.jpg').expect(200);
    expect(again.body.coverUrl).not.toBe(up.body.coverUrl);
    await api().get(path).expect(404);
    expect(await prisma.auditLog.count({ where: { entityId: c.body.id, action: 'competition.cover_updated' } })).toBe(2);

    // Admins manage it from the panel.
    const admin = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: admin.session.userId }, data: { role: 'ADMIN' } });
    await api().delete(`/api/v1/admin/competitions/${c.body.id}/cover`).set(await adminBearer(app, prisma, admin.session.userId)).expect(204);
    expect((await api().get(base).set(bearer(athlete.token)).expect(200)).body.coverUrl).toBeNull();
    await api().get(new URL(again.body.coverUrl).pathname).expect(404);
  });
});
