import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { CursorCodec } from '../../common/pagination/cursor';
import { PageQueryDto, toPage } from '../../common/pagination/page';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ageBracket, ageInYears } from '../auth/auth-policy';
import { NotificationsService } from '../notifications/notifications.service';
import { SocialAccess } from './social-access';

const pair = (a: string, b: string) => (a < b ? { userLowId: a, userHighId: b } : { userLowId: b, userHighId: a });

/** Friends (mutual), follows, blocks, athlete search and public profiles (spec §12). */
@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SocialAccess,
    private readonly notifications: NotificationsService,
    private readonly cursors: CursorCodec,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  private async target(me: string, userId: string) {
    if (me === userId) throw AppException.validation([{ field: 'userId', code: 'SELF' }]);
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    // Blocked users look like they don't exist.
    if (!u || u.status !== 'ACTIVE' || (await this.access.isBlockedEitherWay(me, userId))) throw AppException.notFound('Athlete');
    return u;
  }

  // ───────────── Friends ─────────────

  async request(me: string, userId: string) {
    await this.target(me, userId);
    const key = { userLowId_userHighId: pair(me, userId) };
    const existing = await this.prisma.friendship.findUnique({ where: key });
    if (existing?.status === 'ACCEPTED') throw AppException.conflict(ErrorCode.CONFLICT, 'Already friends.');
    if (existing?.requestedById === me) throw AppException.conflict(ErrorCode.CONFLICT, 'Request already sent.');
    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        // They had already asked me: asking back means yes.
        await tx.friendship.update({ where: key, data: { status: 'ACCEPTED', acceptedAt: this.clock.now() } });
        await this.notifications.notify(tx, userId, 'FRIEND_ACCEPTED', { userId: me });
        return { status: 'ACCEPTED' };
      }
      await tx.friendship.create({ data: { ...pair(me, userId), requestedById: me } });
      await this.notifications.notify(tx, userId, 'FRIEND_REQUEST', { userId: me });
      return { status: 'PENDING' };
    });
  }

  async respond(me: string, userId: string, accept: boolean) {
    const key = { userLowId_userHighId: pair(me, userId) };
    const f = await this.prisma.friendship.findUnique({ where: key });
    if (!f || f.status !== 'PENDING' || f.requestedById === me) throw AppException.notFound('Friend request');
    await this.prisma.$transaction(async (tx) => {
      if (accept) {
        await tx.friendship.update({ where: key, data: { status: 'ACCEPTED', acceptedAt: this.clock.now() } });
        await this.notifications.notify(tx, userId, 'FRIEND_ACCEPTED', { userId: me });
      } else {
        await tx.friendship.delete({ where: key });
      }
    });
    return { status: accept ? 'ACCEPTED' : 'DECLINED' };
  }

  async unfriend(me: string, userId: string): Promise<void> {
    await this.prisma.friendship.deleteMany({ where: pair(me, userId) });
  }

  async friends(me: string) {
    const rows = await this.prisma.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ userLowId: me }, { userHighId: me }] } });
    return this.summaries(rows.map((f) => (f.userLowId === me ? f.userHighId : f.userLowId)));
  }

  async requests(me: string, direction: 'in' | 'out') {
    const rows = await this.prisma.friendship.findMany({
      where: { status: 'PENDING', OR: [{ userLowId: me }, { userHighId: me }], requestedById: direction === 'out' ? me : { not: me } },
      orderBy: { createdAt: 'desc' },
    });
    return this.summaries(rows.map((f) => (f.userLowId === me ? f.userHighId : f.userLowId)));
  }

  // ───────────── Follows & blocks ─────────────

  async follow(me: string, userId: string): Promise<void> {
    await this.target(me, userId);
    await this.prisma.follow.upsert({ where: { followerId_followeeId: { followerId: me, followeeId: userId } }, update: {}, create: { followerId: me, followeeId: userId } });
  }

  async unfollow(me: string, userId: string): Promise<void> {
    await this.prisma.follow.deleteMany({ where: { followerId: me, followeeId: userId } });
  }

  /** Blocking cuts every link: friendship, follows both ways, pending battles between the two. */
  async block(me: string, userId: string): Promise<void> {
    if (me === userId) throw AppException.validation([{ field: 'userId', code: 'SELF' }]);
    await this.prisma.$transaction(async (tx) => {
      await tx.block.upsert({ where: { blockerId_blockedId: { blockerId: me, blockedId: userId } }, update: {}, create: { blockerId: me, blockedId: userId } });
      await tx.friendship.deleteMany({ where: pair(me, userId) });
      await tx.follow.deleteMany({ where: { OR: [{ followerId: me, followeeId: userId }, { followerId: userId, followeeId: me }] } });
      await tx.battle.updateMany({
        where: { status: 'PENDING', AND: [{ participants: { some: { userId: me } } }, { participants: { some: { userId } } }] },
        data: { status: 'CANCELLED' },
      });
    });
  }

  async unblock(me: string, userId: string): Promise<void> {
    await this.prisma.block.deleteMany({ where: { blockerId: me, blockedId: userId } });
  }

  // ───────────── Search & profiles ─────────────

  async search(me: string, q: string, page: PageQueryDto) {
    const c = page.cursor ? this.cursors.decode<{ u: string }>(page.cursor) : null;
    const blocked = await this.prisma.block.findMany({ where: { OR: [{ blockerId: me }, { blockedId: me }] } });
    const hidden = [me, ...blocked.map((b) => (b.blockerId === me ? b.blockedId : b.blockerId))];
    const where: Prisma.UserWhereInput = {
      status: 'ACTIVE',
      id: { notIn: hidden },
      OR: [{ username: { contains: q, mode: 'insensitive' } }, { profile: { fullName: { contains: q, mode: 'insensitive' } } }],
      ...(c && { username: { gt: c.u } }),
    };
    const rows = await this.prisma.user.findMany({ where, orderBy: { username: 'asc' }, take: page.limit + 1, select: { id: true, username: true } });
    const p = toPage(rows, page.limit, (r) => ({ u: r.username }), (k) => this.cursors.encode(k));
    return { data: await this.summaries(p.data.map((r) => r.id)), page: p.page };
  }

  async publicProfile(me: string, username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { profile: { include: { governorate: true, primaryGym: true } }, settings: true, stats: { include: { division: true } } },
    });
    if (!user || user.status !== 'ACTIVE' || (user.id !== me && (await this.access.isBlockedEitherWay(me, user.id)))) throw AppException.notFound('Athlete');
    const friendship = user.id === me ? null : await this.prisma.friendship.findUnique({ where: { userLowId_userHighId: pair(me, user.id) } });
    const [followers, following] = await Promise.all([this.prisma.follow.count({ where: { followeeId: user.id } }), this.prisma.follow.count({ where: { followerId: user.id } })]);
    const age = ageInYears(user.dateOfBirth.toISOString().slice(0, 10), this.calendar.localDate(this.clock.now()));
    return {
      id: user.id,
      username: user.username,
      fullName: user.profile?.fullName,
      bio: user.profile?.bio ?? null,
      // Never the date of birth; the bracket only if the athlete opted in (spec §5).
      ageBracket: user.settings?.showAgeBracket ? ageBracket(age) : null,
      governorate: user.profile && { code: user.profile.governorate.code, name: user.profile.governorate.nameI18n },
      gym: user.profile?.primaryGym ? { id: user.profile.primaryGym.id, name: user.profile.primaryGym.name } : null,
      level: user.stats?.level ?? 1,
      division: user.stats?.division?.code ?? null,
      seasonLp: user.stats?.seasonLp ?? 0,
      followers,
      following,
      friendship: friendship ? (friendship.status === 'ACCEPTED' ? 'FRIENDS' : friendship.requestedById === me ? 'REQUEST_SENT' : 'REQUEST_RECEIVED') : null,
    };
  }

  private async summaries(ids: string[]) {
    if (!ids.length) return [];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, include: { profile: { include: { governorate: true } }, stats: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return ids
      .map((id) => byId.get(id))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map((u) => ({ id: u.id, username: u.username, fullName: u.profile?.fullName, governorate: u.profile?.governorate.code, level: u.stats?.level ?? 1 }));
  }
}
