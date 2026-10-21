import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { adminAuth, appBearer, registerUser, setupTestApp } from './helpers';

/** Floor judging (spec 2026-10-21): app users invited as judges of an on-site event, one lane per heat, scores FINAL at once. */
describe('Floor judging (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
  let seq = 0;

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  type U = { id: string; token: string };
  async function user(): Promise<U> {
    const u = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: u.session.userId }, data: { emailVerifiedAt: new Date() } });
    const login = await api().post('/api/v1/auth/login').send({ email: u.body.email, password: u.body.password }).expect(200);
    return { id: u.session.userId, token: login.body.accessToken as string };
  }

  /** An on-site event with one category, a For Time WOD (cap 10 min), an AMRAP WOD, athletes registered and one heat per WOD. */
  async function event(athletes: U[], format = 'ONSITE') {
    const organizer = await user();
    const c = await api()
      .post('/api/v1/competitions')
      .set(bearer(organizer.token))
      .send({ title: 'Sfax Throwdown', slug: `sfax-${Date.now()}-${++seq}`, description: 'On site.', format, city: 'Sfax', registrationStart: h(-1), registrationEnd: h(48), eventStart: h(72), eventEnd: h(96), registrationPrice: 0, currency: 'TND' })
      .expect(201);
    const base = `/api/v1/competitions/${c.body.id}`;
    const categoryId = (await api().post(`${base}/categories`).set(bearer(organizer.token)).send({ name: 'RX', gender: 'MIXED' }).expect(201)).body.id as string;
    const wod = { description: 'x', scoringMethod: 'PLACEMENT_POINTS', maximumPoints: 100, placementTable: [100, 90, 80], submissionStart: h(-1), submissionDeadline: h(200) };
    const forTime = (await api().post(`${base}/wods`).set(bearer(organizer.token)).send({ ...wod, number: 1, name: 'Fran', scoreType: 'TIME', timeCapS: 600 }).expect(201)).body.id as string;
    const amrap = (await api().post(`${base}/wods`).set(bearer(organizer.token)).send({ ...wod, number: 2, name: 'Cindy', scoreType: 'REPS' }).expect(201)).body.id as string;
    const asAdmin = await adminAuth(app, prisma);
    await api().patch(`${base.replace('/competitions/', '/admin/competitions/')}/status`).set(asAdmin).send({ status: 'REGISTRATION_OPEN' }).expect(200);
    const regs: string[] = [];
    for (const a of athletes) regs.push((await api().post(`${base}/register`).set(bearer(a.token)).send({ categoryId }).expect(201)).body.id);
    const heat = async (workoutId: string) => {
      const id = (await api().post(`${base}/heats`).set(bearer(organizer.token)).send({ workoutId, categoryId, laneCount: 4 }).expect(201)).body.id as string;
      for (const [i, r] of regs.entries()) await api().post(`${base}/heats/${id}/lanes`).set(bearer(organizer.token)).send({ registrationId: r, lane: i + 1 }).expect(201);
      return id;
    };
    return { id: c.body.id as string, base, organizer, categoryId, forTime, amrap, heatFran: await heat(forTime), heatCindy: await heat(amrap) };
  }

  const invite = (e: { base: string; organizer: U }, judge: U) => api().post(`${e.base}/staff`).set(bearer(e.organizer.token)).send({ userId: judge.id, role: 'FLOOR_JUDGE' });

  it('the organizer invites an app user, who is notified, sees the invitation and accepts it', async () => {
    const e = await event([await user()]);
    const judge = await user();
    await invite(e, judge).expect(201);
    await invite(e, judge).expect(201); // twice = the same invitation
    expect(await prisma.notification.count({ where: { userId: judge.id, type: 'COMPETITION_JUDGE_INVITED' } })).toBe(1);

    const mine = await api().get('/api/v1/competitions/floor-judging').set(bearer(judge.token)).expect(200);
    expect(mine.body).toEqual([expect.objectContaining({ accepted: false, competition: expect.objectContaining({ id: e.id }) })]);
    expect((await api().get(e.base).set(bearer(judge.token)).expect(200)).body.myFloorJudge).toMatchObject({ acceptedAt: null });
    // Not before accepting.
    await api().get(`${e.base}/floor-judging/lanes`).set(bearer(judge.token)).expect(403);

    await api().post(`${e.base}/floor-judging/accept`).set(bearer(judge.token)).expect(200);
    expect((await api().get(e.base).set(bearer(judge.token)).expect(200)).body.myFloorJudge.acceptedAt).not.toBeNull();
    expect((await api().get(`${e.base}/floor-judging/lanes`).set(bearer(judge.token)).expect(200)).body.lanes).toEqual([]);
  });

  it('only organizers invite, only app users of on-site events, and judge accounts never', async () => {
    const e = await event([]);
    const stranger = await user();
    await api().post(`${e.base}/staff`).set(bearer(stranger.token)).send({ userId: stranger.id, role: 'FLOOR_JUDGE' }).expect(403);

    const judgeAccount = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: judgeAccount.session.userId }, data: { role: 'JUDGE' } });
    const refused = await invite(e, { id: judgeAccount.session.userId, token: '' }).expect(422);
    expect(refused.body.errors[0]).toMatchObject({ field: 'userId', code: 'NOT_AN_APP_USER' });

    const online = await event([], 'ONLINE');
    const res = await invite(online, await user()).expect(422);
    expect(res.body.errors[0]).toMatchObject({ field: 'role', code: 'ONSITE_ONLY' });
  });

  it('one judge per lane, one lane per heat for a judge, never their own lane; the heat list shows who judges', async () => {
    const [a1, a2] = [await user(), await user()];
    const e = await event([a1, a2]);
    const judge = await user();
    const staffId = (await invite(e, judge).expect(201)).body.id as string;
    await api().post(`${e.base}/floor-judging/accept`).set(bearer(judge.token)).expect(200);

    await api().put(`${e.base}/heats/${e.heatFran}/lanes/1/judge`).set(bearer(judge.token)).send({ staffId }).expect(403); // organizers only
    await api().put(`${e.base}/heats/${e.heatFran}/lanes/1/judge`).set(bearer(e.organizer.token)).send({ staffId }).expect(200);
    const busy = await api().put(`${e.base}/heats/${e.heatFran}/lanes/2/judge`).set(bearer(e.organizer.token)).send({ staffId }).expect(409);
    expect(busy.body.reason ?? busy.body.extra?.reason).toBe('JUDGE_BUSY');
    await api().put(`${e.base}/heats/${e.heatFran}/lanes/3/judge`).set(bearer(e.organizer.token)).send({ staffId }).expect(404); // empty lane

    // An athlete may judge others, never themselves.
    const a1Staff = (await invite(e, a1).expect(201)).body.id as string;
    const own = await api().put(`${e.base}/heats/${e.heatFran}/lanes/1/judge`).set(bearer(e.organizer.token)).send({ staffId: a1Staff }).expect(409);
    expect(own.body.reason ?? own.body.extra?.reason).toBe('OWN_LANE');

    const heats = (await api().get(`${e.base}/heats`).set(bearer(judge.token)).expect(200)).body;
    const lane1 = heats.find((x: { id: string }) => x.id === e.heatFran).lanes[0];
    expect(lane1).toMatchObject({ lane: 1, judgedByMe: true, judge: { staffId, id: judge.id } });

    const lanes = (await api().get(`${e.base}/floor-judging/lanes`).set(bearer(judge.token)).expect(200)).body.lanes;
    expect(lanes).toEqual([expect.objectContaining({ lane: 1, athlete: expect.objectContaining({ id: a1.id }), workout: expect.objectContaining({ name: 'Fran', scoreType: 'TIME', timeCapS: 600 }), score: null })]);

    // Declining later frees the lane.
    await api().post(`${e.base}/floor-judging/decline`).set(bearer(judge.token)).expect(204);
    expect((await prisma.competitionHeatLane.findFirstOrThrow({ where: { heatId: e.heatFran, lane: 1 } })).judgeStaffId).toBeNull();
  });

  it('the automatic split gives each occupied lane an accepted judge free in that heat', async () => {
    const athletes = [await user(), await user(), await user()];
    const e = await event(athletes);
    const [j1, j2] = [await user(), await user()];
    for (const j of [j1, j2]) {
      await invite(e, j).expect(201);
      await api().post(`${e.base}/floor-judging/accept`).set(bearer(j.token)).expect(200);
    }
    await invite(e, await user()).expect(201); // pending: never picked
    const r = await api().post(`${e.base}/heats/${e.heatFran}/judges/auto`).set(bearer(e.organizer.token)).expect(200);
    expect(r.body).toEqual({ assigned: 2, withoutJudge: 1 });
    const lanes = await prisma.competitionHeatLane.findMany({ where: { heatId: e.heatFran }, orderBy: { lane: 'asc' }, include: { judge: true } });
    expect(lanes.map((l) => l.judge?.userId ?? null)).toEqual([j1.id, j2.id, null]);
  });

  it('a judge of the heat starts the common clock once; the organizer can clear a false start', async () => {
    const e = await event([await user()]);
    const judge = await user();
    const staffId = (await invite(e, judge).expect(201)).body.id;
    await api().post(`${e.base}/floor-judging/accept`).set(bearer(judge.token)).expect(200);
    await api().post(`${e.base}/heats/${e.heatFran}/start`).set(bearer(judge.token)).expect(403); // not on this heat yet
    await api().put(`${e.base}/heats/${e.heatFran}/lanes/1/judge`).set(bearer(e.organizer.token)).send({ staffId }).expect(200);

    const first = await api().post(`${e.base}/heats/${e.heatFran}/start`).set(bearer(judge.token)).expect(200);
    const again = await api().post(`${e.base}/heats/${e.heatFran}/start`).set(bearer(e.organizer.token)).expect(200);
    expect(again.body.startedAt).toBe(first.body.startedAt);
    await api().delete(`${e.base}/heats/${e.heatFran}/start`).set(bearer(judge.token)).expect(403);
    await api().delete(`${e.base}/heats/${e.heatFran}/start`).set(bearer(e.organizer.token)).expect(204);
    expect((await prisma.competitionHeat.findUniqueOrThrow({ where: { id: e.heatFran } })).startedAt).toBeNull();
  });

  it('the lane judge scores: FINAL at once, live leaderboard, athlete notified, capped athletes after finishers, retries answered', async () => {
    const [fast, capped] = [await user(), await user()];
    const e = await event([fast, capped]);
    const [j1, j2] = [await user(), await user()];
    for (const [i, j] of [j1, j2].entries()) {
      const staffId = (await invite(e, j).expect(201)).body.id;
      await api().post(`${e.base}/floor-judging/accept`).set(bearer(j.token)).expect(200);
      await api().put(`${e.base}/heats/${e.heatFran}/lanes/${i + 1}/judge`).set(bearer(e.organizer.token)).send({ staffId }).expect(200);
    }
    const score = (j: U, lane: number, raw: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      api().put(`${e.base}/heats/${e.heatFran}/lanes/${lane}/score`).set(bearer(j.token)).send({ clientId: randomUUID(), raw, athleteConfirmed: true, ...extra });

    // Not confirmed by the athlete, another lane's judge, over the cap: refused.
    await score(j1, 1, { timeS: 245 }, { athleteConfirmed: false }).expect(422);
    await score(j2, 1, { timeS: 245 }).expect(403);
    const over = await score(j1, 1, { timeS: 700 }).expect(422);
    expect(over.body.errors[0]).toMatchObject({ field: 'raw.timeS', code: 'OVER_TIME_CAP' });

    const clientId = randomUUID();
    const body = { clientId, raw: { timeS: 245, tieBreakS: 130, noReps: 2, junk: 'x' }, athleteConfirmed: true };
    const ok = await api().put(`${e.base}/heats/${e.heatFran}/lanes/1/score`).set(bearer(j1.token)).send(body).expect(200);
    expect(ok.body).toMatchObject({ status: 'FINAL', rawValue: 245, points: 100 });
    expect(ok.body.raw).toMatchObject({ timeS: 245, tieBreakS: 130, noReps: 2, floor: { lane: 1, judgeId: j1.id, athleteConfirmed: true } });
    expect(ok.body.raw.junk).toBeUndefined();
    const replay = await api().put(`${e.base}/heats/${e.heatFran}/lanes/1/score`).set(bearer(j1.token)).send(body).expect(200);
    expect(replay.body.submissionId).toBe(ok.body.submissionId);

    await score(j2, 2, { capped: true, reps: 60 }).expect(200);
    const board = (await api().get(`${e.base}/leaderboard`).query({ categoryId: e.categoryId }).set(bearer(fast.token)).expect(200)).body;
    expect(board.rows.map((r: { athlete: { id: string }; totalPoints: number }) => [r.athlete.id, r.totalPoints])).toEqual([
      [fast.id, 100],
      [capped.id, 90],
    ]);
    expect(await prisma.notification.count({ where: { userId: fast.id, type: 'COMPETITION_SCORE_APPROVED' } })).toBe(1);

    // Correction by the organizer: a new version, the history kept.
    await api().put(`${e.base}/heats/${e.heatFran}/lanes/1/score`).set(bearer(e.organizer.token)).send({ clientId: randomUUID(), raw: { timeS: 250 }, athleteConfirmed: true }).expect(200);
    const versions = await prisma.competitionScoreVersion.findMany({ where: { submissionId: ok.body.submissionId }, orderBy: { version: 'asc' } });
    expect(versions.map((v) => [v.version, Number(v.rawValue), v.reason.startsWith('Floor judge correction')])).toEqual([
      [1, 245, false],
      [2, 250, true],
    ]);

    const lanes = (await api().get(`${e.base}/floor-judging/lanes`).set(bearer(j1.token)).expect(200)).body.lanes;
    expect(lanes[0].score).toMatchObject({ status: 'FINAL', rawValue: 250 });
  });

  it('AMRAP: the rep count is the score; the app token of the athlete cannot score their own lane', async () => {
    const a = await user();
    const e = await event([a]);
    const staffId = (await invite(e, a).expect(201)).body.id;
    await api().post(`${e.base}/floor-judging/accept`).set(bearer(a.token)).expect(200);
    // Forced in the database: the API refuses it (OWN_LANE), the score route must refuse it too.
    await prisma.competitionHeatLane.updateMany({ where: { heatId: e.heatCindy, lane: 1 }, data: { judgeStaffId: staffId } });
    const asAthlete = await appBearer(app, prisma, a.id);
    await api().put(`${e.base}/heats/${e.heatCindy}/lanes/1/score`).set(asAthlete).send({ clientId: randomUUID(), raw: { reps: 400 }, athleteConfirmed: true }).expect(403);
    const ok = await api().put(`${e.base}/heats/${e.heatCindy}/lanes/1/score`).set(bearer(e.organizer.token)).send({ clientId: randomUUID(), raw: { reps: 412 }, athleteConfirmed: true }).expect(200);
    expect(ok.body).toMatchObject({ status: 'FINAL', rawValue: 412 });
  });
});
