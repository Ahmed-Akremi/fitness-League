/**
 * Competition demo data (§65): 1 competition, 6 categories, 4 WODs (100/100/150/200 pts; WOD 2 scored from reps per movement), 10 athletes,
 * 3 judges + 1 head judge, 3 prizes, 3 coupons (FREE2026, DISCOUNT10, DISCOUNT20), scores judged so the
 * leaderboard is populated. Runs the real API in-process (same rules as production), so the database only
 * needs the migrations + `pnpm seed`. Idempotent on the competition slug. `--publish` also publishes it.
 *
 *   DATABASE_URL=… pnpm demo-competition [--publish]
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/bootstrap';
import { uuidv7 } from '../src/common/ids/uuid';
import { PasswordService } from '../src/modules/auth/password.service';

const PASSWORD = 'demo-password-2026';
const SLUG = 'tunisia-functional-fitness-championship';

const athletes = [
  { u: 'ahmed_rx', name: 'Ahmed Ben Salah', g: 'MALE', dob: '1998-04-12', cat: 'RX Male', coupon: 'FREE2026', pts: [95, 90, 140, 175] },
  { u: 'ali_rx', name: 'Ali Mansour', g: 'MALE', dob: '1995-06-01', cat: 'RX Male', coupon: undefined, pts: [90, 100, 120, 160] },
  { u: 'mehdi_rx', name: 'Mehdi Karoui', g: 'MALE', dob: '1997-02-20', cat: 'RX Male', coupon: 'DISCOUNT10', pts: [85, 88, 135, 170] },
  { u: 'sara_rx', name: 'Sara Ayari', g: 'FEMALE', dob: '1999-01-20', cat: 'RX Female', coupon: undefined, pts: [92, 95, 130, 180] },
  { u: 'ines_rx', name: 'Ines Chaabane', g: 'FEMALE', dob: '1996-09-09', cat: 'RX Female', coupon: 'DISCOUNT20', pts: [88, 97, 128, 165] },
  { u: 'omar_int', name: 'Omar Haddad', g: 'MALE', dob: '2000-03-03', cat: 'Intermediate Male', coupon: undefined, pts: [80, 75, 110, 150] },
  { u: 'lina_int', name: 'Lina Feki', g: 'FEMALE', dob: '2001-07-14', cat: 'Intermediate Female', coupon: 'FREE2026', pts: [78, 82, 105, 140] },
  { u: 'youssef_sc', name: 'Youssef Riahi', g: 'MALE', dob: '1993-11-30', cat: 'Scaled Male', coupon: undefined, pts: [70, 72, 95, 120] },
  { u: 'amira_sc', name: 'Amira Sassi', g: 'FEMALE', dob: '1994-05-05', cat: 'Scaled Female', coupon: undefined, pts: [65, 70, 90, 115] },
  { u: 'hedi_sc', name: 'Hedi Bouazizi', g: 'MALE', dob: '1992-08-18', cat: 'Scaled Male', coupon: 'DISCOUNT10', pts: [72, 68, 98, 118] },
] as const;

const staff = [
  { u: 'organizer_demo', name: 'Event Organizer', role: 'ORGANIZER' },
  { u: 'judge_one', name: 'Judge One', role: 'JUDGE' },
  { u: 'judge_two', name: 'Judge Two', role: 'JUDGE' },
  { u: 'judge_three', name: 'Judge Three', role: 'JUDGE' },
  { u: 'head_judge', name: 'Head Judge', role: 'HEAD_JUDGE' },
] as const;

const categories = [
  { name: 'RX Male', gender: 'MALE', minAge: 18, maxAge: 35, registrationPriceOverride: 4000 },
  { name: 'RX Female', gender: 'FEMALE', minAge: 18, maxAge: 35, registrationPriceOverride: 4000 },
  { name: 'Intermediate Male', gender: 'MALE', minAge: 18, maxAge: 35 },
  { name: 'Intermediate Female', gender: 'FEMALE', minAge: 18, maxAge: 35 },
  { name: 'Scaled Male', gender: 'MALE', minAge: 18, maxAge: 45, registrationPriceOverride: 2500 },
  { name: 'Scaled Female', gender: 'FEMALE', minAge: 18, maxAge: 45, registrationPriceOverride: 2500 },
];

async function main() {
  const prisma = new PrismaClient();
  if (await prisma.competition.findUnique({ where: { slug: SLUG } })) {
    console.log(`Competition "${SLUG}" already exists: nothing to do.`);
    return prisma.$disconnect();
  }
  // This throw-away in-process API registers 15 demo accounts from one IP: the sign-up limit would stop it.
  process.env.RATE_LIMIT_ENABLED = 'false';
  const app: INestApplication = await createApp();
  await app.init();
  await app.listen(0);
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  const call = async <T>(method: string, path: string, token?: string, body?: unknown): Promise<T> => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  };

  try {
    const crossfit = (await prisma.sport.findUniqueOrThrow({ where: { code: 'CROSSFIT' } })).id;
    const gov = await prisma.governorate.findUniqueOrThrow({ where: { code: 'TN-11' }, include: { cities: { take: 1 } } });
    /** Registers (or reuses) a demo account, verifies it, sets gender/role, and returns a fresh token. */
    const account = async (username: string, fullName: string, extra: { gender?: string; dob?: string; role?: 'GYM_ADMIN' } = {}) => {
      const email = `${username}@demo.fitnessleague.test`;
      const created = !(await prisma.user.findUnique({ where: { email } }));
      if (created) {
        await call('POST', '/auth/register', undefined, {
          username,
          fullName,
          email,
          password: PASSWORD,
          dateOfBirth: extra.dob ?? '1990-01-01',
          countryCode: 'TN',
          governorateId: gov.id,
          cityId: gov.cities[0].id,
          consents: { terms: true, privacy: true, healthData: false, documentVersion: '2026-09' },
        });
      }
      const user = await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date(), ...(extra.role ? { role: extra.role } : {}) } });
      if (extra.gender) await prisma.profile.update({ where: { userId: user.id }, data: { gender: extra.gender as 'MALE' | 'FEMALE' } });
      const s = await call<{ accessToken: string }>('POST', '/auth/login', undefined, { email, password: PASSWORD });
      // Onboarded like the app's demo athletes, so signing in opens the app instead of the onboarding flow.
      if (created) {
        await call('POST', '/me/onboarding/sports', s.accessToken, { sportIds: [crossfit], primarySportId: crossfit });
        await call('POST', '/me/onboarding/complete', s.accessToken);
      }
      return { id: user.id, token: s.accessToken };
    };
    /** Judge-only account (admin panel, no app): created as an admin would, signed in to the admin panel. */
    const judgeAccount = async (username: string, role: 'JUDGE' | 'HEAD_JUDGE') => {
      const email = `${username}@demo.fitnessleague.test`;
      const passwordHash = await app.get(PasswordService).hash(PASSWORD);
      await prisma.user.upsert({
        where: { email },
        create: { id: uuidv7(), email, username, role, passwordHash, emailVerifiedAt: new Date(), dateOfBirth: new Date('1970-01-01') },
        update: { role },
      });
      const s = await call<{ session: { accessToken: string; userId: string } }>('POST', '/admin/auth/login', undefined, { email, password: PASSWORD });
      return { id: s.session.userId, token: s.session.accessToken };
    };

    const people: Record<string, { id: string; token: string }> = {};
    for (const s of staff) people[s.u] = s.role === 'ORGANIZER' ? await account(s.u, s.name, { role: 'GYM_ADMIN' }) : await judgeAccount(s.u, s.role);
    for (const a of athletes) people[a.u] = await account(a.u, a.name, { gender: a.g, dob: a.dob });
    const org = people.organizer_demo.token;
    const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

    const c = await call<{ id: string }>('POST', '/competitions', org, {
      title: 'Tunisia Functional Fitness Championship',
      slug: SLUG,
      description: 'Online qualifier: four WODs, judged on video. Total = WOD 1 + WOD 2 + WOD 3 + WOD 4 (550 pts max).',
      format: 'ONLINE',
      location: 'Online · Final in Tunis',
      city: 'Tunis',
      registrationStart: h(-2),
      registrationEnd: h(24 * 7),
      eventStart: h(24 * 10),
      eventEnd: h(24 * 12),
      registrationPrice: 3500,
      currency: 'EUR',
      tieBreakRules: [{ type: 'LAST_WOD' }, { type: 'MOST_WOD_WINS' }],
    });
    const cid = c.id;
    const catIds: Record<string, string> = {};
    for (const cat of categories) catIds[cat.name] = (await call<{ id: string }>('POST', `/competitions/${cid}/categories`, org, cat)).id;
    const wodIds: string[] = [];
    for (const [i, max] of [100, 100, 150, 200].entries()) {
      const w = await call<{ id: string }>('POST', `/competitions/${cid}/wods`, org, {
        number: i + 1,
        name: `WOD ${i + 1}`,
        description: ['21-15-9 thrusters / pull-ups', '12 min AMRAP: 10 burpees, 15 wall balls', '1RM clean & jerk', '2 km row + 50 cal bike'][i],
        // WOD 2 is scored by the app from the reps of each movement (burpee 1 pt, wall ball 0.5 pt).
        ...(i === 1 ? { scoreType: 'MOVEMENT_REPS', movements: [{ name: 'Burpees', pointsPerRep: 1 }, { name: 'Wall balls', pointsPerRep: 0.5 }] } : { scoreType: 'POINTS' }),
        scoringMethod: 'DIRECT_POINTS',
        maximumPoints: max,
        submissionStart: h(-1),
        submissionDeadline: h(24 * 9),
      });
      wodIds.push(w.id);
    }
    for (const [position, amount, type] of [
      [1, 100000, 'CASH'],
      [2, 50000, 'CASH'],
      [3, 25000, 'CASH'],
    ] as const) {
      await call('POST', `/competitions/${cid}/prizes`, org, { position, type, amount, description: `${position === 1 ? '1st' : position === 2 ? '2nd' : '3rd'} place + medal` });
    }
    await call('POST', `/competitions/${cid}/coupons`, org, { code: 'FREE2026', type: 'FREE', maxUses: 10 });
    await call('POST', `/competitions/${cid}/coupons`, org, { code: 'DISCOUNT10', type: 'PERCENTAGE', value: 10 });
    await call('POST', `/competitions/${cid}/coupons`, org, { code: 'DISCOUNT20', type: 'PERCENTAGE', value: 20 });
    for (const s of staff.filter((x) => x.role !== 'ORGANIZER')) await call('POST', `/competitions/${cid}/staff`, org, { userId: people[s.u].id, role: s.role });

    await call('PATCH', `/competitions/${cid}/status`, org, { status: 'REGISTRATION_OPEN' });
    for (const a of athletes) {
      const r = await call<{ id: string; paymentStatus: string }>('POST', `/competitions/${cid}/register`, people[a.u].token, { categoryId: catIds[a.cat], ...(a.coupon ? { couponCode: a.coupon } : {}) });
      if (r.paymentStatus === 'PENDING') await call('POST', `/competitions/${cid}/registrations/${r.id}/mark-paid`, org);
    }
    await call('PATCH', `/competitions/${cid}/status`, org, { status: 'REGISTRATION_CLOSED' });
    await call('PATCH', `/competitions/${cid}/status`, org, { status: 'SUBMISSION_OPEN' });

    const judges = ['judge_one', 'judge_two', 'judge_three'];
    let k = 0;
    for (const a of athletes) {
      for (const [i, wodId] of wodIds.entries()) {
        const s = await call<{ id: string }>('POST', `/competitions/${cid}/wods/${wodId}/submissions`, people[a.u].token, {
          clientId: randomUUID(),
          raw: i === 1 ? { movementReps: [a.pts[i] - 30, 60] } : { value: a.pts[i] }, // 60 wall balls = 30 pts, the rest in burpees
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        });
        // Most scores approved; one penalty and one left pending to show both states.
        const judge = people[judges[k++ % judges.length]].token;
        if (a.u === 'mehdi_rx' && i === 3) await call('POST', `/admin/judge/submissions/${s.id}/penalty`, judge, { type: 'NO_REP', points: 10, reason: 'Two no-reps on the bike' });
        else if (!(a.u === 'hedi_sc' && i === 3)) await call('POST', `/admin/judge/submissions/${s.id}/approve`, judge);
      }
    }
    if (process.argv.includes('--publish')) {
      await call('POST', `/admin/judge/submissions/${(await prisma.competitionSubmission.findFirstOrThrow({ where: { user: { username: 'hedi_sc' }, workoutId: wodIds[3] } })).id}/approve`, people.judge_one.token);
      await call('PATCH', `/competitions/${cid}/status`, org, { status: 'JUDGING' });
      await call('PATCH', `/competitions/${cid}/status`, org, { status: 'PROVISIONAL_LEADERBOARD' });
      await call('POST', `/admin/judge/competitions/${cid}/publish-leaderboard`, people.head_judge.token);
    }
    const board = await call<{ rows: { rank: number; athlete: { fullName: string }; totalPoints: number }[] }>('GET', `/competitions/${cid}/leaderboard?categoryId=${catIds['RX Male']}`, org);
    console.log(`Competition ${cid} created (${process.argv.includes('--publish') ? 'final' : 'provisional'} leaderboard). RX Male:`);
    for (const r of board.rows) console.log(`  #${r.rank} ${r.athlete.fullName} — ${r.totalPoints} pts`);
    console.log(`Accounts: <username>@demo.fitnessleague.test / ${PASSWORD} (app: organizer_demo, ahmed_rx…; admin panel: judge_one…three, head_judge)`);
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
