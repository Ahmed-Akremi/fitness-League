import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { adminBearer, registerUser, setupTestApp } from './helpers';

describe('Announcements (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const jpeg = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#c6f432' } }).jpeg().toBuffer();
  const fetchBytes = (path: string) =>
    api()
      .get(path)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (b: Buffer) => chunks.push(b));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp({ STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'fl-news-')) }));
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  async function athlete() {
    const u = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: u.session.userId }, data: { emailVerifiedAt: new Date() } });
    const login = await api().post('/api/v1/auth/login').send({ email: u.body.email, password: u.body.password }).expect(200);
    return { id: u.session.userId, token: login.body.accessToken as string };
  }

  async function panelUser(role: Role) {
    const u = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: u.session.userId }, data: { role } });
    return { id: u.session.userId, auth: await adminBearer(app, prisma, u.session.userId) };
  }

  it('lets an admin publish text and one photo; athletes list them newest first and like them once', async () => {
    const admin = await panelUser('ADMIN');
    const a = await athlete();

    const text = await api().post('/api/v1/admin/announcements').set(admin.auth).field('body', '  Registrations for the summer final are open!  ').expect(201);
    expect(text.body).toMatchObject({ body: 'Registrations for the summer final are open!', imageUrl: null, likeCount: 0 });

    const photo = await api().post('/api/v1/admin/announcements').set(admin.auth).attach('file', await jpeg(3000, 1000), 'podium.jpg').expect(201);
    expect(photo.body.body).toBeNull();
    expect(photo.body.imageUrl).toMatch(/\/media\/announcements\/.+\.webp$/);
    expect([photo.body.imageWidth, photo.body.imageHeight]).toEqual([1440, 480]);
    const meta = await sharp((await fetchBytes(new URL(photo.body.imageUrl).pathname).expect(200)).body as Buffer).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 1440, 480]);

    // A small photo is never enlarged.
    const small = await api().post('/api/v1/admin/announcements').set(admin.auth).field('body', 'Small').attach('file', await jpeg(400, 600), 'small.jpg').expect(201);
    expect([small.body.imageWidth, small.body.imageHeight]).toEqual([400, 600]);

    const list = await api().get('/api/v1/announcements').set(bearer(a.token)).expect(200);
    expect(list.body.data.map((x: { id: string }) => x.id).slice(0, 3)).toEqual([small.body.id, photo.body.id, text.body.id]);
    expect(list.body.data[0]).toMatchObject({ likeCount: 0, likedByMe: false });

    // Liking twice counts once; unliking twice is harmless.
    const like = `/api/v1/announcements/${text.body.id}/like`;
    expect((await api().put(like).set(bearer(a.token)).expect(200)).body).toEqual({ likeCount: 1, likedByMe: true });
    expect((await api().put(like).set(bearer(a.token)).expect(200)).body).toEqual({ likeCount: 1, likedByMe: true });
    const mine = (await api().get('/api/v1/announcements').set(bearer(a.token)).expect(200)).body.data.find((x: { id: string }) => x.id === text.body.id);
    expect(mine).toMatchObject({ likeCount: 1, likedByMe: true });
    expect((await api().delete(like).set(bearer(a.token)).expect(200)).body).toEqual({ likeCount: 0, likedByMe: false });
    expect((await api().delete(like).set(bearer(a.token)).expect(200)).body).toEqual({ likeCount: 0, likedByMe: false });

    // The admin list shows like counts; every publication is audited.
    await api().put(like).set(bearer(a.token)).expect(200);
    const adminList = await api().get('/api/v1/admin/announcements').set(admin.auth).expect(200);
    expect(adminList.body.data.find((x: { id: string }) => x.id === text.body.id).likeCount).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'announcement.published', entityId: text.body.id } })).toBe(1);
  });

  it('refuses empty posts, videos and non-images, oversized text, and non-admins', async () => {
    const admin = await panelUser('ADMIN');
    const moderator = await panelUser('MODERATOR');
    const a = await athlete();
    const post = () => api().post('/api/v1/admin/announcements').set(admin.auth);

    expect((await post().field('body', '   ').expect(422)).body.code).toBe('VALIDATION_FAILED');
    await post().send({}).expect(422);
    await post().field('body', 'x'.repeat(2001)).expect(422);
    await post().attach('file', Buffer.from('plain text'), 'notes.txt').expect(415);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
    await post().field('body', 'Watch this').attach('file', mp4, 'clip.mp4').expect(415);

    await api().post('/api/v1/admin/announcements').set(moderator.auth).field('body', 'Hi').expect(403);
    await api().get('/api/v1/admin/announcements').set(bearer(a.token)).expect(401);
    // There is no way to comment.
    const created = await post().field('body', 'No comments here').expect(201);
    await api().post(`/api/v1/announcements/${created.body.id}/comments`).set(bearer(a.token)).send({ body: 'hey' }).expect(404);
  });

  it('removes a deleted announcement from the feed, its likes and its photo file', async () => {
    const admin = await panelUser('SUPER_ADMIN');
    const a = await athlete();
    const created = await api().post('/api/v1/admin/announcements').set(admin.auth).field('body', 'Oops').attach('file', await jpeg(800, 800), 'oops.jpg').expect(201);
    await api().put(`/api/v1/announcements/${created.body.id}/like`).set(bearer(a.token)).expect(200);

    await api().delete(`/api/v1/admin/announcements/${created.body.id}`).set(admin.auth).expect(204);
    const list = await api().get('/api/v1/announcements').set(bearer(a.token)).expect(200);
    expect(list.body.data.some((x: { id: string }) => x.id === created.body.id)).toBe(false);
    await api().put(`/api/v1/announcements/${created.body.id}/like`).set(bearer(a.token)).expect(404);
    await fetchBytes(new URL(created.body.imageUrl).pathname).expect(404);
    await api().delete(`/api/v1/admin/announcements/${created.body.id}`).set(admin.auth).expect(404);
    expect(await prisma.auditLog.count({ where: { action: 'announcement.deleted', entityId: created.body.id } })).toBe(1);
  });
});
