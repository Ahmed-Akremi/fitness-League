import { Controller, Get, Global, HttpCode, HttpStatus, Injectable, Module, Post, Body, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { uuidv7 } from '../../common/ids/uuid';
import { OutboxService } from '../../common/outbox/outbox.service';
import { CursorCodec } from '../../common/pagination/cursor';
import { PageQueryDto, toPage } from '../../common/pagination/page';
import { PrismaService } from '../../common/prisma/prisma.service';

export type NotificationType =
  | 'FRIEND_REQUEST'
  | 'FRIEND_ACCEPTED'
  | 'BATTLE_INVITE'
  | 'BATTLE_STARTED'
  | 'BATTLE_DECLINED'
  | 'BATTLE_RESULT'
  | 'DUEL_MATCHED'
  | 'DUEL_GHOST'
  | 'GYM_WAR_STARTED'
  | 'GYM_WAR_RESULT'
  | 'BADGE_AWARDED'
  | 'CHALLENGE_COMPLETED'
  | 'ACTIVITY_REACTION'
  | 'ACTIVITY_COMMENT'
  | 'PROOF_VERIFIED'
  | 'PROOF_REJECTED'
  | 'REPORT_HANDLED'
  | 'SANCTION_WARNING'
  | 'APPEAL_DECIDED'
  | 'GYM_WOD_SCORE_INVALIDATED';

/**
 * In-app notifications (Phase 1: list only). ASSUMPTION Q-17: push (FCM), per-type preferences and quiet hours
 * arrive with the notifications module in Phase 2; the rows written here are what push will deliver.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cursors: CursorCodec,
    private readonly outbox: OutboxService,
  ) {}

  async notify(tx: Prisma.TransactionClient, userId: string, type: NotificationType, payload: Prisma.InputJsonObject): Promise<void> {
    const id = uuidv7();
    await tx.notification.create({ data: { id, userId, type, payload } });
    // Push goes out after commit, through the outbox (docs §2.3).
    await this.outbox.enqueue(tx, 'NotificationCreated', { notificationId: id });
  }

  async list(userId: string, q: PageQueryDto) {
    const c = q.cursor ? this.cursors.decode<{ id: string }>(q.cursor) : null;
    const rows = await this.prisma.notification.findMany({ where: { userId, ...(c && { id: { lt: c.id } }) }, orderBy: { id: 'desc' }, take: q.limit + 1 });
    const page = toPage(rows, q.limit, (r) => ({ id: r.id }), (k) => this.cursors.encode(k));
    const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { unread, data: page.data.map((n) => ({ id: n.id, type: n.type, payload: n.payload, read: n.readAt !== null, createdAt: n.createdAt.toISOString() })), page: page.page };
  }

  async markRead(userId: string, ids?: string[]): Promise<void> {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null, ...(ids && { id: { in: ids } }) }, data: { readAt: new Date() } });
  }
}

class MarkReadDto {
  @ApiPropertyOptional({ description: 'Omit to mark everything as read.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids?: string[];
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.notifications.list(user.id, q);
  }

  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(@CurrentUser() user: AuthUser, @Body() dto: MarkReadDto): Promise<void> {
    return this.notifications.markRead(user.id, dto.ids);
  }
}

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
