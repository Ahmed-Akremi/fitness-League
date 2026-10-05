import { Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequiresVerifiedEmail } from '../../common/auth/decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit';
import { DuelsService } from './duels.service';

/** Weekly Duel queue (docs §4.5, §6.1). The duel itself is a battle: read it with GET /battles/{id}. */
@ApiTags('duels')
@ApiBearerAuth()
@Controller('duels/queue')
export class DuelsController {
  constructor(private readonly duels: DuelsService) {}

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.duels.status(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequiresVerifiedEmail()
  @RateLimit({ name: 'duel-queue', limit: 20, windowS: 3_600, by: 'user' })
  join(@CurrentUser() user: AuthUser) {
    return this.duels.join(user.id);
  }

  @Delete()
  leave(@CurrentUser() user: AuthUser) {
    return this.duels.leave(user.id);
  }
}
