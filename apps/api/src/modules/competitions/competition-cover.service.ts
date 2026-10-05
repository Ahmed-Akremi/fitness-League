import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { sniffImage } from '../gyms/gym-logo.service';
import { JudgingService } from './judging.service';

export const COVER_MAX_BYTES = 5 * 1024 * 1024;
/** Same ratio as the app's cover band (2.4:1). */
export const COVER_WIDTH = 1440;
export const COVER_HEIGHT = 596;

/** Competition banner: organizers replace it for each new event or final; validated, re-encoded as WebP, content-hashed key. */
@Injectable()
export class CompetitionCoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly judging: JudgingService,
    private readonly audit: AuditService,
  ) {}

  async set(user: AuthUser, competitionId: string, file: { buffer: Buffer; size: number } | undefined): Promise<{ coverUrl: string }> {
    const competition = await this.editable(user, competitionId);
    if (!file) throw AppException.validation([{ field: 'file', code: 'REQUIRED' }]);
    if (file.size > COVER_MAX_BYTES) throw new AppException(HttpStatus.PAYLOAD_TOO_LARGE, ErrorCode.PAYLOAD_TOO_LARGE, 'Banner must be 5 MB or less.');
    if (!sniffImage(file.buffer)) throw new AppException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Banner must be a PNG, JPEG or WebP image.');

    let webp: Buffer;
    try {
      webp = await sharp(file.buffer, { limitInputPixels: 60_000_000 }).rotate().resize(COVER_WIDTH, COVER_HEIGHT, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
    } catch {
      throw new AppException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Banner could not be decoded.');
    }
    const hash = createHash('sha256').update(webp).digest();
    const key = `competitions/${competition.id}/cover-${hash.toString('hex').slice(0, 16)}.webp`;
    const previous = competition.coverMediaId ? await this.prisma.media.findUnique({ where: { id: competition.coverMediaId } }) : null;
    if (previous?.objectKey === key && previous.status !== 'DELETED') return { coverUrl: this.storage.url(key) }; // same image again
    await this.storage.put(key, webp, 'image/webp');

    // Same content as an earlier, deleted banner: revive that media row (object keys are unique).
    const earlier = await this.prisma.media.findUnique({ where: { objectKey: key } });
    const mediaId = earlier?.id ?? uuidv7();
    await this.prisma.$transaction(async (tx) => {
      if (earlier) {
        await tx.media.update({ where: { id: earlier.id }, data: { status: 'READY' } });
      } else {
        await tx.media.create({
          data: { id: mediaId, ownerId: user.id, bucket: 'competitions', objectKey: key, mime: 'image/webp', sizeBytes: webp.length, sha256: hash, status: 'READY', purpose: 'COMPETITION_COVER', width: COVER_WIDTH, height: COVER_HEIGHT },
        });
      }
      await tx.competition.update({ where: { id: competition.id }, data: { coverMediaId: mediaId } });
      if (previous) await tx.media.update({ where: { id: previous.id }, data: { status: 'DELETED' } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.cover_updated', entityType: 'Competition', entityId: competition.id, after: { mediaId } }, tx);
    });
    if (previous && previous.objectKey !== key) await this.storage.delete(previous.objectKey);
    return { coverUrl: this.storage.url(key) };
  }

  async remove(user: AuthUser, competitionId: string): Promise<void> {
    const competition = await this.editable(user, competitionId);
    if (!competition.coverMediaId) return;
    const media = await this.prisma.media.findUniqueOrThrow({ where: { id: competition.coverMediaId } });
    await this.prisma.$transaction(async (tx) => {
      await tx.competition.update({ where: { id: competition.id }, data: { coverMediaId: null } });
      await tx.media.update({ where: { id: media.id }, data: { status: 'DELETED' } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'competition.cover_removed', entityType: 'Competition', entityId: competition.id }, tx);
    });
    await this.storage.delete(media.objectKey);
  }

  private async editable(user: AuthUser, competitionId: string) {
    await this.judging.requireRole(user, competitionId, ['ORGANIZER']);
    const competition = await this.prisma.competition.findFirst({ where: { id: competitionId, deletedAt: null } });
    if (!competition) throw AppException.notFound('Competition');
    return competition;
  }
}
