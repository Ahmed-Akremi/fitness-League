import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { PageQueryDto } from '../../common/pagination/page';
import { LeaderboardsService } from './leaderboards.service';
import type { Scope } from './leaderboards.service';

class LeaderboardQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to the active season.' })
  @IsOptional()
  @IsUUID()
  seasonId?: string;
}

@ApiTags('leaderboards')
@ApiBearerAuth()
@Controller('leaderboards')
export class LeaderboardsController {
  constructor(private readonly boards: LeaderboardsService) {}

  private list(scope: Scope, q: LeaderboardQueryDto) {
    return this.boards.page(scope, { seasonId: q.seasonId, limit: q.limit, cursor: q.cursor });
  }

  private me(scope: Scope, user: AuthUser, q: LeaderboardQueryDto) {
    return this.boards.aroundMe(scope, user.id, { seasonId: q.seasonId, limit: q.limit });
  }

  @Get('national')
  national(@Query() q: LeaderboardQueryDto) {
    return this.list({ type: 'NATIONAL' }, q);
  }

  @Get('national/me')
  nationalMe(@CurrentUser() user: AuthUser, @Query() q: LeaderboardQueryDto) {
    return this.me({ type: 'NATIONAL' }, user, q);
  }

  @Get('governorates/:id')
  governorate(@Param('id', ParseUUIDPipe) id: string, @Query() q: LeaderboardQueryDto) {
    return this.list({ type: 'GOVERNORATE', id }, q);
  }

  @Get('governorates/:id/me')
  governorateMe(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: LeaderboardQueryDto) {
    return this.me({ type: 'GOVERNORATE', id }, user, q);
  }

  @Get('gyms/:id')
  gym(@Param('id', ParseUUIDPipe) id: string, @Query() q: LeaderboardQueryDto) {
    return this.list({ type: 'GYM', id }, q);
  }

  @Get('gyms/:id/me')
  gymMe(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: LeaderboardQueryDto) {
    return this.me({ type: 'GYM', id }, user, q);
  }

  @Get('friends')
  friends(@CurrentUser() user: AuthUser, @Query() q: LeaderboardQueryDto) {
    return this.list({ type: 'FRIENDS', userId: user.id }, q);
  }

  @Get('friends/me')
  friendsMe(@CurrentUser() user: AuthUser, @Query() q: LeaderboardQueryDto) {
    return this.me({ type: 'FRIENDS', userId: user.id }, user, q);
  }
}

@ApiTags('leaderboards')
@ApiBearerAuth()
@Controller('me')
export class MyRanksController {
  constructor(private readonly boards: LeaderboardsService) {}

  /** Home screen: "#184 Tunisia · #27 Sousse · #4 My gym". */
  @Get('ranks')
  ranks(@CurrentUser() user: AuthUser) {
    return this.boards.myRanks(user.id);
  }
}
