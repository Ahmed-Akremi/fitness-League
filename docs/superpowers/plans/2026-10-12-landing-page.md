# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-page marketing site for Fitness League in `apps/landing` (EN/FR/AR), with real app screenshots, licensed photos and the tutorial video, whose buttons email the team.

**Architecture:** A Vite + React single page with no router. All text lives in three typed content files (`en.ts` defines the `Copy` type, `fr.ts` and `ar.ts` must match it). Small pure modules decide the language (`content/lang.ts`) and build links (`links.ts`). Section components only render content, and one `Audience` component serves the athletes, gyms and organizers sections. Media are converted once with `sharp`, and only the outputs are committed under `public/media`.

**Tech Stack:** React 19, Vite 7, TypeScript 5.8, Vitest 5 + Testing Library + jsdom, `@fontsource` (Barlow Condensed, Inter, Cairo), `sharp` (one-time media conversion, already in `apps/api`), `playwright-core` (visual check, cached copy).

**Spec:** `docs/superpowers/specs/2026-10-12-landing-page-design.md`

## Global Constraints

- Workspace: pnpm 10.34.5, Node ≥ 22; package `@fitness-league/landing` in `apps/landing`.
- Versions copied from `apps/admin/package.json`: `react` / `react-dom` `^19.3.0`, `vite` `^7.3.6`, `@vitejs/plugin-react` `^5.2.0`, `vitest` `^5.0.2`, `typescript` `~5.8.3`, `jsdom` `^30.1.1`, `@testing-library/react` `^16.3.3`, `@testing-library/jest-dom` `^7.0.1`, `@testing-library/user-event` `^14.6.7`, `@types/react` / `@types/react-dom` `^19.3.0`.
- Dev server port **5174** (5173 is the admin panel); preview port **4174**.
- Contact email **`ahmedakremi42@gmail.com`**. WhatsApp number empty → WhatsApp button hidden. Store links empty → "Coming soon" badge.
- Email subjects, translated per page language: "Athlete – join Fitness League", "Gym – register", "Organizer – host an event", "Contact".
- Languages `en`, `fr`, `ar`; `ar` is laid out right to left. Choice order: `?lang=` → stored choice → browser languages → `en`.
- Never in the page: any circle21.app asset; the Alamy previews (`apps/mobile-rn/assets/competition-cover.jpg`, `Desktop/fitness/fitness-league-registration-banner.png`, `Desktop/fitness/seville-…-2sbxdbb.jpg`); screenshots that show the default banner (`10-competition.png`, `11-competition-scrolled.png`, `Desktop/accueil-actualites/home-0…2.png`); screenshots with broken emoji (`home-3.png`, `home-4.png`, `home-liked.png`).
- The page claims only what the app does today: no online payment, no push notifications, no prices, no specific event.
- Code style of the repo: single quotes, 2-space indent, semicolons, long lines allowed. **Do not run Prettier** (the repo has no config; it reformats everything).
- Git: branch `feat/landing`. Stage only the files a task names. These files show as modified only because of line endings and must never be staged: `.github/workflows/ci.yml` (until Task 1 edits it on purpose; then stage only after checking `git diff --ignore-cr-at-eol` shows just the new job), `.gitignore`, `README.md` (same rule as ci.yml in Task 1), `apps/mobile-rn/package-lock.json`, `docs/superpowers/plans/2026-10-06-rust-backend-1a-foundation.md`, `docs/superpowers/plans/2026-10-07-rust-backend-1b-accounts.md`, `docs/superpowers/specs/2026-10-06-rust-backend-foundation-design.md`, `handoff.md` (until Task 9), `infra/docker-compose.yml`, `infra/mariadb/init/01-accounts.sql`. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Hooks: `git checkout -- <file>` is blocked by GateGuard; restore with `git show HEAD:<path> > <path>`.

## Review Focus

1. **Language given in an unexpected form** (`?lang=FR`, `?lang=fr-TN`, `?lang=klingon`, a stored value from an old version, or storage that throws in private mode). Expected: it is normalised or ignored and the page always opens in a real language. → Task 2 tests (`toLang` cases, throwing storage).
2. **Latin fragments on the Arabic page** (email address, "Fitness League", photographer names). Expected: they read left to right instead of being scrambled by the right-to-left layout. → Task 7 test (email inside `<bdi dir="ltr">`).
3. **Browser without `IntersectionObserver`, or visitor asking for reduced motion.** Expected: every section is visible at once, and nothing waits for an animation that never comes. → Task 6 tests (`Reveal`).
4. **Phone menu**: the visitor taps a link or presses Escape. Expected: the menu closes and `aria-expanded` follows. → Task 7 test.
5. **Video that cannot play** (old browser, blocked codec), and visitors on mobile data. Expected: nothing downloads before play (`preload="none"`), and a text with a download link replaces the player when it cannot play. → Task 7 test.

Also checked visually (Task 8): no horizontal scroll at 320 px, 390 px and 1440 px, in English and Arabic.

---

### Task 1: Scaffold `apps/landing`, CI job, README

**Files:**
- Create: `apps/landing/package.json`, `apps/landing/tsconfig.json`, `apps/landing/vite.config.ts`, `apps/landing/index.html`, `apps/landing/src/main.tsx`, `apps/landing/src/App.tsx`, `apps/landing/src/styles.css`, `apps/landing/src/test-setup.ts`
- Test: `apps/landing/src/App.test.tsx`
- Modify: `.github/workflows/ci.yml` (new `landing` job after `admin`), `README.md` (layout + run section), `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**
- Produces: `export function App(): JSX.Element` in `src/App.tsx` (rewritten in Task 7); scripts `dev`, `build`, `preview`, `typecheck`, `lint`, `test`.

- [ ] **Step 1: Create the package files**

`apps/landing/package.json`:
```json
{
  "name": "@fitness-league/landing",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "lint": "tsc -b --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@fontsource/barlow-condensed": "^5.3.0",
    "@fontsource/cairo": "^5.3.0",
    "@fontsource/inter": "^5.3.0",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.7",
    "@types/node": "^22.20.4",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^5.2.0",
    "jsdom": "^30.1.1",
    "typescript": "~5.8.3",
    "vite": "^7.3.6",
    "vitest": "^5.0.2"
  }
}
```

`apps/landing/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom", "node"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/landing/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // 5173 is the admin panel.
  server: { port: 5174 },
  preview: { port: 4174 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

`apps/landing/index.html`:
```html
<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0E0F12" />
    <title>Fitness League — Climb the League</title>
    <meta name="description" content="Fitness League turns training into a fair game: earn League Points for progress, consistency and verified effort, represent your gym and enter online competitions judged on video." />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Fitness League — Climb the League" />
    <meta property="og:description" content="Earn League Points for progress, consistency and verified effort. Represent your gym. Compete online, judged on video." />
    <meta property="og:image" content="/media/og.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" type="image/png" href="/favicon.png" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/landing/src/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

`apps/landing/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/landing/src/styles.css` (replaced in full by Task 8):
```css
body {
  margin: 0;
  background: #0e0f12;
  color: #e6e8ec;
  font-family: system-ui, sans-serif;
}
```

- [ ] **Step 2: Write the failing smoke test**

`apps/landing/src/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';

it('renders the page title', () => {
  render(<App />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Fitness League');
});
```

- [ ] **Step 3: Install and run the test to see it fail**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league && pnpm install`, then `cd apps/landing && pnpm test`
Expected: FAIL, "Failed to resolve import "./App"" (the file does not exist yet).

- [ ] **Step 4: Write the minimal App**

`apps/landing/src/App.tsx`:
```tsx
export function App() {
  return (
    <main>
      <h1>Fitness League</h1>
    </main>
  );
}
```

- [ ] **Step 5: Run the checks**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/landing && pnpm test && pnpm typecheck && pnpm build`
Expected: 1 test passes; typecheck clean; `dist/index.html` produced.

Check that the build output is ignored: `git -C /mnt/c/Users/GIGABYTE/fitness-league check-ignore -v apps/landing/dist apps/landing/node_modules` prints a rule for both. If one is not ignored, add `apps/landing/dist/` to the root `.gitignore` with the Edit tool and stage `.gitignore` in Step 7 only after `git diff --ignore-cr-at-eol .gitignore` shows that single line.

- [ ] **Step 6: Add the CI job and the README section**

In `.github/workflows/ci.yml`, insert after the `admin` job (same shape):
```yaml
  landing:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/landing
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
        working-directory: .
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

In `README.md`, add to the "Repository layout" block, after the `apps/admin` line:
```
apps/landing   Marketing site (Vite + React, EN/FR/AR), static build
```
and add this section after "Run it locally":
````markdown
## Landing page

```bash
pnpm --filter @fitness-league/landing dev       # http://localhost:5174
pnpm --filter @fitness-league/landing build     # static site in apps/landing/dist
```

Contact address, WhatsApp number and store links: `apps/landing/src/config.ts`. Photo credits: `apps/landing/CREDITS.md`.
````

Both files currently show line-ending-only changes: edit them with the Edit tool, then check that `git diff --ignore-cr-at-eol --stat .github/workflows/ci.yml README.md` reports only the added lines. If the working copies have CRLF endings, first restore the committed bytes with `git show HEAD:.github/workflows/ci.yml > .github/workflows/ci.yml` and `git show HEAD:README.md > README.md`, then apply the edits.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/landing/package.json apps/landing/tsconfig.json apps/landing/vite.config.ts apps/landing/index.html apps/landing/src pnpm-lock.yaml .github/workflows/ci.yml README.md
git commit -m "feat(landing): Vite + React app skeleton, CI job and README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Language rules

**Files:**
- Create: `apps/landing/src/content/lang.ts`
- Test: `apps/landing/src/content/lang.test.ts`

**Interfaces:**
- Produces:
  - `LANGS: readonly ['en', 'fr', 'ar']`, `type Lang = 'en' | 'fr' | 'ar'`
  - `STORAGE_KEY = 'fl-landing-lang'`
  - `toLang(value: string | null | undefined): Lang | null`
  - `interface LangSources { search: string; stored: string | null; browser: readonly string[] }`
  - `resolveLang(sources: LangSources): Lang`
  - `readStoredLang(): string | null`, `storeLang(lang: Lang): void`
  - `dirOf(lang: Lang): 'rtl' | 'ltr'`

- [ ] **Step 1: Write the failing tests**

`apps/landing/src/content/lang.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dirOf, readStoredLang, resolveLang, STORAGE_KEY, storeLang, toLang } from './lang';

describe('toLang', () => {
  it.each([
    ['fr', 'fr'],
    ['FR', 'fr'],
    ['fr-TN', 'fr'],
    ['ar_TN', 'ar'],
    [' en ', 'en'],
  ])('reads %j as %s', (input, lang) => {
    expect(toLang(input)).toBe(lang);
  });

  it.each([['de'], [''], [null], [undefined], ['english'], ['-fr']])('rejects %j', (input) => {
    expect(toLang(input)).toBeNull();
  });
});

describe('resolveLang', () => {
  it('prefers the language in the address', () => {
    expect(resolveLang({ search: '?lang=ar', stored: 'fr', browser: ['en-US'] })).toBe('ar');
  });

  it('then the stored choice', () => {
    expect(resolveLang({ search: '', stored: 'fr', browser: ['ar'] })).toBe('fr');
  });

  it('then the first browser language the page has', () => {
    expect(resolveLang({ search: '', stored: null, browser: ['de-DE', 'ar-TN', 'fr'] })).toBe('ar');
  });

  it('skips an unknown address value and keeps looking', () => {
    expect(resolveLang({ search: '?lang=klingon', stored: 'fr', browser: [] })).toBe('fr');
  });

  it('falls back to English', () => {
    expect(resolveLang({ search: '?lang=de', stored: 'xx', browser: ['de', 'it'] })).toBe('en');
  });
});

describe('stored choice', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('round-trips through localStorage', () => {
    storeLang('ar');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('ar');
    expect(readStoredLang()).toBe('ar');
  });

  it('survives a storage that throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(readStoredLang()).toBeNull();
    expect(() => storeLang('fr')).not.toThrow();
  });
});

it('lays Arabic out right to left and the others left to right', () => {
  expect(dirOf('ar')).toBe('rtl');
  expect(dirOf('fr')).toBe('ltr');
  expect(dirOf('en')).toBe('ltr');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/landing && pnpm vitest run src/content/lang.test.ts`
Expected: FAIL, "Failed to resolve import "./lang"".

- [ ] **Step 3: Implement**

`apps/landing/src/content/lang.ts`:
```ts
export const LANGS = ['en', 'fr', 'ar'] as const;
export type Lang = (typeof LANGS)[number];

export const STORAGE_KEY = 'fl-landing-lang';

/** 'FR', 'fr-TN', 'fr_TN' and ' fr ' all mean French; anything else is not a language of the page. */
export function toLang(value: string | null | undefined): Lang | null {
  const base = (value ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return (LANGS as readonly string[]).includes(base) ? (base as Lang) : null;
}

export interface LangSources {
  /** `location.search`, e.g. `?lang=fr`. */
  search: string;
  /** The visitor's last choice, or null. */
  stored: string | null;
  /** `navigator.languages`, most preferred first. */
  browser: readonly string[];
}

/** The address wins, then the visitor's last choice, then the browser, then English. */
export function resolveLang({ search, stored, browser }: LangSources): Lang {
  return (
    toLang(new URLSearchParams(search).get('lang')) ??
    toLang(stored) ??
    browser.map(toLang).find((lang): lang is Lang => lang !== null) ??
    'en'
  );
}

export function readStoredLang(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeLang(lang: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Storage blocked (private mode): the choice lasts until the page is closed.
  }
}

export const dirOf = (lang: Lang): 'rtl' | 'ltr' => (lang === 'ar' ? 'rtl' : 'ltr');
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run src/content/lang.test.ts && pnpm typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/landing/src/content/lang.ts apps/landing/src/content/lang.test.ts
git commit -m "feat(landing): language from the address, the stored choice or the browser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Contact links and site configuration

**Files:**
- Create: `apps/landing/src/config.ts`, `apps/landing/src/links.ts`
- Test: `apps/landing/src/links.test.ts`

**Interfaces:**
- Produces:
  - `interface SiteConfig { contactEmail: string; whatsapp: string; stores: { appStore: string; googlePlay: string } }`, `const config: SiteConfig`
  - `mailto(subject: string, email?: string): string` (default `config.contactEmail`)
  - `whatsappLink(text: string, number?: string): string | null` (default `config.whatsapp`; null when the number has no digit)

- [ ] **Step 1: Write the failing tests**

`apps/landing/src/links.test.ts`:
```ts
import { mailto, whatsappLink } from './links';

describe('mailto', () => {
  it('writes to the contact address with an encoded subject', () => {
    expect(mailto('Gym – register')).toBe('mailto:ahmedakremi42@gmail.com?subject=Gym%20%E2%80%93%20register');
  });

  it('escapes the characters that would end the subject', () => {
    expect(mailto('Q&A? #1', 'team@example.com')).toBe('mailto:team@example.com?subject=Q%26A%3F%20%231');
  });

  it('keeps an Arabic subject intact once decoded', () => {
    const subject = 'صالة – التسجيل';
    expect(decodeURIComponent(mailto(subject, 'a@b.c').split('subject=')[1])).toBe(subject);
  });
});

describe('whatsappLink', () => {
  it('is null while no number is configured', () => {
    expect(whatsappLink('Hi', '')).toBeNull();
    expect(whatsappLink('Hi', ' + - ')).toBeNull();
  });

  it('keeps the digits of the number and encodes the message', () => {
    expect(whatsappLink('Hello Fitness League!', '+216 20-123 456')).toBe('https://wa.me/21620123456?text=Hello%20Fitness%20League!');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/landing && pnpm vitest run src/links.test.ts`
Expected: FAIL, "Failed to resolve import "./links"".

- [ ] **Step 3: Implement**

`apps/landing/src/config.ts`:
```ts
/** What the owner edits before going public. An empty string means "not available yet". */
export interface SiteConfig {
  contactEmail: string;
  /** International format, e.g. '+216 20 123 456'. Empty: the WhatsApp button is hidden. */
  whatsapp: string;
  /** Store page URLs. Empty: the badge reads "Coming soon". */
  stores: { appStore: string; googlePlay: string };
}

export const config: SiteConfig = {
  contactEmail: 'ahmedakremi42@gmail.com',
  whatsapp: '',
  stores: { appStore: '', googlePlay: '' },
};
```

`apps/landing/src/links.ts`:
```ts
import { config } from './config';

/** An email to the team whose subject says who is writing. */
export function mailto(subject: string, email: string = config.contactEmail): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}

/** A wa.me link with a pre-filled message, or null while no number is configured. */
export function whatsappLink(text: string, number: string = config.whatsapp): string | null {
  const digits = number.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run src/links.test.ts && pnpm typecheck`
Expected: 5 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/landing/src/config.ts apps/landing/src/links.ts apps/landing/src/links.test.ts
git commit -m "feat(landing): contact links and the site configuration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Page text in English, French and Arabic

**Files:**
- Create: `apps/landing/src/content/en.ts`, `apps/landing/src/content/fr.ts`, `apps/landing/src/content/ar.ts`, `apps/landing/src/content/index.ts`
- Test: `apps/landing/src/content/content.test.ts`

**Interfaces:**
- Consumes: `Lang`, `LANGS` from `./lang` (Task 2).
- Produces: `type Copy = typeof en`; `copies: Record<Lang, Copy>`; `src/content/index.ts` re-exports everything from `./lang` and the `Copy` type, so components import from `'../content'`.
- Shape used by later tasks: `meta.{title,description}`; `nav.{main,home,skip,athletes,competitions,gyms,organizers,faq,contact,menu,closeMenu,language}`; `hero.{eyebrow,title,slogan,lead,photoAlt,screenAlt}`; `audienceCta.{athlete,gym,organizer}`; `stores.{soon,appStore,googlePlay}`; `how.{eyebrow,title,steps[{title,text}]}`; `athletes|gyms|organizers.{eyebrow,title,intro,features[{title,text}],photoAlt,screenAlts[],cta}`; `competitions.{eyebrow,title,intro,points[{title,text}],videoLabel,videoFallback,videoDownload,cta}`; `faq.{eyebrow,title,items[{q,a}]}`; `final.{title,text}`; `footer.{tagline,contact,credits,creditsIntro,trademarks,rights}`; `mail.{athlete,gym,organizer,contact}`; `whatsapp.{label,message}`.

- [ ] **Step 1: Write the failing test**

`apps/landing/src/content/content.test.ts`:
```ts
import { copies, LANGS } from '.';

/** Every path in the object (`faq.items[2].a`, …) with its value. */
function flatten(value: unknown, path = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value)) value.forEach((item, i) => flatten(item, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') for (const [key, item] of Object.entries(value)) flatten(item, path ? `${path}.${key}` : key, out);
  else out.set(path, value);
  return out;
}

it.each(LANGS)('%s has every text English has, and none is empty', (lang) => {
  const english = flatten(copies.en);
  const other = flatten(copies[lang]);
  expect([...other.keys()].sort()).toEqual([...english.keys()].sort());
  for (const [path, text] of other) {
    expect(typeof text, path).toBe('string');
    expect(String(text).trim(), path).not.toBe('');
  }
});

it('uses the subjects the spec gives', () => {
  expect(copies.en.mail).toEqual({
    athlete: 'Athlete – join Fitness League',
    gym: 'Gym – register',
    organizer: 'Organizer – host an event',
    contact: 'Contact',
  });
});
```

The array positions are part of each path, so a translation with one FAQ item fewer than English fails the first test.

- [ ] **Step 2: Run it to see it fail**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/landing && pnpm vitest run src/content/content.test.ts`
Expected: FAIL, "Failed to resolve import "."".

- [ ] **Step 3: Write the English text (source of the type)**

`apps/landing/src/content/en.ts`:
```ts
export const en = {
  meta: {
    title: 'Fitness League — Climb the League',
    description: 'Fitness League turns training into a fair game: earn League Points for progress, consistency and verified effort, represent your gym and enter online competitions judged on video.',
  },
  nav: {
    main: 'Main navigation',
    home: 'Fitness League, back to the top',
    skip: 'Skip to content',
    athletes: 'Athletes',
    competitions: 'Competitions',
    gyms: 'Gyms',
    organizers: 'Organizers',
    faq: 'FAQ',
    contact: 'Contact us',
    menu: 'Open the menu',
    closeMenu: 'Close the menu',
    language: 'Language',
  },
  hero: {
    eyebrow: 'Training · Rankings · Competitions',
    title: 'Climb the League.',
    slogan: 'Compete with yourself. Challenge your friends. Represent your gym.',
    lead: 'Fitness League rewards progress, consistency and verified effort, not absolute strength. Log your workouts, earn League Points and see where you stand in your country, your city and your gym.',
    photoAlt: 'Athlete getting ready to lift a heavy barbell in a gym',
    screenAlt: 'Fitness League home screen: season LP, Gold tier, rank in Tunisia and in Sousse, gym and shortcuts',
  },
  audienceCta: {
    athlete: "I'm an athlete",
    gym: 'I run a gym',
    organizer: 'I organize events',
  },
  stores: {
    soon: 'Coming soon',
    appStore: 'App Store',
    googlePlay: 'Google Play',
  },
  how: {
    eyebrow: 'How it works',
    title: 'Three steps to the top.',
    steps: [
      { title: 'Log your training', text: 'Strength, WODs, running, cycling, swimming… Log a workout in seconds from your phone.' },
      { title: 'Earn League Points', text: 'Every accepted workout earns LP. Progress, consistency and verified effort count more than the weight on the bar.' },
      { title: 'Climb the ranks', text: 'Follow your rank in your country, your region, your gym and among your friends, and move up a tier each season.' },
    ],
  },
  athletes: {
    eyebrow: 'For athletes',
    title: 'Your training becomes a game you can win.',
    intro: 'A beginner who improves can overtake an elite athlete who stands still. Here, everyone competes with their own progress.',
    features: [
      { title: 'Season LP and tiers', text: 'Start each season fresh and climb from tier to tier.' },
      { title: 'Personal records', text: 'Every record saved and dated, ready to be beaten.' },
      { title: 'Goals', text: 'Set a target and follow your progress week after week.' },
      { title: 'Streaks', text: 'Train regularly to keep your streak alive.' },
      { title: 'Friends and battles', text: 'Challenge a friend to a head-to-head battle.' },
      { title: 'Feed', text: 'Follow what your friends are training.' },
    ],
    photoAlt: 'Two athletes doing box jumps on wooden boxes in a gym',
    screenAlts: ["League ranking for Tunisia with each athlete's LP", 'Train tab with the list of accepted workouts'],
    cta: 'Join as an athlete',
  },
  competitions: {
    eyebrow: 'Competitions',
    title: 'Online qualifiers, judged on video.',
    intro: 'Register, film your WODs, paste the YouTube link and follow the leaderboard. The whole flow in 73 seconds (video in French):',
    points: [
      { title: 'Video proof on YouTube', text: 'One link per WOD: nothing heavy to upload, and judges watch your full effort.' },
      { title: 'Score computed for you', text: "Enter your reps for each movement; the app applies the organizer's points per rep." },
      { title: 'Real judges', text: 'A judge reviews every video before the score counts, and you can appeal a decision.' },
      { title: 'Leaderboards by category', text: 'Clear categories and prizes, and a leaderboard published once judging is done.' },
      { title: 'On your home screen', text: 'Open competitions show up on the app home screen with their banner.' },
    ],
    videoLabel: 'Tutorial video: how to take part in a Fitness League competition',
    videoFallback: 'Your browser cannot play this video.',
    videoDownload: 'Download the video',
    cta: 'I want to compete',
  },
  gyms: {
    eyebrow: 'For gyms',
    title: 'Represent your gym.',
    intro: "Your members' progress lifts your gym up the national ranking. Give them one more reason to train together.",
    features: [
      { title: 'Gym page', text: 'Logo, address, sports and links in one place, verified by the Fitness League team.' },
      { title: 'Members and rank', text: "See your members, your gym's level and its rank in the country." },
      { title: 'Gym WODs', text: 'Post the WOD of the day for your members.' },
      { title: 'Gym Wars', text: 'Every Monday your gym meets a gym of its size. Best athletes, participation, progress and regularity all count: size alone never wins.' },
      { title: 'Leagues', text: 'Your members can create public leagues, or private ones with an invite code.' },
    ],
    photoAlt: 'Coach and athlete training with battle ropes in a gym',
    screenAlts: ['Gym page with its members, level, rank and sports'],
    cta: 'Register my gym',
  },
  organizers: {
    eyebrow: 'For organizers',
    title: 'Host your competition. We run the platform.',
    intro: 'From registration to the final leaderboard, run an online qualifier from one admin panel.',
    features: [
      { title: 'Registration and categories', text: 'Athletes register from the app, in the category that fits them.' },
      { title: 'WOD builder', text: 'Set points per rep for each movement; the app computes every score.' },
      { title: 'Judges and head judges', text: 'Create judge accounts, assign WODs, and let head judges manage their team.' },
      { title: 'Your banner', text: 'Upload a banner for each competition or final.' },
      { title: 'Published results', text: 'Publish the leaderboard when judging is done.' },
      { title: 'Visibility', text: "Your competition shows up on every athlete's home screen." },
    ],
    photoAlt: 'Athlete checking the scoreboard at a weightlifting competition',
    screenAlts: ['List of competitions in the app with date, city, fee and number of athletes'],
    cta: 'Host my event',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Questions, answered.',
    items: [
      { q: 'When can I download the app?', a: 'Fitness League is coming soon to the App Store and Google Play. Write to us and we will tell you as soon as it is out.' },
      { q: 'Which sports count?', a: 'Bodybuilding, powerlifting, weight training, functional training, CrossFit, Hyrox, running, cycling, walking and swimming.' },
      { q: 'Do I need to be strong to rank high?', a: 'No. LP rewards your progress and your consistency compared with yourself, so a beginner who improves can outrank a strong athlete who stands still.' },
      { q: 'How is cheating prevented?', a: 'Every workout goes through automatic plausibility checks before it earns LP: an unrealistic jump is held for review. In competitions, a judge watches every video before the score counts.' },
      { q: 'How does judging work?', a: 'Each WOD is assigned to judges. They watch your YouTube video, check the reps of every movement, then validate or correct your score. You can appeal a decision.' },
      { q: 'Can my gym join?', a: 'Yes. Write to us to set up your gym page; your members then join it from the app and take part in Gym Wars.' },
      { q: 'How do I organize a competition?', a: 'Write to us. We open your organizer access, then you create the event, its categories, WODs and judges from the admin panel.' },
      { q: 'Which languages and countries?', a: 'The app speaks English, French and Arabic. It launches in Tunisia, with rankings by country, region, city and gym.' },
    ],
  },
  final: {
    title: 'Ready to climb?',
    text: 'Tell us who you are and we will get you started.',
  },
  footer: {
    tagline: 'Compete with yourself. Challenge your friends. Represent your gym. Climb the League.',
    contact: 'Contact',
    credits: 'Photo credits',
    creditsIntro: 'Photos from Unsplash, used under the Unsplash License.',
    trademarks: 'CrossFit and Hyrox are trademarks of their respective owners. Fitness League is not affiliated with them.',
    rights: '© 2026 Fitness League. All rights reserved.',
  },
  mail: {
    athlete: 'Athlete – join Fitness League',
    gym: 'Gym – register',
    organizer: 'Organizer – host an event',
    contact: 'Contact',
  },
  whatsapp: {
    label: 'WhatsApp',
    message: 'Hello Fitness League!',
  },
};

export type Copy = typeof en;
```

- [ ] **Step 4: Write the French text**

`apps/landing/src/content/fr.ts` (the app speaks French with "tu"):
```ts
import type { Copy } from './en';

export const fr: Copy = {
  meta: {
    title: 'Fitness League — Grimpe dans la League',
    description: "Fitness League transforme l'entraînement en jeu équitable : gagne des League Points pour ta progression, ta régularité et ton effort vérifié, représente ta salle et participe à des compétitions en ligne jugées sur vidéo.",
  },
  nav: {
    main: 'Navigation principale',
    home: 'Fitness League, retour en haut',
    skip: 'Aller au contenu',
    athletes: 'Athlètes',
    competitions: 'Compétitions',
    gyms: 'Salles',
    organizers: 'Organisateurs',
    faq: 'FAQ',
    contact: 'Nous contacter',
    menu: 'Ouvrir le menu',
    closeMenu: 'Fermer le menu',
    language: 'Langue',
  },
  hero: {
    eyebrow: 'Entraînement · Classements · Compétitions',
    title: 'Grimpe dans la League.',
    slogan: 'Rivalise avec toi-même. Défie tes amis. Représente ta salle.',
    lead: "Fitness League récompense la progression, la régularité et l'effort vérifié, pas la force brute. Enregistre tes séances, gagne des League Points et découvre ton rang dans ton pays, ta ville et ta salle.",
    photoAlt: 'Athlète qui se prépare à soulever une barre lourde en salle',
    screenAlt: "Écran d'accueil de Fitness League : LP de saison, rang Or, classement en Tunisie et à Sousse, salle et raccourcis",
  },
  audienceCta: {
    athlete: 'Je suis athlète',
    gym: 'Je gère une salle',
    organizer: "J'organise des compétitions",
  },
  stores: {
    soon: 'Bientôt disponible',
    appStore: 'App Store',
    googlePlay: 'Google Play',
  },
  how: {
    eyebrow: 'Comment ça marche',
    title: 'Trois étapes vers le sommet.',
    steps: [
      { title: 'Enregistre ton entraînement', text: 'Force, WOD, course, vélo, natation… Enregistre une séance en quelques secondes depuis ton téléphone.' },
      { title: 'Gagne des League Points', text: "Chaque séance acceptée rapporte des LP. La progression, la régularité et l'effort vérifié comptent plus que le poids sur la barre." },
      { title: 'Grimpe au classement', text: 'Suis ton rang dans ton pays, ta région, ta salle et parmi tes amis, et passe un palier à chaque saison.' },
    ],
  },
  athletes: {
    eyebrow: 'Pour les athlètes',
    title: 'Ton entraînement devient un jeu que tu peux gagner.',
    intro: "Un débutant qui progresse peut dépasser un athlète d'élite qui stagne. Ici, chacun rivalise avec sa propre progression.",
    features: [
      { title: 'LP de saison et paliers', text: 'Repars de zéro à chaque saison et monte de palier en palier.' },
      { title: 'Records personnels', text: 'Chaque record enregistré et daté, prêt à être battu.' },
      { title: 'Objectifs', text: 'Fixe-toi un objectif et suis ta progression semaine après semaine.' },
      { title: 'Séries', text: 'Entraîne-toi régulièrement pour garder ta série en vie.' },
      { title: 'Amis et duels', text: 'Défie un ami en face à face.' },
      { title: "Fil d'actualité", text: 'Suis les entraînements de tes amis.' },
    ],
    photoAlt: 'Deux athlètes font des box jumps sur des caisses en bois en salle',
    screenAlts: ['Classement de la League en Tunisie avec les LP de chaque athlète', 'Onglet Entraînement avec la liste des séances acceptées'],
    cta: "Rejoindre en tant qu'athlète",
  },
  competitions: {
    eyebrow: 'Compétitions',
    title: 'Des qualifications en ligne, jugées sur vidéo.',
    intro: 'Inscris-toi, filme tes WOD, colle le lien YouTube et suis le classement. Tout le parcours en 73 secondes :',
    points: [
      { title: 'Preuve vidéo sur YouTube', text: 'Un lien par WOD : rien de lourd à envoyer, et les juges voient tout ton effort.' },
      { title: 'Score calculé pour toi', text: "Saisis tes répétitions pour chaque mouvement ; l'application applique les points par répétition de l'organisateur." },
      { title: 'De vrais juges', text: 'Un juge regarde chaque vidéo avant que le score compte, et tu peux contester une décision.' },
      { title: 'Classements par catégorie', text: 'Des catégories et des prix clairs, et un classement publié une fois le jugement terminé.' },
      { title: "Sur ton écran d'accueil", text: "Les compétitions ouvertes apparaissent sur l'accueil de l'application avec leur bannière." },
    ],
    videoLabel: 'Vidéo tutoriel : comment participer à une compétition Fitness League',
    videoFallback: 'Ton navigateur ne peut pas lire cette vidéo.',
    videoDownload: 'Télécharger la vidéo',
    cta: 'Je veux participer',
  },
  gyms: {
    eyebrow: 'Pour les salles',
    title: 'Représente ta salle.',
    intro: "La progression de tes membres fait monter ta salle au classement national. Donne-leur une raison de plus de s'entraîner ensemble.",
    features: [
      { title: 'Page de la salle', text: "Logo, adresse, sports et liens au même endroit, vérifiés par l'équipe Fitness League." },
      { title: 'Membres et classement', text: 'Vois tes membres, le niveau de ta salle et son rang dans le pays.' },
      { title: 'WOD de la salle', text: 'Publie le WOD du jour pour tes membres.' },
      { title: 'Gym Wars', text: 'Chaque lundi, ta salle affronte une salle de sa taille. Meilleurs athlètes, participation, progression et régularité comptent : la taille seule ne gagne jamais.' },
      { title: 'Leagues', text: "Tes membres peuvent créer des leagues publiques, ou privées avec un code d'invitation." },
    ],
    photoAlt: 'Coach et athlète à la corde ondulatoire en salle',
    screenAlts: ['Page de la salle avec ses membres, son niveau, son rang et ses sports'],
    cta: 'Inscrire ma salle',
  },
  organizers: {
    eyebrow: 'Pour les organisateurs',
    title: 'Organise ta compétition. On fait tourner la plateforme.',
    intro: "De l'inscription au classement final, gère une qualification en ligne depuis un seul panneau d'administration.",
    features: [
      { title: 'Inscriptions et catégories', text: "Les athlètes s'inscrivent depuis l'application, dans la catégorie qui leur correspond." },
      { title: 'Création de WOD', text: "Fixe les points par répétition de chaque mouvement ; l'application calcule tous les scores." },
      { title: 'Juges et juges principaux', text: 'Crée les comptes juges, attribue les WOD et laisse les juges principaux gérer leur équipe.' },
      { title: 'Ta bannière', text: 'Ajoute une bannière pour chaque compétition ou finale.' },
      { title: 'Résultats publiés', text: 'Publie le classement quand le jugement est terminé.' },
      { title: 'Visibilité', text: "Ta compétition apparaît sur l'accueil de chaque athlète." },
    ],
    photoAlt: "Athlète qui consulte le tableau des scores lors d'une compétition d'haltérophilie",
    screenAlts: ["Liste des compétitions dans l'application avec date, ville, tarif et nombre d'athlètes"],
    cta: 'Organiser mon événement',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Tes questions, nos réponses.',
    items: [
      { q: "Quand pourrai-je télécharger l'application ?", a: "Fitness League arrive bientôt sur l'App Store et Google Play. Écris-nous et on te prévient dès sa sortie." },
      { q: 'Quels sports comptent ?', a: 'Musculation, force athlétique, renforcement, entraînement fonctionnel, CrossFit, Hyrox, course à pied, vélo, marche et natation.' },
      { q: 'Faut-il être fort pour être bien classé ?', a: 'Non. Les LP récompensent ta progression et ta régularité par rapport à toi-même : un débutant qui progresse peut passer devant un athlète fort qui stagne.' },
      { q: 'Comment la triche est-elle évitée ?', a: 'Chaque séance passe des contrôles de vraisemblance automatiques avant de rapporter des LP : un bond irréaliste est mis en attente de vérification. En compétition, un juge regarde chaque vidéo avant que le score compte.' },
      { q: 'Comment fonctionne le jugement ?', a: 'Chaque WOD est attribué à des juges. Ils regardent ta vidéo YouTube, vérifient les répétitions de chaque mouvement, puis valident ou corrigent ton score. Tu peux contester une décision.' },
      { q: 'Ma salle peut-elle rejoindre Fitness League ?', a: "Oui. Écris-nous pour créer la page de ta salle ; tes membres la rejoignent ensuite depuis l'application et participent aux Gym Wars." },
      { q: 'Comment organiser une compétition ?', a: "Écris-nous. On t'ouvre un accès organisateur, puis tu crées l'événement, ses catégories, ses WOD et ses juges depuis le panneau d'administration." },
      { q: 'Quelles langues et quels pays ?', a: "L'application parle anglais, français et arabe. Elle démarre en Tunisie, avec des classements par pays, région, ville et salle." },
    ],
  },
  final: {
    title: 'Prêt à grimper ?',
    text: "Dis-nous qui tu es et on t'aide à démarrer.",
  },
  footer: {
    tagline: 'Rivalise avec toi-même. Défie tes amis. Représente ta salle. Grimpe dans la League.',
    contact: 'Contact',
    credits: 'Crédits photo',
    creditsIntro: 'Photos Unsplash, utilisées selon la licence Unsplash.',
    trademarks: "CrossFit et Hyrox sont des marques de leurs propriétaires respectifs. Fitness League n'y est pas affilié.",
    rights: '© 2026 Fitness League. Tous droits réservés.',
  },
  mail: {
    athlete: 'Athlète – rejoindre Fitness League',
    gym: 'Salle – inscription',
    organizer: 'Organisateur – organiser un événement',
    contact: 'Contact',
  },
  whatsapp: {
    label: 'WhatsApp',
    message: 'Bonjour Fitness League !',
  },
};
```

- [ ] **Step 5: Write the Arabic text**

`apps/landing/src/content/ar.ts` (terms aligned with the app: نقاط الموسم, صالة, رياضي):
```ts
import type { Copy } from './en';

export const ar: Copy = {
  meta: {
    title: 'Fitness League — اصعد في الدوري',
    description: 'يحوّل Fitness League التدريب إلى لعبة عادلة: اجمع نقاط الدوري على تقدّمك وانتظامك وجهدك الموثّق، ومثّل صالتك، وشارك في مسابقات عبر الإنترنت يُحكَم عليها بالفيديو.',
  },
  nav: {
    main: 'التنقل الرئيسي',
    home: 'Fitness League، العودة إلى الأعلى',
    skip: 'انتقل إلى المحتوى',
    athletes: 'الرياضيون',
    competitions: 'المسابقات',
    gyms: 'الصالات',
    organizers: 'المنظّمون',
    faq: 'الأسئلة الشائعة',
    contact: 'تواصل معنا',
    menu: 'فتح القائمة',
    closeMenu: 'إغلاق القائمة',
    language: 'اللغة',
  },
  hero: {
    eyebrow: 'تدريب · ترتيب · مسابقات',
    title: 'اصعد في الدوري.',
    slogan: 'نافس نفسك. تحدَّ أصدقاءك. مثّل صالتك.',
    lead: 'يكافئ Fitness League التقدّم والانتظام والجهد الموثّق، لا القوة المطلقة. سجّل تمارينك، واجمع نقاط الدوري، واعرف ترتيبك في بلدك ومدينتك وصالتك.',
    photoAlt: 'رياضية تستعد لرفع بار ثقيل في صالة رياضية',
    screenAlt: 'الشاشة الرئيسية لتطبيق Fitness League: نقاط الموسم، المستوى الذهبي، الترتيب في تونس وسوسة، الصالة والاختصارات',
  },
  audienceCta: {
    athlete: 'أنا رياضي',
    gym: 'أدير صالة',
    organizer: 'أنظّم مسابقات',
  },
  stores: {
    soon: 'قريبًا',
    appStore: 'App Store',
    googlePlay: 'Google Play',
  },
  how: {
    eyebrow: 'كيف يعمل',
    title: 'ثلاث خطوات نحو القمة.',
    steps: [
      { title: 'سجّل تدريبك', text: 'قوة، تمارين WOD، جري، دراجة، سباحة… سجّل تمرينك في ثوانٍ من هاتفك.' },
      { title: 'اجمع نقاط الدوري', text: 'كل تمرين مقبول يمنحك نقاطًا. التقدّم والانتظام والجهد الموثّق أهم من الوزن على البار.' },
      { title: 'اصعد في الترتيب', text: 'تابع ترتيبك في بلدك ومنطقتك وصالتك وبين أصدقائك، وارتقِ مستوى في كل موسم.' },
    ],
  },
  athletes: {
    eyebrow: 'للرياضيين',
    title: 'تدريبك يصبح لعبة يمكنك الفوز بها.',
    intro: 'يمكن لمبتدئ يتحسّن أن يتجاوز رياضيًا محترفًا لا يتقدّم. هنا، كل واحد ينافس بتقدّمه الخاص.',
    features: [
      { title: 'نقاط الموسم والمستويات', text: 'ابدأ كل موسم من جديد واصعد من مستوى إلى آخر.' },
      { title: 'الأرقام القياسية الشخصية', text: 'كل رقم قياسي محفوظ ومؤرّخ، جاهز لتحطيمه.' },
      { title: 'الأهداف', text: 'حدّد هدفًا وتابع تقدّمك أسبوعًا بعد أسبوع.' },
      { title: 'السلاسل', text: 'تدرّب بانتظام لتحافظ على سلسلتك.' },
      { title: 'الأصدقاء والمواجهات', text: 'تحدَّ صديقًا في مواجهة مباشرة.' },
      { title: 'الموجز', text: 'تابع ما يتدرّب عليه أصدقاؤك.' },
    ],
    photoAlt: 'رياضيان يقفزان على صناديق خشبية في صالة',
    screenAlts: ['ترتيب الدوري في تونس مع نقاط كل رياضي', 'قسم التدريب مع قائمة التمارين المقبولة'],
    cta: 'انضم كرياضي',
  },
  competitions: {
    eyebrow: 'المسابقات',
    title: 'تصفيات عبر الإنترنت، يُحكَم عليها بالفيديو.',
    intro: 'سجّل، وصوّر تمارين WOD، والصق رابط YouTube، وتابع الترتيب. المسار كاملًا في 73 ثانية (الفيديو بالفرنسية):',
    points: [
      { title: 'إثبات بالفيديو على YouTube', text: 'رابط واحد لكل WOD: لا ملفات ثقيلة للرفع، والحكام يشاهدون جهدك كاملًا.' },
      { title: 'نتيجة محسوبة تلقائيًا', text: 'أدخل عدد التكرارات لكل حركة، ويطبّق التطبيق نقاط المنظّم لكل تكرار.' },
      { title: 'حكام حقيقيون', text: 'يراجع حَكَم كل فيديو قبل احتساب النتيجة، ويمكنك الطعن في القرار.' },
      { title: 'ترتيب حسب الفئة', text: 'فئات وجوائز واضحة، وترتيب يُنشر بعد انتهاء التحكيم.' },
      { title: 'على شاشتك الرئيسية', text: 'تظهر المسابقات المفتوحة في الشاشة الرئيسية للتطبيق مع لافتتها.' },
    ],
    videoLabel: 'فيديو تعليمي: كيف تشارك في مسابقة Fitness League',
    videoFallback: 'متصفحك لا يستطيع تشغيل هذا الفيديو.',
    videoDownload: 'تنزيل الفيديو',
    cta: 'أريد المنافسة',
  },
  gyms: {
    eyebrow: 'للصالات',
    title: 'مثّل صالتك.',
    intro: 'تقدّم أعضائك يرفع صالتك في الترتيب الوطني. امنحهم سببًا إضافيًا للتدرّب معًا.',
    features: [
      { title: 'صفحة الصالة', text: 'الشعار والعنوان والرياضات والروابط في مكان واحد، بعد توثيقها من فريق Fitness League.' },
      { title: 'الأعضاء والترتيب', text: 'شاهد أعضاءك ومستوى صالتك وترتيبها في البلد.' },
      { title: 'تمارين الصالة', text: 'انشر تمرين اليوم (WOD) لأعضائك.' },
      { title: 'حروب الصالات', text: 'كل يوم اثنين تواجه صالتك صالة بحجمها. أفضل الرياضيين والمشاركة والتقدّم والانتظام كلها تُحتسب: الحجم وحده لا يفوز أبدًا.' },
      { title: 'الدوريات', text: 'يمكن لأعضائك إنشاء دوريات عامة، أو خاصة برمز دعوة.' },
    ],
    photoAlt: 'مدرّب ورياضية يتدرّبان بالحبال القتالية في صالة',
    screenAlts: ['صفحة الصالة مع أعضائها ومستواها وترتيبها ورياضاتها'],
    cta: 'سجّل صالتي',
  },
  organizers: {
    eyebrow: 'للمنظّمين',
    title: 'نظّم مسابقتك. نحن نشغّل المنصة.',
    intro: 'من التسجيل إلى الترتيب النهائي، أدر تصفيات عبر الإنترنت من لوحة إدارة واحدة.',
    features: [
      { title: 'التسجيل والفئات', text: 'يسجّل الرياضيون من التطبيق في الفئة المناسبة لهم.' },
      { title: 'منشئ التمارين', text: 'حدّد النقاط لكل تكرار في كل حركة، ويحسب التطبيق كل النتائج.' },
      { title: 'الحكام ورؤساء الحكام', text: 'أنشئ حسابات الحكام، ووزّع التمارين، ودع رؤساء الحكام يديرون فريقهم.' },
      { title: 'لافتتك الخاصة', text: 'ارفع لافتة لكل مسابقة أو نهائي.' },
      { title: 'نتائج منشورة', text: 'انشر الترتيب عند انتهاء التحكيم.' },
      { title: 'ظهور أوسع', text: 'تظهر مسابقتك في الشاشة الرئيسية لكل رياضي.' },
    ],
    photoAlt: 'رياضية تتابع لوحة النتائج في مسابقة رفع أثقال',
    screenAlts: ['قائمة المسابقات في التطبيق مع التاريخ والمدينة والرسوم وعدد الرياضيين'],
    cta: 'أريد تنظيم مسابقة',
  },
  faq: {
    eyebrow: 'الأسئلة الشائعة',
    title: 'أسئلة وأجوبة.',
    items: [
      { q: 'متى يمكنني تنزيل التطبيق؟', a: 'سيتوفر Fitness League قريبًا على App Store وGoogle Play. راسلنا وسنخبرك فور صدوره.' },
      { q: 'ما الرياضات المحتسبة؟', a: 'كمال الأجسام، رفع القوة، التدريب بالأثقال، التدريب الوظيفي، كروسفيت، هايروكس، الجري، ركوب الدراجة، المشي والسباحة.' },
      { q: 'هل يجب أن أكون قويًا لأحتل مرتبة عالية؟', a: 'لا. تكافئ النقاط تقدّمك وانتظامك مقارنةً بنفسك، لذلك يمكن لمبتدئ يتحسّن أن يتقدّم على رياضي قوي لا يتطوّر.' },
      { q: 'كيف يُمنع الغش؟', a: 'يمرّ كل تمرين بفحوصات معقولية تلقائية قبل أن يمنح نقاطًا: أي قفزة غير واقعية تُعلَّق للمراجعة. وفي المسابقات، يشاهد حَكَم كل فيديو قبل احتساب النتيجة.' },
      { q: 'كيف يتم التحكيم؟', a: 'يُسنَد كل WOD إلى حكام. يشاهدون فيديو YouTube الخاص بك، ويتحققون من تكرارات كل حركة، ثم يعتمدون نتيجتك أو يصحّحونها. ويمكنك الطعن في القرار.' },
      { q: 'هل يمكن لصالتي الانضمام؟', a: 'نعم. راسلنا لإنشاء صفحة صالتك، ثم ينضم إليها أعضاؤك من التطبيق ويشاركون في حروب الصالات.' },
      { q: 'كيف أنظّم مسابقة؟', a: 'راسلنا. نفتح لك صلاحية المنظّم، ثم تنشئ الحدث وفئاته وتمارينه وحكامه من لوحة الإدارة.' },
      { q: 'ما اللغات والبلدان المتاحة؟', a: 'التطبيق متاح بالإنجليزية والفرنسية والعربية. ينطلق من تونس، مع ترتيب حسب البلد والمنطقة والمدينة والصالة.' },
    ],
  },
  final: {
    title: 'جاهز للصعود؟',
    text: 'أخبرنا من أنت وسنساعدك على البدء.',
  },
  footer: {
    tagline: 'نافس نفسك. تحدَّ أصدقاءك. مثّل صالتك. اصعد في الدوري.',
    contact: 'تواصل',
    credits: 'حقوق الصور',
    creditsIntro: 'صور من Unsplash، مستخدمة وفق ترخيص Unsplash.',
    trademarks: 'CrossFit وHyrox علامتان تجاريتان لأصحابهما. Fitness League غير تابع لهما.',
    rights: '© 2026 Fitness League. جميع الحقوق محفوظة.',
  },
  mail: {
    athlete: 'رياضي – الانضمام إلى Fitness League',
    gym: 'صالة – التسجيل',
    organizer: 'منظّم – تنظيم مسابقة',
    contact: 'تواصل',
  },
  whatsapp: {
    label: 'واتساب',
    message: 'مرحبًا Fitness League!',
  },
};
```

- [ ] **Step 6: Write the index**

`apps/landing/src/content/index.ts`:
```ts
import { ar } from './ar';
import { en, type Copy } from './en';
import { fr } from './fr';
import type { Lang } from './lang';

export type { Copy } from './en';
export * from './lang';

export const copies: Record<Lang, Copy> = { en, fr, ar };
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/landing && pnpm vitest run src/content && pnpm typecheck`
Expected: content tests (4) and lang tests pass; typecheck clean (a missing or misspelled key in `fr.ts` or `ar.ts` is a type error).

- [ ] **Step 8: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/landing/src/content
git commit -m "feat(landing): page text in English, French and Arabic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Media and photo credits

**Files:**
- Create (one-time script, **not committed**): `<scratchpad>/media.mjs`
- Create: `apps/landing/public/media/{hero.webp,hero-800.webp,og.jpg,athletes.webp,gyms.webp,organizers.webp,logo.png,tutorial.mp4,screen-home.webp,screen-league.webp,screen-train.webp,screen-competitions.webp,screen-gym.webp}`, `apps/landing/public/favicon.png`
- Create: `apps/landing/src/media.ts`, `apps/landing/src/credits.ts`, `apps/landing/CREDITS.md`
- Test: `apps/landing/src/media.test.ts`

**Interfaces:**
- Produces: `media` (paths under `/media`, see code), `interface Credit { file: string; photographer: string; source: string }`, `credits: Credit[]`.

Photos (all checked on 2026-10-12 as "Free to use under the Unsplash License", none from Unsplash+):

| File | Unsplash image | Photographer | Page |
|---|---|---|---|
| `hero.webp`, `hero-800.webp`, `og.jpg` | `photo-1772450014622-1c209d012c2e` | Rodrigo Rodrigues \| WOLF Λ R T | https://unsplash.com/photos/woman-lifting-a-heavy-barbell-in-a-gym-78E-sY8mVsM |
| `athletes.webp` | `photo-1536922246289-88c42f957773` | Meghan Holmes | https://unsplash.com/photos/people-performing-box-jumps-workout-wy_L8W0zcpI |
| `gyms.webp` | `photo-1758875569517-559a631fb44d` | Vitaly Gariev | https://unsplash.com/photos/man-and-woman-exercising-with-battle-ropes-fnLjFrBjHm8 |
| `organizers.webp` | `photo-1741478551696-8e4ff7d6b468` | Putri Ardhia | https://unsplash.com/photos/woman-checks-scores-at-a-weightlifting-competition-81FJsFw2ocM |

Rejected on purpose: photos showing CrossFit or HYROX branding (judges at a CrossFit event, the HYROX Hong Kong floor, sled push and SkiErg arch). The Unsplash License does not cover trademarks.

- [ ] **Step 1: Write the failing test**

`apps/landing/src/media.test.ts`:
```ts
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { credits } from './credits';
import { media } from './media';

const publicFile = (path: string) => fileURLToPath(new URL(`../public${path}`, import.meta.url));
const paths = (value: object): string[] => Object.values(value).flatMap((v) => (typeof v === 'string' ? [v] : paths(v)));

it.each(paths(media))('%s is in public/', (path) => {
  expect(existsSync(publicFile(path))).toBe(true);
});

it('every photo has a credit and every credit has a photo', () => {
  const photos = [media.hero, media.athletes, media.gyms, media.organizers].map((p) => p.replace('/media/', ''));
  expect(credits.map((c) => c.file).sort()).toEqual([...photos].sort());
  for (const c of credits) expect(c.source).toMatch(/^https:\/\/unsplash\.com\/photos\//);
});
```

- [ ] **Step 2: Write `media.ts` and `credits.ts`, then run the test to see it fail**

`apps/landing/src/media.ts`:
```ts
/** Files under public/, shared by every language. `og` is used by index.html. */
export const media = {
  hero: '/media/hero.webp',
  heroSmall: '/media/hero-800.webp',
  og: '/media/og.jpg',
  athletes: '/media/athletes.webp',
  gyms: '/media/gyms.webp',
  organizers: '/media/organizers.webp',
  logo: '/media/logo.png',
  favicon: '/favicon.png',
  tutorial: '/media/tutorial.mp4',
  screens: {
    home: '/media/screen-home.webp',
    league: '/media/screen-league.webp',
    train: '/media/screen-train.webp',
    competitions: '/media/screen-competitions.webp',
    gym: '/media/screen-gym.webp',
  },
} as const;
```

`apps/landing/src/credits.ts`:
```ts
export interface Credit {
  /** File name under public/media. */
  file: string;
  photographer: string;
  /** The photo's Unsplash page. */
  source: string;
}

/** Unsplash License: free for commercial use; credit given anyway. Keep CREDITS.md in step. */
export const credits: Credit[] = [
  { file: 'hero.webp', photographer: 'Rodrigo Rodrigues | WOLF Λ R T', source: 'https://unsplash.com/photos/woman-lifting-a-heavy-barbell-in-a-gym-78E-sY8mVsM' },
  { file: 'athletes.webp', photographer: 'Meghan Holmes', source: 'https://unsplash.com/photos/people-performing-box-jumps-workout-wy_L8W0zcpI' },
  { file: 'gyms.webp', photographer: 'Vitaly Gariev', source: 'https://unsplash.com/photos/man-and-woman-exercising-with-battle-ropes-fnLjFrBjHm8' },
  { file: 'organizers.webp', photographer: 'Putri Ardhia', source: 'https://unsplash.com/photos/woman-checks-scores-at-a-weightlifting-competition-81FJsFw2ocM' },
];
```

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/landing && pnpm vitest run src/media.test.ts`
Expected: FAIL on every `… is in public/` case (the files do not exist yet); the credits test passes.

- [ ] **Step 3: Write and run the one-time conversion script**

`<scratchpad>/media.mjs` (scratchpad = `/tmp/claude-1000/-mnt-c-Users-GIGABYTE-fitness-league/<session>/scratchpad`):
```js
// One-time media conversion for apps/landing. Usage: node media.mjs <repo root>
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [root] = process.argv.slice(2);
if (!root) throw new Error('usage: node media.mjs <repo root>');
const sharp = createRequire(join(root, 'apps/api/package.json'))('sharp');
const desk = '/mnt/c/Users/GIGABYTE/Desktop';
const pub = join(root, 'apps/landing/public');
const out = join(pub, 'media');
await mkdir(out, { recursive: true });

async function unsplash(id) {
  const res = await fetch(`https://images.unsplash.com/${id}?w=2000&q=85&fm=jpg`);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const photos = {
  hero: 'photo-1772450014622-1c209d012c2e',
  athletes: 'photo-1536922246289-88c42f957773',
  gyms: 'photo-1758875569517-559a631fb44d',
  organizers: 'photo-1741478551696-8e4ff7d6b468',
};
for (const [name, id] of Object.entries(photos)) {
  const src = await unsplash(id);
  await sharp(src).resize({ width: name === 'hero' ? 1600 : 1200, withoutEnlargement: true }).webp({ quality: 78 }).toFile(join(out, `${name}.webp`));
  if (name === 'hero') {
    await sharp(src).resize({ width: 800 }).webp({ quality: 74 }).toFile(join(out, 'hero-800.webp'));
    await sharp(src).resize(1200, 630, { fit: 'cover', position: 'attention' }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(out, 'og.jpg'));
  }
}

// Screens without the default banner (Alamy watermarks) and without broken emoji.
const screens = {
  home: 'ui-avant-apres/apres/01-home.png',
  league: 'ui-avant-apres/apres/05-League.png',
  train: 'ui-avant-apres/apres/04-Train.png',
  competitions: 'ui-avant-apres/apres/09-competitions.png',
  gym: 'ui-avant-apres/apres/12-gym.png',
};
for (const [name, file] of Object.entries(screens)) {
  await sharp(join(desk, file)).resize({ width: 780, withoutEnlargement: true }).webp({ quality: 82 }).toFile(join(out, `screen-${name}.webp`));
}

const icon = join(root, 'apps/mobile-rn/assets/icon.png');
await sharp(icon).resize(192, 192).png().toFile(join(out, 'logo.png'));
await sharp(icon).resize(64, 64).png().toFile(join(pub, 'favicon.png'));

// As the owner chose: the existing tutorial, unchanged (it shows the Alamy watermarks; replace before going public).
await copyFile(join(desk, 'fitness/Fitness League - Tuto Competition.mp4'), join(out, 'tutorial.mp4'));
console.log('media ready in', out);
```

Run: `node <scratchpad>/media.mjs /mnt/c/Users/GIGABYTE/fitness-league && ls -la /mnt/c/Users/GIGABYTE/fitness-league/apps/landing/public/media`
Expected: "media ready in …" and the 13 files listed. Each photo WebP is under 400 KB and each screen under 150 KB; `tutorial.mp4` is 7,456,945 bytes.

- [ ] **Step 4: Look at every output**

Open each WebP and `og.jpg` with the Read tool. Check that none shows a watermark, a CrossFit/HYROX logo or a Circle21 element, and that the screenshots are the five named above. If a photo crops badly in `og.jpg`, change `position` to `'centre'` and re-run.

- [ ] **Step 5: Write `CREDITS.md`**

`apps/landing/CREDITS.md`:
```markdown
# Photo and media credits

Photos from [Unsplash](https://unsplash.com), free to use under the [Unsplash License](https://unsplash.com/license) (commercial use allowed, no permission needed). Checked on 2026-10-12: none is an Unsplash+ photo. The licence does not cover trademarks, so photos showing CrossFit or HYROX branding were left out.

| File | Photographer | Source |
|---|---|---|
| `public/media/hero.webp`, `hero-800.webp`, `og.jpg` | Rodrigo Rodrigues \| WOLF Λ R T | https://unsplash.com/photos/woman-lifting-a-heavy-barbell-in-a-gym-78E-sY8mVsM |
| `public/media/athletes.webp` | Meghan Holmes | https://unsplash.com/photos/people-performing-box-jumps-workout-wy_L8W0zcpI |
| `public/media/gyms.webp` | Vitaly Gariev | https://unsplash.com/photos/man-and-woman-exercising-with-battle-ropes-fnLjFrBjHm8 |
| `public/media/organizers.webp` | Putri Ardhia | https://unsplash.com/photos/woman-checks-scores-at-a-weightlifting-competition-81FJsFw2ocM |

Fitness League's own media:
- `screen-*.webp`: screenshots of the app (offline demo, 2026-10-06).
- `logo.png`, `../favicon.png`: the app icon.
- `tutorial.mp4`: the 73 s competition tutorial. **It shows the Alamy watermarks of the app's default competition banner: replace it before the page goes public** (re-render after replacing `apps/mobile-rn/assets/competition-cover.jpg`).

To change a photo: replace the file (WebP, at most 1600 px wide for the hero and 1200 px for the others), then update this table and `src/credits.ts`.
```

- [ ] **Step 6: Run the tests**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/landing && pnpm vitest run src/media.test.ts && pnpm typecheck`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/landing/public apps/landing/src/media.ts apps/landing/src/credits.ts apps/landing/src/media.test.ts apps/landing/CREDITS.md
git commit -m "feat(landing): licensed photos, app screenshots, logo and the tutorial video

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Building blocks

**Files:**
- Create: `apps/landing/src/components/Cta.tsx`, `StoreBadges.tsx`, `LangSwitch.tsx`, `PhoneFrame.tsx`, `Reveal.tsx`, `SectionHead.tsx`, `icons.tsx`
- Test: `apps/landing/src/components/blocks.test.tsx`

**Interfaces:**
- Consumes: `Copy`, `Lang`, `LANGS`, `copies` from `../content` (Task 4); `mailto` (Task 3); `config`, `SiteConfig` (Task 3).
- Produces:
  - `Cta({ subject: string; children: ReactNode; variant?: 'primary' | 'ghost' })`: an `<a class="btn btn-…" href={mailto(subject)}>`
  - `AudienceCtas({ t: Copy })`: the three audience buttons
  - `StoreBadges({ t: Copy; stores?: SiteConfig['stores'] })`
  - `LangSwitch({ lang: Lang; onLang: (lang: Lang) => void; label: string })`: buttons named "English", "Français", "العربية", with `aria-pressed`
  - `PhoneFrame({ children: ReactNode; className?: string })`
  - `Reveal({ children: ReactNode; className?: string })`: a `<div class="reveal [is-visible]">`
  - `SectionHead({ id: string; eyebrow: string; title: string; intro?: string })`: `<h2 id={id}>`
  - `CheckIcon()`: decorative SVG

- [ ] **Step 1: Write the failing tests**

`apps/landing/src/components/blocks.test.tsx`:
```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { copies } from '../content';
import { mailto } from '../links';
import { AudienceCtas } from './Cta';
import { LangSwitch } from './LangSwitch';
import { Reveal } from './Reveal';
import { StoreBadges } from './StoreBadges';

it('audience buttons email the team with their own subject', () => {
  const t = copies.fr;
  render(<AudienceCtas t={t} />);
  expect(screen.getByRole('link', { name: t.audienceCta.athlete })).toHaveAttribute('href', mailto(t.mail.athlete));
  expect(screen.getByRole('link', { name: t.audienceCta.gym })).toHaveAttribute('href', mailto(t.mail.gym));
  expect(screen.getByRole('link', { name: t.audienceCta.organizer })).toHaveAttribute('href', mailto(t.mail.organizer));
});

it('store badges say "coming soon" until a store link exists', () => {
  const t = copies.fr;
  const { rerender } = render(<StoreBadges t={t} stores={{ appStore: '', googlePlay: '' }} />);
  expect(screen.getAllByText(t.stores.soon)).toHaveLength(2);
  expect(screen.queryAllByRole('link')).toHaveLength(0);

  rerender(<StoreBadges t={t} stores={{ appStore: 'https://apps.apple.com/app/id1', googlePlay: '' }} />);
  expect(screen.getByRole('link', { name: /App Store/ })).toHaveAttribute('href', 'https://apps.apple.com/app/id1');
  expect(screen.getAllByText(t.stores.soon)).toHaveLength(1);
});

it('the language switch marks the current language and reports a choice', async () => {
  const onLang = vi.fn();
  render(<LangSwitch lang="fr" onLang={onLang} label="Langue" />);
  expect(screen.getByRole('group', { name: 'Langue' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Français' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(screen.getByRole('button', { name: 'العربية' }));
  expect(onLang).toHaveBeenCalledWith('ar');
});

describe('Reveal', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows its content at once where IntersectionObserver is missing', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Reveal><p>Hello</p></Reveal>);
    expect(screen.getByText('Hello').parentElement).toHaveClass('reveal', 'is-visible');
  });

  it('shows its content at once when the visitor asks for reduced motion', () => {
    vi.stubGlobal('IntersectionObserver', class {});
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    render(<Reveal><p>Hello</p></Reveal>);
    expect(screen.getByText('Hello').parentElement).toHaveClass('is-visible');
  });

  it('otherwise waits until it scrolls into view', () => {
    let notify: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    render(<Reveal><p>Hello</p></Reveal>);
    const box = screen.getByText('Hello').parentElement!;
    expect(box).not.toHaveClass('is-visible');
    act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(box).toHaveClass('is-visible');
    expect(disconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/landing && pnpm vitest run src/components/blocks.test.tsx`
Expected: FAIL, "Failed to resolve import "./Cta"".

- [ ] **Step 3: Implement the blocks**

`apps/landing/src/components/Cta.tsx`:
```tsx
import type { ReactNode } from 'react';
import type { Copy } from '../content';
import { mailto } from '../links';

/** A button that opens an email to the team, with a subject that says who is writing. */
export function Cta({ subject, children, variant = 'primary' }: { subject: string; children: ReactNode; variant?: 'primary' | 'ghost' }) {
  return (
    <a className={`btn btn-${variant}`} href={mailto(subject)}>
      {children}
    </a>
  );
}

/** The three ways in: athlete, gym, organizer. */
export function AudienceCtas({ t }: { t: Copy }) {
  return (
    <div className="cta-row">
      <Cta subject={t.mail.athlete}>{t.audienceCta.athlete}</Cta>
      <Cta subject={t.mail.gym} variant="ghost">
        {t.audienceCta.gym}
      </Cta>
      <Cta subject={t.mail.organizer} variant="ghost">
        {t.audienceCta.organizer}
      </Cta>
    </div>
  );
}
```

`apps/landing/src/components/StoreBadges.tsx` (plain text badges: the official store artwork has its own usage rules):
```tsx
import { config, type SiteConfig } from '../config';
import type { Copy } from '../content';

export function StoreBadges({ t, stores = config.stores }: { t: Copy; stores?: SiteConfig['stores'] }) {
  const badges = [
    { name: t.stores.appStore, href: stores.appStore },
    { name: t.stores.googlePlay, href: stores.googlePlay },
  ];
  return (
    <ul className="stores">
      {badges.map(({ name, href }) => (
        <li key={name}>
          {href ? (
            <a className="store" href={href}>
              <span className="store-name">{name}</span>
            </a>
          ) : (
            <span className="store is-soon">
              <span className="store-name">{name}</span>
              <span className="store-note">{t.stores.soon}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
```

`apps/landing/src/components/LangSwitch.tsx`:
```tsx
import { LANGS, type Lang } from '../content';

/** Each language named in itself, so a visitor finds theirs whatever the page language. */
const LABELS: Record<Lang, { short: string; name: string }> = {
  en: { short: 'EN', name: 'English' },
  fr: { short: 'FR', name: 'Français' },
  ar: { short: 'ع', name: 'العربية' },
};

export function LangSwitch({ lang, onLang, label }: { lang: Lang; onLang: (lang: Lang) => void; label: string }) {
  return (
    <div className="lang-switch" role="group" aria-label={label}>
      {LANGS.map((code) => (
        <button key={code} type="button" lang={code} aria-label={LABELS[code].name} aria-pressed={code === lang} onClick={() => onLang(code)}>
          {LABELS[code].short}
        </button>
      ))}
    </div>
  );
}
```

`apps/landing/src/components/PhoneFrame.tsx`:
```tsx
import type { ReactNode } from 'react';

export function PhoneFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`phone ${className}`.trim()}>
      <div className="phone-screen">{children}</div>
    </div>
  );
}
```

`apps/landing/src/components/Reveal.tsx`:
```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Visible at once when the browser cannot observe scrolling or the visitor asks for less motion. */
function showAtOnce(): boolean {
  if (typeof IntersectionObserver !== 'function') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fades its content in the first time it scrolls into view. */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(showAtOnce);

  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className={`reveal ${visible ? 'is-visible' : ''} ${className}`.trim()}>
      {children}
    </div>
  );
}
```

`apps/landing/src/components/SectionHead.tsx`:
```tsx
export function SectionHead({ id, eyebrow, title, intro }: { id: string; eyebrow: string; title: string; intro?: string }) {
  return (
    <div className="section-head">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className="display">
        {title}
      </h2>
      {intro && <p className="lead">{intro}</p>}
    </div>
  );
}
```

`apps/landing/src/components/icons.tsx`:
```tsx
export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.16" />
      <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/components/blocks.test.tsx && pnpm typecheck`
Expected: 6 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/landing/src/components
git commit -m "feat(landing): buttons, store badges, language switch, phone frame and reveal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The page

**Files:**
- Create: `apps/landing/src/useLang.ts`, `apps/landing/src/components/{Header,Hero,HowItWorks,Audience,Competitions,Faq,FinalCta,Footer}.tsx`
- Modify: `apps/landing/src/App.tsx` (rewrite), `apps/landing/src/App.test.tsx` (rewrite)

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces: `useLang(): [Lang, (lang: Lang) => void]`; `FinalCta({ t: Copy; whatsapp?: string })`. Element ids used by the CSS (Task 8): `top`, `main`, `site-menu`, `how`, `athletes`, `competitions`, `gyms`, `organizers`, `faq`. Class names used by the CSS: `site-header`, `header-inner`, `brand`, `site-nav`, `is-open`, `header-contact`, `menu-toggle`, `menu-icon`, `skip-link`, `hero`, `hero-photo`, `hero-inner`, `hero-copy`, `hero-slogan`, `hero-phone`, `section`, `container`, `narrow`, `steps`, `step`, `step-num`, `audience`, `is-reverse`, `audience-grid`, `audience-copy`, `audience-media`, `audience-photo`, `audience-phones`, `features`, `competitions-grid`, `competitions-video`, `phone-video`, `points`, `faq`, `faq-item`, `faq-icon`, `final`, `final-inner`, `site-footer`, `footer-grid`, `footer-tagline`, `footer-title`, `footer-contact`, `credits`, `footer-legal`.

- [ ] **Step 1: Write the failing page tests**

Replace `apps/landing/src/App.test.tsx`:
```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { FinalCta } from './components/FinalCta';
import { copies, LANGS, STORAGE_KEY, type Lang } from './content';
import { mailto } from './links';
import { media } from './media';

beforeEach(() => {
  localStorage.clear();
  if (!document.querySelector('meta[name="description"]')) {
    const meta = document.createElement('meta');
    meta.name = 'description';
    document.head.append(meta);
  }
});

function openIn(lang: Lang) {
  window.history.replaceState(null, '', `/?lang=${lang}`);
  return render(<App />);
}

it('opens in the language of the address and lays Arabic out right to left', () => {
  openIn('ar');
  expect(document.documentElement).toHaveAttribute('lang', 'ar');
  expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  expect(document.title).toBe(copies.ar.meta.title);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copies.ar.hero.title);
});

it('switching language updates the page, the address and the stored choice', async () => {
  openIn('ar');
  await userEvent.click(screen.getAllByRole('button', { name: 'English' })[0]);
  expect(document.documentElement).toHaveAttribute('lang', 'en');
  expect(document.documentElement).toHaveAttribute('dir', 'ltr');
  expect(new URLSearchParams(window.location.search).get('lang')).toBe('en');
  expect(localStorage.getItem(STORAGE_KEY)).toBe('en');
  expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', copies.en.meta.description);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copies.en.hero.title);
});

it.each(LANGS)('every image and the video have a text alternative in %s', (lang) => {
  const { container } = openIn(lang);
  const images = [...container.querySelectorAll('img')];
  expect(images.length).toBeGreaterThanOrEqual(10);
  for (const img of images) {
    expect(img.hasAttribute('alt'), img.src).toBe(true);
    // The logo sits in a link that already says "Fitness League": its alt is empty on purpose.
    if (!img.closest('.brand')) expect(img.alt.trim(), img.src).not.toBe('');
  }
  expect(container.querySelector('video')).toHaveAttribute('aria-label', copies[lang].competitions.videoLabel);
});

it('every button writes to the team with the subject of its audience', () => {
  openIn('en');
  const t = copies.en;
  const href = (name: string) => screen.getAllByRole('link', { name })[0].getAttribute('href');
  expect(href(t.audienceCta.athlete)).toMatch(/^mailto:ahmedakremi42@gmail\.com\?subject=/);
  expect(href(t.audienceCta.athlete)).toBe(mailto(t.mail.athlete));
  expect(href(t.athletes.cta)).toBe(mailto(t.mail.athlete));
  expect(href(t.competitions.cta)).toBe(mailto(t.mail.athlete));
  expect(href(t.audienceCta.gym)).toBe(mailto(t.mail.gym));
  expect(href(t.gyms.cta)).toBe(mailto(t.mail.gym));
  expect(href(t.audienceCta.organizer)).toBe(mailto(t.mail.organizer));
  expect(href(t.organizers.cta)).toBe(mailto(t.mail.organizer));
  expect(href(t.nav.contact)).toBe(mailto(t.mail.contact));
});

it('the FAQ opens one answer at a time', async () => {
  openIn('en');
  const [first, second] = copies.en.faq.items;
  const q1 = screen.getByRole('button', { name: first.q });
  const q2 = screen.getByRole('button', { name: second.q });
  expect(q1).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(first.a)).toBeVisible();

  await userEvent.click(q2);
  expect(q2).toHaveAttribute('aria-expanded', 'true');
  expect(q1).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText(first.a)).not.toBeVisible();

  await userEvent.click(q2);
  expect(q2).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText(second.a)).not.toBeVisible();
});

it('the phone menu closes with Escape and after choosing a link', async () => {
  openIn('en');
  const t = copies.en;
  const toggle = screen.getByRole('button', { name: t.nav.menu });
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(toggle).toHaveAccessibleName(t.nav.closeMenu);

  await userEvent.keyboard('{Escape}');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await userEvent.click(toggle);
  await userEvent.click(within(document.getElementById('site-menu')!).getByRole('link', { name: t.nav.faq }));
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

it('the video downloads nothing before play and offers a link when it cannot play', () => {
  const { container } = openIn('fr');
  const video = container.querySelector('video')!;
  expect(video).toHaveAttribute('preload', 'none');
  expect(video.querySelector('source')).toHaveAttribute('src', media.tutorial);
  expect(within(video).getByRole('link', { name: copies.fr.competitions.videoDownload })).toHaveAttribute('href', media.tutorial);
});

it('keeps the email address left to right on the Arabic page', () => {
  openIn('ar');
  expect(screen.getByText('ahmedakremi42@gmail.com').closest('bdi')).toHaveAttribute('dir', 'ltr');
});

it('shows WhatsApp only once a number is configured', () => {
  const t = copies.en;
  const { rerender } = render(<FinalCta t={t} whatsapp="" />);
  expect(screen.queryByRole('link', { name: t.whatsapp.label })).toBeNull();
  rerender(<FinalCta t={t} whatsapp="+216 20 123 456" />);
  expect(screen.getByRole('link', { name: t.whatsapp.label })).toHaveAttribute('href', 'https://wa.me/21620123456?text=Hello%20Fitness%20League!');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/landing && pnpm vitest run src/App.test.tsx`
Expected: FAIL, "Failed to resolve import "./components/FinalCta"".

- [ ] **Step 3: Write the language hook**

`apps/landing/src/useLang.ts`:
```ts
import { useCallback, useEffect, useState } from 'react';
import { copies, dirOf, readStoredLang, resolveLang, storeLang, type Lang } from './content';

function initialLang(): Lang {
  const browser = navigator.languages?.length ? navigator.languages : [navigator.language];
  return resolveLang({ search: window.location.search, stored: readStoredLang(), browser });
}

/** The page language, applied to <html>, the title and the description. A choice is remembered and put in the address. */
export function useLang(): [Lang, (lang: Lang) => void] {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    const t = copies[lang];
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
    document.title = t.meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.meta.description);
  }, [lang]);

  const choose = useCallback((next: Lang) => {
    storeLang(next);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState(null, '', url);
    setLang(next);
  }, []);

  return [lang, choose];
}
```

- [ ] **Step 4: Write the sections**

`apps/landing/src/components/Header.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { Copy, Lang } from '../content';
import { mailto } from '../links';
import { media } from '../media';
import { LangSwitch } from './LangSwitch';

export function Header({ t, lang, onLang }: { t: Copy; lang: Lang; onLang: (lang: Lang) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const links = [
    ['#athletes', t.nav.athletes],
    ['#competitions', t.nav.competitions],
    ['#gyms', t.nav.gyms],
    ['#organizers', t.nav.organizers],
    ['#faq', t.nav.faq],
  ] as const;

  return (
    <header className="site-header">
      <div className="container header-inner">
        <a className="brand" href="#top" aria-label={t.nav.home}>
          <img src={media.logo} alt="" width={32} height={32} />
          <span>Fitness League</span>
        </a>
        <nav id="site-menu" className={`site-nav ${open ? 'is-open' : ''}`.trim()} aria-label={t.nav.main}>
          <ul>
            {links.map(([href, label]) => (
              <li key={href}>
                <a href={href} onClick={() => setOpen(false)}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <LangSwitch lang={lang} onLang={onLang} label={t.nav.language} />
        </nav>
        <a className="btn btn-primary btn-small header-contact" href={mailto(t.mail.contact)}>
          {t.nav.contact}
        </a>
        <button type="button" className="menu-toggle" aria-expanded={open} aria-controls="site-menu" aria-label={open ? t.nav.closeMenu : t.nav.menu} onClick={() => setOpen((o) => !o)}>
          <span className="menu-icon" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
```

`apps/landing/src/components/Hero.tsx`:
```tsx
import type { Copy } from '../content';
import { media } from '../media';
import { AudienceCtas } from './Cta';
import { PhoneFrame } from './PhoneFrame';
import { StoreBadges } from './StoreBadges';

export function Hero({ t }: { t: Copy }) {
  return (
    <section id="top" className="hero">
      <img className="hero-photo" src={media.hero} srcSet={`${media.heroSmall} 800w, ${media.hero} 1600w`} sizes="100vw" alt={t.hero.photoAlt} fetchPriority="high" />
      <div className="container hero-inner">
        <div className="hero-copy">
          <p className="eyebrow">{t.hero.eyebrow}</p>
          <h1 className="display">{t.hero.title}</h1>
          <p className="hero-slogan">{t.hero.slogan}</p>
          <p className="lead">{t.hero.lead}</p>
          <AudienceCtas t={t} />
          <StoreBadges t={t} />
        </div>
        <PhoneFrame className="hero-phone">
          <img src={media.screens.home} alt={t.hero.screenAlt} width={390} height={844} />
        </PhoneFrame>
      </div>
    </section>
  );
}
```

`apps/landing/src/components/HowItWorks.tsx`:
```tsx
import type { Copy } from '../content';
import { Reveal } from './Reveal';
import { SectionHead } from './SectionHead';

export function HowItWorks({ t }: { t: Copy }) {
  return (
    <section id="how" className="section" aria-labelledby="how-title">
      <div className="container">
        <SectionHead id="how-title" eyebrow={t.how.eyebrow} title={t.how.title} />
        <ol className="steps">
          {t.how.steps.map((step, i) => (
            <li key={step.title}>
              <Reveal className="step">
                <span className="step-num" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

`apps/landing/src/components/Audience.tsx` (one component for the athletes, gyms and organizers sections):
```tsx
import type { Copy } from '../content';
import { Cta } from './Cta';
import { CheckIcon } from './icons';
import { PhoneFrame } from './PhoneFrame';
import { Reveal } from './Reveal';
import { SectionHead } from './SectionHead';

type AudienceCopy = Copy['athletes'];

export function Audience({ id, copy, subject, photo, screens, reverse = false }: { id: string; copy: AudienceCopy; subject: string; photo: string; screens: readonly string[]; reverse?: boolean }) {
  return (
    <section id={id} className={`section audience ${reverse ? 'is-reverse' : ''}`.trim()} aria-labelledby={`${id}-title`}>
      <div className="container audience-grid">
        <div className="audience-copy">
          <SectionHead id={`${id}-title`} eyebrow={copy.eyebrow} title={copy.title} intro={copy.intro} />
          <ul className="features">
            {copy.features.map((feature) => (
              <li key={feature.title}>
                <CheckIcon />
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <Cta subject={subject}>{copy.cta}</Cta>
        </div>
        <Reveal className="audience-media">
          <img className="audience-photo" src={photo} alt={copy.photoAlt} loading="lazy" width={1200} height={900} />
          <div className="audience-phones">
            {screens.map((src, i) => (
              <PhoneFrame key={src}>
                <img src={src} alt={copy.screenAlts[i]} loading="lazy" width={390} height={844} />
              </PhoneFrame>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
```

`apps/landing/src/components/Competitions.tsx`:
```tsx
import type { Copy } from '../content';
import { media } from '../media';
import { Cta } from './Cta';
import { PhoneFrame } from './PhoneFrame';
import { Reveal } from './Reveal';
import { SectionHead } from './SectionHead';

export function Competitions({ t }: { t: Copy }) {
  const c = t.competitions;
  return (
    <section id="competitions" className="section competitions" aria-labelledby="competitions-title">
      <div className="container competitions-grid">
        <Reveal className="competitions-video">
          <PhoneFrame className="phone-video">
            <video controls playsInline preload="none" poster={media.screens.competitions} aria-label={c.videoLabel}>
              <source src={media.tutorial} type="video/mp4" />
              <p>
                {c.videoFallback}{' '}
                <a href={media.tutorial} download>
                  {c.videoDownload}
                </a>
              </p>
            </video>
          </PhoneFrame>
        </Reveal>
        <div>
          <SectionHead id="competitions-title" eyebrow={c.eyebrow} title={c.title} intro={c.intro} />
          <ul className="points">
            {c.points.map((point) => (
              <li key={point.title}>
                <h3>{point.title}</h3>
                <p>{point.text}</p>
              </li>
            ))}
          </ul>
          <Cta subject={t.mail.athlete}>{c.cta}</Cta>
        </div>
      </div>
    </section>
  );
}
```

`apps/landing/src/components/Faq.tsx`:
```tsx
import { useState } from 'react';
import type { Copy } from '../content';
import { SectionHead } from './SectionHead';

export function Faq({ t }: { t: Copy }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="section" aria-labelledby="faq-title">
      <div className="container narrow">
        <SectionHead id="faq-title" eyebrow={t.faq.eyebrow} title={t.faq.title} />
        <div className="faq">
          {t.faq.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className={`faq-item ${isOpen ? 'is-open' : ''}`.trim()}>
                <h3>
                  <button type="button" id={`faq-q-${i}`} aria-expanded={isOpen} aria-controls={`faq-a-${i}`} onClick={() => setOpen(isOpen ? null : i)}>
                    <span>{item.q}</span>
                    <span className="faq-icon" aria-hidden="true" />
                  </button>
                </h3>
                <div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} hidden={!isOpen}>
                  <p>{item.a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
```

`apps/landing/src/components/FinalCta.tsx`:
```tsx
import { config } from '../config';
import type { Copy } from '../content';
import { whatsappLink } from '../links';
import { AudienceCtas } from './Cta';

export function FinalCta({ t, whatsapp = config.whatsapp }: { t: Copy; whatsapp?: string }) {
  const chat = whatsappLink(t.whatsapp.message, whatsapp);
  return (
    <section className="section final" aria-labelledby="final-title">
      <div className="container">
        <div className="final-inner">
          <h2 id="final-title" className="display">
            {t.final.title}
          </h2>
          <p className="lead">{t.final.text}</p>
          <AudienceCtas t={t} />
          {chat && (
            <a className="btn btn-ghost" href={chat} target="_blank" rel="noopener noreferrer">
              {t.whatsapp.label}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
```

`apps/landing/src/components/Footer.tsx`:
```tsx
import { config } from '../config';
import type { Copy, Lang } from '../content';
import { credits } from '../credits';
import { mailto } from '../links';
import { media } from '../media';
import { LangSwitch } from './LangSwitch';

export function Footer({ t, lang, onLang }: { t: Copy; lang: Lang; onLang: (lang: Lang) => void }) {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <a className="brand" href="#top" aria-label={t.nav.home}>
            <img src={media.logo} alt="" width={32} height={32} />
            <span>Fitness League</span>
          </a>
          <p className="footer-tagline">{t.footer.tagline}</p>
        </div>
        <div className="footer-contact">
          <h2 className="footer-title">{t.footer.contact}</h2>
          <a href={mailto(t.mail.contact)}>
            <bdi dir="ltr">{config.contactEmail}</bdi>
          </a>
          <LangSwitch lang={lang} onLang={onLang} label={t.nav.language} />
        </div>
        <details className="credits">
          <summary>{t.footer.credits}</summary>
          <p>{t.footer.creditsIntro}</p>
          <ul>
            {credits.map((credit) => (
              <li key={credit.file}>
                <a href={credit.source} target="_blank" rel="noopener noreferrer">
                  <bdi>{credit.photographer}</bdi>
                </a>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className="container footer-legal">
        <p>{t.footer.trademarks}</p>
        <p>{t.footer.rights}</p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 5: Rewrite the App**

`apps/landing/src/App.tsx`:
```tsx
import { Audience } from './components/Audience';
import { Competitions } from './components/Competitions';
import { Faq } from './components/Faq';
import { FinalCta } from './components/FinalCta';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { HowItWorks } from './components/HowItWorks';
import { copies } from './content';
import { media } from './media';
import { useLang } from './useLang';

export function App() {
  const [lang, setLang] = useLang();
  const t = copies[lang];
  return (
    <>
      <a className="skip-link" href="#main">
        {t.nav.skip}
      </a>
      <Header t={t} lang={lang} onLang={setLang} />
      <main id="main">
        <Hero t={t} />
        <HowItWorks t={t} />
        <Audience id="athletes" copy={t.athletes} subject={t.mail.athlete} photo={media.athletes} screens={[media.screens.league, media.screens.train]} />
        <Competitions t={t} />
        <Audience id="gyms" copy={t.gyms} subject={t.mail.gym} photo={media.gyms} screens={[media.screens.gym]} reverse />
        <Audience id="organizers" copy={t.organizers} subject={t.mail.organizer} photo={media.organizers} screens={[media.screens.competitions]} />
        <Faq t={t} />
        <FinalCta t={t} />
      </main>
      <Footer t={t} lang={lang} onLang={setLang} />
    </>
  );
}
```

- [ ] **Step 6: Run every test and the typecheck**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/landing && pnpm test && pnpm typecheck`
Expected: every suite passes (lang, links, content, media, blocks, App); typecheck clean.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/landing/src
git commit -m "feat(landing): the page: header, hero, how it works, audiences, competitions, FAQ, footer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Look, fonts and the visual check

**Files:**
- Modify: `apps/landing/src/main.tsx` (font imports), `apps/landing/src/styles.css` (full stylesheet)
- Create (not committed): `<scratchpad>/shots.cjs`
- Output (not committed): `/mnt/c/Users/GIGABYTE/Desktop/landing-page/*.png`

**Interfaces:**
- Consumes: the ids and class names listed in Task 7.

- [ ] **Step 1: Import the fonts**

`apps/landing/src/main.tsx`:
```tsx
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/cairo/arabic-400.css';
import '@fontsource/cairo/arabic-700.css';
import '@fontsource/cairo/arabic-800.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Check the files exist: `ls /mnt/c/Users/GIGABYTE/fitness-league/apps/landing/node_modules/@fontsource/cairo/arabic-800.css /mnt/c/Users/GIGABYTE/fitness-league/apps/landing/node_modules/@fontsource/inter/latin-600.css`. If a weight file is missing, use the nearest weight that exists and update the `font-weight` values in Step 2 to match.

- [ ] **Step 2: Write the stylesheet**

`apps/landing/src/styles.css` (colours from `apps/mobile-rn/src/core/theme/index.ts`, dark palette, accent `#C6F432`):
```css
:root {
  --bg: #0e0f12;
  --surface: #17191e;
  --surface-high: #20232a;
  --text: #e6e8ec;
  --soft: #b5bac3;
  --muted: #8c919b;
  --border: rgb(255 255 255 / 0.08);
  --accent: #c6f432;
  --accent-hover: #d6ff5c;
  --on-accent: #000;
  --radius: 20px;
  --radius-sm: 14px;
  --gutter: 16px;
  --max: 1160px;
  --header-h: 64px;
  --font-display: 'Barlow Condensed', 'Cairo', system-ui, sans-serif;
  --font-body: 'Inter', 'Cairo', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color-scheme: dark;
}

html[lang='ar'] {
  --font-display: 'Cairo', 'Barlow Condensed', system-ui, sans-serif;
  --font-body: 'Cairo', 'Inter', system-ui, sans-serif;
}

@media (min-width: 640px) {
  :root {
    --gutter: 24px;
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
}

@media (prefers-reduced-motion: no-preference) {
  html {
    scroll-behavior: smooth;
  }
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 400 16px/1.6 var(--font-body);
  -webkit-font-smoothing: antialiased;
}

img,
video {
  display: block;
  max-width: 100%;
  height: auto;
}

a {
  color: inherit;
}

h1,
h2,
h3,
p {
  margin: 0;
}

section[id] {
  scroll-margin-top: calc(var(--header-h) + 8px);
}

:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

.container {
  width: 100%;
  max-width: var(--max);
  margin-inline: auto;
  padding-inline: var(--gutter);
}

.narrow {
  max-width: 840px;
}

.skip-link {
  position: absolute;
  inset-inline-start: 8px;
  top: -60px;
  z-index: 100;
  padding: 10px 16px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 700;
  text-decoration: none;
}

.skip-link:focus {
  top: 8px;
}

/* Type */

.display {
  font-family: var(--font-display);
  font-weight: 800;
  text-transform: uppercase;
  line-height: 0.95;
  letter-spacing: -0.01em;
  text-wrap: balance;
}

html[lang='ar'] .display {
  text-transform: none;
  line-height: 1.3;
  letter-spacing: 0;
}

.eyebrow {
  color: var(--accent);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

html[lang='ar'] .eyebrow {
  font-size: 15px;
  letter-spacing: 0;
}

.lead {
  max-width: 60ch;
  color: var(--soft);
  font-size: 17px;
}

/* Buttons */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 10px 22px;
  border: 1.5px solid transparent;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  text-decoration: none;
  transition: transform 0.15s, background-color 0.15s, border-color 0.15s, color 0.15s;
}

.btn:active {
  transform: scale(0.98);
}

.btn-primary {
  background: var(--accent);
  color: var(--on-accent);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-ghost {
  border-color: rgb(255 255 255 / 0.24);
  background: rgb(255 255 255 / 0.04);
  color: var(--text);
}

.btn-ghost:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-small {
  min-height: 40px;
  padding: 8px 16px;
  font-size: 14px;
}

.cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

@media (max-width: 479px) {
  .cta-row .btn {
    flex: 1 1 100%;
  }
}

/* Header */

.site-header {
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid var(--border);
  background: rgb(14 15 18 / 0.85);
  backdrop-filter: saturate(140%) blur(14px);
}

.header-inner {
  display: flex;
  align-items: center;
  gap: 16px;
  height: var(--header-h);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-decoration: none;
  text-transform: uppercase;
  white-space: nowrap;
}

.brand img {
  border-radius: 8px;
}

.site-nav {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-inline-start: auto;
}

.site-nav ul {
  display: flex;
  gap: 22px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.site-nav a {
  color: var(--soft);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}

.site-nav a:hover {
  color: var(--accent);
}

.menu-toggle {
  display: none;
}

.menu-icon,
.menu-icon::before,
.menu-icon::after {
  display: block;
  position: relative;
  width: 18px;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  transition: transform 0.2s, background-color 0.2s;
}

.menu-icon::before,
.menu-icon::after {
  content: '';
  position: absolute;
  left: 0;
}

.menu-icon::before {
  top: -6px;
}

.menu-icon::after {
  top: 6px;
}

[aria-expanded='true'] .menu-icon {
  background: transparent;
}

[aria-expanded='true'] .menu-icon::before {
  transform: translateY(6px) rotate(45deg);
}

[aria-expanded='true'] .menu-icon::after {
  transform: translateY(-6px) rotate(-45deg);
}

@media (max-width: 899px) {
  .header-contact {
    display: none;
  }

  .menu-toggle {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-inline-start: auto;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  .site-nav {
    display: none;
    position: fixed;
    inset: var(--header-h) 0 auto 0;
    flex-direction: column;
    align-items: stretch;
    gap: 20px;
    margin: 0;
    padding: 8px var(--gutter) 24px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }

  .site-nav.is-open {
    display: flex;
  }

  .site-nav ul {
    flex-direction: column;
    gap: 0;
  }

  .site-nav a {
    display: block;
    padding: 14px 0;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    font-size: 18px;
  }

  .site-nav .lang-switch {
    align-self: flex-start;
  }
}

/* Language switch */

.lang-switch {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
}

.lang-switch button {
  min-width: 42px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font: 700 13px/1 'Inter', sans-serif;
  cursor: pointer;
}

.lang-switch button[lang='ar'] {
  font-family: 'Cairo', sans-serif;
  font-size: 16px;
}

.lang-switch button:hover {
  color: var(--text);
}

.lang-switch button[aria-pressed='true'] {
  background: var(--accent);
  color: var(--on-accent);
}

/* Hero */

.hero {
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  min-height: calc(100svh - var(--header-h));
  padding-block: 48px 72px;
  overflow: clip;
}

.hero-photo {
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 35% center;
}

.hero::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(180deg, rgb(14 15 18 / 0.5) 0%, rgb(14 15 18 / 0.72) 60%, var(--bg) 100%),
    linear-gradient(90deg, rgb(14 15 18 / 0.88) 0%, rgb(14 15 18 / 0.25) 100%);
}

html[dir='rtl'] .hero::after {
  background:
    linear-gradient(180deg, rgb(14 15 18 / 0.5) 0%, rgb(14 15 18 / 0.72) 60%, var(--bg) 100%),
    linear-gradient(270deg, rgb(14 15 18 / 0.88) 0%, rgb(14 15 18 / 0.25) 100%);
}

.hero-inner {
  display: grid;
  gap: 48px;
  align-items: center;
}

.hero h1 {
  margin-block: 14px 16px;
  font-size: clamp(56px, 12vw, 120px);
}

html[lang='ar'] .hero h1 {
  font-size: clamp(44px, 9vw, 88px);
}

.hero-slogan {
  margin-bottom: 16px;
  color: var(--accent);
  font-family: var(--font-display);
  font-size: clamp(20px, 3.2vw, 28px);
  font-weight: 700;
  line-height: 1.2;
  text-transform: uppercase;
}

html[lang='ar'] .hero-slogan {
  text-transform: none;
}

.hero .lead {
  margin-bottom: 28px;
  color: #d3d6dc;
}

.hero-phone {
  justify-self: center;
  width: min(300px, 76vw);
}

@media (min-width: 900px) {
  .hero-inner {
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.7fr);
  }

  .hero-phone {
    justify-self: end;
  }
}

.stores {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
}

.store {
  display: inline-flex;
  flex-direction: column;
  min-width: 150px;
  padding: 8px 16px;
  border: 1px solid rgb(255 255 255 / 0.18);
  border-radius: 12px;
  background: rgb(0 0 0 / 0.45);
  line-height: 1.25;
  text-decoration: none;
}

.store-name {
  font-size: 16px;
  font-weight: 700;
}

.store-note {
  color: var(--accent);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Phone frame */

.phone {
  position: relative;
  padding: 10px;
  border-radius: 44px;
  background: linear-gradient(145deg, #2b2e36, #101215);
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 0.08),
    0 30px 80px -20px rgb(0 0 0 / 0.85),
    0 0 120px -40px rgb(198 244 50 / 0.35);
}

.phone-screen {
  aspect-ratio: 390 / 844;
  overflow: hidden;
  border-radius: 34px;
  background: #000;
}

.phone-screen img,
.phone-screen video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.phone-video .phone-screen {
  aspect-ratio: 9 / 16;
}

/* Sections */

.section {
  padding-block: 72px;
}

@media (min-width: 900px) {
  .section {
    padding-block: 112px;
  }
}

.section-head {
  display: grid;
  gap: 14px;
  max-width: 720px;
  margin-bottom: 40px;
}

.section-head h2 {
  font-size: clamp(38px, 6.5vw, 64px);
}

html[lang='ar'] .section-head h2 {
  font-size: clamp(30px, 5vw, 48px);
}

/* How it works */

.steps {
  display: grid;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (min-width: 760px) {
  .steps {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.step {
  height: 100%;
  padding: 28px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.step-num {
  display: block;
  margin-bottom: 16px;
  color: var(--accent);
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 56px;
  font-weight: 800;
  line-height: 1;
}

.step h3 {
  margin-bottom: 8px;
  font-size: 20px;
}

.step p {
  color: var(--soft);
}

/* Audiences */

.audience-grid {
  display: grid;
  gap: 48px;
  align-items: center;
}

@media (min-width: 900px) {
  .audience-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 64px;
  }

  .audience.is-reverse .audience-copy {
    order: 2;
  }
}

.features {
  display: grid;
  gap: 18px;
  margin: 0 0 32px;
  padding: 0;
  list-style: none;
}

@media (min-width: 560px) {
  .features {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}

.features li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.features svg {
  flex: none;
  width: 24px;
  height: 24px;
  margin-top: 2px;
  color: var(--accent);
}

.features h3 {
  margin-bottom: 2px;
  font-size: 16px;
}

.features p {
  color: var(--soft);
  font-size: 15px;
  line-height: 1.5;
}

.audience-photo {
  width: 100%;
  aspect-ratio: 4 / 3;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  object-fit: cover;
}

.audience-phones {
  position: relative;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: -30%;
  padding-inline-end: 16px;
}

.audience-phones .phone {
  width: clamp(112px, 28%, 190px);
  padding: 6px;
  border-radius: 28px;
}

.audience-phones .phone-screen {
  border-radius: 22px;
}

/* Competitions */

.competitions {
  background: radial-gradient(60% 50% at 25% 40%, rgb(198 244 50 / 0.1), transparent 70%), var(--bg);
}

.competitions-grid {
  display: grid;
  gap: 48px;
  align-items: center;
}

@media (min-width: 900px) {
  .competitions-grid {
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: 72px;
  }
}

.competitions-video {
  justify-self: center;
  width: min(320px, 80vw);
}

.points {
  display: grid;
  gap: 12px;
  margin: 0 0 32px;
  padding: 0;
  list-style: none;
}

.points li {
  padding: 16px 20px;
  border: 1px solid var(--border);
  border-inline-start: 3px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.points h3 {
  margin-bottom: 4px;
  font-size: 17px;
}

.points p {
  color: var(--soft);
  font-size: 15px;
}

/* FAQ */

.faq {
  border-top: 1px solid var(--border);
}

.faq-item {
  border-bottom: 1px solid var(--border);
}

.faq-item h3 {
  font-size: inherit;
}

.faq-item button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 20px 0;
  border: 0;
  background: none;
  color: var(--text);
  font: 600 18px/1.4 var(--font-body);
  text-align: start;
  cursor: pointer;
}

.faq-item button:hover {
  color: var(--accent);
}

.faq-icon {
  position: relative;
  flex: none;
  width: 30px;
  height: 30px;
  border: 1px solid rgb(255 255 255 / 0.2);
  border-radius: 50%;
  transition: background-color 0.2s;
}

.faq-icon::before,
.faq-icon::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 12px;
  height: 2px;
  background: currentColor;
  translate: -50% -50%;
}

.faq-icon::after {
  rotate: 90deg;
  transition: rotate 0.2s;
}

.is-open .faq-icon {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

.is-open .faq-icon::after {
  rotate: 0deg;
}

.faq-item [role='region'] p {
  max-width: 68ch;
  padding-bottom: 22px;
  color: var(--soft);
}

/* Final call */

.final-inner {
  display: grid;
  justify-items: center;
  gap: 16px;
  padding: 56px 24px;
  border: 1px solid var(--border);
  border-radius: 28px;
  background: radial-gradient(80% 120% at 50% 0%, rgb(198 244 50 / 0.18), transparent 60%), var(--surface);
  text-align: center;
}

.final h2 {
  font-size: clamp(44px, 9vw, 88px);
}

.final .cta-row {
  justify-content: center;
  margin-top: 8px;
}

/* Footer */

.site-footer {
  padding-block: 48px 32px;
  border-top: 1px solid var(--border);
  background: #0a0b0d;
}

.footer-grid {
  display: grid;
  gap: 32px;
}

@media (min-width: 760px) {
  .footer-grid {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
  }
}

.footer-tagline {
  max-width: 42ch;
  margin-top: 12px;
  color: var(--muted);
}

.footer-title {
  margin-bottom: 10px;
  color: var(--muted);
  font-size: 13px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.footer-contact > a {
  display: inline-block;
  margin-bottom: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
  text-decoration: none;
}

.footer-contact > a:hover {
  color: var(--accent);
}

.credits summary {
  font-weight: 600;
  cursor: pointer;
}

.credits p {
  margin-block: 8px;
  color: var(--muted);
  font-size: 14px;
}

.credits ul {
  margin: 0;
  padding-inline-start: 18px;
  color: var(--muted);
  font-size: 14px;
}

.footer-legal {
  display: grid;
  gap: 6px;
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 13px;
}

/* Reveal on scroll */

.reveal {
  opacity: 0;
  transform: translateY(18px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}

.reveal.is-visible {
  opacity: 1;
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
```

- [ ] **Step 3: Build and serve the page**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/landing && pnpm build && ls -la dist dist/assets`, then start the preview in the background: `pnpm preview --host 127.0.0.1` (port 4174).
Expected: the build passes; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4174/` prints `200`.

- [ ] **Step 4: Write and run the visual check**

Locate the browser pieces noted in `handoff.md`: `ls ~/.npm/_npx/*/node_modules/playwright-core/package.json ~/.cache/ms-playwright/`. If `chrome-headless-shell` fails with a missing `libnspr4.so`, extract the libraries into the scratchpad: `cd <scratchpad> && apt-get download libnspr4 libnss3 libasound2t64 && for f in *.deb; do dpkg -x "$f" libs; done`, then run with `LD_LIBRARY_PATH=<scratchpad>/libs/usr/lib/x86_64-linux-gnu`.

`<scratchpad>/shots.cjs`:
```js
// Usage: node shots.cjs <playwright-core dir> <chrome-headless-shell path> <output dir>
const [pwDir, chrome, outDir] = process.argv.slice(2);
const { chromium } = require(pwDir);
const fs = require('node:fs');
fs.mkdirSync(outDir, { recursive: true });

const views = [
  { name: 'phone-320', width: 320, height: 720 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

(async () => {
  const browser = await chromium.launch({ executablePath: chrome });
  const problems = [];
  for (const lang of ['en', 'fr', 'ar']) {
    for (const view of views) {
      if (lang === 'fr' && view.name !== 'phone-390') continue;
      const page = await browser.newPage({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.width < 500 ? 2 : 1, reducedMotion: 'reduce' });
      await page.goto(`http://127.0.0.1:4174/?lang=${lang}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) {
        const culprits = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${el.className}`));
        problems.push(`${lang} ${view.name}: ${overflow}px horizontal overflow (${culprits.join(', ')})`);
      }
      await page.screenshot({ path: `${outDir}/${lang}-${view.name}.png`, fullPage: true });
      if (view.name === 'phone-390') {
        await page.click('.menu-toggle');
        await page.screenshot({ path: `${outDir}/${lang}-${view.name}-menu.png` });
      }
      await page.close();
    }
  }
  await browser.close();
  console.log(problems.length ? problems.join('\n') : 'no horizontal overflow');
  process.exit(problems.length ? 1 : 0);
})();
```

Run: `node <scratchpad>/shots.cjs <playwright-core dir> <chrome-headless-shell> /mnt/c/Users/GIGABYTE/Desktop/landing-page`
Expected: "no horizontal overflow", plus 11 PNG files in `Desktop/landing-page/`.

- [ ] **Step 5: Review the screenshots**

Open with the Read tool at least `en-desktop-1440.png`, `en-phone-390.png`, `ar-phone-390.png`, `ar-desktop-1440.png`, `en-phone-390-menu.png` and `fr-phone-390.png`. Check:
- The hero text is readable over the photo, and the phone does not cover the text.
- Arabic is mirrored: text on the right, phones on the left, FAQ icons on the left, the hero gradient dark on the right.
- No text is cut and no button label overflows.
- The phones in the audience sections overlap the bottom of the photo and do not cover each other.
- The French slogan and button labels fit at 390 px.

Fix any defect in `styles.css` (or a component's class names), rebuild, restart the preview and re-run Step 4 until the screenshots are clean. Note each fix in the commit message.

- [ ] **Step 6: Run every check**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/landing && pnpm test && pnpm typecheck && pnpm build`
Expected: all green.

- [ ] **Step 7: Open it for the owner**

Run: `cmd.exe /c start http://localhost:4174/` (the preview listens on 127.0.0.1:4174 inside WSL, which Windows reaches through `localhost`). If Windows cannot reach it, restart the preview with `--host 0.0.0.0`.

- [ ] **Step 8: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/landing/src/main.tsx apps/landing/src/styles.css
git commit -m "feat(landing): brand look, fonts, right-to-left Arabic layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Handoff and push

**Files:**
- Modify: `handoff.md`, `docs/superpowers/specs/2026-10-12-landing-page-design.md` (only if the build differed from the spec)

- [ ] **Step 1: Bring the spec in line with what was built**

These choices refine the spec; write them into its §2 if they are not there yet:
- Fonts come from the `@fontsource` packages (self-hosted WOFF2 bundled by Vite) rather than the app's TTF files.
- The athletes, gyms and organizers sections are one `Audience` component fed by the content.
- Four photos are used, not five; the competition floor photo was left out because it shows HYROX and Myprotein branding.
- Navigation order follows the page: Athletes · Competitions · Gyms · Organizers · FAQ.

- [ ] **Step 2: Update `handoff.md`**

Restore the committed bytes first (`git show HEAD:handoff.md > handoff.md`), then edit with the Edit tool:
- §1 Goal: add a bullet "Landing page" (owner's request 2026-10-12), with the owner's choices from the spec §0.
- §2 Current state: the branch `feat/landing`, the checks of the last run (test count, typecheck, build), the preview command and port, and the screenshots in `Desktop/landing-page/`. Also record that plan 1b of the Rust backend is merged (PR #7, `a9d425f`), which the 2026-10-07 handoff still describes as waiting for review.
- §3 Active files: the `apps/landing` tree.
- §5 Failed attempts: anything that failed during this plan (e.g. Unsplash pages answer "Authorization required" to `curl` from WSL, while the image CDN works and the pages can be read with the web fetcher).
- §6 Next steps: the launch blockers of the spec §4 (tutorial video watermarks, WhatsApp number, store links, hosting and domain, absolute `og:image` URL once the domain is known).

- [ ] **Step 3: Commit and push**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add handoff.md docs/superpowers/specs/2026-10-12-landing-page-design.md
git commit -m "docs: landing page handoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/landing
```

Expected: the branch appears on GitHub. `gh` is not installed and the GitHub MCP server does not connect, so the owner opens the PR `feat/landing` → `main` from the GitHub UI.
