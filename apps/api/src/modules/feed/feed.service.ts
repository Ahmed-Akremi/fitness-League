import { Injectable } from '@nestjs/common';
import { ActivityEvent, ReactionType } from '@prisma/client';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { CursorCodec } from '../../common/pagination/cursor';
import { PageQueryDto, toPage } from '../../common/pagination/page';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SocialAccess } from '../social/social-access';

const REACTIONS: ReactionType[] = ['LIKE', 'FIRE', 'STRONG'];

/**
 * Activity feed (docs §3.9, §4.5): my own activity and my friends' (FRIENDS or PUBLIC), minus blocked and muted
 * athletes, newest first; reactions (one per athlete) and comments on each item.
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SocialAccess,
    private readonly notifications: NotificationsService,
    private readonly cursors: CursorCodec,
    private readonly clock: ClockService,
  ) {}

  async feed(me: string, q: PageQueryDto) {
    const [friends, muted, blocks] = await Promise.all([
      this.prisma.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ userLowId: me }, { userHighId: me }] } }),
      this.prisma.mute.findMany({ where: { muterId: me }, select: { mutedId: true } }),
      this.prisma.block.findMany({ where: { OR: [{ blockerId: me }, { blockedId: me }] } }),
    ]);
    const hidden = new Set([...muted.map((m) => m.mutedId), ...blocks.map((b) => (b.blockerId === me ? b.blockedId : b.blockerId))]);
    const friendIds = friends.map((f) => (f.userLowId === me ? f.userHighId : f.userLowId)).filter((id) => !hidden.has(id));
    const c = q.cursor ? this.cursors.decode<{ id: string }>(q.cursor) : null;
    const rows = await this.prisma.activityEvent.findMany({
      where: {
        OR: [{ userId: me }, { userId: { in: friendIds }, visibility: { in: ['FRIENDS', 'PUBLIC'] } }],
        user: { status: 'ACTIVE' },
        ...(c && { id: { lt: c.id } }),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const page = toPage(rows, q.limit, (r) => ({ id: r.id }), (k) => this.cursors.encode(k));
    return { data: await this.render(me, await this.withoutDeletedRefs(page.data)), page: page.page };
  }

  /** A deleted workout or revoked record takes its feed item with it (the events stay for history). */
  private async withoutDeletedRefs(events: ActivityEvent[]): Promise<ActivityEvent[]> {
    const workoutIds = events.filter((e) => e.refType === 'workout').map((e) => e.refId);
    const prIds = events.filter((e) => e.refType === 'personal_record').map((e) => e.refId);
    const [gone, revoked] = await Promise.all([
      workoutIds.length ? this.prisma.workout.findMany({ where: { id: { in: workoutIds }, OR: [{ deletedAt: { not: null } }, { status: { not: 'ACCEPTED' } }] }, select: { id: true } }) : [],
      prIds.length ? this.prisma.personalRecord.findMany({ where: { id: { in: prIds }, status: 'REVOKED' }, select: { id: true } }) : [],
    ]);
    const drop = new Set([...gone.map((w) => w.id), ...revoked.map((p) => p.id)]);
    return events.filter((e) => !drop.has(e.refId));
  }

  /** Feed items with their author, readable details, reaction counts, my reaction and the comment count. */
  private async render(me: string, events: ActivityEvent[]) {
    if (!events.length) return [];
    const ids = events.map((e) => e.id);
    const payloads = events.map((e) => (e.payload ?? {}) as Record<string, unknown>);
    const pick = (key: string) => [...new Set(payloads.map((p) => p[key]).filter((v): v is string => typeof v === 'string'))];
    const [users, sports, exercises, badges, gyms, opponents, reactions, mine, comments] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.userId))] } }, select: { id: true, username: true, profile: { select: { fullName: true } } } }),
      this.prisma.sport.findMany({ where: { id: { in: pick('sportId') } }, select: { id: true, code: true, nameI18n: true } }),
      this.prisma.exercise.findMany({ where: { id: { in: pick('exerciseId') } }, select: { id: true, nameI18n: true } }),
      this.prisma.badge.findMany({ where: { code: { in: pick('badge') } }, select: { code: true, nameI18n: true, icon: true } }),
      this.prisma.gym.findMany({ where: { id: { in: pick('gymId') } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: pick('opponentId') } }, select: { id: true, username: true, profile: { select: { fullName: true } } } }),
      this.prisma.activityReaction.groupBy({ by: ['activityEventId', 'type'], where: { activityEventId: { in: ids } }, _count: true }),
      this.prisma.activityReaction.findMany({ where: { activityEventId: { in: ids }, userId: me } }),
      this.prisma.activityComment.groupBy({ by: ['activityEventId'], where: { activityEventId: { in: ids }, deletedAt: null }, _count: true }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const sportById = new Map(sports.map((s) => [s.id, { code: s.code, name: s.nameI18n }]));
    const exerciseById = new Map(exercises.map((x) => [x.id, x.nameI18n]));
    const badgeByCode = new Map(badges.map((b) => [b.code, b]));
    const gymById = new Map(gyms.map((g) => [g.id, g.name]));
    const opponentById = new Map(opponents.map((o) => [o.id, { username: o.username, fullName: o.profile?.fullName ?? null }]));
    const myReaction = new Map(mine.map((r) => [r.activityEventId, r.type]));
    const commentCount = new Map(comments.map((c) => [c.activityEventId, c._count]));
    const str = (v: unknown) => (typeof v === 'string' ? v : null);

    return events.map((e, i) => {
      const p = payloads[i]!;
      const u = userById.get(e.userId);
      const badge = str(p.badge) ? badgeByCode.get(str(p.badge)!) : undefined;
      return {
        id: e.id,
        type: e.type,
        createdAt: e.createdAt.toISOString(),
        user: { id: e.userId, username: u?.username ?? null, fullName: u?.profile?.fullName ?? null },
        isMine: e.userId === me,
        details: {
          ...p,
          ...(str(p.sportId) && { sport: sportById.get(str(p.sportId)!) ?? null }),
          ...(str(p.exerciseId) && { exercise: exerciseById.get(str(p.exerciseId)!) ?? null }),
          ...(badge && { badgeName: badge.nameI18n, badgeIcon: badge.icon }),
          ...(str(p.gymId) && { gymName: gymById.get(str(p.gymId)!) ?? null }),
          ...(str(p.opponentId) && { opponent: opponentById.get(str(p.opponentId)!) ?? null }),
        },
        reactions: Object.fromEntries(REACTIONS.map((t) => [t, reactions.find((r) => r.activityEventId === e.id && r.type === t)?._count ?? 0])),
        myReaction: myReaction.get(e.id) ?? null,
        comments: commentCount.get(e.id) ?? 0,
      };
    });
  }

  // ───────────── Reactions ─────────────

  async react(me: string, activityId: string, type: ReactionType) {
    const e = await this.viewable(me, activityId);
    const existing = await this.prisma.activityReaction.findUnique({ where: { activityEventId_userId: { activityEventId: activityId, userId: me } } });
    await this.prisma.$transaction(async (tx) => {
      await tx.activityReaction.upsert({
        where: { activityEventId_userId: { activityEventId: activityId, userId: me } },
        create: { activityEventId: activityId, userId: me, type },
        update: { type },
      });
      // Notify the author once per athlete, not on every change of mind.
      if (!existing && e.userId !== me) await this.notifications.notify(tx, e.userId, 'ACTIVITY_REACTION', { activityId, type, byUserId: me });
    });
    return this.summary(me, activityId);
  }

  async unreact(me: string, activityId: string) {
    await this.viewable(me, activityId);
    await this.prisma.activityReaction.deleteMany({ where: { activityEventId: activityId, userId: me } });
    return this.summary(me, activityId);
  }

  private async summary(me: string, activityId: string) {
    const [counts, mine] = await Promise.all([
      this.prisma.activityReaction.groupBy({ by: ['type'], where: { activityEventId: activityId }, _count: true }),
      this.prisma.activityReaction.findUnique({ where: { activityEventId_userId: { activityEventId: activityId, userId: me } } }),
    ]);
    return { reactions: Object.fromEntries(REACTIONS.map((t) => [t, counts.find((c) => c.type === t)?._count ?? 0])), myReaction: mine?.type ?? null };
  }

  // ───────────── Comments ─────────────

  async comments(me: string, activityId: string, q: PageQueryDto) {
    await this.viewable(me, activityId);
    const blocked = await this.prisma.block.findMany({ where: { OR: [{ blockerId: me }, { blockedId: me }] } });
    const hidden = blocked.map((b) => (b.blockerId === me ? b.blockedId : b.blockerId));
    const c = q.cursor ? this.cursors.decode<{ id: string }>(q.cursor) : null;
    const rows = await this.prisma.activityComment.findMany({
      where: { activityEventId: activityId, deletedAt: null, userId: { notIn: hidden }, ...(c && { id: { gt: c.id } }) },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
      include: { user: { select: { username: true, profile: { select: { fullName: true } } } } },
    });
    const page = toPage(rows, q.limit, (r) => ({ id: r.id }), (k) => this.cursors.encode(k));
    return {
      data: page.data.map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt.toISOString(), user: { id: r.userId, username: r.user.username, fullName: r.user.profile?.fullName ?? null }, isMine: r.userId === me })),
      page: page.page,
    };
  }

  async comment(me: string, activityId: string, body: string) {
    const e = await this.viewable(me, activityId);
    const text = body.trim();
    if (!text) throw AppException.validation([{ field: 'body', code: 'EMPTY' }]);
    const id = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.activityComment.create({ data: { id, activityEventId: activityId, userId: me, body: text } });
      if (e.userId !== me) await this.notifications.notify(tx, e.userId, 'ACTIVITY_COMMENT', { activityId, commentId: id, byUserId: me });
    });
    return { id, body: text, createdAt: this.clock.now().toISOString(), isMine: true };
  }

  /** The author of a comment, or of the activity it is on, can delete it. */
  async deleteComment(me: string, activityId: string, commentId: string): Promise<void> {
    const c = await this.prisma.activityComment.findFirst({ where: { id: commentId, activityEventId: activityId, deletedAt: null }, include: { activityEvent: true } });
    if (!c) throw AppException.notFound('Comment');
    if (c.userId !== me && c.activityEvent.userId !== me) throw AppException.forbidden('You can only delete your comments or comments on your activity.');
    await this.prisma.activityComment.update({ where: { id: commentId }, data: { deletedAt: this.clock.now() } });
  }

  // ───────────── Mutes ─────────────

  async mute(me: string, userId: string): Promise<void> {
    if (userId === me) throw AppException.validation([{ field: 'userId', code: 'SELF' }]);
    if (!(await this.prisma.user.count({ where: { id: userId } }))) throw AppException.notFound('User');
    await this.prisma.mute.createMany({ data: [{ muterId: me, mutedId: userId }], skipDuplicates: true });
  }

  async unmute(me: string, userId: string): Promise<void> {
    await this.prisma.mute.deleteMany({ where: { muterId: me, mutedId: userId } });
  }

  private async viewable(me: string, activityId: string): Promise<ActivityEvent> {
    const e = await this.prisma.activityEvent.findUnique({ where: { id: activityId } });
    if (!e || !(await this.access.canView(me, e.userId, e.visibility))) throw AppException.notFound('Activity');
    return e;
  }
}
