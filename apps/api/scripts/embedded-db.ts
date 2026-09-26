/**
 * Starts a throw-away PostgreSQL 16 without Docker (embedded-postgres binaries).
 * Used by integration tests and as a Docker-free fallback for local dev: `pnpm db:embedded`.
 * The data directory must live on a Linux filesystem (Postgres refuses group/world-readable dirs, e.g. /mnt/c on WSL).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface EmbeddedDb {
  url: string;
  stop: () => Promise<void>;
}

export async function startEmbeddedDb(port: number, database = 'fitness_league'): Promise<EmbeddedDb> {
  const dataDir = mkdtempSync(join(tmpdir(), 'fl-pg-'));
  // embedded-postgres is ESM-only; a dynamic import keeps this file usable from CommonJS (Nest, Jest).
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'fl',
    password: 'fl',
    port,
    persistent: false,
    onLog: () => undefined,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(database);
  return {
    url: `postgresql://fl:fl@localhost:${port}/${database}?schema=public`,
    stop: () => pg.stop(),
  };
}

if (require.main === module) {
  const port = Number(process.env.EMBEDDED_PG_PORT ?? 55432);
  startEmbeddedDb(port).then((db) => {
    console.log(`Embedded Postgres ready: ${db.url}`);
    const shutdown = () => void db.stop().then(() => process.exit(0));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
