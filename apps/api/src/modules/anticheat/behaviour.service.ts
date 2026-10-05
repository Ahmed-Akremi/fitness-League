import { Injectable, Logger } from '@nestjs/common';
import { AnticheatFlagKind, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RuleSetService } from '../scoring/rule-set.service';
import { battleCollusion, farming, scoreSpike } from './behaviour';

const WEEK = 7 * 86_400_000;
const HISTORY_WEEKS = 12;

/**
 * Weekly behavioural scan (docs §7.3), run after the weekly close: score spikes against the athlete's own
 * history, minimum-duration farming, several accounts on one install that meet in battles, and friends trading
 * battle wins. It only raises flags for moderators (docs §7.1: no automatic punishment).
 */
@Injectable()
export class BehaviourService {
  private readonly logger = new Logger(BehaviourService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleSets: RuleSetService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  private dateCol(d: Date): Date {
    return new Date(`${this.calendar.localDate(d)}T00:00:00Z`);
  }

  async scanWeek(week: Date): Promise<Record<AnticheatFlagKind, number>> {
    const { config } = await this.ruleSets.getActive();
    const weekEnd = new Date(week.getTime() + WEEK);
    const col = this.dateCol(week);
    const out: Record<AnticheatFlagKind, number> = { SCORE_SPIKE: 0, FARMING: 0, SHARED_DEVICE: 0, BATTLE_COLLUSION: 0 };
    const flag = async (userId: string, kind: AnticheatFlagKind, details: Prisma.InputJsonObject) => {
      const r = await this.prisma.anticheatFlag.createMany({ data: [{ id: uuidv7(), userId, kind, weekStart: col, details }], skipDuplicates: true });
      out[kind] += r.count;
    };

    // Score spikes: this week's final total against the previous weeks.
    const scores = await this.prisma.weeklyScore.findMany({ where: { weekStart: col, status: 'FINAL' }, select: { userId: true, total: true } });
    for (const s of scores) {
      const past = await this.prisma.weeklyScore.findMany({
        where: { userId: s.userId, status: 'FINAL', weekStart: { lt: col, gte: this.dateCol(new Date(week.getTime() - HISTORY_WEEKS * WEEK)) } },
        select: { total: true },
      });
      const spike = scoreSpike(past.map((p) => Number(p.total)), Number(s.total));
      if (spike) await flag(s.userId, 'SCORE_SPIKE', { total: Number(s.total), ...spike });
    }

    // Farming: most of the week's workouts sit just above the minimum duration.
    const workouts = await this.prisma.workout.findMany({ where: { status: 'ACCEPTED', deletedAt: null, performedAt: { gte: week, lt: weekEnd } }, select: { userId: true, durationS: true } });
    const byUser = new Map<string, number[]>();
    for (const w of workouts) byUser.set(w.userId, [...(byUser.get(w.userId) ?? []), w.durationS]);
    for (const [userId, durations] of byUser) {
      const f = farming(durations, config.workout_min_duration_min * 60);
      if (f) await flag(userId, 'FARMING', { ...f, minDurationMin: config.workout_min_duration_min });
    }

    // Shared device: accounts on the same install that met in a battle closed this week.
    const shared = await this.prisma.$queryRaw<{ install_id: string; users: string[] }[]>`
      SELECT install_id, array_agg(DISTINCT user_id::text) AS users FROM devices GROUP BY install_id HAVING COUNT(DISTINCT user_id) > 1`;
    for (const d of shared) {
      const met = await this.prisma.battle.findMany({
        where: { status: 'COMPLETED', endsAt: { gte: week, lt: weekEnd }, participants: { every: { userId: { in: d.users } } } },
        select: { id: true, participants: { select: { userId: true } } },
      });
      const pairs = met.filter((b) => b.participants.length === 2);
      for (const userId of new Set(pairs.flatMap((b) => b.participants.map((p) => p.userId)))) {
        await flag(userId, 'SHARED_DEVICE', { installId: d.install_id.slice(0, 8), accounts: d.users.length, battles: pairs.map((b) => b.id) });
      }
    }

    // Collusion: friend battles of the season between the same pair, one of them closed this week, winners alternating.
    const closed = await this.prisma.battle.findMany({ where: { type: 'FRIEND', status: 'COMPLETED', endsAt: { gte: week, lt: weekEnd } }, include: { participants: true } });
    const seen = new Set<string>();
    for (const b of closed) {
      if (b.participants.length !== 2) continue;
      const [a, c] = [b.participants[0]!.userId, b.participants[1]!.userId].sort() as [string, string];
      const key = `${b.seasonId}|${a}|${c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const history = await this.prisma.battle.findMany({
        where: { type: 'FRIEND', status: 'COMPLETED', seasonId: b.seasonId, AND: [{ participants: { some: { userId: a } } }, { participants: { some: { userId: c } } }] },
        orderBy: { endsAt: 'asc' },
        include: { participants: true },
      });
      const outcomes = history.map((h) => h.participants.find((p) => p.userId === a)?.outcome ?? 'DRAW');
      const hit = battleCollusion(outcomes);
      if (hit) for (const userId of [a, c]) await flag(userId, 'BATTLE_COLLUSION', { ...hit, with: userId === a ? c : a });
    }

    const total = Object.values(out).reduce((x, y) => x + y, 0);
    if (total) this.logger.log(`Behavioural scan ${this.calendar.localDate(week)}: ${JSON.stringify(out)}`);
    return out;
  }

  // ───────────── Review ─────────────

  async openFlags() {
    const rows = await this.prisma.anticheatFlag.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, take: 100, include: { user: { select: { username: true, status: true } } } });
    return rows.map((f) => ({ id: f.id, userId: f.userId, username: f.user.username, userStatus: f.user.status, kind: f.kind, weekStart: f.weekStart.toISOString().slice(0, 10), details: f.details, createdAt: f.createdAt.toISOString() }));
  }

  async review(actor: AuthUser, id: string, status: 'CLEARED' | 'CONFIRMED', note: string) {
    const f = await this.prisma.anticheatFlag.findUnique({ where: { id } });
    if (!f) throw AppException.notFound('Flag');
    if (f.status !== 'OPEN') throw AppException.conflict(ErrorCode.CONFLICT, 'This flag was already reviewed.', { reason: 'FLAG_REVIEWED' });
    await this.prisma.$transaction(async (tx) => {
      await tx.anticheatFlag.update({ where: { id }, data: { status, reviewedById: actor.id, reviewedAt: this.clock.now(), note } });
      await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: `ANTICHEAT_FLAG_${status}`, entityType: 'user', entityId: f.userId, after: { flagId: id, kind: f.kind, note } }, tx);
    });
    return { id, status };
  }
}
