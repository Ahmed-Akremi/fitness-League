import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequiresVerifiedEmail } from '../../common/auth/decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { CreateLeagueDto, JoinByCodeDto } from './leagues.dto';
import { LeaguesService } from './leagues.service';

/** User-made leagues (docs §4.5). */
@ApiTags('leagues')
@ApiBearerAuth()
@Controller('leagues')
export class LeaguesController {
  constructor(private readonly leagues: LeaguesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.leagues.list(user.id);
  }

  @Post()
  @RequiresVerifiedEmail()
  @RateLimit({ name: 'league-create', limit: 10, windowS: 86_400, by: 'user' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLeagueDto) {
    return this.leagues.create(user.id, dto);
  }

  @Post('join-by-code')
  @HttpCode(HttpStatus.OK)
  // Invite codes must not be guessable by brute force.
  @RateLimit({ name: 'league-code', limit: 10, windowS: 3_600, by: 'user' })
  joinByCode(@CurrentUser() user: AuthUser, @Body() dto: JoinByCodeDto) {
    return this.leagues.joinByCode(user.id, dto.code);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leagues.get(user.id, id);
  }

  @Get(':id/leaderboard')
  leaderboard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leagues.leaderboard(user.id, id);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  join(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leagues.join(user.id, id);
  }

  @Delete(':id/membership')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.leagues.leave(user.id, id);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.leagues.removeMember(user.id, id, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.leagues.remove(user.id, id);
  }
}
