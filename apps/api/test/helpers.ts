import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { InMemoryMailSender, MailSender } from '../src/common/mail/mail-sender';
import { seed } from '../src/database/seed';

export const TODAY = new Date('2026-09-25T10:00:00Z');

export async function setupTestApp(env: Record<string, string> = {}): Promise<{ app: INestApplication; prisma: PrismaClient; mail: InMemoryMailSender }> {
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
