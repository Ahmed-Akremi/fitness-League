import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { BadgesService } from './badges.service';

/** Badges (docs §4.5): the catalogue with my progress, and the badges I earned. */
@ApiTags('badges')
@ApiBearerAuth()
@Controller()
export class BadgesController {
  constructor(private readonly badges: BadgesService) {}

  @Get('badges')
  catalog(@CurrentUser() user: AuthUser) {
    return this.badges.catalog(user.id);
  }

  @Get('me/badges')
  mine(@CurrentUser() user: AuthUser) {
    return this.badges.earned(user.id);
  }
}
