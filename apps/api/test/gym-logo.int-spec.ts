import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { registerUser, setupTestApp } from './helpers';

describe('Gym logo upload (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const png = readFileSync(join(__dirname, 'fixtures/logo.png'));

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp({ STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'fl-media-')) }));
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  async function ownedGym(slug: string) {
    const owner = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: owner.session.userId }, data: { role: 'GYM_ADMIN' } });
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug } });
    await prisma.gym.update({ where: { id: gym.id }, data: { ownerUserId: owner.session.userId } });
    return { owner, gym };
  }

  it('lets the gym admin upload, replace and delete a logo, served resized as WebP', async () => {
    const { owner, gym } = await ownedGym('carthage-strength-lab');
    const up = await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).attach('file', png, 'logo.png').expect(200);
    expect(up.body.logoUrl).toMatch(/\/media\/gyms\/.+\.webp$/);

    const path = new URL(up.body.logoUrl).pathname;
    const img = await api().get(path).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['cache-control']).toContain('immutable');
    const meta = await sharp(img.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);

    const list = await api().get('/api/v1/gyms?limit=50').set(bearer(owner.session.accessToken)).expect(200);
    expect(list.body.data.find((g: { id: string }) => g.id === gym.id).logoUrl).toBe(up.body.logoUrl);

    const other = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#3da9fc' } }).png().toBuffer();
    const again = await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).attach('file', other, 'logo2.png').expect(200);
    expect(again.body.logoUrl).not.toBe(up.body.logoUrl);
    await api().get(path).expect(404); // previous file removed
    expect(await prisma.media.count({ where: { purpose: 'GYM_LOGO', status: 'DELETED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: gym.id, action: 'GYM_LOGO_UPDATED' } })).toBe(2);

    await api().delete(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).expect(204);
    expect((await api().get(`/api/v1/gyms/${gym.id}`).set(bearer(owner.session.accessToken)).expect(200)).body.logoUrl).toBeNull();

    // Putting back a logo that was deleted before (same content → same key) works and serves the file again.
    const back = await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).attach('file', other, 'logo2.png').expect(200);
    expect(back.body.logoUrl).toBe(again.body.logoUrl);
    await api().get(new URL(back.body.logoUrl).pathname).expect(200);
  });

  it('answers 4xx (never 500) for malformed or escaping media paths', async () => {
    await api().get('/api/v1/media/%E0%A4%A').expect(400); // malformed escape, refused by the router
    await api().get('/api/v1/media/gyms/..%2F..%2F.env').expect(404);
  });

  it('refuses strangers, oversized files and fake images', async () => {
    const { owner, gym } = await ownedGym('ariana-fit-house');
    const stranger = await registerUser(app, prisma);
    await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(stranger.session.accessToken)).attach('file', png, 'logo.png').expect(403);
    await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).attach('file', Buffer.alloc(2 * 1024 * 1024 + 1, 1), 'big.png').expect(413);
    await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).attach('file', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'x.png', contentType: 'image/png' }).expect(415);
    await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).expect(422); // no file
    expect(await prisma.media.count({ where: { ownerId: owner.session.userId } })).toBe(0);
  });
});
