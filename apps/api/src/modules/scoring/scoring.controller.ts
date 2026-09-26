import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { AppException } from '../../common/errors/app-exception';
import { CursorCodec } from '../../common/pagination/cursor';
import { PageQueryDto, toPage } from '../../common/pagination/page';
import { PrismaService } from '../../common/prisma/prisma.service';
import { levelTitleKey } from './level';
import { RuleSetService } from './rule-set.service';

/** XP balance, ledger history and "why did I get these points" (docs §9.1 explainability). */
@ApiTags('scoring')
@ApiBearerAuth()
@Controller()
export class ScoringController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleSets: RuleSetService,
    private readonly cursors: CursorCodec,
  ) {}

  @Get('me/xp')
  async xp(@CurrentUser() user: AuthUser) {
    const stats = await this.prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    const { config } = await this.ruleSets.getActive();
    return {
      xpTotal: Number(stats.xpTotal),
      level: stats.level,
      levelTitleKey: levelTitleKey(stats.level, config),
      xpIntoLevel: stats.xpIntoLevel,
      xpForNextLevel: stats.xpForNextLevel,
      progressPct: stats.xpForNextLevel ? Math.floor((stats.xpIntoLevel / stats.xpForNextLevel) * 100) : 0,
    };
  }

  @Get('me/xp/transactions')
  async xpTransactions(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    const c = q.cursor ? this.cursors.decode<{ id: string }>(q.cursor) : null;
    const rows = await this.prisma.xpTransaction.findMany({
      where: { userId: user.id, ...(c && { id: { lt: c.id } }) },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const page = toPage(rows, q.limit, (r) => ({ id: r.id }), (k) => this.cursors.encode(k));
    return {
      data: page.data.map((r) => ({
        id: r.id,
        amount: r.amount,
        reason: r.reason,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        reversesId: r.reversesId,
        effectiveAt: r.effectiveAt.toISOString(),
        ruleSetVersion: r.ruleSetVersion,
        explanation: r.explanation,
      })),
      page: page.page,
    };
  }

  @Get('workouts/:id/points')
  async workoutPoints(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const w = await this.prisma.workout.findUnique({ where: { id } });
    if (!w || w.userId !== user.id) throw AppException.notFound('Workout');
    const prIds = (await this.prisma.personalRecord.findMany({ where: { workoutId: id }, select: { id: true } })).map((p) => p.id);
    const entries = await this.prisma.xpTransaction.findMany({
      where: { userId: user.id, OR: [{ sourceType: 'workout', sourceId: { startsWith: `${id}#` } }, { sourceType: 'pr', sourceId: { in: prIds } }, { sourceType: 'quest', explanation: { path: ['workoutId'], equals: id } }] },
      orderBy: { id: 'asc' },
    });
    const live = entries.filter((e) => e.reason !== 'REVERSAL' && !entries.some((r) => r.reversesId === e.id));
    return {
      workoutId: id,
      status: w.status,
      totalXp: live.reduce((s, e) => s + e.amount, 0),
      entries: entries.map((e) => ({ id: e.id, amount: e.amount, reason: e.reason, reversesId: e.reversesId, explanation: e.explanation, ruleSetVersion: e.ruleSetVersion })),
    };
  }
}
