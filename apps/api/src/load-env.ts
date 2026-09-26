import { existsSync } from 'node:fs';

// Local runs read apps/api/.env (same file the Prisma CLI uses). Variables already set in the
// environment win, so containers and CI are unaffected.
if (existsSync('.env')) process.loadEnvFile('.env');
