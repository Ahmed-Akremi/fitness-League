import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import request from 'supertest';
import { adminAuth, appBearer, registerUser, setupTestApp } from './helpers';

/** Organizer space (spec 2026-10-14): any app user drafts an event, only an admin publishes it. */
describe('Organizer space (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
  let n = 0;
  const draft = (over: Record<string, unknown> = {}) => ({
    title: 'Sousse Summer Throwdown',
    slug: `sousse-summer-${Date.now()}-${++n}`,
    description: 'Two days on site.',
    format: 'ONSITE',
    city: 'Sousse',
    location: 'Bodynade, Sousse',
    registrationStart: h(-1),
    registrationEnd: h(48),
    eventStart: h(72),
    eventEnd: h(96),
    registrationPrice: 30_000,
    ...over,
  });

  async function athlete(): Promise<{ id: string; token: string }> {
    const u = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: u.session.userId }, data: { emailVerifiedAt: new Date() } });
    const login = await api().post('/api/v1/auth/login').send({ email: u.body.email, password: u.body.password }).expect(200);
    return { id: u.session.userId, token: login.body.accessToken };
  }

  let user: { id: string; token: string };
  let admin: { authorization: string };
  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    user = await athlete();
    admin = await adminAuth(app, prisma);
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('a normal user drafts an event and becomes its organizer', async () => {
    const c = await api().post('/api/v1/competitions').set(bearer(user.token)).send(draft()).expect(201);
    expect(c.body.status).toBe('DRAFT');
    const staff = await prisma.competitionStaff.findMany({ where: { competitionId: c.body.id } });
    expect(staff).toEqual([expect.objectContaining({ userId: user.id, role: 'ORGANIZER' })]);
  });

  it('a judge account cannot create an event', async () => {
    const u = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: u.session.userId }, data: { role: 'JUDGE', emailVerifiedAt: new Date() } });
    const res = await api().post('/api/v1/competitions').set(await appBearer(app, prisma, u.session.userId)).send(draft()).expect(403);
    expect(res.body.detail).toBe('Judge accounts cannot create competitions');
  });

  it('the organizer cannot take the event out of draft; an admin can, then the organizer runs the next steps', async () => {
    const c = (await api().post('/api/v1/competitions').set(bearer(user.token)).send(draft()).expect(201)).body;
    await api().post(`/api/v1/competitions/${c.id}/categories`).set(bearer(user.token)).send({ name: 'RX Mixed', gender: 'MIXED' }).expect(201);
    const denied = await api().patch(`/api/v1/competitions/${c.id}/status`).set(bearer(user.token)).send({ status: 'REGISTRATION_OPEN' }).expect(403);
    expect(denied.body.detail).toBe('An admin publishes the competition');
    await api().patch(`/api/v1/admin/competitions/${c.id}/status`).set(admin).send({ status: 'REGISTRATION_OPEN' }).expect(200);
    await api().patch(`/api/v1/competitions/${c.id}/status`).set(bearer(user.token)).send({ status: 'REGISTRATION_CLOSED' }).expect(200);
  });

  const banner = () => sharp({ create: { width: 1600, height: 700, channels: 3, background: '#c6f432' } }).jpeg().toBuffer();

  /** A draft with its banner, one active category and one WOD. */
  async function readyDraft(owner = user): Promise<string> {
    const id = (await api().post('/api/v1/competitions').set(bearer(owner.token)).send(draft()).expect(201)).body.id;
    const base = `/api/v1/competitions/${id}`;
    await api().put(`${base}/cover`).set(bearer(owner.token)).attach('file', await banner(), 'cover.jpg').expect(200);
    await api().post(`${base}/categories`).set(bearer(owner.token)).send({ name: 'RX Mixed', gender: 'MIXED' }).expect(201);
    await api()
      .post(`${base}/wods`)
      .set(bearer(owner.token))
      .send({ number: 1, name: 'WOD 1', description: 'AMRAP 12', scoreType: 'REPS', scoringMethod: 'DIRECT_POINTS', maximumPoints: 100, submissionStart: h(72), submissionDeadline: h(90) })
      .expect(201);
    return id;
  }

  it('a publication request lists what the draft still misses', async () => {
    const id = (await api().post('/api/v1/competitions').set(bearer(user.token)).send(draft()).expect(201)).body.id;
    const res = await api().post(`/api/v1/competitions/${id}/publication-request`).set(bearer(user.token)).expect(409);
    expect(res.body.code).toBe('PRECONDITION_FAILED');
    expect(res.body.missing).toEqual(['COVER', 'CATEGORY', 'WOD']);
  });

  it('only an organizer asks for publication', async () => {
    const id = await readyDraft();
    const other = await athlete();
    await api().post(`/api/v1/competitions/${id}/publication-request`).set(bearer(other.token)).expect(403);
  });

  it('request → edits keep it → sent back with a note → asked again → published', async () => {
    const id = await readyDraft();
    const base = `/api/v1/competitions/${id}`;
    const asked = await api().post(`${base}/publication-request`).set(bearer(user.token)).expect(200);
    expect(asked.body.publicationRequestedAt).toEqual(expect.any(String));
    // Asking twice is harmless.
    await api().post(`${base}/publication-request`).set(bearer(user.token)).expect(200);
    // Editing the draft keeps the request: the admin publishes the current version.
    // The app always sends the dates with an edit (a PUT without them is refused by the existing date check).
    const { registrationStart, registrationEnd, eventStart, eventEnd } = draft();
    await api().put(base).set(bearer(user.token)).send({ title: 'Sousse Summer Throwdown 2026', registrationStart, registrationEnd, eventStart, eventEnd }).expect(200);
    expect((await api().get(base).set(bearer(user.token)).expect(200)).body.publicationRequestedAt).toEqual(expect.any(String));

    const adminBase = `/api/v1/admin/competitions/${id}`;
    await api().post(`${adminBase}/publication-request/return`).set(admin).send({}).expect(422);
    await api().post(`${adminBase}/publication-request/return`).set(admin).send({ note: '      ' }).expect(422);
    const back = await api().post(`${adminBase}/publication-request/return`).set(admin).send({ note: 'The banner is blurred.' }).expect(200);
    expect(back.body).toMatchObject({ publicationRequestedAt: null, publicationNote: 'The banner is blurred.' });
    // A second admin acting on the same request: already handled.
    await api().post(`${adminBase}/publication-request/return`).set(admin).send({ note: 'Fix the dates.' }).expect(409);
    // The organizer sees the note in the detail and in "my competitions".
    expect((await api().get(base).set(bearer(user.token)).expect(200)).body.publicationNote).toBe('The banner is blurred.');
    const mine = await api().get('/api/v1/competitions').query({ filter: 'ALL', mine: 'true' }).set(bearer(user.token)).expect(200);
    expect(mine.body.find((c: { id: string }) => c.id === id)).toMatchObject({ status: 'DRAFT', publicationNote: 'The banner is blurred.' });

    const again = await api().post(`${base}/publication-request`).set(bearer(user.token)).expect(200);
    expect(again.body).toMatchObject({ publicationNote: null, publicationRequestedAt: expect.any(String) });
    await api().patch(`${adminBase}/status`).set(admin).send({ status: 'REGISTRATION_OPEN' }).expect(200);
    const published = (await api().get(base).set(bearer(user.token)).expect(200)).body;
    expect(published).toMatchObject({ status: 'REGISTRATION_OPEN', publicationRequestedAt: null, publicationNote: null });
    // Published: no more request.
    await api().post(`${base}/publication-request`).set(bearer(user.token)).expect(409);
  });

  it('the admin list shows the waiting request', async () => {
    const id = await readyDraft();
    await api().post(`/api/v1/competitions/${id}/publication-request`).set(bearer(user.token)).expect(200);
    const list = await api().get('/api/v1/admin/competitions').set(admin).expect(200);
    expect(list.body.find((c: { id: string }) => c.id === id).publicationRequestedAt).toEqual(expect.any(String));
  });
  it("an organizer cannot delete another event's category or WOD through their own draft", async () => {
    const victim = await readyDraft();
    const other = await athlete();
    const mine = (await api().post('/api/v1/competitions').set(bearer(other.token)).send(draft()).expect(201)).body.id;
    const cat = await prisma.competitionCategory.findFirstOrThrow({ where: { competitionId: victim } });
    const wod = await prisma.competitionWorkout.findFirstOrThrow({ where: { competitionId: victim } });
    await api().delete(`/api/v1/competitions/${mine}/categories/${cat.id}`).set(bearer(other.token)).expect(404);
    await api().delete(`/api/v1/competitions/${mine}/wods/${wod.id}`).set(bearer(other.token)).expect(404);
    expect(await prisma.competitionCategory.count({ where: { id: cat.id } })).toBe(1);
    expect(await prisma.competitionWorkout.count({ where: { id: wod.id } })).toBe(1);
    // Their own rows still go.
    await api().delete(`/api/v1/competitions/${victim}/categories/${cat.id}`).set(bearer(user.token)).expect(204);
    await api().delete(`/api/v1/competitions/${victim}/wods/${wod.id}`).set(bearer(user.token)).expect(204);
  });

  it('a head judge cannot publish the leaderboard of a draft', async () => {
    const id = (await api().post('/api/v1/competitions').set(bearer(user.token)).send(draft()).expect(201)).body.id;
    const hj = await athlete();
    await prisma.competitionStaff.create({ data: { id: crypto.randomUUID(), competitionId: id, userId: hj.id, role: 'HEAD_JUDGE' } });
    const res = await api().post(`/api/v1/competitions/${id}/publish-leaderboard`).set(bearer(hj.token)).expect(403);
    expect(res.body.detail).toBe('An admin publishes the competition');
    expect((await prisma.competition.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT');
  });

  it('the return note is measured once trimmed', async () => {
    const id = await readyDraft();
    await api().post(`/api/v1/competitions/${id}/publication-request`).set(bearer(user.token)).expect(200);
    const url = `/api/v1/admin/competitions/${id}/publication-request/return`;
    await api().post(url).set(admin).send({ note: '  ab  ' }).expect(422);
    await api().post(url).set(admin).send({ note: '  abc  ' }).expect(200);
  });
});
