import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { AppException } from '../../common/errors/app-exception';
import { CursorCodec } from '../../common/pagination/cursor';
import { PageQueryDto, toPage } from '../../common/pagination/page';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SeasonsService } from './seasons.service';

class SeasonQueryDto extends PageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  seasonId?: string;
}

const seasonView = (s: { id: string; name: string; startsAt: Date; endsAt: Date; status: string }) => ({
  id: s.id,
  name: s.name,
  startsAt: s.startsAt.toISOString(),
  endsAt: s.endsAt.toISOString(),
  status: s.status,
});

@ApiTags('seasons')
@ApiBearerAuth()
@Controller()
export class SeasonsController {
  constructor(
    private readonly seasons: SeasonsService,
    private readonly prisma: PrismaService,
    private readonly cursors: CursorCodec,
  ) {}

  @Get('seasons/current')
  async current() {
    const s = await this.seasons.current();
    if (!s) throw AppException.notFound('Season');
    return seasonView(s);
  }

  @Get('seasons')
  async list() {
    return (await this.prisma.season.findMany({ orderBy: { startsAt: 'desc' } })).map(seasonView);
  }

  @Get('seasons/:id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const s = await this.prisma.season.findUnique({ where: { id } });
    if (!s) throw AppException.notFound('Season');
    return seasonView(s);
  }

  /** Archived final standings of a closed season (champions flagged). */
  @Get('seasons/:id/standings')
  async standings(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQueryDto) {
    const c = q.cursor ? this.cursors.decode<{ r: number; id: string }>(q.cursor) : null;
    const rows = await this.prisma.seasonStanding.findMany({
      where: { seasonId: id, rankNational: { not: null }, ...(c && { OR: [{ rankNational: { gt: c.r } }, { rankNational: c.r, userId: { gt: c.id } }] }) },
      include: { user: { select: { username: true, profile: { select: { fullName: true } } } }, division: true },
      orderBy: [{ rankNational: 'asc' }, { userId: 'asc' }],
      take: q.limit + 1,
    });
    const page = toPage(rows, q.limit, (r) => ({ r: r.rankNational, id: r.userId }), (k) => this.cursors.encode(k));
    return {
      data: page.data.map((r) => ({
        rank: r.rankNational,
        athlete: { id: r.userId, username: r.user.username, fullName: r.user.profile?.fullName },
        lp: r.finalLp,
        division: r.division.code,
        isChampion: r.isChampion,
        championScope: r.championScope,
      })),
      page: page.page,
    };
  }

  @Get('divisions')
  async divisions() {
    return (await this.prisma.division.findMany({ orderBy: { order: 'asc' } })).map((d) => ({ code: d.code, order: d.order, minLp: d.minLp, name: d.nameI18n }));
  }

  @Get('me/lp')
  lp(@CurrentUser() user: AuthUser, @Query() q: SeasonQueryDto) {
    return this.seasons.lp(user.id, q.seasonId);
  }

  @Get('me/lp/transactions')
  async lpTransactions(@CurrentUser() user: AuthUser, @Query() q: SeasonQueryDto) {
    const c = q.cursor ? this.cursors.decode<{ id: string }>(q.cursor) : null;
    const rows = await this.prisma.leaguePointTransaction.findMany({
      where: { userId: user.id, ...(q.seasonId && { seasonId: q.seasonId }), ...(c && { id: { lt: c.id } }) },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const page = toPage(rows, q.limit, (r) => ({ id: r.id }), (k) => this.cursors.encode(k));
    return {
      data: page.data.map((r) => ({ id: r.id, seasonId: r.seasonId, amount: r.amount, reason: r.reason, sourceId: r.sourceId, reversesId: r.reversesId, effectiveAt: r.effectiveAt.toISOString(), explanation: r.explanation })),
      page: page.page,
    };
  }

  @Get('me/weekly-scores/current')
  currentWeek(@CurrentUser() user: AuthUser) {
    return this.seasons.currentWeek(user.id);
  }

  @Get('me/weekly-scores')
  async weeklyScores(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    const c = q.cursor ? this.cursors.decode<{ w: string }>(q.cursor) : null;
    const rows = await this.prisma.weeklyScore.findMany({
      where: { userId: user.id, ...(c && { weekStart: { lt: new Date(c.w) } }) },
      orderBy: { weekStart: 'desc' },
      take: q.limit + 1,
    });
    const page = toPage(rows, q.limit, (r) => ({ w: r.weekStart.toISOString() }), (k) => this.cursors.encode(k));
    return {
      data: page.data.map((r) => ({
        weekStart: r.weekStart.toISOString().slice(0, 10),
        status: r.status,
        components: { progress: Number(r.progressC), consistency: Number(r.consistencyC), performance: Number(r.performanceC), challenge: r.challengeC === null ? null : Number(r.challengeC) },
        total: Number(r.total),
        breakdown: r.breakdown,
      })),
      page: page.page,
    };
  }
}
