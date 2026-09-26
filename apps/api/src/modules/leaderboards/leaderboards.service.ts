import { Injectable } from '@nestjs/common';
import { LeaderboardScope, Prisma } from '@prisma/client';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app-exception';
import { NIL_UUID } from '../../common/ids/uuid';
import { CursorCodec } from '../../common/pagination/cursor';
import { PrismaService } from '../../common/prisma/prisma.service';

export type Scope = { type: 'NATIONAL' } | { type: 'GOVERNORATE'; id: string } | { type: 'GYM'; id: string } | { type: 'FRIENDS'; userId: string };

interface Row {
  user_id: string;
  lp: number;
  level: number;
  rank: bigint;
  username: string;
  full_name: string;
  governorate_id: string;
  governorate_code: string;
  governorate_name: Prisma.JsonValue;
  gym_id: string | null;
  gym_name: string | null;
  division: string | null;
}

/**
 * Leaderboards (docs §15), computed in PostgreSQL over `user_stats`.
 * ASSUMPTION: the spec's Redis sorted sets are an optimisation for later; the same API sits on top of either.
 * Only eligible athletes appear: active, verified email, past calibration, opted in.
 */
@Injectable()
export class LeaderboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cursors: CursorCodec,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  private async seasonId(seasonId?: string): Promise<string> {
    const season = seasonId
      ? await this.prisma.season.findUnique({ where: { id: seasonId } })
      : await this.prisma.season.findFirst({ where: { status: 'ACTIVE' }, orderBy: { startsAt: 'desc' } });
    if (!season) throw AppException.notFound('Season');
    return season.id;
  }

  private scopeFilter(scope: Scope): Prisma.Sql {
    switch (scope.type) {
      case 'NATIONAL':
        return Prisma.empty;
      case 'GOVERNORATE':
        return Prisma.sql`AND p.governorate_id = ${scope.id}::uuid`;
      case 'GYM':
        return Prisma.sql`AND p.primary_gym_id = ${scope.id}::uuid`;
      case 'FRIENDS':
        return Prisma.sql`AND (us.user_id = ${scope.userId}::uuid OR us.user_id IN (
          SELECT CASE WHEN f.user_low_id = ${scope.userId}::uuid THEN f.user_high_id ELSE f.user_low_id END
          FROM friendships f WHERE f.status = 'ACCEPTED' AND (f.user_low_id = ${scope.userId}::uuid OR f.user_high_id = ${scope.userId}::uuid)))`;
    }
  }

  private ranked(seasonId: string, scope: Scope): Prisma.Sql {
    return Prisma.sql`
      SELECT us.user_id, us.season_lp AS lp, us.level, RANK() OVER (ORDER BY us.season_lp DESC) AS rank,
             u.username, p.full_name, p.governorate_id, gov.code AS governorate_code, gov.name_i18n AS governorate_name,
             p.primary_gym_id AS gym_id, g.name AS gym_name, d.code::text AS division
      FROM user_stats us
      JOIN users u ON u.id = us.user_id
      JOIN profiles p ON p.user_id = us.user_id
      JOIN user_settings s ON s.user_id = us.user_id
      JOIN governorates gov ON gov.id = p.governorate_id
      LEFT JOIN gyms g ON g.id = p.primary_gym_id
      LEFT JOIN divisions d ON d.id = us.division_id
      WHERE us.current_season_id = ${seasonId}::uuid
        AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL
        AND p.calibration_ends_at IS NOT NULL AND p.calibration_ends_at <= now()
        AND s.show_on_leaderboards
        ${this.scopeFilter(scope)}`;
  }

  async page(scope: Scope, opts: { seasonId?: string; limit: number; cursor?: string }) {
    const seasonId = await this.seasonId(opts.seasonId);
    const c = opts.cursor ? this.cursors.decode<{ lp: number; id: string }>(opts.cursor) : null;
    const after = c ? Prisma.sql`WHERE (t.lp < ${c.lp} OR (t.lp = ${c.lp} AND t.user_id > ${c.id}::uuid))` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT * FROM (${this.ranked(seasonId, scope)}) t ${after}
      ORDER BY t.lp DESC, t.user_id ASC LIMIT ${opts.limit + 1}`;
    return this.toPage(rows, opts.limit, seasonId, scope);
  }

  /** "Jump to my rank": the page that contains the user, positioned so they are near the middle. */
  async aroundMe(scope: Scope, userId: string, opts: { seasonId?: string; limit: number }) {
    const seasonId = await this.seasonId(opts.seasonId);
    const [me] = await this.prisma.$queryRaw<Row[]>`SELECT * FROM (${this.ranked(seasonId, scope)}) t WHERE t.user_id = ${userId}::uuid`;
    if (!me) return { seasonId, me: null, data: [], page: { nextCursor: null, hasMore: false } };
    const above = Math.floor(opts.limit / 2);
    const before = await this.prisma.$queryRaw<Row[]>`
      SELECT * FROM (${this.ranked(seasonId, scope)}) t
      WHERE t.lp > ${me.lp} OR (t.lp = ${me.lp} AND t.user_id < ${userId}::uuid)
      ORDER BY t.lp ASC, t.user_id DESC LIMIT ${above}`;
    const head = await this.decorate([...before].reverse().concat(me), seasonId, scope);
    const remaining = opts.limit - head.length;
    const after = remaining > 0 ? await this.page(scope, { seasonId, limit: remaining, cursor: this.cursors.encode({ lp: me.lp, id: me.user_id }) }) : null;
    return {
      seasonId,
      me: head[head.length - 1],
      data: [...head, ...(after?.data ?? [])],
      page: after?.page ?? { nextCursor: this.cursors.encode({ lp: me.lp, id: me.user_id }), hasMore: true },
    };
  }

  /** Home screen: my ranks in every scope. */
  async myRanks(userId: string) {
    const seasonId = await this.seasonId();
    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { userId } });
    const rankIn = async (scope: Scope) => {
      const [r] = await this.prisma.$queryRaw<Row[]>`SELECT * FROM (${this.ranked(seasonId, scope)}) t WHERE t.user_id = ${userId}::uuid`;
      return r ? Number(r.rank) : null;
    };
    return {
      seasonId,
      national: await rankIn({ type: 'NATIONAL' }),
      governorate: await rankIn({ type: 'GOVERNORATE', id: profile.governorateId }),
      gym: profile.primaryGymId ? await rankIn({ type: 'GYM', id: profile.primaryGymId }) : null,
      friends: await rankIn({ type: 'FRIENDS', userId }),
    };
  }

  /** Daily snapshot of ranks, the reference for movement arrows (docs §15). Idempotent per day. */
  async snapshot(date: Date): Promise<number> {
    const season = await this.prisma.season.findFirst({ where: { status: 'ACTIVE' } });
    if (!season) return 0;
    const day = new Date(`${this.calendar.localDate(date)}T00:00:00Z`);
    const eligible = Prisma.sql`
      FROM user_stats us JOIN users u ON u.id = us.user_id JOIN profiles p ON p.user_id = us.user_id JOIN user_settings s ON s.user_id = us.user_id
      WHERE us.current_season_id = ${season.id}::uuid AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL
        AND p.calibration_ends_at IS NOT NULL AND p.calibration_ends_at <= now() AND s.show_on_leaderboards`;
    let n = 0;
    n += await this.prisma.$executeRaw`
      INSERT INTO leaderboard_snapshots (snapshot_date, season_id, scope_type, scope_id, user_id, rank, lp)
      SELECT ${day}::date, ${season.id}::uuid, 'NATIONAL', ${NIL_UUID}::uuid, us.user_id, RANK() OVER (ORDER BY us.season_lp DESC), us.season_lp ${eligible}
      ON CONFLICT DO NOTHING`;
    n += await this.prisma.$executeRaw`
      INSERT INTO leaderboard_snapshots (snapshot_date, season_id, scope_type, scope_id, user_id, rank, lp)
      SELECT ${day}::date, ${season.id}::uuid, 'GOVERNORATE', p.governorate_id, us.user_id, RANK() OVER (PARTITION BY p.governorate_id ORDER BY us.season_lp DESC), us.season_lp ${eligible}
      ON CONFLICT DO NOTHING`;
    n += await this.prisma.$executeRaw`
      INSERT INTO leaderboard_snapshots (snapshot_date, season_id, scope_type, scope_id, user_id, rank, lp)
      SELECT ${day}::date, ${season.id}::uuid, 'GYM', p.primary_gym_id, us.user_id, RANK() OVER (PARTITION BY p.primary_gym_id ORDER BY us.season_lp DESC), us.season_lp ${eligible} AND p.primary_gym_id IS NOT NULL
      ON CONFLICT DO NOTHING`;
    return n;
  }

  private async toPage(rows: Row[], limit: number, seasonId: string, scope: Scope) {
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const last = data[data.length - 1];
    return {
      seasonId,
      data: await this.decorate(data, seasonId, scope),
      page: { nextCursor: hasMore && last ? this.cursors.encode({ lp: last.lp, id: last.user_id }) : null, hasMore },
    };
  }

  /** Adds movement vs the latest earlier snapshot of the same scope (friends use national ranks: no snapshot). */
  private async decorate(rows: Row[], seasonId: string, scope: Scope) {
    const snapScope: { type: LeaderboardScope; id: string } | null =
      scope.type === 'NATIONAL' ? { type: 'NATIONAL', id: NIL_UUID } : scope.type === 'GOVERNORATE' ? { type: 'GOVERNORATE', id: scope.id } : scope.type === 'GYM' ? { type: 'GYM', id: scope.id } : null;
    const previous = new Map<string, number>();
    if (snapScope && rows.length) {
      const today = new Date(`${this.calendar.localDate(this.clock.now())}T00:00:00Z`);
      const latest = await this.prisma.leaderboardSnapshot.findFirst({
        where: { seasonId, scopeType: snapScope.type, scopeId: snapScope.id, snapshotDate: { lt: today } },
        orderBy: { snapshotDate: 'desc' },
      });
      if (latest) {
        const snaps = await this.prisma.leaderboardSnapshot.findMany({
          where: { seasonId, scopeType: snapScope.type, scopeId: snapScope.id, snapshotDate: latest.snapshotDate, userId: { in: rows.map((r) => r.user_id) } },
        });
        for (const s of snaps) previous.set(s.userId, s.rank);
      }
    }
    return rows.map((r) => {
      const rank = Number(r.rank);
      const prev = previous.get(r.user_id);
      return {
        rank,
        athlete: { id: r.user_id, username: r.username, fullName: r.full_name },
        gym: r.gym_id ? { id: r.gym_id, name: r.gym_name } : null,
        governorate: { id: r.governorate_id, code: r.governorate_code, name: r.governorate_name },
        lp: r.lp,
        level: r.level,
        division: r.division,
        movement: snapScope ? (prev === undefined ? 'NEW' : prev - rank) : null,
      };
    });
  }
}
