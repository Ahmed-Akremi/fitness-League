import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { InMemoryMailSender, MailSender } from '../src/common/mail/mail-sender';
import { TokenService } from '../src/modules/auth/token.service';
import { seed } from '../src/database/seed';

export const TODAY = new Date('2026-09-25T10:00:00Z');

/**
 * Every test file gets its own database, cloned from the migrated template built by global-setup
 * (CREATE DATABASE … TEMPLATE is a fast file copy). Files can then move clocks, close seasons and run jobs
 * without affecting each other.
 */
async function isolatedDatabaseUrl(): Promise<string> {
  const templateUrl = new URL(process.env.TEMPLATE_DATABASE_URL!);
  const template = templateUrl.pathname.slice(1);
  const name = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const adminUrl = new URL(templateUrl);
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
  } finally {
    await admin.$disconnect();
  }
  const url = new URL(templateUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function setupTestApp(env: Record<string, string> = {}): Promise<{ app: INestApplication; prisma: PrismaClient; mail: InMemoryMailSender }> {
  // One database per test file (several apps in the same file share it).
  if (!process.env.FILE_DATABASE_URL) process.env.FILE_DATABASE_URL = await isolatedDatabaseUrl();
  process.env.DATABASE_URL = process.env.FILE_DATABASE_URL;
  const previous = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const prisma = new PrismaClient();
  await seed(prisma, TODAY);
  const app = await createApp();
  await app.init();
  for (const [k, v] of Object.entries(previous)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return { app, prisma, mail: app.get(MailSender) as InMemoryMailSender };
}

/** Admin-panel access token for an existing user (the real flow adds password + TOTP, tested in admin.int-spec). */
export async function adminBearer(app: INestApplication, prisma: PrismaClient, userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { token } = await app.get(TokenService).signAccess({ sub: u.id, role: u.role, sv: u.sessionVersion }, 'admin');
  return { authorization: `Bearer ${token}` };
}

let counter = 0;

/** A valid registration body for a unique user in Sousse. */
export async function registrationBody(prisma: PrismaClient, overrides: Record<string, unknown> = {}) {
  const gov = await prisma.governorate.findUniqueOrThrow({ where: { code: 'TN-51' }, include: { cities: { orderBy: { code: 'asc' } } } });
  const n = `${Date.now().toString(36)}${(counter++).toString(36)}`;
  return {
    username: `user_${n}`.slice(0, 20),
    fullName: 'Test Athlete',
    email: `athlete.${n}@example.test`,
    password: 'correct horse battery',
    dateOfBirth: '1998-04-12',
    countryCode: 'TN',
    governorateId: gov.id,
    cityId: gov.cities[0]!.id,
    consents: { terms: true, privacy: true, healthData: false, documentVersion: '2026-09' },
    ...overrides,
  };
}

export async function registerUser(app: INestApplication, prisma: PrismaClient, overrides: Record<string, unknown> = {}) {
  const body = await registrationBody(prisma, overrides);
  const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send(body).expect(201);
  return { body, session: res.body as { accessToken: string; refreshToken: string; userId: string } };
}

/** Extracts the token from the last link mailed to `to`. */
export function lastMailToken(mail: InMemoryMailSender, to: string, tag: string): string {
  const msg = [...mail.outbox].reverse().find((m) => m.to === to && m.tag === tag);
  if (!msg) throw new Error(`No ${tag} mail for ${to}`);
  const match = /token=([A-Za-z0-9_-]+)/.exec(msg.text);
  if (!match) throw new Error('No token in mail');
  return match[1]!;
}
