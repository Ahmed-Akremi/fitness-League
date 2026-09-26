import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { InMemoryMailSender } from '../src/common/mail/mail-sender';
import { lastMailToken, registerUser, registrationBody, setupTestApp } from './helpers';

describe('Auth, users & reference (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let mail: InMemoryMailSender;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma, mail } = await setupTestApp());
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('registration', () => {
    it('creates the account, profile, settings, stats and consents, and signs the user in', async () => {
      const { body, session } = await registerUser(app, prisma);
      expect(session).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String), expiresIn: 900 });

      const me = await api().get('/api/v1/me').set('authorization', `Bearer ${session.accessToken}`).expect(200);
      expect(me.body).toMatchObject({
        username: body.username,
        email: body.email,
        emailVerified: false,
        role: 'USER',
        ageBracket: '25-34',
        profile: { fullName: 'Test Athlete', countryCode: 'TN', governorate: { code: 'TN-51' }, plannedTrainingDaysPerWeek: 3 },
        settings: { locale: 'fr', theme: 'DARK' },
        stats: { xpTotal: 0, level: 1, levelTitleKey: 'level.title.beginner', seasonLp: 0, division: 'BRONZE', leaderboardEligible: false },
      });
      expect(JSON.stringify(me.body)).not.toContain('1998-04-12'); // date of birth never leaves the server
      expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|argon2/);

      const consents = await prisma.consent.findMany({ where: { userId: session.userId } });
      expect(consents.map((c) => `${c.type}:${c.granted}`).sort()).toEqual(['HEALTH_DATA:false', 'MARKETING:false', 'PRIVACY:true', 'TERMS:true']);
      expect(await prisma.auditLog.count({ where: { entityId: session.userId, action: 'USER_REGISTERED' } })).toBe(1);
    });

    it('refuses users under the minimum age (18 in rule set v1) and stores nothing', async () => {
      const body = await registrationBody(prisma, { dateOfBirth: '2009-01-01' });
      const res = await api().post('/api/v1/auth/register').send(body).expect(422);
      expect(res.body).toMatchObject({ code: 'UNDER_AGE', minAgeYears: 18 });
      expect(await prisma.user.count({ where: { email: body.email } })).toBe(0);
    });

    it('refuses unknown fields, so a client can neither send points nor pick its role', async () => {
      const body = await registrationBody(prisma, { role: 'SUPER_ADMIN', xp: 99999 });
      const res = await api().post('/api/v1/auth/register').send(body).expect(422);
      expect(res.body.errors).toEqual(expect.arrayContaining([
        { field: 'role', code: 'UNKNOWN_FIELD' },
        { field: 'xp', code: 'UNKNOWN_FIELD' },
      ]));
    });

    it('requires terms and privacy consent', async () => {
      const body = await registrationBody(prisma, { consents: { terms: false, privacy: true, healthData: true, documentVersion: 'v1' } });
      const res = await api().post('/api/v1/auth/register').send(body).expect(422);
      expect(res.body.errors).toContainEqual({ field: 'consents.terms', code: 'EQUALS' });
    });

    it('refuses a city outside the chosen governorate', async () => {
      const tunis = await prisma.city.findFirstOrThrow({ where: { governorate: { code: 'TN-11' } } });
      const res = await api().post('/api/v1/auth/register').send(await registrationBody(prisma, { cityId: tunis.id })).expect(422);
      expect(res.body.errors).toEqual([{ field: 'cityId', code: 'NOT_IN_GOVERNORATE' }]);
    });

    it('reports taken emails (case-insensitive) and usernames', async () => {
      const { body } = await registerUser(app, prisma);
      const dupEmail = await registrationBody(prisma, { email: body.email.toUpperCase() });
      expect((await api().post('/api/v1/auth/register').send(dupEmail).expect(409)).body.code).toBe('EMAIL_TAKEN');
      const dupUsername = await registrationBody(prisma, { username: body.username });
      expect((await api().post('/api/v1/auth/register').send(dupUsername).expect(409)).body.code).toBe('USERNAME_TAKEN');
    });

    it('stores an Argon2id hash, never the password', async () => {
      const { body, session } = await registerUser(app, prisma);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
      expect(user.passwordHash).not.toContain(body.password);
    });
  });

  describe('login and lockout', () => {
    it('signs in with the right password and gives the same answer for a wrong password or unknown email', async () => {
      const { body } = await registerUser(app, prisma);
      await api().post('/api/v1/auth/login').send({ email: body.email, password: body.password }).expect(200);
      const wrong = await api().post('/api/v1/auth/login').send({ email: body.email, password: 'wrong password!' }).expect(401);
      const unknown = await api().post('/api/v1/auth/login').send({ email: 'nobody@example.test', password: 'wrong password!' }).expect(401);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.title).toBe(wrong.body.title);
    });

    it('locks the account after 5 failures, even for the right password, and emails the owner', async () => {
      const { body } = await registerUser(app, prisma);
      for (let i = 0; i < 5; i++) {
        await api().post('/api/v1/auth/login').send({ email: body.email, password: 'wrong password!' }).expect(401);
      }
      const locked = await api().post('/api/v1/auth/login').send({ email: body.email, password: body.password }).expect(423);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(800);
      expect(mail.outbox.some((m) => m.to === body.email && m.tag === 'ACCOUNT_LOCKED')).toBe(true);
    });
  });

  describe('sessions', () => {
    it('rotates refresh tokens and revokes the whole family when an old one is replayed', async () => {
      const { session } = await registerUser(app, prisma);
      const first = await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(200);
      expect(first.body.refreshToken).not.toBe(session.refreshToken);

      // Attacker replays the original token → reuse detected.
      const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
      expect(replay.body.code).toBe('TOKEN_REUSED');
      // The legitimate client's newest token is revoked too.
      await api().post('/api/v1/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(401);
      expect(await prisma.auditLog.count({ where: { entityId: session.userId, action: 'REFRESH_TOKEN_REUSE_DETECTED' } })).toBe(1);
    });

    it('logout revokes the session', async () => {
      const { session } = await registerUser(app, prisma);
      await api().post('/api/v1/auth/logout').set('authorization', `Bearer ${session.accessToken}`).send({ refreshToken: session.refreshToken }).expect(204);
      const res = await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
      expect(res.body.code).toBe('TOKEN_INVALID');
    });

    it('rejects missing, malformed and forged access tokens', async () => {
      expect((await api().get('/api/v1/me').expect(401)).body.code).toBe('UNAUTHENTICATED');
      expect((await api().get('/api/v1/me').set('authorization', 'Bearer abc.def.ghi').expect(401)).body.code).toBe('TOKEN_INVALID');
    });

    it('blocks banned users immediately, even with a valid token', async () => {
      const { session } = await registerUser(app, prisma);
      await prisma.user.update({ where: { id: session.userId }, data: { status: 'BANNED' } });
      const res = await api().get('/api/v1/me').set('authorization', `Bearer ${session.accessToken}`).expect(403);
      expect(res.body.code).toBe('ACCOUNT_BANNED');
      await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(403);
    });
  });

  describe('email verification', () => {
    it('verifies the email with the mailed link, once', async () => {
      const { body, session } = await registerUser(app, prisma);
      const token = lastMailToken(mail, body.email, 'EMAIL_VERIFY');
      await api().post('/api/v1/auth/email/verify').send({ token }).expect(204);
      const me = await api().get('/api/v1/me').set('authorization', `Bearer ${session.accessToken}`).expect(200);
      expect(me.body.emailVerified).toBe(true);
      expect((await api().post('/api/v1/auth/email/verify').send({ token }).expect(422)).body.code).toBe('TOKEN_INVALID');
    });

    it('a resent link invalidates the previous one', async () => {
      const { body, session } = await registerUser(app, prisma);
      const first = lastMailToken(mail, body.email, 'EMAIL_VERIFY');
      await api().post('/api/v1/auth/email/resend').set('authorization', `Bearer ${session.accessToken}`).expect(204);
      const second = lastMailToken(mail, body.email, 'EMAIL_VERIFY');
      expect(second).not.toBe(first);
      await api().post('/api/v1/auth/email/verify').send({ token: first }).expect(422);
      await api().post('/api/v1/auth/email/verify').send({ token: second }).expect(204);
    });
  });

  describe('password reset', () => {
    it('does not reveal whether an email exists', async () => {
      const before = mail.outbox.length;
      await api().post('/api/v1/auth/password/forgot').send({ email: 'ghost@example.test' }).expect(202);
      expect(mail.outbox.length).toBe(before);
    });

    it('resets the password and signs out every device', async () => {
      const { body, session } = await registerUser(app, prisma);
      await api().post('/api/v1/auth/password/forgot').send({ email: body.email }).expect(202);
      const token = lastMailToken(mail, body.email, 'PASSWORD_RESET');
      await api().post('/api/v1/auth/password/reset').send({ token, newPassword: 'a brand new passphrase' }).expect(204);

      await api().get('/api/v1/me').set('authorization', `Bearer ${session.accessToken}`).expect(401);
      await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
      await api().post('/api/v1/auth/login').send({ email: body.email, password: body.password }).expect(401);
      await api().post('/api/v1/auth/login').send({ email: body.email, password: 'a brand new passphrase' }).expect(200);
      await api().post('/api/v1/auth/password/reset').send({ token, newPassword: 'another passphrase!' }).expect(422);
    });
  });

  describe('profile & settings', () => {
    it('updates profile and settings with validation', async () => {
      const { session } = await registerUser(app, prisma);
      const auth = { authorization: `Bearer ${session.accessToken}` };
      const tunis = await prisma.governorate.findUniqueOrThrow({ where: { code: 'TN-11' }, include: { cities: true } });

      await api().patch('/api/v1/me/profile').set(auth).send({ plannedTrainingDaysPerWeek: 8 }).expect(422);
      await api().patch('/api/v1/me/profile').set(auth).send({ cityId: tunis.cities[0]!.id }).expect(422);
      const updated = await api()
        .patch('/api/v1/me/profile')
        .set(auth)
        .send({ plannedTrainingDaysPerWeek: 4, governorateId: tunis.id, cityId: tunis.cities[0]!.id, bio: 'Squat every day' })
        .expect(200);
      expect(updated.body.profile).toMatchObject({ plannedTrainingDaysPerWeek: 4, governorate: { code: 'TN-11' }, bio: 'Squat every day' });

      const settings = await api().patch('/api/v1/me/settings').set(auth).send({ locale: 'ar', theme: 'LIGHT', reducedMotion: true }).expect(200);
      expect(settings.body.settings).toMatchObject({ locale: 'ar', theme: 'LIGHT', reducedMotion: true });
    });
  });

  describe('reference catalog', () => {
    it('lists governorates and their cities', async () => {
      const govs = await api().get('/api/v1/ref/governorates').expect(200);
      expect(govs.body).toHaveLength(24);
      expect(govs.headers['cache-control']).toContain('max-age');
      const sousse = govs.body.find((g: { code: string }) => g.code === 'TN-51');
      const cities = await api().get(`/api/v1/ref/cities?governorateId=${sousse.id}`).expect(200);
      expect(cities.body.map((c: { name: { fr: string } }) => c.name.fr)).toContain('Sousse');
    });

    it('filters exercises by sport, sharing strength exercises but not across cardio', async () => {
      const sports = (await api().get('/api/v1/ref/sports').expect(200)).body as { id: string; code: string }[];
      const id = (code: string) => sports.find((s) => s.code === code)!.id;
      const run = (await api().get(`/api/v1/ref/exercises?sportId=${id('RUNNING')}`).expect(200)).body.map((e: { code: string }) => e.code);
      expect(run).toEqual(['RUN']);
      const bb = (await api().get(`/api/v1/ref/exercises?sportId=${id('BODYBUILDING')}`).expect(200)).body.map((e: { code: string }) => e.code);
      expect(bb).toEqual(expect.arrayContaining(['BACK_SQUAT', 'BENCH_PRESS', 'PULL_UP']));
      expect(bb).not.toContain('RUN');
    });

    it('supports delta sync', async () => {
      const res = await api().get('/api/v1/ref/exercises?updatedSince=2999-01-01T00:00:00Z').expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('rate limits', () => {
    let limited: INestApplication;

    beforeAll(async () => {
      ({ app: limited } = await setupTestApp({ RATE_LIMIT_ENABLED: 'true' }));
    });

    afterAll(async () => {
      await limited?.close();
    });

    it('limits login attempts per account with Retry-After', async () => {
      const email = 'rate.limit.target@example.test';
      for (let i = 0; i < 5; i++) {
        await request(limited.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'wrong password!' }).expect(401);
      }
      const res = await request(limited.getHttpServer()).post('/api/v1/auth/login').send({ email: email.toUpperCase(), password: 'wrong password!' }).expect(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });
  });
});
