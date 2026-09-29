import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { GymWarsService } from './gym-wars.service';

export class GymWarEnrollmentDto {
  @ApiProperty({ description: 'false opts the gym out of the coming Gym Wars' })
  @IsBoolean()
  enrolled!: boolean;
}

/** Gym Wars (docs §4.5, §6.2). */
@ApiTags('gym-wars')
@ApiBearerAuth()
@Controller()
export class GymWarsController {
  constructor(private readonly wars: GymWarsService) {}

  @Get('gym-wars/current')
  current(@CurrentUser() user: AuthUser) {
    return this.wars.current(user.id);
  }

  @Get('gym-wars/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.wars.get(user.id, id);
  }

  @Get('gyms/:id/wars')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.wars.history(id);
  }

  @Post('gyms/:id/wars/registration')
  @HttpCode(HttpStatus.OK)
  register(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GymWarEnrollmentDto) {
    return this.wars.setEnrollment(user, id, dto.enrolled);
  }
}
