import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { CreateGymWodDto, ListGymWodsQueryDto, UpdateGymWodDto } from './dto/gym-wod.dto';
import { GymWodsService } from './gym-wods.service';

@ApiTags('gym-wods')
@ApiBearerAuth()
@Controller('gyms/:gymId/wods')
export class GymWodsController {
  constructor(private readonly wods: GymWodsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('gymId', ParseUUIDPipe) gymId: string, @Body() dto: CreateGymWodDto) {
    return this.wods.create(user, gymId, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('gymId', ParseUUIDPipe) gymId: string, @Query() q: ListGymWodsQueryDto) {
    return this.wods.list(user, gymId, q);
  }

  @Get(':wodId')
  get(@CurrentUser() user: AuthUser, @Param('gymId', ParseUUIDPipe) gymId: string, @Param('wodId', ParseUUIDPipe) wodId: string) {
    return this.wods.get(user, gymId, wodId);
  }

  @Patch(':wodId')
  update(@CurrentUser() user: AuthUser, @Param('gymId', ParseUUIDPipe) gymId: string, @Param('wodId', ParseUUIDPipe) wodId: string, @Body() dto: UpdateGymWodDto) {
    return this.wods.update(user, gymId, wodId, dto);
  }
}
