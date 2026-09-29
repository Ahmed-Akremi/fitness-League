import { Injectable } from '@nestjs/common';
import { Challenge, ChallengeScope, Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BadgesService } from '../badges/badges.service';
import { GymsService } from '../gyms/gyms.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RuleSetService } from '../scoring/rule-set.service';
import { measure } from './challenge-metrics';
import { CreateChallengeDto, ListChallengesQueryDto } from './challenges.dto';

const DAY = 86_400_000;
const MAX_DAYS = 90;
const STAFF: Role[] = ['ADMIN', 'SUPER_ADMIN'];
/** Scopes whose completion earns XP: personal and friend challenges are self-made, so they only count for badges. */
const REWARDED: ChallengeScope[] = ['COMMUNITY', 'GYM'];
/** Late logs are accepted for 72 h (docs §7): progress stays open that long after the end. */
const CLOSE_GRACE_MS = 72 * 3_600_000;

type Tx = Prisma.TransactionClient;

/**
 * Challenges (docs §3.10): personal, friend, community (staff) and gym (admin/coach) challenges on a workout-level
 * quantity over a window. Progress is recomputed from accepted workouts whenever the athlete's workouts change;
 * reaching the target completes the challenge (XP for community and gym challenges) and never un-completes it.
 */
@Injectable()
export class ChallengesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleSets: RuleSetService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly badges: BadgesService,
    private readonly gyms: GymsService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  // ───────────── Create / join ─────────────

  async create(user: AuthUser, dto: CreateChallengeDto) {
    const now = this.clock.now();
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt || endsAt <= now) throw AppException.validation([{ field: 'endsAt', code: 'INVALID_WINDOW' }]);
    if (endsAt.getTime() - startsAt.getTime() > MAX_DAYS * DAY) throw AppException.validation([{ field: 'endsAt', code: 'TOO_LONG' }]);
    if (dto.scope === 'GYM') {
      if (!dto.gymId) throw AppException.validation([{ field: 'gymId', code: 'REQUIRED' }]);
      await this.assertGymStaff(user, dto.gymId);
    } else if (dto.gymId) {
      throw AppException.validation([{ field: 'gymId', code: 'NOT_ALLOWED' }]);
    }
    if (dto.scope === 'COMMUNITY' && !STAFF.includes(user.role)) throw AppException.forbidden('Only staff can create community challenges.');
    const { config } = await this.ruleSets.getActive();
    const selfMade = dto.scope === 'PERSONAL' || dto.scope === 'FRIEND';
    const id = uuidv7();
    await this.prisma.challenge.create({
      data: {
        id,
        scope: dto.scope,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        metric: dto.metric,
        targetValue: dto.targetValue,
        startsAt,
        endsAt,
        gymId: dto.gymId ?? null,
        createdById: user.id,
        xpReward: REWARDED.includes(dto.scope) ? config.challenge_xp : 0,
        // Self-made challenges start with their author on board.
        ...(selfMade && { participants: { create: [{ userId: user.id, joinedAt: now }] } }),
      },
    });
    if (selfMade) await this.refreshFor(user.id);
    return this.get(user.id, id);
  }

  async join(me: string, id: string) {
    const c = await this.visible(me, id);
    if (c.scope === 'PERSONAL') throw AppException.forbidden('This challenge is personal.');
    if (c.status !== 'ACTIVE' || c.endsAt <= this.clock.now()) throw AppException.conflict(undefined, 'This challenge is over.', { reason: 'CHALLENGE_OVER' });
    await this.prisma.challengeParticipant.createMany({ data: [{ challengeId: id, userId: me, joinedAt: this.clock.now() }], skipDuplicates: true });
    await this.refreshFor(me);
    return this.get(me, id);
  }

  async leave(me: string, id: string) {
    const c = await this.visible(me, id);
    if (c.createdById === me && (c.scope === 'PERSONAL' || c.scope === 'FRIEND')) throw AppException.conflict(undefined, 'The author cannot leave; delete the challenge instead.');
    // A completed challenge stays on the athlete's record.
    await this.prisma.challengeParticipant.deleteMany({ where: { challengeId: id, userId: me, completedAt: null } });
    return this.get(me, id);
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const c = await this.prisma.challenge.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw AppException.notFound('Challenge');
    const allowed = c.createdById === user.id || STAFF.includes(user.role) || (c.gymId !== null && (await this.isGymStaff(user, c.gymId)));
    if (!allowed) throw AppException.forbidden('Only the author can delete this challenge.');
    await this.prisma.challenge.update({ where: { id }, data: { deletedAt: this.clock.now(), status: 'CANCELLED' } });
  }

  private async assertGymStaff(user: AuthUser, gymId: string): Promise<void> {
    if (!(await this.isGymStaff(user, gymId))) throw AppException.forbidden("Only this gym's admin or coaches can do that.");
  }

  private async isGymStaff(user: AuthUser, gymId: string): Promise<boolean> {
    const gym = await this.prisma.gym.findFirst({ where: { id: gymId, deletedAt: null, status: 'VERIFIED' } });
    if (!gym) throw AppException.notFound('Gym');
    if (this.gyms.canManage(user, gym)) return true;
    return (await this.prisma.gymMember.count({ where: { gymId, userId: user.id, status: 'APPROVED', role: 'COACH' } })) > 0;
  }

  // ───────────── Progress ─────────────

  /** Recomputes the athlete's open participations (called when their workouts change). Idempotent. */
  async refreshFor(userId: string): Promise<number> {
    const now = this.clock.now();
    const rows = await this.prisma.challengeParticipant.findMany({
      where: { userId, completedAt: null, challenge: { deletedAt: null, status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: new Date(now.getTime() - CLOSE_GRACE_MS) } } },
      include: { challenge: true },
    });
    let completed = 0;
    for (const p of rows) if (await this.recompute(p.challenge, userId)) completed++;
    return completed;
  }

  private async recompute(c: Challenge, userId: string): Promise<boolean> {
    const workouts = await this.prisma.workout.findMany({
      where: { userId, status: 'ACCEPTED', deletedAt: null, performedAt: { gte: c.startsAt, lt: c.endsAt } },
      select: { performedAt: true, durationS: true, totalDistanceM: true, totalVolumeKg: true },
    });
    const value = measure(
      c.metric,
      workouts.map((w) => ({ localDate: this.calendar.localDate(w.performedAt), durationS: w.durationS, distanceM: w.totalDistanceM, volumeKg: w.totalVolumeKg === null ? null : Number(w.totalVolumeKg) })),
    );
    const done = value >= Number(c.targetValue);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.challengeParticipant.updateMany({
        where: { challengeId: c.id, userId, completedAt: null },
        data: { progressValue: value, ...(done && { completedAt: this.clock.now() }) },
      });
      if (!done || count !== 1) return false;
      await this.complete(tx, c, userId);
      return true;
    });
  }

  private async complete(tx: Tx, c: Challenge, userId: string): Promise<void> {
    if (c.xpReward > 0) {
      const { version, config } = await this.ruleSets.getActive();
      const xp = await this.ledger.appendXp(
        tx,
        { userId, amount: c.xpReward, reason: 'CHALLENGE', sourceType: 'challenge', sourceId: c.id, ruleSetVersion: version, effectiveAt: this.clock.now(), explanation: { formula: 'challenge_xp', result: c.xpReward } },
        config,
      );
      await tx.challengeParticipant.update({ where: { challengeId_userId: { challengeId: c.id, userId } }, data: { xpTransactionId: xp.id } });
    }
    await this.notifications.notify(tx, userId, 'CHALLENGE_COMPLETED', { challengeId: c.id, title: c.title, xp: c.xpReward });
    await this.badges.evaluate(tx, userId, c.id);
  }

  /** Ends the challenges whose late-log grace has passed. */
  async closeDue(): Promise<{ closed: number }> {
    const { count } = await this.prisma.challenge.updateMany({ where: { status: 'ACTIVE', deletedAt: null, endsAt: { lte: new Date(this.clock.now().getTime() - CLOSE_GRACE_MS) } }, data: { status: 'ENDED' } });
    return { closed: count };
  }

  // ───────────── Reads ─────────────

  /** Challenges I can see: community, my gym's, my friends' friend challenges, and everything I joined or made. */
  async list(me: string, q: ListChallengesQueryDto) {
    const now = this.clock.now();
    const [profile, friends] = await Promise.all([this.prisma.profile.findUnique({ where: { userId: me } }), this.friendIds(me)]);
    const visibility: Prisma.ChallengeWhereInput[] = [
      { scope: 'COMMUNITY' },
      { participants: { some: { userId: me } } },
      { createdById: me },
      { scope: 'FRIEND', createdById: { in: friends } },
    ];
    if (profile?.primaryGymId) visibility.push({ scope: 'GYM', gymId: profile.primaryGymId });
    const ended = q.status === 'ENDED';
    const rows = await this.prisma.challenge.findMany({
      where: {
        deletedAt: null,
        OR: visibility,
        endsAt: ended ? { lte: now } : { gt: now },
        ...(q.scope && { scope: q.scope }),
        ...(q.mine && { participants: { some: { userId: me } } }),
      },
      orderBy: { endsAt: ended ? 'desc' : 'asc' },
      take: 50,
      include: { participants: { where: { userId: me } }, gym: { select: { id: true, name: true } }, _count: { select: { participants: true } } },
    });
    return rows.map((c) => this.card(c, c.participants[0] ?? null, c._count.participants));
  }

  async get(me: string, id: string) {
    const c = await this.visible(me, id);
    const [participants, count, mine, gym] = await Promise.all([
      this.prisma.challengeParticipant.findMany({
        where: { challengeId: id },
        orderBy: [{ progressValue: 'desc' }, { completedAt: 'asc' }, { joinedAt: 'asc' }],
        take: 50,
        include: { user: { select: { username: true, profile: { select: { fullName: true } } } } },
      }),
      this.prisma.challengeParticipant.count({ where: { challengeId: id } }),
      this.prisma.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId: id, userId: me } } }),
      c.gymId ? this.prisma.gym.findUnique({ where: { id: c.gymId }, select: { id: true, name: true } }) : null,
    ]);
    return {
      ...this.card({ ...c, gym }, mine, count),
      description: c.description,
      leaderboard: participants.map((p, i) => ({
        rank: i + 1,
        userId: p.userId,
        username: p.user.username,
        fullName: p.user.profile?.fullName ?? null,
        progress: Number(p.progressValue),
        completed: p.completedAt !== null,
      })),
    };
  }

  private card(c: Challenge & { gym?: { id: string; name: string } | null }, mine: { progressValue: Prisma.Decimal; completedAt: Date | null } | null, participants: number) {
    const now = this.clock.now();
    return {
      id: c.id,
      scope: c.scope,
      title: c.title,
      metric: c.metric,
      target: Number(c.targetValue),
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      status: c.deletedAt ? 'CANCELLED' : c.endsAt <= now ? 'ENDED' : c.startsAt > now ? 'UPCOMING' : 'ACTIVE',
      xpReward: c.xpReward,
      gym: c.gym ?? null,
      createdById: c.createdById,
      participants,
      joined: mine !== null,
      myProgress: mine ? Number(mine.progressValue) : null,
      completedAt: mine?.completedAt?.toISOString() ?? null,
    };
  }

  private async visible(me: string, id: string): Promise<Challenge> {
    const c = await this.prisma.challenge.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw AppException.notFound('Challenge');
    if (c.scope === 'COMMUNITY' || c.createdById === me) return c;
    if (await this.prisma.challengeParticipant.count({ where: { challengeId: id, userId: me } })) return c;
    if (c.scope === 'FRIEND' && (await this.friendIds(me)).includes(c.createdById)) return c;
    if (c.scope === 'GYM' && (await this.prisma.profile.count({ where: { userId: me, primaryGymId: c.gymId } }))) return c;
    throw AppException.notFound('Challenge');
  }

  private async friendIds(me: string): Promise<string[]> {
    const rows = await this.prisma.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ userLowId: me }, { userHighId: me }] } });
    return rows.map((f) => (f.userLowId === me ? f.userHighId : f.userLowId));
  }
}
