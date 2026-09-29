import { Injectable } from '@nestjs/common';
import { League, Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateLeagueDto } from './leagues.dto';

const DAY = 86_400_000;
const MAX_DAYS = 366;
/** Unambiguous alphabet for invite codes typed by hand (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_OWNED_ACTIVE = 5;

const PRESET_COLUMN = { STANDARD: 'total', CONSISTENCY: 'consistency_c', PROGRESS: 'progress_c' } as const;

/**
 * Private and public leagues (docs §3.10): a user-made group ranked on its members' weekly scores over a period.
 * The preset picks which weekly number is summed (total, consistency or progress), so a league of beginners and
 * veterans stays fair the same way the national league is.
 */
@Injectable()
export class LeaguesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  async create(me: string, dto: CreateLeagueDto) {
    const now = this.clock.now();
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : this.calendar.weekStart(now);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt || endsAt <= now) throw AppException.validation([{ field: 'endsAt', code: 'INVALID_WINDOW' }]);
    if (endsAt.getTime() - startsAt.getTime() > MAX_DAYS * DAY) throw AppException.validation([{ field: 'endsAt', code: 'TOO_LONG' }]);
    const owned = await this.prisma.league.count({ where: { ownerId: me, deletedAt: null, endsAt: { gt: now } } });
    if (owned >= MAX_OWNED_ACTIVE) throw AppException.conflict(ErrorCode.CONFLICT, 'You already run the maximum number of leagues.', { reason: 'TOO_MANY_LEAGUES' });
    const id = uuidv7();
    const name = dto.name.trim();
    for (let attempt = 0; ; attempt++) {
      try {
        await this.prisma.league.create({
          data: {
            id,
            name,
            slug: `${slugify(name) || 'league'}-${code(4).toLowerCase()}`,
            visibility: dto.visibility ?? 'PRIVATE',
            inviteCode: code(8),
            ownerId: me,
            maxMembers: dto.maxMembers ?? 50,
            startsAt,
            endsAt,
            scoringPreset: dto.scoringPreset ?? 'STANDARD',
            members: { create: [{ userId: me, role: 'OWNER', joinedAt: now }] },
          },
        });
        break;
      } catch (err) {
        // A slug or invite code collision: draw again.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') || attempt >= 4) throw err;
      }
    }
    return this.get(me, id);
  }

  /** Leagues I belong to, then public leagues still running that I could join. */
  async list(me: string) {
    const now = this.clock.now();
    const active = { where: { leftAt: null } } as const;
    const [mine, open] = await Promise.all([
      this.prisma.league.findMany({
        where: { deletedAt: null, members: { some: { userId: me, leftAt: null } } },
        orderBy: { endsAt: 'desc' },
        include: { _count: { select: { members: active } } },
      }),
      this.prisma.league.findMany({
        where: { deletedAt: null, visibility: 'PUBLIC', endsAt: { gt: now }, members: { none: { userId: me, leftAt: null } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { _count: { select: { members: active } } },
      }),
    ]);
    return { mine: mine.map((l) => this.card(l, l._count.members, true)), public: open.map((l) => this.card(l, l._count.members, false)) };
  }

  async get(me: string, id: string) {
    const league = await this.prisma.league.findFirst({ where: { id, deletedAt: null } });
    if (!league) throw AppException.notFound('League');
    const [membership, count] = await Promise.all([
      this.prisma.leagueMember.findUnique({ where: { leagueId_userId: { leagueId: id, userId: me } } }),
      this.prisma.leagueMember.count({ where: { leagueId: id, leftAt: null } }),
    ]);
    const isMember = !!membership && membership.leftAt === null;
    // A private league is only visible to its members (the invite code is the way in).
    if (league.visibility === 'PRIVATE' && !isMember) throw AppException.notFound('League');
    return {
      ...this.card(league, count, isMember),
      myRole: isMember ? membership.role : null,
      // Only members can share the invite code.
      inviteCode: isMember ? league.inviteCode : null,
    };
  }

  async join(me: string, id: string) {
    const league = await this.prisma.league.findFirst({ where: { id, deletedAt: null } });
    if (!league || league.visibility === 'PRIVATE') throw AppException.notFound('League');
    await this.addMember(me, league);
    return this.get(me, id);
  }

  async joinByCode(me: string, inviteCode: string) {
    const league = await this.prisma.league.findFirst({ where: { inviteCode: inviteCode.trim().toUpperCase(), deletedAt: null } });
    if (!league) throw AppException.validation([{ field: 'code', code: 'UNKNOWN_CODE' }]);
    await this.addMember(me, league);
    return this.get(me, league.id);
  }

  private async addMember(me: string, league: League): Promise<void> {
    if (league.endsAt <= this.clock.now()) throw AppException.conflict(ErrorCode.CONFLICT, 'This league is over.', { reason: 'LEAGUE_OVER' });
    await this.prisma.$transaction(async (tx) => {
      // Serialise joins on the league row so the member cap holds under concurrency.
      await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${league.id}::uuid FOR UPDATE`;
      const existing = await tx.leagueMember.findUnique({ where: { leagueId_userId: { leagueId: league.id, userId: me } } });
      if (existing && existing.leftAt === null) return;
      const count = await tx.leagueMember.count({ where: { leagueId: league.id, leftAt: null } });
      if (count >= league.maxMembers) throw AppException.conflict(ErrorCode.CONFLICT, 'This league is full.', { reason: 'LEAGUE_FULL' });
      if (existing) await tx.leagueMember.update({ where: { leagueId_userId: { leagueId: league.id, userId: me } }, data: { leftAt: null, joinedAt: this.clock.now() } });
      else await tx.leagueMember.create({ data: { leagueId: league.id, userId: me, joinedAt: this.clock.now() } });
    });
  }

  async leave(me: string, id: string): Promise<void> {
    const m = await this.prisma.leagueMember.findUnique({ where: { leagueId_userId: { leagueId: id, userId: me } } });
    if (!m || m.leftAt) throw AppException.notFound('League');
    if (m.role === 'OWNER') throw AppException.conflict(ErrorCode.CONFLICT, 'The owner cannot leave; delete the league instead.', { reason: 'OWNER_CANNOT_LEAVE' });
    await this.prisma.leagueMember.update({ where: { leagueId_userId: { leagueId: id, userId: me } }, data: { leftAt: this.clock.now() } });
  }

  async removeMember(me: string, id: string, userId: string): Promise<void> {
    await this.assertOwner(me, id);
    if (userId === me) throw AppException.validation([{ field: 'userId', code: 'OWNER' }]);
    await this.prisma.leagueMember.updateMany({ where: { leagueId: id, userId, leftAt: null }, data: { leftAt: this.clock.now() } });
  }

  async remove(me: string, id: string): Promise<void> {
    await this.assertOwner(me, id);
    await this.prisma.league.update({ where: { id }, data: { deletedAt: this.clock.now() } });
  }

  private async assertOwner(me: string, id: string): Promise<void> {
    const league = await this.prisma.league.findFirst({ where: { id, deletedAt: null } });
    if (!league) throw AppException.notFound('League');
    if (league.ownerId !== me) throw AppException.forbidden('Only the league owner can do that.');
  }

  /**
   * Members ranked by the sum of their weekly scores (per the preset) for the weeks of the league period.
   * A week counts once it is scored, so the current week appears after the weekly close.
   */
  async leaderboard(me: string, id: string) {
    const league = await this.get(me, id);
    // DATE columns compared as dates: a timestamptz parameter would be shifted by the session time zone.
    const from = this.calendar.localDate(this.calendar.weekStart(new Date(league.startsAt)));
    const to = this.calendar.localDate(new Date(league.endsAt));
    const column = Prisma.raw(PRESET_COLUMN[league.scoringPreset]);
    const rows = await this.prisma.$queryRaw<{ user_id: string; username: string; full_name: string | null; points: string; weeks: number }[]>`
      SELECT m.user_id, u.username, p.full_name,
             COALESCE(SUM(w.${column}), 0)::text AS points,
             COUNT(w.id)::int AS weeks
      FROM league_members m
      JOIN users u ON u.id = m.user_id AND u.status = 'ACTIVE'
      LEFT JOIN profiles p ON p.user_id = m.user_id
      LEFT JOIN weekly_scores w ON w.user_id = m.user_id AND w.week_start >= ${from}::date AND w.week_start < ${to}::date
      WHERE m.league_id = ${id}::uuid AND m.left_at IS NULL
      GROUP BY m.user_id, u.username, p.full_name
      ORDER BY COALESCE(SUM(w.${column}), 0) DESC, u.username ASC`;
    let rank = 0;
    let previous: number | null = null;
    return {
      league: { id: league.id, name: league.name, scoringPreset: league.scoringPreset },
      data: rows.map((r, i) => {
        const points = Math.round(Number(r.points) * 10) / 10;
        if (points !== previous) rank = i + 1;
        previous = points;
        return { rank, userId: r.user_id, username: r.username, fullName: r.full_name, points, weeks: r.weeks, isMe: r.user_id === me };
      }),
    };
  }

  private card(l: League, members: number, isMember: boolean) {
    const now = this.clock.now();
    return {
      id: l.id,
      name: l.name,
      slug: l.slug,
      visibility: l.visibility,
      scoringPreset: l.scoringPreset,
      startsAt: l.startsAt.toISOString(),
      endsAt: l.endsAt.toISOString(),
      status: l.endsAt <= now ? 'ENDED' : l.startsAt > now ? 'UPCOMING' : 'ACTIVE',
      members,
      maxMembers: l.maxMembers,
      ownerId: l.ownerId,
      isMember,
    };
  }
}

function code(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}
