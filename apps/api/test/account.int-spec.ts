import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { ClockService } from '../src/common/clock/clock.service';
import { OAuthVerifier } from '../src/modules/auth/oauth-verifier';
import { PrivacyService } from '../src/modules/users/privacy.service';
import { registerUser, registrationBody, setupTestApp } from './helpers';

describe('OAuth, onboarding & privacy (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let signGoogle: (claims: Record<string, unknown>, aud?: string) => Promise<string>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
    app.get(OAuthVerifier).useKeyResolver('GOOGLE', createLocalJWKSet({ keys: [jwk] }));
    signGoogle = (claims, aud = 'google-test-client') =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer('https://accounts.google.com')
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(privateKey);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('Google sign-in', () => {
    it('asks for registration details on first sign-in, then creates a verified account', async () => {
      const idToken = await signGoogle({ sub: 'g-001', email: 'Nour.G@example.test', email_verified: true, name: 'Nour G' });
      const first = await api().post('/api/v1/auth/oauth/google').send({ idToken }).expect(422);
      expect(first.body).toMatchObject({ code: 'OAUTH_REGISTRATION_REQUIRED', prefill: { email: 'nour.g@example.test', fullName: 'Nour G' } });

      const { username, dateOfBirth, countryCode, governorateId, cityId, consents } = await registrationBody(prisma);
      const created = await api()
        .post('/api/v1/auth/oauth/google')
        .send({ idToken, registration: { username, dateOfBirth, countryCode, governorateId, cityId, consents } })
        .expect(200);
      const me = await api().get('/api/v1/me').set(bearer(created.body.accessToken)).expect(200);
      expect(me.body).toMatchObject({ email: 'nour.g@example.test', emailVerified: true, profile: { fullName: 'Nour G' } });

      // Next time the same identity just signs in.
      const again = await api().post('/api/v1/auth/oauth/google').send({ idToken: await signGoogle({ sub: 'g-001' }) }).expect(200);
      expect(again.body.userId).toBe(created.body.userId);
    });

    it('links to an existing account when the provider verified the same email', async () => {
      const { body, session } = await registerUser(app, prisma);
      const idToken = await signGoogle({ sub: 'g-link', email: body.email, email_verified: true });
      const res = await api().post('/api/v1/auth/oauth/google').send({ idToken }).expect(200);
      expect(res.body.userId).toBe(session.userId);
    });

    it('never links on an unverified email', async () => {
      const { body } = await registerUser(app, prisma);
      const idToken = await signGoogle({ sub: 'g-unverified', email: body.email, email_verified: false });
      expect((await api().post('/api/v1/auth/oauth/google').send({ idToken }).expect(422)).body.code).toBe('OAUTH_REGISTRATION_REQUIRED');
    });

    it('rejects tokens for another audience or with a wrong nonce', async () => {
      const otherAud = await signGoogle({ sub: 'g-x', email: 'x@example.test', email_verified: true }, 'someone-else');
      expect((await api().post('/api/v1/auth/oauth/google').send({ idToken: otherAud }).expect(401)).body.code).toBe('TOKEN_INVALID');
      const withNonce = await signGoogle({ sub: 'g-y', nonce: 'abc' });
      await api().post('/api/v1/auth/oauth/google').send({ idToken: withNonce, nonce: 'different' }).expect(401);
    });

    it('applies the age gate to OAuth registrations too', async () => {
      const idToken = await signGoogle({ sub: 'g-young', email: 'young@example.test', email_verified: true, name: 'Young' });
      const { username, countryCode, governorateId, cityId, consents } = await registrationBody(prisma);
      const res = await api()
        .post('/api/v1/auth/oauth/google')
        .send({ idToken, registration: { username, dateOfBirth: '2010-01-01', countryCode, governorateId, cityId, consents } })
        .expect(422);
      expect(res.body.code).toBe('UNDER_AGE');
    });
  });

  describe('onboarding', () => {
    it('walks through sports, declared baselines and completion (which starts calibration)', async () => {
      const { session } = await registerUser(app, prisma);
      const auth = bearer(session.accessToken);
      const sports = (await api().get('/api/v1/ref/sports')).body as { id: string; code: string }[];
      const bb = sports.find((s) => s.code === 'BODYBUILDING')!.id;
      const run = sports.find((s) => s.code === 'RUNNING')!.id;

      expect((await api().post('/api/v1/me/onboarding/complete').set(auth).expect(422)).body).toMatchObject({ code: 'PRECONDITION_FAILED', missingStep: 'sports' });
      await api().post('/api/v1/me/onboarding/sports').set(auth).send({ sportIds: [bb, run], primarySportId: run }).expect(200);

      const squat = await prisma.exercise.findUniqueOrThrow({ where: { code: 'BACK_SQUAT' } });
      const bad = await api().post('/api/v1/me/onboarding/baselines').set(auth).send({ entries: [{ exerciseId: squat.id, metricCode: 'TIME_5K', value: 1500 }] }).expect(422);
      expect(bad.body.errors).toEqual([{ field: 'entries[0].metricCode', code: 'METRIC_NOT_TRACKED' }]);
      await api().post('/api/v1/me/onboarding/baselines').set(auth).send({ entries: [{ exerciseId: squat.id, metricCode: 'E1RM', value: 80 }] }).expect(200);

      const done = await api().post('/api/v1/me/onboarding/complete').set(auth).expect(200);
      expect(done.body).toMatchObject({ completed: true, steps: { sports: true, baselines: true } });
      const days = (new Date(done.body.calibrationEndsAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(13.9);
      expect(days).toBeLessThanOrEqual(14);

      const baseline = await prisma.baseline.findFirstOrThrow({ where: { userId: session.userId } });
      expect(baseline).toMatchObject({ status: 'PROVISIONAL' });
      expect(Number(baseline.declaredValue)).toBe(80);
    });
  });

  describe('health data', () => {
    it('requires explicit consent, stores weight encrypted and shows it only to the owner', async () => {
      const { session } = await registerUser(app, prisma);
      const auth = bearer(session.accessToken);
      const refused = await api().post('/api/v1/me/body-measurements').set(auth).send({ weightKg: 78.4 }).expect(403);
      expect(refused.body.code).toBe('CONSENT_REQUIRED');

      await api().post('/api/v1/me/consents').set(auth).send({ type: 'HEALTH_DATA', granted: true, documentVersion: '2026-09' }).expect(201);
      await api().post('/api/v1/me/body-measurements').set(auth).send({ weightKg: 78.4, bodyFatPct: 18.5 }).expect(201);

      const list = await api().get('/api/v1/me/body-measurements').set(auth).expect(200);
      expect(list.body[0]).toMatchObject({ weightKg: 78.4, bodyFatPct: 18.5 });
      const raw = await prisma.bodyMeasurement.findFirstOrThrow({ where: { userId: session.userId } });
      expect(Buffer.from(raw.weightKgEnc!).toString('latin1')).not.toContain('78.4');
    });

    it('does not allow withdrawing terms consent in-app', async () => {
      const { session } = await registerUser(app, prisma);
      await api().post('/api/v1/me/consents').set(bearer(session.accessToken)).send({ type: 'TERMS', granted: false, documentVersion: 'x' }).expect(422);
    });
  });

  describe('export and deletion', () => {
    it('exports the user data without secrets', async () => {
      const { body, session } = await registerUser(app, prisma);
      const res = await api().get('/api/v1/me/export').set(bearer(session.accessToken)).expect(200);
      expect(res.body.account).toMatchObject({ email: body.email, dateOfBirth: body.dateOfBirth });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2id/);
      expect(res.body.consents).toHaveLength(4);
    });

    it('requires the password, signs out, is cancelled by signing in, and anonymises after the grace period', async () => {
      const { body, session } = await registerUser(app, prisma);
      await api().delete('/api/v1/me').set(bearer(session.accessToken)).send({ confirm: 'DELETE', password: 'nope nope nope' }).expect(401);
      await api().delete('/api/v1/me').set(bearer(session.accessToken)).send({ confirm: 'DELETE', password: body.password }).expect(202);
      await api().get('/api/v1/me').set(bearer(session.accessToken)).expect(401);

      // Signing in during the grace period cancels the request.
      const login = await api().post('/api/v1/auth/login').send({ email: body.email, password: body.password }).expect(200);
      expect(await prisma.dataRequest.findFirst({ where: { userId: session.userId, status: 'PENDING' } })).toBeNull();

      // Ask again, then let 31 days pass.
      await api().delete('/api/v1/me').set(bearer(login.body.accessToken)).send({ confirm: 'DELETE', password: body.password }).expect(202);
      const clock = app.get(ClockService);
      jest.spyOn(clock, 'now').mockReturnValue(new Date(Date.now() + 31 * 86_400_000));
      expect(await app.get(PrivacyService).processDueDeletions()).toBeGreaterThanOrEqual(1);
      jest.restoreAllMocks();

      const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, include: { profile: true } });
      expect(user).toMatchObject({ status: 'DELETED', passwordHash: null, phoneE164: null });
      expect(user.email).toMatch(/@deleted\.invalid$/);
      expect(user.profile?.fullName).toBe('Deleted athlete');
      await api().post('/api/v1/auth/login').send({ email: body.email, password: body.password }).expect(401);
      // Consent history and audit trail survive (append-only compliance records).
      expect(await prisma.consent.count({ where: { userId: session.userId } })).toBe(4);
    });
  });
});
