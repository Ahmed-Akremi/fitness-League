import { Injectable, Logger } from '@nestjs/common';
import { Badge, Prisma } from '@prisma/client';
import { ClockService } from '../../common/clock/clock.service';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BadgeRule, currentStreak, FactKey, factKey, parseRule, progress } from './badge-rules';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Badge engine (docs §3.10, §8 `badge-evaluate`): enabled badges carry a JSON rule; `evaluate` gathers the facts
 * the rules need and awards what is newly met. Called on events (workout scored, battle / Gym War closed) and by a
 * daily sweep. Awards are never revoked automatically (`revoked_at` is for moderation).
 */
@Injectable()
export class BadgesService {
  private readonly logger = new Logger(BadgesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly clock: ClockService,
  ) {}

  /** Awards every enabled badge the athlete now meets. Returns the codes awarded. */
  async evaluate(db: Db, userId: string, sourceRef: string | null = null): Promise<string[]> {
    const [badges, owned] = await Promise.all([db.badge.findMany({ where: { enabled: true } }), db.userBadge.findMany({ where: { userId }, select: { badgeId: true } })]);
    const have = new Set(owned.map((o) => o.badgeId));
    const pending = badges
      .map((badge) => ({ badge, rule: parseRule(badge.rule) }))
      .filter((x): x is { badge: Badge; rule: BadgeRule } => x.rule !== null && !have.has(x.badge.id));
    if (!pending.length) return [];
    const facts = await this.facts(db, userId, new Set(pending.map((p) => factKey(p.rule))));
    const awarded: string[] = [];
    for (const { badge, rule } of pending) {
      if (!progress(rule, facts).met) continue;
      const created = await db.userBadge.createMany({ data: [{ id: uuidv7(), userId, badgeId: badge.id, sourceRef, awardedAt: this.clock.now() }], skipDuplicates: true });
      if (!created.count) continue;
      const ub = await db.userBadge.findUniqueOrThrow({ where: { userId_badgeId: { userId, badgeId: badge.id } } });
      await db.activityEvent.create({ data: { id: uuidv7(), userId, type: 'BADGE', refType: 'user_badge', refId: ub.id, visibility: 'FRIENDS', payload: { badge: badge.code } } });
      await this.notifications.notify(db, userId, 'BADGE_AWARDED', { badge: badge.code, name: badge.nameI18n as Prisma.InputJsonObject });
      awarded.push(badge.code);
    }
    return awarded;
  }

  /** Daily sweep: athletes with recent XP, friendships or gym approvals (catches what the event hooks miss). */
  async sweep(since: Date): Promise<{ users: number; awarded: number }> {
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM xp_transactions WHERE created_at >= ${since}
      UNION SELECT user_low_id FROM friendships WHERE status = 'ACCEPTED' AND updated_at >= ${since}
      UNION SELECT user_high_id FROM friendships WHERE status = 'ACCEPTED' AND updated_at >= ${since}
      UNION SELECT user_id FROM gym_members WHERE status = 'APPROVED' AND updated_at >= ${since}`;
    let awarded = 0;
    for (const r of rows) awarded += (await this.prisma.$transaction((tx) => this.evaluate(tx, r.user_id))).length;
    if (awarded) this.logger.log(`Badge sweep: ${awarded} badge(s) for ${rows.length} athlete(s)`);
    return { users: rows.length, awarded };
  }

  private async facts(db: Db, userId: string, needed: Set<FactKey>): Promise<Map<FactKey, number>> {
    const out = new Map<FactKey, number>();
    const add = async (key: FactKey, fn: () => Promise<number>) => {
      if (needed.has(key)) out.set(key, await fn());
    };
    await add('COUNT:WORKOUT_ACCEPTED', () => db.workout.count({ where: { userId, status: 'ACCEPTED', deletedAt: null } }));
    await add('COUNT:PR_AWARDED', () => db.personalRecord.count({ where: { userId, status: { in: ['AWARDED', 'SUPERSEDED'] } } }));
    await add('COUNT:BATTLE_WIN', () => db.battleParticipant.count({ where: { userId, outcome: 'WIN', battle: { type: 'FRIEND' } } }));
    await add('COUNT:DUEL_WIN', () => db.battleParticipant.count({ where: { userId, outcome: 'WIN', battle: { type: 'DUEL', isGhost: false } } }));
    await add('COUNT:GYM_WAR_WIN', () => db.activityEvent.count({ where: { userId, type: 'GYM_WAR_WIN' } }));
    await add('COUNT:GOAL_COMPLETED', () => db.goal.count({ where: { userId, status: 'COMPLETED', deletedAt: null } }));
    await add('COUNT:FRIEND', () => db.friendship.count({ where: { status: 'ACCEPTED', OR: [{ userLowId: userId }, { userHighId: userId }] } }));
    await add('COUNT:GYM_JOINED', () => db.gymMember.count({ where: { userId, status: 'APPROVED' } }));
    await add('COUNT:CHALLENGE_COMPLETED', () => db.challengeParticipant.count({ where: { userId, completedAt: { not: null } } }));
    await add('LEVEL', async () => (await db.userStats.findUnique({ where: { userId } }))?.level ?? 1);
    await add('DIVISION', async () => {
      const [stats, best] = await Promise.all([
        db.userStats.findUnique({ where: { userId }, include: { division: true } }),
        db.seasonStanding.findFirst({ where: { userId }, include: { division: true }, orderBy: { division: { order: 'desc' } } }),
      ]);
      return Math.max(stats?.division?.order ?? 0, best?.division.order ?? 0);
    });
    await add('STREAK_WEEKS', async () => {
      const weeks = await db.weeklyScore.findMany({ where: { userId, status: 'FINAL' }, orderBy: { weekStart: 'desc' }, take: 60, select: { weekStart: true, consistencyC: true } });
      return currentStreak(weeks.map((w) => ({ weekStart: w.weekStart, met: Number(w.consistencyC) >= 100 })));
    });
    return out;
  }

  // ───────────── Reads ─────────────

  /** Full catalogue with my progress and award date. */
  async catalog(me: string) {
    const [badges, owned] = await Promise.all([
      this.prisma.badge.findMany({ where: { enabled: true }, orderBy: [{ category: 'asc' }, { code: 'asc' }] }),
      this.prisma.userBadge.findMany({ where: { userId: me, revokedAt: null } }),
    ]);
    const rules = badges.map((badge) => ({ badge, rule: parseRule(badge.rule) }));
    const facts = await this.facts(this.prisma, me, new Set(rules.flatMap((r) => (r.rule ? [factKey(r.rule)] : []))));
    const awardedAt = new Map(owned.map((o) => [o.badgeId, o.awardedAt]));
    return rules.map(({ badge, rule }) => ({
      ...this.card(badge),
      awardedAt: awardedAt.get(badge.id)?.toISOString() ?? null,
      progress: rule ? progress(rule, facts) : null,
    }));
  }

  /** Badges an athlete earned, newest first. */
  async earned(userId: string) {
    const rows = await this.prisma.userBadge.findMany({ where: { userId, revokedAt: null, badge: { enabled: true } }, include: { badge: true }, orderBy: { awardedAt: 'desc' } });
    return rows.map((r) => ({ ...this.card(r.badge), awardedAt: r.awardedAt.toISOString() }));
  }

  private card(b: Badge) {
    return { code: b.code, category: b.category, name: b.nameI18n, description: b.descriptionI18n, icon: b.icon, rarity: b.rarity };
  }
}
