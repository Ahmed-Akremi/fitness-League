import { HttpStatus, Injectable } from '@nestjs/common';
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

/** Gym logos: validated, re-encoded as a 512×512 WebP, stored under a content-hashed key (spec §1). */
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
    if (file.size > LOGO_MAX_BYTES) throw new AppException(HttpStatus.PAYLOAD_TOO_LARGE, ErrorCode.PAYLOAD_TOO_LARGE, 'Logo must be 2 MB or less.');
    if (!sniffImage(file.buffer)) throw new AppException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Logo must be a PNG, JPEG or WebP image.');

    let webp: Buffer;
    try {
      webp = await sharp(file.buffer, { limitInputPixels: 40_000_000 }).rotate().resize(LOGO_SIZE, LOGO_SIZE, { fit: 'cover' }).webp({ quality: 88 }).toBuffer();
    } catch {
      throw new AppException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Logo could not be decoded.');
    }
    const hash = createHash('sha256').update(webp).digest();
    const key = `gyms/${gym.id}/logo-${hash.toString('hex').slice(0, 16)}.webp`;
    await this.storage.put(key, webp, 'image/webp');

    const previous = gym.logoMediaId ? await this.prisma.media.findUnique({ where: { id: gym.logoMediaId } }) : null;
    const mediaId = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.media.create({
        data: { id: mediaId, ownerId: user.id, bucket: 'gyms', objectKey: key, mime: 'image/webp', sizeBytes: webp.length, sha256: hash, status: 'READY', purpose: 'GYM_LOGO', width: LOGO_SIZE, height: LOGO_SIZE },
      });
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
