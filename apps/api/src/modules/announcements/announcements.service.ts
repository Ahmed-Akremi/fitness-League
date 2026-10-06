import { Injectable } from '@nestjs/common';
import type { Announcement, Media } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { OutboxService } from '../../common/outbox/outbox.service';
import { CursorCodec } from '../../common/pagination/cursor';
import { PageQueryDto, toPage } from '../../common/pagination/page';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { encodeAnnouncementImage } from './announcement-image';
import { ANNOUNCEMENT_BODY_MAX, normalizeBody } from './announcement-rules';

export interface AnnouncementView {
  id: string;
  body: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
}

/** Admin news on the app home screen: published from the panel, liked (never commented) by athletes. */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cursors: CursorCodec,
    private readonly outbox: OutboxService,
  ) {}

  async publish(user: AuthUser, rawBody: unknown, file?: { buffer: Buffer; size: number }): Promise<AnnouncementView> {
    const body = normalizeBody(rawBody);
    if (body && body.length > ANNOUNCEMENT_BODY_MAX) throw AppException.validation([{ field: 'body', code: 'TOO_LONG' }]);
    if (!body && !file) throw AppException.validation([{ field: 'body', code: 'REQUIRED' }]);
    const image = file ? await encodeAnnouncementImage(file) : null;

    const id = uuidv7();
    const key = image ? `announcements/${id}/${image.sha256.toString('hex').slice(0, 16)}.webp` : null;
    if (image && key) await this.storage.put(key, image.webp, 'image/webp');
    const created = await this.prisma.$transaction(async (tx) => {
      const mediaId = image ? uuidv7() : null;
      if (image && key && mediaId) {
        await tx.media.create({
          data: { id: mediaId, ownerId: user.id, bucket: 'announcements', objectKey: key, mime: 'image/webp', sizeBytes: image.webp.length, sha256: image.sha256, status: 'READY', purpose: 'ANNOUNCEMENT_IMAGE', width: image.width, height: image.height },
        });
      }
      const row = await tx.announcement.create({ data: { id, authorId: user.id, body, imageMediaId: mediaId }, include: { image: true } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'announcement.published', entityType: 'Announcement', entityId: id, after: { hasText: body != null, hasImage: image != null } }, tx);
      // Every athlete gets a bell notification; the worker fans it out in batches.
      await this.outbox.enqueue(tx, 'AnnouncementPublished', { announcementId: id });
      return row;
    });
    return this.view(created, 0, false);
  }

  /** App feed: newest first, deleted ones hidden, with my like. */
  async feed(userId: string, q: PageQueryDto) {
    return this.page(q, userId);
  }

  /** Panel list: same rows with their like counts. */
  async adminList(q: PageQueryDto) {
    return this.page(q, null);
  }

  async like(userId: string, id: string) {
    await this.live(id);
    await this.prisma.announcementLike.createMany({ data: [{ announcementId: id, userId }], skipDuplicates: true });
    return { likeCount: await this.prisma.announcementLike.count({ where: { announcementId: id } }), likedByMe: true };
  }

  async unlike(userId: string, id: string) {
    await this.live(id);
    await this.prisma.announcementLike.deleteMany({ where: { announcementId: id, userId } });
    return { likeCount: await this.prisma.announcementLike.count({ where: { announcementId: id } }), likedByMe: false };
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const row = await this.live(id);
    const media = row.imageMediaId ? await this.prisma.media.findUnique({ where: { id: row.imageMediaId } }) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.announcement.update({ where: { id }, data: { deletedAt: new Date() } });
      if (media) await tx.media.update({ where: { id: media.id }, data: { status: 'DELETED' } });
      await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'announcement.deleted', entityType: 'Announcement', entityId: id }, tx);
    });
    if (media) await this.storage.delete(media.objectKey);
  }

  private async page(q: PageQueryDto, viewerId: string | null) {
    const c = q.cursor ? this.cursors.decode<{ id: string }>(q.cursor) : null;
    const rows = await this.prisma.announcement.findMany({
      where: { deletedAt: null, ...(c && { id: { lt: c.id } }) },
      orderBy: { id: 'desc' }, // uuidv7: newest first
      take: q.limit + 1,
      include: { image: true, _count: { select: { likes: true } }, likes: { where: { userId: viewerId ?? undefined }, select: { userId: true }, take: viewerId ? 1 : 0 } },
    });
    const page = toPage(rows, q.limit, (r) => ({ id: r.id }), (k) => this.cursors.encode(k));
    return { data: page.data.map((r) => this.view(r, r._count.likes, r.likes.length > 0)), page: page.page };
  }

  private async live(id: string) {
    const row = await this.prisma.announcement.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw AppException.notFound('Announcement');
    return row;
  }

  private view(row: Announcement & { image: Media | null }, likeCount: number, likedByMe: boolean): AnnouncementView {
    const image = row.image?.status === 'READY' ? row.image : null;
    return {
      id: row.id,
      body: row.body,
      imageUrl: image ? this.storage.url(image.objectKey) : null,
      imageWidth: image?.width ?? null,
      imageHeight: image?.height ?? null,
      createdAt: row.createdAt.toISOString(),
      likeCount,
      likedByMe,
    };
  }
}
