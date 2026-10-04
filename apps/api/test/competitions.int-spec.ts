import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { adminBearer, registerUser, setupTestApp } from './helpers';

/** The §57 scenario end to end: admin → athlete → judge → system → head judge. */
describe('Competitions (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

  type Actor = { id: string; token: string };
  let organizer: Actor, ahmed: Actor, ali: Actor, sara: Actor, judge: Actor, headJudge: Actor;
  let competitionId: string;
  let rxMale: string, rxFemale: string;
  const wods: string[] = [];

  async function actor(opts: { role?: 'GYM_ADMIN'; gender?: 'MALE' | 'FEMALE'; dateOfBirth?: string } = {}): Promise<Actor> {
    const u = await registerUser(app, prisma, opts.dateOfBirth ? { dateOfBirth: opts.dateOfBirth } : {});
    await prisma.user.update({ where: { id: u.session.userId }, data: { emailVerifiedAt: new Date(), ...(opts.role ? { role: opts.role } : {}) } });
    if (opts.gender) await prisma.profile.update({ where: { userId: u.session.userId }, data: { gender: opts.gender } });
    // Fresh token so the new role and verified email are in it.
    const login = await api().post('/api/v1/auth/login').send({ email: u.body.email, password: u.body.password }).expect(200);
    return { id: u.session.userId, token: login.body.accessToken };
  }

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    organizer = await actor({ role: 'GYM_ADMIN' });
    ahmed = await actor({ gender: 'MALE', dateOfBirth: '1998-04-12' });
    ali = await actor({ gender: 'MALE', dateOfBirth: '1995-06-01' });
    sara = await actor({ gender: 'FEMALE', dateOfBirth: '1999-01-20' });
    judge = await actor();
    headJudge = await actor();
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('ADMIN: creates the competition with its price, categories, WODs, prize and coupon, then opens registration', async () => {
    const c = await api()
      .post('/api/v1/competitions')
      .set(bearer(organizer.token))
      .send({
        title: 'Tunisia Functional Fitness Championship',
        slug: `tunisia-ff-${Date.now()}`,
        description: 'Four WODs, online qualifier.',
        format: 'ONLINE',
        city: 'Tunis',
        registrationStart: h(-1),
        registrationEnd: h(48),
        eventStart: h(72),
        eventEnd: h(96),
        registrationPrice: 35_000,
        currency: 'TND',
        tieBreakRules: [{ type: 'LAST_WOD' }],
      })
      .expect(201);
    competitionId = c.body.id;
    const base = `/api/v1/competitions/${competitionId}`;

    // An athlete cannot manage it.
    await api().post(`${base}/categories`).set(bearer(ahmed.token)).send({ name: 'Hack', gender: 'MIXED' }).expect(403);

    rxMale = (await api().post(`${base}/categories`).set(bearer(organizer.token)).send({ name: 'RX Male Division 18-35', gender: 'MALE', minAge: 18, maxAge: 35, registrationPriceOverride: 40_000 }).expect(201)).body.id;
    rxFemale = (await api().post(`${base}/categories`).set(bearer(organizer.token)).send({ name: 'RX Female Division 18-35', gender: 'FEMALE', minAge: 18, maxAge: 35 }).expect(201)).body.id;

    for (const [i, max] of [100, 100, 150, 200].entries()) {
      const w = await api()
        .post(`${base}/wods`)
        .set(bearer(organizer.token))
        .send({ number: i + 1, name: `WOD ${i + 1}`, description: 'For points', scoreType: 'POINTS', scoringMethod: 'DIRECT_POINTS', maximumPoints: max, submissionStart: h(-1), submissionDeadline: h(24) })
        .expect(201);
      wods.push(w.body.id);
    }
    await api().post(`${base}/prizes`).set(bearer(organizer.token)).send({ position: 1, type: 'CASH', amount: 1_000_000 }).expect(201);
    await api().post(`${base}/coupons`).set(bearer(organizer.token)).send({ code: 'FREE2026', type: 'FREE', maxUses: 5 }).expect(201);
    await api().post(`${base}/coupons`).set(bearer(organizer.token)).send({ code: 'OLD10', type: 'PERCENTAGE', value: 10, expiresAt: h(-2) }).expect(201);
    await api().post(`${base}/staff`).set(bearer(organizer.token)).send({ userId: judge.id, role: 'JUDGE' }).expect(201);
    await api().post(`${base}/staff`).set(bearer(organizer.token)).send({ userId: headJudge.id, role: 'HEAD_JUDGE' }).expect(201);

    // Registration cannot open on a draft without being asked; it opens explicitly.
    await api().post(`${base}/register`).set(bearer(ahmed.token)).send({ categoryId: rxMale }).expect(409);
    await api().patch(`${base}/status`).set(bearer(organizer.token)).send({ status: 'REGISTRATION_OPEN' }).expect(200);
    const d = await api().get(base).set(bearer(ahmed.token)).expect(200);
    expect(d.body.categories.find((x: { id: string }) => x.id === rxMale).price).toBe(40_000);
    expect(d.body.categories.find((x: { id: string }) => x.id === rxFemale).price).toBe(35_000);
  });

  it('ATHLETE: category eligibility, coupons and pricing are enforced by the server', async () => {
    const base = `/api/v1/competitions/${competitionId}`;
    const wrong = await api().post(`${base}/register`).set(bearer(sara.token)).send({ categoryId: rxMale }).expect(422);
    expect(wrong.body.errors[0].code).toBe('WRONG_GENDER');
    const expired = await api().post(`${base}/coupon/validate`).set(bearer(ahmed.token)).send({ categoryId: rxMale, code: 'OLD10' }).expect(422);
    expect(expired.body.errors[0].code).toBe('COUPON_EXPIRED');
    const preview = await api().post(`${base}/coupon/validate`).set(bearer(ahmed.token)).send({ categoryId: rxMale, code: 'free2026' }).expect(200);
    expect(preview.body).toMatchObject({ originalPrice: 40_000, discount: 40_000, finalPrice: 0, paymentStatus: 'FREE' });

    const free = await api().post(`${base}/register`).set(bearer(ahmed.token)).send({ categoryId: rxMale, couponCode: 'FREE2026' }).expect(201);
    expect(free.body).toMatchObject({ registrationStatus: 'CONFIRMED', paymentStatus: 'FREE', originalPrice: 40_000, discount: 40_000, finalPrice: 0 });
    await api().post(`${base}/register`).set(bearer(ahmed.token)).send({ categoryId: rxMale }).expect(409);

    const paid = await api().post(`${base}/register`).set(bearer(ali.token)).send({ categoryId: rxMale }).expect(201);
    expect(paid.body).toMatchObject({ registrationStatus: 'PENDING', paymentStatus: 'PENDING', finalPrice: 40_000 });
    await api().post(`${base}/registrations/${paid.body.id}/mark-paid`).set(bearer(ali.token)).expect(403);
    await api().post(`${base}/registrations/${paid.body.id}/mark-paid`).set(bearer(organizer.token)).expect(200);

    const coupon = await prisma.competitionCoupon.findFirstOrThrow({ where: { competitionId, code: 'FREE2026' } });
    expect(coupon.usedCount).toBe(1);
    expect(await prisma.notification.count({ where: { userId: ahmed.id, type: 'COMPETITION_REGISTRATION_CONFIRMED' } })).toBe(1);
  });

  it('ATHLETE submits scores with a YouTube video; JUDGE approves; SYSTEM totals and ranks (§58)', async () => {
    const base = `/api/v1/competitions/${competitionId}`;
    // Not open for submissions yet.
    await api().post(`${base}/wods/${wods[0]}/submissions`).set(bearer(ahmed.token)).send({ clientId: randomUUID(), raw: { value: 95 } }).expect(409);
    await api().patch(`${base}/status`).set(bearer(organizer.token)).send({ status: 'REGISTRATION_CLOSED' }).expect(200);
    await api().patch(`${base}/status`).set(bearer(organizer.token)).send({ status: 'SUBMISSION_OPEN' }).expect(200);

    const bad = await api().post(`${base}/wods/${wods[0]}/submissions`).set(bearer(ahmed.token)).send({ clientId: randomUUID(), raw: { value: 95 }, videoUrl: 'https://vimeo.com/1' }).expect(422);
    expect(bad.body.errors[0].code).toBe('NOT_A_YOUTUBE_URL');
    await api().post(`${base}/wods/${wods[0]}/submissions`).set(bearer(ahmed.token)).send({ clientId: randomUUID(), raw: { value: 120 } }).expect(422);
    // The YouTube link is the proof: required to submit, not to save a draft.
    const noVideo = await api().post(`${base}/wods/${wods[0]}/submissions`).set(bearer(ahmed.token)).send({ clientId: randomUUID(), raw: { value: 95 } }).expect(422);
    expect(noVideo.body.errors[0]).toMatchObject({ field: 'videoUrl', code: 'REQUIRED' });
    const draft = await api().post(`${base}/wods/${wods[0]}/submissions`).set(bearer(ahmed.token)).send({ clientId: randomUUID(), raw: { value: 95 }, submit: false }).expect(201);
    expect(draft.body.status).toBe('DRAFT');

    const scores: Record<string, number[]> = { [ahmed.id]: [95, 90, 140, 175], [ali.id]: [90, 100, 120, 160] };
    const subs: Record<string, string[]> = { [ahmed.id]: [], [ali.id]: [] };
    for (const a of [ahmed, ali]) {
      for (const [i, w] of wods.entries()) {
        const clientId = randomUUID();
        const s = await api().post(`${base}/wods/${w}/submissions`).set(bearer(a.token)).send({ clientId, raw: { value: scores[a.id][i] }, videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }).expect(201);
        expect(s.body).toMatchObject({ status: 'SUBMITTED', youtubeId: 'dQw4w9WgXcQ' });
        // A retry with the same clientId is answered with the same submission.
        const again = await api().post(`${base}/wods/${w}/submissions`).set(bearer(a.token)).send({ clientId, raw: { value: scores[a.id][i] } }).expect(201);
        expect(again.body.id).toBe(s.body.id);
        subs[a.id].push(s.body.id);
      }
    }

    // Submitted scores are not official yet.
    let board = await api().get(`${base}/leaderboard?categoryId=${rxMale}`).set(bearer(ali.token)).expect(200);
    expect(board.body.provisional).toBe(true);
    expect(board.body.rows.every((r: { totalPoints: number }) => r.totalPoints === 0)).toBe(true);

    const queue = await api().get(`/api/v1/judge/submissions?competitionId=${competitionId}`).set(bearer(judge.token)).expect(200);
    expect(queue.body).toHaveLength(8);
    await api().get('/api/v1/judge/submissions').set(bearer(ahmed.token)).expect(403);

    // Judge view by athlete: each athlete with the WODs they completed and the YouTube link of each.
    const byAthlete = await api().get(`/api/v1/judge/athletes?competitionId=${competitionId}`).set(bearer(judge.token)).expect(200);
    expect(byAthlete.body).toHaveLength(1);
    expect(byAthlete.body[0]).toMatchObject({ competition: { id: competitionId }, wodCount: 4 });
    const athletes = byAthlete.body[0].athletes as { athlete: { id: string }; category: { id: string }; submissions: { workout: { id: string }; videoUrl: string; youtubeId: string; status: string }[] }[];
    expect(athletes.map((a) => a.athlete.id).sort()).toEqual([ahmed.id, ali.id].sort());
    for (const a of athletes) {
      expect(a.category.id).toBe(rxMale);
      expect(a.submissions.map((x) => x.workout.id)).toEqual(wods);
      expect(a.submissions.every((x) => x.status === 'SUBMITTED' && x.youtubeId === 'dQw4w9WgXcQ' && x.videoUrl === 'https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    }
    await api().get(`/api/v1/judge/athletes?competitionId=${competitionId}`).set(bearer(ahmed.token)).expect(403);
    await api().post(`/api/v1/judge/submissions/${subs[ali.id][0]}/approve`).set(bearer(ahmed.token)).expect(403);

    for (const id of [...subs[ahmed.id], ...subs[ali.id]]) await api().post(`/api/v1/judge/submissions/${id}/approve`).set(bearer(judge.token)).expect(200);

    board = await api().get(`${base}/leaderboard?categoryId=${rxMale}`).set(bearer(ali.token)).expect(200);
    expect(board.body.maximumPoints).toBe(550);
    expect(board.body.rows.map((r: { athlete: { id: string }; totalPoints: number; rank: number }) => [r.athlete.id, r.totalPoints, r.rank])).toEqual([
      [ahmed.id, 500, 1],
      [ali.id, 470, 2],
    ]);

    // Judge corrects WOD 3: 140 → 125 (no rep); the total and the rank follow, history is kept.
    const adjusted = await api().post(`/api/v1/judge/submissions/${subs[ahmed.id][2]}/adjust-score`).set(bearer(judge.token)).send({ points: 125, reason: 'No rep detected' }).expect(200);
    expect(adjusted.body.points).toBe(125);
    // Penalty on Ali's WOD 4: 160 − 10.
    await api().post(`/api/v1/judge/submissions/${subs[ali.id][3]}/penalty`).set(bearer(judge.token)).send({ type: 'POINT_PENALTY', points: 10, reason: 'Short range of motion' }).expect(200);
    board = await api().get(`${base}/leaderboard?categoryId=${rxMale}`).set(bearer(ali.token)).expect(200);
    expect(board.body.rows.map((r: { totalPoints: number }) => r.totalPoints)).toEqual([485, 460]);

    const detail = await api().get(`/api/v1/judge/submissions/${subs[ahmed.id][2]}`).set(bearer(headJudge.token)).expect(200);
    expect(detail.body.versions.map((v: { points: number; reason: string }) => [v.points, v.reason])).toEqual([
      [0, 'Submitted by athlete'],
      [140, 'Approved'],
      [125, 'No rep detected'],
    ]);
    // The athlete sees the official result, not the judges' history.
    const own = await api().get(`/api/v1/judge/submissions/${subs[ahmed.id][2]}`).set(bearer(ahmed.token)).expect(200);
    expect(own.body.versions).toBeUndefined();
    expect(await prisma.notification.count({ where: { userId: ahmed.id, type: 'COMPETITION_SCORE_MODIFIED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'competition.submission.adjust-score', entityId: subs[ahmed.id][2] } })).toBe(1);
  });

  it('HEAD JUDGE publishes the final leaderboard: locked, podium and prizes shown', async () => {
    const base = `/api/v1/competitions/${competitionId}`;
    await api().post(`${base}/publish-leaderboard`).set(bearer(judge.token)).expect(403);
    await api().post(`${base}/publish-leaderboard`).set(bearer(headJudge.token)).expect(200);

    const board = await api().get(`${base}/leaderboard?categoryId=${rxMale}`).set(bearer(ali.token)).expect(200);
    expect(board.body.provisional).toBe(false);
    expect(board.body.podium.gold).toEqual([ahmed.id]);
    expect(board.body.podium.silver).toEqual([ali.id]);
    expect(board.body.prizes[0]).toMatchObject({ position: 1, type: 'CASH', amount: 1_000_000, currency: 'TND' });

    // Locked: a judge can no longer change scores; the head judge can, and it is audited.
    const sub = await prisma.competitionSubmission.findFirstOrThrow({ where: { userId: ali.id, workoutId: wods[0] } });
    await api().post(`/api/v1/judge/submissions/${sub.id}/adjust-score`).set(bearer(judge.token)).send({ points: 99, reason: 'Late change' }).expect(403);
    await api().post(`/api/v1/judge/submissions/${sub.id}/adjust-score`).set(bearer(headJudge.token)).send({ points: 92, reason: 'Video review' }).expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'competition.leaderboard.published', entityId: competitionId } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: ali.id, type: 'COMPETITION_LEADERBOARD_FINAL' } })).toBe(1);
  });

  it('organizers can add the 18 category templates (§10)', async () => {
    const c = await api()
      .post('/api/v1/competitions')
      .set(bearer(organizer.token))
      .send({ title: 'Template test', slug: `tpl-${Date.now()}`, description: 'x', format: 'ONSITE', registrationStart: h(1), registrationEnd: h(2), eventStart: h(3), eventEnd: h(4), registrationPrice: 0 })
      .expect(201);
    const cats = await api().post(`/api/v1/competitions/${c.body.id}/categories/templates`).set(bearer(organizer.token)).expect(201);
    expect(cats.body).toHaveLength(18);
    expect(cats.body.find((x: { name: string }) => x.name === 'Scaled Master Male Division 40-45')).toMatchObject({ gender: 'MALE', minAge: 40, maxAge: 45 });
  });

  it('ADMIN panel manages competitions through admin-audience tokens only (§55)', async () => {
    const admin = await actor();
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    const panel = await adminBearer(app, prisma, admin.id);
    await api().get('/api/v1/admin/competitions').set(bearer(admin.token)).expect(401); // app token refused
    const list = await api().get('/api/v1/admin/competitions').set(panel).expect(200);
    expect(list.body.some((c: { id: string }) => c.id === competitionId)).toBe(true);
    const dash = await api().get(`/api/v1/admin/competitions/${competitionId}/dashboard`).set(panel).expect(200);
    expect(dash.body).toMatchObject({ participants: 2, paidRegistrations: 1, freeRegistrations: 1, revenue: 40_000 });
    await api().get(`/api/v1/admin/competitions/${competitionId}/heats`).set(panel).expect(200);
    const byAthlete = await api().get(`/api/v1/admin/competitions/${competitionId}/athletes`).set(panel).expect(200);
    expect(byAthlete.body).toMatchObject({ wodCount: 4 });
    expect(byAthlete.body.athletes.map((a: { submissions: unknown[] }) => a.submissions.length)).toEqual([4, 4]);
    await api().get(`/api/v1/admin/competitions/${competitionId}/heats`).set(bearer(admin.token)).expect(401);
  });

  it('a JUDGE assigned to one WOD sees only that WOD under each athlete', async () => {
    const base = `/api/v1/competitions/${competitionId}`;
    const wod2Judge = await actor();
    const staff = await api().post(`${base}/staff`).set(bearer(organizer.token)).send({ userId: wod2Judge.id, role: 'JUDGE' }).expect(201);
    await api().post(`${base}/judge-assignments`).set(bearer(organizer.token)).send({ staffId: staff.body.id, workoutId: wods[1] }).expect(201);
    const res = await api().get('/api/v1/judge/athletes').set(bearer(wod2Judge.token)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].wodCount).toBe(1);
    for (const a of res.body[0].athletes) expect(a.submissions.map((x: { workout: { id: string } }) => x.workout.id)).toEqual([wods[1]]);
  });


  it('ORGANIZER schedules heats with lanes; athletes see their heat (§45)', async () => {
    const base = `/api/v1/competitions/${competitionId}`;
    const regs = (await api().get(`${base}/registrations`).set(bearer(organizer.token)).expect(200)).body as { id: string; userId: string; registrationStatus: string }[];
    const regOf = (u: Actor) => regs.find((r) => r.userId === u.id)!.id;
    const board = await api().get(`${base}/leaderboard?categoryId=${rxMale}`).set(bearer(ahmed.token)).expect(200);
    const leader = board.body.rows[0].athlete.id as string;

    // Manual heat: lanes are unique, athletes too, and only organizers write.
    await api().post(`${base}/heats`).set(bearer(ahmed.token)).send({ name: 'Heat X' }).expect(403);
    const heat = (await api().post(`${base}/heats`).set(bearer(organizer.token)).send({ categoryId: rxMale, laneCount: 4, startsAt: h(24) }).expect(201)).body;
    expect(heat).toMatchObject({ number: 1, name: 'Heat 1', laneCount: 4 });
    await api().post(`${base}/heats/${heat.id}/lanes`).set(bearer(organizer.token)).send({ registrationId: regOf(ahmed), lane: 2 }).expect(201);
    await api().post(`${base}/heats/${heat.id}/lanes`).set(bearer(organizer.token)).send({ registrationId: regOf(ali), lane: 2 }).expect(409);
    await api().post(`${base}/heats/${heat.id}/lanes`).set(bearer(organizer.token)).send({ registrationId: regOf(ahmed), lane: 3 }).expect(409);
    await api().post(`${base}/heats/${heat.id}/lanes`).set(bearer(organizer.token)).send({ registrationId: regOf(ali), lane: 5 }).expect(422);
    const mine = await api().get(`${base}/heats`).set(bearer(ahmed.token)).expect(200);
    expect(mine.body[0].lanes).toEqual([expect.objectContaining({ lane: 2, mine: true, athlete: expect.objectContaining({ id: ahmed.id }) })]);
    await api().delete(`${base}/heats/${heat.id}/lanes/2`).set(bearer(organizer.token)).expect(204);
    await api().delete(`${base}/heats/${heat.id}`).set(bearer(organizer.token)).expect(204);

    // Auto: one lane per heat → the leader runs in the last heat; a second run is refused.
    const auto = await api().post(`${base}/heats/auto`).set(bearer(organizer.token)).send({ categoryId: rxMale, laneCount: 1, startsAt: h(48), intervalMin: 15 }).expect(201);
    expect(auto.body).toEqual({ heats: 2, athletes: 2 });
    const heats = (await api().get(`${base}/heats`).set(bearer(ali.token)).expect(200)).body;
    expect(heats).toHaveLength(2);
    expect(heats[1].lanes[0].athlete.id).toBe(leader);
    expect(new Date(heats[1].startsAt).getTime() - new Date(heats[0].startsAt).getTime()).toBe(15 * 60_000);
    await api().post(`${base}/heats/auto`).set(bearer(organizer.token)).send({ categoryId: rxMale, laneCount: 1 }).expect(409);
  });
});
