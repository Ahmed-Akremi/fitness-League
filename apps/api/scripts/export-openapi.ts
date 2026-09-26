/** Writes openapi.json (used by CI to generate/verify the mobile and admin clients). */
import { writeFileSync } from 'node:fs';
import { buildOpenApi, createApp } from '../src/bootstrap';

async function main(): Promise<void> {
  const app = await createApp();
  const doc = buildOpenApi(app);
  writeFileSync(process.argv[2] ?? 'openapi.json', JSON.stringify(doc, null, 2) + '\n');
  await app.close();
}

void main();
