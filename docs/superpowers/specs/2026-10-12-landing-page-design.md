# Landing page (marketing site) — design

Date: 2026-10-12 · Status: approved in chat (approach C) · Branch: `feat/landing`

## 0. Intent

**Asked by the owner**
- A landing page dedicated to Fitness League, with all the information, video and photos.
- No image from circle21.app (looked at as a reference for the kind of product, not for its assets).

**Owner's choices (brainstorming questions)**
- Audience: **athletes, gyms and organizers equally**, each with its own call to action.
- Photos: **free licensed stock** (Unsplash or Pexels: free for commercial use, no watermark), with a credits file; swappable later for the owner's own photos.
- Languages: **English, French and Arabic**, like the app; Arabic laid out right to left.
- Buttons: **contact links** for now (the app is not on the stores yet); email `ahmedakremi42@gmail.com`; WhatsApp button only once a number is given; store badges shown as "Coming soon".
- Video: **the existing tutorial video** (`Desktop/fitness/Fitness League - Tuto Competition.mp4`, 1080×1920, 73 s, 7.5 MB), as it is.
- Approach: **C — Vite + React**, same stack as the admin panel (Astro and plain HTML were offered).

**Assumptions**
- One single page; no blog, no account, no form that stores data.
- The page claims only what the app does today: no online payment, no push notifications, no prices (none decided), no specific event card (the demo event's date and details are not real).
- Hosting and domain are out of scope: the build produces a static `dist/` folder the owner can put on any host.

**Success criteria**
- `pnpm --filter @fitness-league/landing dev` shows the full page; `build` produces a static `dist/`.
- The page reads correctly in EN, FR and AR (AR right to left), on a 390 px phone and a 1440 px desktop.
- Every button opens an email to the contact address with a subject for its audience.
- No Circle21 asset and no Alamy preview photo in the page; every stock photo is listed in `CREDITS.md`.
- Tests, typecheck and build green locally and in a new CI job.

## 1. Content (one page, top to bottom)

| # | Section | Content |
|---|---|---|
| 1 | Header | App logo, links in page order Athletes · Competitions · Gyms · Organizers · FAQ, EN/FR/AR switch, "Contact" button. Sticky; a menu button on phones. |
| 2 | Hero | Full-width licensed workout photo under a dark gradient; headline "Climb the League."; slogan "Compete with yourself. Challenge your friends. Represent your gym. Climb the League."; three buttons *I'm an athlete* / *I run a gym* / *I organize events*; Home screen in a phone frame; App Store / Google Play badges "Coming soon". |
| 3 | How it works | Three steps: log your training → earn LP for progress, consistency and verified effort (not absolute strength) → climb the ranks (country, city, gym, week). |
| 4 | For athletes | Season LP and tiers, personal records, goals, streaks, friends and battles, feed; real screenshots. Button: join (email). |
| 5 | Competitions | Tutorial video in a phone frame; online qualifiers with YouTube video proof, scores computed from the reps of each movement, live leaderboard, categories and prizes, judges who review every video. |
| 6 | For gyms | Gym page and members, gym WODs, gym wars, leagues, "Represent your gym". Button: register your gym (email). |
| 7 | For organizers | Host a competition: categories, WOD builder with points per rep, judge and head-judge accounts, own banner, published leaderboards, news posts to every athlete. Button: host your event (email). |
| 8 | FAQ | 6 to 8 questions, e.g. is it free to join, which sports, how cheating is prevented, how judges work, which countries, when the app reaches the stores. Accordion. |
| 9 | Final call + footer | The three buttons again; contact email; language switch; link to the photo credits; © Fitness League. |

Email subjects (in the page's language): "Athlete – join Fitness League", "Gym – register", "Organizer – host an event", "Contact".

## 2. Build

**App:** `apps/landing`, package `@fitness-league/landing`; Vite 7, React 19, TypeScript 5.8, Vitest + Testing Library + jsdom; versions, scripts (`dev`, `build`, `preview`, `typecheck`, `lint`, `test`) and `tsconfig.json` copied from `apps/admin`. No router (one page). Dev server on port 5174 (5173 is the admin panel).

**Files**
- `src/content/en.ts` — every text of the page; exports the `Copy` type. `fr.ts` and `ar.ts` are typed `Copy`, so a missing key fails the typecheck. Alt texts live here too.
- `src/content/index.ts` — `Lang = 'en' | 'fr' | 'ar'`, `copies`, `resolveLang()`.
- `src/config.ts` — `contactEmail`, `whatsapp` (empty string → button hidden), `stores.appStore` / `stores.googlePlay` (empty → "Coming soon" badge).
- `src/links.ts` — `mailto(subject)` and `whatsappLink(text)` builders.
- `src/components/` — `Header`, `Hero`, `HowItWorks`, `Audience` (one component for the athletes, gyms and organizers sections, fed by the content), `Competitions`, `Faq`, `FinalCta`, `Footer`, `PhoneFrame`, `Cta`, `StoreBadges`, `LangSwitch`, `Reveal`, `SectionHead`.
- `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `index.html` (default meta in English, Open Graph image).

**Language**
- Order: `?lang=` in the address → the visitor's last choice (`localStorage`, read and written inside try/catch) → the browser language (`navigator.languages`, first match) → English. An unknown value is ignored.
- Switching sets `<html lang>` and `<html dir>` (`rtl` for Arabic), updates `?lang=` with `history.replaceState`, the document title and the meta description.
- CSS uses logical properties (`margin-inline-start`, `inset-inline-end`, `text-align: start`) so the layout mirrors in Arabic without a second stylesheet; arrows and the phone/text order flip with `dir`.

**Look**
- The app's colours: dark background, lime accent (taken from `apps/mobile-rn/src/core/theme/index.ts`), white text, hairline borders.
- Fonts self-hosted through the `@fontsource` packages (WOFF2 bundled by Vite, smaller than the app's TTF files): Barlow Condensed (headings, uppercase), Inter (text) and Cairo (SIL Open Font License) for Arabic, which the two others lack.
- Entrance fade/slide on scroll (`IntersectionObserver`), disabled under `prefers-reduced-motion`.
- Mobile first; one column on phones, two columns (text + phone) from 900 px.

**Media (`public/media/`)**
- Screenshots: from `Desktop/ui-avant-apres/apres/` and `Desktop/accueil-actualites/`, resized and converted to WebP. Only screens that do not show the default competition banner (it carries Alamy watermarks).
- Stock photos: 4 functional fitness photos from Unsplash (free, none from Unsplash+), at most 1600 px wide, WebP; photos showing CrossFit, HYROX or Myprotein branding were left out (the licence does not cover trademarks). `apps/landing/CREDITS.md` lists for each: file, photographer, source URL, licence. The credits are linked from the footer.
- Video: the tutorial video copied as is, `preload="none"`, a screenshot as poster, native controls, plays inside a phone frame; nothing is downloaded until play.
- Logo: `apps/mobile-rn/assets/icon.png` (resized) and the favicon.
- Media conversion is a one-time step with `sharp` (already a dependency of `apps/api`); only the outputs are committed.

## 3. Checks

**Tests (Vitest)**
- `resolveLang`: the address beats the stored choice, the stored choice beats the browser, the browser beats the default; an unknown value falls back; a throwing `localStorage` does not break it.
- The app in Arabic sets `dir="rtl"` and `lang="ar"`; switching back to English sets `ltr`.
- Each audience button's `href` is a `mailto:` to the contact address with its subject, encoded.
- WhatsApp button absent when `whatsapp` is empty, present with the number otherwise; store badges read "Coming soon" when the links are empty.
- Every `<img>` and the video have a non-empty `alt` / `aria-label` in each language.
- FAQ items open and close (`aria-expanded`).

**CI:** job `landing` in `.github/workflows/ci.yml`, same shape as `admin`: install, typecheck, test, build.

**Visual check:** screenshots of the built page at 390 px and 1440 px, in English and Arabic, saved to `Desktop/landing-page/`; the local preview opened in the owner's Windows browser.

**Docs:** README (repository layout + how to run the landing page), `handoff.md`.

## 4. Before going public (launch blockers)

1. **Tutorial video:** it shows the Alamy watermarks of the default competition banner. Re-render it after replacing `apps/mobile-rn/assets/competition-cover.jpg` with a licensed or own photo, then overwrite `public/media/tutorial.mp4`.
2. **WhatsApp number** and **store links**: fill `src/config.ts` when available.
3. **Hosting and domain**: choose a host; serve `dist/` with long cache headers on `/media` and `/fonts`.
