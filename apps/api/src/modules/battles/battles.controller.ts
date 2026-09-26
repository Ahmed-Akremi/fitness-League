import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequiresVerifiedEmail } from '../../common/auth/decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { BattlesService } from './battles.service';
import { CreateBattleDto, ListBattlesQueryDto } from './dto/battle.dto';

@ApiTags('battles')
@ApiBearerAuth()
@Controller('battles')
export class BattlesController {
  constructor(private readonly battles: BattlesService) {}

  @Post()
  @RequiresVerifiedEmail()
  @RateLimit({ name: 'battles', limit: 10, windowS: 86_400, by: 'user' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBattleDto) {
    return this.battles.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListBattlesQueryDto) {
    return this.battles.list(user.id, q);
  }

  /** Live scores while ACTIVE (polling in Phase 1, WebSocket in Phase 2 — Q-13). */
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.battles.get(user.id, id);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @RequiresVerifiedEmail()
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.battles.accept(user.id, id);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.battles.decline(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.battles.cancel(user.id, id);
  }
}
