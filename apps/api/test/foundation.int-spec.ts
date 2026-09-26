import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { uuidv7 } from '../src/common/ids/uuid';
import { seed } from '../src/database/seed';
import { setupTestApp } from './helpers';


describe('Foundation (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('health', () => {
    it('GET /api/v1/health answers', async () => {
      await request(app.getHttpServer()).get('/api/v1/health').expect(200, { status: 'ok' });
    });

    it('GET /api/v1/ready checks the database', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/ready').expect(200);
      expect(res.body).toEqual({ status: 'ready', checks: { database: 'up' } });
    });

    it('propagates a safe x-request-id as traceId', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/nope').set('x-request-id', 'req-12345678').expect(404);
      expect(res.body.traceId).toBe('req-12345678');
    });
  });

  describe('errors', () => {
    it('renders unknown routes as problem+json without internals', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND', type: expect.stringContaining('not-found') });
      expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|node_modules/);
    });

    it('rejects malformed JSON with a 400 problem', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/health')
        .set('content-type', 'application/json')
        .send('{"broken":')
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('sets security headers', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('seed data', () => {
    it('contains the 24 Tunisian governorates with fr/en/ar names', async () => {
      const govs = await prisma.governorate.findMany();
      expect(govs).toHaveLength(24);
      for (const g of govs) expect(Object.keys(g.nameI18n as object).sort()).toEqual(['ar', 'en', 'fr']);
      expect(await prisma.city.count({ where: { governorateId: { in: govs.map((g) => g.id) } } })).toBeGreaterThanOrEqual(48);
    });

    it('has exactly one ACTIVE rule set and an active season for today', async () => {
      expect(await prisma.scoringRuleSet.count({ where: { status: 'ACTIVE' } })).toBe(1);
      const active = await prisma.season.findFirstOrThrow({ where: { status: 'ACTIVE' } });
      expect(active.startsAt <= new Date('2026-09-25T10:00:00Z') && active.endsAt > new Date('2026-09-25T10:00:00Z')).toBe(true);
    });

    it('is idempotent', async () => {
      const before = await prisma.exercise.count();
      await seed(prisma, new Date('2026-09-25T10:00:00Z'));
      expect(await prisma.exercise.count()).toBe(before);
      expect(await prisma.season.count()).toBe(2);
    });
  });

  describe('database guarantees', () => {
    let userId: string;
    let seasonId: string;

    beforeAll(async () => {
      const gov = await prisma.governorate.findUniqueOrThrow({ where: { code: 'TN-51' }, include: { cities: true } });
      userId = uuidv7();
      await prisma.user.create({
        data: {
          id: userId,
          email: `ledger-${userId}@test.local`,
          username: `u${userId.slice(-12)}`,
          dateOfBirth: new Date('1998-01-01'),
          profile: { create: { fullName: 'Ledger Test', governorateId: gov.id, cityId: gov.cities[0]!.id } },
        },
      });
      seasonId = (await prisma.season.findFirstOrThrow({ where: { status: 'ACTIVE' } })).id;
    });

    const xp = (overrides: Record<string, unknown> = {}) => ({
      id: uuidv7(),
      userId,
      amount: 30,
      reason: 'WORKOUT' as const,
      sourceType: 'workout',
      sourceId: 'w-1',
      ruleSetVersion: 1,
      explanation: {},
      effectiveAt: new Date(),
      ...overrides,
    });

    it('never grants the same event twice', async () => {
      await prisma.xpTransaction.create({ data: xp() });
      await expect(prisma.xpTransaction.create({ data: xp() })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('makes ledgers append-only (UPDATE and DELETE are refused)', async () => {
      const entry = await prisma.xpTransaction.create({ data: xp({ sourceId: 'w-2' }) });
      await expect(prisma.xpTransaction.update({ where: { id: entry.id }, data: { amount: 9999 } })).rejects.toThrow(/append-only/);
      await expect(prisma.xpTransaction.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    });

    it('allows exactly one reversal per entry, and only negative amounts on corrections', async () => {
      const entry = await prisma.xpTransaction.create({ data: xp({ sourceId: 'w-3' }) });
      await expect(prisma.xpTransaction.create({ data: xp({ sourceId: 'w-4', amount: -5 }) })).rejects.toThrow(/amount_sign/);
      await prisma.xpTransaction.create({ data: xp({ reason: 'REVERSAL', amount: -30, reversesId: entry.id, sourceId: 'rev-1' }) });
      await expect(
        prisma.xpTransaction.create({ data: xp({ reason: 'REVERSAL', amount: -30, reversesId: entry.id, sourceId: 'rev-2' }) }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('applies the same guarantees to League Points', async () => {
      const lp = { id: uuidv7(), userId, seasonId, amount: 80, reason: 'WEEKLY_SCORE' as const, sourceType: 'week', sourceId: '2026-09-21', ruleSetVersion: 1, explanation: {}, effectiveAt: new Date() };
      const entry = await prisma.leaguePointTransaction.create({ data: lp });
      await expect(prisma.leaguePointTransaction.create({ data: { ...lp, id: uuidv7() } })).rejects.toMatchObject({ code: 'P2002' });
      await expect(prisma.leaguePointTransaction.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    });

    it('stores friendships once as an ordered pair', async () => {
      const [a, b] = [uuidv7(), uuidv7()].sort();
      await expect(
        prisma.friendship.create({ data: { userLowId: b!, userHighId: a!, requestedById: a! } }),
      ).rejects.toThrow(/friendships_ordered_pair/);
    });

    it('refuses overlapping seasons', async () => {
      await expect(
        prisma.season.create({
          data: { id: uuidv7(), name: 'Overlap', startsAt: new Date('2026-08-01T00:00:00Z'), endsAt: new Date('2026-11-01T00:00:00Z') },
        }),
      ).rejects.toThrow(/seasons_no_overlap/);
    });
  });
});
