import { Injectable, Logger } from '@nestjs/common';
import { Battle, Prisma } from '@prisma/client';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { RuleSetConfig } from '../scoring/rule-set.schema';
import { RuleSetService } from '../scoring/rule-set.service';
import { NEW_PLAYER, Rating, ratePeriod } from './glicko2';
import { DuelCandidate, pairDuels, pairKey, WindowRules } from './matchmaking';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const ALL_COMPONENTS = ['progress', 'consistency', 'performance'];

type Tx = Prisma.TransactionClient;

/**
 * Weekly Duels (docs §6.1). Athletes opt in each week (Friday 00:00 → Monday 12:00); an hourly batch from Sunday 12:00
 * pairs them by MMR (Glicko-2) with a window that widens while they wait; whoever is left on Monday 12:00 gets a ghost
 * duel against their own previous week. A duel is a `battles` row of type DUEL covering the business week, so live
 * scores and closing reuse the Friend Battle machinery.
 */
@Injectable()
export class DuelsService {
  private readonly logger = new Logger(DuelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleSets: RuleSetService,
    private readonly notifications: NotificationsService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  // ───────────── Calendar ─────────────

  /** Week the queue is currently open for: from Friday 00:00 (next week) until Monday 12:00 (this week), else null. */
  queueWeek(now: Date): Date | null {
    const ws = this.calendar.weekStart(now);
    if (now.getTime() < ws.getTime() + 12 * HOUR) return ws;
    if (now.getTime() >= ws.getTime() + 4 * DAY) return new Date(ws.getTime() + WEEK);
    return null;
  }

  /** Week whose pairing batches run now: Sunday 12:00 → Monday 12:00 around its start, else null. */
  pairingWeek(now: Date): Date | null {
    const target = this.calendar.weekStart(new Date(now.getTime() + 12 * HOUR));
    const t = now.getTime();
    return t >= target.getTime() - 12 * HOUR && t < target.getTime() + 12 * HOUR ? target : null;
  }

  private dateCol(weekStart: Date): Date {
    return new Date(`${this.calendar.localDate(weekStart)}T00:00:00Z`);
  }

  // ───────────── Queue ─────────────

  async status(me: string) {
    const now = this.clock.now();
    const week = this.queueWeek(now);
    const current = this.calendar.weekStart(now);
    const [entry, rating, duel] = await Promise.all([
      week ? this.prisma.duelQueueEntry.findUnique({ where: { userId_weekStart: { userId: me, weekStart: this.dateCol(week) } } }) : null,
      this.prisma.mmrRating.findUnique({ where: { userId: me } }),
      this.prisma.battle.findFirst({ where: { type: 'DUEL', status: 'ACTIVE', participants: { some: { userId: me } } }, orderBy: { startsAt: 'desc' }, include: { participants: true } }),
    ]);
    const nextOpen = new Date(current.getTime() + 4 * DAY);
    return {
      queueOpen: week !== null,
      weekStart: week ? this.calendar.localDate(week) : null,
      opensAt: week ? null : nextOpen.toISOString(),
      closesAt: week ? new Date(week.getTime() + 12 * HOUR).toISOString() : null,
      entry: entry && entry.status !== 'LEFT' ? { status: entry.status, joinedAt: entry.joinedAt.toISOString(), battleId: entry.battleId } : null,
      rating: { rating: Math.round(Number(rating?.rating ?? NEW_PLAYER.rating)), rd: Math.round(Number(rating?.rd ?? NEW_PLAYER.rd)), games: rating?.games ?? 0 },
      currentDuel: duel ? { battleId: duel.id, isGhost: duel.isGhost, opponentId: duel.participants.find((p) => p.userId !== me)?.userId ?? null, endsAt: duel.endsAt.toISOString() } : null,
    };
  }

  async join(me: string) {
    const now = this.clock.now();
    const week = this.queueWeek(now);
    if (!week) throw AppException.conflict(ErrorCode.CONFLICT, 'The duel queue opens on Friday.', { reason: 'QUEUE_CLOSED' });
    const { config } = await this.ruleSets.getActive();
    const reason = await this.ineligibility(me, now, config);
    if (reason) throw AppException.validation([{ field: 'user', code: reason }]);
    const weekStart = this.dateCol(week);
    const existing = await this.prisma.duelQueueEntry.findUnique({ where: { userId_weekStart: { userId: me, weekStart } } });
    if (!existing) {
      await this.prisma.duelQueueEntry.create({ data: { id: uuidv7(), userId: me, weekStart, joinedAt: now } });
    } else if (existing.status === 'LEFT') {
      await this.prisma.duelQueueEntry.update({ where: { id: existing.id }, data: { status: 'WAITING', joinedAt: now } });
    }
    return this.status(me);
  }

  async leave(me: string) {
    const week = this.queueWeek(this.clock.now());
    if (week) {
      // Only a waiting entry can leave: once matched, the duel is on.
      await this.prisma.duelQueueEntry.updateMany({ where: { userId: me, weekStart: this.dateCol(week), status: 'WAITING' }, data: { status: 'LEFT' } });
    }
    return this.status(me);
  }

  /** Hard constraints that depend on the athlete alone (docs §6.1): past calibration, trained recently. */
  private async ineligibility(userId: string, now: Date, config: RuleSetConfig): Promise<string | null> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile?.calibrationEndsAt || profile.calibrationEndsAt > now) return 'CALIBRATION';
    const recent = await this.prisma.workout.count({ where: { userId, status: 'ACCEPTED', deletedAt: null, performedAt: { gte: new Date(now.getTime() - config.duel.recent_activity_days * DAY) } } });
    return recent === 0 ? 'NO_RECENT_ACTIVITY' : null;
  }

  // ───────────── Matchmaking (worker, hourly) ─────────────

  /** One pairing batch for the week being paired now, or the ghost fallback once Monday 12:00 has passed. Idempotent. */
  async runMatchmaking(now: Date = this.clock.now()): Promise<{ week: string; paired: number; ghosts: number } | null> {
    const { version, config } = await this.ruleSets.getActive();
    const week = this.pairingWeek(now);
    if (week) return { week: this.calendar.localDate(week), paired: await this.pairBatch(week, now, config, version), ghosts: 0 };
    // After Monday 12:00: whoever is still waiting for this week gets a ghost duel.
    const current = this.calendar.weekStart(now);
    const ghosts = await this.ghostFallback(current, version);
    return ghosts ? { week: this.calendar.localDate(current), paired: 0, ghosts } : null;
  }

  private async pairBatch(week: Date, now: Date, config: RuleSetConfig, version: number): Promise<number> {
    const waiting = await this.prisma.duelQueueEntry.findMany({ where: { weekStart: this.dateCol(week), status: 'WAITING' } });
    if (waiting.length < 2) return 0;
    const batchStart = week.getTime() - 12 * HOUR;
    const candidates: DuelCandidate[] = [];
    for (const e of waiting) {
      if (await this.ineligibility(e.userId, now, config)) continue;
      const [rating, stats, days] = await Promise.all([
        this.prisma.mmrRating.findUnique({ where: { userId: e.userId } }),
        this.prisma.userStats.findUnique({ where: { userId: e.userId }, include: { division: true } }),
        this.trainingDays(e.userId, new Date(week.getTime() - 4 * WEEK), week),
      ]);
      candidates.push({
        userId: e.userId,
        mmr: Number(rating?.rating ?? NEW_PLAYER.rating),
        division: stats?.division?.order ?? 1,
        avgTrainingDays: days / 4,
        hoursWaiting: (now.getTime() - Math.max(e.joinedAt.getTime(), batchStart)) / HOUR,
      });
    }
    const forbidden = await this.forbiddenPairs(candidates.map((c) => c.userId), week, config);
    const w: WindowRules = { base: config.duel.window_base, step: config.duel.window_step, stepHours: config.duel.window_step_hours, max: config.duel.window_max };
    const pairs = pairDuels(candidates, forbidden, w);
    const season = await this.prisma.season.findFirst({ where: { status: 'ACTIVE' } });
    if (!season) return 0;
    let created = 0;
    for (const [a, b] of pairs) {
      const ok = await this.prisma
        .$transaction(async (tx) => {
          // Both entries must still be waiting (a user could leave between the read and now).
          const { count } = await tx.duelQueueEntry.updateMany({ where: { weekStart: this.dateCol(week), status: 'WAITING', userId: { in: [a, b] } }, data: { status: 'MATCHED' } });
          if (count !== 2) throw new PairingRace();
          const battle = await this.createDuel(tx, [a, b], week, season.id, version, {});
          await tx.duelQueueEntry.updateMany({ where: { weekStart: this.dateCol(week), userId: { in: [a, b] } }, data: { battleId: battle.id } });
          await this.notifications.notify(tx, a, 'DUEL_MATCHED', { battleId: battle.id, opponentId: b });
          await this.notifications.notify(tx, b, 'DUEL_MATCHED', { battleId: battle.id, opponentId: a });
          return true;
        })
        .catch((err) => {
          if (err instanceof PairingRace) return false;
          throw err;
        });
      if (ok) created++;
    }
    return created;
  }

  /** Relational hard constraints: friends, blocked, same gym (configurable), rematch within `no_rematch_weeks`. */
  private async forbiddenPairs(ids: string[], week: Date, config: RuleSetConfig): Promise<Set<string>> {
    const out = new Set<string>();
    const [friends, blocks, profiles, recent] = await Promise.all([
      this.prisma.friendship.findMany({ where: { status: 'ACCEPTED', userLowId: { in: ids }, userHighId: { in: ids } } }),
      this.prisma.block.findMany({ where: { blockerId: { in: ids }, blockedId: { in: ids } } }),
      config.duel.same_gym_allowed ? [] : this.prisma.profile.findMany({ where: { userId: { in: ids }, primaryGymId: { not: null } }, select: { userId: true, primaryGymId: true } }),
      this.prisma.battle.findMany({
        where: { type: 'DUEL', isGhost: false, startsAt: { gte: new Date(week.getTime() - config.duel.no_rematch_weeks * WEEK) }, participants: { some: { userId: { in: ids } } } },
        include: { participants: { select: { userId: true } } },
      }),
    ]);
    for (const f of friends) out.add(pairKey(f.userLowId, f.userHighId));
    for (const b of blocks) out.add(pairKey(b.blockerId, b.blockedId));
    for (const p of profiles) for (const q of profiles) if (p.userId < q.userId && p.primaryGymId === q.primaryGymId) out.add(pairKey(p.userId, q.userId));
    for (const r of recent) if (r.participants.length === 2) out.add(pairKey(r.participants[0]!.userId, r.participants[1]!.userId));
    return out;
  }

  private async ghostFallback(week: Date, version: number): Promise<number> {
    const left = await this.prisma.duelQueueEntry.findMany({ where: { weekStart: this.dateCol(week), status: 'WAITING' } });
    if (!left.length) return 0;
    const season = await this.prisma.season.findFirst({ where: { status: 'ACTIVE' } });
    if (!season) return 0;
    const previous = this.dateCol(new Date(week.getTime() - WEEK));
    let created = 0;
    for (const e of left) {
      const ok = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.duelQueueEntry.updateMany({ where: { id: e.id, status: 'WAITING' }, data: { status: 'GHOST' } });
        if (count !== 1) return false;
        const last = await tx.weeklyScore.findUnique({ where: { userId_weekStart: { userId: e.userId, weekStart: previous } } });
        const target = last ? Number(last.total) : 0;
        const battle = await this.createDuel(tx, [e.userId], week, season.id, version, { ghostTarget: target });
        await tx.duelQueueEntry.update({ where: { id: e.id }, data: { battleId: battle.id } });
        await this.notifications.notify(tx, e.userId, 'DUEL_GHOST', { battleId: battle.id, target });
        return true;
      });
      if (ok) created++;
    }
    if (created) this.logger.log(`Ghost duels for ${created} athlete(s), week ${this.calendar.localDate(week)}`);
    return created;
  }

  private createDuel(tx: Tx, userIds: string[], week: Date, seasonId: string, version: number, extra: Record<string, number>): Promise<Battle> {
    const now = this.clock.now();
    return tx.battle.create({
      data: {
        id: uuidv7(),
        type: 'DUEL',
        status: 'ACTIVE',
        createdById: userIds[0]!,
        seasonId,
        startsAt: week,
        endsAt: new Date(week.getTime() + WEEK),
        durationDays: 7,
        isGhost: userIds.length === 1,
        config: { components: ALL_COMPONENTS, ...extra },
        ruleSetVersion: version,
        participants: { create: userIds.map((userId) => ({ userId, acceptedAt: now })) },
      },
    });
  }

  private async trainingDays(userId: string, from: Date, to: Date): Promise<number> {
    const rows = await this.prisma.workout.findMany({ where: { userId, status: 'ACCEPTED', deletedAt: null, performedAt: { gte: from, lt: to } }, select: { performedAt: true } });
    return new Set(rows.map((r) => this.calendar.localDate(r.performedAt))).size;
  }

  // ───────────── Rating (called when a duel closes) ─────────────

  /** Glicko-2 update for both sides of a closed duel, in the closing transaction. Ghost duels never move MMR. */
  async rate(tx: Tx, battle: Battle, outcomes: { userId: string; score: number }[], tau: number): Promise<void> {
    const period = this.dateCol(this.calendar.weekStart(battle.startsAt));
    const before = new Map<string, Rating>();
    for (const o of outcomes) before.set(o.userId, await this.currentRating(tx, o.userId, period));
    for (const o of outcomes) {
      const opponent = outcomes.find((x) => x.userId !== o.userId)!;
      const next = ratePeriod(before.get(o.userId)!, [{ opponent: before.get(opponent.userId)!, score: o.score }], tau);
      const data = { rating: next.rating, rd: next.rd, volatility: next.volatility, lastPeriod: period };
      await tx.mmrRating.upsert({ where: { userId: o.userId }, create: { userId: o.userId, ...data, games: 1 }, update: { ...data, games: { increment: 1 } } });
    }
  }

  /** Stored rating with the RD growth of every week missed since the last rated one. */
  private async currentRating(tx: Tx, userId: string, period: Date): Promise<Rating> {
    const row = await tx.mmrRating.findUnique({ where: { userId } });
    if (!row) return NEW_PLAYER;
    let r: Rating = { rating: Number(row.rating), rd: Number(row.rd), volatility: Number(row.volatility) };
    const idle = row.lastPeriod ? Math.max(0, Math.round((period.getTime() - row.lastPeriod.getTime()) / WEEK) - 1) : 0;
    for (let i = 0; i < idle; i++) r = ratePeriod(r, []);
    return r;
  }
}

class PairingRace extends Error {}
