import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequiresVerifiedEmail } from '../../common/auth/decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { CreateChallengeDto, ListChallengesQueryDto } from './challenges.dto';
import { ChallengesService } from './challenges.service';

/** Challenges (docs §4.5). */
@ApiTags('challenges')
@ApiBearerAuth()
@Controller('challenges')
export class ChallengesController {
  constructor(private readonly challenges: ChallengesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListChallengesQueryDto) {
    return this.challenges.list(user.id, q);
  }

  @Post()
  @RequiresVerifiedEmail()
  @RateLimit({ name: 'challenge-create', limit: 20, windowS: 86_400, by: 'user' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateChallengeDto) {
    return this.challenges.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.challenges.get(user.id, id);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  join(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.challenges.join(user.id, id);
  }

  @Delete(':id/join')
  leave(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.challenges.leave(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.challenges.remove(user, id);
  }
}
