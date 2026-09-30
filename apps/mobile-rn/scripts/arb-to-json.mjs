// Copies the Flutter app's ARB translations into src/core/i18n/*.json (messages only, ICU syntax kept).
// Run with `pnpm i18n` whenever apps/mobile/lib/core/l10n/*.arb change.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const locale of ['en', 'fr', 'ar']) {
  const arb = JSON.parse(readFileSync(join(root, `../mobile/lib/core/l10n/app_${locale}.arb`), 'utf8'));
  const messages = Object.fromEntries(Object.entries(arb).filter(([k]) => !k.startsWith('@')));
  writeFileSync(join(root, `src/core/i18n/${locale}.json`), JSON.stringify(messages, null, 2) + '\n');
  console.log(`${locale}: ${Object.keys(messages).length} messages`);
}
