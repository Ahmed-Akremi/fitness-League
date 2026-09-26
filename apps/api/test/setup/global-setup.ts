import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { join } from 'node:path';
import { startEmbeddedDb } from '../../scripts/embedded-db';

/**
 * Integration tests run against a real PostgreSQL 16 with all migrations applied.
 * Uses TEST_DATABASE_URL when given (a fresh, empty CI service container), otherwise a new embedded Postgres.
 * Only `migrate deploy` is used: tests must never be able to wipe a database.
 */
export default async function globalSetup(): Promise<void> {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const db = await startEmbeddedDb(40000 + Math.floor(Math.random() * 10000), 'fl_test');
    (globalThis as { __EMBEDDED_DB__?: { stop: () => Promise<void> } }).__EMBEDDED_DB__ = db;
    url = db.url;
  }
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.CURSOR_HMAC_SECRET = 'integration-test-secret-integration-test';
  process.env.RATE_LIMIT_ENABLED = 'false'; // enabled explicitly by the rate-limit tests
  process.env.SMTP_URL = '';
  process.env.HEALTH_DATA_KEYS = `t1:${Buffer.alloc(32, 7).toString('base64')}`;
  process.env.GOOGLE_CLIENT_IDS = 'google-test-client';
  process.env.APPLE_CLIENT_IDS = 'app.fitnessleague.test'; // in-memory mail outbox, inspected by tests
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  process.env.JWT_PRIVATE_KEY_B64 = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64');
  process.env.JWT_PUBLIC_KEY_B64 = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }).toString()).toString('base64');

  const prismaBin = join(__dirname, '../../node_modules/.bin/prisma');
  execFileSync(prismaBin, ['migrate', 'deploy'], {
    cwd: join(__dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
}
