/**
 * Local demo data, so the app and the admin panel show something real. NEVER run against production.
 * Usage (API running on :3000, same DATABASE_URL): pnpm demo-data
 *
 * Everything goes through the public API (register, onboarding, workouts, friends, battles, goals), except the
 * steps a demo cannot wait for: email verification, end of calibration, gym approval and past-season LP, which
 * are written directly and, for LP, as explicit ADMIN_ADJUSTMENT ledger entries labelled "demo".
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { uuidv7 } from '../src/common/ids/uuid';
import { demoGyms } from './demo-gyms';

const API = process.env.DEMO_API_URL ?? 'http://localhost:3000/api/v1';
export const DEMO_PASSWORD = 'demo-password-2026';

async function call<T>(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

const athletes = [
  { username: 'ahmed', fullName: 'Ahmed Ben Salah', gov: 'TN-51', planned: 3, lp: 1240, squat: [100, 102.5, 105] },
  { username: 'yassine', fullName: 'Yassine Trabelsi', gov: 'TN-51', planned: 4, lp: 1180, squat: [140, 142.5, 145] },
  { username: 'nour', fullName: 'Nour Hammami', gov: 'TN-11', planned: 3, lp: 960, squat: [60, 62.5, 65] },
  { username: 'sami', fullName: 'Sami Jlassi', gov: 'TN-61', planned: 3, lp: 610, squat: [80, 80, 82.5] },
  { username: 'karim', fullName: 'Karim Gharbi', gov: 'TN-52', planned: 5, lp: 1520, squat: [200, 200, 202.5] },
];

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const prisma = new PrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { username: 'ahmed' } })) {
      console.log('Demo users already present.');
      await demoGyms(prisma, API, call, DEMO_PASSWORD);
      return;
    }
    const sports = await call<{ id: string; code: string }[]>('GET', '/ref/sports');
    const powerlifting = sports.find((s) => s.code === 'POWERLIFTING')!.id;
    const squat = await prisma.exercise.findUniqueOrThrow({ where: { code: 'BACK_SQUAT' } });
    const bench = await prisma.exercise.findUniqueOrThrow({ where: { code: 'BENCH_PRESS' } });
    const season = await prisma.season.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: 'sahel-iron-club' } });
    const tokens: Record<string, { token: string; id: string }> = {};

    for (const a of athletes) {
      const gov = await prisma.governorate.findUniqueOrThrow({ where: { code: a.gov }, include: { cities: { orderBy: { code: 'asc' } } } });
      const s = await call<{ accessToken: string; userId: string }>('POST', '/auth/register', undefined, {
        username: a.username,
        fullName: a.fullName,
        email: `${a.username}@demo.fitnessleague.test`,
        password: DEMO_PASSWORD,
        dateOfBirth: '1998-04-12',
        countryCode: 'TN',
        governorateId: gov.id,
        cityId: gov.cities[0]!.id,
        consents: { terms: true, privacy: true, healthData: true, documentVersion: '2026-09' },
      });
      tokens[a.username] = { token: s.accessToken, id: s.userId };
      await call('POST', '/me/onboarding/sports', s.accessToken, { sportIds: [powerlifting], primarySportId: powerlifting });
      await call('PATCH', '/me/profile', s.accessToken, { plannedTrainingDaysPerWeek: a.planned });
      await call('POST', '/me/onboarding/complete', s.accessToken);
      // Demo shortcuts: verified email and a finished calibration period.
      await prisma.user.update({ where: { id: s.userId }, data: { emailVerifiedAt: new Date() } });
      await prisma.profile.update({ where: { userId: s.userId }, data: { calibrationEndsAt: new Date(Date.now() - 30 * 86_400_000) } });

      // Three sessions over the last 60 hours (inside the 72 h on-time window, so they score).
      for (const [i, kg] of a.squat.entries()) {
        const body = {
          clientId: randomUUID(),
          sportId: powerlifting,
          workoutType: 'STRENGTH',
          performedAt: new Date(Date.now() - (60 - i * 24) * 3_600_000).toISOString(),
          durationS: 3600 + i * 600,
          exercises: [
            { exerciseId: squat.id, sets: [{ reps: 5, weightKg: Math.round(kg * 0.6 * 2) / 2, isWarmup: true }, { reps: 5, weightKg: kg }, { reps: 3, weightKg: kg }] },
            { exerciseId: bench.id, sets: [{ reps: 5, weightKg: Math.round(kg * 0.7 * 2) / 2 }] },
          ],
        };
        await call('POST', '/workouts', s.accessToken, body, { 'Idempotency-Key': body.clientId });
      }

      // Season standing for the leaderboards (explicit, audited demo adjustment).
      await prisma.$transaction(async (tx) => {
        await tx.leaguePointTransaction.create({
          data: { id: uuidv7(), userId: s.userId, seasonId: season.id, amount: a.lp, reason: 'ADMIN_ADJUSTMENT', sourceType: 'demo', sourceId: s.userId, ruleSetVersion: 1, explanation: { formula: 'demo_data', note: 'Local demo only' }, effectiveAt: new Date() },
        });
        const division = await tx.division.findFirst({ where: { minLp: { lte: a.lp } }, orderBy: { minLp: 'desc' } });
        await tx.userStats.update({ where: { userId: s.userId }, data: { seasonLp: a.lp, currentSeasonId: season.id, divisionId: division?.id } });
      });
    }

    // Ahmed and Yassine train at the same verified gym.
    for (const u of ['ahmed', 'yassine']) {
      await prisma.gymMember.create({ data: { id: uuidv7(), gymId: gym.id, userId: tokens[u]!.id, status: 'APPROVED', approvedAt: new Date() } });
      await prisma.profile.update({ where: { userId: tokens[u]!.id }, data: { primaryGymId: gym.id } });
    }

    // Friends, an active Friend Battle, a pending friend request and a goal.
    const ahmed = tokens.ahmed!;
    for (const f of ['yassine', 'nour']) {
      await call('POST', '/friends/requests', ahmed.token, { userId: tokens[f]!.id });
      await call('POST', `/friends/requests/${ahmed.id}/accept`, tokens[f]!.token);
    }
    await call('POST', '/friends/requests', tokens.sami!.token, { userId: ahmed.id });
    const battle = await call<{ id: string }>('POST', '/battles', ahmed.token, { opponentId: tokens.yassine!.id, durationDays: 7 });
    await call('POST', `/battles/${battle.id}/accept`, tokens.yassine!.token);

    // Give the worker a moment to score the workouts before suggesting goals.
    await new Promise((r) => setTimeout(r, 4000));
    await call('POST', '/goals', ahmed.token, { type: 'STRENGTH', exerciseId: squat.id, metricCode: 'E1RM', targetValue: 130, wasSuggested: true });
    await call('POST', '/goals', ahmed.token, { type: 'HABIT', metricCode: 'WORKOUTS_PER_WEEK', targetValue: 3 });

    // Staff account for the admin panel (TOTP is enrolled at first sign-in).
    const admin = await call<{ userId: string }>('POST', '/auth/register', undefined, {
      username: 'admin',
      fullName: 'Admin Demo',
      email: 'admin@demo.fitnessleague.test',
      password: DEMO_PASSWORD,
      dateOfBirth: '1990-01-01',
      countryCode: 'TN',
      governorateId: (await prisma.governorate.findUniqueOrThrow({ where: { code: 'TN-11' } })).id,
      cityId: (await prisma.city.findFirstOrThrow({ where: { governorate: { code: 'TN-11' } } })).id,
      consents: { terms: true, privacy: true, healthData: false, documentVersion: '2026-09' },
    });
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'SUPER_ADMIN', emailVerifiedAt: new Date() } });

    await demoGyms(prisma, API, call, DEMO_PASSWORD);
    console.log(`Demo ready. Athletes: ${athletes.map((a) => `${a.username}@demo.fitnessleague.test`).join(', ')}`);
    console.log(`Admin: admin@demo.fitnessleague.test — password for all: ${DEMO_PASSWORD}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
