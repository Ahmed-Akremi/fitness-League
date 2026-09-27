# Salles, CrossFit/Hyrox, WODs de coach et app mobile complète — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter les logos et la liste enrichie des salles, les sports CrossFit/Hyrox (catalogue, scoring, anti-triche), les coachs et WODs de salle, puis terminer l'app mobile Flutter avec une UI refaite et tous les écrans manquants.

**Architecture:** API NestJS + Prisma (PostgreSQL 16) : un `StorageService` à deux pilotes (disque local / S3), de nouvelles tables (`gym_sports`, `gym_wods`, `gym_wod_scores`), une métrique `FINISH_TIME` à direction « plus bas = meilleur » branchée sur le moteur existant. Mobile Flutter : Riverpod + go_router, un repository par fonctionnalité, un kit de composants partagé dans `core/widgets/`.

**Tech Stack:** NestJS 11, Prisma 6, `sharp`, `@aws-sdk/client-s3`, `multer` (inclus dans `@nestjs/platform-express`), Jest + supertest ; Flutter 3.47, Riverpod 2, go_router 16, dio 5, `image_picker`, `cached_network_image`.

**Spec:** `docs/superpowers/specs/2026-09-27-gyms-sports-mobile-design.md`

## Global Constraints

- Node ≥ 22, pnpm 10 ; Flutter ≥ 3.32, Dart SDK ^3.8.
- Chaque DTO de requête rejette les champs inconnus (`forbidNonWhitelisted`) : l'app n'envoie jamais de points.
- Erreurs au format problem+json via `AppException` (`notFound`, `forbidden`, `conflict`, `validation`).
- Pagination par curseur signé (`CursorCodec`, `toPage`) pour toute liste.
- Écritures de points uniquement par le ledger (`LedgerService`), jamais d'`UPDATE` d'une ligne de ledger.
- Toute action d'administration de salle ou de coach est auditée (`AuditService.log`).
- Règles de scoring jamais rétroactives : la v1 n'est pas modifiée, la v2 est ajoutée.
- Logo : PNG/JPEG/WebP, **2 Mo max**, redimensionné en **512×512 WebP**.
- Le téléphone et l'email d'une salle ne sortent jamais dans les réponses publiques.
- Mobile : tous les textes en fr/en/ar (`lib/core/l10n/app_*.arb`, `flutter gen-l10n`), RTL arabe, cibles tactiles ≥ 48 dp, animations coupées si `MediaQuery.disableAnimations`.
- Données de démo fictives uniquement (aucune marque ni logo réels).
- Commits en fin de tâche, message conventionnel, terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Faux fichier image** (un `.png` qui contient du texte ou du HTML) : l'upload doit renvoyer `415`, jamais stocker le fichier. → test dans la Tâche 2.
2. **Recherche avec `%` ou `_`** (ex. `q=100%`) : aucune erreur SQL et pas de correspondance « tout » ; les accents sont ignorés (`kalaa` trouve `Kalâa`). → test dans la Tâche 3.
3. **Score soumis juste après la fin du WOD ou par un membre qui vient de quitter la salle** : `409 WOD_CLOSED` / `403`. → test dans la Tâche 8.
4. **Membre qui soumet un score moins bon ensuite** : le classement garde le meilleur, la séance est quand même enregistrée. → test dans la Tâche 8.
5. **Saisie de temps invalide sur mobile** (`1:75`, `abc`, vide) : le champ affiche une erreur et le bouton d'envoi reste inactif. → test dans la Tâche 10.

---

# Partie 1 — Backend (`apps/api`)

Commandes de référence (depuis `apps/api`) :
- Unitaires : `pnpm test:unit -- <chemin>`
- Intégration : `pnpm test:integration -- <chemin>` (PostgreSQL embarqué automatique)
- `pnpm lint && pnpm typecheck`
- Migration : `pnpm prisma migrate dev --name <nom> --create-only` puis relire le SQL, puis `pnpm prisma:deploy && pnpm prisma:generate`

### Task 1: StorageService (disque local / S3) et route `/media`

**Files:**
- Create: `src/common/storage/storage.service.ts`, `src/common/storage/local-storage.ts`, `src/common/storage/s3-storage.ts`, `src/common/storage/storage.module.ts`, `src/common/storage/media.controller.ts`, `src/common/storage/local-storage.spec.ts`
- Modify: `src/common/config/env.schema.ts`, `src/app.module.ts`, `.gitignore` (racine), `.env.example`, `package.json`

**Interfaces:**
- Produces: `abstract class StorageService { put(key: string, bytes: Buffer, mime: string): Promise<void>; url(key: string): string; delete(key: string): Promise<void>; read(key: string): Promise<{ bytes: Buffer; mime: string } | null> }` (DI token = la classe), `LocalStorage(rootDir: string, publicBaseUrl: string)`, `S3Storage(opts)`.

- [ ] **Step 1: Installer les dépendances**

```bash
cd apps/api && pnpm add sharp @aws-sdk/client-s3 && pnpm add -D @types/multer
```

- [ ] **Step 2: Test unitaire du pilote local (échoue)**

`src/common/storage/local-storage.spec.ts`
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage } from './local-storage';

describe('LocalStorage', () => {
  const root = mkdtempSync(join(tmpdir(), 'fl-storage-'));
  const s = new LocalStorage(root, 'http://localhost:3000/api/v1/media');

  it('stores, reads, builds a public URL and deletes', async () => {
    await s.put('gyms/abc/logo-1.webp', Buffer.from('img'), 'image/webp');
    expect(s.url('gyms/abc/logo-1.webp')).toBe('http://localhost:3000/api/v1/media/gyms/abc/logo-1.webp');
    expect(await s.read('gyms/abc/logo-1.webp')).toEqual({ bytes: Buffer.from('img'), mime: 'image/webp' });
    await s.delete('gyms/abc/logo-1.webp');
    expect(await s.read('gyms/abc/logo-1.webp')).toBeNull();
  });

  it('refuses keys that escape the root', async () => {
    await expect(s.put('../evil.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow('Invalid storage key');
    expect(await s.read('../../etc/passwd')).toBeNull();
  });
});
```

Run: `pnpm test:unit -- src/common/storage` → FAIL (`Cannot find module './local-storage'`).

- [ ] **Step 3: Implémentation**

`src/common/storage/storage.service.ts`
```ts
/** Object storage for user media. Keys are slash-separated, contain a content hash, and are never reused. */
export abstract class StorageService {
  abstract put(key: string, bytes: Buffer, mime: string): Promise<void>;
  abstract url(key: string): string;
  abstract delete(key: string): Promise<void>;
  /** Local driver only (served by /media); S3 objects are served by the bucket/CDN. */
  abstract read(key: string): Promise<{ bytes: Buffer; mime: string } | null>;
}

const KEY = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;
export function assertKey(key: string): void {
  if (!KEY.test(key) || key.includes('..') || key.includes('//')) throw new Error('Invalid storage key');
}
```

`src/common/storage/local-storage.ts`
```ts
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertKey, StorageService } from './storage.service';

const MIME_BY_EXT: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

/** Development driver: files under `rootDir`, served by MediaController. */
export class LocalStorage extends StorageService {
  constructor(private readonly rootDir: string, private readonly publicBaseUrl: string) {
    super();
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    assertKey(key);
    const path = join(this.rootDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  url(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await rm(join(this.rootDir, key), { force: true });
  }

  async read(key: string): Promise<{ bytes: Buffer; mime: string } | null> {
    try {
      assertKey(key);
      const bytes = await readFile(join(this.rootDir, key));
      return { bytes, mime: MIME_BY_EXT[key.split('.').pop() ?? ''] ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }
}
```

`src/common/storage/s3-storage.ts`
```ts
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { assertKey, StorageService } from './storage.service';

/** Production driver: S3 or MinIO (path-style). Objects are public-read through MEDIA_PUBLIC_BASE_URL (CDN). */
export class S3Storage extends StorageService {
  private readonly client: S3Client;

  constructor(private readonly opts: { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; publicBaseUrl: string }) {
    super();
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: !!opts.endpoint,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async put(key: string, bytes: Buffer, mime: string): Promise<void> {
    assertKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: bytes, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable' }));
  }

  url(key: string): string {
    return `${this.opts.publicBaseUrl}/${key}`;
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }

  async read(): Promise<null> {
    return null;
  }
}
```

`src/common/storage/media.controller.ts`
```ts
import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators';
import { StorageService } from './storage.service';

/** Serves locally stored media (dev). Keys contain a content hash, so responses are immutable. */
@ApiExcludeController()
@Controller('media')
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get('*path')
  async get(@Req() req: Request, @Res() res: Response): Promise<void> {
    const key = decodeURIComponent(req.path.replace(/^.*?\/media\//, ''));
    const file = await this.storage.read(key);
    if (!file) throw new NotFoundException();
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // helmet default is same-origin; the web app loads logos
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.bytes);
  }
}
```

`src/common/storage/storage.module.ts`
```ts
import { Global, Module } from '@nestjs/common';
import { join } from 'node:path';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { LocalStorage } from './local-storage';
import { MediaController } from './media.controller';
import { S3Storage } from './s3-storage';
import { StorageService } from './storage.service';

@Global()
@Module({
  controllers: [MediaController],
  providers: [
    {
      provide: StorageService,
      inject: [ENV],
      useFactory: (env: Env): StorageService =>
        env.STORAGE_DRIVER === 's3'
          ? new S3Storage({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, bucket: env.S3_BUCKET!, accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY!, publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL })
          : new LocalStorage(env.STORAGE_LOCAL_DIR ?? join(process.cwd(), 'storage'), env.MEDIA_PUBLIC_BASE_URL),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
```

Dans `env.schema.ts`, ajouter avant `APP_LINK_BASE_URL` :
```ts
  /** Media storage: `local` (dev, files served by /media) or `s3` (MinIO/S3 + CDN). */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().optional(),
  /** Public base URL of stored media, without trailing slash. */
  MEDIA_PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000/api/v1/media'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
```
et, à la fin de l'objet, un `.superRefine` : si `STORAGE_DRIVER === 's3'` alors `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` requis (message `required when STORAGE_DRIVER=s3`). Si le schéma est déjà suivi d'un `.superRefine` (vérification `DEV_STATIC_TOTP_CODE`), ajouter la condition dans ce même bloc.

`app.module.ts` : importer `StorageModule`. `.gitignore` racine : ajouter `apps/api/storage/`. `.env.example` : ajouter les 3 variables `STORAGE_DRIVER=local`, `MEDIA_PUBLIC_BASE_URL=http://localhost:3000/api/v1/media`, et un bloc commenté S3.

- [ ] **Step 4: Tests**

Run: `pnpm test:unit -- src/common/storage src/common/config` → PASS. `pnpm typecheck` → OK.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api .gitignore .env.example && git commit -m "feat(api): media storage with local and S3 drivers"
```

---

### Task 2: Upload du logo de salle

**Files:**
- Create: `prisma/migrations/20260927100000_gym_logo_and_sports/migration.sql` (généré), `src/modules/gyms/gym-logo.service.ts`, `test/gym-logo.int-spec.ts`, `test/fixtures/logo.png` (généré au Step 1)
- Modify: `prisma/schema.prisma`, `src/modules/gyms/gyms.controller.ts`, `src/modules/gyms/gyms.module.ts`, `src/modules/gyms/gyms.service.ts`

**Interfaces:**
- Consumes: `StorageService` (Tâche 1).
- Produces: `GymLogoService.set(user: AuthUser, gymId: string, file: { buffer: Buffer; size: number }): Promise<{ logoUrl: string }>`, `GymLogoService.remove(user, gymId): Promise<void>` ; `GymsService.logoUrl(g: { logo?: { objectKey: string } | null }): string | null` ; `GymsService.manageable` devient `public`. Champ `logoUrl` dans toutes les cartes de salle.

- [ ] **Step 1: Schéma + migration + fixture**

`schema.prisma` : dans `enum MediaPurpose`, ajouter `GYM_LOGO`. Dans `model Gym`, ajouter `logo Media? @relation("GymLogo", fields: [logoMediaId], references: [id])` ; dans `model Media`, ajouter `gymLogos Gym[] @relation("GymLogo")`. (Les autres changements de schéma de salle arrivent en Tâche 3 avec leur propre migration.)

```bash
pnpm prisma migrate dev --name gym_logo --create-only && pnpm prisma:deploy && pnpm prisma:generate
mkdir -p test/fixtures && node -e "require('sharp')({create:{width:600,height:400,channels:4,background:'#c6f432'}}).png().toFile('test/fixtures/logo.png')"
```

- [ ] **Step 2: Test d'intégration (échoue)**

`test/gym-logo.int-spec.ts`
```ts
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { registerUser, setupTestApp } from './helpers';

describe('Gym logo upload (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const png = readFileSync(join(__dirname, 'fixtures/logo.png'));

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp({ STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'fl-media-')) }));
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  async function ownedGym() {
    const owner = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: owner.session.userId }, data: { role: 'GYM_ADMIN' } });
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: 'carthage-strength-lab' } });
    await prisma.gym.update({ where: { id: gym.id }, data: { ownerUserId: owner.session.userId } });
    return { owner, gym };
  }

  it('lets the gym admin upload, replace and delete a logo, served resized as WebP', async () => {
    const { owner, gym } = await ownedGym();
    const up = await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).attach('file', png, 'logo.png').expect(200);
    expect(up.body.logoUrl).toMatch(/\/media\/gyms\/.+\.webp$/);

    const path = new URL(up.body.logoUrl).pathname;
    const img = await api().get(path).expect(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['cache-control']).toContain('immutable');
    const meta = await (await import('sharp')).default(img.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);

    const list = await api().get('/api/v1/gyms?limit=50').set(bearer(owner.session.accessToken)).expect(200);
    expect(list.body.data.find((g: { id: string }) => g.id === gym.id).logoUrl).toBe(up.body.logoUrl);

    const again = await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).attach('file', png, 'logo.png').expect(200);
    expect(again.body.logoUrl).not.toBe(up.body.logoUrl);
    await api().get(path).expect(404); // previous file removed
    expect(await prisma.media.count({ where: { purpose: 'GYM_LOGO', status: 'DELETED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: gym.id, action: 'GYM_LOGO_UPDATED' } })).toBe(2);

    await api().delete(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).expect(204);
    expect((await api().get(`/api/v1/gyms/${gym.id}`).set(bearer(owner.session.accessToken)).expect(200)).body.logoUrl).toBeNull();
  });

  it('refuses strangers, oversized files and fake images', async () => {
    const { owner, gym } = await ownedGym();
    const stranger = await registerUser(app, prisma);
    await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(stranger.session.accessToken)).attach('file', png, 'logo.png').expect(403);
    await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).attach('file', Buffer.alloc(2 * 1024 * 1024 + 1, 1), 'big.png').expect(413);
    await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).attach('file', Buffer.from('<html><script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' }).expect(415);
    await api().put(`/api/v1/gyms/${gym.id}/logo`).set(bearer(owner.session.accessToken)).expect(422); // no file
    expect(await prisma.media.count({ where: { ownerId: owner.session.userId } })).toBe(0);
  });
});
```

Run: `pnpm test:integration -- test/gym-logo.int-spec.ts` → FAIL (404 sur `PUT /logo`).

- [ ] **Step 3: Implémentation**

`src/modules/gyms/gym-logo.service.ts`
```ts
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { GymsService } from './gyms.service';

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_SIZE = 512;

/** Magic bytes, not the client's Content-Type: PNG, JPEG, WebP only. */
export function sniffImage(b: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

@Injectable()
export class GymLogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gyms: GymsService,
    private readonly audit: AuditService,
  ) {}

  async set(user: AuthUser, gymId: string, file: { buffer: Buffer; size: number } | undefined): Promise<{ logoUrl: string }> {
    const gym = await this.gyms.manageable(user, gymId);
    if (!file) throw AppException.validation([{ field: 'file', code: 'REQUIRED' }]);
    if (file.size > LOGO_MAX_BYTES) throw new AppException(413, ErrorCode.PAYLOAD_TOO_LARGE, 'Logo must be 2 MB or less.');
    if (!sniffImage(file.buffer)) throw new AppException(415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Logo must be a PNG, JPEG or WebP image.');

    let webp: Buffer;
    try {
      webp = await sharp(file.buffer, { limitInputPixels: 40_000_000 }).rotate().resize(LOGO_SIZE, LOGO_SIZE, { fit: 'cover' }).webp({ quality: 88 }).toBuffer();
    } catch {
      throw new AppException(415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Logo could not be decoded.');
    }
    const hash = createHash('sha256').update(webp).digest();
    const key = `gyms/${gym.id}/logo-${hash.toString('hex').slice(0, 16)}.webp`;
    await this.storage.put(key, webp, 'image/webp');

    const previous = gym.logoMediaId ? await this.prisma.media.findUnique({ where: { id: gym.logoMediaId } }) : null;
    const mediaId = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.media.create({ data: { id: mediaId, ownerId: user.id, bucket: 'gyms', objectKey: key, mime: 'image/webp', sizeBytes: webp.length, sha256: hash, status: 'READY', purpose: 'GYM_LOGO', width: LOGO_SIZE, height: LOGO_SIZE } });
      await tx.gym.update({ where: { id: gym.id }, data: { logoMediaId: mediaId } });
      if (previous) await tx.media.update({ where: { id: previous.id }, data: { status: 'DELETED' } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'GYM_LOGO_UPDATED', entityType: 'gym', entityId: gym.id, after: { mediaId } }, tx);
    });
    if (previous && previous.objectKey !== key) await this.storage.delete(previous.objectKey);
    return { logoUrl: this.storage.url(key) };
  }

  async remove(user: AuthUser, gymId: string): Promise<void> {
    const gym = await this.gyms.manageable(user, gymId);
    if (!gym.logoMediaId) return;
    const media = await this.prisma.media.findUniqueOrThrow({ where: { id: gym.logoMediaId } });
    await this.prisma.$transaction(async (tx) => {
      await tx.gym.update({ where: { id: gym.id }, data: { logoMediaId: null } });
      await tx.media.update({ where: { id: media.id }, data: { status: 'DELETED' } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'GYM_LOGO_REMOVED', entityType: 'gym', entityId: gym.id }, tx);
    });
    await this.storage.delete(media.objectKey);
  }
}
```

Vérifier dans `src/common/errors/app-exception.ts` que le constructeur est `new AppException(status, code, detail)` et que `ErrorCode` contient `PAYLOAD_TOO_LARGE` et `UNSUPPORTED_MEDIA_TYPE` ; sinon ajouter ces deux valeurs à l'enum `ErrorCode` (même style que les existantes). Si `MediaStatus` n'a pas `READY`/`DELETED`, utiliser les valeurs existantes équivalentes (lire l'enum dans `schema.prisma`) et ajuster le test.

Contrôleur (`gyms.controller.ts`), avant `@Get(':id')` :
```ts
  @Put(':id/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES + 1 } }))
  @ApiConsumes('multipart/form-data')
  setLogo(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.logos.set(user, id, file);
  }

  @Delete(':id/logo')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeLogo(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.logos.remove(user, id);
  }
```
(imports : `Put`, `UseInterceptors`, `UploadedFile` de `@nestjs/common`, `FileInterceptor` de `@nestjs/platform-express`, `ApiConsumes` de `@nestjs/swagger`, `GymLogoService`, `LOGO_MAX_BYTES`). Injecter `private readonly logos: GymLogoService` dans le constructeur. Multer rejette au-delà de `LOGO_MAX_BYTES + 1` avec `PayloadTooLargeException` (413) : vérifier que le filtre d'exceptions global la traduit en problem+json 413 ; sinon mapper `PayloadTooLargeException` dans le filtre.

`gyms.module.ts` : ajouter `GymLogoService` aux providers.

`gyms.service.ts` :
- `manageable` : `private` → `async manageable(...)` public.
- Injecter `private readonly storage: StorageService`.
- Toutes les requêtes `include` de `list` et `get` ajoutent `logo: true`.
- Dans `card(...)`, ajouter `logoUrl: g.logo && g.logo.status !== 'DELETED' ? this.storage.url(g.logo.objectKey) : null` (adapter le type du paramètre : `& { logo: Media | null }`).

- [ ] **Step 4: Tests**

Run: `pnpm test:integration -- test/gym-logo.int-spec.ts test/gyms.int-spec.ts` → PASS. `pnpm lint && pnpm typecheck` → OK.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api && git commit -m "feat(api): gym logo upload with magic-byte check and WebP resize"
```

---

### Task 3: Sports proposés par une salle, recherche sans accents, tri, profil enrichi

**Files:**
- Create: `prisma/migrations/<ts>_gym_sports/migration.sql`, `test/gym-directory.int-spec.ts`
- Modify: `prisma/schema.prisma`, `src/modules/gyms/dto/gym.dto.ts`, `src/modules/gyms/gyms.service.ts`, `src/modules/gyms/gyms.controller.ts`, `src/database/seed.ts`, `infra/seed-data/catalog.json`

**Interfaces:**
- Produces: carte de salle `{ id, name, slug, verified, city, governorate, logoUrl, sports: {code, name, icon}[], membersCount, level }` ; `GET /gyms/:id` ajoute `addressLine`, `socialLinks`, `rank: number | null`, `topAthletes`, `myMembership: { status: 'NONE'|'PENDING'|'APPROVED', role: 'MEMBER'|'COACH'|null }`, `canManage: boolean`. `GymsService.get(id, viewer?: AuthUser)`.

- [ ] **Step 1: Schéma et migration**

```prisma
model GymSport {
  gymId   String @map("gym_id") @db.Uuid
  sportId String @map("sport_id") @db.Uuid
  gym     Gym    @relation(fields: [gymId], references: [id], onDelete: Cascade)
  sport   Sport  @relation(fields: [sportId], references: [id])

  @@id([gymId, sportId])
  @@index([sportId])
  @@map("gym_sports")
}
```
Ajouter `sports GymSport[]` à `Gym` et `gyms GymSport[]` à `Sport`.

```bash
pnpm prisma migrate dev --name gym_sports --create-only
```
Ajouter en tête du `migration.sql` généré :
```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
-- Immutable wrapper so it can be used in an index.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
CREATE INDEX gyms_name_unaccent_idx ON gyms (lower(f_unaccent(name)) text_pattern_ops);
```
puis `pnpm prisma:deploy && pnpm prisma:generate`. Vérifier que PostgreSQL embarqué fournit `unaccent` (contrib) : `pnpm test:integration -- test/foundation.int-spec.ts` doit passer après la migration.

- [ ] **Step 2: Catalogue et seed**

Dans `infra/seed-data/catalog.json`, chaque salle gagne `"sports": [...]` (codes). Salles existantes : `carthage-strength-lab` → `["BODYBUILDING","POWERLIFTING"]`, `ariana-fit-house` → `["BODYBUILDING","FUNCTIONAL"]`, `sahel-iron-club` → `["BODYBUILDING","POWERLIFTING","WEIGHT_TRAINING"]`, les autres → `["BODYBUILDING"]`. Dans `seed.ts`, type `gyms: {...; sports?: string[] }[]` et, dans `seedGyms`, après l'upsert :
```ts
    if (gym.sports?.length) {
      const sportIds = (await prisma.sport.findMany({ where: { code: { in: gym.sports } } })).map((s) => s.id);
      await prisma.gymSport.createMany({ data: sportIds.map((sportId) => ({ gymId: row.id, sportId })), skipDuplicates: true });
    }
```
(`row` = résultat de l'upsert existant ; le renommer si besoin).

- [ ] **Step 3: Test d'intégration (échoue)**

`test/gym-directory.int-spec.ts`
```ts
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { uuidv7 } from '../src/common/ids/uuid';
import { registerUser, setupTestApp } from './helpers';

describe('Gym directory (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  let token: string;

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    token = (await registerUser(app, prisma)).session.accessToken;
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('filters by sport, searches without accents and escapes LIKE wildcards', async () => {
    const byPl = await api().get('/api/v1/gyms?sport=POWERLIFTING&limit=50').set(bearer(token)).expect(200);
    expect(byPl.body.data.map((g: { slug: string }) => g.slug).sort()).toEqual(['carthage-strength-lab', 'sahel-iron-club']);
    expect(byPl.body.data[0].sports.map((s: { code: string }) => s.code)).toContain('POWERLIFTING');

    const gov = await prisma.governorate.findUniqueOrThrow({ where: { code: 'TN-51' }, include: { cities: true } });
    await prisma.gym.create({ data: { id: uuidv7(), name: 'Kalâa Box', slug: 'kalaa-box', governorateId: gov.id, cityId: gov.cities[0]!.id, status: 'VERIFIED' } });
    expect((await api().get('/api/v1/gyms?q=kalaa').set(bearer(token)).expect(200)).body.data.map((g: { slug: string }) => g.slug)).toEqual(['kalaa-box']);
    expect((await api().get('/api/v1/gyms?q=%25').set(bearer(token)).expect(200)).body.data).toEqual([]);
    expect((await api().get('/api/v1/gyms?q=_').set(bearer(token)).expect(200)).body.data).toEqual([]);
    await api().get('/api/v1/gyms?sport=NOPE').set(bearer(token)).expect(422);
  });

  it('sorts by members with a stable cursor across pages', async () => {
    const first = await api().get('/api/v1/gyms?sort=members&limit=2').set(bearer(token)).expect(200);
    const second = await api().get(`/api/v1/gyms?sort=members&limit=2&cursor=${encodeURIComponent(first.body.page.nextCursor)}`).set(bearer(token)).expect(200);
    const all = [...first.body.data, ...second.body.data];
    expect(new Set(all.map((g: { id: string }) => g.id)).size).toBe(all.length);
    const counts = all.map((g: { membersCount: number }) => g.membersCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it('returns membership state, manage flag and no private contact details', async () => {
    const athlete = await registerUser(app, prisma);
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: 'sahel-iron-club' } });
    await prisma.gym.update({ where: { id: gym.id }, data: { contactPhone: '+21673111111', addressLine: '12 rue de la Plage' } });
    const before = await api().get(`/api/v1/gyms/${gym.id}`).set(bearer(athlete.session.accessToken)).expect(200);
    expect(before.body).toMatchObject({ myMembership: { status: 'NONE', role: null }, canManage: false, addressLine: '12 rue de la Plage' });
    expect(JSON.stringify(before.body)).not.toContain('+21673111111');
    await api().post(`/api/v1/gyms/${gym.id}/membership`).set(bearer(athlete.session.accessToken)).expect(201);
    const after = await api().get(`/api/v1/gyms/${gym.id}`).set(bearer(athlete.session.accessToken)).expect(200);
    expect(after.body.myMembership).toEqual({ status: 'PENDING', role: null });
  });

  it('lets the gym admin set the sports offered', async () => {
    const owner = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: owner.session.userId }, data: { role: 'GYM_ADMIN' } });
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: 'ariana-fit-house' } });
    await prisma.gym.update({ where: { id: gym.id }, data: { ownerUserId: owner.session.userId } });
    const crossfit = await prisma.sport.findUniqueOrThrow({ where: { code: 'CROSSFIT' } });
    const res = await api().patch(`/api/v1/gyms/${gym.id}`).set(bearer(owner.session.accessToken)).send({ sportIds: [crossfit.id] }).expect(200);
    expect(res.body.sports.map((s: { code: string }) => s.code)).toEqual(['CROSSFIT']);
    expect(res.body.canManage).toBe(true);
  });
});
```

Run → FAIL.

- [ ] **Step 4: Implémentation**

`dto/gym.dto.ts` :
- `CreateGymDto` et `UpdateGymDto` : `@ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsUUID('all', { each: true }) sportIds?: string[];`
- `ListGymsQueryDto` : ajouter `q` s'il n'existe pas déjà (`@IsOptional() @IsString() @MaxLength(80)`), `@IsOptional() @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) sport?: string;`, `@IsOptional() @IsIn(['name', 'members']) sort: 'name' | 'members' = 'name';`.

`gyms.service.ts` — `list` réécrit avec du SQL pour la recherche sans accents et le tri par membres :
```ts
  async list(q: ListGymsQueryDto) {
    let sportId: string | undefined;
    if (q.sport) {
      const sport = await this.prisma.sport.findUnique({ where: { code: q.sport } });
      if (!sport) throw AppException.validation([{ field: 'sport', code: 'UNKNOWN_SPORT' }]);
      sportId = sport.id;
    }
    const byMembers = q.sort === 'members';
    const c = q.cursor ? this.cursors.decode<{ n: string; m: number; id: string }>(q.cursor) : null;
    const like = q.q ? `%${q.q.trim().toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; members: number }[]>`
      SELECT g.id, g.name, COUNT(m.id)::int AS members
      FROM gyms g
      LEFT JOIN gym_members m ON m.gym_id = g.id AND m.status = 'APPROVED'
      WHERE g.status = 'VERIFIED' AND g.deleted_at IS NULL
        ${q.governorateId ? Prisma.sql`AND g.governorate_id = ${q.governorateId}::uuid` : Prisma.empty}
        ${sportId ? Prisma.sql`AND EXISTS (SELECT 1 FROM gym_sports s WHERE s.gym_id = g.id AND s.sport_id = ${sportId}::uuid)` : Prisma.empty}
        ${like ? Prisma.sql`AND lower(f_unaccent(g.name)) LIKE f_unaccent(${like}) ESCAPE '\\'` : Prisma.empty}
      GROUP BY g.id
      ${c ? (byMembers ? Prisma.sql`HAVING (COUNT(m.id), g.id) < (${c.m}::int, ${c.id}::uuid)` : Prisma.sql`HAVING (g.name, g.id) > (${c.n}, ${c.id}::uuid)`) : Prisma.empty}
      ORDER BY ${byMembers ? Prisma.sql`members DESC, g.id DESC` : Prisma.sql`g.name ASC, g.id ASC`}
      LIMIT ${q.limit + 1}`;
    const page = toPage(rows, q.limit, (r) => ({ n: r.name, m: r.members, id: r.id }), (k) => this.cursors.encode(k));
    const full = await this.prisma.gym.findMany({ where: { id: { in: page.data.map((r) => r.id) } }, include: GYM_CARD_INCLUDE });
    const byId = new Map(full.map((g) => [g.id, g]));
    return { data: page.data.map((r) => this.card(byId.get(r.id)!)), page: page.page };
  }
```
avec, en haut du fichier :
```ts
const GYM_CARD_INCLUDE = {
  city: true,
  governorate: true,
  logo: true,
  sports: { include: { sport: true } },
  _count: { select: { members: { where: { status: 'APPROVED' as const } } } },
} satisfies Prisma.GymInclude;
type GymCard = Prisma.GymGetPayload<{ include: typeof GYM_CARD_INCLUDE }>;
```
et `card(g: GymCard)` qui renvoie aussi `logoUrl`, `level: g.level`, `sports: g.sports.map((s) => ({ code: s.sport.code, name: s.sport.nameI18n, icon: s.sport.icon })).sort((a, b) => a.code.localeCompare(b.code))`.

`get(id, viewer?)` : utiliser `GYM_CARD_INCLUDE`, ajouter
```ts
    const membership = viewer ? await this.prisma.gymMember.findFirst({ where: { gymId: id, userId: viewer.id, status: { in: ['PENDING', 'APPROVED'] } } }) : null;
    const rankRows = await this.prisma.$queryRaw<{ rank: number }[]>`
      WITH totals AS (
        SELECT p.primary_gym_id AS gym_id, SUM(s.season_lp) AS lp
        FROM user_stats s JOIN profiles p ON p.user_id = s.user_id JOIN seasons se ON se.id = s.current_season_id AND se.status = 'ACTIVE'
        WHERE p.primary_gym_id IS NOT NULL GROUP BY p.primary_gym_id)
      SELECT rank::int FROM (SELECT gym_id, RANK() OVER (ORDER BY lp DESC) AS rank FROM totals) r WHERE gym_id = ${id}::uuid`;
```
(vérifier les noms réels des tables/colonnes `user_stats`, `profiles`, `seasons`, `current_season_id` dans `schema.prisma` et les `@@map`/`@map` ; adapter) et renvoyer
```ts
      addressLine: gym.addressLine,
      rank: rankRows[0]?.rank ?? null,
      myMembership: { status: membership?.status ?? 'NONE', role: membership?.status === 'APPROVED' ? 'MEMBER' : null },
      canManage: viewer ? await this.canManage(viewer, gym) : false,
```
(`role` sera complété en Tâche 6). Extraire de `manageable` une fonction `private canManage(user, gym): boolean` réutilisée par `manageable`. Contrôleur : `get(@CurrentUser() user, @Param(...) id)` → `this.gyms.get(id, user)`. `create` et `update` : si `dto.sportIds`, vérifier que tous existent et sont actifs (sinon `validation([{ field: 'sportIds', code: 'UNKNOWN_SPORT' }])`), puis dans la transaction `gymSport.deleteMany({ where: { gymId } })` + `createMany`. Retirer `sportIds` des données passées à `gym.update`.

- [ ] **Step 5: Tests**

Run: `pnpm test:integration -- test/gym-directory.int-spec.ts test/gyms.int-spec.ts test/gym-logo.int-spec.ts` → PASS ; `pnpm lint && pnpm typecheck`.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api infra/seed-data && git commit -m "feat(api): gym sports, accent-insensitive search, member sort and richer gym profile"
```

---

### Task 4: Catalogue CrossFit et Hyrox

**Files:**
- Create: `prisma/migrations/<ts>_exercise_group/migration.sql`, `src/database/catalog.spec.ts`
- Modify: `prisma/schema.prisma`, `infra/seed-data/catalog.json`, `src/database/seed.ts`, `src/modules/reference/reference.service.ts`

**Interfaces:**
- Produces: métrique `FINISH_TIME` ; sport `HYROX` ; `Exercise.group: ExerciseGroup | null` (`MOVEMENT | BENCHMARK_WOD | HYROX_STATION | HYROX_RACE`), `Exercise.descriptionI18n: Json` ; `GET /ref/exercises` renvoie `group` et `description`.

- [ ] **Step 1: Test du catalogue (échoue)**

`src/database/catalog.spec.ts`
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const catalog = JSON.parse(readFileSync(join(__dirname, '../../../../infra/seed-data/catalog.json'), 'utf8'));
const byCode = new Map<string, { sport: string | null; metrics: string[]; group?: string; plausibility: Record<string, number>; name: Record<string, string>; description?: Record<string, string> }>(
  catalog.exercises.map((e: { code: string }) => [e.code, e]),
);

describe('catalog: CrossFit & Hyrox', () => {
  it('declares FINISH_TIME as lower-is-better seconds and the HYROX sport', () => {
    expect(catalog.metricTypes.find((m: { code: string }) => m.code === 'FINISH_TIME')).toMatchObject({ unit: 's', direction: 'LOWER_IS_BETTER' });
    expect(catalog.sports.find((s: { code: string }) => s.code === 'HYROX')).toMatchObject({ category: 'FUNCTIONAL', loggingMode: 'MIXED' });
  });

  it.each(['WOD_FRAN', 'WOD_GRACE', 'WOD_HELEN', 'WOD_DIANE', 'WOD_ISABEL', 'WOD_MURPH', 'HYROX_OPEN', 'HYROX_PRO'])('%s is timed with plausibility bounds', (code) => {
    const e = byCode.get(code)!;
    expect(e.metrics).toEqual(['FINISH_TIME']);
    expect(e.plausibility.reject_s).toBeLessThan(e.plausibility.hold_s);
    expect(e.description?.fr).toBeTruthy();
  });

  it('has the 9 Hyrox stations, Cindy as an AMRAP and translated names everywhere', () => {
    expect(catalog.exercises.filter((e: { group?: string }) => e.group === 'HYROX_STATION')).toHaveLength(9);
    expect(byCode.get('WOD_CINDY')).toMatchObject({ metrics: ['MAX_REPS'], group: 'BENCHMARK_WOD' });
    for (const e of catalog.exercises) for (const l of ['fr', 'en', 'ar']) expect(e.name[l]).toBeTruthy();
  });
});
```
Run: `pnpm test:unit -- src/database/catalog.spec.ts` → FAIL.

- [ ] **Step 2: Données**

Dans `catalog.json` :
- `metricTypes` += `{ "code": "FINISH_TIME", "unit": "s", "direction": "LOWER_IS_BETTER", "name": { "fr": "Temps final", "en": "Finish time", "ar": "الزمن النهائي" } }`
- `sports` += `{ "code": "HYROX", "category": "FUNCTIONAL", "loggingMode": "MIXED", "icon": "hyrox", "name": { "fr": "Hyrox", "en": "Hyrox", "ar": "هايروكس" } }`
- Ajouter le champ `"group"` au `ROW_ERG` existant : non (il reste un exercice CrossFit générique) ; la station Hyrox rameur est un exercice distinct.
- `exercises` += (champ `description` uniquement pour les WODs et courses) :

| code | sport | equipment | bodyweight | metrics | group | plausibility | fr / en / ar |
|---|---|---|---|---|---|---|---|
| THRUSTER | CROSSFIT | barbell | false | MAX_WEIGHT,E1RM,REPS_AT_WEIGHT | MOVEMENT | hold_kg 160, reject_kg 230 | Thruster / Thruster / ثراستر |
| CLEAN_AND_JERK | CROSSFIT | barbell | false | idem | MOVEMENT | 220 / 270 | Épaulé-jeté / Clean and jerk / النتر |
| SNATCH | CROSSFIT | barbell | false | idem | MOVEMENT | 180 / 230 | Arraché / Snatch / الخطف |
| KETTLEBELL_SWING | CROSSFIT | kettlebell | false | idem | MOVEMENT | 64 / 100 | Swing kettlebell / Kettlebell swing / أرجحة الكيتلبل |
| WALL_BALL | CROSSFIT | medicine_ball | true | MAX_REPS | MOVEMENT | {} | Wall ball / Wall ball / رمي الكرة على الحائط |
| BOX_JUMP | CROSSFIT | box | true | MAX_REPS | MOVEMENT | {} | Box jump / Box jump / القفز على الصندوق |
| DOUBLE_UNDER | CROSSFIT | rope | true | MAX_REPS | MOVEMENT | {} | Double-unders / Double-unders / الحبل المزدوج |
| TOES_TO_BAR | CROSSFIT | pullup_bar | true | MAX_REPS | MOVEMENT | {} | Toes-to-bar / Toes-to-bar / رفع القدمين للعقلة |
| MUSCLE_UP | CROSSFIT | rings | true | MAX_REPS | MOVEMENT | {} | Muscle-up / Muscle-up / العضلة الصاعدة |
| WOD_FRAN | CROSSFIT | mixed | false | FINISH_TIME | BENCHMARK_WOD | hold_s 120, reject_s 100 | Fran / Fran / فران |
| WOD_GRACE | CROSSFIT | barbell | false | FINISH_TIME | BENCHMARK_WOD | 75 / 60 | Grace |
| WOD_HELEN | CROSSFIT | mixed | false | FINISH_TIME | BENCHMARK_WOD | 390 / 330 | Helen |
| WOD_DIANE | CROSSFIT | mixed | false | FINISH_TIME | BENCHMARK_WOD | 110 / 90 | Diane |
| WOD_ISABEL | CROSSFIT | barbell | false | FINISH_TIME | BENCHMARK_WOD | 60 / 50 | Isabel |
| WOD_MURPH | CROSSFIT | mixed | true | FINISH_TIME | BENCHMARK_WOD | 1980 / 1800 | Murph |
| WOD_CINDY | CROSSFIT | bodyweight | true | MAX_REPS | BENCHMARK_WOD | hold_reps 700, reject_reps 900 | Cindy |
| HYROX_OPEN | HYROX | mixed | false | FINISH_TIME | HYROX_RACE | 3300 / 3000 | Course Hyrox Open / Hyrox race (Open) / سباق هايروكس (مفتوح) |
| HYROX_PRO | HYROX | mixed | false | FINISH_TIME | HYROX_RACE | 3400 / 3100 | Course Hyrox Pro / Hyrox race (Pro) / سباق هايروكس (محترف) |
| HYROX_RUN_1K | HYROX | none | true | FINISH_TIME | HYROX_STATION | 170 / 140 | Course 1 km / 1 km run / جري 1 كم |
| HYROX_SKIERG_1000 | HYROX | skierg | false | FINISH_TIME | HYROX_STATION | 200 / 160 | SkiErg 1000 m |
| HYROX_SLED_PUSH | HYROX | sled | false | FINISH_TIME | HYROX_STATION | 90 / 70 | Sled push 50 m / Sled push 50 m / دفع الزلاجة |
| HYROX_SLED_PULL | HYROX | sled | false | FINISH_TIME | HYROX_STATION | 120 / 95 | Sled pull 50 m / Sled pull 50 m / سحب الزلاجة |
| HYROX_BURPEE_BROAD_JUMP | HYROX | none | true | FINISH_TIME | HYROX_STATION | 150 / 120 | Burpee broad jumps 80 m / Burpee broad jumps 80 m / بيربي بالقفز الطويل |
| HYROX_ROW_1000 | HYROX | rower | false | FINISH_TIME | HYROX_STATION | 190 / 160 | Rameur 1000 m / Row 1000 m / تجديف 1000 م |
| HYROX_FARMERS_CARRY | HYROX | kettlebell | false | FINISH_TIME | HYROX_STATION | 70 / 55 | Farmers carry 200 m / Farmers carry 200 m / حمل المزارع |
| HYROX_SANDBAG_LUNGES | HYROX | sandbag | false | FINISH_TIME | HYROX_STATION | 170 / 140 | Fentes sac de sable 100 m / Sandbag lunges 100 m / طعنات بكيس الرمل |
| HYROX_WALL_BALLS | HYROX | medicine_ball | false | FINISH_TIME | HYROX_STATION | 180 / 140 | Wall balls ×100 |

Les noms propres des WODs (Fran, Grace, …) et « SkiErg 1000 m », « Wall balls ×100 » sont identiques en fr/en ; en ar, les translittérer (`غريس`, `هيلين`, `ديان`, `إيزابيل`, `مورف`, `سيندي`, `سكي إرغ 1000 م`, `رمي الكرة ×100`). Descriptions (fr/en/ar) :
- Fran : « 21-15-9 thrusters (43/29 kg) et tractions, pour le temps. » / "21-15-9 thrusters (43/29 kg) and pull-ups, for time." / "21-15-9 ثراستر (43/29 كغ) وعقلة، بأسرع وقت."
- Grace : « 30 épaulés-jetés (61/43 kg), pour le temps. »
- Helen : « 3 tours : 400 m course, 21 swings kettlebell (24/16 kg), 12 tractions. »
- Diane : « 21-15-9 soulevés de terre (102/70 kg) et pompes en équilibre. »
- Isabel : « 30 arrachés (61/43 kg), pour le temps. »
- Murph : « 1,6 km course, 100 tractions, 200 pompes, 300 squats, 1,6 km course (gilet 9/6 kg). »
- Cindy : « AMRAP 20 min : 5 tractions, 10 pompes, 15 squats. Saisir le total de répétitions. »
- Hyrox Open/Pro : « 8 × (1 km course + 1 station) : SkiErg, sled push, sled pull, burpee broad jumps, rameur, farmers carry, fentes, wall balls. »
(en et ar : traduction directe de ces phrases.)

- [ ] **Step 3: Schéma, seed, référence**

```prisma
enum ExerciseGroup {
  MOVEMENT
  BENCHMARK_WOD
  HYROX_STATION
  HYROX_RACE
}
```
Dans `model Exercise` : `group ExerciseGroup?` et `descriptionI18n Json @default("{}") @map("description_i18n")`. Migration `exercise_group`, deploy, generate.

`seed.ts` : type exercice += `group?: ExerciseGroup; description?: I18n` ; dans `fields` de l'upsert : `group: e.group ?? null, descriptionI18n: e.description ?? {}`.

`reference.service.ts` `exercises()` : ajouter `group: e.group, description: e.descriptionI18n` au mapping.

- [ ] **Step 4: Tests**

Run: `pnpm test:unit -- src/database/catalog.spec.ts` → PASS ; `pnpm test:integration -- test/foundation.int-spec.ts` (le seed tourne) → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api infra/seed-data && git commit -m "feat(catalog): CrossFit movements and benchmark WODs, Hyrox sport, FINISH_TIME metric"
```

---

### Task 5: `FINISH_TIME` dans le scoring, l'anti-triche et les règles v2

**Files:**
- Create: `infra/seed-data/ruleset-v2.json`, `test/crossfit-hyrox.int-spec.ts`
- Modify: `src/modules/scoring/engine/observations.ts`, `src/modules/scoring/engine/engine.spec.ts`, `src/modules/scoring/workout-scoring.service.ts`, `src/modules/anticheat/rules.ts`, `src/modules/anticheat/rules.spec.ts` (ou le spec existant des règles), `src/modules/workouts/workouts.service.ts` (appel `plausibility`), `src/database/seed.ts`

**Interfaces:**
- Consumes: métrique et exercices de la Tâche 4.
- Produces: `extractObservations(w, tracked, config, lowerIsBetter?: (code: string) => boolean)` ; plausibilité `{ hold_kg?, reject_kg?, hold_s?, reject_s?, hold_reps?, reject_reps? }`.

- [ ] **Step 1: Tests unitaires (échouent)**

Ajouter à `engine.spec.ts` dans `describe('extractObservations')` :
```ts
  it('records FINISH_TIME from a timed set and keeps the lowest', () => {
    const obs = extractObservations(
      {
        sportId: 's', workoutType: 'WOD', performedAt: new Date(), durationS: 900,
        exercises: [{ exerciseId: 'fran', exerciseCode: 'WOD_FRAN', isBodyweight: false, sets: [{ durationS: 312 }, { durationS: 298 }] }],
      },
      () => ['FINISH_TIME'],
      config,
      (code) => code === 'FINISH_TIME',
    );
    expect(obs).toEqual([{ exerciseId: 'fran', metricCode: 'FINISH_TIME', qualifier: 0, value: 298 }]);
  });

  it('ignores FINISH_TIME when the set has no duration', () => {
    const obs = extractObservations(
      { sportId: 's', workoutType: 'WOD', performedAt: new Date(), durationS: 900, exercises: [{ exerciseId: 'fran', exerciseCode: 'WOD_FRAN', isBodyweight: false, sets: [{ reps: 45 }] }] },
      () => ['FINISH_TIME'],
      config,
    );
    expect(obs).toEqual([]);
  });
```

Dans le spec des règles anti-triche (repérer le fichier qui teste `evaluateWorkout` avec `grep -rl evaluateWorkout src --include=*.spec.ts`), ajouter :
```ts
  it('rejects an impossible Hyrox time and holds a suspicious Fran', () => {
    const plaus = (code: string) => ({ HYROX_OPEN: { hold_s: 3300, reject_s: 3000 }, WOD_FRAN: { hold_s: 120, reject_s: 100 } })[code] ?? {};
    const run = (code: string, s: number) =>
      evaluateWorkout({ ...baseWorkout, durationS: Math.max(s, 600), exercises: [{ exerciseId: 'x', exerciseCode: code, isBodyweight: false, sets: [{ durationS: s }] }] }, ctx, config, plaus);
    expect(run('HYROX_OPEN', 2700).outcome).toBe('REJECTED');
    expect(run('HYROX_OPEN', 4200).outcome).toBe('ACCEPTED');
    expect(run('WOD_FRAN', 110).outcome).toBe('HELD_FOR_REVIEW');
    expect(run('WOD_FRAN', 110).hits.map((h) => h.rule)).toContain('FINISH_TIME_S');
  });
```
(`baseWorkout`, `ctx`, `config` : réutiliser les fixtures déjà définies en haut de ce spec ; si elles ont d'autres noms, utiliser ces noms.)

Run: `pnpm test:unit -- src/modules/scoring src/modules/anticheat` → FAIL.

- [ ] **Step 2: Implémentation**

`observations.ts` :
```ts
export function extractObservations(
  w: WorkoutInput,
  tracked: (exerciseId: string) => string[],
  config: Pick<RuleSetConfig, 'e1rm_formula' | 'e1rm_max_reps'>,
  lowerIsBetter: (code: string) => boolean = defaultLowerIsBetter,
): Observation[] {
```
avec `export const defaultLowerIsBetter = (code: string) => code === 'PACE' || code === 'FINISH_TIME' || code.startsWith('TIME_');` remplaçant la lambda locale, et dans la boucle des séries, après `MAX_REPS` :
```ts
      if (s.durationS && s.durationS > 0 && metrics.has('FINISH_TIME')) offer({ exerciseId: ex.exerciseId, metricCode: 'FINISH_TIME', qualifier: 0, value: s.durationS });
```
Dans `progress.service.ts` `recordWorkout`, là où `extractObservations` est appelé, passer `(code) => metricTypes.get(code)?.direction === 'LOWER_IS_BETTER'` (la map des types de métrique est déjà chargée par `metricTypes(tx)`).

`workout-scoring.service.ts` : `XP_METRICS` += `'FINISH_TIME'` ; `PR_PRIORITY` : insérer `'FINISH_TIME'` juste après `'E1RM'`.

`rules.ts` : type de plausibilité
```ts
export type Plausibility = { hold_kg?: number; reject_kg?: number; hold_s?: number; reject_s?: number; hold_reps?: number; reject_reps?: number };
```
utilisé pour le paramètre `plausibility` de `evaluateWorkout` et `strengthHits`. Nouvelle fonction appelée dans la boucle des exercices après `cardioHits` :
```ts
function timedHits(ex: WorkoutInput['exercises'][number], exerciseIndex: number, p: Plausibility): (RuleHit | null)[] {
  const out: (RuleHit | null)[] = [];
  ex.sets.forEach((s, setIndex) => {
    if (p.hold_s && p.reject_s && s.durationS) out.push(below('FINISH_TIME_S', s.durationS, { hold: p.hold_s, reject: p.reject_s }, { exerciseIndex, setIndex }));
    if (p.hold_reps && p.reject_reps && s.reps != null) out.push(above('WOD_TOTAL_REPS', s.reps, { hold: p.hold_reps, reject: p.reject_reps }, { exerciseIndex, setIndex }));
  });
  return out;
}
```
et `hits.push(...timedHits(ex, exerciseIndex, plausibility(ex.exerciseCode)));`. Pour `WOD_CINDY` (total de répétitions jusqu'à 900), la règle générique `REPS_PER_SET` bloquerait : dans la boucle `REPS_PER_SET`, sauter la série si `plausibility(ex.exerciseCode).hold_reps` est défini.

`ruleset-v2.json` : copie exacte de `ruleset-v1.json` avec `"version": 2`, `"changeNote": "v2: FINISH_TIME progression for CrossFit benchmark WODs and Hyrox (not retroactive)."` et, à la fin de `expectedProgression` :
```json
{ "level": "BEGINNER", "exercise": null, "metric": "FINISH_TIME", "pct": 4 },
{ "level": "INTERMEDIATE", "exercise": null, "metric": "FINISH_TIME", "pct": 1.5 },
{ "level": "ADVANCED", "exercise": null, "metric": "FINISH_TIME", "pct": 0.5 }
```
`seed.ts` : `await seedRuleSet(prisma, readJson('ruleset-v1.json'), …)` puis la même chose avec `ruleset-v2.json`. Lire `seedRuleSet` : s'il active toujours la version qu'il seed, garder cet ordre (v2 active). S'il n'active que si aucune règle n'est active, ajouter un paramètre `activate: boolean` et l'utiliser pour v2 (désactiver les autres, activer v2) — uniquement si la v2 n'a jamais été activée (idempotence : ne pas réactiver après un changement manuel par un admin). Vérifier que `engine.spec.ts` lit toujours `ruleset-v1.json` (inchangé).

- [ ] **Step 3: Test d'intégration (bout en bout)**

`test/crossfit-hyrox.int-spec.ts`
```ts
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { registerUser, setupTestApp, TODAY } from './helpers';

describe('CrossFit & Hyrox workouts (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('activates rule set v2 and turns a faster Hyrox race into a FINISH_TIME record', async () => {
    expect((await prisma.scoringRuleSet.findFirstOrThrow({ where: { isActive: true } })).version).toBe(2);
    const { session } = await registerUser(app, prisma);
    const hyrox = await prisma.sport.findUniqueOrThrow({ where: { code: 'HYROX' } });
    const race = await prisma.exercise.findUniqueOrThrow({ where: { code: 'HYROX_OPEN' } });
    const log = (daysAgo: number, seconds: number) => {
      const clientId = randomUUID();
      return api().post('/api/v1/workouts').set(bearer(session.accessToken)).set('Idempotency-Key', clientId).send({
        clientId, sportId: hyrox.id, workoutType: 'RACE', durationS: seconds,
        performedAt: new Date(TODAY.getTime() - daysAgo * 86_400_000).toISOString(),
        exercises: [{ exerciseId: race.id, sets: [{ durationS: seconds }] }],
      });
    };
    expect((await log(10, 5400).expect(201)).body.status).toBe('ACCEPTED');
    expect((await log(2, 5100).expect(201)).body.status).toBe('ACCEPTED');
    expect((await log(1, 2500).expect(201)).body.status).toBe('REJECTED');

    await drainOutbox(app); // voir note
    const records = await api().get('/api/v1/me/records').set(bearer(session.accessToken)).expect(200);
    const pr = records.body.find((r: { exerciseId: string; metricCode: string }) => r.exerciseId === race.id && r.metricCode === 'FINISH_TIME');
    expect(Number(pr.value)).toBe(5100);
  });
});
```
Note : repérer dans `test/scoring.int-spec.ts` comment les tests existants font traiter l'outbox par le worker (fonction utilitaire ou appel direct du processeur) et utiliser exactement ce mécanisme à la place de `drainOutbox`. Adapter aussi les noms `scoringRuleSet`/`isActive` et la forme de `/me/records` à ce qu'utilisent déjà `scoring.int-spec.ts` et `progress.controller.ts`.

- [ ] **Step 4: Tests**

Run: `pnpm test:unit` → PASS ; `pnpm test:integration -- test/crossfit-hyrox.int-spec.ts test/scoring.int-spec.ts test/workouts.int-spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api infra/seed-data && git commit -m "feat(scoring): FINISH_TIME records, timed plausibility checks and rule set v2"
```

---

### Task 6: Rôle coach

**Files:**
- Create: `prisma/migrations/<ts>_gym_coaches/migration.sql`, `test/gym-coaches.int-spec.ts`
- Modify: `prisma/schema.prisma`, `src/modules/gyms/gyms.service.ts`, `src/modules/gyms/gyms.controller.ts`

**Interfaces:**
- Produces: `GymsService.isCoach(userId: string, gymId: string): Promise<boolean>` (membre approuvé `COACH`, ou propriétaire vérifié `GYM_ADMIN`, ou staff via `AuthUser`) → signature exacte `isCoach(user: AuthUser, gymId: string): Promise<boolean>` ; `GymsService.approvedMember(userId, gymId): Promise<GymMember | null>` ; `members()` renvoie `role` ; `myMembership.role` renseigné.

- [ ] **Step 1: Schéma**

```prisma
enum GymMemberRole {
  MEMBER
  COACH
}
```
`model GymMember` : `role GymMemberRole @default(MEMBER)`. Migration `gym_coaches`, deploy, generate.

- [ ] **Step 2: Test (échoue)**

`test/gym-coaches.int-spec.ts`
```ts
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { uuidv7 } from '../src/common/ids/uuid';
import { registerUser, setupTestApp } from './helpers';

describe('Gym coaches (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('lets the gym admin appoint and remove a coach among approved members only', async () => {
    const owner = await registerUser(app, prisma);
    const member = await registerUser(app, prisma);
    const outsider = await registerUser(app, prisma);
    await prisma.user.update({ where: { id: owner.session.userId }, data: { role: 'GYM_ADMIN' } });
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: 'sahel-iron-club' } });
    await prisma.gym.update({ where: { id: gym.id }, data: { ownerUserId: owner.session.userId } });
    await prisma.gymMember.create({ data: { id: uuidv7(), gymId: gym.id, userId: member.session.userId, status: 'APPROVED', approvedAt: new Date() } });
    const url = (u: string) => `/api/v1/gyms/${gym.id}/members/${u}/coach`;

    await api().post(url(member.session.userId)).set(bearer(member.session.accessToken)).expect(403);
    await api().post(url(outsider.session.userId)).set(bearer(owner.session.accessToken)).expect(404);
    await api().post(url(member.session.userId)).set(bearer(owner.session.accessToken)).expect(200);

    const profile = await api().get(`/api/v1/gyms/${gym.id}`).set(bearer(member.session.accessToken)).expect(200);
    expect(profile.body.myMembership).toEqual({ status: 'APPROVED', role: 'COACH' });
    const members = await api().get(`/api/v1/gyms/${gym.id}/members?limit=50`).set(bearer(owner.session.accessToken)).expect(200);
    expect(members.body.data.find((m: { id: string }) => m.id === member.session.userId).role).toBe('COACH');
    expect(await prisma.auditLog.count({ where: { action: 'GYM_COACH_APPOINTED' } })).toBe(1);

    await api().delete(url(member.session.userId)).set(bearer(owner.session.accessToken)).expect(204);
    expect((await prisma.gymMember.findFirstOrThrow({ where: { userId: member.session.userId, gymId: gym.id } })).role).toBe('MEMBER');
  });
});
```
Run → FAIL.

- [ ] **Step 3: Implémentation**

`gyms.service.ts` :
```ts
  async setCoach(user: AuthUser, gymId: string, memberId: string, coach: boolean) {
    await this.manageable(user, gymId);
    const m = await this.prisma.gymMember.findFirst({ where: { gymId, userId: memberId, status: 'APPROVED' } });
    if (!m) throw AppException.notFound('Membership');
    await this.prisma.$transaction(async (tx) => {
      await tx.gymMember.update({ where: { id: m.id }, data: { role: coach ? 'COACH' : 'MEMBER' } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: coach ? 'GYM_COACH_APPOINTED' : 'GYM_COACH_REMOVED', entityType: 'gym_member', entityId: m.id, after: { gymId, userId: memberId } }, tx);
    });
    return { userId: memberId, role: coach ? 'COACH' : 'MEMBER' };
  }

  approvedMember(userId: string, gymId: string) {
    return this.prisma.gymMember.findFirst({ where: { gymId, userId, status: 'APPROVED' } });
  }

  async isCoach(user: AuthUser, gymId: string): Promise<boolean> {
    const gym = await this.prisma.gym.findUnique({ where: { id: gymId } });
    if (!gym || gym.deletedAt) return false;
    if (this.canManage(user, gym)) return true;
    return (await this.approvedMember(user.id, gymId))?.role === 'COACH';
  }
```
`members()` : ajouter `role: m.role` au mapping. `get()` : `role: membership?.status === 'APPROVED' ? (membership.role === 'COACH' || (viewer && this.canManage(viewer, gym)) ? 'COACH' : 'MEMBER') : null`. Le test Tâche 3 attend `role: null` en PENDING : inchangé.

Contrôleur :
```ts
  @Post(':id/members/:userId/coach')
  @HttpCode(HttpStatus.OK)
  appointCoach(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.gyms.setCoach(user, id, userId, true);
  }

  @Delete(':id/members/:userId/coach')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCoach(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    await this.gyms.setCoach(user, id, userId, false);
  }
```

- [ ] **Step 4: Tests**

Run: `pnpm test:integration -- test/gym-coaches.int-spec.ts test/gym-directory.int-spec.ts test/gyms.int-spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api && git commit -m "feat(api): gym coaches appointed by the gym admin"
```

---

### Task 7: WODs de salle (création, modification, liste)

**Files:**
- Create: `prisma/migrations/<ts>_gym_wods/migration.sql`, `src/modules/gym-wods/gym-wods.module.ts`, `src/modules/gym-wods/gym-wods.controller.ts`, `src/modules/gym-wods/gym-wods.service.ts`, `src/modules/gym-wods/dto/gym-wod.dto.ts`, `src/modules/gym-wods/wod-ranking.ts`, `src/modules/gym-wods/wod-ranking.spec.ts`, `test/gym-wods.int-spec.ts`
- Modify: `prisma/schema.prisma`, `src/app.module.ts`, `src/modules/gyms/gyms.module.ts` (exporter `GymsService`)

**Interfaces:**
- Consumes: `GymsService.isCoach`, `GymsService.approvedMember` (Tâche 6).
- Produces: `GymWodsService.create(user, gymId, dto)`, `.update(user, gymId, wodId, dto)`, `.list(user, gymId, q: { when: 'active'|'upcoming'|'past'; cursor?; limit })`, `.get(user, gymId, wodId)` ; vue WOD `{ id, gymId, title, description, scoreType, timeCapS, startsAt, endsAt, status, sport: {code,name}|null, createdBy: {id, username}, isOpen: boolean, myScore: WodScoreView | null }` ; `wod-ranking.ts` : `better(scoreType, a, b): boolean`, `validateWindow(startsAt, endsAt): string | null`.

- [ ] **Step 1: Schéma**

```prisma
enum WodScoreType {
  FOR_TIME
  AMRAP
  MAX_LOAD
}

enum GymWodStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

enum WodDivision {
  RX
  SCALED
}

enum WodScoreStatus {
  VALID
  INVALIDATED
}

model GymWod {
  id          String       @id @db.Uuid
  gymId       String       @map("gym_id") @db.Uuid
  createdById String       @map("created_by") @db.Uuid
  title       String
  description String
  scoreType   WodScoreType @map("score_type")
  timeCapS    Int?         @map("time_cap_s")
  startsAt    DateTime     @map("starts_at") @db.Timestamptz
  endsAt      DateTime     @map("ends_at") @db.Timestamptz
  status      GymWodStatus @default(PUBLISHED)
  sportId     String?      @map("sport_id") @db.Uuid
  createdAt   DateTime     @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime     @updatedAt @map("updated_at") @db.Timestamptz

  gym       Gym           @relation(fields: [gymId], references: [id])
  createdBy User          @relation("GymWodAuthor", fields: [createdById], references: [id])
  sport     Sport?        @relation(fields: [sportId], references: [id])
  scores    GymWodScore[]

  @@index([gymId, status, endsAt])
  @@map("gym_wods")
}

model GymWodScore {
  id                 String         @id @db.Uuid
  wodId              String         @map("wod_id") @db.Uuid
  userId             String         @map("user_id") @db.Uuid
  division           WodDivision
  value              Decimal        @db.Decimal(10, 2)
  rounds             Int?
  reps               Int?
  workoutId          String         @map("workout_id") @db.Uuid
  status             WodScoreStatus @default(VALID)
  invalidatedById    String?        @map("invalidated_by") @db.Uuid
  invalidationReason String?        @map("invalidation_reason")
  createdAt          DateTime       @default(now()) @map("created_at") @db.Timestamptz
  updatedAt          DateTime       @updatedAt @map("updated_at") @db.Timestamptz

  wod     GymWod  @relation(fields: [wodId], references: [id])
  user    User    @relation("GymWodScoreUser", fields: [userId], references: [id])
  workout Workout @relation(fields: [workoutId], references: [id])

  @@unique([wodId, userId])
  @@index([wodId, division, status, value])
  @@map("gym_wod_scores")
}
```
Relations inverses : `Gym.wods GymWod[]`, `User.gymWods GymWod[] @relation("GymWodAuthor")`, `User.gymWodScores GymWodScore[] @relation("GymWodScoreUser")`, `Sport.gymWods GymWod[]`, `Workout.gymWodScores GymWodScore[]`. Migration `gym_wods`, deploy, generate.

- [ ] **Step 2: Tests unitaires de la logique pure (échouent)**

`src/modules/gym-wods/wod-ranking.spec.ts`
```ts
import { better, validateWindow } from './wod-ranking';

describe('wod ranking', () => {
  it('lower time wins FOR_TIME, higher wins AMRAP and MAX_LOAD', () => {
    expect(better('FOR_TIME', 300, 320)).toBe(true);
    expect(better('FOR_TIME', 320, 300)).toBe(false);
    expect(better('AMRAP', 250, 240)).toBe(true);
    expect(better('MAX_LOAD', 100, 102.5)).toBe(false);
    expect(better('AMRAP', 240, 240)).toBe(false); // ties keep the earlier score
  });

  it('validates the window', () => {
    const t = new Date('2026-09-27T08:00:00Z');
    expect(validateWindow(t, new Date(t.getTime() + 3_600_000))).toBeNull();
    expect(validateWindow(t, t)).toBe('ENDS_BEFORE_START');
    expect(validateWindow(t, new Date(t.getTime() + 32 * 86_400_000))).toBe('WINDOW_TOO_LONG');
  });
});
```

`src/modules/gym-wods/wod-ranking.ts`
```ts
import type { WodScoreType } from '@prisma/client';

export const MAX_WOD_WINDOW_DAYS = 31;

/** True if score `a` strictly beats `b`. Ties keep the earlier score. */
export function better(type: WodScoreType, a: number, b: number): boolean {
  return type === 'FOR_TIME' ? a < b : a > b;
}

export function validateWindow(startsAt: Date, endsAt: Date): 'ENDS_BEFORE_START' | 'WINDOW_TOO_LONG' | null {
  if (endsAt.getTime() <= startsAt.getTime()) return 'ENDS_BEFORE_START';
  if (endsAt.getTime() - startsAt.getTime() > MAX_WOD_WINDOW_DAYS * 86_400_000) return 'WINDOW_TOO_LONG';
  return null;
}

/** AMRAP scores are compared as total reps: rounds × repsPerRound + extra reps is computed by the client, sent as reps. */
export function scoreValue(type: WodScoreType, s: { timeS?: number; rounds?: number; reps?: number; loadKg?: number }): number | null {
  if (type === 'FOR_TIME') return s.timeS ?? null;
  if (type === 'MAX_LOAD') return s.loadKg ?? null;
  return s.reps ?? null;
}
```
Run: `pnpm test:unit -- src/modules/gym-wods` → PASS après création.

- [ ] **Step 3: DTO**

`src/modules/gym-wods/dto/gym-wod.dto.ts`
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WodDivision, WodScoreType } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

export class CreateGymWodDto {
  @ApiProperty() @IsString() @Length(3, 80) title!: string;
  @ApiProperty() @IsString() @Length(1, 2000) description!: string;
  @ApiProperty({ enum: WodScoreType }) @IsEnum(WodScoreType) scoreType!: WodScoreType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(60) @Max(4 * 3600) timeCapS?: number;
  @ApiProperty() @IsISO8601({ strict: true }) startsAt!: string;
  @ApiProperty() @IsISO8601({ strict: true }) endsAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sportId?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED'] }) @IsOptional() @IsIn(['DRAFT', 'PUBLISHED']) status?: 'DRAFT' | 'PUBLISHED';
}

export class UpdateGymWodDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 80) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(60) @Max(4 * 3600) timeCapS?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) endsAt?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] }) @IsOptional() @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED']) status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
}

export class ListGymWodsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'upcoming', 'past'] }) @IsOptional() @IsIn(['active', 'upcoming', 'past']) when: 'active' | 'upcoming' | 'past' = 'active';
}

export class SubmitWodScoreDto {
  @ApiProperty({ enum: WodDivision }) @IsEnum(WodDivision) division!: WodDivision;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(4 * 3600) timeS?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) rounds?: number;
  @ApiPropertyOptional({ description: 'AMRAP: total reps (rounds × reps per round + extra reps).' }) @IsOptional() @IsInt() @Min(0) @Max(5000) reps?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(500) loadKg?: number;
  @ApiProperty() @IsISO8601({ strict: true }) performedAt!: string;
  @ApiProperty() @IsUUID() clientId!: string;
}

export class WodLeaderboardQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: WodDivision }) @IsOptional() @IsEnum(WodDivision) division: WodDivision = 'RX';
}

export class InvalidateScoreDto {
  @ApiProperty() @IsString() @Length(3, 300) reason!: string;
}
```

- [ ] **Step 4: Test d'intégration CRUD (échoue)**

`test/gym-wods.int-spec.ts` — fichier commun aux Tâches 7 et 8 :
```ts
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { uuidv7 } from '../src/common/ids/uuid';
import { ClockService } from '../src/common/clock/clock.service';
import { registerUser, setupTestApp, TODAY } from './helpers';

describe('Gym WODs (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const h = (n: number) => new Date(TODAY.getTime() + n * 3_600_000).toISOString();
  let gymId: string;
  let coach: Awaited<ReturnType<typeof registerUser>>;
  let member: Awaited<ReturnType<typeof registerUser>>;
  let outsider: Awaited<ReturnType<typeof registerUser>>;

  beforeAll(async () => {
    ({ app, prisma } = await setupTestApp());
    // Freeze time at TODAY (same pattern as other files: see how leagues.int-spec moves the clock and reuse it).
    jest.spyOn(app.get(ClockService), 'now').mockImplementation(() => new Date(TODAY));
    gymId = (await prisma.gym.findUniqueOrThrow({ where: { slug: 'sahel-iron-club' } })).id;
    [coach, member, outsider] = [await registerUser(app, prisma), await registerUser(app, prisma), await registerUser(app, prisma)];
    for (const [u, role] of [[coach, 'COACH'], [member, 'MEMBER']] as const) {
      await prisma.gymMember.create({ data: { id: uuidv7(), gymId, userId: u.session.userId, status: 'APPROVED', approvedAt: new Date(), role } });
      await prisma.profile.update({ where: { userId: u.session.userId }, data: { primaryGymId: gymId } });
    }
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  const wodBody = { title: 'Sahel Burner', description: '21-15-9 thrusters / burpees', scoreType: 'FOR_TIME', timeCapS: 900, startsAt: h(-1), endsAt: h(48) };

  it('lets coaches create and edit WODs; members see published ones only', async () => {
    await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(member.session.accessToken)).send(wodBody).expect(403);
    await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, endsAt: h(-2) }).expect(422);
    await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, endsAt: h(24 * 40) }).expect(422);
    const created = await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send(wodBody).expect(201);
    expect(created.body).toMatchObject({ title: 'Sahel Burner', status: 'PUBLISHED', isOpen: true, myScore: null });
    await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, title: 'Secret draft', status: 'DRAFT' }).expect(201);

    const memberList = await api().get(`/api/v1/gyms/${gymId}/wods?when=active`).set(bearer(member.session.accessToken)).expect(200);
    expect(memberList.body.data.map((w: { title: string }) => w.title)).toEqual(['Sahel Burner']);
    const coachList = await api().get(`/api/v1/gyms/${gymId}/wods?when=active`).set(bearer(coach.session.accessToken)).expect(200);
    expect(coachList.body.data).toHaveLength(2);
    await api().get(`/api/v1/gyms/${gymId}/wods`).set(bearer(outsider.session.accessToken)).expect(403);

    const edited = await api().patch(`/api/v1/gyms/${gymId}/wods/${created.body.id}`).set(bearer(coach.session.accessToken)).send({ title: 'Sahel Burner v2' }).expect(200);
    expect(edited.body.title).toBe('Sahel Burner v2');
    expect(await prisma.auditLog.count({ where: { action: { in: ['GYM_WOD_CREATED', 'GYM_WOD_UPDATED'] } } })).toBe(3);
  });
});
```
Run → FAIL (404).

- [ ] **Step 5: Service et contrôleur (partie WOD)**

`src/modules/gym-wods/gym-wods.service.ts` (partie WOD ; la partie scores est ajoutée en Tâche 8) :
```ts
import { Injectable } from '@nestjs/common';
import { GymWod, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { CursorCodec } from '../../common/pagination/cursor';
import { toPage } from '../../common/pagination/page';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GymsService } from '../gyms/gyms.service';
import { CreateGymWodDto, ListGymWodsQueryDto, UpdateGymWodDto } from './dto/gym-wod.dto';
import { validateWindow } from './wod-ranking';

const WOD_INCLUDE = { sport: true, createdBy: { select: { id: true, username: true } } } satisfies Prisma.GymWodInclude;
type WodRow = Prisma.GymWodGetPayload<{ include: typeof WOD_INCLUDE }>;

/** Coach-made WODs of a gym (spec §4). Scores count for the gym board and plain workout XP, never PRs or national LP. */
@Injectable()
export class GymWodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gyms: GymsService,
    private readonly audit: AuditService,
    private readonly cursors: CursorCodec,
    private readonly clock: ClockService,
  ) {}

  async create(user: AuthUser, gymId: string, dto: CreateGymWodDto) {
    await this.requireCoach(user, gymId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.checkWindow(startsAt, endsAt);
    if (dto.sportId && !(await this.prisma.sport.findUnique({ where: { id: dto.sportId } }))) throw AppException.validation([{ field: 'sportId', code: 'UNKNOWN_SPORT' }]);
    const id = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.gymWod.create({ data: { id, gymId, createdById: user.id, title: dto.title.trim(), description: dto.description.trim(), scoreType: dto.scoreType, timeCapS: dto.timeCapS, startsAt, endsAt, sportId: dto.sportId, status: dto.status ?? 'PUBLISHED' } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'GYM_WOD_CREATED', entityType: 'gym_wod', entityId: id, after: { gymId } }, tx);
    });
    return this.get(user, gymId, id);
  }

  async update(user: AuthUser, gymId: string, wodId: string, dto: UpdateGymWodDto) {
    await this.requireCoach(user, gymId);
    const wod = await this.find(gymId, wodId);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : wod.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : wod.endsAt;
    this.checkWindow(startsAt, endsAt);
    await this.prisma.$transaction(async (tx) => {
      await tx.gymWod.update({ where: { id: wod.id }, data: { title: dto.title?.trim(), description: dto.description?.trim(), timeCapS: dto.timeCapS, startsAt, endsAt, status: dto.status } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'GYM_WOD_UPDATED', entityType: 'gym_wod', entityId: wod.id, before: { title: wod.title }, after: { title: dto.title ?? wod.title } }, tx);
    });
    return this.get(user, gymId, wodId);
  }

  async list(user: AuthUser, gymId: string, q: ListGymWodsQueryDto) {
    const coach = await this.requireMemberOrCoach(user, gymId);
    const now = this.clock.now();
    const c = q.cursor ? this.cursors.decode<{ t: string; id: string }>(q.cursor) : null;
    const time: Prisma.GymWodWhereInput =
      q.when === 'active' ? { startsAt: { lte: now }, endsAt: { gt: now } } : q.when === 'upcoming' ? { startsAt: { gt: now } } : { endsAt: { lte: now } };
    const desc = q.when === 'past';
    const rows = await this.prisma.gymWod.findMany({
      where: {
        gymId,
        ...time,
        status: coach ? { in: ['DRAFT', 'PUBLISHED'] } : 'PUBLISHED',
        ...(c && (desc
          ? { OR: [{ endsAt: { lt: new Date(c.t) } }, { endsAt: new Date(c.t), id: { lt: c.id } }] }
          : { OR: [{ endsAt: { gt: new Date(c.t) } }, { endsAt: new Date(c.t), id: { gt: c.id } }] })),
      },
      include: WOD_INCLUDE,
      orderBy: desc ? [{ endsAt: 'desc' }, { id: 'desc' }] : [{ endsAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
    });
    const page = toPage(rows, q.limit, (w) => ({ t: w.endsAt.toISOString(), id: w.id }), (k) => this.cursors.encode(k));
    const mine = await this.myScores(user.id, page.data.map((w) => w.id));
    return { data: page.data.map((w) => this.view(w, mine.get(w.id) ?? null, now)), page: page.page };
  }

  async get(user: AuthUser, gymId: string, wodId: string) {
    const coach = await this.requireMemberOrCoach(user, gymId);
    const wod = await this.prisma.gymWod.findFirst({ where: { id: wodId, gymId }, include: WOD_INCLUDE });
    if (!wod || (!coach && wod.status !== 'PUBLISHED')) throw AppException.notFound('WOD');
    const mine = await this.myScores(user.id, [wod.id]);
    return this.view(wod, mine.get(wod.id) ?? null, this.clock.now());
  }

  // ───────────── Internals ─────────────

  protected async find(gymId: string, wodId: string): Promise<GymWod> {
    const wod = await this.prisma.gymWod.findFirst({ where: { id: wodId, gymId } });
    if (!wod) throw AppException.notFound('WOD');
    return wod;
  }

  protected async requireCoach(user: AuthUser, gymId: string): Promise<void> {
    if (!(await this.gyms.isCoach(user, gymId))) throw AppException.forbidden('Only a coach of this gym can do that.');
  }

  /** Returns true for coaches; throws for non-members. */
  protected async requireMemberOrCoach(user: AuthUser, gymId: string): Promise<boolean> {
    if (await this.gyms.isCoach(user, gymId)) return true;
    if (!(await this.gyms.approvedMember(user.id, gymId))) throw AppException.forbidden('Only members of this gym can see its WODs.');
    return false;
  }

  private checkWindow(startsAt: Date, endsAt: Date): void {
    const err = validateWindow(startsAt, endsAt);
    if (err) throw AppException.validation([{ field: 'endsAt', code: err }]);
  }

  private async myScores(userId: string, wodIds: string[]) {
    const rows = await this.prisma.gymWodScore.findMany({ where: { userId, wodId: { in: wodIds } } });
    return new Map(rows.map((s) => [s.wodId, s]));
  }

  protected scoreView(s: { id: string; division: string; value: Prisma.Decimal; rounds: number | null; reps: number | null; status: string; invalidationReason: string | null }) {
    return { id: s.id, division: s.division, value: Number(s.value), rounds: s.rounds, reps: s.reps, status: s.status, invalidationReason: s.invalidationReason };
  }

  private view(w: WodRow, mine: Parameters<GymWodsService['scoreView']>[0] | null, now: Date) {
    return {
      id: w.id,
      gymId: w.gymId,
      title: w.title,
      description: w.description,
      scoreType: w.scoreType,
      timeCapS: w.timeCapS,
      startsAt: w.startsAt.toISOString(),
      endsAt: w.endsAt.toISOString(),
      status: w.status,
      sport: w.sport ? { code: w.sport.code, name: w.sport.nameI18n } : null,
      createdBy: w.createdBy,
      isOpen: w.status === 'PUBLISHED' && w.startsAt <= now && now < w.endsAt,
      myScore: mine ? this.scoreView(mine) : null,
    };
  }
}
```

`gym-wods.controller.ts` :
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { CreateGymWodDto, ListGymWodsQueryDto, UpdateGymWodDto } from './dto/gym-wod.dto';
import { GymWodsService } from './gym-wods.service';

@ApiTags('gym-wods')
@ApiBearerAuth()
@Controller('gyms/:gymId/wods')
export class GymWodsController {
  constructor(private readonly wods: GymWodsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('gymId', ParseUUIDPipe) gymId: string, @Body() dto: CreateGymWodDto) {
    return this.wods.create(user, gymId, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('gymId', ParseUUIDPipe) gymId: string, @Query() q: ListGymWodsQueryDto) {
    return this.wods.list(user, gymId, q);
  }

  @Get(':wodId')
  get(@CurrentUser() user: AuthUser, @Param('gymId', ParseUUIDPipe) gymId: string, @Param('wodId', ParseUUIDPipe) wodId: string) {
    return this.wods.get(user, gymId, wodId);
  }

  @Patch(':wodId')
  update(@CurrentUser() user: AuthUser, @Param('gymId', ParseUUIDPipe) gymId: string, @Param('wodId', ParseUUIDPipe) wodId: string, @Body() dto: UpdateGymWodDto) {
    return this.wods.update(user, gymId, wodId, dto);
  }
}
```
`gym-wods.module.ts` : `imports: [GymsModule, WorkoutsModule]` (WorkoutsModule sert en Tâche 8 ; exporter `WorkoutsService` s'il ne l'est pas), `controllers: [GymWodsController]`, `providers: [GymWodsService]`. `gyms.module.ts` : `exports: [GymsService]`. `app.module.ts` : importer `GymWodsModule`.

- [ ] **Step 6: Tests**

Run: `pnpm test:unit -- src/modules/gym-wods` et `pnpm test:integration -- test/gym-wods.int-spec.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A apps/api && git commit -m "feat(api): coach-made gym WODs"
```

---

### Task 8: Scores de WOD, classement et invalidation

**Files:**
- Modify: `src/modules/gym-wods/gym-wods.service.ts`, `src/modules/gym-wods/gym-wods.controller.ts`, `src/modules/notifications/notifications.service.ts`, `test/gym-wods.int-spec.ts`

**Interfaces:**
- Consumes: `WorkoutsService.create(userId, dto: CreateWorkoutDto): Promise<{ id, status, ... }>` et `WorkoutsService.remove(userId, id)` (existants), `NotificationsService.notify(tx, userId, type, payload)`.
- Produces: `GymWodsService.submit(user, gymId, wodId, dto: SubmitWodScoreDto)`, `.leaderboard(user, gymId, wodId, q)`, `.leaderboardMe(user, gymId, wodId, division)`, `.invalidate(user, gymId, wodId, scoreId, reason)` ; ligne de classement `{ rank, athlete: { id, username, fullName }, value, rounds, reps, status, submittedAt }` ; notification `GYM_WOD_SCORE_INVALIDATED`.

- [ ] **Step 1: Tests d'intégration (échouent)** — ajouter à `test/gym-wods.int-spec.ts`

```ts
  it('accepts member scores inside the window, keeps the best and ranks them', async () => {
    const wod = (await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, title: 'Board test' }).expect(201)).body;
    const submit = (u: typeof member, body: Record<string, unknown>) =>
      api().put(`/api/v1/gyms/${gymId}/wods/${wod.id}/score`).set(bearer(u.session.accessToken)).send({ division: 'RX', performedAt: h(0), clientId: crypto.randomUUID(), ...body });

    await submit(outsider, { timeS: 400 }).expect(403);
    await submit(member, { timeS: 901 }).expect(422); // over the time cap
    expect((await submit(member, { timeS: 420 }).expect(200)).body.myScore.value).toBe(420);
    expect((await submit(member, { timeS: 480 }).expect(200)).body.myScore.value).toBe(420); // worse: board keeps 420
    await submit(coach, { timeS: 390 }).expect(200);
    expect(await prisma.workout.count({ where: { userId: member.session.userId, workoutType: 'GYM_WOD' } })).toBe(2); // both sessions logged

    const board = await api().get(`/api/v1/gyms/${gymId}/wods/${wod.id}/leaderboard?division=RX`).set(bearer(member.session.accessToken)).expect(200);
    expect(board.body.data.map((r: { rank: number; value: number }) => [r.rank, r.value])).toEqual([[1, 390], [2, 420]]);
    const me = await api().get(`/api/v1/gyms/${gymId}/wods/${wod.id}/leaderboard/me?division=RX`).set(bearer(member.session.accessToken)).expect(200);
    expect(me.body).toMatchObject({ rank: 2, value: 420 });
    expect(await prisma.metricObservation.count({ where: { workout: { workoutType: 'GYM_WOD' } } })).toBe(0); // never PRs
  });

  it('refuses scores after the WOD closes and from members who left', async () => {
    const wod = (await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, title: 'Closed', startsAt: h(-5), endsAt: h(-1) }).expect(201)).body;
    const res = await api().put(`/api/v1/gyms/${gymId}/wods/${wod.id}/score`).set(bearer(member.session.accessToken)).send({ division: 'RX', timeS: 300, performedAt: h(-2), clientId: crypto.randomUUID() }).expect(409);
    expect(res.body.code).toBe('WOD_CLOSED');
  });

  it('lets a coach invalidate a score: removed from the board, XP reversed, member notified', async () => {
    const wod = (await api().post(`/api/v1/gyms/${gymId}/wods`).set(bearer(coach.session.accessToken)).send({ ...wodBody, title: 'Invalidate', scoreType: 'AMRAP', timeCapS: undefined }).expect(201)).body;
    const sub = await api().put(`/api/v1/gyms/${gymId}/wods/${wod.id}/score`).set(bearer(member.session.accessToken)).send({ division: 'SCALED', rounds: 12, reps: 190, performedAt: h(0), clientId: crypto.randomUUID() }).expect(200);
    const scoreId = sub.body.myScore.id;
    await api().post(`/api/v1/gyms/${gymId}/wods/${wod.id}/scores/${scoreId}/invalidate`).set(bearer(member.session.accessToken)).send({ reason: 'self' }).expect(403);
    await api().post(`/api/v1/gyms/${gymId}/wods/${wod.id}/scores/${scoreId}/invalidate`).set(bearer(coach.session.accessToken)).send({ reason: 'No-rep on pull-ups' }).expect(200);

    const board = await api().get(`/api/v1/gyms/${gymId}/wods/${wod.id}/leaderboard?division=SCALED`).set(bearer(coach.session.accessToken)).expect(200);
    expect(board.body.data).toEqual([]);
    const score = await prisma.gymWodScore.findUniqueOrThrow({ where: { id: scoreId } });
    expect((await prisma.workout.findUniqueOrThrow({ where: { id: score.workoutId } })).deletedAt).not.toBeNull();
    const notes = await api().get('/api/v1/notifications').set(bearer(member.session.accessToken)).expect(200);
    expect(notes.body.data[0]).toMatchObject({ type: 'GYM_WOD_SCORE_INVALIDATED', payload: { wodId: wod.id, reason: 'No-rep on pull-ups' } });
    expect(await prisma.auditLog.count({ where: { action: 'GYM_WOD_SCORE_INVALIDATED', entityId: scoreId } })).toBe(1);
  });
```
(`crypto.randomUUID` : importer `import { randomUUID } from 'node:crypto'` et remplacer.) Run → FAIL.

- [ ] **Step 2: Implémentation**

Ajouter au service (injecter `private readonly workouts: WorkoutsService` et `private readonly notifications: NotificationsService`) :
```ts
  async submit(user: AuthUser, gymId: string, wodId: string, dto: SubmitWodScoreDto) {
    if (!(await this.gyms.approvedMember(user.id, gymId)) && !(await this.gyms.isCoach(user, gymId))) throw AppException.forbidden('Only members of this gym can submit scores.');
    const wod = await this.find(gymId, wodId);
    const now = this.clock.now();
    if (wod.status !== 'PUBLISHED' || now < wod.startsAt || now >= wod.endsAt) throw AppException.conflict(ErrorCode.WOD_CLOSED, 'This WOD is not open for scores.');
    const value = scoreValue(wod.scoreType, dto);
    if (value === null) throw AppException.validation([{ field: wod.scoreType === 'FOR_TIME' ? 'timeS' : wod.scoreType === 'AMRAP' ? 'reps' : 'loadKg', code: 'REQUIRED' }]);
    if (wod.scoreType === 'FOR_TIME' && wod.timeCapS && value > wod.timeCapS) throw AppException.validation([{ field: 'timeS', code: 'OVER_TIME_CAP' }]);

    const durationS = Math.max(60, wod.scoreType === 'FOR_TIME' ? value : (wod.timeCapS ?? 20 * 60));
    const sportId = wod.sportId ?? (await this.prisma.sport.findUniqueOrThrow({ where: { code: 'CROSSFIT' } })).id;
    const workout = await this.workouts.create(user.id, {
      clientId: dto.clientId, sportId, workoutType: 'GYM_WOD', performedAt: dto.performedAt, durationS,
      notes: `${wod.title} — ${dto.division}`, exercises: [],
    } as CreateWorkoutDto);

    const existing = await this.prisma.gymWodScore.findUnique({ where: { wodId_userId: { wodId, userId: user.id } } });
    const keepExisting = existing && existing.status === 'VALID' && !better(wod.scoreType, value, Number(existing.value));
    if (!keepExisting) {
      const data = { division: dto.division, value, rounds: dto.rounds ?? null, reps: dto.reps ?? null, workoutId: workout.id, status: 'VALID' as const, invalidatedById: null, invalidationReason: null };
      await this.prisma.gymWodScore.upsert({ where: { wodId_userId: { wodId, userId: user.id } }, update: data, create: { id: uuidv7(), wodId, userId: user.id, ...data } });
    }
    return this.get(user, gymId, wodId);
  }

  async leaderboard(user: AuthUser, gymId: string, wodId: string, q: WodLeaderboardQueryDto) {
    await this.requireMemberOrCoach(user, gymId);
    const wod = await this.find(gymId, wodId);
    const asc = wod.scoreType === 'FOR_TIME';
    const offset = q.cursor ? this.cursors.decode<{ o: number }>(q.cursor).o : 0;
    const rows = await this.prisma.gymWodScore.findMany({
      where: { wodId, division: q.division, status: 'VALID' },
      include: { user: { select: { id: true, username: true, profile: { select: { fullName: true } } } } },
      orderBy: [{ value: asc ? 'asc' : 'desc' }, { updatedAt: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const data = rows.slice(0, q.limit).map((s, i) => ({
      rank: offset + i + 1,
      scoreId: s.id,
      athlete: { id: s.user.id, username: s.user.username, fullName: s.user.profile?.fullName ?? null },
      value: Number(s.value), rounds: s.rounds, reps: s.reps, submittedAt: s.updatedAt.toISOString(),
    }));
    return { data, page: { nextCursor: hasMore ? this.cursors.encode({ o: offset + q.limit }) : null, hasMore } };
  }

  async leaderboardMe(user: AuthUser, gymId: string, wodId: string, division: 'RX' | 'SCALED') {
    await this.requireMemberOrCoach(user, gymId);
    const wod = await this.find(gymId, wodId);
    const mine = await this.prisma.gymWodScore.findUnique({ where: { wodId_userId: { wodId, userId: user.id } } });
    if (!mine || mine.status !== 'VALID' || mine.division !== division) return {};
    const cmp = wod.scoreType === 'FOR_TIME' ? { lt: mine.value } : { gt: mine.value };
    const ahead = await this.prisma.gymWodScore.count({
      where: { wodId, division, status: 'VALID', OR: [{ value: cmp }, { value: mine.value, updatedAt: { lt: mine.updatedAt } }] },
    });
    return { rank: ahead + 1, ...this.scoreView(mine) };
  }

  async invalidate(user: AuthUser, gymId: string, wodId: string, scoreId: string, reason: string) {
    await this.requireCoach(user, gymId);
    const wod = await this.find(gymId, wodId);
    const score = await this.prisma.gymWodScore.findFirst({ where: { id: scoreId, wodId } });
    if (!score || score.status !== 'VALID') throw AppException.notFound('Score');
    await this.prisma.$transaction(async (tx) => {
      await tx.gymWodScore.update({ where: { id: score.id }, data: { status: 'INVALIDATED', invalidatedById: user.id, invalidationReason: reason } });
      await this.notifications.notify(tx, score.userId, 'GYM_WOD_SCORE_INVALIDATED', { gymId, wodId, wodTitle: wod.title, reason });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'GYM_WOD_SCORE_INVALIDATED', entityType: 'gym_wod_score', entityId: score.id, after: { reason } }, tx);
    });
    // Soft-deleting the linked workout reverses its XP through the existing WorkoutDeleted pipeline.
    await this.workouts.remove(score.userId, score.workoutId);
    return { id: score.id, status: 'INVALIDATED' };
  }
```
Imports : `ErrorCode` (ajouter `WOD_CLOSED` à l'enum `ErrorCode`), `better`, `scoreValue`, `SubmitWodScoreDto`, `WodLeaderboardQueryDto`, `CreateWorkoutDto`, `WorkoutsService`, `NotificationsService`. Si `WorkoutsService.create` refuse `exercises: []` (lecture de `toInput`/`evaluate`), ajouter une garde `if (!dto.exercises.length && dto.workoutType !== 'GYM_WOD')` là où c'est nécessaire, plutôt que d'inventer un exercice. Si `create` renvoie une forme `{ workout, replayed }`, lire l'`id` au bon endroit.

`notifications.service.ts` : ajouter `| 'GYM_WOD_SCORE_INVALIDATED'` au type `NotificationType`. Vérifier que `NotificationsModule` exporte `NotificationsService` et l'importer dans `GymWodsModule`.

Contrôleur :
```ts
  @Put(':wodId/score')
  submit(@CurrentUser() user: AuthUser, @Param('gymId', ParseUUIDPipe) gymId: string, @Param('wodId', ParseUUIDPipe) wodId: string, @Body() dto: SubmitWodScoreDto) {
    return this.wods.submit(user, gymId, wodId, dto);
  }

  @Get(':wodId/leaderboard')
  leaderboard(@CurrentUser() user: AuthUser, @Param('gymId', ParseUUIDPipe) gymId: string, @Param('wodId', ParseUUIDPipe) wodId: string, @Query() q: WodLeaderboardQueryDto) {
    return this.wods.leaderboard(user, gymId, wodId, q);
  }

  @Get(':wodId/leaderboard/me')
  leaderboardMe(@CurrentUser() user: AuthUser, @Param('gymId', ParseUUIDPipe) gymId: string, @Param('wodId', ParseUUIDPipe) wodId: string, @Query() q: WodLeaderboardQueryDto) {
    return this.wods.leaderboardMe(user, gymId, wodId, q.division);
  }

  @Post(':wodId/scores/:scoreId/invalidate')
  @HttpCode(HttpStatus.OK)
  invalidate(@CurrentUser() user: AuthUser, @Param('gymId', ParseUUIDPipe) gymId: string, @Param('wodId', ParseUUIDPipe) wodId: string, @Param('scoreId', ParseUUIDPipe) scoreId: string, @Body() dto: InvalidateScoreDto) {
    return this.wods.invalidate(user, gymId, wodId, scoreId, dto.reason);
  }
```
Note : déclarer `leaderboard/me` avant tout `:wodId/...` générique qui pourrait l'avaler (ici l'ordre des routes ne pose pas problème car `me` est sous `leaderboard/`).

- [ ] **Step 3: Tests**

Run: `pnpm test:integration -- test/gym-wods.int-spec.ts test/workouts.int-spec.ts` → PASS. Puis la suite complète : `pnpm test:unit && pnpm test:integration && pnpm lint && pnpm typecheck` → tout vert.

- [ ] **Step 4: Commit**

```bash
git add -A apps/api && git commit -m "feat(api): gym WOD scores, leaderboard and coach invalidation"
```

---

### Task 9: Données de démo (salles, logos, coach, WODs, CrossFit/Hyrox)

**Files:**
- Create: `apps/api/scripts/demo-logos.ts`
- Modify: `apps/api/scripts/demo-data.ts`, `infra/seed-data/catalog.json` (salles fictives de démo : non — elles vont dans le script de démo, pas dans le seed de prod)

**Interfaces:**
- Consumes: `StorageService` n'est pas utilisable hors Nest : le script appelle l'API `PUT /gyms/:id/logo` avec le token du gérant (chemin réel, validé par les tests).
- Produces: `renderLogoPng(name: string, palette: [string, string], motif: 'bolt'|'wave'|'hex'|'peak'|'ring'|'bar'): Promise<Buffer>` dans `demo-logos.ts`.

- [ ] **Step 1: Générateur de logos**

`scripts/demo-logos.ts`
```ts
import sharp from 'sharp';

export type Motif = 'bolt' | 'wave' | 'hex' | 'peak' | 'ring' | 'bar';

const MOTIFS: Record<Motif, string> = {
  bolt: '<path d="M290 110 L200 270 H262 L222 402 L330 222 H266 Z" fill="FG"/>',
  wave: '<path d="M96 300 Q176 220 256 300 T416 300" stroke="FG" stroke-width="34" fill="none" stroke-linecap="round"/><path d="M96 220 Q176 140 256 220 T416 220" stroke="FG" stroke-width="18" fill="none" stroke-linecap="round" opacity=".6"/>',
  hex: '<path d="M256 96 L394 176 V336 L256 416 L118 336 V176 Z" stroke="FG" stroke-width="30" fill="none"/>',
  peak: '<path d="M96 380 L210 170 L270 270 L320 200 L416 380 Z" fill="FG"/>',
  ring: '<circle cx="256" cy="256" r="130" stroke="FG" stroke-width="34" fill="none"/><circle cx="256" cy="256" r="52" fill="FG"/>',
  bar: '<rect x="96" y="238" width="320" height="36" rx="10" fill="FG"/><rect x="120" y="178" width="40" height="156" rx="10" fill="FG"/><rect x="352" y="178" width="40" height="156" rx="10" fill="FG"/>',
};

/** Original, fictional logo: gradient disc, geometric motif, initials. No real brand. */
export async function renderLogoPng(name: string, [from, to]: [string, string], motif: Motif, fg = '#0E0F12'): Promise<Buffer> {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="512" height="512" rx="120" fill="url(#g)"/>
    <g opacity=".92">${MOTIFS[motif].replaceAll('FG', fg)}</g>
    <text x="256" y="470" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="64" fill="${fg}" letter-spacing="6">${initials}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
```

- [ ] **Step 2: Étendre `demo-data.ts`**

Après la création des athlètes (avant la section « Friends ») :
```ts
    // ── Gyms (fictional), logos, sports ──
    const sportIds = new Map(sports.map((s) => [s.code, s.id]));
    const demoGyms: { name: string; gov: string; sports: string[]; palette: [string, string]; motif: Motif; address: string; instagram: string }[] = [
      { name: 'Bodynade', gov: 'TN-11', sports: ['CROSSFIT', 'HYROX', 'BODYBUILDING'], palette: ['#C6F432', '#3DDC97'], motif: 'bolt', address: 'Rue du Lac Léman, Les Berges du Lac', instagram: 'https://instagram.com/bodynade.demo' },
      { name: 'Sfax Hybrid Box', gov: 'TN-61', sports: ['CROSSFIT', 'HYROX'], palette: ['#FF8A3D', '#FF3D71'], motif: 'hex', address: 'Route de Tunis km 3', instagram: 'https://instagram.com/sfaxhybrid.demo' },
      { name: 'Nabeul Run & Row', gov: 'TN-21', sports: ['RUNNING', 'HYROX'], palette: ['#3DA9FC', '#7B61FF'], motif: 'wave', address: 'Avenue Habib Bourguiba', instagram: 'https://instagram.com/nabeulrun.demo' },
      { name: 'Bizerte Barbell', gov: 'TN-17', sports: ['POWERLIFTING', 'WEIGHT_TRAINING'], palette: ['#F5F5F5', '#9AA0A6'], motif: 'bar', address: 'Corniche de Bizerte', instagram: 'https://instagram.com/bizertebarbell.demo' },
      { name: 'Monastir Move', gov: 'TN-52', sports: ['FUNCTIONAL', 'CROSSFIT'], palette: ['#FFD166', '#EF476F'], motif: 'ring', address: 'Marina de Monastir', instagram: 'https://instagram.com/monastirmove.demo' },
    ];
```
Pour chaque salle : `prisma.gym.create` (statut `VERIFIED`, `ownerUserId` = `ahmed` pour Bodynade, sinon `karim`), `gymSport.createMany`, et pour les salles du catalogue existantes (`carthage-strength-lab`, `ariana-fit-house`, `sahel-iron-club`) : palette/motif dédiés (`['#9B5DE5','#00BBF9'],'peak'`, `['#06D6A0','#118AB2'],'ring'`, `['#F15BB5','#FEE440'],'hex'`). Passer temporairement le rôle du propriétaire à `GYM_ADMIN` (écriture directe, documentée « demo shortcut »), puis uploader le logo par l'API :
```ts
async function uploadLogo(token: string, gymId: string, png: Buffer): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'logo.png');
  const res = await fetch(`${API}/gyms/${gymId}/logo`, { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) throw new Error(`logo upload → ${res.status} ${await res.text()}`);
}
```
Les rôles : `ahmed` → `GYM_ADMIN` propriétaire de Bodynade ; `karim` → `GYM_ADMIN` propriétaire des autres. (Le token existant d'`ahmed` porte encore le rôle `USER` : se reconnecter via `POST /auth/login` après le changement de rôle pour obtenir un token au bon rôle.)

Membres de Bodynade : `ahmed` (propriétaire, donc coach), `yassine` et `nour` (approuvés, `nour` `COACH`) ; `primaryGymId` mis à jour. Retirer `ahmed` et `yassine` de `sahel-iron-club` (le bloc existant les y mettait) → remplacer ce bloc par Bodynade. `sami` et `karim` : membres de `sfax-hybrid-box` et `monastir-move`.

WODs Bodynade (via l'API, token d'`ahmed`) :
- « Bodynade Burner » : `FOR_TIME`, cap 15 min, `startsAt` = maintenant − 1 j, `endsAt` = maintenant + 6 j, sport CrossFit, description « 21-15-9 : thrusters 43/29 kg, burpees au-dessus de la barre, row calories. »
- « Friday AMRAP 20 » : `AMRAP`, `startsAt` = maintenant − 8 j, `endsAt` = maintenant − 1 j, description « AMRAP 20 min : 10 wall balls, 10 box jumps, 200 m course. »

Comme « Friday AMRAP 20 » est déjà fermé, créer d'abord ses scores en écriture directe (documentée « demo shortcut ») : pour chaque score, une séance `GYM_WOD` via `POST /workouts`, puis `prisma.gymWodScore.create`. Scores : `yassine` RX 212 reps, `nour` SCALED 188 reps, `ahmed` RX 205 reps. Pour « Bodynade Burner » (ouvert), passer par `PUT /gyms/:id/wods/:wodId/score` : `yassine` RX 452 s, `nour` SCALED 530 s.

Séances CrossFit/Hyrox pour `ahmed` (via `POST /workouts`) : Fran à −9 j en 355 s puis à −2 j en 331 s ; Hyrox Open à −20 j en 5 520 s puis à −3 j en 5 280 s (avec les 9 stations en sets séparés : 1 exercice par station, une série `durationS`). Laisser 4 s au worker comme le fait déjà le script.

Mettre à jour le message final : `Bodynade (Tunis) — coachs : ahmed, nour`.

- [ ] **Step 3: Rejouer la démo sur une base neuve**

```bash
cd apps/api
# arrêter l'API, supprimer la base embarquée de démo si le script "db:embedded" le permet, sinon :
pnpm prisma migrate reset --force --skip-seed && pnpm seed
pnpm dev &   # attendre /health = ok
pnpm demo-data
curl -s localhost:3000/api/v1/gyms?limit=20 -H "authorization: Bearer <token ahmed>" | head -c 600
```
Attendu : 8 salles avec `logoUrl` non nul ; Bodynade avec 3 sports. Ouvrir un `logoUrl` dans le navigateur : image 512×512.

- [ ] **Step 4: Commit**

```bash
git add -A apps/api && git commit -m "chore(demo): fictional gyms with generated logos, Bodynade coach and WODs, CrossFit/Hyrox sessions"
```

---

# Partie 2 — Mobile (`apps/mobile`)

Commandes de référence (depuis `apps/mobile`, Flutter Linux : `~/flutter/bin/flutter`) :
- `flutter pub get && flutter gen-l10n`
- Tests : `flutter test test/<chemin>` ; analyse : `flutter analyze`
- Build web de prévisualisation : `flutter build web --dart-define=API_BASE_URL=http://localhost:3000/api/v1`

Règles communes à toutes les tâches mobiles :
- Chaque nouveau texte visible = une clé dans `app_en.arb` (avec `@clé` description si paramètres), `app_fr.arb`, `app_ar.arb`, puis `flutter gen-l10n`. Les clés listées dans chaque tâche sont à ajouter avec les traductions données.
- Chaque fonctionnalité : `features/<nom>/data/<nom>_repository.dart` (classe + `Provider`) et `features/<nom>/presentation/*.dart`, comme `league`.
- Les tests de widgets utilisent `FakeBackend` + `pumpScreen` (`test/widgets/harness.dart`).

### Task 10: Fondations UI — polices, thème, kit de composants

**Files:**
- Create: `assets/fonts/BarlowCondensed-SemiBold.ttf`, `assets/fonts/BarlowCondensed-ExtraBold.ttf`, `assets/fonts/Inter-Variable.ttf`, `lib/core/widgets/gym_logo.dart`, `lib/core/widgets/sport_chip.dart`, `lib/core/widgets/section_header.dart`, `lib/core/widgets/skeleton.dart`, `lib/core/widgets/time_field.dart`, `lib/core/widgets/countdown_text.dart`, `lib/core/widgets/rank_row.dart`, `lib/core/widgets/avatar_badge.dart`, `test/widgets/kit_test.dart`
- Modify: `pubspec.yaml`, `lib/core/theme/app_theme.dart`, `lib/core/network/api_client.dart`, `lib/core/utils/format.dart`, `lib/core/widgets/common.dart`

**Interfaces:**
- Produces:
  - `GymLogo({required String name, String? url, double size = 56})`
  - `SportChip({required String code, required Object? name, bool selected = false, VoidCallback? onTap})` et `IconData sportIcon(String code)`
  - `SectionHeader({required String title, String? actionLabel, VoidCallback? onAction})`
  - `SkeletonList({int count = 6, double height = 76})`
  - `TimeField({Key? key, required ValueChanged<int?> onChanged, String? label, int? initialSeconds})` ; `int? parseDuration(String)` dans `format.dart`
  - `CountdownText({required DateTime endsAt, TextStyle? style})`
  - `RankRow({required int rank, required String name, required String value, bool highlight = false, Widget? leading, VoidCallback? onTap, VoidCallback? onLongPress})`
  - `AvatarBadge({required String name, String? division, double size = 44})`
  - `ApiClient.put<T>(path, {data})`, `ApiClient.upload<T>(path, {required List<int> bytes, required String filename, String field = 'file'})`
  - `AppTheme.display(BuildContext)` : style de chiffres en Barlow Condensed.

- [ ] **Step 1: Polices et dépendances**

```bash
mkdir -p assets/fonts
curl -L -o assets/fonts/BarlowCondensed-SemiBold.ttf https://github.com/google/fonts/raw/main/ofl/barlowcondensed/BarlowCondensed-SemiBold.ttf
curl -L -o assets/fonts/BarlowCondensed-ExtraBold.ttf https://github.com/google/fonts/raw/main/ofl/barlowcondensed/BarlowCondensed-ExtraBold.ttf
curl -L -o "assets/fonts/Inter-Variable.ttf" "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"
curl -L -o assets/fonts/OFL-Barlow.txt https://github.com/google/fonts/raw/main/ofl/barlowcondensed/OFL.txt
curl -L -o assets/fonts/OFL-Inter.txt https://github.com/google/fonts/raw/main/ofl/inter/OFL.txt
file assets/fonts/*.ttf   # doit afficher "TrueType Font data", pas HTML
flutter pub add image_picker cached_network_image
```
`pubspec.yaml`, sous `flutter:` :
```yaml
  fonts:
    - family: BarlowCondensed
      fonts:
        - asset: assets/fonts/BarlowCondensed-SemiBold.ttf
          weight: 600
        - asset: assets/fonts/BarlowCondensed-ExtraBold.ttf
          weight: 800
    - family: Inter
      fonts:
        - asset: assets/fonts/Inter-Variable.ttf
```

- [ ] **Step 2: Tests du kit (échouent)**

`test/widgets/kit_test.dart`
```dart
import 'package:fitness_league/core/utils/format.dart';
import 'package:fitness_league/core/widgets/gym_logo.dart';
import 'package:fitness_league/core/widgets/rank_row.dart';
import 'package:fitness_league/core/widgets/time_field.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

void main() {
  test('parseDuration accepts m:ss and h:mm:ss and rejects nonsense', () {
    expect(parseDuration('4:58'), 298);
    expect(parseDuration('1:28:00'), 5280);
    expect(parseDuration(' 12:05 '), 725);
    expect(parseDuration('1:75'), isNull);
    expect(parseDuration('abc'), isNull);
    expect(parseDuration(''), isNull);
    expect(parseDuration('0:00'), isNull);
  });

  testWidgets('TimeField reports seconds, shows an error on invalid input', (tester) async {
    int? value = -1;
    await pumpScreen(tester, Scaffold(body: TimeField(key: const Key('t'), label: 'Time', onChanged: (v) => value = v)), FakeBackend());
    await tester.enterText(find.byKey(const Key('t')), '5:31');
    await tester.pump();
    expect(value, 331);
    await tester.enterText(find.byKey(const Key('t')), '5:61');
    await tester.pump();
    expect(value, isNull);
    expect(find.text('Use m:ss or h:mm:ss'), findsOneWidget);
  });

  testWidgets('GymLogo falls back to initials without a URL', (tester) async {
    await pumpScreen(tester, const Scaffold(body: GymLogo(name: 'Sfax Hybrid Box')), FakeBackend());
    expect(find.text('SH'), findsOneWidget);
  });

  testWidgets('RankRow highlights me and exposes a semantic label', (tester) async {
    await pumpScreen(tester, const Scaffold(body: RankRow(rank: 2, name: 'Nour', value: '5:30', highlight: true)), FakeBackend());
    expect(find.text('#2'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('Rank 2.*Nour.*5:30')), findsOneWidget);
  });
}
```
Run: `flutter test test/widgets/kit_test.dart` → FAIL.

- [ ] **Step 3: Implémentation**

`format.dart` :
```dart
/// "4:58" → 298, "1:28:00" → 5280. Null when empty, malformed, minutes/seconds ≥ 60 or zero.
int? parseDuration(String input) {
  final parts = input.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.any((p) => p.isEmpty || int.tryParse(p) == null)) return null;
  final n = parts.map(int.parse).toList();
  if (n.skip(1).any((v) => v >= 60) || n.any((v) => v < 0)) return null;
  final total = n.length == 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1];
  return total > 0 ? total : null;
}
```

`time_field.dart`
```dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/l10n.dart';
import '../utils/format.dart';

/// Duration input in m:ss or h:mm:ss. Reports seconds, or null while the text is invalid.
class TimeField extends StatefulWidget {
  const TimeField({super.key, required this.onChanged, this.label, this.initialSeconds});
  final ValueChanged<int?> onChanged;
  final String? label;
  final int? initialSeconds;

  @override
  State<TimeField> createState() => _TimeFieldState();
}

class _TimeFieldState extends State<TimeField> {
  late final _c = TextEditingController(text: widget.initialSeconds == null ? '' : formatDuration(widget.initialSeconds!));
  bool _invalid = false;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _c,
      keyboardType: TextInputType.datetime,
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9:]')), LengthLimitingTextInputFormatter(8)],
      style: const TextStyle(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: 22, fontFeatures: [FontFeature.tabularFigures()]),
      decoration: InputDecoration(labelText: widget.label, hintText: '0:00', errorText: _invalid ? context.l10n.timeFormatError : null, prefixIcon: const Icon(Icons.timer_outlined)),
      onChanged: (text) {
        final v = parseDuration(text);
        setState(() => _invalid = text.trim().isNotEmpty && v == null);
        widget.onChanged(v);
      },
    );
  }
}
```
Le `TextField` interne n'a pas de clé : `find.byKey(const Key('t'))` trouve le `TimeField` et `enterText` descend dans son sous-arbre. Clé l10n : `timeFormatError` = en « Use m:ss or h:mm:ss », fr « Format m:ss ou h:mm:ss », ar « استخدم الصيغة د:ثث أو س:دد:ثث ».

`gym_logo.dart`
```dart
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

/// Gym logo (rounded square). Without a URL, initials on a colour derived from the name.
class GymLogo extends StatelessWidget {
  const GymLogo({super.key, required this.name, this.url, this.size = 56});
  final String name;
  final String? url;
  final double size;

  static const _palette = [Color(0xFFC6F432), Color(0xFF3DA9FC), Color(0xFFFF8A3D), Color(0xFFF15BB5), Color(0xFF06D6A0), Color(0xFFFFD166), Color(0xFF9B5DE5)];

  String get _initials => name.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2).map((w) => w.characters.first.toUpperCase()).join();

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(size * 0.24);
    final bg = _palette[name.codeUnits.fold<int>(0, (a, b) => a + b) % _palette.length];
    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: bg, borderRadius: radius),
      child: Text(_initials, style: TextStyle(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: size * 0.4, color: const Color(0xFF0E0F12))),
    );
    return Semantics(
      label: name,
      image: true,
      child: url == null
          ? fallback
          : ClipRRect(borderRadius: radius, child: CachedNetworkImage(imageUrl: url!, width: size, height: size, fit: BoxFit.cover, placeholder: (_, _) => fallback, errorWidget: (_, _, _) => fallback)),
    );
  }
}
```

`sport_chip.dart`
```dart
import 'package:flutter/material.dart';

import '../utils/format.dart';

IconData sportIcon(String code) => switch (code) {
      'CROSSFIT' => Icons.sports_gymnastics_rounded,
      'HYROX' => Icons.directions_run_rounded,
      'RUNNING' => Icons.directions_run_rounded,
      'CYCLING' => Icons.directions_bike_rounded,
      'SWIMMING' => Icons.pool_rounded,
      'WALKING' => Icons.directions_walk_rounded,
      'FUNCTIONAL' => Icons.bolt_rounded,
      _ => Icons.fitness_center_rounded,
    };

class SportChip extends StatelessWidget {
  const SportChip({super.key, required this.code, required this.name, this.selected = false, this.onTap});
  final String code;
  final Object? name;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final label = Text(localized(name, Localizations.localeOf(context).languageCode));
    final avatar = Icon(sportIcon(code), size: 16);
    return onTap == null
        ? Chip(avatar: avatar, label: label, visualDensity: VisualDensity.compact)
        : FilterChip(avatar: avatar, label: label, selected: selected, onSelected: (_) => onTap!(), showCheckmark: false);
  }
}
```

`section_header.dart`, `skeleton.dart`, `countdown_text.dart`, `rank_row.dart`, `avatar_badge.dart` :
```dart
// section_header.dart
import 'package:flutter/material.dart';

class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.actionLabel, this.onAction});
  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 20, 4, 8),
      child: Row(children: [
        Expanded(child: Semantics(header: true, child: Text(title.toUpperCase(), style: t.textTheme.labelLarge?.copyWith(letterSpacing: 1.4, color: t.colorScheme.outline)))),
        if (actionLabel != null) TextButton(onPressed: onAction, child: Text(actionLabel!)),
      ]),
    );
  }
}
```
```dart
// skeleton.dart
import 'package:flutter/material.dart';

/// Pulsing placeholders while a list loads (static when animations are disabled).
class SkeletonList extends StatefulWidget {
  const SkeletonList({super.key, this.count = 6, this.height = 76});
  final int count;
  final double height;

  @override
  State<SkeletonList> createState() => _SkeletonListState();
}

class _SkeletonListState extends State<SkeletonList> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;
    final still = MediaQuery.of(context).disableAnimations;
    return Semantics(
      label: MaterialLocalizations.of(context).searchFieldLabel,
      child: ListView.separated(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        itemCount: widget.count,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, _) => AnimatedBuilder(
          animation: _c,
          builder: (_, _) => Container(height: widget.height, decoration: BoxDecoration(color: base.withValues(alpha: still ? 0.7 : 0.45 + 0.35 * _c.value), borderRadius: BorderRadius.circular(18))),
        ),
      ),
    );
  }
}
```
Dans les tests, `SkeletonList` anime en continu : les écrans doivent l'afficher seulement pendant le chargement (après `pumpAndSettle` il a disparu). Ne pas l'utiliser dans un état qui reste affiché pendant un test.
```dart
// countdown_text.dart
import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/l10n.dart';

/// "2d 4h" / "3h 12m" / "8m" left; refreshes every 30 s.
class CountdownText extends StatefulWidget {
  const CountdownText({super.key, required this.endsAt, this.style});
  final DateTime endsAt;
  final TextStyle? style;

  @override
  State<CountdownText> createState() => _CountdownTextState();
}

class _CountdownTextState extends State<CountdownText> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final left = widget.endsAt.difference(DateTime.now());
    final text = left.isNegative
        ? l.wodEnded
        : left.inDays > 0
            ? l.timeLeftDays(left.inDays, left.inHours % 24)
            : left.inHours > 0
                ? l.timeLeftHours(left.inHours, left.inMinutes % 60)
                : l.timeLeftMinutes(left.inMinutes.clamp(1, 59));
    return Text(text, style: widget.style);
  }
}
```
Clés : `wodEnded` (en « Ended », fr « Terminé », ar « انتهى »), `timeLeftDays(days, hours)` (en « {days}d {hours}h left », fr « encore {days} j {hours} h », ar « متبقٍ {days} ي {hours} س »), `timeLeftHours(hours, minutes)` (« {hours}h {minutes}m left » / « encore {hours} h {minutes} min » / « متبقٍ {hours} س {minutes} د »), `timeLeftMinutes(minutes)` (« {minutes}m left » / « encore {minutes} min » / « متبقٍ {minutes} د »). Paramètres `int` déclarés dans `app_en.arb` (`"placeholders": {"days": {"type": "int"}, ...}`).
```dart
// rank_row.dart
import 'package:flutter/material.dart';

class RankRow extends StatelessWidget {
  const RankRow({super.key, required this.rank, required this.name, required this.value, this.highlight = false, this.leading, this.subtitle, this.onTap, this.onLongPress});
  final int rank;
  final String name;
  final String value;
  final bool highlight;
  final Widget? leading;
  final String? subtitle;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final medal = switch (rank) { 1 => const Color(0xFFFFD166), 2 => const Color(0xFFC0C4CC), 3 => const Color(0xFFE09F6B), _ => t.colorScheme.outline };
    return Semantics(
      label: 'Rank $rank, $name, $value',
      excludeSemantics: true,
      button: onTap != null,
      child: Material(
        color: highlight ? t.colorScheme.primary.withValues(alpha: 0.14) : Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          onLongPress: onLongPress,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 56),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(children: [
                SizedBox(width: 44, child: Text('#$rank', style: TextStyle(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: 20, color: medal))),
                if (leading != null) ...[leading!, const SizedBox(width: 12)],
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                    Text(name, style: t.textTheme.titleMedium?.copyWith(fontWeight: highlight ? FontWeight.w800 : FontWeight.w600), overflow: TextOverflow.ellipsis),
                    if (subtitle != null) Text(subtitle!, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline)),
                  ]),
                ),
                Text(value, style: const TextStyle(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: 22, fontFeatures: [FontFeature.tabularFigures()])),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
```
```dart
// avatar_badge.dart
import 'package:flutter/material.dart';

Color divisionColor(String? code) => switch (code) {
      'SILVER' => const Color(0xFFC0C4CC),
      'GOLD' => const Color(0xFFFFD166),
      'PLATINUM' => const Color(0xFF7FDBDA),
      'DIAMOND' => const Color(0xFF3DA9FC),
      'ELITE' => const Color(0xFFC6F432),
      _ => const Color(0xFFE09F6B), // BRONZE / none
    };

/// Initials avatar ringed with the division colour.
class AvatarBadge extends StatelessWidget {
  const AvatarBadge({super.key, required this.name, this.division, this.size = 44});
  final String name;
  final String? division;
  final double size;

  @override
  Widget build(BuildContext context) {
    final initials = name.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2).map((w) => w.characters.first.toUpperCase()).join();
    return Container(
      width: size,
      height: size,
      padding: const EdgeInsets.all(2.5),
      decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: divisionColor(division), width: 2.5)),
      child: CircleAvatar(backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest, child: Text(initials, style: TextStyle(fontWeight: FontWeight.w800, fontSize: size * 0.34))),
    );
  }
}
```
(Vérifier les codes de division réels dans `catalog.json` → `divisions` et aligner les `case`.)

`api_client.dart` :
```dart
  Future<T> put<T>(String path, {Object? data}) => _call(() => dio.put<T>(path, data: data));

  /// Multipart upload (field "file" by default).
  Future<T> upload<T>(String path, {required List<int> bytes, required String filename, String field = 'file'}) =>
      _call(() => dio.put<T>(path, data: FormData.fromMap({field: MultipartFile.fromBytes(bytes, filename: filename)})));
```

`app_theme.dart` : dans `_build`, `ThemeData(useMaterial3: true, colorScheme: scheme, brightness: brightness, fontFamily: 'Inter')` ; `displayLarge`, `displaySmall`, `headlineMedium` : `fontFamily: 'BarlowCondensed'` ; ajouter `chipTheme: ChipThemeData(shape: StadiumBorder(side: BorderSide(color: scheme.outlineVariant)), labelStyle: base.textTheme.labelLarge)`, `appBarTheme: AppBarTheme(backgroundColor: dark ? _graphite : Colors.white, surfaceTintColor: Colors.transparent, centerTitle: false, titleTextStyle: base.textTheme.titleLarge?.copyWith(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: 26, color: scheme.onSurface))`, `pageTransitionsTheme: const PageTransitionsTheme(builders: {TargetPlatform.android: FadeForwardsPageTransitionsBuilder(), TargetPlatform.iOS: CupertinoPageTransitionsBuilder()})` (si `FadeForwardsPageTransitionsBuilder` n'existe pas dans cette version de Flutter, utiliser `ZoomPageTransitionsBuilder`). Ajouter :
```dart
  static TextStyle display(BuildContext context, {double size = 40}) =>
      TextStyle(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: size, height: 1, letterSpacing: -0.5, fontFeatures: const [FontFeature.tabularFigures()]);
```

- [ ] **Step 4: Tests**

Run: `flutter gen-l10n && flutter test && flutter analyze` → tous les tests (anciens + kit) PASS, 0 issue.

- [ ] **Step 5: Commit**

```bash
git add -A apps/mobile && git commit -m "feat(mobile): embedded fonts, refreshed theme and shared UI kit"
```

---

### Task 11: Liste des salles

**Files:**
- Create: `lib/features/gyms/data/gyms_repository.dart`, `lib/features/gyms/presentation/gyms_screen.dart`, `test/widgets/gyms_test.dart`
- Modify: `lib/router.dart`, arb ×3

**Interfaces:**
- Consumes: `GET /gyms?q&sport&governorateId&sort&cursor&limit`, `GET /ref/sports`, `GET /ref/governorates`.
- Produces: `GymsRepository` : `list({String? q, String? sport, String? governorateId, String sort = 'name', String? cursor, int limit = 20})`, `get(String id)`, `join(String id)`, `leave()`, `uploadLogo(String id, List<int> bytes, String filename)`, `members(String id, {String? cursor})`, `requests(String id)`, `decide(String id, String userId, String action)`, `setCoach(String id, String userId, bool coach)` ; `gymsRepositoryProvider`, `gymProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>` ; route `/gyms` → `GymsScreen`.

- [ ] **Step 1: Test (échoue)**

`test/widgets/gyms_test.dart`
```dart
import 'package:fitness_league/features/gyms/presentation/gyms_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> gym(String id, String name, List<String> sports, int members, {String? logo}) => {
      'id': id, 'name': name, 'slug': id, 'verified': true, 'logoUrl': logo, 'membersCount': members, 'level': 3,
      'city': {'fr': 'Tunis', 'en': 'Tunis', 'ar': 'تونس'},
      'governorate': {'id': 'g1', 'code': 'TN-11', 'name': {'fr': 'Tunis', 'en': 'Tunis', 'ar': 'تونس'}},
      'sports': [for (final s in sports) {'code': s, 'name': {'fr': s, 'en': s, 'ar': s}, 'icon': null}],
    };

void main() {
  FakeBackend backend() => FakeBackend()
    ..on('GET', '/ref/sports', (_) => (200, [
          {'id': 's1', 'code': 'CROSSFIT', 'name': {'fr': 'CrossFit', 'en': 'CrossFit', 'ar': 'كروسفيت'}},
          {'id': 's2', 'code': 'HYROX', 'name': {'fr': 'Hyrox', 'en': 'Hyrox', 'ar': 'هايروكس'}},
        ]))
    ..on('GET', '/ref/governorates', (_) => (200, [{'id': 'g1', 'code': 'TN-11', 'name': {'fr': 'Tunis', 'en': 'Tunis', 'ar': 'تونس'}}]))
    ..on('GET', '/gyms', (req) {
      final q = req.queryParameters;
      if (q['q'] == 'zzz') return (200, {'data': [], 'page': {'nextCursor': null, 'hasMore': false}});
      if (q['sport'] == 'HYROX') return (200, {'data': [gym('b', 'Bodynade', ['CROSSFIT', 'HYROX'], 42)], 'page': {'nextCursor': null, 'hasMore': false}});
      return (200, {'data': [gym('b', 'Bodynade', ['CROSSFIT', 'HYROX'], 42), gym('c', 'Carthage Strength Lab', ['BODYBUILDING'], 18)], 'page': {'nextCursor': null, 'hasMore': false}});
    });

  testWidgets('lists gyms with logo fallback, sports and member count', (tester) async {
    await pumpScreen(tester, const GymsScreen(), backend());
    expect(find.text('Bodynade'), findsOneWidget);
    expect(find.text('BO'), findsOneWidget); // initials fallback
    expect(find.text('42 members'), findsOneWidget);
  });

  testWidgets('filters by sport chip and searches by name', (tester) async {
    final b = backend();
    await pumpScreen(tester, const GymsScreen(), b);
    await tester.tap(find.widgetWithText(FilterChip, 'Hyrox'));
    await tester.pumpAndSettle();
    expect(b.calls('GET', '/gyms').last.queryParameters['sport'], 'HYROX');
    expect(find.text('Carthage Strength Lab'), findsNothing);

    await tester.enterText(find.byKey(const Key('gym-search')), 'zzz');
    await tester.pump(const Duration(milliseconds: 400)); // debounce
    await tester.pumpAndSettle();
    expect(find.text('No gym found'), findsOneWidget);
  });

  testWidgets('lays out right-to-left in Arabic', (tester) async {
    await pumpScreen(tester, const GymsScreen(), backend(), locale: const Locale('ar'));
    expect(Directionality.of(tester.element(find.text('Bodynade'))), TextDirection.rtl);
  });
}
```
Run → FAIL.

- [ ] **Step 2: Repository**

`lib/features/gyms/data/gyms_repository.dart`
```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';

class GymsRepository {
  GymsRepository(this.api);
  final ApiClient api;

  Future<Map<String, dynamic>> list({String? q, String? sport, String? governorateId, String sort = 'name', String? cursor, int limit = 20}) =>
      api.get<Map<String, dynamic>>('/gyms', query: {'limit': limit, 'sort': sort, 'q': ?(q == null || q.isEmpty ? null : q), 'sport': ?sport, 'governorateId': ?governorateId, 'cursor': ?cursor});
  Future<Map<String, dynamic>> get(String id) => api.get<Map<String, dynamic>>('/gyms/$id');
  Future<void> join(String id) => api.post<dynamic>('/gyms/$id/membership');
  Future<void> leave() => api.delete<dynamic>('/gyms/me/membership');
  Future<Map<String, dynamic>> uploadLogo(String id, List<int> bytes, String filename) => api.upload<Map<String, dynamic>>('/gyms/$id/logo', bytes: bytes, filename: filename);
  Future<Map<String, dynamic>> members(String id, {String? cursor}) => api.get<Map<String, dynamic>>('/gyms/$id/members', query: {'limit': 50, 'cursor': ?cursor});
  Future<List<Map<String, dynamic>>> requests(String id) async => (await api.get<List<dynamic>>('/gyms/$id/membership-requests')).cast<Map<String, dynamic>>();
  Future<void> decide(String id, String userId, String action) => api.post<dynamic>('/gyms/$id/members/$userId/$action');
  Future<void> setCoach(String id, String userId, bool coach) => coach ? api.post<dynamic>('/gyms/$id/members/$userId/coach') : api.delete<dynamic>('/gyms/$id/members/$userId/coach');
}

final gymsRepositoryProvider = Provider<GymsRepository>((ref) => GymsRepository(ref.watch(apiClientProvider)));
final gymProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, id) => ref.watch(gymsRepositoryProvider).get(id));
```

- [ ] **Step 3: Écran**

`lib/features/gyms/presentation/gyms_screen.dart`
```dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/gym_logo.dart';
import '../../../core/widgets/skeleton.dart';
import '../../../core/widgets/sport_chip.dart';
import '../../onboarding/data/reference_repository.dart';
import '../data/gyms_repository.dart';

/// Gym directory: search, sport and governorate filters, infinite paging (spec §6).
class GymsScreen extends ConsumerStatefulWidget {
  const GymsScreen({super.key});

  @override
  ConsumerState<GymsScreen> createState() => _GymsScreenState();
}

class _GymsScreenState extends ConsumerState<GymsScreen> {
  final _items = <Map<String, dynamic>>[];
  final _scroll = ScrollController();
  String _q = '';
  String? _sport;
  String? _gov;
  String? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  Object? _error;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) _load();
    });
    _reload();
  }

  @override
  void dispose() {
    _scroll.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _reload() {
    setState(() {
      _items.clear();
      _cursor = null;
      _hasMore = true;
      _error = null;
    });
    _load();
  }

  Future<void> _load() async {
    if (_loading || !_hasMore) return;
    setState(() => _loading = true);
    try {
      final page = await ref.read(gymsRepositoryProvider).list(q: _q, sport: _sport, governorateId: _gov, cursor: _cursor);
      final meta = page['page'] as Map<String, dynamic>;
      setState(() {
        _items.addAll((page['data'] as List).cast<Map<String, dynamic>>());
        _cursor = meta['nextCursor'] as String?;
        _hasMore = meta['hasMore'] == true;
      });
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final sports = ref.watch(sportsProvider).valueOrNull ?? const [];
    final govs = ref.watch(governoratesProvider).valueOrNull ?? const [];
    final locale = Localizations.localeOf(context).languageCode;
    return Scaffold(
      appBar: AppBar(title: Text(l.gymsTitle)),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextField(
            key: const Key('gym-search'),
            decoration: InputDecoration(prefixIcon: const Icon(Icons.search_rounded), hintText: l.gymsSearchHint),
            textInputAction: TextInputAction.search,
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), () {
                _q = v.trim();
                _reload();
              });
            },
          ),
        ),
        SizedBox(
          height: 48,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
            for (final s in sports.where((s) => ['CROSSFIT', 'HYROX', 'BODYBUILDING', 'POWERLIFTING', 'FUNCTIONAL', 'RUNNING'].contains(s['code'])))
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: SportChip(code: s['code'] as String, name: s['name'], selected: _sport == s['code'], onTap: () {
                  _sport = _sport == s['code'] ? null : s['code'] as String;
                  _reload();
                }),
              ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: PopupMenuButton<String?>(
                tooltip: l.gymsGovernorate,
                onSelected: (id) {
                  _gov = id;
                  _reload();
                },
                itemBuilder: (_) => [
                  PopupMenuItem(value: null, child: Text(l.gymsAllGovernorates)),
                  for (final g in govs) PopupMenuItem(value: g['id'] as String, child: Text(localized(g['name'], locale))),
                ],
                child: Chip(avatar: const Icon(Icons.place_outlined, size: 16), label: Text(_gov == null ? l.gymsGovernorate : localized(govs.firstWhere((g) => g['id'] == _gov)['name'], locale))),
              ),
            ),
          ]),
        ),
        Expanded(child: _body(l)),
      ]),
    );
  }

  Widget _body(AppLocalizations l) {
    if (_items.isEmpty && _loading) return const SkeletonList();
    if (_items.isEmpty && _error != null) return ErrorView(error: _error!, onRetry: _reload);
    if (_items.isEmpty) return EmptyState(icon: Icons.storefront_outlined, message: l.gymsEmpty);
    return RefreshIndicator(
      onRefresh: () async => _reload(),
      child: ListView.separated(
        controller: _scroll,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        itemCount: _items.length + (_hasMore ? 1 : 0),
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, i) => i == _items.length ? const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())) : GymCard(gym: _items[i]),
      ),
    );
  }
}

class GymCard extends StatelessWidget {
  const GymCard({super.key, required this.gym});
  final Map<String, dynamic> gym;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final sports = (gym['sports'] as List? ?? const []).cast<Map<String, dynamic>>();
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/gyms/${gym['id']}'),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            GymLogo(name: gym['name'] as String, url: gym['logoUrl'] as String?),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Flexible(child: Text(gym['name'] as String, style: t.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800), overflow: TextOverflow.ellipsis)),
                  if (gym['verified'] == true) Padding(padding: const EdgeInsetsDirectional.only(start: 6), child: Icon(Icons.verified_rounded, size: 18, color: t.colorScheme.primary, semanticLabel: l.gymVerified)),
                ]),
                Text(localized(gym['city'], locale), style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline)),
                const SizedBox(height: 6),
                Wrap(spacing: 6, runSpacing: 4, children: [for (final s in sports.take(3)) SportChip(code: s['code'] as String, name: s['name'])]),
              ]),
            ),
            Column(children: [
              Text('${gym['membersCount']}', style: const TextStyle(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: 22)),
              Text(l.gymMembersShort, style: t.textTheme.labelSmall),
            ]),
          ]),
        ),
      ),
    );
  }
}
```
Le test attend le texte « 42 members » : remplacer la colonne de droite par un seul `Text(l.gymMembersCount(gym['membersCount'] as int))` en `labelLarge` gras (et supprimer `gymMembersShort`).

Clés l10n : `gymsTitle` (Gyms / Salles / الصالات), `gymsSearchHint` (Search a gym / Rechercher une salle / ابحث عن صالة), `gymsGovernorate` (Governorate / Gouvernorat / الولاية), `gymsAllGovernorates` (All governorates / Tous les gouvernorats / كل الولايات), `gymsEmpty` (No gym found / Aucune salle trouvée / لم يتم العثور على صالة), `gymVerified` (Verified gym / Salle vérifiée / صالة موثقة), `gymMembersCount(count)` (plural ICU : en `{count, plural, =1{1 member} other{{count} members}}`, fr `{count, plural, =1{1 membre} other{{count} membres}}`, ar `{count, plural, =1{عضو واحد} other{{count} عضو}}`).

Routeur : `GoRoute(path: '/gyms', builder: (_, _) => const GymsScreen())` au niveau racine (à côté de `/progress`).

- [ ] **Step 4: Tests**

Run: `flutter gen-l10n && flutter test test/widgets/gyms_test.dart && flutter analyze` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/mobile && git commit -m "feat(mobile): gym directory with search, sport and governorate filters"
```

---

### Task 12: Profil de salle, gestion des membres, logo

**Files:**
- Create: `lib/features/gyms/presentation/gym_profile_screen.dart`, `lib/features/gyms/presentation/gym_members_screen.dart`, `test/widgets/gym_profile_test.dart`
- Modify: `lib/router.dart`, arb ×3

**Interfaces:**
- Consumes: `GymsRepository`, `gymProvider` (Tâche 11), `GymLogo`, `SportChip`, `SectionHeader`, `RankRow`, `AvatarBadge` (Tâche 10), `gymWodsProvider` (défini en Tâche 13 — dans cette tâche, la section WODs appelle `GymWodsSection(gymId: ..., canCreate: ...)` ; créer ce widget en Tâche 13 et, en attendant, ne pas l'insérer : l'ajouter en Tâche 13 Step 3).
- Produces: routes `/gyms/:id` → `GymProfileScreen(id)`, `/gyms/:id/members` → `GymMembersScreen(id)`.

- [ ] **Step 1: Test (échoue)**

`test/widgets/gym_profile_test.dart`
```dart
import 'package:fitness_league/features/gyms/presentation/gym_profile_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> profile({String status = 'NONE', String? role, bool canManage = false}) => {
      'id': 'b', 'name': 'Bodynade', 'slug': 'bodynade', 'verified': true, 'logoUrl': null, 'membersCount': 42, 'level': 4, 'rank': 3,
      'city': {'en': 'Tunis'}, 'governorate': {'id': 'g1', 'code': 'TN-11', 'name': {'en': 'Tunis'}},
      'sports': [{'code': 'CROSSFIT', 'name': {'en': 'CrossFit'}}, {'code': 'HYROX', 'name': {'en': 'Hyrox'}}],
      'addressLine': 'Les Berges du Lac', 'socialLinks': {'instagram': 'https://instagram.com/bodynade.demo'},
      'topAthletes': [{'id': 'u1', 'username': 'yassine', 'fullName': 'Yassine T.', 'lp': 1180, 'level': 9}],
      'myMembership': {'status': status, 'role': role}, 'canManage': canManage, 'warRecord': null,
    };

void main() {
  testWidgets('shows header, stats, sports, address and top athletes; joins', (tester) async {
    var status = 'NONE';
    final b = FakeBackend()
      ..on('GET', '/gyms/b', (_) => (200, profile(status: status)))
      ..on('POST', '/gyms/b/membership', (_) {
        status = 'PENDING';
        return (201, {'gymId': 'b', 'status': 'PENDING'});
      });
    await pumpScreen(tester, const GymProfileScreen(id: 'b'), b);
    expect(find.text('Bodynade'), findsWidgets);
    expect(find.text('#3'), findsOneWidget);
    expect(find.text('CrossFit'), findsOneWidget);
    expect(find.text('Les Berges du Lac'), findsOneWidget);
    expect(find.text('Yassine T.'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Join'));
    await tester.pumpAndSettle();
    expect(find.text('Request sent'), findsOneWidget);
  });

  testWidgets('members see Leave; gym admins see the logo and members actions', (tester) async {
    await pumpScreen(tester, const GymProfileScreen(id: 'b'), FakeBackend()..on('GET', '/gyms/b', (_) => (200, profile(status: 'APPROVED', role: 'COACH', canManage: true))));
    expect(find.text('Leave'), findsOneWidget);
    expect(find.byTooltip('Change logo'), findsOneWidget);
    expect(find.text('Manage members'), findsOneWidget);
  });
}
```
Run → FAIL.

- [ ] **Step 2: Écran de profil**

`gym_profile_screen.dart` : `ConsumerWidget` qui regarde `gymProvider(id)` et construit un `CustomScrollView` :
1. `SliverAppBar(expandedHeight: 220, pinned: true)` avec `flexibleSpace: FlexibleSpaceBar(background: _Banner(gym))` ; `_Banner` = `Container` avec `LinearGradient` (couleur primaire du thème → `scaffoldBackgroundColor`), `GymLogo(size: 96)` centré en bas, nom en `AppTheme.display(context, size: 32)`, ville + icône vérifiée. Si `canManage`, `actions: [IconButton(tooltip: l.gymChangeLogo, icon: Icon(Icons.photo_camera_outlined), onPressed: () => _pickLogo(context, ref))]`.
2. Ligne de 3 `StatCard` (existant dans `common.dart`) : membres, niveau, rang (`'#${gym['rank']}'` ou `'—'`).
3. `SectionHeader(title: l.gymSports)` + `Wrap` de `SportChip`.
4. `SectionHeader(title: l.gymInfo)` + `ListTile(leading: Icon(Icons.place_outlined), title: Text(addressLine))` si présent, et un `ListTile` par réseau social (`Icons.link_rounded`, clé capitalisée, `onTap` : `launchUrl` n'est pas une dépendance → afficher l'URL en `subtitle` et copier dans le presse-papiers au tap avec `Clipboard.setData` + `SnackBar(l.linkCopied)`).
5. (Tâche 13) section WODs.
6. `SectionHeader(title: l.gymTopAthletes)` + `RankRow` pour chaque `topAthletes` (`value: '${lp} LP'`, `leading: AvatarBadge(name: fullName ?? username)`, `onTap: () => context.push('/u/${username}')`).
7. Si `canManage` : `OutlinedButton.icon(icon: Icon(Icons.group_outlined), label: Text(l.gymManageMembers), onPressed: () => context.push('/gyms/$id/members'))`.
8. En bas (`bottomNavigationBar` du `Scaffold`, `SafeArea` + padding 16), bouton selon `myMembership.status` :
```dart
    final status = (gym['myMembership'] as Map)['status'] as String;
    final button = switch (status) {
      'APPROVED' => OutlinedButton(onPressed: () => _leave(context, ref), child: Text(l.gymLeave)),
      'PENDING' => FilledButton(onPressed: null, child: Text(l.gymRequestSent)),
      _ => FilledButton(onPressed: () => _join(ref), child: Text(l.gymJoin)),
    };
```
`_join` : `await repo.join(id); ref.invalidate(gymProvider(id));` avec `try/catch` → `SnackBar(errorMessage(context, e))` (fonction existante dans `error_text.dart` ; l'erreur 409 « quitte ta salle d'abord » s'affiche ainsi). `_leave` : `showDialog` de confirmation (`l.gymLeaveConfirm`), puis `repo.leave()`, `ref.invalidate(gymProvider(id))`, `ref.invalidate(meProvider)`.
`_pickLogo` :
```dart
    final file = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1024, maxHeight: 1024, imageQuality: 90);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.length > 2 * 1024 * 1024) { messenger.showSnackBar(SnackBar(content: Text(l.logoTooLarge))); return; }
    await ref.read(gymsRepositoryProvider).uploadLogo(id, bytes, file.name);
    ref.invalidate(gymProvider(id));
```
Chargement : `SkeletonList(count: 4, height: 120)` ; erreur : `ErrorView`.

- [ ] **Step 3: Écran de gestion des membres**

`gym_members_screen.dart` : `DefaultTabController(length: 2)` avec onglets « Demandes » (`repo.requests(id)` → liste `ListTile` + boutons `IconButton(Icons.check_rounded, tooltip: l.approve)` / `IconButton(Icons.close_rounded, tooltip: l.reject)` qui appellent `repo.decide(id, userId, 'approve'|'reject')` puis rechargent) et « Membres » (`repo.members(id)` → `ListTile(leading: AvatarBadge, title: fullName, subtitle: role == 'COACH' ? l.coach : null, trailing: PopupMenuButton` avec `l.makeCoach` / `l.removeCoach` → `repo.setCoach`, et `l.removeMember` → `repo.decide(id, userId, 'remove')` après confirmation)).

Clés l10n : `gymChangeLogo` (Change logo / Changer le logo / تغيير الشعار), `gymSports` (Sports / Sports / الرياضات), `gymInfo` (Info / Infos / معلومات), `linkCopied` (Link copied / Lien copié / تم نسخ الرابط), `gymTopAthletes` (Top athletes / Meilleurs athlètes / أفضل الرياضيين), `gymManageMembers` (Manage members / Gérer les membres / إدارة الأعضاء), `gymJoin` (Join / Rejoindre / انضم), `gymRequestSent` (Request sent / Demande envoyée / تم إرسال الطلب), `gymLeave` (Leave / Quitter / غادر), `gymLeaveConfirm` (Leave this gym? / Quitter cette salle ? / مغادرة هذه الصالة؟), `logoTooLarge` (Image must be 2 MB or less / L'image doit faire 2 Mo max / يجب ألا تتجاوز الصورة 2 ميغابايت), `gymRank` (Gym rank / Rang / الترتيب), `gymLevel` (Level / Niveau / المستوى), `gymMembersLabel` (Members / Membres / الأعضاء), `requestsTab` (Requests / Demandes / الطلبات), `membersTab` (Members / Membres / الأعضاء), `approve` (Approve / Accepter / قبول), `reject` (Decline / Refuser / رفض), `coach` (Coach / Coach / مدرب), `makeCoach` (Make coach / Nommer coach / تعيين مدربًا), `removeCoach` (Remove coach role / Retirer le rôle coach / إزالة دور المدرب), `removeMember` (Remove from gym / Retirer de la salle / إزالة من الصالة).

Routeur : `GoRoute(path: '/gyms/:id', builder: (_, s) => GymProfileScreen(id: s.pathParameters['id']!))` et `GoRoute(path: '/gyms/:id/members', builder: ...)`.

- [ ] **Step 4: Tests**

Run: `flutter gen-l10n && flutter test test/widgets/gym_profile_test.dart test/widgets/gyms_test.dart && flutter analyze` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/mobile && git commit -m "feat(mobile): gym profile, membership actions, logo upload and member management"
```

---

### Task 13: WODs de salle (liste, détail, score, création, invalidation)

**Files:**
- Create: `lib/features/gym_wods/data/gym_wods_repository.dart`, `lib/features/gym_wods/presentation/gym_wods_section.dart`, `lib/features/gym_wods/presentation/wod_screen.dart`, `lib/features/gym_wods/presentation/create_wod_screen.dart`, `lib/features/gym_wods/presentation/wod_score_sheet.dart`, `test/widgets/gym_wods_test.dart`
- Modify: `lib/features/gyms/presentation/gym_profile_screen.dart`, `lib/router.dart`, arb ×3

**Interfaces:**
- Consumes: endpoints de la Tâche 7–8 ; `TimeField`, `CountdownText`, `RankRow`.
- Produces: `GymWodsRepository` : `list(gymId, {String when = 'active'})`, `get(gymId, wodId)`, `create(gymId, Map body)`, `submit(gymId, wodId, Map body)`, `board(gymId, wodId, {String division = 'RX', String? cursor})`, `boardMe(gymId, wodId, String division)`, `invalidate(gymId, wodId, scoreId, String reason)` ; `wodProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, (String, String)>` ; `String formatWodScore(String scoreType, Map score)` ; routes `/gyms/:id/wods/new`, `/gyms/:id/wods/:wodId`.

- [ ] **Step 1: Tests (échouent)**

`test/widgets/gym_wods_test.dart`
```dart
import 'package:fitness_league/features/gym_wods/presentation/wod_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> wod({Map<String, dynamic>? myScore, String scoreType = 'FOR_TIME'}) => {
      'id': 'w1', 'gymId': 'b', 'title': 'Bodynade Burner', 'description': '21-15-9 thrusters, burpees', 'scoreType': scoreType, 'timeCapS': 900,
      'startsAt': DateTime.now().subtract(const Duration(hours: 2)).toIso8601String(), 'endsAt': DateTime.now().add(const Duration(days: 2)).toIso8601String(),
      'status': 'PUBLISHED', 'sport': null, 'createdBy': {'id': 'c', 'username': 'ahmed'}, 'isOpen': true, 'myScore': myScore,
    };

Map<String, dynamic> row(int rank, String id, String name, num value) => {'rank': rank, 'scoreId': 's$id', 'athlete': {'id': id, 'username': id, 'fullName': name}, 'value': value, 'rounds': null, 'reps': null, 'submittedAt': '2026-09-27T10:00:00Z'};

FakeBackend backend({bool coach = false}) {
  Map<String, dynamic>? mine;
  return FakeBackend()
    ..on('GET', '/gyms/b', (_) => (200, {'myMembership': {'status': 'APPROVED', 'role': coach ? 'COACH' : 'MEMBER'}, 'canManage': false}))
    ..on('GET', '/gyms/b/wods/w1', (_) => (200, wod(myScore: mine)))
    ..on('GET', '/gyms/b/wods/w1/leaderboard', (req) => (200, {
          'data': req.queryParameters['division'] == 'SCALED' ? [row(1, 'n', 'Nour', 530)] : [row(1, 'y', 'Yassine', 452), row(2, 'me', 'Ahmed', 480)],
          'page': {'nextCursor': null, 'hasMore': false},
        }))
    ..on('GET', '/gyms/b/wods/w1/leaderboard/me', (_) => (200, {}))
    ..on('PUT', '/gyms/b/wods/w1/score', (req) {
      mine = {'id': 's1', 'division': 'RX', 'value': 471, 'rounds': null, 'reps': null, 'status': 'VALID', 'invalidationReason': null};
      return (200, wod(myScore: mine));
    })
    ..on('POST', '/gyms/b/wods/w1/scores/sy/invalidate', (_) => (200, {'id': 'sy', 'status': 'INVALIDATED'}));
}

void main() {
  testWidgets('shows the WOD, Rx/Scaled boards and submits a time', (tester) async {
    final b = backend();
    await pumpScreen(tester, const WodScreen(gymId: 'b', wodId: 'w1', myId: 'me'), b);
    expect(find.text('Bodynade Burner'), findsOneWidget);
    expect(find.text('7:32'), findsOneWidget); // 452 s
    await tester.tap(find.text('Scaled'));
    await tester.pumpAndSettle();
    expect(find.text('Nour'), findsOneWidget);

    await tester.tap(find.text('Submit my score'));
    await tester.pumpAndSettle();
    final submit = find.widgetWithText(FilledButton, 'Save');
    expect(tester.widget<FilledButton>(submit).onPressed, isNull); // nothing typed yet
    await tester.enterText(find.byKey(const Key('wod-time')), '7:51');
    await tester.pump();
    await tester.tap(submit);
    await tester.pumpAndSettle();
    final body = b.calls('PUT', '/gyms/b/wods/w1/score').single.data as Map;
    expect(body['timeS'], 471);
    expect(body['division'], 'RX');
    expect(find.text('7:51'), findsWidgets); // my score card
  });

  testWidgets('coaches can invalidate a score with a reason', (tester) async {
    final b = backend(coach: true);
    await pumpScreen(tester, const WodScreen(gymId: 'b', wodId: 'w1', myId: 'me'), b);
    await tester.longPress(find.text('Yassine'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('invalidate-reason')), 'No-rep');
    await tester.tap(find.widgetWithText(FilledButton, 'Invalidate'));
    await tester.pumpAndSettle();
    expect((b.calls('POST', '/gyms/b/wods/w1/scores/sy/invalidate').single.data as Map)['reason'], 'No-rep');
  });
}
```
Run → FAIL.

- [ ] **Step 2: Repository et formatage**

`gym_wods_repository.dart`
```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/providers.dart';
import '../../../core/utils/format.dart';

class GymWodsRepository {
  GymWodsRepository(this.api);
  final ApiClient api;

  Future<Map<String, dynamic>> list(String gymId, {String when = 'active'}) => api.get<Map<String, dynamic>>('/gyms/$gymId/wods', query: {'when': when, 'limit': 20});
  Future<Map<String, dynamic>> get(String gymId, String wodId) => api.get<Map<String, dynamic>>('/gyms/$gymId/wods/$wodId');
  Future<Map<String, dynamic>> create(String gymId, Map<String, dynamic> body) => api.post<Map<String, dynamic>>('/gyms/$gymId/wods', data: body);
  Future<Map<String, dynamic>> submit(String gymId, String wodId, Map<String, dynamic> body) => api.put<Map<String, dynamic>>('/gyms/$gymId/wods/$wodId/score', data: body);
  Future<Map<String, dynamic>> board(String gymId, String wodId, {String division = 'RX', String? cursor}) =>
      api.get<Map<String, dynamic>>('/gyms/$gymId/wods/$wodId/leaderboard', query: {'division': division, 'limit': 50, 'cursor': ?cursor});
  Future<Map<String, dynamic>> boardMe(String gymId, String wodId, String division) => api.get<Map<String, dynamic>>('/gyms/$gymId/wods/$wodId/leaderboard/me', query: {'division': division});
  Future<void> invalidate(String gymId, String wodId, String scoreId, String reason) => api.post<dynamic>('/gyms/$gymId/wods/$wodId/scores/$scoreId/invalidate', data: {'reason': reason});
}

final gymWodsRepositoryProvider = Provider<GymWodsRepository>((ref) => GymWodsRepository(ref.watch(apiClientProvider)));
final wodProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, (String, String)>((ref, k) => ref.watch(gymWodsRepositoryProvider).get(k.$1, k.$2));
final gymWodsProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, (String, String)>((ref, k) => ref.watch(gymWodsRepositoryProvider).list(k.$1, when: k.$2));

/// FOR_TIME → "7:32", AMRAP → "12 + 10" (rounds + extra reps) or total reps, MAX_LOAD → "102.5 kg".
String formatWodScore(String scoreType, Map<String, dynamic> s) => switch (scoreType) {
      'FOR_TIME' => formatDuration((s['value'] as num).round()),
      'MAX_LOAD' => '${s['value']} kg',
      _ => s['rounds'] != null ? '${s['rounds']} rds · ${s['value']} reps' : '${s['value']} reps',
    };
```

- [ ] **Step 3: Écrans**

`wod_screen.dart` — `WodScreen({required String gymId, required String wodId, required String myId})` ; `myId` vient de `meProvider` dans la route (`(ref.read(meProvider).valueOrNull?['id'])`). `ConsumerStatefulWidget` + `DefaultTabController(length: 2)` :
- En-tête : titre (`AppTheme.display(size: 30)`), `CountdownText(endsAt)` (ou « Terminé »), badges type de score + time cap (`formatDuration`), description dans une `Card` (texte sélectionnable).
- Carte « Mon score » si `myScore != null` : valeur `formatWodScore`, division ; si `status == 'INVALIDATED'` : bandeau rouge avec `invalidationReason`.
- `TabBar(tabs: [Tab(text: 'Rx'), Tab(text: l.scaled)])` puis `TabBarView` avec, pour chaque division, un `FutureBuilder` sur `repo.board(...)` → `RankRow(rank, name: fullName ?? username, value: formatWodScore(type, row), highlight: athlete.id == myId, leading: AvatarBadge(...), onLongPress: isCoach ? () => _invalidate(row) : null)`. `isCoach` = `gym.myMembership.role == 'COACH'` via `gymProvider(gymId)`.
- `bottomNavigationBar` : si `isOpen`, `FilledButton(l.wodSubmitScore)` → `showModalBottomSheet(isScrollControlled: true, builder: (_) => WodScoreSheet(wod: wod, onSubmit: ...))` ; au retour, `ref.invalidate(wodProvider((gymId, wodId)))` et `setState` pour recharger les classements.
- `_invalidate(row)` : `AlertDialog` avec `TextField(key: Key('invalidate-reason'))` et `FilledButton(l.invalidate)` (actif si ≥ 3 caractères) → `repo.invalidate(gymId, wodId, row['scoreId'], reason)` puis recharger.

`wod_score_sheet.dart` — `WodScoreSheet({required Map wod, required Future<void> Function(Map<String, dynamic> body) onSubmit})` : `SegmentedButton<String>` Rx/Scaled ; selon `scoreType` :
- `FOR_TIME` : `TimeField(key: Key('wod-time'), label: l.wodYourTime, onChanged: (v) => setState(() => _seconds = v))` ; bouton actif si `_seconds != null && (timeCapS == null || _seconds <= timeCapS)` ; sinon texte d'aide `l.wodOverCap` ;
- `AMRAP` : deux champs entiers `rounds` et `extra reps` + un champ « répétitions par round » prérempli vide ; total = `rounds * repsPerRound + extra` affiché ; envoyer `{'rounds': rounds, 'reps': total}` ;
- `MAX_LOAD` : champ décimal kg (1–500).
Corps envoyé : `{'division': _division, 'timeS'|'reps'+'rounds'|'loadKg': …, 'performedAt': DateTime.now().toUtc().toIso8601String(), 'clientId': newClientId()}` (`newClientId` existe dans `core/utils/ids.dart` ; sinon utiliser `const Uuid().v4()`). Bouton `FilledButton(l.save)` avec indicateur de chargement ; erreur API → `ErrorText`.

`create_wod_screen.dart` — formulaire coach : titre, description (multiligne), `SegmentedButton` type de score (For Time / AMRAP / Max load), `TimeField` time cap (optionnel), dates début/fin (`showDatePicker` + `showTimePicker`, défaut : maintenant → +7 j), sport (menu : Aucun / CrossFit / Hyrox), interrupteur « Brouillon ». Validation locale : titre 3–80, description ≥ 1, fin > début, fenêtre ≤ 31 j (message `l.wodWindowTooLong`). `repo.create(gymId, body)` puis `context.pop()` et `ref.invalidate(gymWodsProvider)`.

`gym_wods_section.dart` — `GymWodsSection({required String gymId, required bool isMember, required bool isCoach})` : si ni membre ni coach, `Card` avec `l.wodsMembersOnly`. Sinon `SectionHeader(title: l.gymWods, actionLabel: isCoach ? l.wodCreate : null, onAction: () => context.push('/gyms/$gymId/wods/new'))`, puis les WODs `active` en cartes mises en avant (titre, `CountdownText`, « Mon score » ou `l.wodNotScored`), puis un `ExpansionTile(title: l.wodPast)` qui charge `when: 'past'`. Tap → `/gyms/$gymId/wods/${id}`.

Insérer `GymWodsSection(gymId: id, isMember: status == 'APPROVED', isCoach: role == 'COACH')` dans `GymProfileScreen` (point 5 de la Tâche 12).

Routes : `/gyms/:id/wods/new` → `CreateWodScreen(gymId)` ; `/gyms/:id/wods/:wodId` → `WodScreen(gymId, wodId, myId: ref.read(meProvider).valueOrNull?['id'] as String? ?? '')` (déclarer `/new` avant `/:wodId`).

Clés l10n : `scaled` (Scaled / Scaled / معدّل), `wodSubmitScore` (Submit my score / Soumettre mon score / أرسل نتيجتي), `wodYourTime` (Your time / Ton temps / زمنك), `wodOverCap` (Over the time cap / Au-delà du time cap / تجاوز الحد الزمني), `wodRounds` (Rounds / Rounds / الجولات), `wodExtraReps` (Extra reps / Répétitions en plus / تكرارات إضافية), `wodRepsPerRound` (Reps per round / Répétitions par round / تكرارات في الجولة), `wodLoad` (Load (kg) / Charge (kg) / الوزن (كغ)), `wodMyScore` (My score / Mon score / نتيجتي), `wodInvalidated(reason)` (Invalidated by the coach: {reason} / Invalidé par le coach : {reason} / ألغاها المدرب: {reason}), `invalidate` (Invalidate / Invalider / إلغاء), `invalidateReason` (Reason / Motif / السبب), `gymWods` (Gym WODs / WODs de la salle / تمارين الصالة), `wodCreate` (Create a WOD / Créer un WOD / إنشاء تمرين), `wodNotScored` (No score yet / Pas encore de score / لا نتيجة بعد), `wodPast` (Past WODs / WODs passés / التمارين السابقة), `wodsMembersOnly` (Join the gym to see its WODs / Rejoins la salle pour voir ses WODs / انضم إلى الصالة لرؤية تمارينها), `wodTitle` (Title / Titre / العنوان), `wodDescription` (Movements / Mouvements / الحركات), `wodScoreType` (Score type / Type de score / نوع النتيجة), `forTime` (For time / For time / بأسرع وقت), `amrap` (AMRAP / AMRAP / أكبر عدد جولات), `maxLoad` (Max load / Charge max / أقصى وزن), `wodTimeCap` (Time cap (optional) / Time cap (facultatif) / الحد الزمني (اختياري)), `wodStarts` (Starts / Début / البداية), `wodEnds` (Ends / Fin / النهاية), `wodDraft` (Save as draft / Enregistrer en brouillon / حفظ كمسودة), `wodWindowTooLong` (A WOD lasts 31 days at most / Un WOD dure 31 jours maximum / مدة التمرين 31 يومًا كحد أقصى), `none` (None / Aucun / لا شيء).

- [ ] **Step 4: Tests**

Run: `flutter gen-l10n && flutter test test/widgets/gym_wods_test.dart test/widgets/gym_profile_test.dart && flutter analyze` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/mobile && git commit -m "feat(mobile): gym WODs with Rx/Scaled boards, score submission, coach creation and invalidation"
```

---

### Task 14: Saisie de séance CrossFit/Hyrox

**Files:**
- Create: `lib/features/workouts/presentation/hyrox_race_sheet.dart`, `test/widgets/log_workout_crossfit_test.dart`
- Modify: `lib/features/workouts/presentation/log_workout_screen.dart`, arb ×3

**Interfaces:**
- Consumes: `GET /ref/exercises?sportId` (champs `group`, `description`, `trackedMetrics`), `TimeField`.
- Produces: dans `_ExerciseEntry`, `bool get timed => (exercise['trackedMetrics'] as List).contains('FINISH_TIME')` ; un exercice chronométré a une seule ligne `durationS`.

- [ ] **Step 1: Test (échoue)**

`test/widgets/log_workout_crossfit_test.dart`
```dart
import 'package:fitness_league/features/workouts/presentation/log_workout_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

const crossfit = {'id': 'sp-cf', 'code': 'CROSSFIT', 'category': 'FUNCTIONAL', 'loggingMode': 'MIXED', 'icon': 'kettlebell', 'name': {'en': 'CrossFit', 'fr': 'CrossFit', 'ar': 'كروسفيت'}};
const hyrox = {'id': 'sp-hx', 'code': 'HYROX', 'category': 'FUNCTIONAL', 'loggingMode': 'MIXED', 'icon': 'hyrox', 'name': {'en': 'Hyrox', 'fr': 'Hyrox', 'ar': 'هايروكس'}};
Map<String, dynamic> ex(String id, String code, String group, List<String> metrics) => {'id': id, 'code': code, 'sportId': 'x', 'isBodyweight': false, 'trackedMetrics': metrics, 'group': group, 'description': {'en': '$code description'}, 'name': {'en': code, 'fr': code, 'ar': code}};

void main() {
  FakeBackend backend() => FakeBackend()
    ..on('GET', '/ref/sports', (_) => (200, [crossfit, hyrox]))
    ..on('GET', '/ref/exercises', (req) => (200, req.queryParameters['sportId'] == 'sp-cf'
        ? [ex('e1', 'THRUSTER', 'MOVEMENT', ['MAX_WEIGHT']), ex('e2', 'WOD_FRAN', 'BENCHMARK_WOD', ['FINISH_TIME'])]
        : [ex('h0', 'HYROX_OPEN', 'HYROX_RACE', ['FINISH_TIME']), for (var i = 1; i <= 8; i++) ex('h$i', 'STATION_$i', 'HYROX_STATION', ['FINISH_TIME'])]))
    ..on('POST', '/workouts', (req) => (201, {'id': 'w1', 'status': 'ACCEPTED'}));

  testWidgets('groups exercises and logs a benchmark WOD as a time', (tester) async {
    final b = backend();
    await pumpScreen(tester, const LogWorkoutScreen(), b);
    // pick CrossFit, then the Fran WOD
    await tester.tap(find.byKey(const Key('log-sport')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CrossFit').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('log-add-exercise')));
    await tester.pumpAndSettle();
    expect(find.text('Benchmark WODs'), findsOneWidget);
    expect(find.text('Movements'), findsOneWidget);
    await tester.tap(find.byKey(const Key('pick-WOD_FRAN')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('time-0')), '4:58');
    await tester.enterText(find.byKey(const Key('log-duration')), '20');
    await tester.tap(find.byKey(const Key('log-save')));
    await tester.pumpAndSettle();
    final sets = ((b.calls('POST', '/workouts').single.data as Map)['exercises'] as List).single['sets'] as List;
    expect(sets, [{'durationS': 298}]);
  });

  testWidgets('the Hyrox race assistant fills the 8 stations and the total', (tester) async {
    final b = backend();
    await pumpScreen(tester, const LogWorkoutScreen(), b);
    await tester.tap(find.byKey(const Key('log-sport')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Hyrox').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('hyrox-race')));
    await tester.pumpAndSettle();
    for (var i = 1; i <= 8; i++) {
      await tester.enterText(find.byKey(Key('station-$i')), '5:00');
    }
    await tester.pump();
    expect(find.text('40:00'), findsOneWidget); // computed total, editable
    await tester.enterText(find.byKey(const Key('hyrox-total')), '1:18:30');
    await tester.tap(find.widgetWithText(FilledButton, 'Add to workout'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('log-save')));
    await tester.pumpAndSettle();
    final exercises = (b.calls('POST', '/workouts').single.data as Map)['exercises'] as List;
    expect(exercises.first['sets'], [{'durationS': 4710}]); // race total first
    expect(exercises, hasLength(9));
  });
}
```
Adapter les clés `log-sport` / `log-save` à celles déjà présentes dans `log_workout_screen.dart` (lire le fichier : le `DropdownButtonFormField` du sport et le bouton d'enregistrement ont peut-être déjà des `Key`) ; si elles n'existent pas, les ajouter. Run → FAIL.

- [ ] **Step 2: Implémentation**

Dans `log_workout_screen.dart` :
- Le sélecteur d'exercice (`_addExercise`, bottom sheet) groupe par `group` dans l'ordre `HYROX_RACE`, `BENCHMARK_WOD`, `HYROX_STATION`, `MOVEMENT`, puis `null` (en-têtes `SectionHeader` : `l.groupHyroxRace`, `l.groupBenchmark`, `l.groupHyroxStations`, `l.groupMovements`, `l.groupOther`) ; chaque `ListTile` affiche `localized(description)` en `subtitle` (2 lignes max) quand elle existe.
- `_ExerciseEntry.timed` ; pour un exercice chronométré, `_ExerciseCard` affiche un unique `TimeField(key: Key('time-$index'), ...)` à la place des lignes reps/poids et masque « Ajouter une série » ; la valeur est stockée dans `_SetRow.durationS`.
- La sérialisation d'un exercice chronométré produit `sets: [{'durationS': seconds}]` ; l'enregistrement est bloqué (message `l.timeRequired`) si un exercice chronométré n'a pas de temps valide.
- Si le sport choisi a le code `HYROX`, afficher au-dessus du bouton « Ajouter un exercice » un `OutlinedButton.icon(key: Key('hyrox-race'), icon: Icon(Icons.flag_rounded), label: Text(l.hyroxFullRace))` qui ouvre `HyroxRaceSheet`.

`hyrox_race_sheet.dart` — `HyroxRaceSheet({required List<Map<String, dynamic>> exercises})`, renvoie via `Navigator.pop` une liste d'entrées `[{exercise, durationS}]` :
- sélecteur Open/Pro (`SegmentedButton`, exercices `HYROX_OPEN` / `HYROX_PRO` ; masquer Pro s'il manque) ;
- 8 `TimeField(key: Key('station-$i'))` libellés avec le nom localisé des stations `HYROX_STATION` dans l'ordre officiel : `HYROX_SKIERG_1000`, `HYROX_SLED_PUSH`, `HYROX_SLED_PULL`, `HYROX_BURPEE_BROAD_JUMP`, `HYROX_ROW_1000`, `HYROX_FARMERS_CARRY`, `HYROX_SANDBAG_LUNGES`, `HYROX_WALL_BALLS` (dans le test, les stations fictives `STATION_1..8` sont prises dans l'ordre de la liste quand ces codes n'existent pas) ;
- total calculé = somme des stations saisies, affiché dans un `TimeField(key: Key('hyrox-total'))` réinitialisé à chaque changement tant que l'utilisateur ne l'a pas modifié à la main (drapeau `_totalEdited`) ; libellé `l.hyroxTotalHint` (« Inclut les 8 × 1 km de course »).
- `FilledButton(l.hyroxAdd)` actif si le total est valide ; renvoie la course (total) en premier puis les stations saisies.
L'écran principal ajoute ces entrées comme exercices chronométrés.

Clés : `groupHyroxRace` (Hyrox race / Course Hyrox / سباق هايروكس), `groupBenchmark` (Benchmark WODs / WODs de référence / تمارين مرجعية), `groupHyroxStations` (Hyrox stations / Stations Hyrox / محطات هايروكس), `groupMovements` (Movements / Mouvements / الحركات), `groupOther` (Other / Autres / أخرى), `timeRequired` (Enter a valid time for each timed exercise / Saisis un temps valide pour chaque exercice chronométré / أدخل زمنًا صالحًا لكل تمرين موقوت), `hyroxFullRace` (Full Hyrox race / Course Hyrox complète / سباق هايروكس كامل), `hyroxTotalHint` (Total, including the 8 × 1 km runs / Total, avec les 8 × 1 km de course / المجموع مع 8 × 1 كم جري), `hyroxAdd` (Add to workout / Ajouter à la séance / أضف إلى الحصة), `hyroxDivision` (Division / Catégorie / الفئة).

- [ ] **Step 3: Tests**

Run: `flutter gen-l10n && flutter test test/widgets/log_workout_crossfit_test.dart test/widgets/log_workout_test.dart && flutter analyze` → PASS (l'ancien test de saisie reste vert).

- [ ] **Step 4: Commit**

```bash
git add -A apps/mobile && git commit -m "feat(mobile): grouped exercise picker, timed WOD entry and Hyrox race assistant"
```

---

### Task 15: Social — amis, recherche, profil public

**Files:**
- Create: `lib/features/social/data/social_repository.dart`, `lib/features/social/presentation/friends_screen.dart`, `lib/features/social/presentation/search_screen.dart`, `lib/features/social/presentation/public_profile_screen.dart`, `test/widgets/social_test.dart`
- Modify: `lib/router.dart`, arb ×3

**Interfaces:**
- Consumes: `GET /friends`, `GET /friends/requests?direction=in|out` (vérifier le nom du paramètre dans `social.controller.ts`), `POST /friends/requests {userId}`, `POST /friends/requests/:userId/accept|decline`, `DELETE /friends/:userId`, `POST|DELETE /follows/:userId`, `POST /blocks/:userId`, `GET /search/athletes?q`, `GET /users/:username` (forme : voir `publicProfile` — `friendship: 'FRIENDS'|'REQUEST_SENT'|'REQUEST_RECEIVED'|null`).
- Produces: `SocialRepository` (une méthode par endpoint ci-dessus : `friends()`, `requests(String direction)`, `sendRequest(String userId)`, `answer(String userId, bool accept)`, `unfriend(String userId)`, `follow(String userId, bool on)`, `block(String userId)`, `search(String q, {String? cursor})`, `profile(String username)`), `publicProfileProvider` (family `String`) ; routes `/friends`, `/search`, `/u/:username`.

- [ ] **Step 1: Test (échoue)**

`test/widgets/social_test.dart`
```dart
import 'package:fitness_league/features/social/presentation/friends_screen.dart';
import 'package:fitness_league/features/social/presentation/public_profile_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> athlete(String id, String name) => {'id': id, 'username': id, 'fullName': name, 'governorate': 'TN-51', 'level': 7};

void main() {
  testWidgets('lists friends and accepts an incoming request', (tester) async {
    var incoming = [athlete('sami', 'Sami J.')];
    final b = FakeBackend()
      ..on('GET', '/friends', (_) => (200, [athlete('yassine', 'Yassine T.')]))
      ..on('GET', '/friends/requests', (req) => (200, req.queryParameters['direction'] == 'out' ? [] : incoming))
      ..on('POST', '/friends/requests/sami/accept', (_) {
        incoming = [];
        return (200, {'status': 'ACCEPTED'});
      });
    await pumpScreen(tester, const FriendsScreen(), b);
    expect(find.text('Yassine T.'), findsOneWidget);
    await tester.tap(find.text('Requests'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Accept'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/friends/requests/sami/accept'), hasLength(1));
    expect(find.text('Sami J.'), findsNothing);
  });

  testWidgets('public profile shows division and sends a friend request', (tester) async {
    var friendship = null as String?;
    final b = FakeBackend()
      ..on('GET', '/users/nour', (_) => (200, {'id': 'nour', 'username': 'nour', 'fullName': 'Nour H.', 'bio': null, 'ageBracket': null, 'governorate': {'code': 'TN-11', 'name': {'en': 'Tunis'}}, 'gym': {'id': 'b', 'name': 'Bodynade'}, 'level': 8, 'division': 'SILVER', 'seasonLp': 960, 'followers': 3, 'following': 2, 'friendship': friendship}))
      ..on('POST', '/friends/requests', (_) {
        friendship = 'REQUEST_SENT';
        return (201, {'status': 'PENDING'});
      });
    await pumpScreen(tester, const PublicProfileScreen(username: 'nour'), b);
    expect(find.text('Nour H.'), findsOneWidget);
    expect(find.text('960'), findsOneWidget);
    expect(find.text('Bodynade'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Add friend'));
    await tester.pumpAndSettle();
    expect(find.text('Request sent'), findsOneWidget);
  });
}
```
Run → FAIL.

- [ ] **Step 2: Implémentation**

`social_repository.dart` : méthodes listées (retours `List<Map<String, dynamic>>` pour `friends`/`requests`, `Map` pour `search`/`profile`), provider, et `publicProfileProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>`.

`friends_screen.dart` : `DefaultTabController(length: 2)`, `AppBar(title: l.friends, actions: [IconButton(Icons.person_search_rounded, tooltip: l.findAthletes, onPressed: → '/search')])`, onglets `l.friends` et `l.requests`. Amis : `ListTile(leading: AvatarBadge(name), title: fullName, subtitle: '${l.level} $level · $governorate', onTap: → '/u/$username', trailing: PopupMenuButton` (« Défier » → `/battles/new?opponent=$id`, « Retirer » → confirmation + `unfriend`)). Demandes : sections « Reçues » (`IconButton(Icons.check_rounded, tooltip: l.accept)` et `IconButton(Icons.close_rounded, tooltip: l.decline)`) et « Envoyées » (texte `l.pending`). Recharger après chaque action. `EmptyState` quand vide (`l.noFriendsYet` avec bouton « Trouver des athlètes »).

`search_screen.dart` : champ avec anti-rebond 350 ms (≥ 2 caractères), pagination par curseur comme `GymsScreen`, `ListTile` → `/u/$username`.

`public_profile_screen.dart` : en-tête `AvatarBadge(size: 88)` + nom + `@username` + `DivisionBadge` (texte de division coloré par `divisionColor`) ; 3 `StatCard` (niveau, LP de saison, abonnés) ; `ListTile` salle → `/gyms/$gymId` ; boutons selon `friendship` : `null` → `FilledButton(l.addFriend)` ; `REQUEST_SENT` → `FilledButton(onPressed: null, l.requestSent)` ; `REQUEST_RECEIVED` → `FilledButton(l.accept)` ; `FRIENDS` → `FilledButton.icon(Icons.sports_mma_rounded, l.challenge)` vers `/battles/new?opponent=$id`. Menu `⋮` : Suivre/Ne plus suivre, Bloquer (confirmation, puis `context.pop()`). Profil de soi-même (`id == meId`) : aucun bouton.

Clés : `friends` (Friends / Amis / الأصدقاء), `requests` (Requests / Demandes / الطلبات), `findAthletes` (Find athletes / Trouver des athlètes / ابحث عن رياضيين), `accept` (Accept / Accepter / قبول), `decline` (Decline / Refuser / رفض), `pending` (Pending / En attente / قيد الانتظار), `received` (Received / Reçues / المستلمة), `sent` (Sent / Envoyées / المرسلة), `noFriendsYet` (No friends yet / Pas encore d'amis / لا أصدقاء بعد), `addFriend` (Add friend / Ajouter en ami / إضافة صديق), `requestSent` (Request sent / Demande envoyée / تم إرسال الطلب) — si `gymRequestSent` a la même valeur, garder deux clés distinctes pour que les traductions puissent diverger —, `challenge` (Challenge / Défier / تحدَّ), `follow` (Follow / Suivre / متابعة), `unfollow` (Unfollow / Ne plus suivre / إلغاء المتابعة), `block` (Block / Bloquer / حظر), `blockConfirm` (Block this athlete? They won't see you anymore. / Bloquer cet athlète ? Il ne te verra plus. / حظر هذا الرياضي؟ لن يراك بعد الآن.), `unfriend` (Remove friend / Retirer des amis / إزالة من الأصدقاء), `followers` (Followers / Abonnés / المتابِعون), `seasonLp` (Season LP / LP de saison / نقاط الموسم), `searchAthletesHint` (Name or username / Nom ou pseudo / الاسم أو اسم المستخدم). Réutiliser `level` s'il existe déjà dans les arb.

Routes : `/friends`, `/search`, `/u/:username`.

- [ ] **Step 3: Tests** — `flutter gen-l10n && flutter test test/widgets/social_test.dart && flutter analyze` → PASS.

- [ ] **Step 4: Commit** — `git add -A apps/mobile && git commit -m "feat(mobile): friends, athlete search and public profiles"`

---

### Task 16: Friend Battles

**Files:**
- Create: `lib/features/battles/data/battles_repository.dart`, `lib/features/battles/presentation/battles_screen.dart`, `lib/features/battles/presentation/battle_screen.dart`, `lib/features/battles/presentation/new_battle_screen.dart`, `test/widgets/battles_test.dart`
- Modify: `lib/router.dart`, arb ×3

**Interfaces:**
- Consumes: `GET /battles?status`, `GET /battles/:id` (forme : `participants[] { userId, username, fullName, accepted, score, breakdown, outcome }`, `status`, `startsAt`, `endsAt`, `durationDays`, `components`), `POST /battles { opponentId, durationDays, components? }`, `POST /battles/:id/accept|decline|cancel`, `GET /friends`.
- Produces: `BattlesRepository` (`list({String? status})`, `get(id)`, `create(opponentId, durationDays, components)`, `act(id, String action)`), routes `/battles`, `/battles/new` (paramètre de requête `opponent`), `/battles/:id`.

- [ ] **Step 1: Test (échoue)**

`test/widgets/battles_test.dart`
```dart
import 'package:fitness_league/features/battles/presentation/battle_screen.dart';
import 'package:fitness_league/features/battles/presentation/new_battle_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

Map<String, dynamic> battle(String status, {num? myScore, num? theirScore}) => {
      'id': 'bt1', 'type': 'FRIEND', 'status': status, 'createdById': 'u1', 'durationDays': 7, 'components': ['progress', 'consistency', 'performance'], 'result': null,
      'startsAt': status == 'PENDING' ? null : '2026-09-24T00:00:00Z', 'endsAt': status == 'PENDING' ? null : DateTime.now().add(const Duration(days: 4)).toIso8601String(),
      'participants': [
        {'userId': 'u1', 'username': 'ahmed', 'fullName': 'Ahmed', 'accepted': true, 'score': myScore, 'breakdown': null, 'outcome': null},
        {'userId': 'u2', 'username': 'yassine', 'fullName': 'Yassine', 'accepted': status != 'PENDING', 'score': theirScore, 'breakdown': null, 'outcome': null},
      ],
    };

void main() {
  testWidgets('shows both live scores of an active battle', (tester) async {
    await pumpScreen(tester, const BattleScreen(id: 'bt1', myId: 'u1'), FakeBackend()..on('GET', '/battles/bt1', (_) => (200, battle('ACTIVE', myScore: 71.4, theirScore: 64.2))));
    expect(find.text('71.4'), findsOneWidget);
    expect(find.text('64.2'), findsOneWidget);
    expect(find.text('Yassine'), findsOneWidget);
  });

  testWidgets('the invited friend can accept', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/battles/bt1', (_) => (200, battle('PENDING')))
      ..on('POST', '/battles/bt1/accept', (_) => (200, battle('ACTIVE')));
    await pumpScreen(tester, const BattleScreen(id: 'bt1', myId: 'u2'), b);
    await tester.tap(find.widgetWithText(FilledButton, 'Accept'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/battles/bt1/accept'), hasLength(1));
  });

  testWidgets('creates a battle against a friend with a duration', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/friends', (_) => (200, [{'id': 'u2', 'username': 'yassine', 'fullName': 'Yassine', 'governorate': 'TN-51', 'level': 9}]))
      ..on('POST', '/battles', (_) => (201, battle('PENDING')));
    await pumpScreen(tester, const NewBattleScreen(), b);
    await tester.tap(find.text('Yassine'));
    await tester.tap(find.text('14 days'));
    await tester.tap(find.widgetWithText(FilledButton, 'Send challenge'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/battles').single.data, {'opponentId': 'u2', 'durationDays': 14});
  });
}
```
Run → FAIL.

- [ ] **Step 2: Implémentation**

- `battles_screen.dart` : onglets « En cours » (`status=ACTIVE`), « Invitations » (`PENDING`), « Terminées » (`FINISHED` — vérifier le nom exact dans l'enum `BattleStatus` du schéma) ; chaque carte : adversaire, statut, `CountdownText(endsAt)`, tap → `/battles/:id`. FAB `l.newBattle` → `/battles/new`.
- `battle_screen.dart` : `BattleScreen({required String id, required String myId})` ; face-à-face en deux colonnes (`AvatarBadge` + nom + score en `AppTheme.display(size: 48)`, `score` formaté avec 1 décimale ou `—`) séparées par « VS » ; barre de progression relative (`score_moi / (score_moi + score_lui)`) ; composants listés en `Chip` ; `CountdownText`. Rafraîchissement toutes les 30 s par `Timer.periodic` (annulé dans `dispose`) quand `status == 'ACTIVE'`. Actions : invité et `PENDING` → `FilledButton(l.accept)` + `TextButton(l.decline)` ; créateur et `PENDING` → `OutlinedButton(l.cancelBattle)` ; résultat final → bandeau `l.battleWon` / `l.battleLost` / `l.battleDraw` selon `outcome` du joueur.
- `new_battle_screen.dart` : liste des amis en `RadioListTile`, `SegmentedButton<int>` 3 / 7 / 14 jours (défaut 7, libellés `l.days(n)`), `FilterChip` des 3 composants (tous cochés par défaut ; si tous cochés, ne pas envoyer `components`), `FilledButton(l.sendChallenge)` → `repo.create` → `context.replace('/battles/${id}')`. Pré-sélection via `GoRouterState.of(context).uri.queryParameters['opponent']`.

Clés : `battles` (Battles / Battles / المعارك), `battlesActive` (Active / En cours / جارية), `battlesInvites` (Invites / Invitations / الدعوات), `battlesFinished` (Finished / Terminées / منتهية), `newBattle` (New battle / Nouvelle battle / معركة جديدة), `sendChallenge` (Send challenge / Envoyer le défi / أرسل التحدي), `cancelBattle` (Cancel / Annuler / إلغاء), `battleWon` (You won! / Victoire ! / فزت!), `battleLost` (Defeat / Défaite / خسارة), `battleDraw` (Draw / Égalité / تعادل), `days(count)` (plural : `{count} days` / `{count} jours` / `{count} أيام`), `vs` (VS / VS / ضد), `componentProgress` (Progress / Progrès / التقدم), `componentConsistency` (Consistency / Régularité / الانتظام), `componentPerformance` (Performance / Performance / الأداء), `battleWaiting` (Waiting for your friend / En attente de ton ami / في انتظار صديقك).

- [ ] **Step 3: Tests** — `flutter gen-l10n && flutter test test/widgets/battles_test.dart && flutter analyze` → PASS.

- [ ] **Step 4: Commit** — `git add -A apps/mobile && git commit -m "feat(mobile): Friend Battles list, live battle screen and challenge creation"`

---

### Task 17: Notifications

**Files:**
- Create: `lib/features/notifications/data/notifications_repository.dart`, `lib/features/notifications/presentation/notifications_screen.dart`, `lib/features/notifications/presentation/notification_bell.dart`, `test/widgets/notifications_test.dart`
- Modify: `lib/router.dart`, arb ×3

**Interfaces:**
- Consumes: `GET /notifications?cursor` → `{ unread, data: [{ id, type, payload, read, createdAt }], page }` ; `POST /notifications/read { ids? }` (lire le DTO dans `notifications.service.ts` pour le nom exact du champ).
- Produces: `unreadCountProvider = FutureProvider.autoDispose<int>` ; `NotificationBell()` (icône + pastille) ; `String notificationText(AppLocalizations l, Map n)` ; `String? notificationRoute(Map n)` ; route `/notifications`.

- [ ] **Step 1: Test (échoue)**

`test/widgets/notifications_test.dart`
```dart
import 'package:fitness_league/features/notifications/presentation/notification_bell.dart';
import 'package:fitness_league/features/notifications/presentation/notifications_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

void main() {
  final list = {
    'unread': 2,
    'data': [
      {'id': 'n1', 'type': 'FRIEND_REQUEST', 'payload': {'fromUsername': 'sami'}, 'read': false, 'createdAt': '2026-09-27T09:00:00Z'},
      {'id': 'n2', 'type': 'GYM_WOD_SCORE_INVALIDATED', 'payload': {'gymId': 'b', 'wodId': 'w1', 'wodTitle': 'Bodynade Burner', 'reason': 'No-rep'}, 'read': false, 'createdAt': '2026-09-27T08:00:00Z'},
    ],
    'page': {'nextCursor': null, 'hasMore': false},
  };

  testWidgets('bell shows the unread count', (tester) async {
    await pumpScreen(tester, const Scaffold(body: NotificationBell()), FakeBackend()..on('GET', '/notifications', (_) => (200, list)));
    expect(find.text('2'), findsOneWidget);
  });

  testWidgets('lists readable texts and marks everything read', (tester) async {
    final b = FakeBackend()
      ..on('GET', '/notifications', (_) => (200, list))
      ..on('POST', '/notifications/read', (_) => (204, null));
    await pumpScreen(tester, const NotificationsScreen(), b);
    expect(find.textContaining('sami'), findsOneWidget);
    expect(find.textContaining('Bodynade Burner'), findsOneWidget);
    await tester.tap(find.byTooltip('Mark all as read'));
    await tester.pumpAndSettle();
    expect(b.calls('POST', '/notifications/read'), hasLength(1));
  });
}
```
Run → FAIL.

- [ ] **Step 2: Implémentation**

Lire les `payload` réellement envoyés par `social.service.ts` et `battles.service.ts` (`notify(tx, …, { … })`) et en tirer les champs utilisés ci-dessous ; si `FRIEND_REQUEST` n'a pas de `fromUsername`, afficher le texte générique sans nom.
```dart
String notificationText(AppLocalizations l, Map<String, dynamic> n) {
  final p = (n['payload'] as Map?)?.cast<String, dynamic>() ?? const {};
  final who = (p['fromUsername'] ?? p['byUsername'] ?? p['username'] ?? '') as String;
  return switch (n['type']) {
    'FRIEND_REQUEST' => l.notifFriendRequest(who),
    'FRIEND_ACCEPTED' => l.notifFriendAccepted(who),
    'BATTLE_INVITE' => l.notifBattleInvite(who),
    'BATTLE_STARTED' => l.notifBattleStarted,
    'BATTLE_DECLINED' => l.notifBattleDeclined(who),
    'BATTLE_RESULT' => l.notifBattleResult,
    'GYM_WOD_SCORE_INVALIDATED' => l.notifWodInvalidated(p['wodTitle'] as String? ?? '', p['reason'] as String? ?? ''),
    _ => l.notifGeneric,
  };
}

String? notificationRoute(Map<String, dynamic> n) {
  final p = (n['payload'] as Map?)?.cast<String, dynamic>() ?? const {};
  return switch (n['type']) {
    'FRIEND_REQUEST' || 'FRIEND_ACCEPTED' => '/friends',
    'BATTLE_INVITE' || 'BATTLE_STARTED' || 'BATTLE_DECLINED' || 'BATTLE_RESULT' => p['battleId'] == null ? '/battles' : '/battles/${p['battleId']}',
    'GYM_WOD_SCORE_INVALIDATED' => '/gyms/${p['gymId']}/wods/${p['wodId']}',
    _ => null,
  };
}
```
`NotificationBell` : `IconButton(tooltip: l.notifications, icon: Badge(isLabelVisible: count > 0, label: Text('$count'), child: Icon(Icons.notifications_none_rounded)), onPressed: () => context.push('/notifications'))` (le `onPressed` doit tolérer l'absence de GoRouter dans le test : ne pas appuyer dans le test ; `context.push` n'est appelé qu'au tap). `NotificationsScreen` : liste paginée ; élément non lu = point coloré + titre gras ; date relative (`DateFormat.MMMd(locale).add_Hm()`) ; tap → marquer lu (`ids: [id]`) + `context.push(route)` ; action AppBar `IconButton(Icons.done_all_rounded, tooltip: l.markAllRead)` → `POST /notifications/read` sans `ids`, puis `ref.invalidate(unreadCountProvider)` et recharger.

Clés : `notifications` (Notifications / Notifications / الإشعارات), `markAllRead` (Mark all as read / Tout marquer comme lu / تعليم الكل كمقروء), `notifFriendRequest(name)` ({name} sent you a friend request / {name} t'a envoyé une demande d'ami / أرسل لك {name} طلب صداقة), `notifFriendAccepted(name)` ({name} accepted your request / {name} a accepté ta demande / قبل {name} طلبك), `notifBattleInvite(name)` ({name} challenges you to a battle / {name} te défie en battle / يتحداك {name} في معركة), `notifBattleStarted` (Your battle has started / Ta battle a commencé / بدأت معركتك), `notifBattleDeclined(name)` ({name} declined your battle / {name} a refusé ta battle / رفض {name} معركتك), `notifBattleResult` (Your battle is over: see the result / Ta battle est terminée : vois le résultat / انتهت معركتك: شاهد النتيجة), `notifWodInvalidated(wod, reason)` (Your score on {wod} was invalidated: {reason} / Ton score sur {wod} a été invalidé : {reason} / أُلغيت نتيجتك في {wod}: {reason}), `notifGeneric` (New notification / Nouvelle notification / إشعار جديد), `noNotifications` (You're all caught up / Tu es à jour / لا جديد).

- [ ] **Step 3: Tests** — `flutter gen-l10n && flutter test test/widgets/notifications_test.dart && flutter analyze` → PASS.

- [ ] **Step 4: Commit** — `git add -A apps/mobile && git commit -m "feat(mobile): in-app notifications with unread badge"`

---

### Task 18: Records, mesures, réglages, mot de passe oublié, vérification d'email

**Files:**
- Create: `lib/features/progress/presentation/records_screen.dart`, `lib/features/progress/presentation/body_screen.dart`, `lib/features/settings/presentation/settings_screen.dart`, `lib/features/auth/presentation/forgot_password_screen.dart`, `lib/features/auth/presentation/verify_email_banner.dart`, `test/widgets/account_screens_test.dart`
- Modify: `lib/features/progress/data/progress_repository.dart`, `lib/features/home/data/me_repository.dart`, `lib/features/auth/data/auth_repository.dart`, `lib/features/auth/presentation/login_screen.dart`, `lib/router.dart` (ajouter `/forgot-password` aux routes publiques du `redirect`), arb ×3

**Interfaces:**
- Consumes: `GET /me/records`, `GET /me/baselines`, `GET|POST /me/body-measurements`, `PATCH /me/settings`, `GET|POST /me/consents`, `GET /me/export`, `DELETE /me`, `POST /auth/password/forgot`, `POST /auth/email/resend` (lire les DTO pour les champs exacts : `body-measurements` → poids en kg et date ; `settings` → langue, unités, visibilité, `showAgeBracket`).
- Produces: routes `/records`, `/me/body`, `/settings`, `/forgot-password` ; `VerifyEmailBanner()` affichée en haut de l'Accueil quand `me.emailVerified == false` (vérifier le nom du champ dans la réponse de `GET /me`).

- [ ] **Step 1: Test (échoue)**

`test/widgets/account_screens_test.dart`
```dart
import 'package:fitness_league/features/auth/presentation/forgot_password_screen.dart';
import 'package:fitness_league/features/progress/presentation/records_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';
import 'harness.dart';

void main() {
  testWidgets('records show times as m:ss and loads in kg', (tester) async {
    await pumpScreen(tester, const RecordsScreen(), FakeBackend()
      ..on('GET', '/me/records', (_) => (200, [
            {'exerciseId': 'e1', 'exercise': {'code': 'WOD_FRAN', 'name': {'en': 'Fran'}}, 'metricCode': 'FINISH_TIME', 'unit': 's', 'value': 298, 'achievedAt': '2026-09-25T10:00:00Z'},
            {'exerciseId': 'e2', 'exercise': {'code': 'BACK_SQUAT', 'name': {'en': 'Back squat'}}, 'metricCode': 'E1RM', 'unit': 'kg', 'value': 112.5, 'achievedAt': '2026-09-20T10:00:00Z'},
          ])));
    expect(find.text('4:58'), findsOneWidget);
    expect(find.text('112.5 kg'), findsOneWidget);
  });

  testWidgets('forgot password always confirms (no account enumeration)', (tester) async {
    final b = FakeBackend()..on('POST', '/auth/password/forgot', (_) => (204, null));
    await pumpScreen(tester, const ForgotPasswordScreen(), b);
    await tester.enterText(find.byType(TextField), 'someone@example.test');
    await tester.tap(find.widgetWithText(FilledButton, 'Send link'));
    await tester.pumpAndSettle();
    expect(find.textContaining('If an account exists'), findsOneWidget);
  });
}
```
Adapter le fixture `/me/records` à la forme réelle renvoyée par `progress.controller.ts` → `records` (lire le service) ; le test vérifie seulement le formatage. Run → FAIL.

- [ ] **Step 2: Implémentation**

- `records_screen.dart` : records groupés par exercice (`SectionHeader` par groupe WOD / Hyrox / Force / Cardio d'après `exercise.code` ou `group` si présent), valeur via `formatMetric(value, unit, locale)` (existant ; `'s'` donne déjà `m:ss`), date relative, badge `PR`. Accès depuis Progrès (bouton « Tous mes records ») et Profil.
- `body_screen.dart` : graphique `fl_chart` `LineChart` du poids (déjà dépendance), liste des mesures, FAB « Ajouter » → dialogue (poids kg 30–300, date ≤ aujourd'hui). Si le consentement santé manque (`403` avec code dédié, voir `users.controller`), afficher un `EmptyState` qui explique et renvoie vers `/settings`.
- `settings_screen.dart` : langue (`localeProvider`), thème (`themeModeProvider`), unités, visibilité des séances, « Afficher ma tranche d'âge », consentements (santé), « Exporter mes données » (`GET /me/export` → `SnackBar(l.exportRequested)`), « Supprimer mon compte » (double confirmation avec saisie du pseudo, puis `DELETE /me`, déconnexion), « Se déconnecter ». Accès via l'icône engrenage du Profil.
- `forgot_password_screen.dart` : champ email + `FilledButton(l.sendLink)` → `POST /auth/password/forgot` puis texte fixe `l.resetLinkSent` quel que soit le résultat (hors erreur réseau). Lien « Mot de passe oublié ? » sur `LoginScreen`.
- `verify_email_banner.dart` : `MaterialBanner`-like `Card` avec `l.verifyEmailPrompt` et `TextButton(l.resend)` → `POST /auth/email/resend` → `SnackBar(l.verificationSent)`.

Clés : `records` (Personal records / Records personnels / الأرقام القياسية), `allRecords` (All my records / Tous mes records / كل أرقامي), `body` (Body / Corps / الجسم), `addMeasurement` (Add a weigh-in / Ajouter une pesée / أضف وزنًا), `weightKg` (Weight (kg) / Poids (kg) / الوزن (كغ)), `healthConsentNeeded` (Allow health data in Settings to track your weight / Autorise les données de santé dans les Réglages pour suivre ton poids / اسمح ببيانات الصحة في الإعدادات لتتبع وزنك), `settings` (Settings / Réglages / الإعدادات), `language` (Language / Langue / اللغة), `theme` (Theme / Thème / المظهر), `themeDark` (Dark / Sombre / داكن), `themeLight` (Light / Clair / فاتح), `themeSystem` (System / Système / النظام), `units` (Units / Unités / الوحدات), `workoutVisibility` (Who sees my workouts / Qui voit mes séances / من يرى حصصي), `showAgeBracket` (Show my age bracket / Afficher ma tranche d'âge / إظهار فئتي العمرية), `healthConsent` (Health data / Données de santé / بيانات الصحة), `exportData` (Export my data / Exporter mes données / تصدير بياناتي), `exportRequested` (Export ready: check your email / Export prêt : vérifie tes emails / التصدير جاهز: تحقق من بريدك), `deleteAccount` (Delete my account / Supprimer mon compte / حذف حسابي), `deleteAccountConfirm(username)` (Type {username} to confirm / Tape {username} pour confirmer / اكتب {username} للتأكيد), `signOut` (Sign out / Se déconnecter / تسجيل الخروج), `forgotPassword` (Forgot password? / Mot de passe oublié ? / نسيت كلمة المرور؟), `sendLink` (Send link / Envoyer le lien / أرسل الرابط), `resetLinkSent` (If an account exists for this email, a reset link is on its way. / Si un compte existe pour cet email, un lien de réinitialisation arrive. / إذا كان هناك حساب لهذا البريد، فسيصلك رابط إعادة التعيين.), `verifyEmailPrompt` (Verify your email to create a gym and join battles / Vérifie ton email pour créer une salle et lancer des battles / أكّد بريدك لإنشاء صالة وخوض المعارك), `resend` (Resend / Renvoyer / إعادة الإرسال), `verificationSent` (Verification email sent / Email de vérification envoyé / تم إرسال بريد التحقق). Si certaines clés (`signOut`, `language`, `theme`) existent déjà, les réutiliser. Le texte exact de `exportRequested` dépend du comportement de `GET /me/export` (téléchargement direct ou email) : lire le contrôleur et ajuster le message.

- [ ] **Step 3: Tests** — `flutter gen-l10n && flutter test test/widgets/account_screens_test.dart test/widgets/login_test.dart && flutter analyze` → PASS.

- [ ] **Step 4: Commit** — `git add -A apps/mobile && git commit -m "feat(mobile): records, body measurements, settings, password reset and email verification"`

---

### Task 19: Refonte des écrans existants et navigation

**Files:**
- Modify: `lib/features/home/presentation/home_screen.dart`, `lib/features/workouts/presentation/train_screen.dart`, `lib/features/league/presentation/league_screen.dart`, `lib/features/goals/presentation/goals_screen.dart`, `lib/features/profile/presentation/profile_screen.dart`, `lib/features/auth/presentation/login_screen.dart`, `lib/features/auth/presentation/register_screen.dart`, `lib/features/onboarding/presentation/onboarding_screen.dart`, `lib/features/shell/app_shell.dart`, tests existants concernés, arb ×3
- Create: `test/widgets/home_test.dart`

**Interfaces:**
- Consumes: tout le kit (Tâche 10), `NotificationBell` (17), `GymLogo` + `gymProvider` (11), `gymWodsProvider` (13), `VerifyEmailBanner` (18).

- [ ] **Step 1: Test de l'Accueil (échoue)**

`test/widgets/home_test.dart` : `FakeBackend` qui sert `GET /me` (profil avec `gym: {id: 'b', name: 'Bodynade'}`, `stats` avec `seasonLp: 1240`, `division: 'GOLD'`, `level: 12`, email vérifié), `GET /me/weekly-scores/current`, `GET /me/ranks`, `GET /goals`, `GET /notifications` (`unread: 1`), `GET /gyms/b` (profil, `logoUrl: null`), `GET /gyms/b/wods` (1 WOD actif « Bodynade Burner », `myScore: null`). Reprendre les formes exactes de ces réponses depuis les fixtures des tests existants et depuis `me_repository.dart`. Assertions :
```dart
    expect(find.text('1240'), findsOneWidget);            // hero LP
    expect(find.text('Bodynade'), findsOneWidget);        // my gym card
    expect(find.text('Bodynade Burner'), findsOneWidget); // current gym WOD
    expect(find.text('1'), findsOneWidget);               // bell badge
```
Run → FAIL.

- [ ] **Step 2: Refonte**

Principes appliqués à chaque écran : `AppBar` titre en Barlow ; chiffres clés en `AppTheme.display` ; sections séparées par `SectionHeader` ; listes avec `SkeletonList` au chargement et `EmptyState` si vide ; espacement 16 px ; pas de logique métier nouvelle.
- **Accueil** : en-tête « Salut {prénom} » + `NotificationBell` ; `VerifyEmailBanner` si besoin ; carte héros (dégradé accent → surface) : LP de saison en `display(size: 56)`, `AvatarBadge` de division, barre XP (existante) ; ligne de 3 `StatCard` (série de jours, rang national, score de la semaine) ; carte « Ma salle » (`GymLogo` + nom + WOD actif avec `CountdownText` et « Mon score » ou bouton « Soumettre ») ou, sans salle, carte « Trouver une salle » → `/gyms` ; objectifs en cours (existant) ; raccourcis (Records, Amis, Battles).
- **Entraînement** : gros bouton « Enregistrer une séance », puis historique en cartes (sport, durée, statut coloré), puis raccourci « WODs de ma salle ».
- **Ligue** : podium top 3 (3 colonnes, la 1re surélevée, `AvatarBadge(size: 64)`), puis la liste `RankRow` ; portée « Salle » : en-tête avec `GymLogo` cliquable → `/gyms/:id`. Garder les `tooltip` et textes attendus par `league_test.dart` (« Jump to my rank », `#1`, `88 LP`, `↑3`) ; si le podium change ces rendus, mettre à jour le test en conservant les mêmes vérifications de fond (pagination par curseur, RTL).
- **Objectifs** : cartes de progression avec anneau (`CircularProgressIndicator` épais, valeur au centre).
- **Profil** : en-tête `AvatarBadge(size: 88)` + nom + division + salle (tap → profil de salle) ; tuiles vers Records, Mesures, Amis, Battles, Réglages (icône engrenage dans l'AppBar).
- **Connexion / Inscription / Onboarding** : logo de l'app (texte `APP_NAME` en Barlow sur fond graphite avec accent), champs aérés, bouton principal pleine largeur ; onboarding avec indicateur d'étapes (`LinearProgressIndicator` segmenté) ; ajouter CrossFit et Hyrox dans la liste des sports (ils viennent de `/ref/sports`, rien à coder en dur).
- **Barre de navigation** : inchangée (5 onglets), icônes arrondies, `labelBehavior: NavigationDestinationLabelBehavior.onlyShowSelected`.

- [ ] **Step 3: Tests**

Run: `flutter gen-l10n && flutter test && flutter analyze` → **toute** la suite PASS (anciens tests mis à jour uniquement pour des changements de rendu, jamais pour masquer une régression de comportement).

- [ ] **Step 4: Commit** — `git add -A apps/mobile && git commit -m "feat(mobile): redesigned home, train, league, goals, profile and auth screens"`

---

### Task 20: Vérification finale, captures et documentation

**Files:**
- Modify: `README.md`, `apps/mobile/README.md`

- [ ] **Step 1: Suites complètes**

```bash
cd apps/api && pnpm test:unit && pnpm test:integration && pnpm lint && pnpm typecheck
cd ../mobile && flutter test && flutter analyze
```
Attendu : tout vert. En cas d'échec, corriger avant de continuer (superpowers:systematic-debugging).

- [ ] **Step 2: Rejouer la démo et construire le web**

```bash
cd apps/api && pnpm prisma:deploy && pnpm seed   # base de démo à jour (ou reset si la démo existe déjà : voir Tâche 9 Step 3)
pnpm dev   # API sur :3000, CORS_ORIGINS contient http://localhost:8080
pnpm demo-data
cd ../mobile && flutter build web --dart-define=API_BASE_URL=http://localhost:3000/api/v1
cd build/web && python3 -m http.server 8080
```

- [ ] **Step 3: Parcours manuel en vue mobile (390×844) avec captures**

Avec Playwright/Chrome DevTools MCP si disponible, sinon avec `npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=4000 <url> <fichier>` après connexion scriptée (`ahmed@demo.fitnessleague.test` / `demo-password-2026`). Captures dans le scratchpad (pas dans le dépôt) :
1. Connexion ; 2. Accueil (carte Bodynade + WOD) ; 3. Liste des salles (8 logos) ; 4. Filtre Hyrox ; 5. Profil Bodynade ; 6. WOD « Bodynade Burner » (classement Rx/Scaled) ; 7. Saisie de séance Hyrox (assistant) ; 8. Records (Fran, Hyrox en `m:ss`/`h:mm:ss`) ; 9. Ligue (podium) ; 10. Battle en cours ; 11. Notifications ; 12. Une capture en arabe (RTL).
Vérifier à chaque écran : pas de débordement (bandes jaunes/noires), textes traduits, logos chargés.

- [ ] **Step 4: Documentation**

`README.md` : tableau « What exists today » — ajouter les lignes *Media storage (local/S3), gym logos*, *CrossFit & Hyrox (catalog, FINISH_TIME, rule set v2)*, *Gym coaches & WODs*, et mettre à jour la ligne Mobile (« all screens, redesigned UI ; web preview verified »). Documenter `STORAGE_DRIVER`, `MEDIA_PUBLIC_BASE_URL`. `apps/mobile/README.md` : polices embarquées (licence OFL), `image_picker` (permissions iOS `NSPhotoLibraryUsageDescription` dans `ios/Runner/Info.plist` — à ajouter dans cette tâche), et la commande de build web.

- [ ] **Step 5: Commit**

```bash
git add -A README.md apps/mobile && git commit -m "docs: gyms, CrossFit/Hyrox, coach WODs and mobile preview"
```
