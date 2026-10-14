# Organizer Space — Lot A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any app user creates an event as a draft, prepares it in an organizer space inside the mobile app (dashboard with publication checklist, general info and banner, categories, WODs) and asks for publication; an admin publishes it or sends it back with a note from the admin panel.

**Architecture:** Three small backend changes in `apps/api` (creation open to all app users except judges; only a platform admin takes a competition out of `DRAFT`; a publication request with an admin note). Everything else is frontend: new screens under `apps/mobile-rn/src/features/competitions/organizer/` that call existing organizer routes, and a `PublicationPanel` in `apps/admin`. Pure helpers (`logic.ts`) hold the rules the screens share, so they are unit-tested on their own.

**Tech Stack:** NestJS + Prisma + PostgreSQL (Jest integration tests with supertest) · React Native / Expo Router + React Query (Jest + `expo-router/testing-library`, `FakeBackend`) · React + Vite admin panel (Vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-10-14-organizer-space-design.md` (annex: `docs/superpowers/specs/2026-10-14-organizer-space-gap-analysis.md`).

## Global Constraints

- Branch `feat/organizer-space` (from `origin/main` `ff5326d`). Stage files **by name**; never `git commit -a` or `git add -A`: `.gitignore`, `apps/mobile-rn/package-lock.json`, `infra/docker-compose.yml`, `infra/mariadb/init/01-accounts.sql` and three Rust plan/spec docs show as modified only by line endings. Check `git diff --cached --stat` before each commit. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Backend changes are limited to the spec's §2 table (creation rule, draft-exit rule, publication request). No other route, table or notification.
- Creation: any app account with a verified email, except `JUDGE` / `HEAD_JUDGE` → `403 FORBIDDEN` « Judge accounts cannot create competitions ».
- Draft exit: only a platform admin (`ADMIN`, `SUPER_ADMIN`) moves a competition out of `DRAFT`; organizer gets `403 FORBIDDEN` « An admin publishes the competition ».
- Publication request: columns `publication_requested_at TIMESTAMPTZ NULL`, `publication_note TEXT NULL`; `POST /competitions/:id/publication-request` (organizer, `DRAFT` only; checks banner, ≥1 active category, ≥1 active WOD, else `409 PRECONDITION_FAILED` with `missing: ('COVER'|'CATEGORY'|'WOD')[]`; already requested → current state, no error); `POST /admin/competitions/:id/publication-request/return` body `{ note }` 3–500 characters with at least one non-space, only while a request is waiting, else `409`; leaving `DRAFT` clears both fields.
- Money: TND, stored in millimes (35 TND = 35000).
- Slug made by the app: Latin letters/digits of the title + `-` + 4 random characters; no Latin letters → `event-xxxx`; server `TAKEN` → one retry with a new suffix.
- App link shared: `fitnessleague://competitions/<id>` (scheme `fitnessleague` from `app.json`).
- Banner: `PUT /competitions/:id/cover`, 5 MB max (PNG / JPEG / WebP), shown 1440×596.
- App text in `src/core/i18n/{en,fr,ar}.json` (the three files must have the same keys); the app speaks French with « tu ». Admin panel text in French.
- Mobile: no new dependency (AGENTS.md: run `npx tsc --noEmit` and the tests before declaring a task done; do not touch `android/` or `ios/`).
- Do not run Prettier on the admin panel (no config in the repo).

## Review Focus

1. **Titles with no Latin letter** (Arabic, emoji) and a slug already taken → a valid draft is still created (`event-xxxx`, one retry). → Task 4 (`slugFor`), Task 5 (taken slug retry).
2. **Double tap** on « Créer le brouillon » or « Demander la publication » → exactly one request. → Task 5, Task 6 tests.
3. **Edits after asking for publication** → the request stays; the admin publishes the current version. → Task 2 test (`PUT` after the request keeps `publicationRequestedAt`).
4. **Someone who is not (or no longer) organizer** opens `/competitions/<id>/manage` → « Accès réservé aux organisateurs », no edit control. → Task 6 test.
5. **Admin note made of spaces** → refused by the API and the panel button stays disabled. → Task 2 test, Task 3 test.

---

### Task 1: API — anyone drafts an event, only an admin publishes it

**Files:**
- Modify: `apps/api/src/modules/competitions/competitions.service.ts` (`create`, `setStatus`)
- Modify: `apps/api/test/helpers.ts` (add `adminAuth`, `appBearer`)
- Create: `apps/api/test/organizer-space.int-spec.ts`
- Modify: `apps/api/test/competitions.int-spec.ts:96`, `apps/api/test/competition-cover.int-spec.ts:43`, `apps/api/test/competition-movement-score.int-spec.ts:53`, `apps/api/test/announcements.int-spec.ts:167`
- Modify: `apps/api/scripts/demo-competition.ts` (the admin opens registration)

**Interfaces:**
- Produces: `adminAuth(app, prisma): Promise<{ authorization: string }>` and `appBearer(app, prisma, userId): Promise<{ authorization: string }>` in `test/helpers.ts`; the test file `organizer-space.int-spec.ts` with helpers `athlete()`, `draft(over?)`, used again by Task 2.

Prerequisite for every integration run: the embedded PostgreSQL of `handoff.md` §2 (`pnpm db:embedded` in `apps/api`, port 55432) must be running; start it in the background if `pnpm test:integration` cannot connect.

- [ ] **Step 1: Add the test helpers**

Append to `apps/api/test/helpers.ts`:
```ts
/** Admin-panel header of a fresh ADMIN account: publishing a draft competition is an admin action. */
export async function adminAuth(app: INestApplication, prisma: PrismaClient) {
  const u = await registerUser(app, prisma);
  await prisma.user.update({ where: { id: u.session.userId }, data: { role: 'ADMIN' } });
  return adminBearer(app, prisma, u.session.userId);
}

/** App-audience header for a user whose role was changed in the database (e.g. a judge-only account). */
export async function appBearer(app: INestApplication, prisma: PrismaClient, userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { token } = await app.get(TokenService).signAccess({ sub: u.id, role: u.role, sv: u.sessionVersion }, 'app');
  return { authorization: `Bearer ${token}` };
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/test/organizer-space.int-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { adminAuth, appBearer, registerUser, setupTestApp } from './helpers';

/** Organizer space (spec 2026-10-14): any app user drafts an event, only an admin publishes it. */
describe('Organizer space (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
  let n = 0;
  const draft = (over: Record<string, unknown> = {}) => ({
    title: 'Sousse Summer Throwdown',
    slug: `sousse-summer-${Date.now()}-${++n}`,
    description: 'Two days on site.',
    format: 'ONSITE',
    city: 'Sousse',
    location: 'Bodynade, Sousse',
    registrationStart: h(-1),
    registrationEnd: h(48),
    eventStart: h(72),
    eventEnd: h(96),
    registrationPrice: 30_000,
    ...over,
  });

  async function athlete(): Promise<{ id: string; token: string }> {
    const u = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: u.session.userId }, data: { emailVerifiedAt: new Date() } });
    const login = await api().post('/api/v1/auth/login').send({ email: u.body.email, password: u.body.password }).expect(200);
    return { id: u.session.userId, token: login.body.accessToken };
  }

  let user: { id: string; token: string };
  let admin: { authorization: string };
  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    user = await athlete();
    admin = await adminAuth(app, prisma);
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('a normal user drafts an event and becomes its organizer', async () => {
    const c = await api().post('/api/v1/competitions').set(bearer(user.token)).send(draft()).expect(201);
    expect(c.body.status).toBe('DRAFT');
    const staff = await prisma.competitionStaff.findMany({ where: { competitionId: c.body.id } });
    expect(staff).toEqual([expect.objectContaining({ userId: user.id, role: 'ORGANIZER' })]);
  });

  it('a judge account cannot create an event', async () => {
    const u = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: u.session.userId }, data: { role: 'JUDGE', emailVerifiedAt: new Date() } });
    const res = await api().post('/api/v1/competitions').set(await appBearer(app, prisma, u.session.userId)).send(draft()).expect(403);
    expect(res.body.detail).toBe('Judge accounts cannot create competitions');
  });

  it('the organizer cannot take the event out of draft; an admin can, then the organizer runs the next steps', async () => {
    const c = (await api().post('/api/v1/competitions').set(bearer(user.token)).send(draft()).expect(201)).body;
    await api().post(`/api/v1/competitions/${c.id}/categories`).set(bearer(user.token)).send({ name: 'RX Mixed', gender: 'MIXED' }).expect(201);
    const denied = await api().patch(`/api/v1/competitions/${c.id}/status`).set(bearer(user.token)).send({ status: 'REGISTRATION_OPEN' }).expect(403);
    expect(denied.body.detail).toBe('An admin publishes the competition');
    await api().patch(`/api/v1/admin/competitions/${c.id}/status`).set(admin).send({ status: 'REGISTRATION_OPEN' }).expect(200);
    await api().patch(`/api/v1/competitions/${c.id}/status`).set(bearer(user.token)).send({ status: 'REGISTRATION_CLOSED' }).expect(200);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/api && pnpm test:integration -- organizer-space`
Expected: FAIL. « a normal user drafts… » gets 403 « Organizers only »; the judge test gets 403 with detail « Organizers only »; the draft-exit test gets 403 on creation.

- [ ] **Step 4: Implement the two rules**

In `competitions.service.ts`, `create()`, replace the first line of the method body:
```ts
    if (!this.judging.isPlatformAdmin(user) && user.role !== 'GYM_ADMIN') throw AppException.forbidden('Organizers only');
```
with:
```ts
    // Any app account may draft an event (it stays invisible until an admin publishes it); judge-only accounts never organize.
    if (JUDGE_ROLES.includes(user.role)) throw AppException.forbidden('Judge accounts cannot create competitions');
```

In `setStatus()`, right after `if (!c) throw AppException.notFound('Competition');`, add:
```ts
      // Organizer space: the organizer prepares the draft, a platform admin publishes it.
      if (c.status === 'DRAFT' && !this.judging.isPlatformAdmin(user)) throw AppException.forbidden('An admin publishes the competition');
```

- [ ] **Step 5: Run the new tests**

Run: `pnpm test:integration -- organizer-space`
Expected: 3 passed.

- [ ] **Step 6: Move the existing tests and the demo script to the admin for publication**

Four existing tests open registration as the organizer; they now need an admin. Add `adminAuth` to the `./helpers` import of each file, then replace exactly these lines:

`test/competitions.int-spec.ts:96`
```ts
    await api().patch(`${base}/status`).set(bearer(organizer.token)).send({ status: 'REGISTRATION_OPEN' }).expect(200);
```
→
```ts
    await api().patch(`${base.replace('/competitions/', '/admin/competitions/')}/status`).set(await adminAuth(app, prisma)).send({ status: 'REGISTRATION_OPEN' }).expect(200);
```
`test/competition-cover.int-spec.ts:43` and `test/competition-movement-score.int-spec.ts:53`: the same replacement (same line text, `base` is `/api/v1/competitions/${id}` in both files).

`test/announcements.int-spec.ts:167`
```ts
    await api().patch(`/api/v1/competitions/${open}/status`).set(bearer(organizer.token)).send({ status: 'REGISTRATION_OPEN' }).expect(200);
```
→
```ts
    await api().patch(`/api/v1/admin/competitions/${open}/status`).set(await adminAuth(app, prisma)).send({ status: 'REGISTRATION_OPEN' }).expect(200);
```
The later status changes in these files (`REGISTRATION_CLOSED`, `SUBMISSION_OPEN`, …) stay with the organizer.

In `scripts/demo-competition.ts`: rename `judgeAccount` to `panelAccount`, widen its role type to `'JUDGE' | 'HEAD_JUDGE' | 'ADMIN'`, update its doc comment to « Panel account (judge, head judge or admin): created as an admin would, signed in to the admin panel. » and its one call site (`await judgeAccount(s.u, s.role)` → `await panelAccount(s.u, s.role)`). Then replace:
```ts
    await call('PATCH', `/competitions/${cid}/status`, org, { status: 'REGISTRATION_OPEN' });
```
with:
```ts
    // Organizer space: an admin publishes the draft.
    const admin = await panelAccount('competition_admin', 'ADMIN');
    await call('PATCH', `/admin/competitions/${cid}/status`, admin.token, { status: 'REGISTRATION_OPEN' });
```

- [ ] **Step 7: Run every check**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:integration`
Expected: all green; the integration count is the previous count + 3.

- [ ] **Step 8: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/api/src/modules/competitions/competitions.service.ts apps/api/test/helpers.ts apps/api/test/organizer-space.int-spec.ts apps/api/test/competitions.int-spec.ts apps/api/test/competition-cover.int-spec.ts apps/api/test/competition-movement-score.int-spec.ts apps/api/test/announcements.int-spec.ts apps/api/scripts/demo-competition.ts
git diff --cached --stat
git commit -m "feat(api): any app user drafts an event; only an admin takes it out of draft

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: API — publication request and the admin's note

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Competition`)
- Create: `apps/api/prisma/migrations/20261014120000_competition_publication_request/migration.sql`
- Modify: `apps/api/src/modules/competitions/competitions.service.ts` (`card`, `setStatus`, new `requestPublication`, `returnToDraft`)
- Modify: `apps/api/src/modules/competitions/competitions.dto.ts` (new `ReturnToDraftDto`)
- Modify: `apps/api/src/modules/competitions/competitions.controller.ts` (two routes)
- Test: `apps/api/test/organizer-space.int-spec.ts` (new cases)
- Modify: `docs/ARCHITECTURE.md` (routes and rules)

**Interfaces:**
- Consumes: Task 1's test file and helpers.
- Produces (read by the app and the panel): every competition card and detail carries `publicationRequestedAt: string | null` and `publicationNote: string | null`; routes `POST /competitions/:id/publication-request` (200, card) and `POST /admin/competitions/:id/publication-request/return` (200, card) with body `{ note }`; 409 body for an incomplete draft has `missing: ('COVER' | 'CATEGORY' | 'WOD')[]`.

- [ ] **Step 1: Write the failing tests**

Add at the top of `organizer-space.int-spec.ts`: `import sharp from 'sharp';`. Inside the `describe`, after the existing tests, add:
```ts
  const banner = () => sharp({ create: { width: 1600, height: 700, channels: 3, background: '#c6f432' } }).jpeg().toBuffer();

  /** A draft with its banner, one active category and one WOD. */
  async function readyDraft(owner = user): Promise<string> {
    const id = (await api().post('/api/v1/competitions').set(bearer(owner.token)).send(draft()).expect(201)).body.id;
    const base = `/api/v1/competitions/${id}`;
    await api().put(`${base}/cover`).set(bearer(owner.token)).attach('file', await banner(), 'cover.jpg').expect(200);
    await api().post(`${base}/categories`).set(bearer(owner.token)).send({ name: 'RX Mixed', gender: 'MIXED' }).expect(201);
    await api()
      .post(`${base}/wods`)
      .set(bearer(owner.token))
      .send({ number: 1, name: 'WOD 1', description: 'AMRAP 12', scoreType: 'REPS', scoringMethod: 'DIRECT_POINTS', maximumPoints: 100, submissionStart: h(72), submissionDeadline: h(90) })
      .expect(201);
    return id;
  }

  it('a publication request lists what the draft still misses', async () => {
    const id = (await api().post('/api/v1/competitions').set(bearer(user.token)).send(draft()).expect(201)).body.id;
    const res = await api().post(`/api/v1/competitions/${id}/publication-request`).set(bearer(user.token)).expect(409);
    expect(res.body.code).toBe('PRECONDITION_FAILED');
    expect(res.body.missing).toEqual(['COVER', 'CATEGORY', 'WOD']);
  });

  it('only an organizer asks for publication', async () => {
    const id = await readyDraft();
    const other = await athlete();
    await api().post(`/api/v1/competitions/${id}/publication-request`).set(bearer(other.token)).expect(403);
  });

  it('request → edits keep it → sent back with a note → asked again → published', async () => {
    const id = await readyDraft();
    const base = `/api/v1/competitions/${id}`;
    const asked = await api().post(`${base}/publication-request`).set(bearer(user.token)).expect(200);
    expect(asked.body.publicationRequestedAt).toEqual(expect.any(String));
    // Asking twice is harmless.
    await api().post(`${base}/publication-request`).set(bearer(user.token)).expect(200);
    // Editing the draft keeps the request: the admin publishes the current version.
    await api().put(base).set(bearer(user.token)).send({ title: 'Sousse Summer Throwdown 2026' }).expect(200);
    expect((await api().get(base).set(bearer(user.token)).expect(200)).body.publicationRequestedAt).toEqual(expect.any(String));

    const adminBase = `/api/v1/admin/competitions/${id}`;
    await api().post(`${adminBase}/publication-request/return`).set(admin).send({}).expect(422);
    await api().post(`${adminBase}/publication-request/return`).set(admin).send({ note: '      ' }).expect(422);
    const back = await api().post(`${adminBase}/publication-request/return`).set(admin).send({ note: 'The banner is blurred.' }).expect(200);
    expect(back.body).toMatchObject({ publicationRequestedAt: null, publicationNote: 'The banner is blurred.' });
    // A second admin acting on the same request: already handled.
    await api().post(`${adminBase}/publication-request/return`).set(admin).send({ note: 'Fix the dates.' }).expect(409);
    // The organizer sees the note in the detail and in "my competitions".
    expect((await api().get(base).set(bearer(user.token)).expect(200)).body.publicationNote).toBe('The banner is blurred.');
    const mine = await api().get('/api/v1/competitions').query({ filter: 'ALL', mine: 'true' }).set(bearer(user.token)).expect(200);
    expect(mine.body.find((c: { id: string }) => c.id === id)).toMatchObject({ status: 'DRAFT', publicationNote: 'The banner is blurred.' });

    const again = await api().post(`${base}/publication-request`).set(bearer(user.token)).expect(200);
    expect(again.body).toMatchObject({ publicationNote: null, publicationRequestedAt: expect.any(String) });
    await api().patch(`${adminBase}/status`).set(admin).send({ status: 'REGISTRATION_OPEN' }).expect(200);
    const published = (await api().get(base).set(bearer(user.token)).expect(200)).body;
    expect(published).toMatchObject({ status: 'REGISTRATION_OPEN', publicationRequestedAt: null, publicationNote: null });
    // Published: no more request.
    await api().post(`${base}/publication-request`).set(bearer(user.token)).expect(409);
  });

  it('the admin list shows the waiting request', async () => {
    const id = await readyDraft();
    await api().post(`/api/v1/competitions/${id}/publication-request`).set(bearer(user.token)).expect(200);
    const list = await api().get('/api/v1/admin/competitions').set(admin).expect(200);
    expect(list.body.find((c: { id: string }) => c.id === id).publicationRequestedAt).toEqual(expect.any(String));
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test:integration -- organizer-space`
Expected: the 4 new tests FAIL (404 on `publication-request`); the 3 tests of Task 1 still pass.

- [ ] **Step 3: Schema and migration**

In `prisma/schema.prisma`, model `Competition`, after the `leaderboardLockedAt` line, add:
```prisma
  /// Organizer asked the admins to publish this draft (organizer space); cleared when an admin publishes it or sends it back.
  publicationRequestedAt   DateTime?         @map("publication_requested_at") @db.Timestamptz
  /// Why an admin sent the draft back to its organizer.
  publicationNote          String?           @map("publication_note")
```
Create `prisma/migrations/20261014120000_competition_publication_request/migration.sql`:
```sql
-- Organizer space: the organizer asks the admins to publish a draft; an admin publishes it or sends it back with a note.
ALTER TABLE "competitions" ADD COLUMN "publication_requested_at" TIMESTAMPTZ;
ALTER TABLE "competitions" ADD COLUMN "publication_note" TEXT;
```
Run: `pnpm prisma:generate`
Expected: « Generated Prisma Client ».

- [ ] **Step 4: DTO**

In `competitions.dto.ts`, after `class StatusDto`:
```ts
export class ReturnToDraftDto {
  @ApiProperty({ example: 'The banner is blurred.' }) @IsString() @Length(3, 500) @Matches(/\S/) note!: string;
}
```

- [ ] **Step 5: Service**

In `card()`, after `participants,` add:
```ts
      publicationRequestedAt: c.publicationRequestedAt,
      publicationNote: c.publicationNote,
```
In `setStatus()`, replace:
```ts
      const updated = await tx.competition.update({ where: { id }, data: { status } });
```
with:
```ts
      // Leaving the draft (an admin publishing it) closes the publication request.
      const updated = await tx.competition.update({ where: { id }, data: { status, ...(c.status === 'DRAFT' ? { publicationRequestedAt: null, publicationNote: null } : {}) } });
```
Add these two methods after `setStatus()`:
```ts
  /** Organizer → admins: the draft is ready. Banner, an active category and an active WOD are checked first. */
  async requestPublication(user: AuthUser, id: string) {
    await this.judging.requireRole(user, id, ['ORGANIZER']);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.competition.findFirst({ where: { id, deletedAt: null }, include: { cover: true } });
      if (!c) throw AppException.notFound('Competition');
      if (c.status !== 'DRAFT') throw AppException.conflict(ErrorCode.PRECONDITION_FAILED, 'Only a draft can be submitted for publication');
      const missing: ('COVER' | 'CATEGORY' | 'WOD')[] = [];
      if (!c.cover || c.cover.status === 'DELETED') missing.push('COVER');
      if ((await tx.competitionCategory.count({ where: { competitionId: id, active: true } })) === 0) missing.push('CATEGORY');
      if ((await tx.competitionWorkout.count({ where: { competitionId: id, active: true } })) === 0) missing.push('WOD');
      if (missing.length) throw AppException.conflict(ErrorCode.PRECONDITION_FAILED, 'The draft is not complete', { missing });
      if (c.publicationRequestedAt) return this.card(c, 0);
      const updated = await tx.competition.update({ where: { id }, data: { publicationRequestedAt: this.clock.now(), publicationNote: null }, include: { cover: true } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.publication.requested', entityType: 'Competition', entityId: id }, tx);
      return this.card(updated, 0);
    });
  }

  /** Admin → organizer: the draft goes back with what to fix. A second admin acting on the same request gets 409. */
  async returnToDraft(user: AuthUser, id: string, note: string) {
    return this.prisma.$transaction(async (tx) => {
      const done = await tx.competition.updateMany({ where: { id, deletedAt: null, status: 'DRAFT', publicationRequestedAt: { not: null } }, data: { publicationRequestedAt: null, publicationNote: note.trim() } });
      if (done.count === 0) throw AppException.conflict(ErrorCode.PRECONDITION_FAILED, 'No publication request is waiting');
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.publication.returned', entityType: 'Competition', entityId: id, after: { note: note.trim() } }, tx);
      return this.card(await tx.competition.findFirstOrThrow({ where: { id }, include: { cover: true } }), 0);
    });
  }
```
(A draft has no confirmed registration, hence `participants` 0.)

- [ ] **Step 6: Controller**

Add `ReturnToDraftDto` to the `./competitions.dto` import list. In `CompetitionsController`, after the `@Patch(':id/status')` handler:
```ts
  /** Organizer space: ask the admins to publish this draft. */
  @Post(':id/publication-request')
  @HttpCode(HttpStatus.OK)
  requestPublication(@CurrentUser() user: AuthUser, @id() competitionId: string) {
    return this.competitions.requestPublication(user, competitionId);
  }
```
In `AdminCompetitionsController`, after its `@Patch(':id/status')` line:
```ts
  @Post(':id/publication-request/return') @HttpCode(HttpStatus.OK) returnToDraft(@CurrentUser() u: AuthUser, @id() cid: string, @Body() dto: ReturnToDraftDto) {
    return this.competitions.returnToDraft(u, cid, dto.note);
  }
```

- [ ] **Step 7: Run the tests**

Run: `pnpm test:integration -- organizer-space`
Expected: 7 passed.

- [ ] **Step 8: Document the routes**

In `docs/ARCHITECTURE.md`, in the competitions routes list (search `publish-leaderboard`), add:
```markdown
- `POST /competitions/:id/publication-request` — organizer asks the admins to publish a draft (409 `PRECONDITION_FAILED` with `missing: COVER|CATEGORY|WOD`). `POST /admin/competitions/:id/publication-request/return` `{ note }` — admin sends it back. Only a platform admin takes a competition out of `DRAFT`; any app account except judge accounts creates one (organizer space, 2026-10-14).
```

- [ ] **Step 9: Run every check and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:integration`
Expected: all green.
```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261014120000_competition_publication_request apps/api/src/modules/competitions/competitions.service.ts apps/api/src/modules/competitions/competitions.dto.ts apps/api/src/modules/competitions/competitions.controller.ts apps/api/test/organizer-space.int-spec.ts docs/ARCHITECTURE.md
git diff --cached --stat
git commit -m "feat(api): publication request: the organizer asks, an admin publishes or sends back a note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Admin panel — waiting requests first, publish or send back

**Files:**
- Create: `apps/admin/src/pages/publication.ts`, `apps/admin/src/pages/publication.test.ts`
- Create: `apps/admin/src/pages/PublicationPanel.tsx`, `apps/admin/src/pages/PublicationPanel.test.tsx`
- Modify: `apps/admin/src/pages/Competitions.tsx` (list order and badge, panel in the detail)
- Modify: `apps/admin/src/styles.css` (`.badge`)

**Interfaces:**
- Consumes: `publicationRequestedAt`, `publicationNote` on `GET /admin/competitions` and `GET /admin/competitions/:id`; `PATCH /admin/competitions/:id/status`; `POST /admin/competitions/:id/publication-request/return` (Task 2).
- Produces: `waitingFirst<T>(list: T[]): T[]`; `PublicationPanel({ competition, onDone })`.

- [ ] **Step 1: Write the failing tests**

`apps/admin/src/pages/publication.test.ts`:
```ts
import { waitingFirst } from './publication';

it('puts drafts waiting for publication first, oldest request first, then the rest in API order', () => {
  const list = [
    { id: 'a', publicationRequestedAt: null },
    { id: 'b', publicationRequestedAt: '2026-10-14T10:00:00.000Z' },
    { id: 'c', publicationRequestedAt: '2026-10-13T10:00:00.000Z' },
    { id: 'd' },
  ];
  expect(waitingFirst(list).map((c) => c.id)).toEqual(['c', 'b', 'a', 'd']);
});
```
`apps/admin/src/pages/PublicationPanel.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminApi } from '../api';
import { AuthProvider } from '../auth';
import { PublicationPanel } from './PublicationPanel';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const waiting = { id: 'c1', status: 'DRAFT', publicationRequestedAt: '2026-10-14T10:00:00.000Z', publicationNote: null };

function setup(competition: Record<string, unknown>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url).replace('/api/v1', '');
    calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return json(200, {});
  });
  const onDone = vi.fn();
  const api = new AdminApi('/api/v1', fetchFn as typeof fetch, memoryStorage());
  render(
    <AuthProvider api={api}>
      <PublicationPanel competition={competition} onDone={onDone} />
    </AuthProvider>,
  );
  return { calls, onDone };
}

describe('publication panel', () => {
  it('sends the draft back only with a real note', async () => {
    const { calls, onDone } = setup(waiting);
    const user = userEvent.setup();
    expect(screen.getByText(/Publication demandée/)).toBeInTheDocument();
    const back = screen.getByRole('button', { name: 'Renvoyer au brouillon' });
    expect(back).toBeDisabled();
    await user.type(screen.getByLabelText("Note pour l'organisateur"), '     ');
    expect(back).toBeDisabled();
    await user.clear(screen.getByLabelText("Note pour l'organisateur"));
    await user.type(screen.getByLabelText("Note pour l'organisateur"), '  Bannière floue ');
    await user.click(back);
    expect(calls).toContainEqual({ method: 'POST', path: '/admin/competitions/c1/publication-request/return', body: { note: 'Bannière floue' } });
    expect(onDone).toHaveBeenCalled();
  });

  it('publishes the draft', async () => {
    const { calls } = setup(waiting);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Publier' }));
    expect(calls).toContainEqual({ method: 'PATCH', path: '/admin/competitions/c1/status', body: { status: 'REGISTRATION_OPEN' } });
  });

  it('shows nothing once the competition is published', () => {
    const { container } = render(
      <AuthProvider api={new AdminApi('/api/v1', vi.fn() as unknown as typeof fetch, memoryStorage())}>
        <PublicationPanel competition={{ ...waiting, status: 'REGISTRATION_OPEN' }} onDone={vi.fn()} />
      </AuthProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/admin && pnpm test`
Expected: FAIL, « Failed to resolve import "./publication" » and « "./PublicationPanel" ».

- [ ] **Step 3: Implement**

`apps/admin/src/pages/publication.ts`:
```ts
/** Organizer space: drafts waiting for publication first (oldest request first), the rest in API order. */
export function waitingFirst<T extends { publicationRequestedAt?: string | null }>(list: T[]): T[] {
  const waiting = list.filter((c) => c.publicationRequestedAt).sort((a, b) => Date.parse(a.publicationRequestedAt!) - Date.parse(b.publicationRequestedAt!));
  return [...waiting, ...list.filter((c) => !c.publicationRequestedAt)];
}
```
`apps/admin/src/pages/PublicationPanel.tsx`:
```tsx
import { FormEvent, useState } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;

/** Organizer space: an admin publishes a draft, or sends it back to its organizer with a note. */
export function PublicationPanel({ competition: c, onDone }: { competition: J; onDone: () => unknown }) {
  const { api } = useAuth();
  const base = `/admin/competitions/${c.id}`;
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  if (c.status !== 'DRAFT') return null;

  async function act(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      setMessage(label);
      setNote('');
    } catch (err) {
      setMessage(errorText(err));
    }
    await onDone();
  }

  function sendBack(e: FormEvent) {
    e.preventDefault();
    void act("Renvoyée au brouillon : l'organisateur voit ta note.", () => api.post(`${base}/publication-request/return`, { note: note.trim() }));
  }

  return (
    <div className="panel">
      <h2>Publication</h2>
      {c.publicationRequestedAt ? (
        <p>
          <span className="badge">Publication demandée</span> le {new Date(c.publicationRequestedAt).toLocaleString('fr-FR')}
        </p>
      ) : (
        <p>L'organisateur n'a pas encore demandé la publication.</p>
      )}
      {c.publicationNote ? <p>Dernière note envoyée : « {c.publicationNote} »</p> : null}
      <p>
        <button type="button" onClick={() => void act('Compétition publiée : les inscriptions sont ouvertes.', () => api.patch(`${base}/status`, { status: 'REGISTRATION_OPEN' }))}>
          Publier
        </button>
      </p>
      {c.publicationRequestedAt ? (
        <form onSubmit={sendBack}>
          <label>
            Note pour l'organisateur
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </label>
          <button type="submit" disabled={note.trim().length < 3}>
            Renvoyer au brouillon
          </button>
        </form>
      ) : null}
      {message ? <p className="message">{message}</p> : null}
    </div>
  );
}
```
In `Competitions.tsx`: add the imports `import { waitingFirst } from './publication';` and `import { PublicationPanel } from './PublicationPanel';`; in the list replace `{(data ?? []).map((c) => (` with `{waitingFirst(data ?? []).map((c) => (` and the status cell `<td>{c.status}</td>` with:
```tsx
              <td>
                {c.status}
                {c.publicationRequestedAt ? <span className="badge">Publication demandée</span> : null}
              </td>
```
In `CompetitionDetail`, right after the `{message ? <p className="message">{message}</p> : null}` line that follows the status buttons, add:
```tsx
      <PublicationPanel competition={c} onDone={() => comp.reload()} />
```
Append to `apps/admin/src/styles.css`:
```css
.badge {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: #c6f432;
  color: #000;
  font-size: 0.8rem;
  font-weight: 600;
}
```

- [ ] **Step 4: Run the checks**

Run: `pnpm test && pnpm typecheck`
Expected: all pass (previous count + 4).

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/admin/src/pages/publication.ts apps/admin/src/pages/publication.test.ts apps/admin/src/pages/PublicationPanel.tsx apps/admin/src/pages/PublicationPanel.test.tsx apps/admin/src/pages/Competitions.tsx apps/admin/src/styles.css
git diff --cached --stat
git commit -m "feat(admin): drafts waiting for publication first; publish or send back with a note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: App — organizer client, shared rules and texts

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/logic.ts`
- Create: `apps/mobile-rn/src/features/competitions/organizer/api.ts`
- Test: `apps/mobile-rn/test/core/organizer-logic.test.ts`
- Modify: `apps/mobile-rn/src/core/i18n/en.json`, `fr.json`, `ar.json` (all lot A keys, added once here)

**Interfaces:**
- Produces (`logic.ts`): types `ManageTab = 'dashboard' | 'general' | 'categories' | 'wods'`, `ChecklistItem = 'DESCRIPTION' | 'DATES' | 'COVER' | 'CATEGORY' | 'WOD'`, `PublicationState = 'DRAFT' | 'REQUESTED' | 'RETURNED' | 'PUBLISHED'`, `EventFormat = 'ONSITE' | 'ONLINE' | 'HYBRID'`, `CatDraft`, `WodDraft`, `WodMovement`; constants `COVER_MAX_BYTES`, `CHECKLIST`, `TAB_FOR`, `ORGANIZER_NEXT`, `SCORE_TYPES`; functions `datesValid(d)`, `slugFor(title, suffix?)`, `randomSuffix()`, `missingForPublication(c)`, `publicationState(c)`, `toMillimes(text): number | null`, `fromMillimes(m)`, `nextWodNumber(workouts)`, `catDraft(c)`, `catValid(d)`, `catBody(d)`, `wodDraft(w, defaults)`, `wodValid(d)`, `wodBody(d)`.
- Produces (`api.ts`): `CompetitionInput`, `organizerApi(api)` with `create, update, remove, setStatus, requestPublication, dashboard, uploadCover, removeCover, addCategory, addTemplates, updateCategory, addWod, updateWod, removeWod, reorderWods`; `createWithFreeSlug(org, body)`; `useOrganizerDashboard(id)`; `useRefreshCompetition()`.

- [ ] **Step 1: Write the failing tests**

`apps/mobile-rn/test/core/organizer-logic.test.ts`:
```ts
import {
  catBody,
  catDraft,
  catValid,
  datesValid,
  fromMillimes,
  missingForPublication,
  nextWodNumber,
  publicationState,
  slugFor,
  toMillimes,
  wodBody,
  wodDraft,
  wodValid,
} from '../../src/features/competitions/organizer/logic';

const d = (iso: string) => new Date(iso);

describe('slugFor', () => {
  it('keeps the Latin letters and digits of the title and adds the suffix', () => {
    expect(slugFor('Sousse Summer Throwdown 2026!', 'ab12')).toBe('sousse-summer-throwdown-2026-ab12');
  });
  it('drops accents', () => expect(slugFor('Défi Été', 'x1y2')).toBe('defi-ete-x1y2'));
  it('falls back to event- when the title has no Latin letter', () => expect(slugFor('بطولة سوسة', 'k9z0')).toBe('event-k9z0'));
  it('always matches the server rule, 80 characters max', () => {
    for (const title of ['  --  ', '🏋️🔥', 'A'.repeat(200), 'Été — Sousse / Monastir']) expect(slugFor(title)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(slugFor('A'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe('dates and money', () => {
  it('uses the server rules for dates', () => {
    expect(datesValid({ registrationStart: d('2026-10-01'), registrationEnd: d('2026-10-10'), eventStart: d('2026-10-12'), eventEnd: d('2026-10-12') })).toBe(true);
    expect(datesValid({ registrationStart: d('2026-10-10'), registrationEnd: d('2026-10-10'), eventStart: d('2026-10-12'), eventEnd: d('2026-10-13') })).toBe(false);
    expect(datesValid({ registrationStart: d('2026-10-01'), registrationEnd: d('2026-10-10'), eventStart: d('2026-10-13'), eventEnd: d('2026-10-12') })).toBe(false);
  });
  it('reads TND amounts into millimes', () => {
    expect(toMillimes('35')).toBe(35000);
    expect(toMillimes('12,5')).toBe(12500);
    expect(toMillimes(' 0 ')).toBe(0);
    for (const bad of ['', 'abc', '-3', '1.2345']) expect(toMillimes(bad)).toBeNull();
    expect(fromMillimes(35000)).toBe('35');
    expect(fromMillimes(null)).toBe('');
  });
});

describe('publication', () => {
  const ready = {
    description: 'Two days on site.',
    deadlines: { registrationStart: '2026-10-01T00:00:00Z' },
    registrationEnd: '2026-10-10T00:00:00Z',
    eventStart: '2026-10-12T00:00:00Z',
    eventEnd: '2026-10-13T00:00:00Z',
    coverUrl: 'https://cdn/c.webp',
    categories: [{ id: 'k', active: true }],
    workouts: [{ id: 'w', number: 1 }],
    status: 'DRAFT',
  };
  it('lists what the draft misses', () => {
    expect(missingForPublication(ready)).toEqual([]);
    expect(missingForPublication({ ...ready, description: '  ', coverUrl: null, categories: [{ id: 'k', active: false }], workouts: [] })).toEqual(['DESCRIPTION', 'COVER', 'CATEGORY', 'WOD']);
  });
  it('tells the publication state', () => {
    expect(publicationState(ready)).toBe('DRAFT');
    expect(publicationState({ ...ready, publicationRequestedAt: '2026-10-14T10:00:00Z' })).toBe('REQUESTED');
    expect(publicationState({ ...ready, publicationNote: 'Blurred banner' })).toBe('RETURNED');
    expect(publicationState({ ...ready, status: 'REGISTRATION_OPEN' })).toBe('PUBLISHED');
  });
});

describe('categories', () => {
  it('validates and builds the request', () => {
    const c = { ...catDraft(null), name: 'RX Men 18-35', gender: 'MALE' as const, minAge: '18', maxAge: '35', level: 'RX', max: '40', price: '45' };
    expect(catValid(c)).toBe(true);
    expect(catBody(c)).toEqual({ name: 'RX Men 18-35', gender: 'MALE', minAge: 18, maxAge: 35, level: 'RX', maxParticipants: 40, registrationPriceOverride: 45000 });
    expect(catBody({ ...c, minAge: '', maxAge: '', max: '', price: '' })).toMatchObject({ minAge: null, maxAge: null, maxParticipants: null, registrationPriceOverride: null });
    expect(catValid({ ...c, name: 'R' })).toBe(false);
    expect(catValid({ ...c, minAge: '40' })).toBe(false);
    expect(catValid({ ...c, price: 'free' })).toBe(false);
  });
  it('reads an existing category', () => {
    expect(catDraft({ id: 'k', name: 'Scaled', gender: 'MIXED', minAge: null, maxAge: null, level: null, maxParticipants: null, registrationPriceOverride: 20000, active: false })).toEqual({
      id: 'k',
      name: 'Scaled',
      gender: 'MIXED',
      minAge: '',
      maxAge: '',
      level: '',
      max: '',
      price: '20',
      active: false,
    });
  });
});

describe('WODs', () => {
  const defaults = { number: 3, start: d('2026-10-12T08:00:00Z'), end: d('2026-10-13T18:00:00Z') };
  it('starts a new WOD on reps per movement, inside the event dates', () => {
    const w = wodDraft(null, defaults);
    expect(w).toMatchObject({ number: 3, name: 'WOD 3', scoreType: 'MOVEMENT_REPS', method: 'DIRECT_POINTS', max: '100' });
    expect(nextWodNumber([{ number: 1 }, { number: 4 }])).toBe(5);
    expect(nextWodNumber([])).toBe(1);
  });
  it('needs movements worth points for reps per movement', () => {
    const base = { ...wodDraft(null, defaults), description: 'AMRAP 12' };
    expect(wodValid({ ...base, movements: [{ name: '', points: '1' }] })).toBe(false);
    expect(wodValid({ ...base, movements: [{ name: 'Burpees', points: '0' }] })).toBe(false);
    const ok = { ...base, movements: [{ name: 'Burpees', points: '1' }, { name: 'Wall balls', points: '0,5' }, { name: '', points: '1' }] };
    expect(wodValid(ok)).toBe(true);
    expect(wodBody(ok)).toEqual({
      number: 3,
      name: 'WOD 3',
      description: 'AMRAP 12',
      standards: '',
      scoreType: 'MOVEMENT_REPS',
      scoringMethod: 'DIRECT_POINTS',
      maximumPoints: 100,
      minimumPoints: 0,
      movements: [
        { name: 'Burpees', pointsPerRep: 1 },
        { name: 'Wall balls', pointsPerRep: 0.5 },
      ],
      submissionStart: '2026-10-12T08:00:00.000Z',
      submissionDeadline: '2026-10-13T18:00:00.000Z',
    });
  });
  it('checks points, placement table, cap and dates', () => {
    const base = { ...wodDraft(null, defaults), description: 'For time', scoreType: 'TIME', movements: [] };
    expect(wodValid(base)).toBe(true);
    expect(wodValid({ ...base, min: '120' })).toBe(false);
    expect(wodValid({ ...base, method: 'PLACEMENT_POINTS', table: '100, 95, 97' })).toBe(false);
    expect(wodValid({ ...base, method: 'PLACEMENT_POINTS', table: '100, 95, 90' })).toBe(true);
    expect(wodBody({ ...base, method: 'PLACEMENT_POINTS', table: '100, 95, 90', capMin: '12' })).toMatchObject({ placementTable: [100, 95, 90], timeCapS: 720, movements: [] });
    expect(wodValid({ ...base, capMin: '0' })).toBe(false);
    expect(wodValid({ ...base, end: defaults.start })).toBe(false);
  });
  it('reads an existing WOD back', () => {
    const w = wodDraft(
      { id: 'w1', number: 2, name: 'WOD 2', description: 'x', standards: null, scoreType: 'TIME', scoringMethod: 'PLACEMENT_POINTS', placementTable: [100, 90], maximumPoints: 100, minimumPoints: 0, timeCapS: 600, videoUrl: null, movements: [], submissionStart: '2026-10-12T08:00:00Z', submissionDeadline: '2026-10-12T20:00:00Z' },
      defaults,
    );
    expect(w).toMatchObject({ id: 'w1', number: 2, method: 'PLACEMENT_POINTS', table: '100, 90', capMin: '10', standards: '', videoUrl: '' });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/mobile-rn && npx jest test/core/organizer-logic.test.ts`
Expected: FAIL, « Cannot find module '../../src/features/competitions/organizer/logic' ».

- [ ] **Step 3: Write `logic.ts`**

`apps/mobile-rn/src/features/competitions/organizer/logic.ts`:
```ts
import type { Json } from '../../../core/api/client';

/** Organizer space (spec 2026-10-14): the rules the organizer screens share. */

export type ManageTab = 'dashboard' | 'general' | 'categories' | 'wods';
export type ChecklistItem = 'DESCRIPTION' | 'DATES' | 'COVER' | 'CATEGORY' | 'WOD';
export type PublicationState = 'DRAFT' | 'REQUESTED' | 'RETURNED' | 'PUBLISHED';
export type EventFormat = 'ONSITE' | 'ONLINE' | 'HYBRID';

/** Banner limit of the API (PNG, JPEG or WebP). */
export const COVER_MAX_BYTES = 5 * 1024 * 1024;

export const CHECKLIST: ChecklistItem[] = ['DESCRIPTION', 'DATES', 'COVER', 'CATEGORY', 'WOD'];

/** Where each missing item is fixed. */
export const TAB_FOR: Record<ChecklistItem, ManageTab> = { DESCRIPTION: 'general', DATES: 'general', COVER: 'general', CATEGORY: 'categories', WOD: 'wods' };

/** The organizer's next statuses once an admin has published the event: the server's table minus cancellation, which stays with the admins. */
export const ORGANIZER_NEXT: Record<string, string[]> = {
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED'],
  REGISTRATION_CLOSED: ['REGISTRATION_OPEN', 'ACTIVE', 'SUBMISSION_OPEN'],
  ACTIVE: ['SUBMISSION_OPEN', 'JUDGING'],
  SUBMISSION_OPEN: ['JUDGING'],
  JUDGING: ['PROVISIONAL_LEADERBOARD'],
  PROVISIONAL_LEADERBOARD: ['JUDGING'],
  FINAL_LEADERBOARD: ['FINISHED'],
};

export const SCORE_TYPES = ['MOVEMENT_REPS', 'REPS', 'TIME', 'ROUNDS_REPS', 'LOAD', 'MAX_WEIGHT', 'DISTANCE', 'CALORIES', 'POINTS', 'COMPLEX'] as const;

const time = (v: unknown) => (typeof v === 'string' || v instanceof Date ? new Date(v).getTime() : NaN);

/** The server's rules: registration opens before it closes; the event does not end before it starts. */
export function datesValid(x: { registrationStart: unknown; registrationEnd: unknown; eventStart: unknown; eventEnd: unknown }): boolean {
  return time(x.registrationStart) < time(x.registrationEnd) && time(x.eventStart) <= time(x.eventEnd);
}

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

/** Address name of a new event (server: a-z, 0-9 and single dashes, 3 to 80 characters). `event-xxxx` when the title has no Latin letter. */
export function slugFor(title: string, suffix: string = randomSuffix()): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/, '');
  return `${base.length >= 3 ? base : 'event'}-${suffix}`;
}

/** What the draft still needs before the organizer can ask for publication (the server checks banner, category and WOD again). */
export function missingForPublication(c: Json): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  if (!String(c.description ?? '').trim()) out.push('DESCRIPTION');
  if (!datesValid({ registrationStart: c.deadlines?.registrationStart, registrationEnd: c.registrationEnd, eventStart: c.eventStart, eventEnd: c.eventEnd })) out.push('DATES');
  if (!c.coverUrl) out.push('COVER');
  if (!(c.categories ?? []).some((x: Json) => x.active)) out.push('CATEGORY');
  if (!(c.workouts ?? []).length) out.push('WOD');
  return out;
}

export function publicationState(c: Json): PublicationState {
  if (c.status !== 'DRAFT') return 'PUBLISHED';
  if (c.publicationRequestedAt) return 'REQUESTED';
  if (c.publicationNote) return 'RETURNED';
  return 'DRAFT';
}

/** "35", "12,5" (TND) → millimes; null when it is not an amount. */
export function toMillimes(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  return Math.round(Number(s) * 1000);
}

export const fromMillimes = (m: number | null | undefined) => (m == null ? '' : String(m / 1000));

export const nextWodNumber = (workouts: Json[]) => workouts.reduce((n, w) => Math.max(n, w.number ?? 0), 0) + 1;

const num = (s: string) => Number(s.trim().replace(',', '.'));
const intOrNull = (s: string) => (s.trim() ? Number(s.trim()) : null);
const isInt = (s: string, min: number, max = Number.MAX_SAFE_INTEGER) => !s.trim() || (Number.isInteger(Number(s.trim())) && Number(s.trim()) >= min && Number(s.trim()) <= max);

// ───────────── Categories ─────────────

export type CatDraft = { id?: string; name: string; gender: 'MALE' | 'FEMALE' | 'MIXED'; minAge: string; maxAge: string; level: string; max: string; price: string; active: boolean };

export function catDraft(c: Json | null): CatDraft {
  if (!c) return { name: '', gender: 'MIXED', minAge: '', maxAge: '', level: '', max: '', price: '', active: true };
  return {
    id: c.id,
    name: c.name ?? '',
    gender: c.gender,
    minAge: c.minAge == null ? '' : String(c.minAge),
    maxAge: c.maxAge == null ? '' : String(c.maxAge),
    level: c.level ?? '',
    max: c.maxParticipants == null ? '' : String(c.maxParticipants),
    price: fromMillimes(c.registrationPriceOverride),
    active: c.active !== false,
  };
}

/** The server's category rules: name 2 to 120, ages 0 to 120 with min ≤ max, places ≥ 1, a valid price or none. */
export function catValid(d: CatDraft): boolean {
  const name = d.name.trim();
  if (name.length < 2 || name.length > 120 || d.level.trim().length > 40) return false;
  if (!isInt(d.minAge, 0, 120) || !isInt(d.maxAge, 0, 120) || !isInt(d.max, 1)) return false;
  if (d.minAge.trim() && d.maxAge.trim() && Number(d.minAge) > Number(d.maxAge)) return false;
  return !d.price.trim() || toMillimes(d.price) != null;
}

export function catBody(d: CatDraft): Json {
  return {
    name: d.name.trim(),
    gender: d.gender,
    minAge: intOrNull(d.minAge),
    maxAge: intOrNull(d.maxAge),
    level: d.level.trim(),
    maxParticipants: intOrNull(d.max),
    registrationPriceOverride: d.price.trim() ? toMillimes(d.price) : null,
  };
}

// ───────────── WODs ─────────────

export type WodMovement = { name: string; points: string };
export type WodDraft = {
  id?: string;
  number: number;
  name: string;
  description: string;
  standards: string;
  scoreType: string;
  method: 'DIRECT_POINTS' | 'PLACEMENT_POINTS';
  table: string;
  max: string;
  min: string;
  capMin: string;
  videoUrl: string;
  movements: WodMovement[];
  start: Date;
  end: Date;
};

const DEFAULT_TABLE = '100, 95, 90, 85, 80';
const placements = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).map(Number);

export function wodDraft(w: Json | null, defaults: { number: number; start: Date; end: Date }): WodDraft {
  if (!w) {
    return { number: defaults.number, name: `WOD ${defaults.number}`, description: '', standards: '', scoreType: 'MOVEMENT_REPS', method: 'DIRECT_POINTS', table: DEFAULT_TABLE, max: '100', min: '0', capMin: '', videoUrl: '', movements: [{ name: '', points: '1' }], start: defaults.start, end: defaults.end };
  }
  return {
    id: w.id,
    number: w.number,
    name: w.name ?? '',
    description: w.description ?? '',
    standards: w.standards ?? '',
    scoreType: w.scoreType,
    method: w.scoringMethod ?? 'DIRECT_POINTS',
    table: (w.placementTable ?? []).join(', ') || DEFAULT_TABLE,
    max: String(w.maximumPoints ?? 100),
    min: String(w.minimumPoints ?? 0),
    capMin: w.timeCapS ? String(w.timeCapS / 60) : '',
    videoUrl: w.videoUrl ?? '',
    movements: (w.movements ?? []).map((m: Json) => ({ name: m.name, points: String(m.pointsPerRep) })),
    start: new Date(w.submissionStart ?? defaults.start),
    end: new Date(w.submissionDeadline ?? defaults.end),
  };
}

/** The server's checkWorkout rules, so the organizer sees the problem before sending. */
export function wodValid(d: WodDraft): boolean {
  const max = num(d.max);
  const min = d.min.trim() ? num(d.min) : 0;
  if (!d.name.trim() || d.name.trim().length > 80 || !d.description.trim()) return false;
  if (!Number.isInteger(max) || max < 1 || max > 100_000 || !Number.isInteger(min) || min < 0 || min > max) return false;
  if (!(d.start.getTime() < d.end.getTime())) return false;
  if (d.capMin.trim() && !(num(d.capMin) >= 1)) return false;
  if (d.method === 'PLACEMENT_POINTS') {
    const t = placements(d.table);
    if (!t.length || t.some((p, i) => !Number.isInteger(p) || p > max || (i > 0 && p > t[i - 1]))) return false;
  }
  if (d.scoreType === 'MOVEMENT_REPS') {
    const ms = d.movements.filter((m) => m.name.trim());
    if (!ms.length || ms.some((m) => !(num(m.points) > 0))) return false;
  }
  return true;
}

export function wodBody(d: WodDraft): Json {
  return {
    number: d.number,
    name: d.name.trim(),
    description: d.description.trim(),
    standards: d.standards.trim(),
    scoreType: d.scoreType,
    scoringMethod: d.method,
    maximumPoints: num(d.max),
    minimumPoints: d.min.trim() ? num(d.min) : 0,
    ...(d.method === 'PLACEMENT_POINTS' ? { placementTable: placements(d.table) } : {}),
    ...(d.capMin.trim() ? { timeCapS: Math.round(num(d.capMin) * 60) } : {}),
    ...(d.videoUrl.trim() ? { videoUrl: d.videoUrl.trim() } : {}),
    movements: d.scoreType === 'MOVEMENT_REPS' ? d.movements.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), pointsPerRep: num(m.points) })) : [],
    submissionStart: d.start.toISOString(),
    submissionDeadline: d.end.toISOString(),
  };
}
```

- [ ] **Step 4: Write `api.ts`**

`apps/mobile-rn/src/features/competitions/organizer/api.ts`:
```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { ApiClient, Json, UploadFile } from '../../../core/api/client';
import { ApiError } from '../../../core/api/errors';
import { useApi } from '../../../core/services';
import { slugFor, type EventFormat } from './logic';

export type CompetitionInput = {
  title: string;
  slug: string;
  description: string;
  format: EventFormat;
  countryCode?: string;
  city?: string;
  location?: string;
  registrationStart: string;
  registrationEnd: string;
  eventStart: string;
  eventEnd: string;
  registrationPrice: number;
  currency?: string;
  maxParticipants?: number | null;
};

/** Organizer space: the organizer routes of the competitions API (spec 2026-10-14). */
export const organizerApi = (api: ApiClient) => ({
  create: (body: CompetitionInput) => api.post<Json>('/competitions', body),
  update: (id: string, body: Partial<CompetitionInput>) => api.put<Json>(`/competitions/${id}`, body),
  remove: (id: string) => api.delete<void>(`/competitions/${id}`),
  setStatus: (id: string, status: string) => api.patch<Json>(`/competitions/${id}/status`, { status }),
  requestPublication: (id: string) => api.post<Json>(`/competitions/${id}/publication-request`),
  dashboard: (id: string) => api.get<Json>(`/competitions/${id}/dashboard`),
  uploadCover: (id: string, file: UploadFile) => api.upload<Json>(`/competitions/${id}/cover`, file),
  removeCover: (id: string) => api.delete<void>(`/competitions/${id}/cover`),
  addCategory: (id: string, body: Json) => api.post<Json>(`/competitions/${id}/categories`, body),
  addTemplates: (id: string) => api.post<Json>(`/competitions/${id}/categories/templates`),
  updateCategory: (id: string, categoryId: string, body: Json) => api.put<Json>(`/competitions/${id}/categories/${categoryId}`, body),
  addWod: (id: string, body: Json) => api.post<Json>(`/competitions/${id}/wods`, body),
  updateWod: (id: string, wodId: string, body: Json) => api.put<Json>(`/competitions/${id}/wods/${wodId}`, body),
  removeWod: (id: string, wodId: string) => api.delete<void>(`/competitions/${id}/wods/${wodId}`),
  reorderWods: (id: string, workoutIds: string[]) => api.post<Json[]>(`/competitions/${id}/wods/reorder`, { workoutIds }),
});

/** Creates the draft; a taken address name gets one new random suffix (two events may share a title). */
export async function createWithFreeSlug(org: ReturnType<typeof organizerApi>, body: CompetitionInput): Promise<Json> {
  try {
    return await org.create(body);
  } catch (e) {
    if (!(e instanceof ApiError) || !e.fieldErrors.some((f) => f.field === 'slug' && f.code === 'TAKEN')) throw e;
    return org.create({ ...body, slug: slugFor(body.title) });
  }
}

export function useOrganizerDashboard(id: string) {
  const api = useApi();
  return useQuery({ queryKey: ['competitions', id, 'org-dashboard'], queryFn: () => organizerApi(api).dashboard(id) });
}

/** After an organizer change: every competition query (detail, lists, dashboard) reads again. */
export function useRefreshCompetition() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['competitions'] });
}
```

- [ ] **Step 5: Add every lot A text**

Save this file as `<scratchpad>/org-i18n.json` (scratchpad = the session's scratchpad directory):
```json
{
  "en": {
    "createEvent": "Create an event", "orgCreateIntro": "Your event starts as a draft that only you can see. Prepare it, then ask the Fitness League team to publish it.",
    "orgName": "Event name", "orgDescription": "Description", "orgFormat": "Format", "orgFormatOnsite": "On site", "orgFormatOnline": "Online", "orgFormatHybrid": "Hybrid",
    "orgCountry": "Country code (2 letters)", "orgPlace": "Venue", "orgPlaceRequired": "City and venue are needed for an on-site or hybrid event.",
    "orgRegistrationStart": "Registration opens", "orgRegistrationEnd": "Registration closes", "orgEventStart": "Event starts", "orgEventEnd": "Event ends",
    "orgDatesInvalid": "Registration must open before it closes, and the event cannot end before it starts.",
    "orgPrice": "Price in TND (0 = free)", "orgMaxParticipants": "Max athletes (optional)", "orgCreateDraft": "Create the draft",
    "orgManage": "Manage", "orgOnly": "Only the organizers of this event can open this page.",
    "orgTabDashboard": "Dashboard", "orgTabGeneral": "General", "orgTabCategories": "Categories", "orgTabWods": "WODs",
    "orgStateDraft": "Draft: only you can see it.", "orgStateRequested": "Publication requested: the Fitness League team will publish it or send it back with a note.",
    "orgStateReturned": "Sent back by the team. Fix this, then ask again:", "orgStatePublished": "Published · {status}",
    "orgChecklist": "Before publishing", "orgCheckDescription": "Description", "orgCheckDates": "Consistent dates", "orgCheckCover": "Banner",
    "orgCheckCategory": "At least one active category", "orgCheckWod": "At least one WOD", "orgGoTo": "To do: tap to fix",
    "orgRequestPublication": "Ask for publication", "orgRequested": "Request sent.",
    "orgFigures": "Figures", "orgParticipants": "Athletes", "orgPaid": "Paid", "orgToCollect": "To collect", "orgRevenue": "Revenue", "orgToJudge": "Scores to judge",
    "orgShare": "Share the event", "orgShareText": "{title}, {date}, {place}. Register in the Fitness League app:",
    "orgSaved": "Saved.", "orgBanner": "Banner", "orgBannerHint": "Wide image, shown at 1440 × 596, 5 MB max.", "orgBannerPick": "Choose a banner",
    "orgBannerRemove": "Remove the banner", "orgBannerTooLarge": "This image is larger than 5 MB.",
    "orgEvent": "Event", "orgDelete": "Delete the draft", "orgDeleteConfirm": "Delete \"{title}\"? This cannot be undone.", "orgNextStep": "Next step",
    "orgToRegistrationOpen": "Reopen registration", "orgToRegistrationClosed": "Close registration", "orgToActive": "Start the event",
    "orgToSubmissionOpen": "Open score submission", "orgToJudging": "Start judging", "orgToProvisional": "Show the provisional leaderboard", "orgToFinished": "Finish the event",
    "orgAddTemplates": "Add the standard categories", "orgNewCategory": "New category", "orgNoCategories": "No category yet.", "orgCategoryName": "Category name",
    "orgGenderMale": "Men", "orgGenderFemale": "Women", "orgGenderMixed": "Mixed", "orgMinAge": "Min age", "orgMaxAge": "Max age", "orgLevel": "Level (RX, Scaled…)",
    "orgCategoryMax": "Places (optional)", "orgCategoryPrice": "Price in TND (empty = event price)", "orgCategoryInvalid": "Check the name (2 letters min) and the ages.",
    "orgActivate": "Activate", "orgDeactivate": "Deactivate", "orgInactive": "Inactive", "orgMoveUp": "Move up", "orgMoveDown": "Move down",
    "orgNewWod": "New WOD", "orgNoWods": "No WOD yet.", "orgWodName": "WOD name", "orgWodDescription": "Workout", "orgStandards": "Movement standards (optional)",
    "orgScoreType": "Score type", "orgScoreTime": "Time", "orgScoreReps": "Reps", "orgScoreRoundsReps": "Rounds + reps", "orgScoreDistance": "Distance", "orgScoreLoad": "Load",
    "orgScoreCalories": "Calories", "orgScorePoints": "Points", "orgScoreMaxWeight": "Max weight", "orgScoreComplex": "Complex", "orgScoreMovementReps": "Reps per movement",
    "orgScoring": "Points", "orgScoringDirect": "Direct", "orgScoringPlacement": "By placement", "orgPlacementTable": "Points by place (100, 95, 90…)",
    "orgMaxPoints": "Max points", "orgMinPoints": "Min points", "orgTimeCap": "Time cap in minutes (optional)", "orgVideoUrl": "Demo video link (optional)",
    "orgMovements": "Movements and points per rep", "orgMovementName": "Movement", "orgPointsPerRep": "Points / rep", "orgAddMovement": "Add a movement", "orgRemoveMovement": "Remove the movement",
    "orgSubmissionStart": "Scores open", "orgSubmissionEnd": "Scores close", "orgWodInvalid": "Check the name, the workout, the points, the movements and the dates.",
    "orgWodDelete": "Delete this WOD", "orgWodDeleteConfirm": "Delete {name}?",
    "orgCardDraft": "Draft", "orgCardRequested": "Publication requested", "orgCardReturned": "Sent back"
  },
  "fr": {
    "createEvent": "Créer un événement", "orgCreateIntro": "Ton événement commence en brouillon, visible par toi seul. Prépare-le, puis demande à l'équipe Fitness League de le publier.",
    "orgName": "Nom de l'événement", "orgDescription": "Description", "orgFormat": "Format", "orgFormatOnsite": "Sur place", "orgFormatOnline": "En ligne", "orgFormatHybrid": "Hybride",
    "orgCountry": "Code pays (2 lettres)", "orgPlace": "Lieu", "orgPlaceRequired": "La ville et le lieu sont nécessaires pour un événement sur place ou hybride.",
    "orgRegistrationStart": "Ouverture des inscriptions", "orgRegistrationEnd": "Fermeture des inscriptions", "orgEventStart": "Début de l'événement", "orgEventEnd": "Fin de l'événement",
    "orgDatesInvalid": "Les inscriptions doivent ouvrir avant de fermer, et l'événement ne peut pas finir avant de commencer.",
    "orgPrice": "Prix en TND (0 = gratuit)", "orgMaxParticipants": "Places max (facultatif)", "orgCreateDraft": "Créer le brouillon",
    "orgManage": "Gérer", "orgOnly": "Accès réservé aux organisateurs de cet événement.",
    "orgTabDashboard": "Tableau de bord", "orgTabGeneral": "Général", "orgTabCategories": "Catégories", "orgTabWods": "WODs",
    "orgStateDraft": "Brouillon : toi seul le vois.", "orgStateRequested": "Publication demandée : l'équipe Fitness League va le publier ou te le renvoyer avec une note.",
    "orgStateReturned": "Renvoyé par l'équipe. Corrige ceci, puis redemande :", "orgStatePublished": "Publié · {status}",
    "orgChecklist": "Avant de publier", "orgCheckDescription": "Description", "orgCheckDates": "Dates cohérentes", "orgCheckCover": "Bannière",
    "orgCheckCategory": "Au moins une catégorie active", "orgCheckWod": "Au moins un WOD", "orgGoTo": "À faire : touche pour corriger",
    "orgRequestPublication": "Demander la publication", "orgRequested": "Demande envoyée.",
    "orgFigures": "Chiffres", "orgParticipants": "Inscrits", "orgPaid": "Payés", "orgToCollect": "À encaisser", "orgRevenue": "Revenu", "orgToJudge": "Scores à juger",
    "orgShare": "Partager l'événement", "orgShareText": "{title}, {date}, {place}. Inscris-toi dans l'app Fitness League :",
    "orgSaved": "Enregistré.", "orgBanner": "Bannière", "orgBannerHint": "Image large, affichée en 1440 × 596, 5 Mo max.", "orgBannerPick": "Choisir une bannière",
    "orgBannerRemove": "Retirer la bannière", "orgBannerTooLarge": "Cette image dépasse 5 Mo.",
    "orgEvent": "Événement", "orgDelete": "Supprimer le brouillon", "orgDeleteConfirm": "Supprimer « {title} » ? C'est définitif.", "orgNextStep": "Étape suivante",
    "orgToRegistrationOpen": "Rouvrir les inscriptions", "orgToRegistrationClosed": "Fermer les inscriptions", "orgToActive": "Démarrer l'événement",
    "orgToSubmissionOpen": "Ouvrir l'envoi des scores", "orgToJudging": "Lancer le jugement", "orgToProvisional": "Afficher le classement provisoire", "orgToFinished": "Terminer l'événement",
    "orgAddTemplates": "Ajouter les catégories modèles", "orgNewCategory": "Nouvelle catégorie", "orgNoCategories": "Aucune catégorie pour l'instant.", "orgCategoryName": "Nom de la catégorie",
    "orgGenderMale": "Hommes", "orgGenderFemale": "Femmes", "orgGenderMixed": "Mixte", "orgMinAge": "Âge min", "orgMaxAge": "Âge max", "orgLevel": "Niveau (RX, Scaled…)",
    "orgCategoryMax": "Places (facultatif)", "orgCategoryPrice": "Prix en TND (vide = prix de l'événement)", "orgCategoryInvalid": "Vérifie le nom (2 lettres min.) et les âges.",
    "orgActivate": "Activer", "orgDeactivate": "Désactiver", "orgInactive": "Inactive", "orgMoveUp": "Monter", "orgMoveDown": "Descendre",
    "orgNewWod": "Nouveau WOD", "orgNoWods": "Aucun WOD pour l'instant.", "orgWodName": "Nom du WOD", "orgWodDescription": "Déroulé", "orgStandards": "Standards des mouvements (facultatif)",
    "orgScoreType": "Type de score", "orgScoreTime": "Temps", "orgScoreReps": "Répétitions", "orgScoreRoundsReps": "Tours + répétitions", "orgScoreDistance": "Distance", "orgScoreLoad": "Charge",
    "orgScoreCalories": "Calories", "orgScorePoints": "Points", "orgScoreMaxWeight": "Charge max", "orgScoreComplex": "Complexe", "orgScoreMovementReps": "Reps par mouvement",
    "orgScoring": "Points", "orgScoringDirect": "Directs", "orgScoringPlacement": "Par classement", "orgPlacementTable": "Points par place (100, 95, 90…)",
    "orgMaxPoints": "Points max", "orgMinPoints": "Points min", "orgTimeCap": "Time cap en minutes (facultatif)", "orgVideoUrl": "Lien de la vidéo de démo (facultatif)",
    "orgMovements": "Mouvements et points par répétition", "orgMovementName": "Mouvement", "orgPointsPerRep": "Points / rép.", "orgAddMovement": "Ajouter un mouvement", "orgRemoveMovement": "Retirer le mouvement",
    "orgSubmissionStart": "Ouverture des scores", "orgSubmissionEnd": "Fermeture des scores", "orgWodInvalid": "Vérifie le nom, le déroulé, les points, les mouvements et les dates.",
    "orgWodDelete": "Supprimer ce WOD", "orgWodDeleteConfirm": "Supprimer {name} ?",
    "orgCardDraft": "Brouillon", "orgCardRequested": "Publication demandée", "orgCardReturned": "Renvoyé"
  },
  "ar": {
    "createEvent": "إنشاء حدث", "orgCreateIntro": "يبدأ حدثك كمسودة لا يراها غيرك. جهّزه ثم اطلب من فريق Fitness League نشره.",
    "orgName": "اسم الحدث", "orgDescription": "الوصف", "orgFormat": "النوع", "orgFormatOnsite": "حضوري", "orgFormatOnline": "عبر الإنترنت", "orgFormatHybrid": "مختلط",
    "orgCountry": "رمز البلد (حرفان)", "orgPlace": "المكان", "orgPlaceRequired": "المدينة والمكان ضروريان لحدث حضوري أو مختلط.",
    "orgRegistrationStart": "فتح التسجيل", "orgRegistrationEnd": "إغلاق التسجيل", "orgEventStart": "بداية الحدث", "orgEventEnd": "نهاية الحدث",
    "orgDatesInvalid": "يجب أن يُفتح التسجيل قبل إغلاقه، ولا يمكن أن ينتهي الحدث قبل بدايته.",
    "orgPrice": "السعر بالدينار (0 = مجاني)", "orgMaxParticipants": "الحد الأقصى للرياضيين (اختياري)", "orgCreateDraft": "إنشاء المسودة",
    "orgManage": "إدارة", "orgOnly": "هذه الصفحة مخصّصة لمنظّمي هذا الحدث فقط.",
    "orgTabDashboard": "لوحة القيادة", "orgTabGeneral": "عام", "orgTabCategories": "الفئات", "orgTabWods": "التمارين",
    "orgStateDraft": "مسودة: لا يراها غيرك.", "orgStateRequested": "طُلب النشر: سينشره فريق Fitness League أو يعيده إليك مع ملاحظة.",
    "orgStateReturned": "أعاده الفريق. صحّح ما يلي ثم اطلب مجددًا:", "orgStatePublished": "منشور · {status}",
    "orgChecklist": "قبل النشر", "orgCheckDescription": "الوصف", "orgCheckDates": "تواريخ متناسقة", "orgCheckCover": "اللافتة",
    "orgCheckCategory": "فئة نشطة واحدة على الأقل", "orgCheckWod": "تمرين WOD واحد على الأقل", "orgGoTo": "مطلوب: اضغط للتصحيح",
    "orgRequestPublication": "طلب النشر", "orgRequested": "تم إرسال الطلب.",
    "orgFigures": "الأرقام", "orgParticipants": "المسجّلون", "orgPaid": "مدفوع", "orgToCollect": "للتحصيل", "orgRevenue": "الإيرادات", "orgToJudge": "نتائج للتحكيم",
    "orgShare": "مشاركة الحدث", "orgShareText": "{title}، {date}، {place}. سجّل في تطبيق Fitness League:",
    "orgSaved": "تم الحفظ.", "orgBanner": "اللافتة", "orgBannerHint": "صورة عريضة تُعرض بمقاس 1440 × 596، بحد أقصى 5 ميغابايت.", "orgBannerPick": "اختيار لافتة",
    "orgBannerRemove": "إزالة اللافتة", "orgBannerTooLarge": "هذه الصورة أكبر من 5 ميغابايت.",
    "orgEvent": "الحدث", "orgDelete": "حذف المسودة", "orgDeleteConfirm": "حذف «{title}»؟ لا يمكن التراجع.", "orgNextStep": "الخطوة التالية",
    "orgToRegistrationOpen": "إعادة فتح التسجيل", "orgToRegistrationClosed": "إغلاق التسجيل", "orgToActive": "بدء الحدث",
    "orgToSubmissionOpen": "فتح إرسال النتائج", "orgToJudging": "بدء التحكيم", "orgToProvisional": "عرض الترتيب المؤقت", "orgToFinished": "إنهاء الحدث",
    "orgAddTemplates": "إضافة الفئات النموذجية", "orgNewCategory": "فئة جديدة", "orgNoCategories": "لا توجد فئات بعد.", "orgCategoryName": "اسم الفئة",
    "orgGenderMale": "رجال", "orgGenderFemale": "نساء", "orgGenderMixed": "مختلط", "orgMinAge": "أدنى عمر", "orgMaxAge": "أقصى عمر", "orgLevel": "المستوى (RX، Scaled…)",
    "orgCategoryMax": "الأماكن (اختياري)", "orgCategoryPrice": "السعر بالدينار (فارغ = سعر الحدث)", "orgCategoryInvalid": "تحقّق من الاسم (حرفان على الأقل) والأعمار.",
    "orgActivate": "تفعيل", "orgDeactivate": "تعطيل", "orgInactive": "غير نشطة", "orgMoveUp": "تحريك للأعلى", "orgMoveDown": "تحريك للأسفل",
    "orgNewWod": "تمرين WOD جديد", "orgNoWods": "لا توجد تمارين بعد.", "orgWodName": "اسم التمرين", "orgWodDescription": "التمرين", "orgStandards": "معايير الحركات (اختياري)",
    "orgScoreType": "نوع النتيجة", "orgScoreTime": "الوقت", "orgScoreReps": "التكرارات", "orgScoreRoundsReps": "جولات + تكرارات", "orgScoreDistance": "المسافة", "orgScoreLoad": "الحمل",
    "orgScoreCalories": "السعرات", "orgScorePoints": "النقاط", "orgScoreMaxWeight": "أقصى وزن", "orgScoreComplex": "مركّب", "orgScoreMovementReps": "تكرارات لكل حركة",
    "orgScoring": "النقاط", "orgScoringDirect": "مباشرة", "orgScoringPlacement": "حسب الترتيب", "orgPlacementTable": "النقاط حسب المركز (100، 95، 90…)",
    "orgMaxPoints": "أقصى نقاط", "orgMinPoints": "أدنى نقاط", "orgTimeCap": "الحد الزمني بالدقائق (اختياري)", "orgVideoUrl": "رابط فيديو الشرح (اختياري)",
    "orgMovements": "الحركات والنقاط لكل تكرار", "orgMovementName": "الحركة", "orgPointsPerRep": "نقاط / تكرار", "orgAddMovement": "إضافة حركة", "orgRemoveMovement": "إزالة الحركة",
    "orgSubmissionStart": "فتح النتائج", "orgSubmissionEnd": "إغلاق النتائج", "orgWodInvalid": "تحقّق من الاسم والتمرين والنقاط والحركات والتواريخ.",
    "orgWodDelete": "حذف هذا التمرين", "orgWodDeleteConfirm": "حذف {name}؟",
    "orgCardDraft": "مسودة", "orgCardRequested": "طُلب النشر", "orgCardReturned": "أُعيد"
  }
}
```
Merge it into the three catalogs (the files are 2-space pretty JSON; new keys go at the end):
```bash
cd /mnt/c/Users/GIGABYTE/fitness-league/apps/mobile-rn && node -e '
const fs = require("fs");
const add = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const lang of ["en", "fr", "ar"]) {
  const p = `src/core/i18n/${lang}.json`;
  const cur = JSON.parse(fs.readFileSync(p, "utf8"));
  const clash = Object.keys(add[lang]).filter((k) => k in cur);
  if (clash.length) throw new Error(`${lang}: keys already exist: ${clash.join(", ")}`);
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...add[lang] }, null, 2) + "\n");
}
console.log("ok");' <scratchpad>/org-i18n.json
```
Expected: `ok`, and `git diff --stat src/core/i18n` shows only added lines (if the whole file changes, the original had a different layout: restore it with `git show HEAD:<path> > <path>` and insert the keys by hand before the closing brace instead).

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx jest test/core/organizer-logic.test.ts test/core/i18n.test.ts test/core/i18n-usage.test.ts && npx tsc --noEmit`
Expected: all pass, no type error.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/logic.ts apps/mobile-rn/src/features/competitions/organizer/api.ts apps/mobile-rn/test/core/organizer-logic.test.ts apps/mobile-rn/src/core/i18n/en.json apps/mobile-rn/src/core/i18n/fr.json apps/mobile-rn/src/core/i18n/ar.json
git diff --cached --stat
git commit -m "feat(mobile): organizer space rules, API client and texts (EN/FR/AR)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: App — « Créer un événement »

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/create.tsx`
- Create: `apps/mobile-rn/src/app/competitions/new.tsx`
- Modify: `apps/mobile-rn/src/features/shell/root.tsx` (route title)
- Modify: `apps/mobile-rn/src/features/competitions/screens.tsx` (`CompetitionsScreen`: create chip)
- Test: `apps/mobile-rn/test/screens/organizer.test.tsx`

**Interfaces:**
- Consumes: `organizerApi`, `createWithFreeSlug`, `CompetitionInput` (Task 4); `datesValid`, `slugFor`, `toMillimes`, `EventFormat` (Task 4).
- Produces: `CreateEventScreen()`; route `/competitions/new`; after creation `router.replace('/competitions/<id>/manage')` (route added in Task 6).

The entry is a chip next to « Mes compétitions » rather than a header icon: the spec's header icon cannot be tested with the test router (`useHeader` has no header there) and a chip in the filter row is as visible.

- [ ] **Step 1: Write the failing tests**

`apps/mobile-rn/test/screens/organizer.test.tsx`:
```tsx
import { Text } from 'react-native';
import { fireEvent, waitFor } from 'expo-router/testing-library';

import { CompetitionsScreen } from '../../src/features/competitions/screens';
import { CreateEventScreen } from '../../src/features/competitions/organizer/create';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const manageRoute = { 'competitions/[id]/manage': () => <Text>Manage page</Text> };

describe('create an event', () => {
  it('opens from the competitions page', async () => {
    const backend = new FakeBackend().on('GET', '/competitions', [200, []]);
    const screen = await renderScreen(CompetitionsScreen, backend, { routes: { 'competitions/new': () => <Text>Create page</Text> } });
    await fireEvent.press(await screen.findByTestId('comp-create'));
    expect(await screen.findByText('Create page')).toBeTruthy();
  });

  it('creates a draft with a valid address name and opens its organizer space', async () => {
    const backend = new FakeBackend().on('POST', '/competitions', [201, { id: 'new1', status: 'DRAFT' }]);
    const screen = await renderScreen(CreateEventScreen, backend, { routes: manageRoute });
    await fireEvent.changeText(screen.getByTestId('org-title'), 'Sousse Summer Throwdown');
    await fireEvent.changeText(screen.getByTestId('org-description'), 'Two days on site.');
    // On site by default: city and venue are needed.
    expect(screen.getByTestId('org-create').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('org-city'), 'Sousse');
    await fireEvent.changeText(screen.getByTestId('org-place'), 'Bodynade');
    await fireEvent.changeText(screen.getByTestId('org-price'), '40');
    await fireEvent.press(screen.getByTestId('org-create'));
    expect(await screen.findByText('Manage page')).toBeTruthy();
    const body = backend.calls('POST', '/competitions')[0].body;
    expect(body).toMatchObject({ title: 'Sousse Summer Throwdown', format: 'ONSITE', countryCode: 'TN', city: 'Sousse', location: 'Bodynade', registrationPrice: 40000, currency: 'TND' });
    expect(body.slug).toMatch(/^sousse-summer-throwdown-[a-z0-9]{4}$/);
  });

  it('retries once with another address name when it is taken, and sends one request per tap', async () => {
    let calls = 0;
    const backend = new FakeBackend().on('POST', '/competitions', () => (++calls === 1 ? [422, { code: 'VALIDATION_FAILED', status: 422, errors: [{ field: 'slug', code: 'TAKEN' }] }] : [201, { id: 'new2' }]));
    const screen = await renderScreen(CreateEventScreen, backend, { routes: manageRoute });
    await fireEvent.changeText(screen.getByTestId('org-title'), 'بطولة سوسة');
    await fireEvent.changeText(screen.getByTestId('org-description'), 'Online qualifier.');
    await fireEvent.press(screen.getByTestId('org-format-ONLINE'));
    const create = screen.getByTestId('org-create');
    fireEvent.press(create);
    fireEvent.press(create);
    expect(await screen.findByText('Manage page')).toBeTruthy();
    const sent = backend.calls('POST', '/competitions');
    expect(sent).toHaveLength(2);
    expect(sent[0].body.slug).toMatch(/^event-[a-z0-9]{4}$/);
    expect(sent[1].body.slug).toMatch(/^event-[a-z0-9]{4}$/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /mnt/c/Users/GIGABYTE/fitness-league/apps/mobile-rn && npx jest test/screens/organizer.test.tsx`
Expected: FAIL, « Cannot find module '../../src/features/competitions/organizer/create' ».

- [ ] **Step 3: Write the screen**

`apps/mobile-rn/src/features/competitions/organizer/create.tsx`:
```tsx
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Chip, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { DateField } from '../../../core/widgets/pickers';
import { createWithFreeSlug, organizerApi, type CompetitionInput } from './api';
import { datesValid, slugFor, toMillimes, type EventFormat } from './logic';

const DAY = 86_400_000;

/** Organizer space: any user drafts an event; an admin publishes it once the organizer asks. */
export function CreateEventScreen() {
  const t = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const [start] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d.getTime() + 3_600_000;
  });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<EventFormat>('ONSITE');
  const [countryCode, setCountryCode] = useState('TN');
  const [city, setCity] = useState('');
  const [place, setPlace] = useState('');
  const [regStart, setRegStart] = useState(new Date(start));
  const [regEnd, setRegEnd] = useState(new Date(start + 14 * DAY));
  const [eventStart, setEventStart] = useState(new Date(start + 21 * DAY));
  const [eventEnd, setEventEnd] = useState(new Date(start + 22 * DAY));
  const [price, setPrice] = useState('0');
  const [max, setMax] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sending = useRef(false);

  const onsite = format !== 'ONLINE';
  const priceMillimes = toMillimes(price);
  const maxN = max.trim() ? Number(max.trim()) : null;
  const dates = { registrationStart: regStart, registrationEnd: regEnd, eventStart, eventEnd };
  const placeOk = !onsite || (city.trim().length > 0 && place.trim().length > 0);
  const valid =
    title.trim().length >= 3 &&
    title.trim().length <= 120 &&
    description.trim().length >= 1 &&
    /^[A-Z]{2}$/.test(countryCode) &&
    placeOk &&
    datesValid(dates) &&
    priceMillimes != null &&
    (maxN == null || (Number.isInteger(maxN) && maxN >= 1));

  async function submit() {
    if (sending.current || !valid) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const body: CompetitionInput = {
      title: title.trim(),
      slug: slugFor(title),
      description: description.trim(),
      format,
      countryCode,
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(place.trim() ? { location: place.trim() } : {}),
      registrationStart: regStart.toISOString(),
      registrationEnd: regEnd.toISOString(),
      eventStart: eventStart.toISOString(),
      eventEnd: eventEnd.toISOString(),
      registrationPrice: priceMillimes!,
      currency: 'TND',
      ...(maxN != null ? { maxParticipants: maxN } : {}),
    };
    try {
      const created = await createWithFreeSlug(organizerApi(api), body);
      await qc.invalidateQueries({ queryKey: ['competitions'] });
      router.replace(`/competitions/${created.id}/manage`);
    } catch (e) {
      setError(e);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const formats: { key: EventFormat; label: string }[] = [
    { key: 'ONSITE', label: t('orgFormatOnsite') },
    { key: 'ONLINE', label: t('orgFormatOnline') },
    { key: 'HYBRID', label: t('orgFormatHybrid') },
  ];
  return (
    <Screen>
      <Txt color={colors.outline}>{t('orgCreateIntro')}</Txt>
      <TextField testID="org-title" label={t('orgName')} value={title} onChangeText={setTitle} maxLength={120} />
      <TextField testID="org-description" label={t('orgDescription')} value={description} onChangeText={setDescription} maxLength={5000} multiline />
      <SectionHeader title={t('orgFormat')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {formats.map((f) => (
          <Chip key={f.key} testID={`org-format-${f.key}`} label={f.label} selected={format === f.key} onPress={() => setFormat(f.key)} />
        ))}
      </View>
      <TextField testID="org-country" label={t('orgCountry')} value={countryCode} onChangeText={(v) => setCountryCode(v.toUpperCase())} maxLength={2} autoCapitalize="characters" />
      <TextField testID="org-city" label={t('city')} value={city} onChangeText={setCity} maxLength={100} />
      <TextField testID="org-place" label={t('orgPlace')} value={place} onChangeText={setPlace} maxLength={200} />
      {!placeOk && <Txt variant="small" color={colors.outline}>{t('orgPlaceRequired')}</Txt>}
      <SectionHeader title={t('orgEvent')} />
      <DateField testID="org-reg-start" mode="datetime" label={t('orgRegistrationStart')} value={regStart} onChange={setRegStart} />
      <DateField testID="org-reg-end" mode="datetime" label={t('orgRegistrationEnd')} value={regEnd} onChange={setRegEnd} />
      <DateField testID="org-event-start" mode="datetime" label={t('orgEventStart')} value={eventStart} onChange={setEventStart} />
      <DateField testID="org-event-end" mode="datetime" label={t('orgEventEnd')} value={eventEnd} onChange={setEventEnd} />
      {!datesValid(dates) && <Txt variant="small" color={colors.error}>{t('orgDatesInvalid')}</Txt>}
      <TextField testID="org-price" label={t('orgPrice')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
      <TextField testID="org-max" label={t('orgMaxParticipants')} value={max} onChangeText={setMax} keyboardType="number-pad" />
      <ErrorText error={error} />
      <Button testID="org-create" label={t('orgCreateDraft')} busy={busy} disabled={!valid} onPress={submit} style={{ marginTop: space.sm }} />
    </Screen>
  );
}
```
`apps/mobile-rn/src/app/competitions/new.tsx`:
```tsx
import { CreateEventScreen } from '../../features/competitions/organizer/create';

export default function CreateEventRoute() {
  return <CreateEventScreen />;
}
```
In `src/features/shell/root.tsx`, after the line `<Stack.Screen name="competitions/index" options={{ title: t('competitions') }} />`, add:
```tsx
          <Stack.Screen name="competitions/new" options={{ title: t('createEvent') }} />
```
In `src/features/competitions/screens.tsx`, `CompetitionsScreen`, replace:
```tsx
      <View style={{ flexDirection: 'row', paddingHorizontal: 16 }}>
        <Chip testID="comp-mine" icon="person" label={t('competitionsMine')} selected={mine} onPress={() => setMine(!mine)} />
      </View>
```
with:
```tsx
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
        <Chip testID="comp-mine" icon="person" label={t('competitionsMine')} selected={mine} onPress={() => setMine(!mine)} />
        <Chip testID="comp-create" icon="add" label={t('createEvent')} onPress={() => router.push('/competitions/new')} />
      </View>
```

- [ ] **Step 4: Run the tests**

Run: `npx jest test/screens/organizer.test.tsx test/screens/competitions.test.tsx && npx tsc --noEmit`
Expected: all pass. If `accessibilityState` is not where `Button` puts `disabled`, read `Button` in `src/core/widgets/kit.tsx` and assert on the prop it really sets (a ruling for the ledger).

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/create.tsx apps/mobile-rn/src/app/competitions/new.tsx apps/mobile-rn/src/features/shell/root.tsx apps/mobile-rn/src/features/competitions/screens.tsx apps/mobile-rn/test/screens/organizer.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): create an event as a draft from the competitions page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: App — organizer space and its dashboard

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/manage.tsx`
- Create: `apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx`
- Create: `apps/mobile-rn/src/app/competitions/[id]/manage.tsx`
- Modify: `apps/mobile-rn/src/features/shell/root.tsx` (route title)
- Modify: `apps/mobile-rn/src/features/competitions/screens.tsx` (`CompetitionScreen`: « Gérer » button)
- Test: `apps/mobile-rn/test/screens/organizer.test.tsx` (new `describe`)

**Interfaces:**
- Consumes: `useCompetition` (`../api`), `statusLabelForCompetition` (`../screens`), Task 4's `logic.ts` and `api.ts`.
- Produces: `ManageScreen({ id, initialTab? })` with the tab list `TABS` and a render switch that Tasks 7 to 9 extend; `DashboardTab({ c, onGo })`; route `/competitions/<id>/manage`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/mobile-rn/test/screens/organizer.test.tsx` (add `ManageScreen` and `CompetitionScreen` imports at the top: `import { ManageScreen } from '../../src/features/competitions/organizer/manage';` and extend the screens import with `CompetitionScreen`):
```tsx
const draft = {
  id: 'c9',
  title: 'Sousse Summer Throwdown',
  description: 'Two days on site.',
  status: 'DRAFT',
  format: 'ONSITE',
  city: 'Sousse',
  location: 'Bodynade',
  countryCode: 'TN',
  currency: 'TND',
  registrationPrice: 40000,
  maxParticipants: null,
  coverUrl: null,
  deadlines: { registrationStart: '2026-10-20T08:00:00.000Z', registrationEnd: '2026-12-01T22:00:00.000Z' },
  registrationEnd: '2026-12-01T22:00:00.000Z',
  eventStart: '2026-12-12T08:00:00.000Z',
  eventEnd: '2026-12-13T18:00:00.000Z',
  categories: [],
  workouts: [],
  prizes: [],
  myRoles: ['ORGANIZER'],
  myRegistration: null,
  publicationRequestedAt: null,
  publicationNote: null,
};
const complete = {
  ...draft,
  coverUrl: 'https://cdn.test/cover.webp',
  categories: [{ id: 'k1', name: 'RX Mixed', gender: 'MIXED', active: true, sortOrder: 0 }],
  workouts: [{ id: 'w1', number: 1, name: 'WOD 1', scoreType: 'REPS' }],
};
const figures = { participants: 12, paidRegistrations: 8, freeRegistrations: 1, pendingPayments: 3, revenue: 320000, pendingSubmissions: 0, pendingJudging: 2, approvedSubmissions: 5, rejectedSubmissions: 0 };
const organizerBackend = (c: object) => new FakeBackend().on('GET', '/competitions/c9', [200, c]).on('GET', '/competitions/c9/dashboard', [200, figures]);

describe('organizer space', () => {
  it('is reserved to the organizers', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" />, organizerBackend({ ...draft, myRoles: [] }));
    expect(await screen.findByText('Only the organizers of this event can open this page.')).toBeTruthy();
    expect(screen.queryByTestId('org-request')).toBeNull();
  });

  it('lists what the draft misses and keeps the request button off', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" />, organizerBackend(draft));
    expect(await screen.findByText('Draft: only you can see it.')).toBeTruthy();
    for (const item of ['COVER', 'CATEGORY', 'WOD']) expect(screen.getByTestId(`check-${item}`)).toBeTruthy();
    expect(screen.getAllByText('To do: tap to fix')).toHaveLength(3);
    expect(screen.getByTestId('org-request').props.accessibilityState?.disabled).toBe(true);
    expect(await screen.findByText('12')).toBeTruthy();
  });

  it('asks for publication once, even on a double tap', async () => {
    let state: object = complete;
    const backend = organizerBackend(complete)
      .on('GET', '/competitions/c9', () => [200, state])
      .on('POST', '/competitions/c9/publication-request', () => {
        state = { ...complete, publicationRequestedAt: '2026-10-14T10:00:00.000Z' };
        return [200, state];
      });
    const screen = await renderScreen(() => <ManageScreen id="c9" />, backend);
    const request = await screen.findByTestId('org-request');
    fireEvent.press(request);
    fireEvent.press(request);
    expect(await screen.findByText('Publication requested: the Fitness League team will publish it or send it back with a note.')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c9/publication-request')).toHaveLength(1);
  });

  it("shows the team's note when the draft is sent back", async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" />, organizerBackend({ ...complete, publicationNote: 'The banner is blurred.' }));
    expect(await screen.findByText('Sent back by the team. Fix this, then ask again:')).toBeTruthy();
    expect(screen.getByTestId('org-note').props.children).toBe('The banner is blurred.');
    expect(screen.getByTestId('org-request').props.accessibilityState?.disabled).toBe(false);
  });

  it('once published: no checklist, a share button', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" />, organizerBackend({ ...complete, status: 'REGISTRATION_OPEN' }));
    expect(await screen.findByTestId('org-share')).toBeTruthy();
    expect(screen.queryByTestId('org-request')).toBeNull();
  });

  it('the competition page offers « Manage » to its organizer only', async () => {
    const page = await renderScreen(() => <CompetitionScreen id="c9" />, organizerBackend(complete), { routes: manageRoute });
    await fireEvent.press(await page.findByTestId('comp-manage'));
    expect(await page.findByText('Manage page')).toBeTruthy();
    page.unmount();
    const athlete = await renderScreen(() => <CompetitionScreen id="c9" />, organizerBackend({ ...complete, status: 'REGISTRATION_OPEN', myRoles: [] }));
    await athlete.findByText('Sousse Summer Throwdown');
    expect(athlete.queryByTestId('comp-manage')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest test/screens/organizer.test.tsx`
Expected: FAIL, « Cannot find module '../../src/features/competitions/organizer/manage' ».

- [ ] **Step 3: Write the dashboard**

`apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx`:
```tsx
import { useRef, useState } from 'react';
import { Share, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { Loading, SectionHeader, StatCard } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, ListGroup, ListRow, Screen, Txt, toast } from '../../../core/widgets/kit';
import { formatMoney } from '../api';
import { statusLabelForCompetition } from '../screens';
import { organizerApi, useOrganizerDashboard, useRefreshCompetition } from './api';
import { CHECKLIST, missingForPublication, publicationState, TAB_FOR, type ChecklistItem, type ManageTab } from './logic';

export function DashboardTab({ c, onGo }: { c: Json; onGo: (tab: ManageTab) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const dash = useOrganizerDashboard(c.id);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const state = publicationState(c);
  const missing = missingForPublication(c);
  const canRequest = (state === 'DRAFT' || state === 'RETURNED') && missing.length === 0;
  const labels: Record<ChecklistItem, string> = { DESCRIPTION: t('orgCheckDescription'), DATES: t('orgCheckDates'), COVER: t('orgCheckCover'), CATEGORY: t('orgCheckCategory'), WOD: t('orgCheckWod') };
  const stateText = {
    DRAFT: t('orgStateDraft'),
    REQUESTED: t('orgStateRequested'),
    RETURNED: t('orgStateReturned'),
    PUBLISHED: t('orgStatePublished', { status: statusLabelForCompetition(t, c.status) }),
  }[state];

  async function request() {
    if (sending.current || !canRequest) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await organizerApi(api).requestPublication(c.id);
      toast(t('orgRequested'));
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  function share() {
    const text = t('orgShareText', { title: c.title, date: formatDate(c.eventStart, locale), place: c.city ?? c.location ?? '' });
    void Share.share({ message: `${text}\nfitnessleague://competitions/${c.id}` });
  }

  const d = dash.data;
  return (
    <Screen>
      <Card testID="org-state" style={{ gap: space.sm }}>
        <Txt variant="title">{stateText}</Txt>
        {state === 'RETURNED' ? (
          <Txt testID="org-note" color={colors.error}>
            {c.publicationNote}
          </Txt>
        ) : null}
      </Card>
      {state === 'PUBLISHED' ? (
        <Button testID="org-share" kind="outlined" icon="share" label={t('orgShare')} onPress={share} />
      ) : (
        <>
          <SectionHeader title={t('orgChecklist')} />
          <ListGroup>
            {CHECKLIST.map((item) => {
              const todo = missing.includes(item);
              return (
                <ListRow
                  key={item}
                  testID={`check-${item}`}
                  icon={todo ? 'radio-button-unchecked' : 'check-circle'}
                  title={labels[item]}
                  subtitle={todo ? t('orgGoTo') : null}
                  chevron={todo}
                  onPress={todo ? () => onGo(TAB_FOR[item]) : undefined}
                />
              );
            })}
          </ListGroup>
          <ErrorText error={error} />
          <Button testID="org-request" label={t('orgRequestPublication')} busy={busy} disabled={!canRequest} onPress={request} />
        </>
      )}
      <SectionHeader title={t('orgFigures')} />
      {d ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          <Figure label={t('orgParticipants')} value={String(d.participants)} />
          <Figure label={t('orgPaid')} value={String(d.paidRegistrations)} />
          <Figure label={t('orgToCollect')} value={String(d.pendingPayments)} />
          <Figure label={t('orgRevenue')} value={formatMoney(d.revenue, c.currency, locale)} />
          <Figure label={t('orgToJudge')} value={String(d.pendingJudging)} />
        </View>
      ) : (
        <Loading />
      )}
    </Screen>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '47%' }}>
      <StatCard label={label}>
        <Txt variant="headline">{value}</Txt>
      </StatCard>
    </View>
  );
}
```

- [ ] **Step 4: Write the organizer space**

`apps/mobile-rn/src/features/competitions/organizer/manage.tsx`:
```tsx
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useT } from '../../../core/prefs';
import { useTheme } from '../../../core/theme';
import { EmptyState, Loading } from '../../../core/widgets/common';
import { ErrorView } from '../../../core/widgets/error';
import { Chip } from '../../../core/widgets/kit';
import { useCompetition } from '../api';
import { DashboardTab } from './dashboard';
import type { ManageTab } from './logic';

/** Tabs of the organizer space, in display order (lot A; lot B adds planning, participants, team, leaderboard, announcements, promo codes). */
const TABS: ManageTab[] = ['dashboard'];

export function ManageScreen({ id, initialTab = 'dashboard' }: { id: string; initialTab?: ManageTab }) {
  const t = useT();
  const { colors } = useTheme();
  const comp = useCompetition(id);
  const [tab, setTab] = useState<ManageTab>(initialTab);
  const labels: Record<ManageTab, string> = { dashboard: t('orgTabDashboard'), general: t('orgTabGeneral'), categories: t('orgTabCategories'), wods: t('orgTabWods') };

  if (comp.isError) return <ErrorView error={comp.error} onRetry={() => comp.refetch()} />;
  const c = comp.data;
  if (!c) return <Loading />;
  if (!(c.myRoles ?? []).includes('ORGANIZER')) return <EmptyState icon="lock" message={t('orgOnly')} />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: c.title }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {TABS.map((k) => (
          <Chip key={k} testID={`org-tab-${k}`} label={labels[k]} selected={tab === k} onPress={() => setTab(k)} />
        ))}
      </ScrollView>
      {tab === 'dashboard' && <DashboardTab c={c} onGo={setTab} />}
    </View>
  );
}
```
`apps/mobile-rn/src/app/competitions/[id]/manage.tsx`:
```tsx
import { useLocalSearchParams } from 'expo-router';

import { ManageScreen } from '../../../features/competitions/organizer/manage';

export default function CompetitionManageRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ManageScreen id={id} />;
}
```
In `src/features/shell/root.tsx`, after the `competitions/[id]/index` line, add:
```tsx
          <Stack.Screen name="competitions/[id]/manage" options={{ title: t('orgManage') }} />
```
In `src/features/competitions/screens.tsx`, `CompetitionScreen`, directly after the line `<Stack.Screen options={{ title: c.title }} />`, add:
```tsx
      {(c.myRoles ?? []).includes('ORGANIZER') ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Button testID="comp-manage" kind="outlined" icon="tune" label={t('orgManage')} onPress={() => router.push(`/competitions/${c.id}/manage`)} />
        </View>
      ) : null}
```

- [ ] **Step 5: Run the tests**

Run: `npx jest test/screens/organizer.test.tsx test/screens/competitions.test.tsx && npx tsc --noEmit`
Expected: all pass. (If importing `statusLabelForCompetition` from `../screens` into `dashboard.tsx` creates an import cycle error in Jest, move `statusLabelForCompetition` into `src/features/competitions/status.ts`, re-export it from `screens.tsx`, and import it from there: a ruling for the ledger.)

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/src/features/competitions/organizer/dashboard.tsx "apps/mobile-rn/src/app/competitions/[id]/manage.tsx" apps/mobile-rn/src/features/shell/root.tsx apps/mobile-rn/src/features/competitions/screens.tsx apps/mobile-rn/test/screens/organizer.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer space with the publication checklist and request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: App — « Général »: info, dates, banner, status, deletion

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/general.tsx`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/manage.tsx` (tab `general`)
- Test: `apps/mobile-rn/test/screens/organizer.test.tsx` (new `describe`)

**Interfaces:**
- Consumes: `organizerApi.update / uploadCover / removeCover / setStatus / remove`, `useRefreshCompetition` (Task 4); `COVER_MAX_BYTES`, `ORGANIZER_NEXT`, `datesValid`, `toMillimes`, `fromMillimes`, `EventFormat` (Task 4); `DEFAULT_COVER` (`../screens`); `pickImage` (`core/utils/pick-image`).
- Produces: `GeneralTab({ c })`; `TABS` becomes `['dashboard', 'general']`.

- [ ] **Step 1: Write the failing tests**

At the top of `organizer.test.tsx`, add (Jest hoists `jest.mock`):
```tsx
import { pickImage } from '../../src/core/utils/pick-image';

jest.mock('../../src/core/utils/pick-image', () => ({ pickImage: jest.fn() }));
const pick = pickImage as jest.Mock;
```
Append:
```tsx
describe('organizer space: general', () => {
  beforeEach(() => pick.mockReset());

  it('the checklist leads to the tab that fixes the item', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" />, organizerBackend(draft));
    await fireEvent.press(await screen.findByTestId('check-COVER'));
    expect(await screen.findByTestId('org-banner-pick')).toBeTruthy();
  });

  it('saves the edited info', async () => {
    const backend = organizerBackend(draft).on('PUT', '/competitions/c9', [200, draft]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="general" />, backend);
    await fireEvent.changeText(await screen.findByTestId('org-title'), 'Sousse Summer Throwdown 2026');
    await fireEvent.changeText(screen.getByTestId('org-price'), '45,5');
    await fireEvent.press(screen.getByTestId('org-save'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9')).toHaveLength(1));
    expect(backend.calls('PUT', '/competitions/c9')[0].body).toMatchObject({ title: 'Sousse Summer Throwdown 2026', registrationPrice: 45500, city: 'Sousse', location: 'Bodynade', format: 'ONSITE' });
  });

  it('refuses a banner over 5 MB without sending it, uploads a valid one', async () => {
    const backend = organizerBackend(draft).on('PUT', '/competitions/c9/cover', [200, { coverUrl: 'https://cdn.test/new.webp' }]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="general" />, backend);
    pick.mockResolvedValueOnce({ tooLarge: true });
    await fireEvent.press(await screen.findByTestId('org-banner-pick'));
    expect(await screen.findByText('This image is larger than 5 MB.')).toBeTruthy();
    expect(backend.calls('PUT', '/competitions/c9/cover')).toHaveLength(0);
    pick.mockResolvedValueOnce({ file: { uri: 'file:///banner.jpg', name: 'banner.jpg', type: 'image/jpeg' } });
    await fireEvent.press(screen.getByTestId('org-banner-pick'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/cover')).toHaveLength(1));
  });

  it('deletes the draft after confirmation', async () => {
    const backend = organizerBackend(draft).on('DELETE', '/competitions/c9', [204, undefined]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="general" />, backend, { routes: { 'competitions/index': () => <Text>Competitions list</Text> } });
    await fireEvent.press(await screen.findByTestId('org-delete'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('Competitions list')).toBeTruthy();
    expect(backend.calls('DELETE', '/competitions/c9')).toHaveLength(1);
  });

  it('once published: next steps instead of deletion', async () => {
    const backend = organizerBackend({ ...complete, status: 'REGISTRATION_OPEN' }).on('PATCH', '/competitions/c9/status', [200, {}]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="general" />, backend);
    await fireEvent.press(await screen.findByText('Close registration'));
    await waitFor(() => expect(backend.calls('PATCH', '/competitions/c9/status')[0]?.body).toEqual({ status: 'REGISTRATION_CLOSED' }));
    expect(screen.queryByTestId('org-delete')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest test/screens/organizer.test.tsx -t general`
Expected: FAIL (no `org-banner-pick`, no `org-title` in the organizer space).

- [ ] **Step 3: Write the tab**

`apps/mobile-rn/src/features/competitions/organizer/general.tsx`:
```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, useWindowDimensions, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { radius, space, useTheme } from '../../../core/theme';
import { pickImage } from '../../../core/utils/pick-image';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Chip, Dialog, Screen, TextField, Txt, toast } from '../../../core/widgets/kit';
import { DateField } from '../../../core/widgets/pickers';
import { DEFAULT_COVER } from '../screens';
import { organizerApi, useRefreshCompetition } from './api';
import { COVER_MAX_BYTES, datesValid, fromMillimes, ORGANIZER_NEXT, toMillimes, type EventFormat } from './logic';

export function GeneralTab({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const refresh = useRefreshCompetition();
  const [title, setTitle] = useState<string>(c.title ?? '');
  const [description, setDescription] = useState<string>(c.description ?? '');
  const [format, setFormat] = useState<EventFormat>(c.format ?? 'ONSITE');
  const [city, setCity] = useState<string>(c.city ?? '');
  const [place, setPlace] = useState<string>(c.location ?? '');
  const [regStart, setRegStart] = useState(() => new Date(c.deadlines?.registrationStart ?? c.registrationEnd));
  const [regEnd, setRegEnd] = useState(() => new Date(c.registrationEnd));
  const [eventStart, setEventStart] = useState(() => new Date(c.eventStart));
  const [eventEnd, setEventEnd] = useState(() => new Date(c.eventEnd));
  const [price, setPrice] = useState(fromMillimes(c.registrationPrice));
  const [max, setMax] = useState(c.maxParticipants ? String(c.maxParticipants) : '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);

  const onsite = format !== 'ONLINE';
  const priceMillimes = toMillimes(price);
  const maxN = max.trim() ? Number(max.trim()) : null;
  const dates = { registrationStart: regStart, registrationEnd: regEnd, eventStart, eventEnd };
  const placeOk = !onsite || (city.trim().length > 0 && place.trim().length > 0);
  const valid =
    title.trim().length >= 3 && title.trim().length <= 120 && description.trim().length >= 1 && placeOk && datesValid(dates) && priceMillimes != null && (maxN == null || (Number.isInteger(maxN) && maxN >= 1));
  const draft = c.status === 'DRAFT';
  const bannerWidth = Math.min(width, 720) - 32;
  const nextLabels: Record<string, string> = {
    REGISTRATION_OPEN: t('orgToRegistrationOpen'),
    REGISTRATION_CLOSED: t('orgToRegistrationClosed'),
    ACTIVE: t('orgToActive'),
    SUBMISSION_OPEN: t('orgToSubmissionOpen'),
    JUDGING: t('orgToJudging'),
    PROVISIONAL_LEADERBOARD: t('orgToProvisional'),
    FINISHED: t('orgToFinished'),
  };

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      setBusy(null);
    }
  }

  const save = () =>
    run(
      'save',
      () =>
        organizerApi(api).update(c.id, {
          title: title.trim(),
          description: description.trim(),
          format,
          city: city.trim(),
          location: place.trim(),
          registrationStart: regStart.toISOString(),
          registrationEnd: regEnd.toISOString(),
          eventStart: eventStart.toISOString(),
          eventEnd: eventEnd.toISOString(),
          registrationPrice: priceMillimes!,
          maxParticipants: maxN,
        }),
      t('orgSaved'),
    );

  async function pickBanner() {
    const picked = await pickImage(COVER_MAX_BYTES);
    if (!picked) return;
    if ('tooLarge' in picked) {
      toast(t('orgBannerTooLarge'));
      return;
    }
    await run('cover', () => organizerApi(api).uploadCover(c.id, picked.file));
  }

  async function remove() {
    setDeleting(false);
    setBusy('delete');
    try {
      await organizerApi(api).remove(c.id);
      router.replace('/competitions');
      await refresh();
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  const formats: { key: EventFormat; label: string }[] = [
    { key: 'ONSITE', label: t('orgFormatOnsite') },
    { key: 'ONLINE', label: t('orgFormatOnline') },
    { key: 'HYBRID', label: t('orgFormatHybrid') },
  ];
  return (
    <Screen>
      <SectionHeader title={t('orgBanner')} />
      <Image source={c.coverUrl ? { uri: c.coverUrl } : DEFAULT_COVER} style={{ width: bannerWidth, height: (bannerWidth * 596) / 1440, borderRadius: radius.field }} />
      <Txt variant="small" color={colors.outline}>{t('orgBannerHint')}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button testID="org-banner-pick" kind="outlined" icon="image" label={t('orgBannerPick')} busy={busy === 'cover'} onPress={pickBanner} />
        {c.coverUrl ? <Button testID="org-banner-remove" kind="text" label={t('orgBannerRemove')} onPress={() => run('cover', () => organizerApi(api).removeCover(c.id))} /> : null}
      </View>

      <SectionHeader title={t('orgTabGeneral')} />
      <TextField testID="org-title" label={t('orgName')} value={title} onChangeText={setTitle} maxLength={120} />
      <TextField testID="org-description" label={t('orgDescription')} value={description} onChangeText={setDescription} maxLength={5000} multiline />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {formats.map((f) => (
          <Chip key={f.key} testID={`org-format-${f.key}`} label={f.label} selected={format === f.key} onPress={() => setFormat(f.key)} />
        ))}
      </View>
      <TextField testID="org-city" label={t('city')} value={city} onChangeText={setCity} maxLength={100} />
      <TextField testID="org-place" label={t('orgPlace')} value={place} onChangeText={setPlace} maxLength={200} />
      {!placeOk && <Txt variant="small" color={colors.outline}>{t('orgPlaceRequired')}</Txt>}
      <DateField mode="datetime" label={t('orgRegistrationStart')} value={regStart} onChange={setRegStart} />
      <DateField mode="datetime" label={t('orgRegistrationEnd')} value={regEnd} onChange={setRegEnd} />
      <DateField mode="datetime" label={t('orgEventStart')} value={eventStart} onChange={setEventStart} />
      <DateField mode="datetime" label={t('orgEventEnd')} value={eventEnd} onChange={setEventEnd} />
      {!datesValid(dates) && <Txt variant="small" color={colors.error}>{t('orgDatesInvalid')}</Txt>}
      <TextField testID="org-price" label={t('orgPrice')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
      <TextField testID="org-max" label={t('orgMaxParticipants')} value={max} onChangeText={setMax} keyboardType="number-pad" />
      <ErrorText error={error} />
      <Button testID="org-save" label={t('save')} busy={busy === 'save'} disabled={!valid} onPress={save} />

      <SectionHeader title={t('orgEvent')} />
      {draft ? (
        <Button testID="org-delete" kind="outlined" icon="delete" label={t('orgDelete')} busy={busy === 'delete'} onPress={() => setDeleting(true)} />
      ) : (
        <>
          <Txt variant="small" color={colors.outline}>{t('orgNextStep')}</Txt>
          {(ORGANIZER_NEXT[c.status] ?? []).map((s) => (
            <Button key={s} testID={`org-next-${s}`} kind="outlined" label={nextLabels[s]} busy={busy === s} onPress={() => run(s, () => organizerApi(api).setStatus(c.id, s))} />
          ))}
        </>
      )}
      <Dialog
        visible={deleting}
        title={t('orgDelete')}
        message={t('orgDeleteConfirm', { title: c.title })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={remove}
        onCancel={() => setDeleting(false)}
      />
    </Screen>
  );
}
```
In `manage.tsx`: `import { GeneralTab } from './general';`, `const TABS: ManageTab[] = ['dashboard', 'general'];`, and after the dashboard line: `{tab === 'general' && <GeneralTab c={c} />}`.

- [ ] **Step 4: Run the tests**

Run: `npx jest test/screens/organizer.test.tsx && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/general.tsx apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/test/screens/organizer.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer general tab: info, dates, banner, next steps, draft deletion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: App — « Catégories »

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/categories.tsx`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/manage.tsx` (tab `categories`)
- Test: `apps/mobile-rn/test/screens/organizer.test.tsx` (new `describe`)

**Interfaces:**
- Consumes: `organizerApi.addCategory / addTemplates / updateCategory`, `useRefreshCompetition` (Task 4); `CatDraft`, `catDraft`, `catValid`, `catBody` (Task 4); `formatMoney` (`../api`).
- Produces: `CategoriesTab({ c })`; `TABS` becomes `['dashboard', 'general', 'categories']`.

- [ ] **Step 1: Write the failing tests**

Append to `organizer.test.tsx`:
```tsx
describe('organizer space: categories', () => {
  const two = [
    { id: 'k1', name: 'RX Men', gender: 'MALE', minAge: 18, maxAge: 35, level: 'RX', maxParticipants: 40, registrationPriceOverride: null, active: true, sortOrder: 0 },
    { id: 'k2', name: 'RX Women', gender: 'FEMALE', minAge: 18, maxAge: 35, level: 'RX', maxParticipants: 40, registrationPriceOverride: 35000, active: true, sortOrder: 1 },
  ];

  it('adds the standard categories when there is none', async () => {
    const backend = organizerBackend(draft).on('POST', '/competitions/c9/categories/templates', [201, {}]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="categories" />, backend);
    await fireEvent.press(await screen.findByTestId('cat-templates'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/categories/templates')).toHaveLength(1));
  });

  it('creates a category with its ages and price', async () => {
    const backend = organizerBackend(draft).on('POST', '/competitions/c9/categories', [201, {}]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="categories" />, backend);
    await fireEvent.press(await screen.findByTestId('cat-new'));
    await fireEvent.changeText(screen.getByTestId('cat-name'), 'RX Men 18-35');
    await fireEvent.press(screen.getByTestId('cat-gender-MALE'));
    await fireEvent.changeText(screen.getByTestId('cat-min'), '18');
    await fireEvent.changeText(screen.getByTestId('cat-max-age'), '35');
    await fireEvent.changeText(screen.getByTestId('cat-price'), '45');
    await fireEvent.press(screen.getByTestId('cat-save'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/categories')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/categories')[0].body).toEqual({ name: 'RX Men 18-35', gender: 'MALE', minAge: 18, maxAge: 35, level: '', maxParticipants: null, registrationPriceOverride: 45000, sortOrder: 0 });
  });

  it('reorders by swapping the two categories', async () => {
    const backend = organizerBackend({ ...draft, categories: two }).on('PUT', '/competitions/c9/categories/k1', [200, {}]).on('PUT', '/competitions/c9/categories/k2', [200, {}]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="categories" />, backend);
    await fireEvent.press((await screen.findAllByLabelText('Move down'))[0]);
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/categories/k2')).toHaveLength(1));
    expect(backend.calls('PUT', '/competitions/c9/categories/k1')[0].body).toEqual({ sortOrder: 1 });
    expect(backend.calls('PUT', '/competitions/c9/categories/k2')[0].body).toEqual({ sortOrder: 0 });
  });

  it('deactivates a category', async () => {
    const backend = organizerBackend({ ...draft, categories: two }).on('PUT', '/competitions/c9/categories/k2', [200, {}]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="categories" />, backend);
    await fireEvent.press(await screen.findByTestId('cat-k2'));
    await fireEvent.press(screen.getByTestId('cat-toggle'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/categories/k2')[0]?.body).toEqual({ active: false }));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest test/screens/organizer.test.tsx -t categories`
Expected: FAIL (no `cat-templates`).

- [ ] **Step 3: Write the tab**

`apps/mobile-rn/src/features/competitions/organizer/categories.tsx`:
```tsx
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Chip, IconButton, ListGroup, ListRow, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { formatMoney } from '../api';
import { organizerApi, useRefreshCompetition } from './api';
import { catBody, catDraft, catValid, type CatDraft } from './logic';

export function CategoriesTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const { colors } = useTheme();
  const refresh = useRefreshCompetition();
  const cats: Json[] = [...(c.categories ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const [edit, setEdit] = useState<CatDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const genderLabel: Record<string, string> = { MALE: t('orgGenderMale'), FEMALE: t('orgGenderFemale'), MIXED: t('orgGenderMixed') };

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const save = (d: CatDraft) =>
    run(() => (d.id ? organizerApi(api).updateCategory(c.id, d.id, catBody(d)) : organizerApi(api).addCategory(c.id, { ...catBody(d), sortOrder: cats.length })), () => setEdit(null));
  const toggle = (d: CatDraft) => run(() => organizerApi(api).updateCategory(c.id, d.id!, { active: !d.active }), () => setEdit(null));

  /** Swaps two neighbours, then gives every category its position as sortOrder (only the changed ones are sent). */
  function move(i: number, dir: -1 | 1) {
    const order = cats.map((x) => x.id as string);
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    void run(async () => {
      for (const [n, id] of order.entries()) {
        if (cats.find((x) => x.id === id)!.sortOrder !== n) await organizerApi(api).updateCategory(c.id, id, { sortOrder: n });
      }
    });
  }

  const subtitle = (x: Json) =>
    [
      genderLabel[x.gender],
      x.minAge != null || x.maxAge != null ? `${x.minAge ?? ''}–${x.maxAge ?? ''}` : null,
      x.level || null,
      x.maxParticipants ? String(x.maxParticipants) : null,
      x.registrationPriceOverride != null ? formatMoney(x.registrationPriceOverride, c.currency, locale) : null,
      x.active ? null : t('orgInactive'),
    ]
      .filter(Boolean)
      .join(' · ');

  if (edit) return <CategoryForm draft={edit} busy={busy} error={error} onSave={save} onToggle={toggle} onCancel={() => setEdit(null)} />;
  return (
    <Screen>
      {cats.length === 0 ? (
        <>
          <Txt color={colors.outline}>{t('orgNoCategories')}</Txt>
          <Button testID="cat-templates" kind="outlined" icon="playlist-add" label={t('orgAddTemplates')} busy={busy} onPress={() => run(() => organizerApi(api).addTemplates(c.id))} />
        </>
      ) : (
        <ListGroup>
          {cats.map((x, i) => (
            <ListRow
              key={x.id}
              testID={`cat-${x.id}`}
              title={x.name}
              subtitle={subtitle(x)}
              onPress={() => setEdit(catDraft(x))}
              trailing={
                <View style={{ flexDirection: 'row' }}>
                  {i > 0 ? <IconButton icon="arrow-upward" label={t('orgMoveUp')} onPress={() => move(i, -1)} /> : null}
                  {i < cats.length - 1 ? <IconButton icon="arrow-downward" label={t('orgMoveDown')} onPress={() => move(i, 1)} /> : null}
                </View>
              }
            />
          ))}
        </ListGroup>
      )}
      <ErrorText error={error} />
      <Button testID="cat-new" icon="add" label={t('orgNewCategory')} onPress={() => setEdit(catDraft(null))} />
    </Screen>
  );
}

function CategoryForm({ draft, busy, error, onSave, onToggle, onCancel }: { draft: CatDraft; busy: boolean; error: unknown; onSave: (d: CatDraft) => void; onToggle: (d: CatDraft) => void; onCancel: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const [d, setD] = useState(draft);
  const set = (k: 'name' | 'minAge' | 'maxAge' | 'level' | 'max' | 'price') => (v: string) => setD({ ...d, [k]: v });
  const genders: [CatDraft['gender'], string][] = [
    ['MALE', t('orgGenderMale')],
    ['FEMALE', t('orgGenderFemale')],
    ['MIXED', t('orgGenderMixed')],
  ];
  const ok = catValid(d);
  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <TextField testID="cat-name" label={t('orgCategoryName')} value={d.name} onChangeText={set('name')} maxLength={120} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {genders.map(([g, label]) => (
            <Chip key={g} testID={`cat-gender-${g}`} label={label} selected={d.gender === g} onPress={() => setD({ ...d, gender: g })} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <TextField testID="cat-min" label={t('orgMinAge')} value={d.minAge} onChangeText={set('minAge')} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField testID="cat-max-age" label={t('orgMaxAge')} value={d.maxAge} onChangeText={set('maxAge')} keyboardType="number-pad" />
          </View>
        </View>
        <TextField testID="cat-level" label={t('orgLevel')} value={d.level} onChangeText={set('level')} maxLength={40} />
        <TextField testID="cat-places" label={t('orgCategoryMax')} value={d.max} onChangeText={set('max')} keyboardType="number-pad" />
        <TextField testID="cat-price" label={t('orgCategoryPrice')} value={d.price} onChangeText={set('price')} keyboardType="decimal-pad" />
        {!ok && d.name.trim().length > 0 ? <Txt variant="small" color={colors.error}>{t('orgCategoryInvalid')}</Txt> : null}
        <ErrorText error={error} />
        <Button testID="cat-save" label={t('save')} busy={busy} disabled={!ok} onPress={() => onSave(d)} />
        {d.id ? <Button testID="cat-toggle" kind="outlined" label={d.active ? t('orgDeactivate') : t('orgActivate')} busy={busy} onPress={() => onToggle(d)} /> : null}
        <Button kind="text" label={t('cancel')} onPress={onCancel} />
      </Card>
    </Screen>
  );
}
```
In `manage.tsx`: `import { CategoriesTab } from './categories';`, `const TABS: ManageTab[] = ['dashboard', 'general', 'categories'];`, and `{tab === 'categories' && <CategoriesTab c={c} />}`.

- [ ] **Step 4: Run the tests**

Run: `npx jest test/screens/organizer.test.tsx && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/categories.tsx apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/test/screens/organizer.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer categories tab: standard set, create, edit, order, activate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: App — « WODs »

**Files:**
- Create: `apps/mobile-rn/src/features/competitions/organizer/wods.tsx`
- Modify: `apps/mobile-rn/src/features/competitions/organizer/manage.tsx` (tab `wods`)
- Test: `apps/mobile-rn/test/screens/organizer.test.tsx` (new `describe`)

**Interfaces:**
- Consumes: `organizerApi.addWod / updateWod / removeWod / reorderWods`, `useRefreshCompetition` (Task 4); `WodDraft`, `wodDraft`, `wodValid`, `wodBody`, `nextWodNumber`, `SCORE_TYPES` (Task 4).
- Produces: `WodsTab({ c })`; `TABS` becomes `['dashboard', 'general', 'categories', 'wods']`.

Scope note (spec §1.3 item 4): one WOD applies to every category in lot A. Per-category variants (`categorySpecific` + `variants`) and the release date (`releaseAt`) are left for lot B; the API accepts their absence.

- [ ] **Step 1: Write the failing tests**

Append to `organizer.test.tsx`:
```tsx
describe('organizer space: WODs', () => {
  const wods = [
    { id: 'w1', number: 1, name: 'WOD 1', description: 'AMRAP 12', standards: null, scoreType: 'REPS', scoringMethod: 'DIRECT_POINTS', maximumPoints: 100, minimumPoints: 0, placementTable: [], timeCapS: null, videoUrl: null, movements: [], submissionStart: '2026-12-12T08:00:00.000Z', submissionDeadline: '2026-12-13T18:00:00.000Z' },
    { id: 'w2', number: 2, name: 'WOD 2', description: 'For time', standards: null, scoreType: 'TIME', scoringMethod: 'DIRECT_POINTS', maximumPoints: 100, minimumPoints: 0, placementTable: [], timeCapS: 600, videoUrl: null, movements: [], submissionStart: '2026-12-12T08:00:00.000Z', submissionDeadline: '2026-12-13T18:00:00.000Z' },
  ];

  it('creates a reps-per-movement WOD inside the event dates', async () => {
    const backend = organizerBackend(draft).on('POST', '/competitions/c9/wods', [201, {}]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="wods" />, backend);
    await fireEvent.press(await screen.findByTestId('wod-new'));
    await fireEvent.changeText(screen.getByTestId('wod-description'), 'AMRAP 12: burpees, wall balls');
    // A movement without a name cannot count.
    expect(screen.getByTestId('wod-save').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('wod-move-name-0'), 'Burpees');
    await fireEvent.press(screen.getByTestId('wod-move-add'));
    await fireEvent.changeText(screen.getByTestId('wod-move-name-1'), 'Wall balls');
    await fireEvent.changeText(screen.getByTestId('wod-move-points-1'), '0,5');
    await fireEvent.press(screen.getByTestId('wod-save'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/wods')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/wods')[0].body).toMatchObject({
      number: 1,
      name: 'WOD 1',
      scoreType: 'MOVEMENT_REPS',
      movements: [
        { name: 'Burpees', pointsPerRep: 1 },
        { name: 'Wall balls', pointsPerRep: 0.5 },
      ],
      submissionStart: '2026-12-12T08:00:00.000Z',
      submissionDeadline: '2026-12-13T18:00:00.000Z',
    });
  });

  it('edits a WOD with its whole description and keeps its number', async () => {
    const backend = organizerBackend({ ...draft, workouts: wods }).on('PUT', '/competitions/c9/wods/w2', [200, {}]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="wods" />, backend);
    await fireEvent.press(await screen.findByTestId('wod-w2'));
    await fireEvent.changeText(screen.getByTestId('wod-name'), 'Final sprint');
    await fireEvent.press(screen.getByTestId('wod-save'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/wods/w2')).toHaveLength(1));
    expect(backend.calls('PUT', '/competitions/c9/wods/w2')[0].body).toMatchObject({ number: 2, name: 'Final sprint', scoreType: 'TIME', timeCapS: 600, movements: [] });
  });

  it('reorders and deletes', async () => {
    const backend = organizerBackend({ ...draft, workouts: wods }).on('POST', '/competitions/c9/wods/reorder', [200, []]).on('DELETE', '/competitions/c9/wods/w1', [204, undefined]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="wods" />, backend);
    await fireEvent.press((await screen.findAllByLabelText('Move down'))[0]);
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/wods/reorder')[0]?.body).toEqual({ workoutIds: ['w2', 'w1'] }));
    await fireEvent.press(screen.getByTestId('wod-w1'));
    await fireEvent.press(screen.getByTestId('wod-delete'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('DELETE', '/competitions/c9/wods/w1')).toHaveLength(1));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest test/screens/organizer.test.tsx -t WODs`
Expected: FAIL (no `wod-new`).

- [ ] **Step 3: Write the tab**

`apps/mobile-rn/src/features/competitions/organizer/wods.tsx`:
```tsx
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT, type T } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Chip, Dialog, IconButton, ListGroup, ListRow, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { DateField } from '../../../core/widgets/pickers';
import { organizerApi, useRefreshCompetition } from './api';
import { nextWodNumber, SCORE_TYPES, wodBody, wodDraft, wodValid, type WodDraft } from './logic';

const scoreLabels = (t: T): Record<string, string> => ({
  MOVEMENT_REPS: t('orgScoreMovementReps'),
  REPS: t('orgScoreReps'),
  TIME: t('orgScoreTime'),
  ROUNDS_REPS: t('orgScoreRoundsReps'),
  LOAD: t('orgScoreLoad'),
  MAX_WEIGHT: t('orgScoreMaxWeight'),
  DISTANCE: t('orgScoreDistance'),
  CALORIES: t('orgScoreCalories'),
  POINTS: t('orgScorePoints'),
  COMPLEX: t('orgScoreComplex'),
});

export function WodsTab({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const refresh = useRefreshCompetition();
  const workouts: Json[] = [...(c.workouts ?? [])].sort((a, b) => a.number - b.number);
  const [edit, setEdit] = useState<WodDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const labels = scoreLabels(t);
  const defaults = { number: nextWodNumber(workouts), start: new Date(c.eventStart), end: new Date(c.eventEnd) };

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const save = (d: WodDraft) => run(() => (d.id ? organizerApi(api).updateWod(c.id, d.id, wodBody(d)) : organizerApi(api).addWod(c.id, wodBody(d))), () => setEdit(null));
  const remove = (d: WodDraft) => run(() => organizerApi(api).removeWod(c.id, d.id!), () => setEdit(null));
  function move(i: number, dir: -1 | 1) {
    const order = workouts.map((w) => w.id as string);
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    void run(() => organizerApi(api).reorderWods(c.id, order));
  }

  if (edit) return <WodForm draft={edit} busy={busy} error={error} labels={labels} onSave={save} onDelete={remove} onCancel={() => setEdit(null)} />;
  return (
    <Screen>
      {workouts.length === 0 ? (
        <Txt color={colors.outline}>{t('orgNoWods')}</Txt>
      ) : (
        <ListGroup>
          {workouts.map((w, i) => (
            <ListRow
              key={w.id}
              testID={`wod-${w.id}`}
              title={`${w.number}. ${w.name}`}
              subtitle={labels[w.scoreType] ?? w.scoreType}
              onPress={() => setEdit(wodDraft(w, defaults))}
              trailing={
                <View style={{ flexDirection: 'row' }}>
                  {i > 0 ? <IconButton icon="arrow-upward" label={t('orgMoveUp')} onPress={() => move(i, -1)} /> : null}
                  {i < workouts.length - 1 ? <IconButton icon="arrow-downward" label={t('orgMoveDown')} onPress={() => move(i, 1)} /> : null}
                </View>
              }
            />
          ))}
        </ListGroup>
      )}
      <ErrorText error={error} />
      <Button testID="wod-new" icon="add" label={t('orgNewWod')} onPress={() => setEdit(wodDraft(null, defaults))} />
    </Screen>
  );
}

function WodForm({ draft, busy, error, labels, onSave, onDelete, onCancel }: { draft: WodDraft; busy: boolean; error: unknown; labels: Record<string, string>; onSave: (d: WodDraft) => void; onDelete: (d: WodDraft) => void; onCancel: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const [d, setD] = useState(draft);
  const [deleting, setDeleting] = useState(false);
  const set = (k: 'name' | 'description' | 'standards' | 'table' | 'max' | 'min' | 'capMin' | 'videoUrl') => (v: string) => setD({ ...d, [k]: v });
  const setMove = (i: number, k: 'name' | 'points', v: string) => setD({ ...d, movements: d.movements.map((m, j) => (j === i ? { ...m, [k]: v } : m)) });
  const ok = wodValid(d);
  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <TextField testID="wod-name" label={t('orgWodName')} value={d.name} onChangeText={set('name')} maxLength={80} />
        <TextField testID="wod-description" label={t('orgWodDescription')} value={d.description} onChangeText={set('description')} maxLength={5000} multiline />
        <TextField testID="wod-standards" label={t('orgStandards')} value={d.standards} onChangeText={set('standards')} maxLength={5000} multiline />
        <SectionHeader title={t('orgScoreType')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {SCORE_TYPES.map((s) => (
            <Chip key={s} testID={`wod-type-${s}`} label={labels[s]} selected={d.scoreType === s} onPress={() => setD({ ...d, scoreType: s })} />
          ))}
        </View>
        {d.scoreType === 'MOVEMENT_REPS' ? (
          <>
            <SectionHeader title={t('orgMovements')} />
            {d.movements.map((m, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ flex: 2 }}>
                  <TextField testID={`wod-move-name-${i}`} label={t('orgMovementName')} value={m.name} onChangeText={(v) => setMove(i, 'name', v)} maxLength={80} />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField testID={`wod-move-points-${i}`} label={t('orgPointsPerRep')} value={m.points} onChangeText={(v) => setMove(i, 'points', v)} keyboardType="decimal-pad" />
                </View>
                {d.movements.length > 1 ? <IconButton icon="close" label={t('orgRemoveMovement')} onPress={() => setD({ ...d, movements: d.movements.filter((_, j) => j !== i) })} /> : null}
              </View>
            ))}
            <Button testID="wod-move-add" kind="text" icon="add" label={t('orgAddMovement')} onPress={() => setD({ ...d, movements: [...d.movements, { name: '', points: '1' }] })} />
          </>
        ) : null}
        <SectionHeader title={t('orgScoring')} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Chip testID="wod-method-direct" label={t('orgScoringDirect')} selected={d.method === 'DIRECT_POINTS'} onPress={() => setD({ ...d, method: 'DIRECT_POINTS' })} />
          <Chip testID="wod-method-placement" label={t('orgScoringPlacement')} selected={d.method === 'PLACEMENT_POINTS'} onPress={() => setD({ ...d, method: 'PLACEMENT_POINTS' })} />
        </View>
        {d.method === 'PLACEMENT_POINTS' ? <TextField testID="wod-table" label={t('orgPlacementTable')} value={d.table} onChangeText={set('table')} /> : null}
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <TextField testID="wod-max" label={t('orgMaxPoints')} value={d.max} onChangeText={set('max')} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField testID="wod-min" label={t('orgMinPoints')} value={d.min} onChangeText={set('min')} keyboardType="number-pad" />
          </View>
        </View>
        <TextField testID="wod-cap" label={t('orgTimeCap')} value={d.capMin} onChangeText={set('capMin')} keyboardType="decimal-pad" />
        <TextField testID="wod-video" label={t('orgVideoUrl')} value={d.videoUrl} onChangeText={set('videoUrl')} keyboardType="url" autoCapitalize="none" maxLength={500} />
        <DateField mode="datetime" label={t('orgSubmissionStart')} value={d.start} onChange={(v) => setD({ ...d, start: v })} />
        <DateField mode="datetime" label={t('orgSubmissionEnd')} value={d.end} onChange={(v) => setD({ ...d, end: v })} />
        {!ok && d.description.trim().length > 0 ? <Txt variant="small" color={colors.error}>{t('orgWodInvalid')}</Txt> : null}
        <ErrorText error={error} />
        <Button testID="wod-save" label={t('save')} busy={busy} disabled={!ok} onPress={() => onSave(d)} />
        {d.id ? <Button testID="wod-delete" kind="outlined" icon="delete" label={t('orgWodDelete')} busy={busy} onPress={() => setDeleting(true)} /> : null}
        <Button kind="text" label={t('cancel')} onPress={onCancel} />
      </Card>
      <Dialog
        visible={deleting}
        title={t('orgWodDelete')}
        message={t('orgWodDeleteConfirm', { name: d.name })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={() => {
          setDeleting(false);
          onDelete(d);
        }}
        onCancel={() => setDeleting(false)}
      />
    </Screen>
  );
}
```
In `manage.tsx`: `import { WodsTab } from './wods';`, `const TABS: ManageTab[] = ['dashboard', 'general', 'categories', 'wods'];`, and `{tab === 'wods' && <WodsTab c={c} />}`.

- [ ] **Step 4: Run the tests**

Run: `npx jest test/screens/organizer.test.tsx && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/organizer/wods.tsx apps/mobile-rn/src/features/competitions/organizer/manage.tsx apps/mobile-rn/test/screens/organizer.test.tsx
git diff --cached --stat
git commit -m "feat(mobile): organizer WODs tab: score types, movements and points per rep, order, delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Drafts in « Mes compétitions », offline demo, visual check, docs

**Files:**
- Modify: `apps/mobile-rn/src/features/competitions/screens.tsx` (`CompetitionCard`)
- Modify: `apps/mobile-rn/src/core/api/demo-backend.ts` (recorded writes)
- Modify: `apps/mobile-rn/assets/demo/api.json` (a demo draft)
- Test: `apps/mobile-rn/test/screens/organizer.test.tsx`, `apps/mobile-rn/test/core/demo.test.ts`
- Modify: `README.md`, `handoff.md`
- Create (not committed): `<scratchpad>/organizer-shots.cjs`; output in `Desktop/organizer-space/`

**Interfaces:**
- Consumes: `publicationState` (Task 4), `publicationRequestedAt` / `publicationNote` on cards (Task 2).
- Produces: demo draft id `01a10804-0000-7000-8000-00000000d001`.

Scope note (spec §1.1): the list cards carry no role, so the « Organisateur » badge is shown through the draft states (only organizers see drafts). For a published competition the organizer enters through « Gérer » on the competition page (Task 6); a role on every card would be a fourth backend change, outside the three agreed.

- [ ] **Step 1: Write the failing tests**

Append to `organizer.test.tsx`:
```tsx
describe('my competitions: drafts', () => {
  it('shows the publication state and opens the organizer space', async () => {
    const card = { id: 'c9', title: 'Sousse Summer Throwdown', status: 'DRAFT', city: 'Sousse', eventStart: '2026-12-12T08:00:00.000Z', registrationEnd: '2026-12-01T22:00:00.000Z', registrationPrice: 40000, currency: 'TND', participants: 0, publicationRequestedAt: '2026-10-14T10:00:00.000Z', publicationNote: null };
    const backend = new FakeBackend().on('GET', '/competitions', [200, [card]]);
    const screen = await renderScreen(CompetitionsScreen, backend, { routes: manageRoute });
    expect(await screen.findByText('Publication requested')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('comp-c9'));
    expect(await screen.findByText('Manage page')).toBeTruthy();
  });
});
```
Append to `test/core/demo.test.ts`, inside its `describe`:
```ts
  it('answers a recorded write: creating an event returns the demo draft', async () => {
    const created = await api().post<{ id: string; status: string; myRoles: string[] }>('/competitions', { title: 'x' });
    expect(created).toMatchObject({ id: '01a10804-0000-7000-8000-00000000d001', status: 'DRAFT', myRoles: ['ORGANIZER'] });
    const mine = await api().get<{ id: string }[]>('/competitions', { filter: 'ALL', mine: 'true' });
    expect(mine.some((c) => c.id === created.id)).toBe(true);
    expect(await api().get(`/competitions/${created.id}/dashboard`)).toMatchObject({ participants: 0 });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest test/screens/organizer.test.tsx test/core/demo.test.ts`
Expected: FAIL (« Publication requested » not shown; demo returns `{}` for `POST /competitions`).

- [ ] **Step 3: Implement**

In `screens.tsx`, add `import { publicationState } from './organizer/logic';`. In `CompetitionCard`, replace the card's `onPress={() => router.push(`/competitions/${c.id}`)}` with:
```tsx
onPress={() => router.push(c.status === 'DRAFT' ? `/competitions/${c.id}/manage` : `/competitions/${c.id}`)}
```
and the `StatusPill` line with:
```tsx
        <StatusPill label={c.status === 'DRAFT' ? draftLabel(t, c) : statusLabelForCompetition(t, c.status)} color={c.status === 'REGISTRATION_OPEN' ? colors.primary : colors.outline} />
```
and add, after `statusLabelForCompetition`:
```tsx
/** Only organizers see drafts: the card tells where the publication stands. */
function draftLabel(t: T, c: Json) {
  const s = publicationState(c);
  return s === 'REQUESTED' ? t('orgCardRequested') : s === 'RETURNED' ? t('orgCardReturned') : t('orgCardDraft');
}
```
In `src/core/api/demo-backend.ts`, in `answer()`, replace:
```ts
  // Writes: accepted but not stored.
```
with:
```ts
  // Writes: accepted but not stored; a recorded answer (the demo draft for POST /competitions) is returned as is.
  const write = recorded[`${method} ${path}`];
  if (write != null) return [method === 'POST' ? 201 : 200, write];
```
Add the demo draft to `assets/demo/api.json` with this one-off command (it keeps the file's indentation):
```bash
cd /mnt/c/Users/GIGABYTE/fitness-league/apps/mobile-rn && node -e '
const fs = require("fs");
const p = "assets/demo/api.json";
const raw = fs.readFileSync(p, "utf8");
const d = JSON.parse(raw);
const id = "01a10804-0000-7000-8000-00000000d001";
const card = { id, slug: "sousse-summer-throwdown-demo", title: "Sousse Summer Throwdown", shortDescription: "Two days on site in Sousse: three WODs per category, final on Sunday.", coverMediaId: null, coverUrl: null, logoMediaId: null, location: "Bodynade, Sousse", city: "Sousse", countryCode: "TN", format: "ONSITE", status: "DRAFT", eventStart: "2026-12-12T08:00:00.000Z", eventEnd: "2026-12-13T18:00:00.000Z", registrationEnd: "2026-12-01T22:00:00.000Z", registrationPrice: 40000, currency: "TND", maxParticipants: 120, participants: 0, publicationRequestedAt: null, publicationNote: null };
const detail = { ...card, description: card.shortDescription, organizer: { id: "demo-athlete", username: "ahmed_rx", fullName: "Ahmed Ben Salah" }, deadlines: { registrationStart: "2026-10-20T08:00:00.000Z", registrationEnd: card.registrationEnd, scoreSubmissionStart: null, scoreSubmissionDeadline: null, judgingDeadline: null, appealDeadline: null, leaderboardPublicationAt: null }, tieBreakRules: [], categories: [{ id: "01a10804-0000-7000-8000-00000000d101", name: "RX Male Division 18-35", gender: "MALE", minAge: 18, maxAge: 35, level: "RX", maxParticipants: 40, registrationPriceOverride: null, sortOrder: 0, active: true, price: 40000 }], workouts: [], prizes: [], myRoles: ["ORGANIZER"], myRegistration: null, serverTime: "2026-10-14T10:00:00.000Z" };
d[`GET /competitions/${id}`] = detail;
d[`GET /competitions/${id}/dashboard`] = { participants: 0, paidRegistrations: 0, freeRegistrations: 0, pendingPayments: 0, revenue: 0, pendingSubmissions: 0, pendingJudging: 0, approvedSubmissions: 0, rejectedSubmissions: 0 };
d["POST /competitions"] = detail;
const mine = "GET /competitions?filter=ALL&mine=true";
d[mine] = [card, ...(d[mine] ?? []).filter((c) => c.id !== id)];
const indent = /\n( +)"/.exec(raw)?.[1].length ?? 0;
fs.writeFileSync(p, JSON.stringify(d, null, indent || undefined) + (raw.endsWith("\n") ? "\n" : ""));
console.log("demo draft added");'
```
Expected: « demo draft added », and `git diff --stat assets/demo/api.json` shows a small change (if the whole file changes, its original layout was different: restore with `git show HEAD:apps/mobile-rn/assets/demo/api.json > assets/demo/api.json` and match its layout in the `JSON.stringify` call).

- [ ] **Step 4: Run every app check**

Run: `npx jest --maxWorkers=2 && npx tsc --noEmit && npx expo lint`
Expected: every suite passes (the previous count + `organizer-logic` + `organizer`), no type error, lint clean.

- [ ] **Step 5: Visual check in the offline demo**

Start the web preview in demo mode in the background: `cd apps/mobile-rn && EXPO_PUBLIC_DEMO=true CI=1 npx expo start --web --port 8081` and wait for `curl -s -o /dev/null -w "%{http_code}" --retry 60 --retry-connrefused --retry-delay 2 http://localhost:8081` to print 200. Use the cached `playwright-core` and `chrome-headless-shell` described in `handoff.md` §5 (with `LD_LIBRARY_PATH` pointing to the extracted `libnspr4` / `libnss3` / `libasound2t64` if the shell does not start). Deep links land on `/`, so navigate in the app.

`<scratchpad>/organizer-shots.cjs`:
```js
// Usage: node organizer-shots.cjs <playwright-core dir> <chrome-headless-shell> <output dir>
const [pwDir, chrome, out] = process.argv.slice(2);
const { chromium } = require(pwDir);
require('node:fs').mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: chrome });
  for (const lang of ['fr', 'ar']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: lang });
    await page.goto('http://localhost:8081', { waitUntil: 'networkidle' });
    // Sign in (any email/password in the demo).
    const inputs = page.locator('input');
    await inputs.nth(0).fill('demo@fitnessleague.test');
    await inputs.nth(1).fill('demo-password');
    await page.getByTestId('login-submit').click().catch(() => page.keyboard.press('Enter'));
    await page.waitForTimeout(2500);
    // Home → Competitions (the last visible match: Profile keeps a hidden copy of Home).
    await page.getByText(lang === 'ar' ? 'المسابقات' : 'Compétitions').last().click();
    await page.waitForTimeout(1200);
    await page.getByTestId('comp-create').click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${lang}-create.png`, fullPage: true });
    await page.goBack();
    await page.getByTestId('comp-mine').click();
    await page.waitForTimeout(1200);
    await page.getByTestId('comp-01a10804-0000-7000-8000-00000000d001').click();
    await page.waitForTimeout(1500);
    for (const tab of ['dashboard', 'general', 'categories', 'wods']) {
      await page.getByTestId(`org-tab-${tab}`).click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${out}/${lang}-${tab}.png`, fullPage: true });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(lang, 'horizontal overflow:', overflow);
    await page.close();
  }
  await browser.close();
})();
```
Run: `node <scratchpad>/organizer-shots.cjs <playwright-core dir> <chrome-headless-shell> /mnt/c/Users/GIGABYTE/Desktop/organizer-space`
Expected: 10 PNG files, `horizontal overflow: 0` for both languages. The selectors above are written against the testIDs of this plan and the app's French / Arabic labels; if the sign-in or home selectors differ (the login screen's testIDs are not part of this plan), read `src/features/auth/` and adjust them, as a ruling for the ledger. Open the French and Arabic dashboard, general, categories and WODs screenshots with the Read tool and check: nothing cut, Arabic mirrored, checklist readable. Fix what is wrong, re-run.

- [ ] **Step 6: Docs**

`README.md`, in the competitions part of « What exists today » (search for `Competitions`), add:
```markdown
- **Organizer space (2026-10-14):** any app user creates an event as a draft (Compétitions → « Créer un événement »), prepares it in the app (dashboard with the publication checklist, general info and banner, categories, WODs) and asks for publication; an admin publishes it or sends it back with a note (admin panel → Compétitions). Planning, participants, team, leaderboard, announcements and promo codes come with lot B.
```
`handoff.md` (restore the committed bytes first: `git show HEAD:handoff.md > handoff.md`, then edit): §1 add the « Organizer space » request with the owner's choices (spec §0); §2 the branch, the checks of the last run and the screenshots folder; §3 the new files (`apps/mobile-rn/src/features/competitions/organizer/*`, `apps/admin/src/pages/PublicationPanel.tsx`, `publication.ts`, the API changes and the migration); §6 next steps: lot B plan, the « sur place » phase (check-in, waiver, lane scoring, online payment, notifications, competition logo), and apply the migration `20261014120000_competition_publication_request` to the local database.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/GIGABYTE/fitness-league
git add apps/mobile-rn/src/features/competitions/screens.tsx apps/mobile-rn/src/core/api/demo-backend.ts apps/mobile-rn/assets/demo/api.json apps/mobile-rn/test/screens/organizer.test.tsx apps/mobile-rn/test/core/demo.test.ts README.md handoff.md
git diff --cached --stat
git commit -m "feat(mobile): drafts in my competitions, organizer demo, docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
